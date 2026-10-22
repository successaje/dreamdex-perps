// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";

interface IOperatorRegistry {
    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved) external;
    function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) external view returns (bool);
}

interface IPerpPool {
    function placeOrderFor(
        address account,
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFee
    ) external;
}

/**
 *  Can a user delegate order placement, and can the delegate act for them?
 *
 *  This is the mechanism the redesigned Dreamcatcher stands on, and the last
 *  assumption of this shape — that `depositFor` accepted a third-party payer —
 *  was wrong. So it gets tested against the deployed contracts before anything
 *  is built on it.
 */
contract OperatorPathForkTest is Test {
    address constant REGISTRY = 0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a;
    address constant BTC_POOL = 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0;
    /// placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)
    bytes4 constant PLACE_ORDER_FOR = 0x80054449;

    address user = makeAddr("user");
    address dreamcatcher = makeAddr("dreamcatcher");

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("hideki"));
    }

    /// The registry records a per-pool, per-selector grant from the owner.
    function test_userCanApproveAnOperatorForOnePoolAndSelector() public {
        assertFalse(
            IOperatorRegistry(REGISTRY).isApprovedForPool(BTC_POOL, user, dreamcatcher, PLACE_ORDER_FOR),
            "nothing granted yet"
        );

        bytes4[] memory sels = new bytes4[](1);
        sels[0] = PLACE_ORDER_FOR;

        vm.prank(user);
        IOperatorRegistry(REGISTRY).setOperatorApprovalForPool(BTC_POOL, dreamcatcher, sels, true);

        assertTrue(
            IOperatorRegistry(REGISTRY).isApprovedForPool(BTC_POOL, user, dreamcatcher, PLACE_ORDER_FOR),
            "grant recorded for this pool and selector"
        );
    }

    /// The grant is scoped. A different selector is not covered by it.
    function test_approvalDoesNotLeakToOtherSelectors() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = PLACE_ORDER_FOR;
        vm.prank(user);
        IOperatorRegistry(REGISTRY).setOperatorApprovalForPool(BTC_POOL, dreamcatcher, sels, true);

        assertFalse(
            IOperatorRegistry(REGISTRY).isApprovedForPool(BTC_POOL, user, dreamcatcher, 0xe37b444b),
            "cancelOrderFor was never granted"
        );
    }

    /// Revocation is the user's off switch and must take effect immediately.
    function test_approvalCanBeRevoked() public {
        bytes4[] memory sels = new bytes4[](1);
        sels[0] = PLACE_ORDER_FOR;

        vm.startPrank(user);
        IOperatorRegistry(REGISTRY).setOperatorApprovalForPool(BTC_POOL, dreamcatcher, sels, true);
        assertTrue(IOperatorRegistry(REGISTRY).isApprovedForPool(BTC_POOL, user, dreamcatcher, PLACE_ORDER_FOR));
        IOperatorRegistry(REGISTRY).setOperatorApprovalForPool(BTC_POOL, dreamcatcher, sels, false);
        vm.stopPrank();

        assertFalse(
            IOperatorRegistry(REGISTRY).isApprovedForPool(BTC_POOL, user, dreamcatcher, PLACE_ORDER_FOR),
            "revoked"
        );
    }

    /**
     *  The decisive one: does the POOL honour the grant?
     *
     *  Neither call can fill — the user has no margin — so both revert. What
     *  matters is that they revert for DIFFERENT reasons: an unapproved
     *  operator should be refused on permission, an approved one should get
     *  past permission and fail on economics.
     */
    function test_poolDistinguishesApprovedFromUnapproved() public {
        bytes memory call = abi.encodeWithSelector(
            PLACE_ORDER_FOR,
            user, false, uint64(0), uint256(100_000e18), uint256(1e6),
            uint64(block.timestamp + 300) * 1e9, uint8(0), uint8(0), address(0), uint96(0)
        );

        vm.prank(dreamcatcher);
        (bool okayBefore, bytes memory errBefore) = BTC_POOL.call(call);

        bytes4[] memory sels = new bytes4[](1);
        sels[0] = PLACE_ORDER_FOR;
        vm.prank(user);
        IOperatorRegistry(REGISTRY).setOperatorApprovalForPool(BTC_POOL, dreamcatcher, sels, true);

        vm.prank(dreamcatcher);
        (bool okayAfter, bytes memory errAfter) = BTC_POOL.call(call);

        console.log("unapproved succeeded:", okayBefore);
        console.logBytes4(errBefore.length >= 4 ? bytes4(errBefore) : bytes4(0));
        console.log("approved succeeded:  ", okayAfter);
        console.logBytes4(errAfter.length >= 4 ? bytes4(errAfter) : bytes4(0));

        assertFalse(okayBefore, "an unapproved operator must not place for another account");
        assertFalse(okayAfter, "the user has no margin, so neither call can fill");

        bytes4 before_ = errBefore.length >= 4 ? bytes4(errBefore) : bytes4(0);
        bytes4 after_ = errAfter.length >= 4 ? bytes4(errAfter) : bytes4(0);

        // Both resolved against the SDK's contractErrorsAbi. The pair is the
        // whole result: refused on PERMISSION without the grant, refused on
        // ECONOMICS with it. The grant is honoured by the pool.
        assertEq(before_, bytes4(0x3fb0ba2e), "unapproved -> OnlyApprovedContracts()");
        assertEq(after_, bytes4(0x3a23d825), "approved -> InsufficientCollateral()");
    }
}
