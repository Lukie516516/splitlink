// Actual production controller over isolated Anvil chain31338 only.
import { test, expect, beforeAll } from "bun:test";
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type EIP1193Provider,
  type PublicClient,
  type Hex,
} from "viem";
import { SPLITLINK_ABI } from "../../src/lib/splitlink";
import {
  JournalStore,
  STORAGE_KEY,
  type TransactionRecord,
} from "../../src/lib/journal";
import {
  prepareOperation,
  submitOperation,
  recoverOperation,
  requestIntent,
  approvalIntent,
  readCanonical,
  verifySettlementReceipt,
  type Intent,
} from "../../src/lib/runner";
import { type NetworkManifest } from "../../src/lib/manifest";
const raw = JSON.parse(fs.readFileSync("public/local-manifest.json", "utf8"));
const m: NetworkManifest = {
  ...raw,
  deploymentBlock: BigInt(raw.deploymentBlock),
};
if (m.chainId !== 31338 || m.rpcUrl !== "http://127.0.0.1:9547")
  throw Error("Refusing non-local integration.");
const c = createPublicClient({
    transport: http(m.rpcUrl),
    cacheTime: 0,
  }) as PublicClient,
  w = createWalletClient({ transport: http(m.rpcUrl) });
let accounts: Address[] = [];
beforeAll(async () => {
  accounts = await w.getAddresses();
});
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
}
function provider(
  account: Address,
  onPrompt?: (params: any) => Promise<void> | void,
): EIP1193Provider {
  return {
    request: async ({ method, params }: any) => {
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x7a6a";
      if (method === "eth_sendTransaction") await onPrompt?.(params[0]);
      return c.request({ method, params } as any);
    },
  } as EIP1193Provider;
}
function createCall(title = "local controller"): Intent {
  return {
    operation: "create",
    requestId: null,
    target: m.contractAddress as Address,
    data: encodeFunctionData({
      abi: SPLITLINK_ABI,
      functionName: "createRequest",
      args: [title, 10001n, [accounts[2], accounts[3]], [5000, 5000]],
    }),
    principal6: 0n,
  };
}
async function execute(
  call: Intent,
  account: Address = accounts[0],
  store = new JournalStore(memory()),
) {
  const prepared = await prepareOperation(m, account, call, c);
  const r = await submitOperation({
    m,
    account,
    call,
    reviewed: prepared.quote,
    c,
    provider: provider(account, (params) => {
      expect(params.from).toBe(account);
      expect(params.chainId).toBe("0x7a6a");
      expect(params.value).toBe("0x0");
      expect(params.to).toBe(call.target);
      expect(params.data).toBe(call.data);
      expect(BigInt(params.gas)).toBe(prepared.quote.gasLimit);
      expect(BigInt(params.maxFeePerGas)).toBe(prepared.quote.maxFeePerGas18);
    }),
    store,
    contextValid: () => true,
  });
  expect(r.txState).toBe("confirmed");
  expect(r.businessVerification).toBe("verified");
  return r;
}
async function create(title?: string) {
  const rec = await execute(createCall(title));
  return BigInt(rec.requestId!);
}
async function approveDirect(amount: bigint) {
  const hash = await w.writeContract({
    chain: null,
    account: accounts[1],
    address: m.usdcAddress as Address,
    abi: erc20Abi,
    functionName: "approve",
    args: [m.contractAddress as Address, amount],
  });
  await c.waitForTransactionReceipt({ hash });
}

test("actual all5 writes checkpoint: raw parameters frozen, independent hashes, full original-chain/business restore", async () => {
  const storage = memory(),
    store = new JournalStore(storage);
  const created = await execute(
    createCall("all-five restore"),
    accounts[0],
    store,
  );
  const id = BigInt(created.requestId!);
  const reset = await execute(
    approvalIntent(m, id, 10001n, true),
    accounts[1],
    store,
  );
  const approve = await execute(
    approvalIntent(m, id, 10001n),
    accounts[1],
    store,
  );
  const paid = await execute(
    requestIntent(m, "pay", id, 10001n),
    accounts[1],
    store,
  );
  const cancelId = await create("cancel restore");
  const cancelled = await execute(
    requestIntent(m, "cancel", cancelId),
    accounts[0],
    store,
  );
  expect(
    new Set([created, reset, approve, paid, cancelled].map((r) => r.txHash))
      .size,
  ).toBe(5);
  for (const state of [
    "prepared",
    "awaitingSignature",
    "submitted",
    "confirmed",
    "unknown",
  ] as const) {
    const checkpoint = store.records.map((r) => ({ ...r, txState: state }));
    storage.setItem(STORAGE_KEY, JSON.stringify(checkpoint));
    const restored = new JournalStore(storage);
    for (const r of restored.records) {
      await recoverOperation(restored, r, m, c);
      expect(r.txState).toBe("confirmed");
      expect(r.businessVerification).toBe("verified");
    }
  }
  expect((await readCanonical(m, id, 0n, c)).request.status).toBe(2);
}, 20000);

test("A2: every operation suppresses wallet prompt after delayed manifest/preflight context invalidation", async () => {
  const id = await create("context race");
  const calls = [
    createCall("stale create"),
    approvalIntent(m, id, 10001n, true),
    approvalIntent(m, id, 10001n),
    requestIntent(m, "pay", id, 10001n),
    requestIntent(m, "cancel", id),
  ];
  for (const call of calls) {
    if (call.operation === "pay") await approveDirect(10001n);
    const account =
      call.operation === "cancel" || call.operation === "create"
        ? accounts[0]
        : accounts[1];
    const quote = (await prepareOperation(m, account, call, c)).quote;
    let current = true,
      prompts = 0;
    const delayed = {
      ...c,
      getChainId: async () => {
        current = false;
        await Bun.sleep(5);
        return m.chainId;
      },
    } as PublicClient;
    await expect(
      submitOperation({
        m,
        account,
        call,
        reviewed: quote,
        c: delayed,
        provider: provider(account, () => {
          prompts++;
        }),
        store: new JournalStore(memory()),
        contextValid: () => current,
      }),
    ).rejects.toThrow("Context changed");
    expect(prompts).toBe(0);
    for (const drift of ["account", "chain"]) {
      const actual = provider(account, () => {
        prompts++;
      });
      const wrong = {
        request: async (args: any) =>
          args.method === "eth_accounts" && drift === "account"
            ? [accounts[4]]
            : args.method === "eth_chainId" && drift === "chain"
              ? "0x1"
              : actual.request(args),
      } as EIP1193Provider;
      await expect(
        submitOperation({
          m,
          account,
          call,
          reviewed: quote,
          c,
          provider: wrong,
          store: new JournalStore(memory()),
          contextValid: () => true,
        }),
      ).rejects.toThrow("Wallet context changed");
      expect(prompts).toBe(0);
    }
  }
}, 15000);

test("A6: approval hash cannot be written into a later pay prompt; no-hash/rejection stays operation-local", async () => {
  const id = await create("separate attempt IDs"),
    store = new JournalStore(memory());
  const approval = await execute(
    approvalIntent(m, id, 10001n),
    accounts[1],
    store,
  );
  const call = requestIntent(m, "pay", id, 10001n),
    quote = (await prepareOperation(m, accounts[1], call, c)).quote;
  const r = await submitOperation({
    m,
    account: accounts[1],
    call,
    reviewed: quote,
    c,
    store,
    contextValid: () => true,
    provider: provider(accounts[1], () => {
      const pending = store.records.find((r) => r.operationType === "pay")!;
      expect(pending.txHash).toBe(null);
      expect(pending.effectiveTxHash).toBe(null);
      expect(pending.recordId).not.toBe(approval.recordId);
      throw Object.assign(Error("explicit local refusal"), { code: 4001 });
    }),
  });
  expect(r.txState).toBe("rejected");
  expect(r.txHash).toBe(null);
  expect(approval.txHash).not.toBe(null);
  expect(approval.businessVerification).toBe("verified");
});

test("A7/A9: fresh canonical race prevents approval/payment; unrelated/malformed receipt evidence never becomes proof", async () => {
  const id = await create("canonical race"),
    approved = await execute(approvalIntent(m, id, 10001n), accounts[1]);
  const q = (
    await prepareOperation(
      m,
      accounts[1],
      requestIntent(m, "pay", id, 10001n),
      c,
    )
  ).quote;
  const paid = await execute(requestIntent(m, "pay", id, 10001n), accounts[1]);
  await expect(
    submitOperation({
      m,
      account: accounts[1],
      call: requestIntent(m, "pay", id, 10001n),
      reviewed: q,
      c,
      store: new JournalStore(memory()),
      provider: provider(accounts[1], () => {
        throw Error("must not prompt");
      }),
      contextValid: () => true,
    }),
  ).rejects.toThrow("Paid");
  const approvalReceipt = await c.getTransactionReceipt({
    hash: approved.txHash as Hex,
  });
  await expect(
    verifySettlementReceipt(m, id, c, approvalReceipt),
  ).rejects.toThrow();
  const receipt = await c.getTransactionReceipt({ hash: paid.txHash as Hex });
  expect(
    (
      await verifySettlementReceipt(m, id, c, receipt)
    ).request.payer.toLowerCase(),
  ).toBe(accounts[1].toLowerCase());
  for (const mutation of [
    { ...receipt, logs: [] },
    { ...receipt, status: "reverted" as const },
    { ...receipt, logs: [...receipt.logs].reverse() },
  ])
    await expect(verifySettlementReceipt(m, id, c, mutation)).rejects.toThrow();
});

test("two actual local wallets race one public request; exactly one canonical payer and a reverted loser", async () => {
  const id = await create("two payer race");
  for (const account of [accounts[1], accounts[4]]) {
    const hash = await w.writeContract({
      account,
      chain: null,
      address: m.usdcAddress as Address,
      abi: erc20Abi,
      functionName: "approve",
      args: [m.contractAddress as Address, 10001n],
    });
    await c.waitForTransactionReceipt({ hash });
  }
  const data = encodeFunctionData({
    abi: SPLITLINK_ABI,
    functionName: "payRequest",
    args: [id],
  });
  await c.request({ method: "evm_setAutomine" as any, params: [false] as any });
  let hashes: Hex[] = [];
  try {
    hashes = await Promise.all(
      [accounts[1], accounts[4]].map((account) =>
        w.sendTransaction({
          account,
          chain: null,
          to: m.contractAddress as Address,
          data,
          value: 0n,
          gas: 350000n,
        }),
      ),
    );
    await c.request({ method: "evm_mine" as any, params: [] as any });
  } finally {
    await c.request({
      method: "evm_setAutomine" as any,
      params: [true] as any,
    });
  }
  const receipts = await Promise.all(
    hashes.map((hash) => c.getTransactionReceipt({ hash })),
  );
  expect(receipts.filter((r) => r.status === "success").length).toBe(1);
  expect(receipts.filter((r) => r.status === "reverted").length).toBe(1);
  const canonical = await readCanonical(m, id, 0n, c);
  const winner = receipts.findIndex((r) => r.status === "success");
  expect(canonical.request.payer.toLowerCase()).toBe(
    [accounts[1], accounts[4]][winner].toLowerCase(),
  );
  const loser = receipts.find((r) => r.status === "reverted")!;
  await expect(verifySettlementReceipt(m, id, c, loser)).rejects.toThrow(
    "Failed receipt",
  );
});
