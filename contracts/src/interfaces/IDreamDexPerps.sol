// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 *  The slice of dreamDEX's perps surface Dreamcatcher needs.
 *
 *  Every selector below was confirmed present in deployed bytecode rather than
 *  taken from an ABI export. That habit is not pedantry: the first version of
 *  this contract was built on `depositFor`, which an SDK write-ABI omits and
 *  which the chain rejects for any caller that is not a perp pool.
 */
interface IMarginBank {
    /// 0 Healthy · 1 MarginCall · 2 PartialLiquidation · 3 CloseOut
    /// getMarginStatus(address) — 0x4834d0c8
    function getMarginStatus(address account) external view returns (uint8);

    /**
     *  getPosition(address,address) — 0xb33dc190
     *
     *  Returns four words. Only the first is relied on here: the SIGNED size in
     *  raw base units, positive long, negative short, zero flat. The remaining
     *  words carry entry price and funding bookkeeping this contract does not
     *  need, and naming them would be asserting a layout nothing has verified.
     */
    function getPosition(address account, address pool)
        external
        view
        returns (int256 size, uint256 avgEntryPrice, int256 realizedPnl, int256 entryFundingIndex);
}

interface IPerpPool {
    /**
     *  placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)
     *  — 0x80054449
     *
     *  Places an order on `account`'s behalf. The pool checks the caller against
     *  the OperatorPermissionsRegistry for this pool and this selector: without
     *  a grant it reverts `OnlyApprovedContracts()` (0x3fb0ba2e), with one it
     *  proceeds to the economics.
     */
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

interface IOperatorRegistry {
    /// isApprovedForPool(address,address,address,bytes4) — 0x03684f95
    function isApprovedForPool(address pool, address owner, address operator, bytes4 selector)
        external
        view
        returns (bool);
}
