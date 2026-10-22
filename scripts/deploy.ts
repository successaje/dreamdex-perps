/**
 *  Deploy Dreamcatcher to Hideki, sized by the NODE's gas estimate.
 *
 *  `forge script` cannot be trusted for this on Somnia. It estimates in
 *  Foundry's local EVM, which does not know that Somnia prices code deposit
 *  at roughly 5,000 gas per byte instead of 200 — on the sibling project it
 *  sent a limit about 17x short, burned all of it and deployed nothing, twice.
 *  `--gas-limit` does not help either: on `forge script` that flag configures
 *  the simulation EVM, not the broadcast transaction.
 *
 *    npx tsx --env-file=.env scripts/deploy.ts          # deploy
 *    npx tsx scripts/deploy.ts --dry                    # estimate only, no key
 */
import { readFile } from "node:fs/promises";
import {
  createPublicClient, createWalletClient, encodeDeployData, formatEther, http,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hideki, PERPS } from "../src/config.js";

const OPERATOR_REGISTRY = PERPS.operatorPermissionsRegistry as Address;
const MARGIN_BANK = PERPS.marginBank as Address;

/** Head-room over the node's estimate. Unused gas is refunded, so it is free. */
const CUSHION = 150n; // percent

const dry = process.argv.includes("--dry");
const artifact = JSON.parse(
  await readFile(new URL("../contracts/out/Dreamcatcher.sol/Dreamcatcher.json", import.meta.url), "utf8"),
);

const data = encodeDeployData({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object as Hex,
  args: [MARGIN_BANK, OPERATOR_REGISTRY],
});

const publicClient = createPublicClient({ chain: hideki, transport: http() });

const privateKey = process.env.PRIVATE_KEY as Hex | undefined;
if (!dry && !privateKey) {
  console.error("PRIVATE_KEY must be in the environment (use --env-file=.env), or pass --dry.");
  process.exit(1);
}
const account = privateKey ? privateKeyToAccount(privateKey) : undefined;
const from = account?.address ?? ("0x000000000000000000000000000000000000dEaD" as Address);

const estimate = await publicClient.estimateGas({ account: from, data });
const gas = (estimate * CUSHION) / 100n;
const fees = await publicClient.estimateFeesPerGas();
const maxFee = fees.maxFeePerGas ?? 12_000_000_000n;

console.log(`\nmarginBank       ${MARGIN_BANK}`);
console.log(`operatorRegistry ${OPERATOR_REGISTRY}`);
console.log(`runtime code     ${(artifact.deployedBytecode.object.length - 2) / 2} bytes`);
console.log(`node estimate    ${estimate.toLocaleString()} gas`);
console.log(`sending with     ${gas.toLocaleString()} gas (${CUSHION}%)`);
console.log(`likely cost      ${formatEther(estimate * maxFee)} STT`);
console.log(`worst case       ${formatEther(gas * maxFee)} STT`);

if (dry || !account) {
  console.log("\n--dry: nothing sent.\n");
  process.exit(0);
}

const balance = await publicClient.getBalance({ address: account.address });
console.log(`\ndeployer         ${account.address}  ${formatEther(balance)} STT`);
if (balance < gas * maxFee) {
  console.error("Not enough STT for the worst case. Top the deployer up first.");
  process.exit(1);
}

const hash = await createWalletClient({ account, chain: hideki, transport: http() }).deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object as Hex,
  args: [MARGIN_BANK, OPERATOR_REGISTRY],
  gas,
});
console.log(`\ntx ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log(`status ${receipt.status}  gasUsed ${receipt.gasUsed.toLocaleString()} / ${gas.toLocaleString()}`);

const address = receipt.contractAddress;
if (receipt.status !== "success" || !address) {
  console.error("\nDeploy FAILED. Nothing was deployed.");
  process.exit(1);
}

// A success status is not proof: an out-of-gas code deposit is exactly what
// bit the sibling project, so confirm there are bytes at the address.
const code = await publicClient.getCode({ address });
if (!code || code === "0x") {
  console.error(`\nNo code at ${address} despite a success status.`);
  process.exit(1);
}

console.log(`\nDreamcatcher   ${address}  (${(code.length - 2) / 2} bytes)`);
console.log(`explorer       ${hideki.blockExplorers.default.url}/address/${address}`);
console.log(`\nWire the app:  echo "VITE_DREAMCATCHER=${address}" >> web/.env\n`);
