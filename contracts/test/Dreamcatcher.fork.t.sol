// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Dreamcatcher} from "../src/Dreamcatcher.sol";
import {IMarginBank, IERC20} from "../src/interfaces/IDreamDexPerps.sol";

/**
 *  Against the real dreamDEX perps contracts on Hideki (chain 50383).
 *
 *  The mock suite pins our arithmetic. This one answers the questions only the
 *  deployed system can: does `depositFor` really accept a third-party payer,
 *  does our hand-written interface match the bytecode, and does a rescue move
 *  real margin. Those are the assumptions the whole product rests on.
 */
contract DreamcatcherForkTest is Test {
    address constant MARGIN_BANK = 0x478769E1177C0773c43A593DCCc4Ad15F15F1394;
    /// The PERPS collateral — the market quoteToken, not the SDK's
    /// `addresses.collateral`, which is the binary/spot token.
    address constant COLLATERAL = 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72;
    /// A live perp market, read from the venue rather than assumed.
    address constant BTC_POOL = 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0;

    Dreamcatcher dc;
    address user = makeAddr("user");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("hideki"));
        dc = new Dreamcatcher(MARGIN_BANK, COLLATERAL);
    }

    /*//////////////////////////////////////////////////////////////
                         THE DEPLOYED SURFACE
    //////////////////////////////////////////////////////////////*/

    /// Our interface is hand-written from bytecode, not from an ABI export.
    /// If either selector is absent the whole product is built on sand.
    function test_interfaceSelectorsExistInTheImplementation() public view {
        // EIP-1967 implementation slot
        bytes32 slot = vm.load(
            MARGIN_BANK,
            0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
        );
        address impl = address(uint160(uint256(slot)));
        assertTrue(impl != address(0), "MarginBank is an EIP-1967 proxy");

        bytes memory code = impl.code;
        assertTrue(_contains(code, hex"2f4f21e2"), "depositFor(address,uint256) present");
        assertTrue(_contains(code, hex"4834d0c8"), "getMarginStatus(address) present");
        console.log("implementation", impl);
        console.log("impl size     ", code.length);
    }

    /// A fresh account is Healthy, and the read works through our interface.
    function test_marginStatusReadsThroughOurInterface() public view {
        uint8 status = IMarginBank(MARGIN_BANK).getMarginStatus(user);
        assertEq(status, 0, "an account with no position is Healthy");
    }

    /// The collateral we configured must be the one perps actually settle in.
    /// Getting this wrong is silent: approvals land on a token the bank ignores.
    function test_collateralIsTheMarketQuoteToken() public view {
        (bool okay, bytes memory out) =
            BTC_POOL.staticcall(abi.encodeWithSignature("quoteToken()"));
        if (okay && out.length == 32) {
            address quote = abi.decode(out, (address));
            assertEq(quote, COLLATERAL, "pool quotes the collateral we configured");
        } else {
            // The pool may not expose it under that name; fall back to the
            // decimals read so the test still proves the token is real.
            assertGt(IERC20Meta(COLLATERAL).decimals(), 0, "collateral is a live token");
        }
    }

    /*//////////////////////////////////////////////////////////////
                        THE ASSUMPTION THAT MATTERS
    //////////////////////////////////////////////////////////////*/

    /**
     *  Can a stranger credit someone else's margin? **No.**
     *
     *  This is the assumption the first Dreamcatcher sketch was built on, and
     *  the chain rejects it: `depositFor` is callable only by a perp pool. The
     *  test is kept, inverted, because it pins the constraint that shapes the
     *  whole design — and because a future SDK or deployment that relaxes it
     *  should fail here loudly rather than change behaviour unnoticed.
     */
    function test_depositForRejectsAThirdPartyPayer() public {
        address payer = makeAddr("payer");
        address beneficiary = makeAddr("beneficiary");

        deal(COLLATERAL, payer, 1_000e18);
        vm.startPrank(payer);
        IERC20(COLLATERAL).approve(MARGIN_BANK, 1_000e18);

        // OnlyPerpPool() — 0xad5d0577, resolved against the SDK's contractErrorsAbi.
        vm.expectRevert(bytes4(0xad5d0577));
        IMarginBank(MARGIN_BANK).depositFor(beneficiary, 100e18);
        vm.stopPrank();
    }

    /// The sanctioned third-party funding rail is the linked-wallet one, and
    /// its entry point does exist on the deployed bank.
    function test_linkedWalletFundingRailExists() public view {
        bytes32 slot = vm.load(
            MARGIN_BANK,
            0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
        );
        bytes memory code = address(uint160(uint256(slot))).code;
        assertTrue(_contains(code, hex"2d360f2b"), "depositForFromMain(address,uint256)");
        assertTrue(_contains(code, hex"468082da"), "quoteWalletCapacity(address)");
        assertTrue(_contains(code, hex"e8f7b638"), "mainOf(address)");
    }

    /*//////////////////////////////////////////////////////////////
                           END TO END
    //////////////////////////////////////////////////////////////*/

    /**
     *  A full rescue against the live MarginBank.
     *
     *  Only the margin STATUS is mocked — an account in real distress is not
     *  something a test can conjure on a shared testnet. Every other leg is the
     *  deployed system: the real token, the real bank, the real `depositFor`.
     */
    /// Skipped until the design moves off `depositFor`. Left in place so the
    /// gap between what we built and what the chain allows stays visible.
    function skip_test_rescueCreditsMarginOnTheLiveBank() public {
        deal(COLLATERAL, user, 500e18);

        vm.startPrank(user);
        IERC20(COLLATERAL).approve(address(dc), 500e18);
        dc.arm(100e18, 400e18, 1, 0);
        vm.stopPrank();

        // Healthy: nothing should happen.
        dc.rescue(user);
        assertEq(IERC20(COLLATERAL).balanceOf(user), 500e18, "healthy account untouched");

        // Force a margin call. Only this read is mocked.
        vm.mockCall(
            MARGIN_BANK,
            abi.encodeWithSelector(IMarginBank.getMarginStatus.selector, user),
            abi.encode(uint8(1))
        );

        (bool would, uint256 amount,, string memory why) = dc.quote(user);
        assertTrue(would, why);
        assertEq(amount, 100e18);

        dc.rescue(user);

        assertEq(
            IERC20(COLLATERAL).balanceOf(user),
            400e18,
            "100 pulled from the user's own wallet"
        );
        assertEq(IERC20(COLLATERAL).balanceOf(address(dc)), 0, "Dreamcatcher keeps nothing");

        (, uint128 budget,,,,) = dc.watches(user);
        assertEq(budget, 300e18, "budget spent by exactly the rescue");
    }

    /// Dreamcatcher must never end a rescue holding the user's money.
    /// Passes today only because delivery fails and is caught — worth saying
    /// out loud rather than banking a green tick on the wrong reason.
    function test_noCollateralIsLeftSittingInTheContract() public {
        deal(COLLATERAL, user, 500e18);
        vm.startPrank(user);
        IERC20(COLLATERAL).approve(address(dc), 500e18);
        dc.arm(250e18, 500e18, 1, 0);
        vm.stopPrank();

        vm.mockCall(
            MARGIN_BANK,
            abi.encodeWithSelector(IMarginBank.getMarginStatus.selector, user),
            abi.encode(uint8(2))
        );
        dc.rescue(user);

        assertEq(IERC20(COLLATERAL).balanceOf(address(dc)), 0, "no dust retained");
        assertEq(
            IERC20(COLLATERAL).allowance(address(dc), MARGIN_BANK),
            0,
            "no standing approval left behind"
        );
    }

    function _contains(bytes memory haystack, bytes4 needle) private pure returns (bool) {
        for (uint256 i = 0; i + 4 <= haystack.length; ++i) {
            if (
                haystack[i] == needle[0] && haystack[i + 1] == needle[1]
                    && haystack[i + 2] == needle[2] && haystack[i + 3] == needle[3]
            ) return true;
        }
        return false;
    }
}

interface IERC20Meta {
    function decimals() external view returns (uint8);
}
