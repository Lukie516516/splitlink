// Durable intent journal. Hydration clears cached authority once, not on every read/update.
import { isAddress, type PublicClient, type Abi, type Hex } from "viem";
import type { OperationType } from "./preflight";
export type { OperationType };
export const JOURNAL_SCHEMA_VERSION = 1,
  STORAGE_KEY = "splitlink:journal:v1";
export type TxState =
  | "prepared"
  | "awaitingSignature"
  | "submitted"
  | "confirmed"
  | "reverted"
  | "rejected"
  | "unknown"
  | "replaced"
  | "cancelledByReplacement";
export type BusinessVerification =
  | "notChecked"
  | "pending"
  | "verified"
  | "mismatch"
  | "unavailable";
export type ReceiptStatus = "success" | "reverted";
export interface TransactionRecord {
  schemaVersion: number;
  recordId: string;
  chainId: number;
  contractAddress: string;
  account: string;
  operationType: OperationType;
  requestId: string | null;
  to: string;
  callData: string;
  value18: string;
  intent: unknown;
  txHash: string | null;
  effectiveTxHash: string | null;
  replacementHashes: string[];
  nonce: string | null;
  submittedAtBlock: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  txState: TxState;
  businessVerification: BusinessVerification;
  receiptBlock: string | null;
  receiptStatus: ReceiptStatus | null;
  replacementKind: "repriced" | "walletCancel" | "otherCall" | null;
  error: { code: string; message: string } | null;
  actualFee18?: string;
  dismissedAtMs?: number;
}
const hex = /^0x(?:[\da-f]{2})*$/i,
  hash = /^0x[\da-f]{64}$/i,
  decimal = /^\d+$/;
export function isValidRecord_PROD(r: unknown): r is TransactionRecord {
  if (!r || typeof r !== "object") return false;
  const x = r as TransactionRecord;
  return (
    x.schemaVersion === 1 &&
    typeof x.recordId === "string" &&
    x.recordId.length > 0 &&
    Number.isSafeInteger(x.chainId) &&
    x.chainId > 0 &&
    [x.account, x.contractAddress, x.to].every(
      (v) => typeof v === "string" && isAddress(v),
    ) &&
    typeof x.callData === "string" &&
    hex.test(x.callData) &&
    x.callData.length >= 10 &&
    x.value18 === "0" &&
    ["create", "approveReset", "approve", "pay", "cancel"].includes(
      x.operationType,
    ) &&
    [
      "prepared",
      "awaitingSignature",
      "submitted",
      "confirmed",
      "reverted",
      "rejected",
      "unknown",
      "replaced",
      "cancelledByReplacement",
    ].includes(x.txState) &&
    ["notChecked", "pending", "verified", "mismatch", "unavailable"].includes(
      x.businessVerification,
    ) &&
    ["success", "reverted", null].includes(x.receiptStatus) &&
    ["repriced", "walletCancel", "otherCall", null].includes(
      x.replacementKind,
    ) &&
    [x.createdAtMs, x.updatedAtMs].every((v) => Number.isFinite(v) && v >= 0) &&
    [x.txHash, x.effectiveTxHash].every(
      (v) => v === null || (typeof v === "string" && hash.test(v)),
    ) &&
    Array.isArray(x.replacementHashes) &&
    x.replacementHashes.every((v) => typeof v === "string" && hash.test(v)) &&
    [x.nonce, x.receiptBlock, x.submittedAtBlock, x.requestId].every(
      (v) => v === null || (typeof v === "string" && decimal.test(v)),
    ) &&
    x.intent !== undefined &&
    (x.actualFee18 === undefined ||
      (typeof x.actualFee18 === "string" && decimal.test(x.actualFee18))) &&
    (x.dismissedAtMs === undefined ||
      (Number.isFinite(x.dismissedAtMs) && x.dismissedAtMs >= 0)) &&
    (x.error === null ||
      (typeof x.error === "object" &&
        typeof x.error.code === "string" &&
        typeof x.error.message === "string"))
  );
}
export function clearCachedSuccessOnRestore_PROD(
  r: TransactionRecord,
): TransactionRecord {
  return {
    ...r,
    txState: r.txState === "rejected" ? "rejected" : "unknown",
    businessVerification: "notChecked",
    receiptStatus: null,
    receiptBlock: null,
    actualFee18: undefined,
    error: r.txHash
      ? null
      : {
          code: "missingHash",
          message:
            "No transaction hash was saved. Check your wallet activity before trying again.",
        },
  };
}
export const serialize = (x: unknown) =>
  JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v));
export class JournalStore {
  records: TransactionRecord[] = [];
  warning = "";
  listeners = new Set<() => void>();
  constructor(private storage: Pick<Storage, "getItem" | "setItem">) {
    this.hydrate();
  }
  hydrate() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      const arr: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) throw Error("Invalid journal");
      this.records = [];
      for (const r of arr) {
        if (isValidRecord_PROD(r))
          this.records.push(clearCachedSuccessOnRestore_PROD(r));
        else
          this.warning =
            "Invalid transaction records quarantined. Check wallet activity; cached success is not trusted.";
      }
    } catch {
      this.warning =
        "Transaction recovery on this device is unavailable. Save the transaction hash.";
    }
    this.emit();
  }
  refreshFromStorage() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if ((raw ?? "[]") !== serialize(this.records)) this.hydrate();
    } catch {
      this.warning = "无法读取本机交易记录，保持只读。";
    }
  }
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  emit() {
    for (const f of this.listeners) f();
  }
  save() {
    try {
      this.storage.setItem(STORAGE_KEY, serialize(this.records));
    } catch {
      this.warning =
        "Transaction recovery on this device is unavailable. Save the transaction hash.";
    }
    this.emit();
    return !this.warning;
  }
  put(r: TransactionRecord) {
    if (!isValidRecord_PROD(r)) {
      this.warning =
        "Invalid transaction journal record. Write tracking unavailable.";
      this.emit();
      return false;
    }
    const i = this.records.findIndex((x) => x.recordId === r.recordId);
    if (i < 0) this.records.unshift(r);
    else this.records[i] = r;
    return this.save();
  }
  patch(r: TransactionRecord, p: Partial<TransactionRecord>) {
    Object.assign(r, p, { updatedAtMs: Date.now() });
    this.put(r);
  }
}
let live: JournalStore | undefined;
export function journal() {
  if (!live) {
    try {
      live = new JournalStore(localStorage);
    } catch {
      live = new JournalStore({
        getItem() {
          throw Error("storage");
        },
        setItem() {
          throw Error("storage");
        },
      });
    }
  }
  return live;
}
export const loadJournal = () => journal().records;
export const loadRecord = (id: string) =>
  journal().records.find((r) => r.recordId === id) ?? null;
export const persistRecord = (r: TransactionRecord) => journal().put(r);
export const generateRecordId = () => crypto.randomUUID();
export const loadContextRecords = (
  chain: number,
  target: string,
  account: string,
) =>
  loadJournal().filter(
    (r) =>
      r.chainId === chain &&
      r.contractAddress.toLowerCase() === target.toLowerCase() &&
      r.account.toLowerCase() === account.toLowerCase(),
  );
export function invalidateStaleContextRecords() {
  return true;
} // no context authorizes records; all recovery is original-chain.
export type RecoveryOutcome =
  | {
      state: "confirmed" | "reverted";
      receiptStatus: ReceiptStatus;
      blockNumber: bigint;
    }
  | {
      state: "unknown";
      reason: string;
      receiptFound: boolean;
      receiptStatus?: ReceiptStatus;
    }
  | { state: "rpcFailure" | "submitted"; reason: string };
export async function recoverRecord(
  c: PublicClient,
  h: Hex,
  opts?: {
    expectedTarget?: string;
    expectedCallData?: string;
    expectedSender?: string;
    requireZeroValue?: boolean;
    expectedNonce?: string | null;
    expectedChainId?: number;
    abi?: Abi;
  },
): Promise<RecoveryOutcome> {
  let receipt;
  try {
    receipt = await c.getTransactionReceipt({ hash: h });
  } catch {
    // A known pending exact transaction is submitted. An absent/pruned body stays unknown.
    try {
      const tx = await c.getTransaction({ hash: h });
      if (
        opts?.expectedTarget &&
        opts.expectedCallData &&
        opts.expectedSender &&
        (opts.expectedChainId === undefined ||
          (await c.getChainId()) === opts.expectedChainId) &&
        tx.blockNumber === null &&
        tx.to?.toLowerCase() === opts.expectedTarget.toLowerCase() &&
        tx.from.toLowerCase() === opts.expectedSender.toLowerCase() &&
        tx.input.toLowerCase() === opts.expectedCallData.toLowerCase() &&
        tx.value === 0n &&
        (opts.expectedNonce == null ||
          BigInt(tx.nonce) === BigInt(opts.expectedNonce))
      )
        return {
          state: "submitted",
          reason: "Known pending transaction; no final receipt yet.",
        };
    } catch {
      /* no identity proof */
    }
    return {
      state: "unknown",
      receiptFound: false,
      reason: "Receipt unavailable. Outcome remains unknown.",
    };
  }
  const fail = (reason: string): RecoveryOutcome => ({
    state: "unknown",
    reason,
    receiptFound: true,
    receiptStatus: receipt.status,
  });
  if (!opts?.expectedTarget || !opts.expectedCallData || !opts.expectedSender)
    return fail("Complete frozen transaction identity is required.");
  try {
    if (
      opts.expectedChainId !== undefined &&
      (await c.getChainId()) !== opts.expectedChainId
    )
      return fail("Original RPC chain mismatch.");
    const tx = await c.getTransaction({ hash: h });
    if (
      tx.to?.toLowerCase() !== opts.expectedTarget.toLowerCase() ||
      tx.from.toLowerCase() !== opts.expectedSender.toLowerCase() ||
      tx.input.toLowerCase() !== opts.expectedCallData.toLowerCase() ||
      tx.value !== 0n ||
      (opts.expectedNonce != null &&
        BigInt(tx.nonce) !== BigInt(opts.expectedNonce))
    )
      return fail(
        "Exact transaction sender/target/calldata/value/nonce mismatch.",
      );
    if (
      receipt.transactionHash?.toLowerCase() !== h.toLowerCase() ||
      receipt.to?.toLowerCase() !== opts.expectedTarget.toLowerCase() ||
      receipt.from?.toLowerCase() !== opts.expectedSender.toLowerCase()
    )
      return fail("Receipt identity mismatch.");
    const block = await c.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash !== receipt.blockHash || tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber)
      return fail("交易收据尚未匹配规范区块，保持未决。");
    return {
      state: receipt.status === "success" ? "confirmed" : "reverted",
      receiptStatus: receipt.status,
      blockNumber: receipt.blockNumber,
    };
  } catch {
    return fail(
      "Transaction body unavailable for exact identity verification. Receipt is not business proof.",
    );
  }
}
export async function verifyReplacement(
  store: JournalStore,
  r: TransactionRecord,
  h: Hex,
  c: PublicClient,
) {
  if ((await c.getChainId()) !== r.chainId)
    throw Error("Original chain mismatch.");
  const tx = await c.getTransaction({ hash: h });
  if (
    r.nonce === null ||
    tx.from.toLowerCase() !== r.account.toLowerCase() ||
    BigInt(tx.nonce) !== BigInt(r.nonce)
  )
    throw Error("Unrelated replacement.");
  if (
    tx.to?.toLowerCase() === r.to.toLowerCase() &&
    tx.input.toLowerCase() === r.callData.toLowerCase() &&
    tx.value === 0n
  ) {
    store.patch(r, {
      replacementHashes: [...r.replacementHashes, h],
      effectiveTxHash: h,
      replacementKind: "repriced",
      txState: "submitted",
    });
    return;
  }
  const receipt = await c.getTransactionReceipt({ hash: h });
  if (!receipt || receipt.transactionHash !== h)
    throw Error("Replacement not final.");
  store.patch(r, {
    replacementHashes: [...r.replacementHashes, h],
    replacementKind:
      tx.to?.toLowerCase() === r.account.toLowerCase() &&
      tx.input === "0x" &&
      tx.value === 0n
        ? "walletCancel"
        : "otherCall",
    txState: "cancelledByReplacement",
    businessVerification: "mismatch",
  });
}
