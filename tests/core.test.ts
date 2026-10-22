import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import {
  allocate,
  parseAmount,
  parseShare,
  preview,
  quote,
  funding,
  SCALE,
  ceilDiv,
  attributableDelta,
  actualFee,
  validateTerms,
} from "../src/core/math";
import { scanLogs, boundedMap, Generation } from "../src/core/history";
import {
  Journal,
  acceptReplacement,
  serialize,
  type Record as TxRecord,
} from "../src/core/journal";
const address = "0x1111111111111111111111111111111111111111";
const target = "0x2222222222222222222222222222222222222222";
const h = ("0x" + "a".repeat(64)) as `0x${string}`;
const prepared = (j: Journal, op: TxRecord["operationType"]) =>
  j.add({
    account: address,
    chainId: 31337,
    contractAddress: target,
    to: target,
    operationType: op,
    requestId: op === "create" ? null : "1",
    callData: "0x1234",
    intent: { amount: "10000" },
  });
const memory = () => {
  const map = new Map();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
};
test("exact percentage grammar and actionable errors", () => {
  for (const [s, expected] of [
    ["33.33", 3333n],
    ["33.3", 3330n],
    [" 1 ", 100n],
    ["100", 10000n],
  ] as const)
    assert.equal(parseShare(s), expected);
  for (const s of [
    "",
    "0",
    "100.01",
    "33.333",
    ".5",
    "1e2",
    "33%",
    "33.",
    "-1",
    "NaN",
  ])
    assert.throws(() => parseShare(s));
  assert.throws(() => parseShare("33.333"), /2 decimal/);
  assert.throws(() => parseShare(""), /Enter a percentage/);
  assert.throws(() => parseShare("0"), /greater than/);
});
test("amount limits, exact six units and 6↔18 conversion, dust never added", () => {
  assert.equal(parseAmount("0.010001"), 10001n);
  assert.equal(parseAmount("1000000"), 1000000000000n);
  for (const s of [
    ".5",
    "0.009999",
    "1000000.000001",
    "1.0000001",
    "1e2",
    "1.",
  ])
    assert.throws(() => parseAmount(s));
  const amount = parseAmount("1.123456");
  assert.equal(amount * SCALE, 1123456000000000000n);
  assert.equal((amount * SCALE + 999n) / SCALE, amount);
  assert.equal(ceilDiv(1000000000001n, SCALE), 2n);
});
test("raw/stable rows survive add/delete; incomplete invalid shares hide stale preview", () => {
  const rows = [
    { rowId: "a", addressInput: address, percentageInput: "50" },
    { rowId: "b", addressInput: target, percentageInput: "50" },
  ];
  assert.deepEqual(preview("0.010001", rows).allocations, [5000n, 5001n]);
  const add = [...rows, { rowId: "c", addressInput: "", percentageInput: "" }];
  const incomplete = preview("1", add);
  assert.equal(incomplete.subtotal, 10000n);
  assert.equal(incomplete.incomplete, true);
  assert.equal(incomplete.allocations, null);
  assert.deepEqual(add.slice(0, 2), rows);
  assert.deepEqual(
    add.filter((r) => r.rowId !== "c"),
    rows,
  );
  for (const s of ["33.333", "0", "101", ""]) {
    const changed = rows.map((r, i) => (i ? { ...r, percentageInput: s } : r));
    assert.equal(preview("1", changed).allocations, null);
    assert.equal(changed[1].percentageInput, s);
  }
  assert.equal(preview("oops", rows).allocations, null);
});
test("allocation properties across 2–5 rows, sums and final remainder; title/address constraints", () => {
  fc.assert(
    fc.property(
      fc.bigInt({ min: 10000n, max: 1000000000000n }),
      fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), {
        minLength: 1,
        maxLength: 4,
      }),
      (total, cuts) => {
        const sorted = [0, ...cuts.sort((a, b) => a - b), 10000];
        const shares = sorted.slice(1).map((s, i) => BigInt(s - sorted[i]));
        const a = allocate(total, shares);
        assert.equal(
          a.reduce((x, y) => x + y, 0n),
          total,
        );
        assert(a.every((n) => n > 0n));
        assert(
          a.slice(0, -1).every((n, i) => n === (total * shares[i]) / 10000n),
        );
      },
    ),
    { numRuns: 500 },
  );
  const rows = [
    { rowId: "a", addressInput: address, percentageInput: "50" },
    { rowId: "b", addressInput: target, percentageInput: "50" },
  ];
  validateTerms("界".repeat(40), rows);
  assert.throws(() => validateTerms("界".repeat(41), rows));
  assert.throws(() => validateTerms("x", [rows[0], rows[0]]));
  assert.throws(() => validateTerms("x", rows, target));
});
test("fee ceilings, floor/base+priority, reserve, principal-short and TTL are distinct", () => {
  const q = quote(21001n, 1n, 3n, 20000000000n, 10n, 1000);
  assert.equal(q.gas, 25202n);
  assert.equal(q.maxFeePerGas, 20000000003n);
  assert.equal(q.budget, q.gas * q.maxFeePerGas);
  const required = 10000n * SCALE + q.budget + 1000000000000000n;
  funding(10000n, 10000n, required, q, 1001);
  assert.throws(
    () => funding(10000n, 9999n, required, q, 1001),
    /insufficientPrincipal/,
  );
  assert.throws(
    () => funding(10000n, 10000n, required - 1n, q, 1001),
    /insufficientFeeBudget/,
  );
  assert.throws(
    () => funding(10000n, 10000n, required, q, 31001),
    /staleQuote/,
  );
  assert.equal(actualFee(123n, 456n), 56088n);
  assert.equal(attributableDelta(10001n, 5000n, 99n), -5001n * SCALE - 99n);
});
test("inclusive history pages shrink without gaps, deduplicate, fail one block honestly; generation and concurrency", async () => {
  const covered: bigint[] = [];
  const scan = await scanLogs({
    from: 0n,
    to: 11n,
    page: 8n,
    retries: 0,
    fetch: async (r) => {
      if (r.to - r.from > 2n) throw Error("range limit");
      for (let b = r.from; b <= r.to; b++) covered.push(b);
      return [r.from, r.from];
    },
    key: String,
  });
  assert.equal(scan.complete, true);
  assert.equal(new Set(covered).size, 12);
  assert.equal(covered.length, 12);
  assert.equal(scan.items.length, scan.covered.length);
  const failed = await scanLogs({
    from: 0n,
    to: 2n,
    page: 1n,
    retries: 0,
    fetch: async (r) => {
      if (r.from === 1n) throw Error("RPC offline");
      return [r.from];
    },
    key: String,
  });
  assert.equal(failed.complete, false);
  assert.deepEqual(failed.items, [2n]);
  assert.deepEqual(failed.gap, { from: 1n, to: 1n });
  let active = 0,
    peak = 0;
  const result = await boundedMap(
    [1, 2, 3, 4, 5, 6],
    async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      active--;
      if (n === 4) throw Error("read failure");
      return n;
    },
    2,
  );
  assert(peak <= 2);
  assert.equal(result[3].status, "rejected");
  const gen = new Generation();
  const old = gen.next();
  gen.next();
  assert(!gen.current(old));
});
test("bounded transient retries, abort and true empty histories", async () => {
  let n = 0;
  const delays: number[] = [];
  const s = await scanLogs({
    from: 4n,
    to: 4n,
    fetch: async () => {
      if (n++ < 2) throw Error("temporary timeout");
      return [];
    },
    key: String,
    delay: async (ms) => {
      delays.push(ms);
    },
  });
  assert(s.complete);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(s.items.length, 0);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    scanLogs({
      from: 0n,
      to: 1n,
      fetch: async () => [],
      key: String,
      signal: abort.signal,
    }),
  );
});
test("all five operations persist hashes, frozen original context, no-hash restart unknown; invalid schema and storage failure visible", () => {
  for (const op of [
    "create",
    "approveReset",
    "approve",
    "pay",
    "cancel",
  ] as const) {
    const storage = memory(),
      j = new Journal(storage),
      r = prepared(j, op);
    assert.equal(new Journal(storage).records[0].txState, "unknown");
    j.update(r, { txState: "submitted", txHash: h, effectiveTxHash: h });
    const restored = new Journal(storage);
    assert.equal(restored.records[0].txHash, h);
    assert.equal(restored.records[0].chainId, 31337);
    assert.equal(restored.records[0].account, address);
    assert.equal(restored.records[0].operationType, op);
  }
  const broken = new Journal({
    getItem: () => null,
    setItem: () => {
      throw Error("quota");
    },
  });
  prepared(broken, "pay");
  assert.match(broken.warning, /unavailable/);
  const corrupt = new Journal({ getItem: () => "{bad", setItem: () => {} });
  assert.match(corrupt.warning, /unavailable/);
  const invalid = new Journal({
    getItem: () => JSON.stringify([{ schemaVersion: 99 }]),
    setItem: () => {},
  });
  assert.equal(invalid.records.length, 0);
  assert.match(invalid.warning, /invalid/);
  assert.equal(serialize({ n: 123n }), '{"n":"123"}');
});
test("restored terminal claims lose cached evidence and require chain revalidation", () => {
  for (const verification of ["verified", "pending", "notChecked"] as const) {
    const store = memory(),
      j = new Journal(store),
      r = prepared(j, "create");
    j.update(r, {
      txHash: h,
      effectiveTxHash: h,
      txState: "confirmed",
      receiptStatus: "success",
      receiptBlock: "12",
      businessVerification: verification,
      actualFee18: "123",
    });
    const restored = new Journal(store).records[0];
    assert.equal(restored.txHash, h);
    assert.equal(restored.txState, "unknown");
    assert.equal(restored.businessVerification, "notChecked");
    assert.equal(restored.receiptStatus, null);
    assert.equal(restored.actualFee18, undefined);
  }
});
test("missing hashes cannot preserve any cached business-success claim", () => {
  for (const state of [
    "confirmed",
    "unknown",
    "prepared",
    "rejected",
    "cancelledByReplacement",
  ] as const) {
    const store = memory(),
      j = new Journal(store),
      r = prepared(j, "create");
    j.update(r, {
      txState: state,
      businessVerification: "verified",
      requestId: "42",
      receiptStatus: "success",
    });
    const restored = new Journal(store).records[0];
    assert.equal(restored.businessVerification, "notChecked");
    assert.equal(restored.receiptStatus, null);
    if (state !== "rejected") assert.equal(restored.txState, "unknown");
  }
});
test("replacement requires original nonce/sender, same call follows hash, changed call needs final receipt", async () => {
  const j = new Journal(memory()),
    r = prepared(j, "pay");
  const tx = {
    from: address,
    to: target,
    input: "0x1234",
    value: 0n,
    nonce: 7,
  };
  await assert.rejects(
    acceptReplacement(
      j,
      r,
      h,
      async () => tx,
      async () => ({ status: "success" }),
    ),
    /Unrelated/,
  );
  j.update(r, { nonce: "7", txHash: "0x" + "b".repeat(64) });
  await acceptReplacement(
    j,
    r,
    h,
    async () => tx,
    async () => ({ status: "success" }),
  );
  assert.equal(r.effectiveTxHash, h);
  assert.equal(r.replacementKind, "sameIntent");
  await assert.rejects(
    acceptReplacement(
      j,
      r,
      h,
      async () => ({ ...tx, nonce: 8 }),
      async () => ({ status: "success" }),
    ),
  );
  await assert.rejects(
    acceptReplacement(
      j,
      r,
      h,
      async () => ({ ...tx, input: "0x" }),
      async () => {
        throw Error("no receipt");
      },
    ),
  );
  assert.equal(r.txState, "submitted");
  await acceptReplacement(
    j,
    r,
    h,
    async () => ({ ...tx, to: address, input: "0x" }),
    async () => ({ status: "success" }),
  );
  assert.equal(r.txState, "cancelledByReplacement");
  assert.equal(r.businessVerification, "mismatch");
});
