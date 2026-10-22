// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IMarginBank, IERC20} from "./interfaces/IDreamDexPerps.sol";

/**
 *                            Dreamcatcher
 *
 *  A standing instruction that catches a perps position before liquidation does.
 *
 *  The user never deposits anything here. They keep their position, their
 *  collateral and their keys, and grant one ERC-20 allowance. When their margin
 *  status degrades past the line they chose, Dreamcatcher pulls the smallest
 *  amount that respects their caps and credits it to their margin through the
 *  MarginBank's `depositFor`. We are a payer, never a custodian — at no point
 *  does Dreamcatcher hold the position, and the only funds it can ever touch
 *  are an allowance the user can revoke in one transaction.
 *
 *  Driven two ways, same internals:
 *    - Somnia reactivity, so the chain itself fires the rescue; and
 *    - `rescue(account)`, permissionless, so anyone can catch anyone.
 *  Either works alone. A watch does not depend on us being online.
 */
contract Dreamcatcher {
    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    /// dreamDEX's ladder. A watch arms on a rung and fires at or below it.
    uint8 public constant HEALTHY = 0;
    uint8 public constant MARGIN_CALL = 1;
    uint8 public constant PARTIAL_LIQUIDATION = 2;
    uint8 public constant CLOSE_OUT = 3;

    struct Watch {
        /// Most collateral one rescue may pull. Bounds a single bad tick.
        uint128 perRescue;
        /// Total still rescuable. Spent down, never topped up implicitly — a
        /// user who wants more protection says so explicitly.
        uint128 budget;
        /// Fire when `getMarginStatus(account) >= this`. 1 catches at the first
        /// margin call; 2 waits until partial liquidation has begun.
        uint8 triggerStatus;
        /// Seconds between rescues. Without it, one degrading position could
        /// drain its whole budget inside a single block of bad marks.
        uint32 cooldown;
        uint64 lastRescueAt;
        bool armed;
    }

    mapping(address => Watch) public watches;

    IMarginBank public immutable marginBank;
    IERC20 public immutable collateral;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Armed(address indexed account, uint128 perRescue, uint128 budget, uint8 triggerStatus, uint32 cooldown);
    event Disarmed(address indexed account, uint128 budgetLeft);
    event Rescued(address indexed account, uint256 amount, uint8 statusBefore, uint128 budgetLeft);
    /// A rescue that correctly did nothing. Not an error — the common case is a
    /// healthy account — but every skip is on chain so a user can see that their
    /// watch was awake and chose not to spend.
    event RescueSkipped(address indexed account, string reason);
    /// The rescue was warranted and failed. Distinct from a skip on purpose.
    event RescueFailed(address indexed account, bytes4 selector);

    error NotArmed();
    error ZeroPerRescue();
    error BudgetBelowPerRescue();
    error TriggerOutOfRange();
    error NotSelf();
    error TokenCallReturnedFalse();

    constructor(address marginBank_, address collateral_) {
        marginBank = IMarginBank(marginBank_);
        collateral = IERC20(collateral_);
    }

    /*//////////////////////////////////////////////////////////////
                                  USER
    //////////////////////////////////////////////////////////////*/

    /**
     *  Arm a watch over the caller's own account. Moves no money.
     *
     *  The user separately approves this contract on the collateral token for
     *  at most `budget`. That approval is the entire trust surface, and
     *  revoking it disarms the watch in practice whatever this storage says.
     */
    function arm(uint128 perRescue, uint128 budget, uint8 triggerStatus, uint32 cooldown) external {
        require(perRescue > 0, ZeroPerRescue());
        require(budget >= perRescue, BudgetBelowPerRescue());
        // HEALTHY would fire on an account in no trouble at all.
        require(triggerStatus >= MARGIN_CALL && triggerStatus <= CLOSE_OUT, TriggerOutOfRange());

        watches[msg.sender] = Watch({
            perRescue: perRescue,
            budget: budget,
            triggerStatus: triggerStatus,
            cooldown: cooldown,
            lastRescueAt: 0,
            armed: true
        });

        emit Armed(msg.sender, perRescue, budget, triggerStatus, cooldown);
    }

    function disarm() external {
        Watch storage w = watches[msg.sender];
        require(w.armed, NotArmed());
        uint128 left = w.budget;
        delete watches[msg.sender];
        emit Disarmed(msg.sender, left);
    }

    /*//////////////////////////////////////////////////////////////
                                 RESCUE
    //////////////////////////////////////////////////////////////*/

    /**
     *  Catch `account` if it needs catching. Permissionless and idempotent.
     *
     *  Never reverts on an account that simply does not need rescuing: this is
     *  also the body of the reactive handler, and a revert there would burn the
     *  contract's gas on every unrelated margin event the chain emits.
     */
    function rescue(address account) external {
        _rescue(account);
    }

    function _rescue(address account) internal {
        Watch storage w = watches[account];
        if (!w.armed) return; // not ours — the overwhelmingly common case

        if (w.lastRescueAt != 0 && block.timestamp < w.lastRescueAt + w.cooldown) {
            emit RescueSkipped(account, "cooling down");
            return;
        }

        uint8 status;
        try marginBank.getMarginStatus(account) returns (uint8 s) {
            status = s;
        } catch {
            emit RescueSkipped(account, "status unreadable");
            return;
        }
        if (status < w.triggerStatus) {
            emit RescueSkipped(account, "above trigger");
            return;
        }

        // Spend the least of what the user allowed, still has, and still owes
        // the budget. Any of these can be zero without it being a failure.
        uint256 amount = w.perRescue;
        if (amount > w.budget) amount = w.budget;
        uint256 allowed = collateral.allowance(account, address(this));
        if (amount > allowed) amount = allowed;
        uint256 held = collateral.balanceOf(account);
        if (amount > held) amount = held;

        if (amount == 0) {
            emit RescueSkipped(account, allowed == 0 ? "allowance revoked" : "wallet empty");
            return;
        }

        // State before the external calls. A reverting leg unwinds its own
        // effects; what must not happen is a successful deposit that the budget
        // never recorded.
        w.budget -= uint128(amount);
        w.lastRescueAt = uint64(block.timestamp);

        try this.deliver(account, amount) {
            emit Rescued(account, amount, status, w.budget);
        } catch (bytes memory err) {
            // Give the budget back — nothing was delivered.
            w.budget += uint128(amount);
            emit RescueFailed(account, err.length >= 4 ? bytes4(err) : bytes4(0));
        }
    }

    /**
     *  The money leg, external so a failure is catchable as one unit.
     *
     *  Pull from the user's wallet, hand it to the MarginBank on their behalf,
     *  and leave no standing approval behind.
     */
    function deliver(address account, uint256 amount) external {
        require(msg.sender == address(this), NotSelf());
        _check(collateral.transferFrom(account, address(this), amount));
        _check(collateral.approve(address(marginBank), amount));
        marginBank.depositFor(account, amount);
        _check(collateral.approve(address(marginBank), 0));
    }

    /// A token that signals failure by RETURNING FALSE rather than reverting
    /// would otherwise turn a failed pull into a logged rescue that never
    /// happened — the budget spent, the margin untouched, and nothing on chain
    /// saying so.
    function _check(bool okay) private pure {
        require(okay, TokenCallReturnedFalse());
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEWS
    //////////////////////////////////////////////////////////////*/

    /// What a rescue right now would actually spend, and why it might be zero.
    /// The UI reads this to show the user whether their net is really strung.
    function quote(address account)
        external
        view
        returns (bool wouldFire, uint256 amount, uint8 status, string memory blockedBy)
    {
        Watch storage w = watches[account];
        if (!w.armed) return (false, 0, 0, "not armed");

        status = marginBank.getMarginStatus(account);
        if (status < w.triggerStatus) return (false, 0, status, "above trigger");
        if (w.lastRescueAt != 0 && block.timestamp < w.lastRescueAt + w.cooldown) {
            return (false, 0, status, "cooling down");
        }

        amount = w.perRescue;
        if (amount > w.budget) amount = w.budget;
        uint256 allowed = collateral.allowance(account, address(this));
        if (amount > allowed) amount = allowed;
        uint256 held = collateral.balanceOf(account);
        if (amount > held) amount = held;

        if (amount == 0) return (false, 0, status, allowed == 0 ? "allowance revoked" : "wallet empty");
        return (true, amount, status, "");
    }
}
