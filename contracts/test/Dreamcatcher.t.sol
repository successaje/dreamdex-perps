// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, Vm} from "forge-std/Test.sol";
import {Dreamcatcher} from "../src/Dreamcatcher.sol";

/// Stand-ins for the three contracts Dreamcatcher talks to. The fork suite
/// proves these match the real ones; this suite proves the policy arithmetic,
/// which is where a quiet bug would live.
contract MockBank {
    uint8 public status;
    mapping(address => mapping(address => int256)) public size;

    function setStatus(uint8 s) external { status = s; }
    function setSize(address a, address p, int256 s) external { size[a][p] = s; }
    function getMarginStatus(address) external view returns (uint8) { return status; }
    function getPosition(address a, address p) external view returns (int256, uint256, int256, int256) {
        return (size[a][p], 0, 0, 0);
    }
}

/**
 *  A pool that actually moves the position, because fill-based accounting
 *  cannot be tested against a mock that only records calls. `fillBps` is how
 *  much of the requested quantity crosses: 10000 fills it all, 4000 is a
 *  partial, 0 is an empty book.
 */
contract MockPool {
    struct Order { address account; bool isBid; uint256 price; uint256 quantity; uint8 orderType; }
    Order[] public orders;
    MockBank public bank;
    uint16 public fillBps = 10_000;
    bool public revertOnPlace;
    /// Simulates a venue that overfills — the invariant's reason to exist.
    int256 public forceSizeAfter;
    bool public forceSize;

    constructor(MockBank b) { bank = b; }

    function setFillBps(uint16 v) external { fillBps = v; }
    function setRevert(bool v) external { revertOnPlace = v; }
    function setForcedSizeAfter(int256 v) external { forceSize = true; forceSizeAfter = v; }
    function count() external view returns (uint256) { return orders.length; }
    function last() external view returns (Order memory) { return orders[orders.length - 1]; }

    function placeOrderFor(
        address account, bool isBid, uint64, uint256 price, uint256 quantity,
        uint64, uint8 orderType, uint8, address, uint96
    ) external {
        require(!revertOnPlace, "pool down");
        orders.push(Order(account, isBid, price, quantity, orderType));

        if (forceSize) { bank.setSize(account, address(this), forceSizeAfter); return; }

        int256 size = bank.size(account, address(this));
        uint256 mag = size < 0 ? uint256(-size) : uint256(size);
        uint256 filled = (quantity * fillBps) / 10_000;
        if (filled > mag) filled = mag;
        int256 next = size > 0 ? int256(mag - filled) : -int256(mag - filled);
        bank.setSize(account, address(this), next);
    }
}

contract MockRegistry {
    mapping(bytes32 => bool) public granted;
    function grant(address pool, address owner, address op, bytes4 sel, bool v) external {
        granted[keccak256(abi.encode(pool, owner, op, sel))] = v;
    }
    function isApprovedForPool(address pool, address owner, address op, bytes4 sel) external view returns (bool) {
        return granted[keccak256(abi.encode(pool, owner, op, sel))];
    }
}

contract DreamcatcherTest is Test {
    Dreamcatcher dc;
    MockBank bank;
    MockPool pool;
    MockRegistry reg;

    address user = makeAddr("user");
    uint128 constant LOT = 1e6;
    uint256 constant LIMIT = 95_000e18;

    function setUp() public {
        bank = new MockBank();
        pool = new MockPool(bank);
        reg = new MockRegistry();
        dc = new Dreamcatcher(address(bank), address(reg));
        reg.grant(address(pool), user, address(dc), dc.PLACE_ORDER_FOR(), true);
    }

    function _arm(uint16 reduceBps, uint8 trigger, uint32 cd, uint16 cuts) internal {
        vm.prank(user);
        dc.arm(address(pool), LIMIT, reduceBps, LOT, trigger, cd, cuts);
    }

    /*//////////////////////////////////////////////////////// direction */

    /// The one that must never be wrong: cutting a LONG means SELLING.
    /// Getting this backwards would grow the position at the worst moment.
    function test_longIsReducedBySelling() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6); // long
        bank.setStatus(1);

        dc.cut(user, address(pool));

        MockPool.Order memory o = pool.last();
        assertEq(o.account, user);
        assertFalse(o.isBid, "selling to reduce a long");
        assertEq(o.quantity, 25e6, "25% of the position");
        assertEq(o.price, LIMIT, "the user's limit, nobody else's");
    }

    function test_shortIsReducedByBuying() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), -100e6); // short
        bank.setStatus(1);

        dc.cut(user, address(pool));

        MockPool.Order memory o = pool.last();
        assertTrue(o.isBid, "buying to reduce a short");
        assertEq(o.quantity, 25e6);
    }

    /*//////////////////////////////////////////////////////////// policy */

    function test_healthyPositionIsLeftAlone() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(0); // Healthy

        dc.cut(user, address(pool));
        assertEq(pool.count(), 0, "nothing placed");
    }

    function test_triggerRungIsRespected() public {
        _arm(2_500, 2, 0, 5); // only from PartialLiquidation
        bank.setSize(user, address(pool), 100e6);

        bank.setStatus(1); // MarginCall - below the chosen rung
        dc.cut(user, address(pool));
        assertEq(pool.count(), 0, "margin call is not enough for this watch");

        bank.setStatus(2);
        dc.cut(user, address(pool));
        assertEq(pool.count(), 1, "fires at partial liquidation");
    }

    function test_flatAccountIsANoOp() public {
        _arm(2_500, 1, 0, 5);
        bank.setStatus(3);
        dc.cut(user, address(pool)); // size 0
        assertEq(pool.count(), 0);
    }

    function test_unknownAccountIsANoOp() public {
        bank.setStatus(3);
        dc.cut(makeAddr("stranger"), address(pool));
        assertEq(pool.count(), 0);
    }

    /// Quantity rounds DOWN onto the lot grid; a sub-lot order is rejected
    /// outright by the venue, so it must never be sent.
    function test_quantityRoundsDownOntoTheLot() public {
        _arm(3_333, 1, 0, 5);
        bank.setSize(user, address(pool), 10e6);
        bank.setStatus(1);

        dc.cut(user, address(pool));
        MockPool.Order memory o = pool.last();
        assertEq(o.quantity % LOT, 0, "on the lot grid");
        assertEq(o.quantity, 3e6, "33.33% of 10e6 floored to a whole lot");
    }

    function test_cutBelowOneLotIsSkipped() public {
        _arm(1, 1, 0, 5); // 0.01% of a small position
        bank.setSize(user, address(pool), 10e6);
        bank.setStatus(1);

        dc.cut(user, address(pool));
        assertEq(pool.count(), 0, "never send a sub-lot order");
    }

    /*//////////////////////////////////////////////////////////// bounds */

    function test_cutsAreABudgetNotAnAllowance() public {
        _arm(2_500, 1, 0, 2);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(2);

        dc.cut(user, address(pool));
        dc.cut(user, address(pool));
        dc.cut(user, address(pool)); // budget spent

        assertEq(pool.count(), 2, "exactly the cuts the user allowed");
    }

    function test_cooldownSpacesCuts() public {
        _arm(2_500, 1, 600, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        dc.cut(user, address(pool));
        dc.cut(user, address(pool));
        assertEq(pool.count(), 1, "second cut suppressed");

        vm.warp(block.timestamp + 601);
        dc.cut(user, address(pool));
        assertEq(pool.count(), 2, "fires again after cooling down");
    }

    /// Revoking the grant in dreamDEX's own registry is the real off switch,
    /// and it must work without anyone calling disarm here.
    function test_revokingTheGrantStopsCuts() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(2);

        reg.grant(address(pool), user, address(dc), dc.PLACE_ORDER_FOR(), false);

        dc.cut(user, address(pool));
        assertEq(pool.count(), 0, "no grant, no cut");
        (,,,,,,, uint16 cutsLeft,, bool armed) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 5, "and no budget consumed");
        assertTrue(armed, "the watch itself is untouched");
    }

    /// A failed order must not silently consume one of the user's cuts.
    function test_failedOrderRefundsTheCut() public {
        _arm(2_500, 1, 0, 3);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        pool.setRevert(true);

        dc.cut(user, address(pool));

        (,,,,,,, uint16 cutsLeft,,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 3, "budget returned after a failed order");
    }

    function test_disarmStopsEverything() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        vm.prank(user);
        dc.disarm(address(pool));

        bank.setStatus(3);
        dc.cut(user, address(pool));
        assertEq(pool.count(), 0);
    }

    /// Watches are per pool, so arming one pool must not arm another.
    function test_watchesDoNotLeakAcrossPools() public {
        MockPool other = new MockPool(bank);
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(other), 100e6);
        bank.setStatus(3);

        dc.cut(user, address(other));
        assertEq(other.count(), 0, "the other pool was never armed");
    }

    /// A cut starved of gas must say so, not blame the venue. Before this, the
    /// first live cut reported "status unreadable" for a perfectly readable
    /// position, because estimateGas priced the failure branch of the try/catch.
    function test_starvedOfGasItSaysSo() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        vm.expectEmit(true, true, false, true);
        emit Dreamcatcher.CutSkipped(user, address(pool), "insufficient gas to read status");
        dc.cut{gas: 400_000}(user, address(pool));

        assertEq(pool.count(), 0, "nothing placed");
        (,,,,,,, uint16 cutsLeft,,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 5, "and no budget consumed");
    }

    function test_withEnoughGasItProceeds() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        dc.cut{gas: 30_000_000}(user, address(pool));
        assertEq(pool.count(), 1, "the same call succeeds when funded");
    }

    /// Cuts spent must be answerable from chain state alone. Reading only
    /// `cutsLeft` made the UI guess from browser storage and report "none
    /// spent" for a watch that had already cut.
    function test_cutsSpentIsReadableFromTheChain() public {
        _arm(2_500, 1, 0, 4);
        assertEq(dc.cutsSpent(user, address(pool)), 0, "nothing spent yet");

        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        dc.cut(user, address(pool));

        assertEq(dc.cutsSpent(user, address(pool)), 1, "one real reduction");
        (,,,,,,, uint16 left, uint16 armedCuts,) = dc.watches(user, address(pool));
        assertEq(left, 3);
        assertEq(armedCuts, 4, "the total armed with survives on chain");
    }

    /// A zero-fill attempt is not a spent cut, and the chain says so.
    function test_cutsSpentIgnoresZeroFillAttempts() public {
        _arm(2_500, 1, 0, 4);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        pool.setFillBps(0);

        dc.cut(user, address(pool));
        assertEq(dc.cutsSpent(user, address(pool)), 0, "an attempt is not a cut");
    }

    /*//////////////////////////////////////////////////// fill accounting */

    /// Every order is IOC, from the contract's own constant. A resting order is
    /// what made non-increase unprovable, so the type is not the caller's to pick.
    function test_ordersAreAlwaysImmediateOrCancel() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        dc.cut(user, address(pool));
        assertEq(pool.last().orderType, dc.ORDER_TYPE_IOC(), "IOC, never a resting limit");
        assertEq(dc.ORDER_TYPE_IOC(), 2, "the venue's ImmediateOrCancel");
    }

    /// The budget is spent by the REDUCTION, not by the request.
    function test_partialFillRecordsWhatActuallyReduced() public {
        _arm(5_000, 1, 0, 5);           // ask for half of 100e6 = 50e6
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        pool.setFillBps(4_000);         // only 40% of the ask crosses = 20e6

        vm.recordLogs();
        dc.cut(user, address(pool));

        assertEq(bank.size(user, address(pool)), 80e6, "20e6 actually left the position");
        (,,,,,,, uint16 cutsLeft,,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 4, "a real reduction spends one cut");

        // The Cut event must carry the measured fill, not the request.
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < logs.length; ++i) {
            if (logs[i].topics[0] != keccak256("Cut(address,address,bool,uint256,uint256,uint256,uint8,uint16)")) continue;
            (, uint256 requested, uint256 filled,,,) =
                abi.decode(logs[i].data, (bool, uint256, uint256, uint256, uint8, uint16));
            assertEq(requested, 50e6, "asked for half");
            assertEq(filled, 20e6, "reduced by a fifth");
            found = true;
        }
        assertTrue(found, "a Cut event was emitted");
    }

    /// An empty book costs an attempt and the cooldown, never a cut.
    function test_zeroFillDoesNotSpendTheBudget() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        pool.setFillBps(0);

        dc.cut(user, address(pool));

        assertEq(pool.count(), 1, "the order was placed");
        assertEq(bank.size(user, address(pool)), 100e6, "and nothing moved");
        (,,,, uint16 attempts,,, uint16 cutsLeft,,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 5, "no cut spent on an empty book");
        assertEq(attempts, 1, "but the attempt is recorded");
    }

    /// Insufficient liquidity is the same shape as a partial fill, bounded by
    /// the position rather than by the book.
    function test_fillIsCappedByThePositionItself() public {
        _arm(10_000, 1, 0, 5);          // ask for the whole position
        bank.setSize(user, address(pool), 50e6);
        bank.setStatus(2);

        dc.cut(user, address(pool));
        assertEq(bank.size(user, address(pool)), 0, "flat, not reversed");
    }

    /*//////////////////////////////////////////////////// the invariant */

    /// If the venue ever left the account LARGER, the whole attempt unwinds.
    function test_anIncreaseIsUnwoundNotRecorded() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        pool.setForcedSizeAfter(150e6);  // the venue "fills" into a bigger position

        dc.cut(user, address(pool));

        assertEq(bank.size(user, address(pool)), 100e6, "rolled back to where it started");
        (,,,,,,, uint16 cutsLeft,,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 5, "and no cut was spent");
    }

    /// Same for an order that crossed through flat and opened the other way.
    function test_aFlipIsUnwoundNotRecorded() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        pool.setForcedSizeAfter(-10e6);

        dc.cut(user, address(pool));

        assertEq(bank.size(user, address(pool)), 100e6, "unwound");
        (,,,,,,, uint16 cutsLeft,,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 5);
    }

    /*//////////////////////////////////////////////// ordering and repeats */

    /// Two triggers in the same block: the cooldown admits one.
    function test_duplicateTriggerInOneBlockCutsOnce() public {
        _arm(2_500, 1, 60, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        dc.cut(user, address(pool));
        dc.cut(user, address(pool));
        assertEq(pool.count(), 1, "the second is refused by the cooldown");
    }

    /// A position that shrank between arming and firing is re-read, so the cut
    /// is sized against what is there NOW, not what was there then.
    function test_positionChangedBetweenArmAndCut() public {
        _arm(5_000, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        bank.setSize(user, address(pool), 40e6); // user closed some themselves
        dc.cut(user, address(pool));

        assertEq(pool.last().quantity, 20e6, "half of the live 40e6, not of the old 100e6");
    }

    /// A position that reversed direction must be cut the other way.
    function test_positionReversedBetweenArmAndCut() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        bank.setSize(user, address(pool), -80e6); // now short
        dc.cut(user, address(pool));

        assertTrue(pool.last().isBid, "buying to reduce a short");
        assertEq(bank.size(user, address(pool)), -60e6, "reduced toward flat, not past it");
    }

    /*//////////////////////////////////////////////////////// reactivity */

    /// The roster is what the reactive callback iterates: the pool hands us an
    /// emitter, never an account, so the list has to live in this contract.
    function test_armJoinsTheRosterAndDisarmLeavesIt() public {
        assertEq(dc.rosterLength(address(pool)), 0);
        _arm(2_500, 1, 0, 5);
        assertEq(dc.rosterLength(address(pool)), 1, "armed accounts are reachable from the pool");

        vm.prank(user);
        dc.disarm(address(pool));
        assertEq(dc.rosterLength(address(pool)), 0, "and leave when the web comes down");
    }

    /// Re-arming must not enrol the same account twice, or one callback would
    /// spend its whole budget checking one person repeatedly.
    function test_rearmingDoesNotDuplicateTheRosterEntry() public {
        _arm(2_500, 1, 0, 5);
        _arm(5_000, 2, 60, 3);
        assertEq(dc.rosterLength(address(pool)), 1);
    }

    /// Only the deployer may subscribe, and only with the gate funded.
    function test_subscribeIsOwnerOnlyAndNeedsTheBalance() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.NotOwner.selector);
        dc.subscribePool(address(pool), bytes32(0), 30_000_000, 1, 2);

        // This test contract deployed it, so it is the owner - but holds nothing.
        vm.expectRevert(abi.encodeWithSelector(Dreamcatcher.UnderFunded.selector, 0, 32 ether));
        dc.subscribePool(address(pool), bytes32(0), 30_000_000, 1, 2);
    }

    /*//////////////////////////////////////////////////////////// quote */

    function test_quoteMatchesWhatACutDoes() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        (bool would, bool isBid, uint256 qty,, string memory why) = dc.quote(user, address(pool));
        assertTrue(would, why);

        dc.cut(user, address(pool));
        MockPool.Order memory o = pool.last();
        assertEq(o.quantity, qty, "quote is the truth, not an estimate");
        assertEq(o.isBid, isBid);
    }

    function test_quoteNamesTheMissingGrant() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);
        reg.grant(address(pool), user, address(dc), dc.PLACE_ORDER_FOR(), false);

        (bool would,,,, string memory why) = dc.quote(user, address(pool));
        assertFalse(would);
        assertEq(why, "operator grant missing");
    }

    /*//////////////////////////////////////////////////////////// arming */

    function test_armRejectsAHealthyTrigger() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.TriggerOutOfRange.selector);
        dc.arm(address(pool), LIMIT, 2_500, LOT, 0, 0, 5);
    }

    function test_armRejectsAZeroLimitPrice() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.ZeroLimitPrice.selector);
        dc.arm(address(pool), 0, 2_500, LOT, 1, 0, 5);
    }

    function test_armRejectsAnOversizedReduction() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.ReduceOutOfRange.selector);
        dc.arm(address(pool), LIMIT, 10_001, LOT, 1, 0, 5);
    }
}
