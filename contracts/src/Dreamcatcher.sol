// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IMarginBank, IPerpPool, IOperatorRegistry} from "./interfaces/IDreamDexPerps.sol";

/**
 *                            Dreamcatcher
 *
 *  Cuts a perp position before the liquidation engine does.
 *
 *  Liquidation takes your position at whatever the book offers, plus a penalty.
 *  Dreamcatcher takes a slice of it earlier, at a limit price you chose, and
 *  stops there. Same direction of travel, on your terms instead of the
 *  engine's.
 *
 *  It never holds your money or your position. The user grants ONE selector —
 *  `placeOrderFor` — on ONE pool through dreamDEX's own operator registry, and
 *  revoking that grant disables this contract entirely, whatever its storage
 *  says. Dreamcatcher cannot open a position, cannot increase one, cannot
 *  withdraw anything, and cannot trade a pool it was not granted.
 *
 *  Driven two ways on one body: Somnia reactivity, so the chain fires the cut,
 *  and `cut(account, pool)`, permissionless, so anyone can. Either alone is
 *  enough; a watch never depends on us being online.
 */
contract Dreamcatcher {
    /*//////////////////////////////////////////////////////////////
                               CONSTANTS
    //////////////////////////////////////////////////////////////*/

    /// dreamDEX's margin ladder.
    uint8 public constant HEALTHY = 0;
    uint8 public constant MARGIN_CALL = 1;
    uint8 public constant PARTIAL_LIQUIDATION = 2;
    uint8 public constant CLOSE_OUT = 3;

    /// The single power a user grants us, and the only one we ever use.
    bytes4 public constant PLACE_ORDER_FOR = 0x80054449;

    uint16 internal constant BPS = 10_000;

    /*//////////////////////////////////////////////////////////////
                                 TYPES
    //////////////////////////////////////////////////////////////*/

    struct Watch {
        /**
         *  The worst price this cut may accept, in raw quote units per whole
         *  base — the user's number, not an oracle's.
         *
         *  Reading a mark price on chain would mean trusting a getter nothing
         *  here has verified, and letting the caller pass a price would let a
         *  keeper dump the position into a bad book. An absolute limit the user
         *  set is the only version where nobody but the user picks the price.
         */
        uint256 limitPrice;
        /// Fraction of the CURRENT position each cut reduces, in bps.
        uint16 reduceBps;
        /// Quantity granularity for this pool, from its market row. Cuts round
        /// DOWN onto it, because a sub-lot order is rejected outright.
        uint128 lotSize;
        /// Fire when `getMarginStatus(account) >= this`.
        uint8 triggerStatus;
        /// The venue's order-type code, supplied by the caller's frontend. Not
        /// interpreted here — asserting an enum this contract has not verified
        /// is how the last design went wrong.
        uint8 orderType;
        /// Seconds between cuts on this pool.
        uint32 cooldown;
        uint64 lastCutAt;
        /// How many more cuts this watch may make. A bounded number of actions
        /// is a bound a user can actually reason about.
        uint16 cutsLeft;
        bool armed;
    }

    /// One watch per account per pool, because the grant is per pool too.
    mapping(address account => mapping(address pool => Watch)) public watches;

    IMarginBank public immutable marginBank;
    IOperatorRegistry public immutable operatorRegistry;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Armed(address indexed account, address indexed pool, uint256 limitPrice, uint16 reduceBps, uint8 triggerStatus, uint16 cuts);
    event Disarmed(address indexed account, address indexed pool, uint16 cutsLeft);
    event Cut(address indexed account, address indexed pool, bool isBid, uint256 quantity, uint256 limitPrice, uint8 statusBefore, uint16 cutsLeft);
    /// A cut that correctly did nothing. Every skip is on chain so a user can
    /// see the watch was awake and chose not to act.
    event CutSkipped(address indexed account, address indexed pool, string reason);
    /// Warranted, attempted, failed. Deliberately distinct from a skip.
    event CutFailed(address indexed account, address indexed pool, bytes4 selector);

    error ZeroLimitPrice();
    error ReduceOutOfRange();
    error TriggerOutOfRange();
    error ZeroLotSize();
    error NoCuts();
    error NotArmed();
    error NotSelf();

    constructor(address marginBank_, address operatorRegistry_) {
        marginBank = IMarginBank(marginBank_);
        operatorRegistry = IOperatorRegistry(operatorRegistry_);
    }

    /*//////////////////////////////////////////////////////////////
                                  USER
    //////////////////////////////////////////////////////////////*/

    /**
     *  Arm a watch over the caller's own position in one pool. Moves nothing.
     *
     *  Separately, the user grants this contract `PLACE_ORDER_FOR` on the same
     *  pool in dreamDEX's operator registry. That grant is the real switch:
     *  without it every cut fails at the pool, and revoking it is instant.
     */
    function arm(
        address pool,
        uint256 limitPrice,
        uint16 reduceBps,
        uint128 lotSize,
        uint8 triggerStatus,
        uint8 orderType,
        uint32 cooldown,
        uint16 cuts
    ) external {
        require(limitPrice > 0, ZeroLimitPrice());
        require(reduceBps > 0 && reduceBps <= BPS, ReduceOutOfRange());
        require(lotSize > 0, ZeroLotSize());
        // HEALTHY would cut a position in no trouble at all.
        require(triggerStatus >= MARGIN_CALL && triggerStatus <= CLOSE_OUT, TriggerOutOfRange());
        require(cuts > 0, NoCuts());

        watches[msg.sender][pool] = Watch({
            limitPrice: limitPrice,
            reduceBps: reduceBps,
            lotSize: lotSize,
            triggerStatus: triggerStatus,
            orderType: orderType,
            cooldown: cooldown,
            lastCutAt: 0,
            cutsLeft: cuts,
            armed: true
        });

        emit Armed(msg.sender, pool, limitPrice, reduceBps, triggerStatus, cuts);
    }

    function disarm(address pool) external {
        Watch storage w = watches[msg.sender][pool];
        require(w.armed, NotArmed());
        uint16 left = w.cutsLeft;
        delete watches[msg.sender][pool];
        emit Disarmed(msg.sender, pool, left);
    }

    /*//////////////////////////////////////////////////////////////
                                  CUT
    //////////////////////////////////////////////////////////////*/

    /// Permissionless and idempotent. Also the body of the reactive handler,
    /// which is why it returns quietly rather than reverting on an account that
    /// simply does not need cutting — a revert there would burn this contract's
    /// gas on every unrelated margin event the chain emits.
    function cut(address account, address pool) external {
        _cut(account, pool);
    }

    function _cut(address account, address pool) internal {
        Watch storage w = watches[account][pool];
        if (!w.armed) return; // not ours — the overwhelmingly common case

        if (w.cutsLeft == 0) {
            emit CutSkipped(account, pool, "no cuts left");
            return;
        }
        if (w.lastCutAt != 0 && block.timestamp < w.lastCutAt + w.cooldown) {
            emit CutSkipped(account, pool, "cooling down");
            return;
        }

        uint8 status;
        try marginBank.getMarginStatus(account) returns (uint8 s) {
            status = s;
        } catch {
            emit CutSkipped(account, pool, "status unreadable");
            return;
        }
        if (status < w.triggerStatus) {
            emit CutSkipped(account, pool, "above trigger");
            return;
        }

        int256 size;
        try marginBank.getPosition(account, pool) returns (int256 s, uint256, int256, int256) {
            size = s;
        } catch {
            emit CutSkipped(account, pool, "position unreadable");
            return;
        }
        if (size == 0) {
            emit CutSkipped(account, pool, "flat");
            return;
        }

        // Reducing a long means selling; reducing a short means buying. Getting
        // this backwards would INCREASE the position at the worst possible
        // moment, so it is derived from the sign and never passed in.
        bool isBid = size < 0;
        uint256 magnitude = size < 0 ? uint256(-size) : uint256(size);

        uint256 quantity = (magnitude * w.reduceBps) / BPS;
        quantity = (quantity / w.lotSize) * w.lotSize; // sub-lot orders are rejected outright
        if (quantity == 0) {
            emit CutSkipped(account, pool, "below one lot");
            return;
        }

        // Cheap, explicit, and a much better log line than the pool's revert:
        // tell the user their grant is missing rather than failing opaquely.
        if (!operatorRegistry.isApprovedForPool(pool, account, address(this), PLACE_ORDER_FOR)) {
            emit CutSkipped(account, pool, "operator grant missing");
            return;
        }

        w.cutsLeft -= 1;
        w.lastCutAt = uint64(block.timestamp);

        try this.deliver(account, pool, isBid, quantity, w.limitPrice, w.orderType) {
            emit Cut(account, pool, isBid, quantity, w.limitPrice, status, w.cutsLeft);
        } catch (bytes memory err) {
            // Nothing was placed, so the attempt should not count against the
            // user's budget.
            w.cutsLeft += 1;
            emit CutFailed(account, pool, err.length >= 4 ? bytes4(err) : bytes4(0));
        }
    }

    /// The order leg, external so one failure is catchable as a unit.
    function deliver(
        address account,
        address pool,
        bool isBid,
        uint256 quantity,
        uint256 limitPrice,
        uint8 orderType
    ) external {
        require(msg.sender == address(this), NotSelf());
        IPerpPool(pool).placeOrderFor(
            account,
            isBid,
            uint64(uint160(account)), // userData: attribution, nothing depends on it
            limitPrice,
            quantity,
            uint64(block.timestamp + 300) * 1e9, // expiry in ns, five minutes out
            orderType,
            0, // selfMatchingOption: venue default
            address(0), // no builder
            0
        );
    }

    /*//////////////////////////////////////////////////////////////
                                  VIEW
    //////////////////////////////////////////////////////////////*/

    /// What a cut right now would do, and why it might do nothing. The UI reads
    /// this to tell the user whether the net is really strung.
    function quote(address account, address pool)
        external
        view
        returns (bool wouldCut, bool isBid, uint256 quantity, uint8 status, string memory blockedBy)
    {
        Watch storage w = watches[account][pool];
        if (!w.armed) return (false, false, 0, 0, "not armed");
        if (w.cutsLeft == 0) return (false, false, 0, 0, "no cuts left");

        status = marginBank.getMarginStatus(account);
        if (status < w.triggerStatus) return (false, false, 0, status, "above trigger");
        if (w.lastCutAt != 0 && block.timestamp < w.lastCutAt + w.cooldown) {
            return (false, false, 0, status, "cooling down");
        }

        (int256 size,,,) = marginBank.getPosition(account, pool);
        if (size == 0) return (false, false, 0, status, "flat");

        isBid = size < 0;
        uint256 magnitude = size < 0 ? uint256(-size) : uint256(size);
        quantity = ((magnitude * w.reduceBps) / BPS / w.lotSize) * w.lotSize;
        if (quantity == 0) return (false, isBid, 0, status, "below one lot");

        if (!operatorRegistry.isApprovedForPool(pool, account, address(this), PLACE_ORDER_FOR)) {
            return (false, isBid, quantity, status, "operator grant missing");
        }
        return (true, isBid, quantity, status, "");
    }
}
