import { z } from "zod";
import { isAddress, type Hex } from "viem";
const address = z.string().refine(isAddress);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const decimal = z.string().regex(/^\d+$/);
export const recordSchema = z.object({
  schemaVersion: z.literal(1),
  recordId: z.string().uuid(),
  chainId: z.number().int().positive(),
  contractAddress: address,
  account: address,
  operationType: z.enum(["create", "approveReset", "approve", "pay", "cancel"]),
  requestId: decimal.nullable(),
  to: address,
  callData: z.string().regex(/^0x([\da-fA-F]{2})*$/),
  value18: z.literal("0"),
  intent: z.record(z.unknown()),
  txHash: hash.nullable(),
  effectiveTxHash: hash.nullable(),
  replacementHashes: z.array(hash),
  nonce: decimal.nullable(),
  submittedAtBlock: decimal.nullable(),
  createdAtMs: z.number(),
  updatedAtMs: z.number(),
  txState: z.enum([
    "prepared",
    "awaitingSignature",
    "submitted",
    "confirmed",
    "reverted",
    "rejected",
    "unknown",
    "replaced",
    "cancelledByReplacement",
  ]),
  businessVerification: z.enum([
    "notChecked",
    "pending",
    "verified",
    "mismatch",
    "unavailable",
  ]),
  receiptBlock: decimal.nullable(),
  receiptStatus: z.enum(["success", "reverted"]).nullable(),
  replacementKind: z
    .enum(["sameIntent", "walletCancel", "otherCall"])
    .nullable(),
  error: z.string().nullable(),
  actualFee18: decimal.optional(),
  dismissedAtMs: z.number().optional(),
});
export type Record = z.infer<typeof recordSchema>;
export const journalKey = "splitlink.transactions.v1";
export const serialize = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
export class Journal {
  records: Record[] = [];
  warning = "";
  constructor(private storage: Pick<Storage, "getItem" | "setItem">) {
    try {
      const raw = storage.getItem(journalKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw Error("Invalid journal.");
        for (const r of parsed) {
          const result = recordSchema.safeParse(r);
          if (result.success) this.records.push(result.data);
          else
            this.warning =
              "Some transaction records are invalid or use an unsupported version. Check wallet activity.";
        }
      }
      for (const r of this.records) {
        // Browser storage is a hint, including malformed no-hash successes.
        r.businessVerification = "notChecked";
        r.receiptStatus = null;
        r.receiptBlock = null;
        delete r.actualFee18;
        if (!r.effectiveTxHash && r.txState !== "rejected") {
          r.txState = "unknown";
          r.error =
            "No transaction hash was saved. Check your wallet activity before trying again.";
        } else if (
          r.effectiveTxHash &&
          !["rejected", "cancelledByReplacement"].includes(r.txState)
        ) {
          // Browser storage is a recovery hint, never chain evidence. Even a
          // previously verified success must be checked once in this session.
          r.txState = "unknown";
        }
      }
    } catch {
      this.warning =
        "Transaction recovery on this device is unavailable. Save the transaction hash.";
    }
  }
  save() {
    try {
      this.storage.setItem(journalKey, serialize(this.records));
    } catch {
      this.warning =
        "Transaction recovery on this device is unavailable. Save the transaction hash.";
    }
  }
  add(
    input: Pick<
      Record,
      | "chainId"
      | "contractAddress"
      | "account"
      | "operationType"
      | "requestId"
      | "to"
      | "callData"
      | "intent"
    >,
  ) {
    const now = Date.now();
    const r: Record = {
      ...structuredClone(input),
      schemaVersion: 1,
      recordId: crypto.randomUUID(),
      value18: "0",
      txHash: null,
      effectiveTxHash: null,
      replacementHashes: [],
      nonce: null,
      submittedAtBlock: null,
      createdAtMs: now,
      updatedAtMs: now,
      txState: "prepared",
      businessVerification: "notChecked",
      receiptBlock: null,
      receiptStatus: null,
      replacementKind: null,
      error: null,
    };
    this.records.push(r);
    this.save();
    return r;
  }
  update(r: Record, patch: Partial<Record>) {
    Object.assign(r, patch, { updatedAtMs: Date.now() });
    this.save();
  }
}
export function sameCall(
  r: Record,
  tx: {
    from: string;
    to: string | null;
    input: string;
    value: bigint;
    nonce: number;
  },
) {
  return (
    tx.from.toLowerCase() === r.account.toLowerCase() &&
    tx.to?.toLowerCase() === r.to.toLowerCase() &&
    tx.input.toLowerCase() === r.callData.toLowerCase() &&
    tx.value === 0n &&
    (r.nonce === null || BigInt(tx.nonce) === BigInt(r.nonce))
  );
}
export async function acceptReplacement(
  j: Journal,
  r: Record,
  candidate: Hex,
  getTx: (h: Hex) => Promise<{
    from: string;
    to: string | null;
    input: string;
    value: bigint;
    nonce: number;
  }>,
  getReceipt: (h: Hex) => Promise<{ status: "success" | "reverted" }>,
) {
  const tx = await getTx(candidate);
  if (
    r.nonce === null ||
    tx.from.toLowerCase() !== r.account.toLowerCase() ||
    BigInt(tx.nonce) !== BigInt(r.nonce)
  )
    throw Error("Unrelated replacement candidate.");
  if (sameCall(r, tx)) {
    j.update(r, {
      replacementHashes: [...r.replacementHashes, candidate],
      effectiveTxHash: candidate,
      replacementKind: "sameIntent",
      txState: "submitted",
    });
    return;
  }
  await getReceipt(candidate);
  j.update(r, {
    replacementHashes: [...r.replacementHashes, candidate],
    replacementKind:
      tx.to?.toLowerCase() === r.account.toLowerCase() &&
      tx.value === 0n &&
      tx.input === "0x"
        ? "walletCancel"
        : "otherCall",
    txState: "cancelledByReplacement",
    businessVerification: "mismatch",
  });
}
