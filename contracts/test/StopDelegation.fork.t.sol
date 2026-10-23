// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";

interface IStopRegistry {
    struct Order { bool isBid; address owner; uint64 userData; uint256 quantity; }

    /// ONE wrapping tuple, not seven arguments. The ABI reads
    /// `createPendingOrder(((bool,address,uint64,uint256),uint8,uint256,uint8,uint256,address,uint96))`
    /// — the outer parentheses are the whole struct, and splitting them out
    /// produces a different selector that lands on the fallback and reverts
    /// with no data at all.
    struct Pending {
        Order order;
        uint8 orderType;
        uint256 triggerPrice;
        uint8 triggerOperator;
        uint256 limitPrice;
        address builder;
        uint96 builderFeeBpsTimes1k;
    }

    function createPendingOrder(Pending calldata p) external payable returns (uint128);
    function cancelPendingOrder(uint128 orderId) external;
    function somiPaymentPerOrder() external view returns (uint256);
    function marginBank() external view returns (address);
}

interface IOperatorRegistry {
    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved) external;
    function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) external view returns (bool);
}

/// A stand-in for Dreamcatcher: a CONTRACT that is not the owner, which is the
/// only arrangement that proves delegation rather than impersonation.
contract Delegate {
    function create(address reg, IStopRegistry.Order calldata o, uint256 trigger, uint256 limit, uint256 fee)
        external payable returns (uint128)
    {
        return IStopRegistry(reg).createPendingOrder{value: fee}(
            IStopRegistry.Pending({
                order: o, orderType: 0, triggerPrice: trigger, triggerOperator: 0,
                limitPrice: limit, builder: address(0), builderFeeBpsTimes1k: 0
            })
        );
    }
    function cancel(address reg, uint128 id) external { IStopRegistry(reg).cancelPendingOrder(id); }
    receive() external payable {}
}

/**
 *  Can a delegate create and cancel a stop ON BEHALF OF an owner?
 *
 *  Everything about moving Dreamcatcher onto the stop path depends on yes. The
 *  tuple carries an explicit `owner`, which is suggestive but not proof — a
 *  registry may still require `msg.sender == owner`, in which case the field is
 *  only bookkeeping and the whole approach collapses.
 */
contract StopDelegationForkTest is Test {
    address constant STOP_REGISTRY = 0x52E2ccebAeC9332672C247e9A90AA3d61FB615ef; // BTC
    address constant BTC_POOL = 0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0;
    address constant OP_REGISTRY = 0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a;
    bytes4 constant CREATE_PENDING_ORDER = 0x9a03efbf;

    Delegate delegate;
    address owner = makeAddr("owner");
    uint256 fee;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("hideki"));
        delegate = new Delegate();
        fee = IStopRegistry(STOP_REGISTRY).somiPaymentPerOrder();
        vm.deal(address(delegate), 10 ether);
        vm.deal(owner, 10 ether);
        console.log("stop fee (wei)", fee);
        console.log("registry marginBank", IStopRegistry(STOP_REGISTRY).marginBank());
    }

    /// The registry places orders on the owner's behalf, so the OWNER must
    /// first approve the REGISTRY as an operator on the pool. Without this
    /// every call reverts `RegistryNotApprovedByOwner()` (0x28e0a7ba),
    /// including the owner's own — which is what made the first run look like
    /// a delegation failure when it was a missing prerequisite.
    function _approveRegistry(address who) internal {
        bytes4[] memory sels = new bytes4[](2);
        sels[0] = 0x80054449; // placeOrderFor
        sels[1] = 0xe37b444b; // cancelOrderFor
        vm.prank(who);
        IOperatorRegistry(OP_REGISTRY).setOperatorApprovalForPool(BTC_POOL, STOP_REGISTRY, sels, true);
    }

    function _order() internal view returns (IStopRegistry.Order memory) {
        // Reducing a long: sell. Owner is the protected account, not the caller.
        return IStopRegistry.Order({ isBid: false, owner: owner, userData: 0, quantity: 13_000 });
    }

    /**
     *  The owner acting for themselves gets PAST ownership validation and
     *  fails only on `NoReducingPositionAtCreation()` — this test account holds
     *  no position. That is a correct rejection, and it proves two things: the
     *  owner path works, and the venue enforces **reduce-only at creation**.
     */
    function test_ownerPassesOwnershipAndIsCheckedForReduceOnly() public {
        _approveRegistry(owner);
        vm.prank(owner);
        vm.expectRevert(bytes4(0xd156c90a)); // NoReducingPositionAtCreation()
        IStopRegistry(STOP_REGISTRY).createPendingOrder{value: fee}(
            IStopRegistry.Pending({
                order: _order(), orderType: 0, triggerPrice: 70_000e18, triggerOperator: 0,
                limitPrice: 69_000e18, builder: address(0), builderFeeBpsTimes1k: 0
            })
        );
    }

    /**
     *  The decisive one: a delegate cannot create a stop for someone else, and
     *  an operator grant does not change that.
     *
     *  Both the granted and ungranted delegate are refused with
     *  `InvalidOrderOwner()`, a different error from the owner's. The registry
     *  requires `order.owner == msg.sender`; the `owner` field is bookkeeping
     *  for the registry's own calls into the pool, not a delegation mechanism.
     *
     *  Dreamcatcher therefore CANNOT move execution onto the stop path.
     */
    function test_delegateCannotCreateForAnotherOwnerEvenWithAGrant() public {
        _approveRegistry(owner);

        vm.expectRevert(bytes4(0xc32ff34d)); // InvalidOrderOwner()
        delegate.create{value: fee}(STOP_REGISTRY, _order(), 70_000e18, 69_000e18, fee);

        bytes4[] memory sels = new bytes4[](1);
        sels[0] = CREATE_PENDING_ORDER;
        vm.prank(owner);
        IOperatorRegistry(OP_REGISTRY).setOperatorApprovalForPool(BTC_POOL, address(delegate), sels, true);
        assertTrue(
            IOperatorRegistry(OP_REGISTRY).isApprovedForPool(BTC_POOL, owner, address(delegate), CREATE_PENDING_ORDER),
            "the grant is recorded, so this is not a missing-grant result"
        );

        // Identical refusal with the grant in place.
        vm.expectRevert(bytes4(0xc32ff34d));
        delegate.create{value: fee}(STOP_REGISTRY, _order(), 70_000e18, 69_000e18, fee);
    }

    /// The registry must itself be approved by the owner before anything works,
    /// which is a second prerequisite the product would have to carry.
    function test_registryNeedsTheOwnersApprovalFirst() public {
        vm.prank(owner);
        vm.expectRevert(bytes4(0x28e0a7ba)); // RegistryNotApprovedByOwner()
        IStopRegistry(STOP_REGISTRY).createPendingOrder{value: fee}(
            IStopRegistry.Pending({
                order: _order(), orderType: 0, triggerPrice: 70_000e18, triggerOperator: 0,
                limitPrice: 69_000e18, builder: address(0), builderFeeBpsTimes1k: 0
            })
        );
    }

    /// 0.15 STT per stop, which a delegated design would have had to fund.
    function test_stopFeeIsWhatTheDocsSay() public view {
        assertEq(fee, 0.15 ether);
    }
}
