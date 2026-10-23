// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
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

contract MockPool {
    struct Order { address account; bool isBid; uint256 price; uint256 quantity; }
    Order[] public orders;
    bool public revertOnPlace;

    function setRevert(bool v) external { revertOnPlace = v; }
    function count() external view returns (uint256) { return orders.length; }
    function placeOrderFor(
        address account, bool isBid, uint64, uint256 price, uint256 quantity,
        uint64, uint8, uint8, address, uint96
    ) external {
        require(!revertOnPlace, "pool down");
        orders.push(Order(account, isBid, price, quantity));
    }
    function last() external view returns (Order memory) { return orders[orders.length - 1]; }
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
        pool = new MockPool();
        reg = new MockRegistry();
        dc = new Dreamcatcher(address(bank), address(reg));
        reg.grant(address(pool), user, address(dc), dc.PLACE_ORDER_FOR(), true);
    }

    function _arm(uint16 reduceBps, uint8 trigger, uint32 cd, uint16 cuts) internal {
        vm.prank(user);
        dc.arm(address(pool), LIMIT, reduceBps, LOT, trigger, 0, cd, cuts);
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
        (,,,,,,, uint16 cutsLeft, bool armed) = dc.watches(user, address(pool));
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

        (,,,,,,, uint16 cutsLeft,) = dc.watches(user, address(pool));
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
        MockPool other = new MockPool();
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
        (,,,,,,, uint16 cutsLeft,) = dc.watches(user, address(pool));
        assertEq(cutsLeft, 5, "and no budget consumed");
    }

    function test_withEnoughGasItProceeds() public {
        _arm(2_500, 1, 0, 5);
        bank.setSize(user, address(pool), 100e6);
        bank.setStatus(1);

        dc.cut{gas: 30_000_000}(user, address(pool));
        assertEq(pool.count(), 1, "the same call succeeds when funded");
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
        dc.arm(address(pool), LIMIT, 2_500, LOT, 0, 0, 0, 5);
    }

    function test_armRejectsAZeroLimitPrice() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.ZeroLimitPrice.selector);
        dc.arm(address(pool), 0, 2_500, LOT, 1, 0, 0, 5);
    }

    function test_armRejectsAnOversizedReduction() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.ReduceOutOfRange.selector);
        dc.arm(address(pool), LIMIT, 10_001, LOT, 1, 0, 0, 5);
    }
}
