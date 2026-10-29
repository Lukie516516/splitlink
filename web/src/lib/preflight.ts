// Shared production preflight. No permissive simulation or guessed gas path.
import {
  decodeFunctionData,
  erc20Abi,
  type PublicClient,
  type Address,
} from "viem";
import { SPLITLINK_ABI } from "./splitlink";
export const GAS_LIMIT_MARGIN_BPS = 12000n,
  FEE_CAP_MARGIN_BPS = 12000n,
  MIN_MAX_FEE_PER_GAS_18 = 20000000000n,
  BALANCE_RESERVE_18 = 1000000000000000n,
  QUOTE_TTL_MS = 30000,
  SCALE_P6_TO_P18 = 1000000000000n;
export const ceilDiv = (a: bigint, num: bigint, denom: bigint) =>
  (a * num + denom - 1n) / denom;
export const p6ToNative = (n: bigint) => n * SCALE_P6_TO_P18;
export type OperationType =
  | "create"
  | "approveReset"
  | "approve"
  | "pay"
  | "cancel";
export interface PreflightQuote {
  contextKey: string;
  operation: OperationType;
  quoteBlock: bigint;
  quotedAt: number;
  estimatedGas: bigint;
  gasLimit: bigint;
  maxFeePerGas18: bigint;
  requiredMaxFeePerGas18: bigint;
  priorityFee18: bigint;
  feeBudget18: bigint;
  simulationOk: boolean;
  simulationRevertReason?: string;
  feeSource: string;
  quotedCallData: `0x${string}`;
  quotedTarget: `0x${string}`;
  nonce: number;
}
export type PreflightOutcome =
  | { ok: true; quote: PreflightQuote; fundingOk: boolean }
  | { ok: false; code: string; message: string };
export const makeContextKey = (
  chain: number,
  account: string,
  target: string,
  op: string,
) => `${chain}:${account.toLowerCase()}:${target.toLowerCase()}:${op}`;
export const isQuoteStale = (q: PreflightQuote) =>
  Date.now() < q.quotedAt || Date.now() - q.quotedAt >= QUOTE_TTL_MS;
// Compare live requirements with the exact envelope the user reviewed. Adding
// the safety margin twice would reject harmless movement inside that envelope.
export function freshQuoteFitsReview(reviewed: PreflightQuote, fresh: PreflightQuote) {
  return fresh.nonce === reviewed.nonce && fresh.estimatedGas <= reviewed.gasLimit &&
    fresh.requiredMaxFeePerGas18 <= reviewed.maxFeePerGas18 &&
    fresh.priorityFee18 <= reviewed.priorityFee18;
}
export function verifySigningContext(
  q: PreflightQuote,
  c: {
    chainId: number;
    account: string;
    target: string;
    callData: string;
    value: bigint;
  },
) {
  if (isQuoteStale(q))
    return "Network fee estimate expired. Retry before signing.";
  if (
    q.contextKey !==
      makeContextKey(c.chainId, c.account, c.target, q.operation) ||
    q.quotedTarget.toLowerCase() !== c.target.toLowerCase() ||
    q.quotedCallData.toLowerCase() !== c.callData.toLowerCase() ||
    c.value !== 0n
  )
    return "Signing context or exact transaction changed. Retry.";
  if (!q.simulationOk) return "Simulation failed.";
  return null;
}
export function errorMessage(e: unknown) {
  let c = e as any;
  const parts: string[] = [];
  for (let i = 0; c && i < 7; i++, c = c.cause) {
    if (c.data?.errorName) parts.push(c.data.errorName);
    if (c.shortMessage || c.message) parts.push(c.shortMessage ?? c.message);
    if (c.details) parts.push(c.details);
  }
  return [...new Set(parts)].join(" ") || String(e);
}
export async function runPreflight(p: {
  publicClient: PublicClient;
  chainId: number;
  account: Address;
  contractAddress: Address;
  operation: OperationType;
  callData: `0x${string}`;
  principal6: bigint;
  isChainSpecificClient: boolean;
}): Promise<PreflightOutcome> {
  try {
    const startedAt = Date.now();
    if (
      !p.isChainSpecificClient ||
      (await p.publicClient.getChainId()) !== p.chainId
    )
      throw Error("RPC chain mismatch.");
    const block = await p.publicClient.getBlock({ blockTag: "latest" });
    if (block.baseFeePerGas == null || Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 60)
      throw Error("区块或费用数据已过期，请重新读取。");
    const abi =
      p.operation === "approve" || p.operation === "approveReset"
        ? erc20Abi
        : SPLITLINK_ABI;
    const decoded = decodeFunctionData({ abi, data: p.callData });
    const [nonce, pending, fees, simulation, gas] = await Promise.all([
      p.publicClient.getTransactionCount({ address: p.account, blockTag: "latest" }),
      p.publicClient.getTransactionCount({ address: p.account, blockTag: "pending" }),
      p.publicClient.estimateFeesPerGas(),
      p.publicClient.simulateContract({
        address: p.contractAddress, abi: abi as any,
        functionName: decoded.functionName, args: decoded.args,
        account: p.account, value: 0n, blockNumber: block.number,
      }),
      p.publicClient.estimateGas({ account: p.account, to: p.contractAddress, data: p.callData, value: 0n }),
    ]);
    if (nonce !== pending) throw Error("钱包仍有待处理交易，请先等待或恢复状态。");
    if (fees.maxFeePerGas == null) throw Error("Fee estimate unavailable.");
    if ((p.operation === "approve" || p.operation === "approveReset") && simulation.result === false)
      throw Error("execution reverted: approval simulation returned false.");
    const priority = fees.maxPriorityFeePerGas ?? 0n;
    const requiredMaxFeePerGas18 = fees.maxFeePerGas > block.baseFeePerGas + priority ? fees.maxFeePerGas : block.baseFeePerGas + priority;
    const cap = [
      MIN_MAX_FEE_PER_GAS_18,
      ceilDiv(fees.maxFeePerGas, FEE_CAP_MARGIN_BPS, 10000n),
      (block.baseFeePerGas ?? 0n) + priority,
    ].reduce((a, b) => (a > b ? a : b));
    const limit = ceilDiv(gas, GAS_LIMIT_MARGIN_BPS, 10000n);
    if (Date.now() - startedAt >= QUOTE_TTL_MS) throw Error("费用复核超时，请重新预览。");
    return {
      ok: true,
      fundingOk: true,
      quote: {
        contextKey: makeContextKey(
          p.chainId,
          p.account,
          p.contractAddress,
          p.operation,
        ),
        operation: p.operation,
        quoteBlock: block.number,
        quotedAt: startedAt,
        nonce,
        estimatedGas: gas,
        gasLimit: limit,
        maxFeePerGas18: cap,
        requiredMaxFeePerGas18,
        priorityFee18: priority,
        feeBudget18: limit * cap,
        simulationOk: true,
        feeSource: "live simulation + gas estimate + fee recommendation",
        quotedCallData: p.callData,
        quotedTarget: p.contractAddress,
      },
    };
  } catch (e) {
    const s = errorMessage(e);
    return {
      ok: false,
      code: /revert|RequestNotOpen|RequestNotFound/i.test(s)
        ? "simulationReverted"
        : /fetch|http|network|timeout|RPC chain/i.test(s)
          ? "rpcUnavailable"
          : "estimateUnavailable",
      message: s,
    };
  }
}
export function checkFunding(p: {
  operation: OperationType;
  feeBudget18: bigint;
  principal6: bigint;
  balance6: bigint | null;
  nativeBalance18: bigint | null;
  sharedBalance?: boolean;
}) {
  if (p.balance6 === null || p.nativeBalance18 === null)
    return { ok: false, error: "rpcUnavailable: Balance unknown. Retry." };
  const principal = ["approve", "approveReset", "pay"].includes(p.operation)
    ? p.principal6
    : 0n;
  if (p.balance6 < principal)
    return {
      ok: false,
      error: "insufficientPrincipal: Insufficient USDC for the request total.",
    };
  const required =
    (p.sharedBalance === false ? 0n : p6ToNative(principal)) +
    p.feeBudget18 +
    BALANCE_RESERVE_18;
  if (p.nativeBalance18 < required)
    return {
      ok: false,
      error:
        "insufficientFeeBudget: Insufficient USDC for the amount and network fee budget.",
    };
  return { ok: true };
}
// Six display decimals, rounded UP. A cap is never an actual fee.
export function formatFee18(n: bigint) {
  const six = (n + SCALE_P6_TO_P18 - 1n) / SCALE_P6_TO_P18;
  return `${six / 1000000n}.${(six % 1000000n).toString().padStart(6, "0")}`;
}
