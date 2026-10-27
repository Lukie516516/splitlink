import { test, expect } from "bun:test";
import {
  encodeFunctionData,
  keccak256,
  erc20Abi,
  type PublicClient,
} from "viem";
import {
  SPLITLINK_ABI,
  parsePercentage,
  parseDraftAmount,
  computeAllocations,
  formatUsdc6,
} from "../src/lib/splitlink";
import {
  JournalStore,
  STORAGE_KEY,
  clearCachedSuccessOnRestore_PROD,
  isValidRecord_PROD,
  recoverRecord,
  verifyReplacement,
  type TransactionRecord,
} from "../src/lib/journal";
import {
  verifyManifestOnChain,
  type NetworkManifest,
} from "../src/lib/manifest";
import {
  runPreflight,
  checkFunding,
  formatFee18,
  makeContextKey,
  verifySigningContext,
} from "../src/lib/preflight";
import { HistoryCursor, scanPages, boundedMap } from "../src/lib/history";
const account = "0x1111111111111111111111111111111111111111",
  target = "0x2222222222222222222222222222222222222222",
  token = "0x3600000000000000000000000000000000000000",
  other = "0x3333333333333333333333333333333333333333";
const hash = ("0x" + "a".repeat(64)) as `0x${string}`;
const m: NetworkManifest = {
  chainId: 5042002,
  chainName: "Arc Testnet",
  contractAddress: target,
  deploymentBlock: 2n,
  usdcAddress: token,
  explorerBase: "https://explorer.testnet.arc.io",
  contractVersion: "1.0.0",
  isDeployed: true,
  hasDeploymentBlock: true,
  expectedBytecodeHash: keccak256("0x6000"),
  rpcUrl: "https://rpc.testnet.arc.io",
  environment: "arc-testnet",
  sharedBalance: true,
  runtimeVerified: false,
};
function manifestClient(overrides: any = {}) {
  return {
    getChainId: async () => 5042002,
    getCode: async (p: any) => (p.blockNumber === 1n ? "0x" : "0x6000"),
    getBlockNumber: async () => 100n,
    readContract: async (p: any) =>
      p.functionName === "USDC"
        ? token
        : p.functionName === "CONTRACT_VERSION"
          ? "1.0.0"
          : 6,
    ...overrides,
  } as unknown as PublicClient;
}
const call = encodeFunctionData({
  abi: SPLITLINK_ABI,
  functionName: "payRequest",
  args: [1n],
});
function record(
  op: TransactionRecord["operationType"] = "pay",
): TransactionRecord {
  return {
    schemaVersion: 1,
    recordId: crypto.randomUUID(),
    chainId: 5042002,
    contractAddress: target,
    account,
    operationType: op,
    requestId: op === "create" ? null : "1",
    to: target,
    callData: call,
    value18: "0",
    intent: {},
    txHash: hash,
    effectiveTxHash: hash,
    replacementHashes: [],
    nonce: "7",
    submittedAtBlock: "10",
    createdAtMs: 1,
    updatedAtMs: 1,
    txState: "confirmed",
    businessVerification: "verified",
    receiptBlock: "12",
    receiptStatus: "success",
    replacementKind: null,
    error: null,
  };
}
function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}
const options = {
  expectedTarget: target,
  expectedSender: account,
  expectedCallData: call,
  expectedNonce: "7",
  requireZeroValue: true,
};
function identityClient(input = call, overrides: any = {}) {
  return {
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 12n,
      transactionHash: hash,
      to: target,
      from: account,
    }),
    getTransaction: async () => ({
      to: target,
      from: account,
      value: 0n,
      input,
      nonce: 7,
    }),
    ...overrides,
  } as unknown as PublicClient;
}

test("A1: production verifier requires reviewed keccak/runtime, immutable USDC, precision, version, chain/block and RPC", async () => {
  expect((await verifyManifestOnChain(manifestClient(), m)).allPassed).toBe(
    true,
  );
  for (const patch of [
    { expectedBytecodeHash: "" },
    { expectedBytecodeHash: "SHA256-not-keccak" },
    { expectedBytecodeHash: keccak256("0x6001") },
    { deploymentBlock: 0n },
    { hasDeploymentBlock: false },
    { usdcAddress: other },
  ])
    expect(
      (await verifyManifestOnChain(manifestClient(), { ...m, ...patch }))
        .allPassed,
    ).toBe(false);
  for (const c of [
    manifestClient({ getChainId: async () => 1 }),
    manifestClient({ getCode: async () => "0x" }),
    manifestClient({ getBlockNumber: async () => 1n }),
    manifestClient({
      readContract: async (p: any) =>
        p.functionName === "USDC"
          ? other
          : p.functionName === "CONTRACT_VERSION"
            ? "1.0.0"
            : 6,
    }),
    manifestClient({
      readContract: async () => {
        throw Error("RPC offline");
      },
    }),
  ])
    expect((await verifyManifestOnChain(c, m)).allPassed).toBe(false);
});
test("A4: actual journal hydrate clears forged authority in EVERY state; live reads/save preserve newly verified state", () => {
  for (const txState of [
    "prepared",
    "awaitingSignature",
    "submitted",
    "confirmed",
    "reverted",
    "rejected",
    "unknown",
    "replaced",
    "cancelledByReplacement",
  ] as const) {
    const storage = memory();
    storage.setItem(STORAGE_KEY, JSON.stringify([{ ...record(), txState }]));
    const store = new JournalStore(storage);
    expect(store.records[0].businessVerification).toBe("notChecked");
    expect(store.records[0].receiptStatus).toBe(null);
    expect(store.records[0].receiptBlock).toBe(null);
  }
  const storage = memory(),
    store = new JournalStore(storage),
    r = record();
  store.put(r);
  store.put(record("approve"));
  expect(
    store.records.find((x) => x.recordId === r.recordId)!.businessVerification,
  ).toBe("verified");
  expect(
    new JournalStore(storage).records.every(
      (x) => x.businessVerification === "notChecked",
    ),
  ).toBe(true);
  const unknown = {
    ...record(),
    txHash: null,
    effectiveTxHash: null,
    txState: "awaitingSignature" as const,
  };
  storage.setItem(STORAGE_KEY, JSON.stringify([unknown]));
  expect(new JournalStore(storage).records[0].txState).toBe("unknown");
});
test("A4: schema/storage/quarantine errors are visible and never trusted", () => {
  for (const patch of [
    { value18: "1" },
    { account: "0x123" },
    { txHash: "fake" },
    { callData: "nope" },
    { nonce: "-1" },
    { operationType: "withdraw" },
    { receiptStatus: "fake" },
    { businessVerification: "yes" },
  ])
    expect(isValidRecord_PROD({ ...record(), ...patch })).toBe(false);
  const bad = new JournalStore({ getItem: () => "{bad", setItem: () => {} });
  expect(bad.warning).toContain("unavailable");
  const denied = new JournalStore({
    getItem: () => null,
    setItem: () => {
      throw Error("quota");
    },
  });
  denied.put(record());
  expect(denied.warning).toContain("Save the transaction hash");
});
test("A5: exact production recovery rejects changed title CASE, amount, order, shares, appended calldata and different IDs", async () => {
  const expected = encodeFunctionData({
    abi: SPLITLINK_ABI,
    functionName: "createRequest",
    args: ["Invoice", 10001n, [account, other], [5000, 5000]],
  });
  const variants = [
    ["invoice", 10001n, [account, other], [5000, 5000]],
    ["Invoice", 10002n, [account, other], [5000, 5000]],
    ["Invoice", 10001n, [other, account], [5000, 5000]],
    ["Invoice", 10001n, [account, other], [5001, 4999]],
  ] as const;
  for (const args of variants) {
    const input = encodeFunctionData({
      abi: SPLITLINK_ABI,
      functionName: "createRequest",
      args,
    });
    expect(
      (
        await recoverRecord(identityClient(input), hash, {
          ...options,
          expectedCallData: expected,
          abi: SPLITLINK_ABI,
        })
      ).state,
    ).toBe("unknown");
  }
  for (const input of [
    (expected + "00") as `0x${string}`,
    encodeFunctionData({
      abi: SPLITLINK_ABI,
      functionName: "payRequest",
      args: [2n],
    }),
  ])
    expect(
      (
        await recoverRecord(identityClient(input), hash, {
          ...options,
          expectedCallData: expected,
          abi: SPLITLINK_ABI,
        })
      ).state,
    ).toBe("unknown");
  const approve = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [target, 10001n],
  });
  for (const args of [
    [other, 10001n],
    [target, 10000n],
  ] as const)
    expect(
      (
        await recoverRecord(
          identityClient(
            encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args,
            }),
          ),
          hash,
          { ...options, expectedCallData: approve, abi: erc20Abi },
        )
      ).state,
    ).toBe("unknown");
});
test("A5: sender/target/value/nonce/missing body/receipt mismatch cannot confirm", async () => {
  for (const patch of [
    { to: other },
    { from: other },
    { value: 1n },
    { nonce: 8 },
  ])
    expect(
      (
        await recoverRecord(
          identityClient(call, {
            getTransaction: async () => ({
              to: target,
              from: account,
              value: 0n,
              input: call,
              nonce: 7,
              ...patch,
            }),
          }),
          hash,
          options,
        )
      ).state,
    ).toBe("unknown");
  expect(
    (
      await recoverRecord(
        identityClient(call, {
          getTransaction: async () => {
            throw Error("RPC temporarily unavailable");
          },
        }),
        hash,
        options,
      )
    ).state,
  ).toBe("unknown");
  expect((await recoverRecord(identityClient(), hash, options)).state).toBe(
    "confirmed",
  );
});
test("replacement: only same sender/nonce exact call reprices; final changed call cannot be payment proof", async () => {
  const store = new JournalStore(memory()),
    r = record();
  store.put(r);
  await verifyReplacement(store, r, hash, {
    ...identityClient(),
    getChainId: async () => 5042002,
  } as any);
  expect(r.replacementKind).toBe("repriced");
  await expect(
    verifyReplacement(store, r, hash, {
      ...identityClient(),
      getChainId: async () => 1,
    } as any),
  ).rejects.toThrow("chain");
  await verifyReplacement(store, r, hash, {
    ...identityClient(call, {
      getTransaction: async () => ({
        from: account,
        to: account,
        value: 0n,
        input: "0x",
        nonce: 7,
      }),
    }),
    getChainId: async () => 5042002,
  } as any);
  expect(r.txState).toBe("cancelledByReplacement");
  expect(r.businessVerification).toBe("mismatch");
});
function preflightClient(overrides: any = {}) {
  return {
    getChainId: async () => 5042002,
    getBlock: async () => ({ number: 12n, baseFeePerGas: 1000000000n }),
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 19000000000n,
      maxPriorityFeePerGas: 1000000000n,
    }),
    simulateContract: async () => ({}),
    estimateGas: async () => 50001n,
    ...overrides,
  } as unknown as PublicClient;
}
const estimate = {
  chainId: 5042002,
  account: account as `0x${string}`,
  contractAddress: target as `0x${string}`,
  operation: "pay" as const,
  callData: call,
  principal6: 10001n,
  isChainSpecificClient: true,
};
test("A7: actual fee19×120%=22.8Gwei, ceil gas, priority/base, missing fee blocks, all five simulate/estimate failures block", async () => {
  const outcome = await runPreflight({
    ...estimate,
    publicClient: preflightClient(),
  });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw Error("missing quote");
  expect(outcome.quote.maxFeePerGas18).toBe(22800000000n);
  expect(outcome.quote.gasLimit).toBe(60002n);
  expect(formatFee18(1000000000001n)).toBe("0.000002");
  const missing = await runPreflight({
    ...estimate,
    publicClient: preflightClient({
      estimateFeesPerGas: async () => ({ maxFeePerGas: null }),
    }),
  });
  expect(missing.ok).toBe(false);
  for (const op of [
    "create",
    "approveReset",
    "approve",
    "pay",
    "cancel",
  ] as const) {
    const data =
      op === "approve" || op === "approveReset"
        ? encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [target, op === "approveReset" ? 0n : 10001n],
          })
        : op === "create"
          ? encodeFunctionData({
              abi: SPLITLINK_ABI,
              functionName: "createRequest",
              args: ["x", 10001n, [account, other], [5000, 5000]],
            })
          : encodeFunctionData({
              abi: SPLITLINK_ABI,
              functionName: op === "pay" ? "payRequest" : "cancelRequest",
              args: [1n],
            });
    for (const stage of ["simulateContract", "estimateGas"]) {
      const result = await runPreflight({
        ...estimate,
        operation: op,
        callData: data,
        publicClient: preflightClient({
          [stage]: async () => {
            throw Error("execution reverted: test fault");
          },
        }),
      });
      expect(result.ok).toBe(false);
    }
  }
});
test("A7: gross principal retained for reset/approve/pay, create/cancel fee funding mandatory; dust and one shared balance never added", () => {
  for (const operation of ["pay", "approve", "approveReset"] as const) {
    expect(
      checkFunding({
        operation,
        principal6: 10001n,
        feeBudget18: 100n,
        balance6: 0n,
        nativeBalance18: 10n ** 22n,
      }).ok,
    ).toBe(false);
    expect(
      checkFunding({
        operation,
        principal6: 10001n,
        feeBudget18: 100n,
        balance6: 10001n,
        nativeBalance18: 1000000000000000n + 100n,
      }).ok,
    ).toBe(false);
    expect(
      checkFunding({
        operation,
        principal6: 10001n,
        feeBudget18: 100n,
        balance6: 10001n,
        nativeBalance18: 10001n * 1000000000000n + 1000000000000000n + 100n,
      }).ok,
    ).toBe(true);
  }
  for (const operation of ["create", "cancel"] as const)
    expect(
      checkFunding({
        operation,
        principal6: 0n,
        feeBudget18: 100n,
        balance6: 0n,
        nativeBalance18: 99n,
      }).ok,
    ).toBe(false);
});
test("A8: real pagination shrink, one-block failure, cursor retry preserves known rows; no missing boundary", async () => {
  const covered: bigint[] = [];
  const result = await scanPages({
    from: 0n,
    to: 13n,
    page: 8n,
    retries: 0,
    fetch: async (r) => {
      if (r.to - r.from > 2n) throw Error("range limit");
      for (let n = r.from; n <= r.to; n++) covered.push(n);
      return [r.from, r.from];
    },
    key: String,
  });
  expect(result.complete).toBe(true);
  expect(new Set(covered).size).toBe(14);
  expect(covered.length).toBe(14);
  const cursor = new HistoryCursor<bigint>(0n);
  let fail = true;
  const fetch = async (r: { from: bigint; to: bigint }) => {
    if (r.to - r.from > 0n) throw Error("range limit");
    if (fail && r.from === 2n) throw Error("offline");
    return [r.from];
  };
  expect((await cursor.scan(4n, fetch, String)).complete).toBe(false);
  expect([...cursor.items.values()]).toEqual([4n, 3n]);
  fail = false;
  expect((await cursor.scan(5n, fetch, String)).complete).toBe(true);
  expect(new Set(cursor.items.values()).size).toBe(6);
}, 15000);
test("bounded actual row reads preserve failures as rejected, not complete history evidence", async () => {
  let active = 0,
    peak = 0;
  const results = await boundedMap(
    [1, 2, 3, 4, 5],
    async (n) => {
      active++;
      peak = Math.max(active, peak);
      await Bun.sleep(2);
      active--;
      if (n === 3) throw Error("row failure");
      return n;
    },
    2,
  );
  expect(peak).toBeLessThanOrEqual(2);
  expect(results[2].status).toBe("rejected");
});
test("exact input/share model retains invalid strings, min/max and generated remainder properties", () => {
  expect(formatUsdc6(5000n)).toBe("0.005000");
  expect(formatUsdc6(5001n)).toBe("0.005001");
  for (const s of ["", "0", "100.01", "33.333", ".5", "1e2", "33%", "33."])
    expect(parsePercentage(s).ok).toBe(false);
  expect(parsePercentage("33.33")).toEqual({ ok: true, bps: 3333 });
  for (const s of [".5", "0.009999", "1000000.000001", "1.0000001"])
    expect(parseDraftAmount(s).ok).toBe(false);
  for (let i = 1; i < 1000; i++) {
    const total = 10000n + BigInt(i) * 135791n,
      shares = [i, 10000 - i];
    const a = computeAllocations(total, shares);
    expect(a[0] + a[1]).toBe(total);
    expect(a[0]).toBe((total * BigInt(i)) / 10000n);
  }
});

test("known pending exact body remains submitted; absent/pruned body remains unknown", async () => {
  const pending = identityClient(call, {
    getTransactionReceipt: async () => {
      throw Error("not mined");
    },
    getTransaction: async () => ({
      from: account,
      to: target,
      input: call,
      value: 0n,
      nonce: 7,
      blockNumber: null,
    }),
  });
  expect((await recoverRecord(pending, hash, options)).state).toBe("submitted");
  const absent = identityClient(call, {
    getTransactionReceipt: async () => {
      throw Error("not mined");
    },
    getTransaction: async () => {
      throw Error("no body");
    },
  });
  expect((await recoverRecord(absent, hash, options)).state).toBe("unknown");
});

test("review TTL and exact signing context reject stale/altered quotes, transport errors stay unknown, and native dust uses integer funding boundary", async () => {
  const outcome = await runPreflight({
    ...estimate,
    publicClient: preflightClient(),
  });
  if (!outcome.ok) throw Error("Missing quote");
  const q = outcome.quote;
  const context = {
    chainId: 5042002,
    account,
    target,
    callData: call,
    value: 0n,
  };
  expect(verifySigningContext(q, context)).toBe(null);
  expect(
    verifySigningContext({ ...q, quotedAt: Date.now() - 31000 }, context),
  ).toContain("expired");
  for (const patch of [
    { account: other },
    { chainId: 1 },
    { target: other },
    { callData: call + "00" },
    { value: 1n },
  ])
    expect(verifySigningContext(q, { ...context, ...patch })).not.toBe(null);
  const down = await runPreflight({
    ...estimate,
    publicClient: preflightClient({
      estimateFeesPerGas: async () => {
        throw Error("network timeout");
      },
    }),
  });
  expect(down.ok).toBe(false);
  if (!down.ok) expect(down.code).toBe("rpcUnavailable");
  const required = 10001n * 1000000000000n + 1000000000000000n + q.feeBudget18;
  expect(
    checkFunding({
      operation: "pay",
      principal6: 10001n,
      feeBudget18: q.feeBudget18,
      balance6: 10001n,
      nativeBalance18: required - 1n,
    }).ok,
  ).toBe(false);
  expect(
    checkFunding({
      operation: "pay",
      principal6: 10001n,
      feeBudget18: q.feeBudget18,
      balance6: 10001n,
      nativeBalance18: required,
    }).ok,
  ).toBe(true);
});

test("SFA-1: a delayed old gap cannot erase a queued newer failed suffix; retry must fetch it before complete", async () => {
  const cursor = new HistoryCursor<string>(1n);
  // Establish gap through an actual failed production scan, without editing cursor fields.
  const initial = await cursor.scan(
    100n,
    async () => {
      throw Error("RPC offline");
    },
    String,
  );
  expect(initial.complete).toBe(false);
  expect(initial.gapEnd).toBe(100n);
  let release!: (rows: string[]) => void, start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const older = cursor.scan(
    100n,
    () =>
      new Promise<string[]>((resolve) => {
        release = resolve;
        start();
      }),
    String,
  );
  await started;
  let newerCalls = 0;
  const newer = cursor.scan(
    200n,
    async () => {
      newerCalls++;
      throw Error("RPC offline");
    },
    String,
  );
  await Bun.sleep(5);
  expect(newerCalls).toBe(0); // per-cursor serialization, not just stale UI suppression
  release(["old-row"]);
  await older;
  const failedSuffix = await newer;
  expect(newerCalls).toBeGreaterThan(0);
  expect(failedSuffix.complete).toBe(false);
  expect(failedSuffix.head).toBe(200n);
  expect(failedSuffix.gapEnd).toBe(200n);
  const successfulRanges: { from: bigint; to: bigint }[] = [];
  const final = await cursor.scan(
    200n,
    async (range) => {
      successfulRanges.push(range);
      return ["new-row"];
    },
    String,
  );
  expect(successfulRanges.length).toBeGreaterThan(0);
  expect(successfulRanges.some((r) => r.from <= 101n && r.to >= 200n)).toBe(
    true,
  );
  expect(final.complete).toBe(true);
  expect(final.items).toContain("old-row");
  expect(final.items).toContain("new-row");
}, 25000);

test("SFA-1: a rejected/aborted queued scan releases its successor, and serial head snapshots stay monotonic", async () => {
  const cursor = new HistoryCursor<bigint>(1n);
  let release!: (rows: bigint[]) => void, start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const first = cursor.scan(
    10n,
    () =>
      new Promise<bigint[]>((resolve) => {
        release = resolve;
        start();
      }),
    String,
  );
  await started;
  const aborted = new AbortController();
  const second = cursor.scan(20n, async () => [20n], String, aborted.signal);
  aborted.abort();
  const third = cursor.scan(30n, async (r) => [r.to], String);
  release([10n]);
  await first;
  await expect(second).rejects.toThrow();
  const result = await third;
  expect(result.complete).toBe(true);
  expect(result.head).toBe(30n);
  expect(result.items).toContain(30n);
  const older = await cursor.scan(
    20n,
    async () => {
      throw Error("must not refetch already covered old head");
    },
    String,
  );
  expect(older.head).toBe(30n);
  expect(older.complete).toBe(true);
});
