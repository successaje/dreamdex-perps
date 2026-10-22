// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/**
 *  The slice of dreamDEX's perps surface Dreamcatcher needs.
 *
 *  Both selectors were confirmed present in the deployed MarginBank
 *  implementation (0x78c989c9…1d5c behind the 0x478769E1…1394 proxy) by reading
 *  its bytecode, not by trusting an ABI export — an SDK write-ABI we checked
 *  first lists only five functions and omits `depositFor` entirely.
 *
 *    depositFor(address,uint256)  0x2f4f21e2
 *    getMarginStatus(address)     0x4834d0c8
 */
interface IMarginBank {
    /// Credit `account`'s margin from the CALLER's collateral.
    /// This one function is why Dreamcatcher can be non-custodial: the rescuer
    /// pays, and the protected account keeps its own position throughout.
    function depositFor(address account, uint256 amount) external;

    /// 0 Healthy · 1 MarginCall · 2 PartialLiquidation · 3 CloseOut
    function getMarginStatus(address account) external view returns (uint8);
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
}
