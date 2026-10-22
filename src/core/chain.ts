import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type EIP1193Provider,
} from "viem";
import { splitAbi } from "../abi";
import { client, verifyDeployment, type Manifest } from "./manifest";
import {
  allocate,
  funding,
  quote,
  policy,
  actualFee,
  type FeeQuote,
} from "./math";
import { scanLogs } from "./history";
import {
  Journal,
  sameCall,
  acceptReplacement,
  type Record,
  serialize,
} from "./journal";
export type RequestData = {
  creator: Address;
  title: string;
  totalAmount: bigint;
  recipients: readonly Address[];
  sharesBps: readonly number[];
  status: number;
  createdAt: bigint;
  payer: Address;
  paidAt: bigint;
};
export const statusName = (s: number) =>
  ["None", "Open", "Paid", "Cancelled"][s] ?? "Unknown";
export const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export async function readRequest(
  m: Manifest,
  id: bigint,
  minBlock = 0n,
  atBlock?: bigint,
) {
  const c = await verifyDeployment(m);
  const block = atBlock ?? (await c.getBlockNumber({ cacheTime: 0 }));
  if (block < minBlock) throw Error("RPC is behind the receipt block. Retry.");
  const [r, amounts] = await Promise.all([
    c.readContract({
      address: m.splitLinkAddress as Address,
      abi: splitAbi,
      functionName: "getRequest",
      args: [id],
      blockNumber: block,
    }),
    c.readContract({
      address: m.splitLinkAddress as Address,
      abi: splitAbi,
      functionName: "getAllocations",
      args: [id],
      blockNumber: block,
    }),
  ]);
  const expected = allocate(r.totalAmount, r.sharesBps);
  if (
    expected.some((a, i) => a !== amounts[i]) ||
    expected.length !== amounts.length
  )
    throw Error("integrationError: Allocation mismatch. Writes blocked.");
  return { data: r as RequestData, amounts, block };
}
export function decodedEvents(
  receipt: {
    logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[];
  },
  m: Manifest,
) {
  return receipt.logs
    .filter((l) => eq(l.address, m.splitLinkAddress))
    .flatMap((l) => {
      try {
        return [
          decodeEventLog({
            abi: splitAbi,
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
export async function settlement(m: Manifest, id: bigint, r: RequestData) {
  if (r.status !== 2) throw Error("Request has not been paid.");
  const c = client(m);
  const to = await c.getBlockNumber({ cacheTime: 0 });
  const logs = await scanLogs({
    from: BigInt(m.deploymentBlock),
    to,
    fetch: (range) =>
      c.getContractEvents({
        address: m.splitLinkAddress as Address,
        abi: splitAbi,
        eventName: "RequestPaid",
        args: { requestId: id, payer: r.payer },
        fromBlock: range.from,
        toBlock: range.to,
      }),
    key: (l) => `${l.transactionHash}/${l.logIndex}`,
  });
  if (!logs.complete || logs.items.length !== 1)
    throw Error(
      "Paid — settlement transaction details temporarily unavailable.",
    );
  const hash = logs.items[0].transactionHash;
  const receipt = await c.getTransactionReceipt({ hash });
  await verifyPaymentReceipt(m, id, r, receipt);
  return {
    hash,
    receipt,
    fee: actualFee(receipt.gasUsed, receipt.effectiveGasPrice),
  };
}
export async function verifyPaymentReceipt(
  m: Manifest,
  id: bigint,
  r: RequestData,
  receipt: Awaited<
    ReturnType<ReturnType<typeof client>["getTransactionReceipt"]>
  >,
) {
  const canonical = await readRequest(m, id, receipt.blockNumber);
  if (
    canonical.data.status !== 2 ||
    !eq(canonical.data.payer, r.payer) ||
    receipt.status !== "success"
  )
    throw Error("Settlement receipt mismatch.");
  const tx = await client(m).getTransaction({ hash: receipt.transactionHash });
  if (
    !tx.to ||
    !eq(tx.to, m.splitLinkAddress) ||
    !eq(tx.from, r.payer) ||
    tx.value !== 0n
  )
    throw Error("Settlement call mismatch.");
  const decoded = decodeFunctionData({ abi: splitAbi, data: tx.input });
  if (
    !eq(tx.from, r.payer) ||
    !tx.to ||
    !eq(tx.to, m.splitLinkAddress) ||
    tx.value !== 0n ||
    decoded.functionName !== "payRequest" ||
    decoded.args?.[0] !== id
  )
    throw Error("Settlement call mismatch.");
  const events = decodedEvents(receipt, m);
  const paid = events.filter((e) => e.eventName === "RequestPaid");
  const recipients = events.filter((e) => e.eventName === "RecipientPaid");
  if (
    paid.length !== 1 ||
    paid[0].args.requestId !== id ||
    !eq(paid[0].args.payer, r.payer) ||
    paid[0].args.totalAmount !== r.totalAmount ||
    recipients.length !== r.recipients.length
  )
    throw Error("Settlement event mismatch.");
  const allocations = allocate(r.totalAmount, r.sharesBps);
  for (let i = 0; i < recipients.length; i++) {
    const e = recipients[i].args;
    if (
      e.requestId !== id ||
      !eq(e.recipient, r.recipients[i]) ||
      e.amount !== allocations[i]
    )
      throw Error("Recipient evidence mismatch.");
  }
}
export type CallIntent = {
  operationType: Record["operationType"];
  requestId: bigint | null;
  to: Address;
  data: Hex;
  intent: { [key: string]: unknown };
  principal: bigint;
};
const simulationTokenAbi = [
  ...erc20Abi,
  ...parseAbi([
    "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)",
    "error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)",
    "error ERC20InvalidReceiver(address receiver)",
  ]),
];
export function requestCall(
  m: Manifest,
  operation: "pay" | "cancel",
  id: bigint,
  total = 0n,
): CallIntent {
  return {
    operationType: operation,
    requestId: id,
    to: m.splitLinkAddress as Address,
    data: encodeFunctionData({
      abi: splitAbi,
      functionName: operation === "pay" ? "payRequest" : "cancelRequest",
      args: [id],
    }),
    intent: { requestId: id.toString() },
    principal: operation === "pay" ? total : 0n,
  };
}
export function approvalCall(
  m: Manifest,
  id: bigint,
  amount: bigint,
  reset = false,
): CallIntent {
  return {
    operationType: reset ? "approveReset" : "approve",
    requestId: id,
    to: m.usdcAddress as Address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [m.splitLinkAddress as Address, reset ? 0n : amount],
    }),
    intent: {
      spender: m.splitLinkAddress,
      amount: (reset ? 0n : amount).toString(),
    },
    principal: amount,
  };
}
export async function preflight(
  m: Manifest,
  account: Address,
  call: CallIntent,
): Promise<FeeQuote & { balance6: bigint; nativeBalance18: bigint }> {
  if (!m.writesEnabled)
    throw Error("This deployment is not enabled for writes.");
  const c = await verifyDeployment(m);
  const block = await c.getBlock({ blockTag: "latest" });
  if (call.requestId !== null) {
    const { data: r } = await readRequest(
      m,
      call.requestId,
      block.number,
      block.number,
    );
    if (r.status !== 1)
      throw Error(
        `Request is ${statusName(r.status)}. Refresh request status.`,
      );
    if (call.operationType === "cancel" && !eq(r.creator, account))
      throw Error("Only the creator can cancel this request.");
    if (call.operationType === "pay") {
      const a = await c.readContract({
        address: m.usdcAddress as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, m.splitLinkAddress as Address],
        blockNumber: block.number,
      });
      if (a < r.totalAmount)
        throw Error("USDC approval is still insufficient.");
    }
  }
  const [b6, b18, fees] = await Promise.all([
    c.readContract({
      address: m.usdcAddress as Address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account],
      blockNumber: block.number,
    }),
    c.getBalance({ address: account, blockNumber: block.number }),
    c.estimateFeesPerGas(),
  ]);
  if (m.sharedBalance && b18 / 1000000000000n !== b6)
    throw Error(
      "rpcUnavailable: Inconsistent shared balance reads. Retry at a fresh block.",
    );
  if (b6 < call.principal)
    throw Error(
      "insufficientPrincipal: Insufficient USDC for the request total.",
    );
  try {
    const abi = eq(call.to, m.usdcAddress) ? simulationTokenAbi : splitAbi;
    const decoded = decodeFunctionData({ abi, data: call.data });
    await c.simulateContract({
      account,
      address: call.to,
      abi: abi as Abi,
      functionName: decoded.functionName,
      args: decoded.args,
      value: 0n,
      blockNumber: block.number,
    });
  } catch (e) {
    throw classify(e, "estimateUnavailable");
  }
  let gas: bigint;
  try {
    gas = await c.estimateGas({
      account,
      to: call.to,
      data: call.data,
      value: 0n,
    });
  } catch (e) {
    throw classify(e, "estimateUnavailable");
  }
  const q = quote(
    gas,
    fees.maxFeePerGas,
    fees.maxPriorityFeePerGas,
    block.baseFeePerGas ?? 0n,
    block.number,
  );
  funding(call.principal, b6, b18, q, Date.now(), m.sharedBalance);
  return { ...q, balance6: b6, nativeBalance18: b18 };
}
export function classify(e: unknown, fallback = "rpcUnavailable") {
  const s = errorText(e);
  if (/revert|RequestNotFound|RequestNotOpen|insufficient allowance/i.test(s))
    return Error(
      `simulationReverted: This transaction cannot be executed: ${s}`,
    );
  if (/http|fetch|timeout|network|socket/i.test(s))
    return Error(
      `rpcUnavailable: Unable to reach the network. Balance and transaction status are unknown. Retry. ${s}`,
    );
  return Error(`${fallback}: ${s}`);
}
export function errorText(e: unknown) {
  const parts: string[] = [];
  let cursor = e as
    | {
        shortMessage?: string;
        details?: string;
        message?: string;
        data?: { errorName?: string };
        cause?: unknown;
      }
    | undefined;
  for (let i = 0; cursor && i < 8; i++) {
    if (cursor.data?.errorName) parts.push(cursor.data.errorName);
    if (cursor.shortMessage) parts.push(cursor.shortMessage);
    if (cursor.details) parts.push(cursor.details);
    cursor = cursor.cause as typeof cursor;
  }
  return [...new Set(parts)].join(" ") || (e as Error)?.message || String(e);
}
export async function walletContext(provider: EIP1193Provider) {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ]);
  return {
    account: accounts[0] as Address | undefined,
    chainId: Number(chain),
  };
}
export async function send(
  m: Manifest,
  account: Address,
  call: CallIntent,
  reviewed: FeeQuote,
  provider: EIP1193Provider,
  j: Journal,
  onChange: () => void,
) {
  if (Date.now() - reviewed.quotedAt > policy.quoteTtlMs)
    throw Error("staleQuote: Network fee quote expired. Review a fresh quote.");
  // Re-simulate/read all prerequisites just before prompting. A materially larger cap requires review again.
  const fresh = await preflight(m, account, call);
  if (
    fresh.budget > reviewed.budget ||
    fresh.gas > reviewed.gas ||
    fresh.maxFeePerGas > reviewed.maxFeePerGas
  )
    throw Error("staleQuote: Fee budget increased. Review a fresh quote.");
  // The user signs the reviewed cap, which may exceed the fresh recommendation.
  funding(
    call.principal,
    fresh.balance6,
    fresh.nativeBalance18,
    reviewed,
    Date.now(),
    m.sharedBalance,
  );
  const context = await walletContext(provider);
  if (Date.now() - reviewed.quotedAt > policy.quoteTtlMs)
    throw Error("staleQuote: Network fee quote expired. Review again.");
  if (
    !context.account ||
    !eq(context.account, account) ||
    context.chainId !== m.chainId
  )
    throw Error("Wallet context changed. Review again on the correct network.");
  const r = j.add({
    chainId: m.chainId,
    contractAddress: m.splitLinkAddress,
    account,
    operationType: call.operationType,
    requestId: call.requestId?.toString() ?? null,
    to: call.to,
    callData: call.data,
    intent: JSON.parse(serialize(call.intent)),
  });
  j.update(r, {
    submittedAtBlock: fresh.block.toString(),
    txState: "awaitingSignature",
  });
  onChange();
  try {
    const hex = (n: bigint) => `0x${n.toString(16)}` as Hex;
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: account,
          to: call.to,
          data: call.data,
          value: "0x0",
          chainId: hex(BigInt(m.chainId)),
          gas: hex(reviewed.gas),
          maxFeePerGas: hex(reviewed.maxFeePerGas),
          maxPriorityFeePerGas: hex(reviewed.maxPriorityFeePerGas),
        },
      ],
    });
    j.update(r, { txHash: hash, effectiveTxHash: hash, txState: "submitted" });
    onChange();
    const c = client(m);
    try {
      const tx = await c.getTransaction({ hash });
      j.update(r, { nonce: tx.nonce.toString() });
    } catch {
      /* keep saved hash */
    }
    await c.waitForTransactionReceipt({
      hash,
      timeout: 120000,
      pollingInterval: 1500,
      onReplaced: async (replacement) => {
        try {
          await acceptReplacement(
            j,
            r,
            replacement.transaction.hash,
            (h) => c.getTransaction({ hash: h }),
            (h) => c.getTransactionReceipt({ hash: h }),
          );
          onChange();
        } catch {
          /* retain original unresolved attempt */
        }
      },
    });
  } catch (e) {
    const code = (e as { code?: number }).code;
    j.update(r, {
      txState: !r.txHash && code === 4001 ? "rejected" : "unknown",
      error:
        !r.txHash && code !== 4001
          ? "No transaction hash was saved. Check your wallet activity before trying again."
          : errorText(e),
    });
  }
  await reconcile(j, r, m);
  onChange();
  return r;
}
export async function reconcile(j: Journal, r: Record, m: Manifest) {
  if (["rejected", "cancelledByReplacement"].includes(r.txState)) return;
  if (!r.effectiveTxHash) {
    j.update(r, {
      txState: "unknown",
      businessVerification: "notChecked",
      receiptStatus: null,
      receiptBlock: null,
      error:
        "No transaction hash was saved. Check your wallet activity before trying again.",
    });
    return;
  }
  const c = client(m);
  try {
    const hash = r.effectiveTxHash as Hex;
    const tx = await c.getTransaction({ hash });
    if (!sameCall(r, tx)) {
      j.update(r, {
        txState: "unknown",
        businessVerification: "mismatch",
        error: "Stored transaction intent does not match chain transaction.",
      });
      return;
    }
    j.update(r, { nonce: tx.nonce.toString() });
    let receipt;
    try {
      receipt = await c.getTransactionReceipt({ hash });
    } catch {
      j.update(r, {
        txState: tx.blockNumber === null ? "submitted" : "unknown",
      });
      return;
    }
    j.update(r, {
      txState: receipt.status === "success" ? "confirmed" : "reverted",
      receiptBlock: receipt.blockNumber.toString(),
      receiptStatus: receipt.status,
      businessVerification: "pending",
      actualFee18: actualFee(
        receipt.gasUsed,
        receipt.effectiveGasPrice,
      ).toString(),
      error: null,
    });
    if (receipt.status !== "success") {
      if (r.requestId)
        await readRequest(m, BigInt(r.requestId), receipt.blockNumber);
      j.update(r, { businessVerification: "notChecked" });
      return;
    }
    const events = decodedEvents(receipt, m);
    if (r.operationType === "create") {
      const found = events.filter(
        (e) =>
          e.eventName === "RequestCreated" && eq(e.args.creator, r.account),
      );
      if (found.length !== 1) throw Error("Creation event unavailable.");
      const event = found[0];
      if (event.eventName !== "RequestCreated") throw Error("Invalid event.");
      const { data: req } = await readRequest(
        m,
        event.args.requestId,
        receipt.blockNumber,
      );
      const terms = {
        title: req.title,
        totalAmount: req.totalAmount.toString(),
        recipients: req.recipients.map((a) => a.toLowerCase()),
        sharesBps: req.sharesBps.map(String),
      };
      const intent = r.intent as {
        title: string;
        totalAmount: string;
        recipients: string[];
        sharesBps: string[];
      };
      if (
        !eq(req.creator, r.account) ||
        event.args.totalAmount !== req.totalAmount ||
        serialize(terms) !==
          serialize({
            ...intent,
            recipients: intent.recipients.map((a) => a.toLowerCase()),
          })
      )
        throw Error("Creation terms mismatch.");
      j.update(r, {
        requestId: event.args.requestId.toString(),
        businessVerification: "verified",
      });
    } else if (r.operationType === "pay") {
      const { data: req } = await readRequest(
        m,
        BigInt(r.requestId!),
        receipt.blockNumber,
      );
      if (!eq(req.payer, r.account))
        throw Error("Actual payer differs from this attempt.");
      await verifyPaymentReceipt(m, BigInt(r.requestId!), req, receipt);
      j.update(r, { businessVerification: "verified" });
    } else if (r.operationType === "cancel") {
      const { data: req } = await readRequest(
        m,
        BigInt(r.requestId!),
        receipt.blockNumber,
      );
      if (
        req.status !== 3 ||
        !events.some(
          (e) =>
            e.eventName === "RequestCancelled" &&
            e.args.requestId === BigInt(r.requestId!) &&
            eq(e.args.creator, r.account),
        )
      )
        throw Error("Cancellation business result unverified.");
      j.update(r, { businessVerification: "verified" });
    } else {
      if (!eq(r.to, m.usdcAddress)) throw Error("Wrong approval token.");
      const decoded = decodeFunctionData({
        abi: erc20Abi,
        data: r.callData as Hex,
      });
      if (
        decoded.functionName !== "approve" ||
        !eq(decoded.args[0], m.splitLinkAddress) ||
        decoded.args[1].toString() !== r.intent.amount
      )
        throw Error("Approval call mismatch.");
      const block = await c.getBlockNumber({ cacheTime: 0 });
      if (block < receipt.blockNumber) throw Error("Stale RPC.");
      await Promise.all([
        c.readContract({
          address: m.usdcAddress as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [r.account as Address, m.splitLinkAddress as Address],
          blockNumber: block,
        }),
        c.getBalance({ address: r.account as Address, blockNumber: block }),
        c.readContract({
          address: m.usdcAddress as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [r.account as Address],
          blockNumber: block,
        }),
        readRequest(m, BigInt(r.requestId!), receipt.blockNumber),
      ]);
      j.update(r, { businessVerification: "verified" });
    }
  } catch (e) {
    j.update(r, {
      txState: r.receiptStatus
        ? r.receiptStatus === "success"
          ? "confirmed"
          : "reverted"
        : "unknown",
      businessVerification: "unavailable",
      error: errorText(e),
    });
  }
}
