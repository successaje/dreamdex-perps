// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Dreamcatcher} from "../src/Dreamcatcher.sol";
import {IERC20} from "../src/interfaces/IDreamDexPerps.sol";

/// Minimal stand-ins. The fork tests against the real MarginBank come next;
/// these pin the policy arithmetic, which is where a quiet bug would live.
contract MockBank {
    uint8 public status;
    mapping(address => uint256) public credited;
    bool public revertOnDeposit;

    function setStatus(uint8 s) external { status = s; }
    function setRevert(bool r) external { revertOnDeposit = r; }
    function getMarginStatus(address) external view returns (uint8) { return status; }
    function depositFor(address account, uint256 amount) external {
        require(!revertOnDeposit, "bank down");
        credited[account] += amount;
    }
}

contract MockToken is IERC20 {
    mapping(address => uint256) public bal;
    mapping(address => mapping(address => uint256)) public allow;
    bool public returnFalse;

    function setReturnFalse(bool v) external { returnFalse = v; }
    function mint(address to, uint256 a) external { bal[to] += a; }
    function balanceOf(address o) external view returns (uint256) { return bal[o]; }
    function allowance(address o, address s) external view returns (uint256) { return allow[o][s]; }
    function approve(address s, uint256 a) external returns (bool) {
        if (returnFalse) return false;
        allow[msg.sender][s] = a;
        return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        if (returnFalse) return false;
        require(bal[f] >= a && allow[f][msg.sender] >= a, "insufficient");
        bal[f] -= a; bal[t] += a; allow[f][msg.sender] -= a;
        return true;
    }
}

contract DreamcatcherTest is Test {
    Dreamcatcher dc;
    MockBank bank;
    MockToken token;
    address user = makeAddr("user");

    function setUp() public {
        bank = new MockBank();
        token = new MockToken();
        dc = new Dreamcatcher(address(bank), address(token));

        token.mint(user, 1_000e18);
        vm.prank(user);
        token.approve(address(dc), 1_000e18);
    }

    function _arm(uint128 per, uint128 budget, uint8 trigger, uint32 cd) internal {
        vm.prank(user);
        dc.arm(per, budget, trigger, cd);
    }

    /*//////////////////////////////////////////////////////////// policy */

    function test_armStoresThePolicy() public {
        _arm(100e18, 400e18, 1, 60);
        (uint128 per, uint128 budget, uint8 trigger, uint32 cd,, bool armed) = dc.watches(user);
        assertEq(per, 100e18);
        assertEq(budget, 400e18);
        assertEq(trigger, 1);
        assertEq(cd, 60);
        assertTrue(armed);
    }

    /// A watch that fires while healthy would drain a budget for nothing.
    function test_armRejectsHealthyTrigger() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.TriggerOutOfRange.selector);
        dc.arm(100e18, 400e18, 0, 60);
    }

    function test_armRejectsBudgetBelowPerRescue() public {
        vm.prank(user);
        vm.expectRevert(Dreamcatcher.BudgetBelowPerRescue.selector);
        dc.arm(100e18, 50e18, 1, 60);
    }

    /*//////////////////////////////////////////////////////////// rescue */

    function test_healthyAccountIsSkippedNotReverted() public {
        _arm(100e18, 400e18, 1, 60);
        bank.setStatus(0); // Healthy
        dc.rescue(user);   // must not revert
        assertEq(bank.credited(user), 0);
        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 400e18, "nothing spent");
    }

    /// An account nobody armed must cost a caller almost nothing and never throw.
    function test_unknownAccountIsANoOp() public {
        bank.setStatus(3);
        dc.rescue(makeAddr("stranger"));
    }

    function test_rescueCreditsMarginAndSpendsBudget() public {
        _arm(100e18, 400e18, 1, 60);
        bank.setStatus(1); // MarginCall

        dc.rescue(user);

        assertEq(bank.credited(user), 100e18, "margin credited");
        assertEq(token.balanceOf(user), 900e18, "pulled from the user's own wallet");
        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 300e18, "budget spent by exactly the rescue");
    }

    function test_cooldownBlocksASecondRescue() public {
        _arm(100e18, 400e18, 1, 600);
        bank.setStatus(1);

        dc.rescue(user);
        dc.rescue(user); // inside cooldown
        assertEq(bank.credited(user), 100e18, "second rescue suppressed");

        vm.warp(block.timestamp + 601);
        dc.rescue(user);
        assertEq(bank.credited(user), 200e18, "fires again after cooldown");
    }

    /// The budget is the hard ceiling, however bad things get.
    function test_budgetIsExhaustedNotExceeded() public {
        _arm(100e18, 250e18, 1, 0);
        bank.setStatus(2);

        dc.rescue(user);
        dc.rescue(user);
        dc.rescue(user); // only 50 left
        dc.rescue(user); // nothing left

        assertEq(bank.credited(user), 250e18, "never more than the budget");
        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 0);
    }

    /// Revoking the allowance is the user's off switch and must be honoured
    /// without anyone needing to call disarm.
    function test_revokedAllowanceStopsRescues() public {
        _arm(100e18, 400e18, 1, 0);
        bank.setStatus(1);

        vm.prank(user);
        token.approve(address(dc), 0);

        dc.rescue(user);
        assertEq(bank.credited(user), 0, "no allowance, no rescue");
        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 400e18, "and no budget consumed");
    }

    /// A failed delivery must not quietly consume budget.
    function test_failedDeliveryRefundsTheBudget() public {
        _arm(100e18, 400e18, 1, 0);
        bank.setStatus(1);
        bank.setRevert(true);

        dc.rescue(user);

        assertEq(bank.credited(user), 0);
        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 400e18, "budget returned after a failed delivery");
    }

    /// A token that returns false rather than reverting must not be read as success.
    function test_tokenReturningFalseIsTreatedAsFailure() public {
        _arm(100e18, 400e18, 1, 0);
        bank.setStatus(1);
        token.setReturnFalse(true);

        dc.rescue(user);

        assertEq(bank.credited(user), 0);
        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 400e18, "budget not spent on a silent token failure");
    }

    function test_disarmStopsEverything() public {
        _arm(100e18, 400e18, 1, 0);
        vm.prank(user);
        dc.disarm();
        bank.setStatus(3);
        dc.rescue(user);
        assertEq(bank.credited(user), 0);
    }

    /*//////////////////////////////////////////////////////////// quote */

    function test_quoteExplainsWhyItWouldNotFire() public {
        _arm(100e18, 400e18, 2, 0);
        bank.setStatus(1); // below the chosen trigger
        (bool would,, uint8 status, string memory why) = dc.quote(user);
        assertFalse(would);
        assertEq(status, 1);
        assertEq(why, "above trigger");
    }

    function test_quoteMatchesWhatARescueSpends() public {
        _arm(100e18, 400e18, 1, 0);
        bank.setStatus(1);
        (bool would, uint256 amount,,) = dc.quote(user);
        assertTrue(would);
        dc.rescue(user);
        assertEq(bank.credited(user), amount, "quote is the truth, not an estimate");
    }
}
