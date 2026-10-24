import { parseAbi } from "viem";

/**
 *  Hand-written, but every selector was read out of deployed bytecode rather
 *  than copied from an export. `npm run check:abi` in the repo root compares
 *  these against the compiled artifacts: a struct field of the wrong integer
 *  width changes the selector and reverts with empty data, which looks exactly
 *  like a failing token and is nothing of the sort.
 */
export const marginBankAbi = parseAbi([
  "function getMarginStatus(address account) view returns (uint8)",
  "function getPosition(address account, address pool) view returns (int256 size, uint256 avgEntryPrice, int256 realizedPnl, int256 entryFundingIndex)",
]);

export const operatorRegistryAbi = parseAbi([
  "function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)",
  "function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)",
]);

export const dreamcatcherAbi = parseAbi([
  "function arm(address pool, uint256 limitPrice, uint16 reduceBps, uint128 lotSize, uint8 triggerStatus, uint32 cooldown, uint16 cuts)",
  "function disarm(address pool)",
  "function cut(address account, address pool)",
  "function watches(address account, address pool) view returns (uint256 limitPrice, uint16 reduceBps, uint128 lotSize, uint8 triggerStatus, uint16 attempts, uint32 cooldown, uint64 lastCutAt, uint16 cutsLeft, uint16 armedCuts, bool armed)",
  "function cutsSpent(address account, address pool) view returns (uint16)",
  "function quote(address account, address pool) view returns (bool wouldCut, bool isBid, uint256 quantity, uint8 status, string blockedBy)",
  "function PLACE_ORDER_FOR() view returns (bytes4)",
  "event Armed(address indexed account, address indexed pool, uint256 limitPrice, uint16 reduceBps, uint8 triggerStatus, uint16 cuts)",
  "event Cut(address indexed account, address indexed pool, bool isBid, uint256 requested, uint256 filled, uint256 limitPrice, uint8 statusBefore, uint16 cutsLeft)",
  "event CutNoFill(address indexed account, address indexed pool, uint256 requested, uint16 attempts)",
  "event CutSkipped(address indexed account, address indexed pool, string reason)",
  "event CutFailed(address indexed account, address indexed pool, bytes4 selector)",
  "event Disarmed(address indexed account, address indexed pool, uint16 cutsLeft)",
]);

/** The one power a user ever grants: placeOrderFor(address,...) */
export const PLACE_ORDER_FOR = "0x80054449" as const;
