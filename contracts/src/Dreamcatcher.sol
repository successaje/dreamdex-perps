// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IMarginBank, IPerpPool, IOperatorRegistry} from "./interfaces/IDreamDexPerps.sol";
import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

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
contract Dreamcatcher is SomniaEventHandler {
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

    /**
     *  ImmediateOrCancel — "fill what crosses now, cancel the remainder".
     *
     *  Hardcoded, never taken from a caller. The venue's enum is
     *  `0 NormalOrder (rest), 1 FillOrKill, 2 ImmediateOrCancel, 3 PostOnly`,
     *  and a RESTING order is what makes non-increase unprovable: between
     *  placement and fill the position can change, and an order that was a
     *  reduction becomes one that flips it. IOC collapses the read, the cap and
     *  the fill into one transaction, so nothing can move in between. It also
     *  leaves no remainder on the book, so there is never an old order for a
     *  later disarm to worry about.
     */
    uint8 public constant ORDER_TYPE_IOC = 2;

    uint16 internal constant BPS = 10_000;

    /**
     *  Gas that must remain before the margin reads are attempted.
     *
     *  `getMarginStatus` costs about 3.2 MILLION gas on Hideki — measured, not
     *  guessed. Wrapped in `try/catch` that turns into a trap: `eth_estimateGas`
     *  explores the cheap failure branch, returns a limit smaller than the read
     *  itself, and the funded transaction then takes exactly the branch the
     *  estimate priced. The first live `cut()` reported "status unreadable" for
     *  a position whose status was perfectly readable.
     *
     *  Checking here converts that into an honest, diagnosable skip. A caller
     *  who sees it knows to raise the gas limit rather than suspect the venue.
     */
    uint256 public constant MIN_READ_GAS = 5_000_000;

    /**
     *  Accounts a single reactive callback will check.
     *
     *  Deliberately tiny. `getMarginStatus` costs about 3.2M gas per account,
     *  so a callback that swept twenty watchers would need 64M of gas before it
     *  placed a single order. Three is roughly what fits in a sane handler
     *  budget, and the permissionless `cut` covers whoever the sweep misses.
     *  This is the honest ceiling of the reactive path on today's gas costs,
     *  not a number chosen for neatness.
     */
    uint256 public constant MAX_PER_EVENT = 3;

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
        /// Attempts made, filled or not. Kept apart from `cutsLeft` because a
        /// zero-fill is not a reduction and must not spend the user's budget.
        uint16 attempts;
        /// Seconds between cuts on this pool.
        uint32 cooldown;
        uint64 lastCutAt;
        /// How many more cuts this watch may make. A bounded number of actions
        /// is a bound a user can actually reason about.
        uint16 cutsLeft;
        /**
         *  How many it was armed with.
         *
         *  Storing only `cutsLeft` made "how many have been spent" unanswerable
         *  from chain state, so the UI guessed from browser storage and reported
         *  "3 of 3, none spent" for a watch that had already cut. A receipt
         *  screen must not depend on the device it is opened from.
         */
        uint16 armedCuts;
        bool armed;
    }

    /// One watch per account per pool, because the grant is per pool too.
    mapping(address account => mapping(address pool => Watch)) public watches;

    /**
     *  Who to check when a pool stirs.
     *
     *  The reactive callback is handed an EMITTER, not an account — the pool
     *  does not know who we are watching. So the roster has to live here, and
     *  it has to be bounded: see MAX_PER_EVENT.
     */
    mapping(address pool => address[]) private _roster;
    mapping(address pool => mapping(address account => bool)) private _onRoster;

    /// Subscription ids, 0 while dormant.
    mapping(address pool => uint256) public subscriptionOf;

    IMarginBank public immutable marginBank;
    IOperatorRegistry public immutable operatorRegistry;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Armed(address indexed account, address indexed pool, uint256 limitPrice, uint16 reduceBps, uint8 triggerStatus, uint16 cuts);
    event Disarmed(address indexed account, address indexed pool, uint16 cutsLeft);
    /// `filled` is the measured reduction in position size, not the quantity
    /// asked for. The two differ on every partial fill.
    event Cut(
        address indexed account,
        address indexed pool,
        bool isBid,
        uint256 requested,
        uint256 filled,
        uint256 limitPrice,
        uint8 statusBefore,
        uint16 cutsLeft
    );
    /// An attempt that crossed nothing. Costs an attempt and the cooldown, but
    /// NOT a cut — a zero-fill is not a reduction and must not spend the budget.
    event CutNoFill(address indexed account, address indexed pool, uint256 requested, uint16 attempts);
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
    /// The order left the account LARGER than it found it. Should be
    /// unreachable with IOC and a capped quantity; if it ever fires, the whole
    /// attempt is unwound rather than recorded.
    error PositionIncreased(uint256 before_, uint256 after_);
    /// The order crossed through flat and opened the other way.
    error PositionFlipped(int256 before_, int256 after_);
    error NotOwner();
    error AlreadySubscribed();
    error UnderFunded(uint256 held, uint256 needed);

    address public immutable owner;

    /// Nothing here calls out to a user-controlled contract, but `deliver`
    /// re-enters this contract by design and the pool is upgradeable. The guard
    /// costs one slot and removes a whole class of argument.
    uint256 private _lock = 1;
    error Reentrant();

    modifier nonReentrant() {
        require(_lock == 1, Reentrant());
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address marginBank_, address operatorRegistry_) {
        marginBank = IMarginBank(marginBank_);
        operatorRegistry = IOperatorRegistry(operatorRegistry_);
        owner = msg.sender;
    }

    /// Reactive callbacks are paid out of this contract's own balance.
    receive() external payable {}

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
            attempts: 0,
            cooldown: cooldown,
            lastCutAt: 0,
            cutsLeft: cuts,
            armedCuts: cuts,
            armed: true
        });

        if (!_onRoster[pool][msg.sender]) {
            _onRoster[pool][msg.sender] = true;
            _roster[pool].push(msg.sender);
        }

        emit Armed(msg.sender, pool, limitPrice, reduceBps, triggerStatus, cuts);
    }

    function disarm(address pool) external {
        Watch storage w = watches[msg.sender][pool];
        require(w.armed, NotArmed());
        uint16 left = w.cutsLeft;
        delete watches[msg.sender][pool];
        _dropFromRoster(pool, msg.sender);
        emit Disarmed(msg.sender, pool, left);
    }

    /*//////////////////////////////////////////////////////////////
                                  CUT
    //////////////////////////////////////////////////////////////*/

    /// Permissionless and idempotent. Also the body of the reactive handler,
    /// which is why it returns quietly rather than reverting on an account that
    /// simply does not need cutting — a revert there would burn this contract's
    /// gas on every unrelated margin event the chain emits.
    function cut(address account, address pool) external nonReentrant {
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

        // Before the reads, not after: a status read that runs out of gas is
        // indistinguishable from a venue that cannot answer.
        if (gasleft() < MIN_READ_GAS) {
            emit CutSkipped(account, pool, "insufficient gas to read status");
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

        // The cooldown and the attempt counter move on EVERY attempt, so a
        // market that keeps refusing cannot be retried in a tight loop. The
        // reduction budget moves only when a reduction actually happens.
        w.attempts += 1;
        w.lastCutAt = uint64(block.timestamp);

        try this.deliver(account, pool, isBid, quantity, w.limitPrice) returns (uint256 filled) {
            if (filled == 0) {
                emit CutNoFill(account, pool, quantity, w.attempts);
                return;
            }
            w.cutsLeft -= 1;
            emit Cut(account, pool, isBid, quantity, filled, w.limitPrice, status, w.cutsLeft);
        } catch (bytes memory err) {
            // `deliver` is external to itself, so a revert in there unwound the
            // order too. Nothing happened; nothing is recorded but the attempt.
            emit CutFailed(account, pool, err.length >= 4 ? bytes4(err) : bytes4(0));
        }
    }

    /**
     *  The order leg. External so one failure is catchable as a unit — and so a
     *  revert here unwinds the ORDER as well as our bookkeeping.
     *
     *  Reads the position on both sides of the call and returns the measured
     *  reduction. Everything the caller records comes from this number, never
     *  from the quantity that was asked for.
     */
    function deliver(address account, address pool, bool isBid, uint256 quantity, uint256 limitPrice)
        external
        returns (uint256 filled)
    {
        require(msg.sender == address(this), NotSelf());

        (int256 before_,,,) = marginBank.getPosition(account, pool);

        IPerpPool(pool).placeOrderFor(
            account,
            isBid,
            uint64(uint160(account)), // userData: attribution, nothing depends on it
            limitPrice,
            quantity,
            uint64(block.timestamp + 300) * 1e9, // expiry in ns; IOC never rests, so this is a formality
            ORDER_TYPE_IOC,
            0, // selfMatchingOption: venue default
            address(0), // no builder
            0
        );

        (int256 after_,,,) = marginBank.getPosition(account, pool);

        // The whole safety claim, checked rather than argued. IOC plus a
        // quantity capped at the live magnitude should make both impossible;
        // if either ever holds, unwind instead of recording a "reduction" that
        // made the user's exposure worse.
        if ((before_ > 0 && after_ < 0) || (before_ < 0 && after_ > 0)) {
            revert PositionFlipped(before_, after_);
        }
        uint256 magBefore = before_ < 0 ? uint256(-before_) : uint256(before_);
        uint256 magAfter = after_ < 0 ? uint256(-after_) : uint256(after_);
        if (magAfter > magBefore) revert PositionIncreased(magBefore, magAfter);

        return magBefore - magAfter;
    }

    function _dropFromRoster(address pool, address account) private {
        if (!_onRoster[pool][account]) return;
        _onRoster[pool][account] = false;
        address[] storage r = _roster[pool];
        for (uint256 i = 0; i < r.length; ++i) {
            if (r[i] == account) {
                r[i] = r[r.length - 1];
                r.pop();
                return;
            }
        }
    }

    /// Cuts spent, straight from chain state — no client-side bookkeeping.
    function cutsSpent(address account, address pool) external view returns (uint16) {
        Watch storage w = watches[account][pool];
        return w.armedCuts > w.cutsLeft ? w.armedCuts - w.cutsLeft : 0;
    }

    function rosterLength(address pool) external view returns (uint256) {
        return _roster[pool].length;
    }

    /*//////////////////////////////////////////////////////////////
                               REACTIVITY
    //////////////////////////////////////////////////////////////*/

    /**
     *  The chain stirs a pool; we check who we are watching there.
     *
     *  Runs as a synthetic transaction with the precompile as `msg.sender` and
     *  this contract's balance paying the gas, so it must never revert on
     *  something unrelated — every path inside `_cut` returns quietly instead.
     */
    function _onEvent(address emitter, bytes32[] calldata, bytes calldata) internal override {
        address[] storage r = _roster[emitter];
        uint256 n = r.length < MAX_PER_EVENT ? r.length : MAX_PER_EVENT;
        for (uint256 i = 0; i < n; ++i) {
            // One starved account must not swallow the rest of the budget.
            if (gasleft() < MIN_READ_GAS) return;
            _cut(r[i], emitter);
        }
    }

    /**
     *  Subscribe to one pool's events so the chain drives cuts there.
     *
     *  Needs 32 native tokens held by THIS contract — a sybil gate, not a fee:
     *  the balance is never consumed, it just has to be there. Callbacks then
     *  spend from the same balance, so top it up with a plain transfer.
     */
    function subscribePool(address pool, bytes32 topic0, uint64 gasLimit, uint64 priorityFeePerGas, uint64 maxFeePerGas)
        external
        returns (uint256 subscriptionId)
    {
        require(msg.sender == owner, NotOwner());
        require(subscriptionOf[pool] == 0, AlreadySubscribed());
        uint256 need = SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE;
        require(address(this).balance >= need, UnderFunded(address(this).balance, need));

        subscriptionId = SomniaExtensions.subscribe(
            address(this),
            SomniaExtensions.SubscriptionFilter({
                eventTopics: [topic0, bytes32(0), bytes32(0), bytes32(0)],
                origin: address(0),
                emitter: pool
            }),
            SomniaExtensions.SubscriptionOptions({
                priorityFeePerGas: priorityFeePerGas,
                maxFeePerGas: maxFeePerGas,
                gasLimit: gasLimit
            })
        );
        subscriptionOf[pool] = subscriptionId;
        emit Subscribed(pool, subscriptionId);
    }

    event Subscribed(address indexed pool, uint256 subscriptionId);

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
