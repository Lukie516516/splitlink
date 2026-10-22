import { isAddress, zeroAddress, type Address } from "viem";
export const SCALE = 10n ** 12n;
export function parseShare(raw: string): bigint {
  const s = raw.trim();
  if (!s) throw Error("Enter a percentage.");
  if (/^\d+\.\d{3,}$/.test(s))
    throw Error("Use no more than 2 decimal places.");
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw Error("Enter a percentage such as 33.33.");
  const [w, f = ""] = s.split(".");
  const b = BigInt(w) * 100n + BigInt(f.padEnd(2, "0"));
  if (b === 0n) throw Error("Each share must be greater than 0%.");
  if (b > 10000n) throw Error("A share cannot exceed 100%.");
  return b;
}
export function parseAmount(raw: string): bigint {
  const s = raw.trim();
  if (/^\d+\.\d{7,}$/.test(s))
    throw Error("Use no more than 6 decimal places.");
  if (!/^\d+(\.\d{1,6})?$/.test(s))
    throw Error("Enter a USDC amount with up to 6 decimal places.");
  const [w, f = ""] = s.split(".");
  const a = BigInt(w) * 1000000n + BigInt(f.padEnd(6, "0"));
  if (a < 10000n || a > 1000000000000n)
    throw Error("Amount must be between 0.01 and 1,000,000 USDC.");
  return a;
}
export function format6(n: bigint) {
  return `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, "0")}`;
}
export function percent(b: bigint) {
  return `${b / 100n}.${(b % 100n).toString().padStart(2, "0")}`;
}
export function allocate(
  total: bigint,
  shares: readonly (bigint | number)[],
): bigint[] {
  const s = shares.map(BigInt);
  if (
    s.length < 2 ||
    s.length > 5 ||
    s.some((v) => v <= 0n) ||
    s.reduce((a, b) => a + b, 0n) !== 10000n
  )
    throw Error("Shares must add up to 100%.");
  let used = 0n;
  return s.map((v, i) => {
    const a = i === s.length - 1 ? total - used : (total * v) / 10000n;
    used += a;
    return a;
  });
}
export type DraftRow = {
  rowId: string;
  addressInput: string;
  percentageInput: string;
};
export function recipientErrors(rows: DraftRow[], contract?: Address) {
  return rows.map((row, i) => {
    const a = row.addressInput;
    if (!a) return "Enter a recipient wallet address.";
    if (
      !isAddress(a) ||
      a.toLowerCase() === zeroAddress ||
      a.toLowerCase() === contract?.toLowerCase()
    )
      return "Enter a valid nonzero address, excluding SplitLink.";
    if (
      rows.some(
        (other, j) =>
          i !== j && other.addressInput.toLowerCase() === a.toLowerCase(),
      )
    )
      return "Recipients must be unique.";
    return null;
  });
}
export function preview(amount: string, rows: DraftRow[]) {
  const parsed = rows.map((r) => {
    try {
      return { bps: parseShare(r.percentageInput), error: null };
    } catch (e) {
      return { bps: null, error: (e as Error).message };
    }
  });
  const subtotal = parsed.reduce((n, p) => n + (p.bps ?? 0n), 0n);
  const incomplete = parsed.some((p) => p.bps === null);
  let allocations: bigint[] | null = null;
  let error = "";
  let total: bigint | null = null;
  try {
    total = parseAmount(amount);
    if (incomplete || subtotal !== 10000n)
      throw Error("Shares must add up to 100%.");
    allocations = allocate(
      total,
      parsed.map((p) => p.bps!),
    );
    if (allocations.some((a) => a === 0n))
      error = "Every allocation must be at least 0.000001 USDC.";
  } catch (e) {
    error = (e as Error).message;
  }
  return { parsed, subtotal, incomplete, allocations, total, error };
}
export function validateTerms(
  title: string,
  rows: DraftRow[],
  contract?: Address,
) {
  const bytes = new TextEncoder().encode(title).length;
  if (bytes < 1 || bytes > 120)
    throw Error("Title must contain 1–120 UTF-8 bytes.");
  if (rows.length < 2 || rows.length > 5) throw Error("Use 2–5 recipients.");
  const seen = new Set<string>();
  for (const r of rows) {
    const a = r.addressInput;
    if (
      !isAddress(a) ||
      a.toLowerCase() === zeroAddress ||
      a.toLowerCase() === contract?.toLowerCase()
    )
      throw Error(
        "Enter a valid nonzero recipient address, excluding SplitLink.",
      );
    if (seen.has(a.toLowerCase())) throw Error("Recipients must be unique.");
    seen.add(a.toLowerCase());
  }
}
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
export const policy = {
  gasLimitMarginBps: 12000n,
  feeCapMarginBps: 12000n,
  minMaxFeePerGas18: 20000000000n,
  quoteTtlMs: 30000,
  balanceReserve18: 1000000000000000n,
};
export type FeeQuote = {
  quotedAt: number;
  block: bigint;
  gas: bigint;
  estimatedGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  budget: bigint;
  estimate: bigint;
};
export function quote(
  gas: bigint,
  recommended: bigint,
  priority: bigint,
  base: bigint,
  block: bigint,
  now = Date.now(),
): FeeQuote {
  const limit = ceilDiv(gas * policy.gasLimitMarginBps, 10000n);
  const maxFee = [
    policy.minMaxFeePerGas18,
    ceilDiv(recommended * policy.feeCapMarginBps, 10000n),
    base + priority,
  ].reduce((a, b) => (a > b ? a : b));
  return {
    quotedAt: now,
    block,
    gas: limit,
    estimatedGas: gas,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: priority,
    budget: limit * maxFee,
    estimate: gas * (base + priority),
  };
}
export function funding(
  principal: bigint,
  b6: bigint,
  b18: bigint,
  q: FeeQuote,
  now = Date.now(),
  shared = true,
) {
  if (now - q.quotedAt > policy.quoteTtlMs)
    throw Error("staleQuote: Network fee quote expired. Retry before signing.");
  if (b6 < principal)
    throw Error(
      "insufficientPrincipal: Insufficient USDC for the request total.",
    );
  if (
    b18 <
    (shared ? principal * SCALE : 0n) + q.budget + policy.balanceReserve18
  )
    throw Error(
      "insufficientFeeBudget: Insufficient USDC for the amount and network fee budget.",
    );
}
export const fee6 = (n: bigint) => format6(ceilDiv(n, SCALE));
export function actualFee(gasUsed: bigint, effectiveGasPrice: bigint) {
  return gasUsed * effectiveGasPrice;
}
export function attributableDelta(total: bigint, self: bigint, fee18: bigint) {
  return -(total - self) * SCALE - fee18;
}
