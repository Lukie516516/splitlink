// ISOLATED LOCAL EVM / MOCK TOKEN. Never points at an external RPC.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import {
  createPublicClient,
  createWalletClient,
  http as transport,
  encodeFunctionData,
  erc20Abi,
  decodeFunctionData,
  type Address,
  type Hex,
  type EIP1193Provider,
} from "viem";
import { splitAbi } from "../../src/abi";
import { client, type Manifest } from "../../src/core/manifest";
import {
  approvalCall,
  preflight,
  readRequest,
  reconcile,
  requestCall,
  send,
  verifyPaymentReceipt,
  type CallIntent,
} from "../../src/core/chain";
import { Journal, serialize } from "../../src/core/journal";
const base = JSON.parse(
  fs.readFileSync("public/local-manifest.json", "utf8"),
) as Manifest;
assert.equal(base.environment, "local-mock");
assert.equal(base.chainId, 31337);
assert.equal(base.rpcUrl, "http://127.0.0.1:8545");
let fault: ((body: any) => any | undefined) | undefined;
const server = http.createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const injected = fault?.(body);
    const response =
      injected ??
      (await (
        await fetch(base.rpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: raw,
        })
      ).json());
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
});
const m = { ...base, rpcUrl: "http://127.0.0.1:9545" };
const original = createPublicClient({ transport: transport(base.rpcUrl) });
const rawWallet = createWalletClient({ transport: transport(base.rpcUrl) });
let accounts: Address[];
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
  };
};
function wallet(account: Address): EIP1193Provider {
  return {
    request: async ({ method, params }: any) => {
      if (method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0x7a69";
      return original.request({ method, params } as any);
    },
  } as EIP1193Provider;
}
async function execute(call: CallIntent, account = accounts[0]) {
  const store = storage(),
    j = new Journal(store);
  const q = await preflight(m, account, call);
  const record = await send(m, account, call, q, wallet(account), j, () => {});
  assert.equal(record.txState, "confirmed");
  assert.equal(record.businessVerification, "verified");
  return { record, store, j };
}
async function create(title = "local integration") {
  return execute({
    operationType: "create",
    requestId: null,
    to: m.splitLinkAddress as Address,
    data: encodeFunctionData({
      abi: splitAbi,
      functionName: "createRequest",
      args: [title, 10001n, [accounts[2], accounts[3]], [5000, 5000]],
    }),
    intent: {
      title,
      totalAmount: "10001",
      recipients: [accounts[2], accounts[3]],
      sharesBps: ["5000", "5000"],
    },
    principal: 0n,
  });
}
async function approveDirect(account: Address, amount: bigint) {
  const hash = await rawWallet.sendTransaction({
    account,
    chain: null,
    to: m.usdcAddress as Address,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [m.splitLinkAddress as Address, amount],
    }),
  });
  await original.waitForTransactionReceipt({ hash });
}
before(async () => {
  await new Promise<void>((r) => server.listen(9545, "127.0.0.1", r));
  accounts = await rawWallet.getAddresses();
});
after(async () => {
  fault = undefined;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});

test("LOCAL: real preflight independently estimates approval when payment cannot estimate; all five operations recover on original chain", async () => {
  const created = await create("all-five recovery");
  const id = BigInt(created.record.requestId!);
  await approveDirect(accounts[1], 0n);
  await assert.rejects(
    preflight(m, accounts[1], requestCall(m, "pay", id, 10001n)),
    /approval.*insufficient/i,
  );
  const reset = await execute(approvalCall(m, id, 10001n, true), accounts[1]);
  const approved = await execute(approvalCall(m, id, 10001n), accounts[1]);
  const paid = await execute(requestCall(m, "pay", id, 10001n), accounts[1]);
  const cancellation = await create("cancel recovery");
  const cancelled = await execute(
    requestCall(m, "cancel", BigInt(cancellation.record.requestId!)),
  );
  for (const run of [created, reset, approved, paid, cancelled]) {
    const restored = new Journal(run.store),
      r = restored.records[0];
    await reconcile(restored, r, m);
    assert.equal(r.txState, "confirmed");
    assert.equal(r.businessVerification, "verified");
    assert.equal(r.account, run.record.account);
    assert.equal(r.chainId, 31337);
    assert.equal(r.effectiveTxHash, run.record.effectiveTxHash);
  }
  assert.equal((await readRequest(m, id)).data.status, 2);
  assert.equal(
    (await readRequest(m, BigInt(cancellation.record.requestId!))).data.status,
    3,
  );
});

test("LOCAL: transient receipt absence/transport failure remain unresolved; lagging postreceipt reads never verify business success", async () => {
  const run = await create("faulted creation recovery");
  const r = run.record;
  fault = (body) =>
    body.method === "eth_getTransactionReceipt"
      ? {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "injected unavailable receipt" },
        }
      : undefined;
  run.j.update(r, {
    txState: "submitted",
    receiptStatus: null,
    receiptBlock: null,
    businessVerification: "notChecked",
  });
  await reconcile(run.j, r, m);
  assert.equal(r.txState, "unknown");
  assert.notEqual(r.businessVerification, "verified");
  fault = (body) =>
    body.method === "eth_blockNumber"
      ? { jsonrpc: "2.0", id: body.id, result: "0x0" }
      : undefined;
  await reconcile(run.j, r, m);
  assert.equal(r.txState, "confirmed");
  assert.equal(r.businessVerification, "unavailable");
  fault = undefined;
  await reconcile(run.j, r, m);
  assert.equal(r.businessVerification, "verified");
});

test("LOCAL: approval/payment receipt is never accepted as unrelated settlement proof; changed stored call is mismatch", async () => {
  const created = await create("proof rejection");
  const id = BigInt(created.record.requestId!);
  const approved = await execute(approvalCall(m, id, 10001n), accounts[1]);
  await execute(requestCall(m, "pay", id, 10001n), accounts[1]);
  const canonical = (await readRequest(m, id)).data;
  const approvalReceipt = await client(m).getTransactionReceipt({
    hash: approved.record.txHash as Hex,
  });
  await assert.rejects(
    verifyPaymentReceipt(m, id, canonical, approvalReceipt),
    /mismatch/,
  );
  const r = created.record;
  created.j.update(r, {
    callData: "0x1234",
    businessVerification: "notChecked",
  });
  await reconcile(created.j, r, m);
  assert.equal(r.businessVerification, "mismatch");
  assert.equal(r.txState, "unknown");
});

test("LOCAL: canonical Paid beats a fresh payment review; stale quotes and context changes never prompt; fee/balance failures stay distinct", async () => {
  const created = await create("race and funding");
  const id = BigInt(created.record.requestId!);
  await approveDirect(accounts[1], 10001n);
  const call = requestCall(m, "pay", id, 10001n);
  const q = await preflight(m, accounts[1], call);
  let prompts = 0;
  const provider = {
    request: async (args: any) => {
      if (args.method === "eth_sendTransaction") prompts++;
      return wallet(accounts[1]).request(args);
    },
  } as EIP1193Provider;
  await assert.rejects(
    send(
      m,
      accounts[1],
      call,
      { ...q, quotedAt: Date.now() - 31000 },
      provider,
      new Journal(storage()),
      () => {},
    ),
    /staleQuote/,
  );
  await assert.rejects(
    send(
      m,
      accounts[1],
      call,
      q,
      wallet(accounts[4]),
      new Journal(storage()),
      () => {},
    ),
    /context changed/,
  );
  await execute(call, accounts[1]);
  await assert.rejects(preflight(m, accounts[1], call), /Paid/);
  assert.equal(prompts, 0);
  const other = await create("funding failures");
  const otherId = BigInt(other.record.requestId!);
  const approval = approvalCall(m, otherId, 10001n);
  fault = (body) =>
    body.method === "eth_getBalance"
      ? { jsonrpc: "2.0", id: body.id, result: "0x0" }
      : undefined;
  await assert.rejects(
    preflight(m, accounts[1], approval),
    /insufficientFeeBudget/,
  );
  fault = (body) =>
    body.method === "eth_call" && body.params[0].data.startsWith("0x70a08231")
      ? { jsonrpc: "2.0", id: body.id, result: "0x" + "0".repeat(64) }
      : undefined;
  await assert.rejects(
    preflight(m, accounts[1], approval),
    /insufficientPrincipal/,
  );
  fault = (body) =>
    body.method === "eth_estimateGas"
      ? {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "injected estimate unavailable" },
        }
      : undefined;
  await assert.rejects(
    preflight(m, accounts[1], approval),
    /estimateUnavailable/,
  );
  fault = undefined;
});
