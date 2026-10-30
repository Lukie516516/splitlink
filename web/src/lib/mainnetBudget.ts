import { formatUnits } from "viem";
import type { NetworkManifest } from "./manifest";

export const MAINNET_FEE_CAP_18 = 20000000000000000n;

// The funded one-time demo is retired. Every wallet now uses the same normal
// flow: current nonce, exact user-selected amount and per-transaction fee review.
export function assertMainnetFeeCap(m: NetworkManifest, fee18: bigint) {
  if (m.environment !== "arc-mainnet") return;
  if (fee18 < 0n || fee18 > MAINNET_FEE_CAP_18)
    throw Error(`Maximum gas cost ${formatUnits(fee18, 18)} USDC exceeds the 0.02 USDC per-transaction limit. No wallet signature or transaction requested. Preview again later.`);
}
