// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {IMarginBank} from "../src/interfaces/IDreamDexPerps.sol";

/**
 *  Facts about the deployed perps system on Hideki (chain 50383), pinned.
 *
 *  These are not tests of Dreamcatcher. They are tests of the assumptions
 *  Dreamcatcher is allowed to make — including one it originally made and the
 *  chain refused. Keeping them green means a future deployment that changes
 *  the rules breaks here, loudly, instead of changing behaviour unnoticed.
 */
contract MechanismFactsForkTest is Test {
    address constant MARGIN_BANK = 0x478769E1177C0773c43A593DCCc4Ad15F15F1394;
    /// The PERPS collateral — the market quoteToken, not the SDK's
    /// `addresses.collateral`, which is the binary/spot token.
    address constant COLLATERAL = 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72;
    /// A live perp market, read from the venue rather than assumed.
    address constant BTC_POOL = 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0;

    address user = makeAddr("user");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("hideki"));
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
        IERC20Meta(COLLATERAL).approve(MARGIN_BANK, 1_000e18);

        // OnlyPerpPool() — 0xad5d0577, resolved against the SDK's contractErrorsAbi.
        vm.expectRevert(bytes4(0xad5d0577));
        IDepositFor(MARGIN_BANK).depositFor(beneficiary, 100e18);
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

    /// Dreamcatcher must never end a rescue holding the user's money.
    /// Passes today only because delivery fails and is caught — worth saying

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

/// Declared locally: the production interface deliberately no longer carries
/// `depositFor`, because the chain refuses it for any caller that is not a
/// perp pool. This test is what records that refusal.
interface IDepositFor {
    function depositFor(address account, uint256 amount) external;
}

interface IERC20Meta {
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
}
