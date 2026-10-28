import { assertMainnetBudget, verifyProjectHistory } from "./mainnetBudget";
// External continuation of Studio production modules: one controller for ALL five writes.
import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
  type PublicClient,
  type EIP1193Provider,
} from "viem";
import {
  SPLITLINK_ABI,
  computeAllocations,
  type OnChainRequest,
} from "./splitlink";
import {
  publicClientFor,
  verifyManifestOnChain,
  manifestIsReadyForWrites,
  operationAllowed,
  type NetworkManifest,
} from "./manifest";
import {
  runPreflight,
  checkFunding,
  verifySigningContext,
  errorMessage,
  isQuoteStale,
  type PreflightQuote,
  type OperationType,
} from "./preflight";
import {
  JournalStore,
  journal,
  generateRecordId,
  recoverRecord,
  verifyReplacement,
  serialize,
  type TransactionRecord,
} from "./journal";
import { scanPages } from "./history";
export const equal = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
export interface Intent {
  operation: OperationType;
  requestId: bigint | null;
  target: Address;
  data: Hex;
  principal6: bigint;
}
export function requestIntent(
  m: NetworkManifest,
  op: "pay" | "cancel",
  id: bigint,
  total = 0n,
): Intent {
  return {
    operation: op,
    requestId: id,
    target: m.contractAddress as Address,
    data: encodeFunctionData({
      abi: SPLITLINK_ABI,
      functionName: op === "pay" ? "payRequest" : "cancelRequest",
      args: [id],
    }),
    principal6: op === "pay" ? total : 0n,
  };
}
export function approvalIntent(
  m: NetworkManifest,
  id: bigint,
  total: bigint,
  reset = false,
): Intent {
  return {
    operation: reset ? "approveReset" : "approve",
    requestId: id,
    target: m.usdcAddress as Address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [m.contractAddress as Address, reset ? 0n : total],
    }),
    principal6: total,
  };
}
export async function verifiedClient(
  m: NetworkManifest,
  c = publicClientFor(m) as PublicClient,
) {
  const result = await verifyManifestOnChain(c, m);
  if (!result.allPassed)
    throw Error(`integrationError: ${result.failureReason}`);
  return c;
}
export async function readCanonical(
  m: NetworkManifest,
  id: bigint,
  minBlock = 0n,
  c = publicClientFor(m) as PublicClient,
  exactBlock?: bigint,
) {
  await verifiedClient(m, c);
  const block = exactBlock ?? (await c.getBlockNumber({ cacheTime: 0 }));
  if (block < minBlock)
    throw Error("staleRead: RPC is behind the receipt block.");
  const [request, allocations] = await Promise.all([
    c.readContract({
      address: m.contractAddress as Address,
      abi: SPLITLINK_ABI,
      functionName: "getRequest",
      args: [id],
      blockNumber: block,
    }),
    c.readContract({
      address: m.contractAddress as Address,
      abi: SPLITLINK_ABI,
      functionName: "getAllocations",
      args: [id],
      blockNumber: block,
    }),
  ]);
  const r = request as unknown as OnChainRequest;
  const expected = computeAllocations(r.totalAmount, [...r.sharesBps]);
  if (
    expected.length !== allocations.length ||
    expected.some((x, i) => x !== allocations[i]) ||
    r.status < 1 ||
    r.status > 3
  )
    throw Error("integrationError: Canonical allocation/status mismatch.");
  return { request: r, allocations, block };
}
export async function funds(
  m: NetworkManifest,
  account: Address,
  c = publicClientFor(m) as PublicClient,
  block?: bigint,
) {
  const at = block ?? (await c.getBlockNumber({ cacheTime: 0 }));
  const [balance6, native18, allowance] = await Promise.all([
    c.readContract({
      address: m.usdcAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber: at,
    }),
    c.getBalance({ address: account, blockNumber: at }),
    c.readContract({
      address: m.usdcAddress as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, m.contractAddress as Address],
      blockNumber: at,
    }),
  ]);
  if (m.sharedBalance && native18 / 1000000000000n !== balance6)
    throw Error("rpcUnavailable: Inconsistent shared balance reads; retry.");
  return { balance6, native18, allowance, block: at };
}
function parseIntent(m: NetworkManifest, call: Intent) {
  if (call.operation === "approve" || call.operation === "approveReset") {
    if (!equal(call.target, m.usdcAddress) || call.requestId === null)
      throw Error("Invalid approval context.");
    const d = decodeFunctionData({ abi: erc20Abi, data: call.data });
    if (
      d.functionName !== "approve" ||
      !equal(d.args[0], m.contractAddress) ||
      d.args[1] !== (call.operation === "approveReset" ? 0n : call.principal6)
    )
      throw Error("Exact approval intent mismatch.");
    return d;
  }
  if (!equal(call.target, m.contractAddress))
    throw Error("Wrong SplitLink target.");
  const d = decodeFunctionData({ abi: SPLITLINK_ABI, data: call.data });
  const method = {
    create: "createRequest",
    pay: "payRequest",
    cancel: "cancelRequest",
  }[call.operation];
  if (d.functionName !== method) throw Error("Operation calldata mismatch.");
  if (
    call.operation !== "create" &&
    (call.requestId === null || d.args?.[0] !== call.requestId)
  )
    throw Error("Request ID differs from exact calldata.");
  return d;
}
export async function prepareOperation(
  m: NetworkManifest,
  account: Address,
  call: Intent,
  c = publicClientFor(m) as PublicClient,
) {
  if (!manifestIsReadyForWrites(m) || !operationAllowed(m, call.operation))
    throw Error(
      "此操作尚未开放；仅已审部署的创建、准确授权和付款可用。",
    );
  await verifiedClient(m, c);
  const decodedIntent = parseIntent(m, call);
  const block = await c.getBlockNumber({ cacheTime: 0 });
  if (call.requestId !== null) {
    const { request: r } = await readCanonical(
      m,
      call.requestId,
      block,
      c,
      block,
    );
    if (r.status !== 1)
      throw Error(
        `Request is ${r.status === 2 ? "Paid" : "Cancelled"}. Refresh canonical state.`,
      );
    if (call.operation === "cancel" && !equal(r.creator, account))
      throw Error("Only the creator can cancel.");
    if (
      ["pay", "approve", "approveReset"].includes(call.operation) &&
      call.principal6 !== r.totalAmount
    )
      throw Error("Gross principal differs from canonical terms.");
  }
  const f = await funds(m, account, c, block);
  if (call.operation === "pay" && f.allowance < call.principal6)
    throw Error(
      "Allowance insufficient. Approve exactly the gross amount first.",
    );
  if (
    ["pay", "approve", "approveReset"].includes(call.operation) &&
    f.balance6 < call.principal6
  )
    throw Error(
      "insufficientPrincipal: Insufficient USDC for the request total.",
    );
  const result = await runPreflight({
    publicClient: c,
    chainId: m.chainId,
    account,
    contractAddress: call.target,
    operation: call.operation,
    callData: call.data,
    principal6: call.principal6,
    isChainSpecificClient: true,
  });
  if (!result.ok) throw Error(`${result.code}: ${result.message}`);
  assertMainnetBudget(m, account, call.operation, call.principal6, result.quote.feeBudget18, result.quote.nonce, call.operation === "create" ? (decodedIntent.args as readonly unknown[])[1] as bigint : undefined);
  await verifyProjectHistory(m, account, result.quote.nonce, c, block);
  const funding = checkFunding({
    operation: call.operation,
    principal6: call.principal6,
    feeBudget18: result.quote.feeBudget18,
    balance6: f.balance6,
    nativeBalance18: f.native18,
    sharedBalance: m.sharedBalance,
  });
  if (!funding.ok) throw Error(funding.error);
  return { quote: result.quote, funds: f };
}
export async function providerContext(p: EIP1193Provider) {
  const [accounts, chain] = await Promise.all([
    p.request({ method: "eth_accounts" }),
    p.request({ method: "eth_chainId" }),
  ]);
  return {
    account: accounts[0] as Address | undefined,
    chainId: Number(chain),
  };
}
type SubmitParams = {
  m: NetworkManifest;
  account: Address;
  call: Intent;
  reviewed: PreflightQuote;
  provider: EIP1193Provider;
  store?: JournalStore;
  contextValid: () => boolean;
  c?: PublicClient;
};
export async function submitOperation(p: SubmitParams) {
  if (!globalThis.navigator?.locks) throw Error("浏览器不支持跨标签交易保护，请使用最新桌面浏览器的 HTTPS 页面。");
  return navigator.locks.request("splitlink-journal-write:v1", { ifAvailable: true }, async (lock) => {
    if (!lock) throw Error("另一个标签页正在处理钱包交易，请先完成或恢复。");
    return submitUnlocked(p);
  });
}
async function submitUnlocked(p: SubmitParams) {
  const { m, account, call, reviewed, provider } = p;
  const store = p.store ?? journal(),
    c = p.c ?? (publicClientFor(m) as PublicClient);
  store.refreshFromStorage();
  if (store.warning) throw Error("本机交易记录不可用，保持只读。请恢复浏览器存储后再操作。");
  if (store.records.some(r => r.chainId === m.chainId && equal(r.account, account) && ["unknown", "prepared", "awaitingSignature", "submitted"].includes(r.txState)))
    throw Error("此钱包仍有未决记录，请先核对钱包活动并只读恢复，不能重复提交。");
  if (!p.contextValid()) throw Error("Context changed before preflight.");
  if (isQuoteStale(reviewed)) throw Error("staleQuote: Review a fresh quote.");
  const fresh = await prepareOperation(m, account, call, c);
  if (fresh.quote.nonce !== reviewed.nonce) throw Error("钱包 nonce 已变化，请重新预览。");
  if (!p.contextValid()) throw Error("Context changed during preflight.");
  if (
    fresh.quote.gasLimit > reviewed.gasLimit ||
    fresh.quote.maxFeePerGas18 > reviewed.maxFeePerGas18 ||
    fresh.quote.priorityFee18 > reviewed.priorityFee18
  )
    throw Error("staleQuote: Fee cap increased. Review again.");
  const budget = checkFunding({
    operation: call.operation,
    principal6: call.principal6,
    feeBudget18: reviewed.feeBudget18,
    balance6: fresh.funds.balance6,
    nativeBalance18: fresh.funds.native18,
    sharedBalance: m.sharedBalance,
  });
  if (!budget.ok) throw Error(budget.error);
  assertMainnetBudget(m, account, call.operation, call.principal6, reviewed.feeBudget18, reviewed.nonce, call.operation === "create" ? (parseIntent(m,call).args as readonly unknown[])[1] as bigint : undefined);
  const ctx = await providerContext(provider);
  if (
    !p.contextValid() ||
    ctx.chainId !== m.chainId ||
    !ctx.account ||
    !equal(ctx.account, account)
  )
    throw Error("Wallet context changed.");
  const contextError = verifySigningContext(reviewed, {
    chainId: ctx.chainId,
    account: ctx.account,
    target: call.target,
    callData: call.data,
    value: 0n,
  });
  if (contextError) throw Error(contextError);
  const now = Date.now();
  const r: TransactionRecord = {
    schemaVersion: 1,
    recordId: generateRecordId(),
    chainId: m.chainId,
    contractAddress: m.contractAddress,
    account,
    operationType: call.operation,
    requestId: call.requestId?.toString() ?? null,
    to: call.target,
    callData: call.data,
    value18: "0",
    intent: { principal6: call.principal6.toString() },
    txHash: null,
    effectiveTxHash: null,
    replacementHashes: [],
    nonce: reviewed.nonce.toString(),
    submittedAtBlock: fresh.quote.quoteBlock.toString(),
    createdAtMs: now,
    updatedAtMs: now,
    txState: "prepared",
    businessVerification: "notChecked",
    receiptBlock: null,
    receiptStatus: null,
    replacementKind: null,
    error: null,
  };
  if (!store.put(r)) throw Error("无法保存交易意图，已停止请求钱包。");
  store.patch(r, { txState: "awaitingSignature" });
  if (store.warning) throw Error("无法保存交易状态，已停止请求钱包。");
  try {
    const hex = (n: bigint) => `0x${n.toString(16)}` as Hex;
    const finalError = verifySigningContext(reviewed, { chainId: ctx.chainId, account: ctx.account!, target: call.target, callData: call.data, value: 0n });
    if (!p.contextValid() || finalError) throw Error(finalError ?? "钱包上下文已变化。");
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: call.target,
          data: call.data,
          value: "0x0",
          chainId: hex(BigInt(m.chainId)),
          nonce: hex(BigInt(reviewed.nonce)),
          gas: hex(reviewed.gasLimit),
          maxFeePerGas: hex(reviewed.maxFeePerGas18),
          maxPriorityFeePerGas: hex(reviewed.priorityFee18),
        },
      ],
    });
    store.patch(r, {
      txHash: hash,
      effectiveTxHash: hash,
      txState: "submitted",
    });
    await c.waitForTransactionReceipt({
      hash,
      timeout: 120000,
      pollingInterval: 1500,
      onReplaced: async (replacement) => {
        try {
          await verifyReplacement(store, r, replacement.transaction.hash, c);
        } catch {
          /* unresolved identity retained */
        }
      },
    });
  } catch (e) {
    const code = (e as { code?: number }).code;
    store.patch(r, {
      txState: !r.txHash && code === 4001 ? "rejected" : "unknown",
      error: {
        code: !r.txHash && code === 4001 ? "userRejected" : "unknownOutcome",
        message: errorMessage(e),
      },
    });
  }
  await recoverUnlocked(store, r, m, c);
  return r;
}
export function contractEvents(
  receipt: {
    logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[];
  },
  m: NetworkManifest,
) {
  return receipt.logs
    .filter((l) => equal(l.address, m.contractAddress))
    .flatMap((l) => {
      try {
        return [
          decodeEventLog({
            abi: SPLITLINK_ABI,
            data: l.data,
            topics: l.topics as [Hex, ...Hex[]],
            strict: true,
          }),
        ];
      } catch {
        return [];
      }
    });
}
export async function verifySettlementReceipt(
  m: NetworkManifest,
  id: bigint,
  c: PublicClient,
  receipt: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>,
) {
  if (receipt.status !== "success")
    throw Error("Failed receipt is not settlement evidence.");
  const canonical = await readCanonical(m, id, receipt.blockNumber, c, receipt.blockNumber);
  const latest = await readCanonical(m, id, receipt.blockNumber, c);
  const r = canonical.request;
  const paidBlock = await c.getBlock({ blockNumber: receipt.blockNumber });
  if (r.status !== 2 || latest.request.status !== 2 ||
    !equal(latest.request.payer, r.payer) || r.paidAt !== paidBlock.timestamp ||
    latest.request.paidAt !== r.paidAt)
    throw Error("付款状态、付款人或付款时间尚未核实。");
  const identity = await recoverRecord(c, receipt.transactionHash, {
    expectedTarget: m.contractAddress,
    expectedSender: r.payer,
    expectedCallData: encodeFunctionData({
      abi: SPLITLINK_ABI,
      functionName: "payRequest",
      args: [id],
    }),
    requireZeroValue: true,
    expectedChainId: m.chainId,
  });
  if (identity.state !== "confirmed")
    throw Error(
      "Settlement transaction body/identity unavailable or mismatched.",
    );
  const events = contractEvents(receipt, m),
    paid = events.filter((e) => e.eventName === "RequestPaid"),
    recipient = events.filter((e) => e.eventName === "RecipientPaid");
  if (
    paid.length !== 1 ||
    paid[0].args.requestId !== id ||
    !equal(paid[0].args.payer, r.payer) ||
    paid[0].args.totalAmount !== r.totalAmount ||
    recipient.length !== r.recipients.length || events.length !== r.recipients.length + 1 ||
    events.slice(0, -1).some(e => e.eventName !== "RecipientPaid") || events.at(-1)?.eventName !== "RequestPaid"
  )
    throw Error("Settlement events mismatch.");
  for (let i = 0; i < recipient.length; i++) {
    const e = recipient[i].args;
    if (
      e.requestId !== id ||
      !equal(e.recipient, r.recipients[i]) ||
      e.amount !== canonical.allocations[i]
    )
      throw Error("Ordered recipient evidence mismatch.");
  }
  return {
    ...canonical,
    hash: receipt.transactionHash,
    fee18: receipt.gasUsed * receipt.effectiveGasPrice,
  };
}
export async function settlementEvidence(
  m: NetworkManifest,
  id: bigint,
  c = publicClientFor(m) as PublicClient,
) {
  const canonical = await readCanonical(m, id, 0n, c);
  if (canonical.request.status !== 2)
    throw Error("Request has no paid receipt.");
  const head = await c.getBlockNumber({ cacheTime: 0 });
  const scan = await scanPages({
    from: m.deploymentBlock,
    to: head,
    fetch: (range) =>
      c.getContractEvents({
        address: m.contractAddress as Address,
        abi: SPLITLINK_ABI,
        eventName: "RequestPaid",
        args: { requestId: id, payer: canonical.request.payer as Address },
        fromBlock: range.from,
        toBlock: range.to,
      }),
    key: (l) => `${l.transactionHash}/${l.logIndex}`,
  });
  if (!scan.complete || scan.items.length !== 1)
    throw Error(
      "Paid — settlement transaction details temporarily unavailable.",
    );
  const receipt = await c.getTransactionReceipt({
    hash: scan.items[0].transactionHash,
  });
  return verifySettlementReceipt(m, id, c, receipt);
}
// Every production journal mutation (submit and background recovery) shares one
// origin-wide lock, including different wallets. Reload only AFTER acquiring it.
export async function recoverOperation(
  store: JournalStore,
  r: TransactionRecord,
  m: NetworkManifest,
  c = publicClientFor(m) as PublicClient,
) {
  if (!globalThis.navigator?.locks) return;
  await navigator.locks.request("splitlink-journal-write:v1", { ifAvailable: true }, async (lock) => {
    if (!lock) return;
    store.refreshFromStorage();
    if (store.warning) return;
    const current = store.records.find(record => record.recordId === r.recordId);
    if (current) await recoverUnlocked(store, current, m, c);
  });
}
async function recoverUnlocked(
  store: JournalStore,
  r: TransactionRecord,
  m: NetworkManifest,
  c: PublicClient,
) {
  if (r.chainId !== m.chainId || !equal(r.contractAddress, m.contractAddress))
    return;
  if (r.txState === "rejected" || r.txState === "cancelledByReplacement")
    return;
  if (r.nonce === null) {
    store.patch(r, { txState: "unknown", businessVerification: "unavailable", error: {
      code: "missingFrozenNonce", message: "缺少签名前固定的 nonce，不能将实际交易追认为原意图。"
    } });
    return;
  }
  if (!r.effectiveTxHash) {
    store.patch(r, {
      txState: "unknown",
      businessVerification: "unavailable",
      error: {
        code: "missingHash",
        message:
          "No transaction hash was saved. Check your wallet activity before trying again.",
      },
    });
    return;
  }
  try {
    await verifiedClient(m, c);
    const identity = await recoverRecord(c, r.effectiveTxHash as Hex, {
      expectedSender: r.account,
      expectedTarget: r.to,
      expectedCallData: r.callData,
      expectedChainId: r.chainId,
      expectedNonce: r.nonce,
      requireZeroValue: true,
    });
    if (identity.state !== "confirmed" && identity.state !== "reverted") {
      store.patch(r, {
        txState: identity.state === "submitted" ? "submitted" : "unknown",
        businessVerification: "unavailable",
        error: {
          code: "identityUnavailable",
          message:
            "reason" in identity ? identity.reason : "Identity unavailable.",
        },
      });
      return;
    }
    const receipt = await c.getTransactionReceipt({
      hash: r.effectiveTxHash as Hex,
    });
    store.patch(r, {
      txState: identity.state,
      receiptStatus: identity.receiptStatus,
      receiptBlock: identity.blockNumber.toString(),
      actualFee18: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
      businessVerification: "pending",
      error: null,
    });
    if (identity.state === "reverted") {
      if (r.requestId)
        await readCanonical(m, BigInt(r.requestId), receipt.blockNumber, c);
      store.patch(r, { businessVerification: "notChecked" });
      return;
    }
    const isApproval =
      r.operationType === "approve" || r.operationType === "approveReset";
    const abi = isApproval ? erc20Abi : SPLITLINK_ABI;
    const d = decodeFunctionData({ abi, data: r.callData as Hex });
    if (isApproval) {
      if (!equal(r.to, m.usdcAddress) || d.functionName !== "approve")
        throw Error("Approval target/method mismatch.");
      const args = d.args as readonly [Address, bigint];
      if (!equal(args[0], m.contractAddress) || !r.requestId)
        throw Error("Approval spender/request mismatch.");
      const current = await readCanonical(
        m,
        BigInt(r.requestId),
        receipt.blockNumber,
        c,
      );
      if (
        args[1] !==
        (r.operationType === "approveReset" ? 0n : current.request.totalAmount)
      )
        throw Error("Approval amount differs from canonical gross amount.");
      await funds(m, r.account as Address, c, current.block);
      const approvals = receipt.logs.filter(l => equal(l.address, m.usdcAddress)).flatMap(l => {
        try { return [decodeEventLog({ abi: erc20Abi, data: l.data, topics: l.topics, strict: true })]; } catch { return []; }
      }).filter(e => e.eventName === "Approval");
      const at = await funds(m, r.account as Address, c, receipt.blockNumber);
      if (approvals.length !== 1 || !equal(approvals[0].args.owner, r.account) ||
        !equal(approvals[0].args.spender, m.contractAddress) || approvals[0].args.value !== args[1] || at.allowance !== args[1])
        throw Error("授权事件或实际额度尚未核实；授权不是付款。");
    } else if (r.operationType === "create") {
      if (!equal(r.to, m.contractAddress) || d.functionName !== "createRequest")
        throw Error("Creation call mismatch.");
      const events = contractEvents(receipt, m).filter(
        (e) => e.eventName === "RequestCreated",
      );
      if (
        events.length !== 1 ||
        events[0].eventName !== "RequestCreated" ||
        !equal(events[0].args.creator, r.account)
      )
        throw Error("Creation event unavailable.");
      const id = events[0].args.requestId;
      const { request: created } = await readCanonical(
        m,
        id,
        receipt.blockNumber,
        c,
      );
      const args = d.args as readonly [
        string,
        bigint,
        readonly Address[],
        readonly number[],
      ];
      if (
        created.title !== args[0] ||
        created.totalAmount !== args[1] ||
        !equal(created.creator, r.account) ||
        serialize(created.recipients.map((a) => a.toLowerCase())) !==
          serialize(args[2].map((a) => a.toLowerCase())) ||
        serialize(created.sharesBps) !== serialize(args[3]) ||
        events[0].args.totalAmount !== created.totalAmount
      )
        throw Error("Created canonical terms mismatch.");
      store.patch(r, { requestId: id.toString() });
    } else {
      if (
        !equal(r.to, m.contractAddress) ||
        !r.requestId ||
        d.functionName !==
          (r.operationType === "pay" ? "payRequest" : "cancelRequest") ||
        d.args?.[0] !== BigInt(r.requestId)
      )
        throw Error("Exact request operation mismatch.");
      if (r.operationType === "pay") {
        const proof = await verifySettlementReceipt(
          m,
          BigInt(r.requestId),
          c,
          receipt,
        );
        if (!equal(proof.request.payer, r.account))
          throw Error("Canonical payer differs from attempt.");
      } else {
        const canonical = await readCanonical(
          m,
          BigInt(r.requestId),
          receipt.blockNumber,
          c,
        );
        if (
          canonical.request.status !== 3 ||
          !equal(canonical.request.creator, r.account) ||
          !contractEvents(receipt, m).some(
            (e) =>
              e.eventName === "RequestCancelled" &&
              e.args.requestId === BigInt(r.requestId!) &&
              equal(e.args.creator, r.account),
          )
        )
          throw Error("Cancellation status/event unverified.");
      }
    }
    store.patch(r, { businessVerification: "verified" });
  } catch (e) {
    store.patch(r, {
      businessVerification: "unavailable",
      error: { code: "businessUnavailable", message: errorMessage(e) },
    });
  }
}
