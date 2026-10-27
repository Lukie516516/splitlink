/**
 * SplitLink contract ABI, types, and pure helpers.
 * All monetary values are six-decimal USDC base units (bigint).
 */
import { parseAmount } from "@/onchain-money";
import { buildTxExplorerUrl } from "@/onchain-facts";
import { ARC_TESTNET_CHAIN_ID } from "@/lib/manifest";

// ── ABI ───────────────────────────────────────────────────────────────────────

export { generatedAbi as SPLITLINK_ABI } from "./generatedAbi";
import { generatedAbi as SPLITLINK_ABI } from "./generatedAbi";

// ── On-chain request status (mirrors Solidity enum) ───────────────────────────

export const RequestStatus = {
  None: 0,
  Open: 1,
  Paid: 2,
  Cancelled: 3,
} as const;

export type RequestStatusValue =
  (typeof RequestStatus)[keyof typeof RequestStatus];

export function requestStatusLabel(s: number): string {
  switch (s) {
    case 1:
      return "Open";
    case 2:
      return "Paid";
    case 3:
      return "Cancelled";
    default:
      return "Unknown";
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OnChainRequest {
  creator: string;
  title: string;
  totalAmount: bigint;
  recipients: readonly string[];
  sharesBps: readonly number[];
  status: number;
  createdAt: bigint;
  payer: string;
  paidAt: bigint;
}

export interface RequestKey {
  chainId: number;
  contractAddress: string;
  requestId: bigint;
}

export function requestKeyString(k: RequestKey): string {
  return `${k.chainId}:${k.contractAddress.toLowerCase()}:${k.requestId.toString()}`;
}

// ── Deployment manifest (canonical definitions are in manifest.ts) ───────────
// splitlink.ts does NOT re-export NetworkManifest, getManifest, or getSupportedManifest;
// import those directly from @/lib/manifest.
import { getManifest as _getManifestForUrls } from "@/lib/manifest";

// ── Pure allocation algorithm (mirrors Solidity exactly) ──────────────────────

export function computeAllocations(
  totalAmount: bigint,
  sharesBps: number[],
): bigint[] {
  const n = sharesBps.length;
  const allocs: bigint[] = [];
  let allocated = 0n;
  for (let i = 0; i < n - 1; i++) {
    const a = (totalAmount * BigInt(sharesBps[i])) / 10000n;
    allocs.push(a);
    allocated += a;
  }
  allocs.push(totalAmount - allocated);
  return allocs;
}

// ── Percentage parsing (spec §6.1) ────────────────────────────────────────────

export type ParsedPercentage =
  | { ok: true; bps: number }
  | { ok: false; error: string };

export function parsePercentage(raw: string): ParsedPercentage {
  const s = raw.trim();
  if (s === "") return { ok: false, error: "Enter a percentage." };

  // Valid ASCII form: digits or digits.digits (1-2 fractional)
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) {
    // Detect specific cases
    if (/\.\d{3,}/.test(s))
      return { ok: false, error: "Use no more than 2 decimal places." };
    return { ok: false, error: "Enter a percentage such as 33.33." };
  }

  const wholePart = match[1];
  const fracPart = match[2] ?? "";

  // String arithmetic: whole * 100 + fraction.padEnd(2, '0')
  const precise = BigInt(wholePart) * 100n + BigInt(fracPart.padEnd(2, "0"));
  if (precise > 10000n)
    return { ok: false, error: "A share cannot exceed 100%." };
  const bps = Number(precise);

  if (bps === 0)
    return { ok: false, error: "Each share must be greater than 0%." };
  if (bps > 10000) return { ok: false, error: "A share cannot exceed 100%." };

  return { ok: true, bps };
}

// ── Amount parsing (six-decimal, no float) ────────────────────────────────────

export type ParsedAmount =
  | { ok: true; raw: bigint }
  | { ok: false; error: string };

export function parseDraftAmount(input: string): ParsedAmount {
  const s = input.trim();
  if (s === "") return { ok: false, error: "Enter an amount." };
  // Reject signs and exponents
  if (/[eE+\-]/.test(s))
    return { ok: false, error: "Enter a plain decimal amount." };
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!match) return { ok: false, error: "Use no more than 6 decimal places." };

  const fracPart = match[2] ?? "";
  if (fracPart.length > 6)
    return { ok: false, error: "Use no more than 6 decimal places." };

  try {
    const amt = parseAmount(ARC_TESTNET_CHAIN_ID, s);
    if (amt.raw < 10_000n)
      return { ok: false, error: "Minimum amount is 0.01 USDC." };
    if (amt.raw > 1_000_000_000_000n)
      return { ok: false, error: "Maximum amount is 1,000,000 USDC." };
    return { ok: true, raw: amt.raw };
  } catch {
    return { ok: false, error: "Invalid amount." };
  }
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format a six-decimal USDC raw bigint to a display string. */
export function formatUsdc6(raw: bigint): string {
  const sign = raw < 0n ? "-" : "";
  const value = raw < 0n ? -raw : raw;
  return `${sign}${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`;
}

export function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function buildExplorerTxUrl(txHash: string): string {
  const m = _getManifestForUrls();
  return `${m.explorerBase}/tx/${txHash}`;
}

export function buildExplorerAddrUrl(addr: string): string {
  const m = _getManifestForUrls();
  return `${m.explorerBase}/address/${addr}`;
}

// ── Error decoder ─────────────────────────────────────────────────────────────

export function decodeContractError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (
    msg.includes("user rejected") ||
    msg.includes("User rejected") ||
    msg.includes("4001")
  ) {
    return "You cancelled the transaction.";
  }
  if (msg.includes("InvalidTitle"))
    return "Invalid title (1–120 characters required).";
  if (msg.includes("InvalidAmount"))
    return "Invalid amount (must be 0.01–1,000,000 USDC).";
  if (msg.includes("InvalidRecipientCount")) return "Need 2–5 recipients.";
  if (msg.includes("ArrayLengthMismatch"))
    return "Recipients and shares arrays must have the same length.";
  if (msg.includes("InvalidAddress"))
    return "One or more recipient addresses are invalid.";
  if (msg.includes("DuplicateRecipient"))
    return "Recipient addresses must be unique.";
  if (msg.includes("InvalidShares"))
    return "Shares must be positive and sum to exactly 100%.";
  if (msg.includes("ZeroAllocation"))
    return "All recipients must receive a non-zero allocation.";
  if (msg.includes("RequestNotFound")) return "Payment request not found.";
  if (msg.includes("RequestNotOpen")) return "This request is no longer open.";
  if (msg.includes("UnauthorizedCancellation"))
    return "Only the creator can cancel this request.";
  if (msg.includes("insufficient"))
    return "Insufficient USDC balance or allowance.";
  if (msg.includes("reverted")) return "Transaction failed on-chain.";
  return msg.slice(0, 180);
}

// ── Re-export useful helpers ─────────────────────────────────────────────────
export { parseAmount, buildTxExplorerUrl };
