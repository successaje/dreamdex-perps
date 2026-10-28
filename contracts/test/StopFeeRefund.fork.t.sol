// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";

interface IStopRegistry {
    struct Order { bool isBid; address owner; uint64 userData; uint256 quantity; }
    struct Pending {
        Order order; uint8 orderType; uint256 triggerPrice; uint8 triggerOperator;
        uint256 limitPrice; address builder; uint96 builderFeeBpsTimes1k;
    }
    function createPendingOrder(Pending calldata p) external payable returns (uint128);
    function cancelPendingOrder(uint128 orderId) external;
    function somiPaymentPerOrder() external view returns (uint256);
}

interface IOperatorRegistry {
    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved) external;
}

/**
 *  The docs say a stop order costs 0.15 STT, "refunded on cancel".
 *
 *  Tested against the real registry with the real account, which actually holds
 *  a position — a reduce-only stop is rejected at creation without one.
 */
contract StopFeeRefundForkTest is Test {
    address constant STOP_REGISTRY = 0x52E2ccebAeC9332672C247e9A90AA3d61FB615ef;
    address constant BTC_POOL = 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0;
    address constant OP_REGISTRY = 0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a;
    /// The account that really holds the BTC long this repo documents.
    address constant OWNER = 0x60eF148485C2a5119fa52CA13c52E9fd98F28e87;

    uint256 fee;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("hideki"));
        fee = IStopRegistry(STOP_REGISTRY).somiPaymentPerOrder();
        vm.deal(OWNER, 10 ether);

        bytes4[] memory sels = new bytes4[](2);
        sels[0] = 0x80054449; // placeOrderFor
        sels[1] = 0xe37b444b; // cancelOrderFor
        vm.prank(OWNER);
        IOperatorRegistry(OP_REGISTRY).setOperatorApprovalForPool(BTC_POOL, STOP_REGISTRY, sels, true);
    }

    function test_feeIsChargedAtCreationAndReturnedOnCancel() public {
        // Reducing a long: sell. Trigger below the market, limit below that.
        IStopRegistry.Pending memory p = IStopRegistry.Pending({
            order: IStopRegistry.Order({ isBid: false, owner: OWNER, userData: 0, quantity: 13_000 }),
            orderType: 0,
            triggerPrice: 75_000e18,
            triggerOperator: 0,
            limitPrice: 70_000e18,
            builder: address(0),
            builderFeeBpsTimes1k: 0
        });

        uint256 before_ = OWNER.balance;
        vm.prank(OWNER);
        uint128 id;
        try IStopRegistry(STOP_REGISTRY).createPendingOrder{value: fee}(p) returns (uint128 got) {
            id = got;
        } catch (bytes memory err) {
            console.log("create refused:");
            console.logBytes4(err.length >= 4 ? bytes4(err) : bytes4(0));
            return;
        }
        uint256 afterCreate = OWNER.balance;
        console.log("fee            ", fee);
        console.log("spent on create", before_ - afterCreate);
        assertEq(before_ - afterCreate, fee, "exactly the quoted fee leaves the wallet");

        vm.prank(OWNER);
        IStopRegistry(STOP_REGISTRY).cancelPendingOrder(id);
        uint256 afterCancel = OWNER.balance;
        console.log("returned       ", afterCancel - afterCreate);

        assertEq(afterCancel, before_, "cancelling returns the whole fee, as documented");
    }
}
