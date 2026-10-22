const assert = require("node:assert/strict");
const hre = require("hardhat");
const { ethers } = require("ethers");
const fc = require("fast-check");
const fs = require("node:fs");
const artifact = (n) =>
  JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`));
describe("SplitLink — isolated local EVM / mock token only", function () {
  let provider, signers, addresses, token, split;
  const deploy = async (n, args = []) => {
    const a = artifact(n);
    const c = await new ethers.ContractFactory(
      a.abi,
      a.bytecode,
      signers[0],
    ).deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const create = async (
    total = 10001n,
    shares = [5000, 5000],
    recipients = addresses.slice(2, 2 + shares.length),
    title = "Team project",
  ) => {
    const tx = await split.createRequest(title, total, recipients, shares);
    const rc = await tx.wait();
    const event = rc.logs
      .flatMap((l) => {
        try {
          return [split.interface.parseLog(l)];
        } catch {
          return [];
        }
      })
      .find((e) => e?.name === "RequestCreated");
    return event.args.requestId;
  };
  const approve = async (amount = 1000000000n, s = signers[1]) =>
    await (
      await token.connect(s).approve(await split.getAddress(), amount)
    ).wait();
  const fail = async (p) => {
    await assert.rejects(async () => {
      const tx = await p;
      if (tx?.wait) await tx.wait();
    });
  };
  beforeEach(async () => {
    await hre.network.provider.send("hardhat_reset");
    provider = new ethers.BrowserProvider(hre.network.provider);
    signers = await Promise.all(
      Array.from({ length: 8 }, (_, i) => provider.getSigner(i)),
    );
    addresses = await Promise.all(signers.map((s) => s.getAddress()));
    token = await deploy("LocalMockUSDC");
    split = await deploy("SplitLink", [await token.getAddress()]);
    await (await token.mint(addresses[1], 1000000000n)).wait();
  });
  it("2/5 recipients, indexed events, unique IDs, immutable getters, exact remainder", async () => {
    const id = await create();
    assert.equal(id, 1n);
    assert.deepEqual([...(await split.getAllocations(id))], [5000n, 5001n]);
    const before = await split.getRequest(id);
    const five = await create(1000000n, [1000, 2000, 2500, 3000, 1500]);
    assert.equal(five, 2n);
    assert.equal((await split.getRequest(five)).recipients.length, 5);
    assert.equal(await split.nextRequestId(), 3n);
    await approve();
    await (await split.connect(signers[1]).payRequest(id)).wait();
    const after = await split.getRequest(id);
    assert.equal(after.title, before.title);
    assert.deepEqual([...after.recipients], [...before.recipients]);
    assert.deepEqual([...after.sharesBps], [...before.sharesBps]);
    assert.equal(after.totalAmount, before.totalAmount);
  });
  it("validates UTF8 bytes, amount/count/array/zero/self/duplicates/shares/missing IDs", async () => {
    await create(10000n, [5000, 5000], addresses.slice(2, 4), "界".repeat(40));
    await fail(
      create(10000n, [5000, 5000], addresses.slice(2, 4), "界".repeat(41)),
    );
    for (const title of ["", "x".repeat(121)])
      await fail(create(10000n, [5000, 5000], addresses.slice(2, 4), title));
    for (const value of [9999n, 1000000000001n]) await fail(create(value));
    await create(1000000000000n);
    for (const rec of [
      addresses.slice(2, 3),
      addresses.slice(1, 7),
      [ethers.ZeroAddress, addresses[2]],
      [await split.getAddress(), addresses[2]],
      [addresses[2], addresses[2]],
    ])
      await fail(create(10000n, [5000, 5000], rec));
    await fail(create(10000n, [10000], addresses.slice(2, 4)));
    for (const shares of [
      [0, 10000],
      [4999, 5000],
      [5001, 5000],
    ])
      await fail(create(10000n, shares));
    await fail(split.getRequest(999));
    await fail(split.getAllocations(999));
    await fail(split.payRequest(999));
    await fail(split.cancelRequest(999));
  });
  it("property: compiled contract allocation agrees with integer model and preserves total/order", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: 10000n, max: 1000000000000n }),
        fc.integer({ min: 1, max: 9999 }),
        async (total, first) => {
          const id = await create(total, [first, 10000 - first]);
          const allocations = await split.getAllocations(id);
          assert.equal(allocations[0], (total * BigInt(first)) / 10000n);
          assert.equal(allocations[1], total - allocations[0]);
          assert.equal(
            allocations.reduce((a, b) => a + b, 0n),
            total,
          );
          assert(allocations.every((a) => a > 0n));
        },
      ),
      { numRuns: 40 },
    );
  });
  it("success pays direct, emits complete evidence, uses caller funds, rejects duplicate settlement", async () => {
    const id = await create();
    await approve();
    const receipt = await (
      await split.connect(signers[1]).payRequest(id)
    ).wait();
    const req = await split.getRequest(id);
    assert.equal(req.status, 2n);
    assert.equal(req.payer, addresses[1]);
    assert(req.paidAt > 0n);
    assert.equal(await token.balanceOf(addresses[2]), 5000n);
    assert.equal(await token.balanceOf(addresses[3]), 5001n);
    assert.equal(await token.balanceOf(await split.getAddress()), 0n);
    assert.equal(
      receipt.logs.filter((l) => l.address === split.target).length,
      3,
    );
    await fail(split.connect(signers[1]).payRequest(id));
    await fail(split.cancelRequest(id));
  });
  it("insufficient balance/allowance and first/later token failure completely roll back", async () => {
    for (const blocked of [addresses[2], addresses[3]]) {
      const id = await create();
      await approve(10001n);
      await (await token.setBlocked(blocked)).wait();
      await fail(split.connect(signers[1]).payRequest(id));
      assert.equal((await split.getRequest(id)).status, 1n);
      assert.equal(await token.balanceOf(addresses[2]), 0n);
      assert.equal(await token.balanceOf(addresses[3]), 0n);
      assert.equal(await token.balanceOf(addresses[1]), 1000000000n);
      assert.equal(
        await token.allowance(addresses[1], await split.getAddress()),
        10001n,
      );
    }
    await (await token.setBlocked(ethers.ZeroAddress)).wait();
    const id = await create();
    await approve(1n);
    await fail(split.connect(signers[1]).payRequest(id));
    await approve(100000000000n);
    const high = await create(100000000000n);
    await fail(split.connect(signers[1]).payRequest(high));
  });
  it("all write entries guarded against token reentry; nonpayable rejects native value", async () => {
    for (const name of ["createRequest", "payRequest", "cancelRequest"]) {
      const id = await create();
      await approve();
      const args =
        name === "createRequest"
          ? ["nested", 10000n, addresses.slice(4, 6), [5000, 5000]]
          : [id];
      await (
        await token.setHook(
          await split.getAddress(),
          split.interface.encodeFunctionData(name, args),
        )
      ).wait();
      await (await split.connect(signers[1]).payRequest(id)).wait();
      assert.equal(await token.hookBlocked(), true);
      assert.equal(await split.nextRequestId(), id + 1n);
    }
    for (const [name, args] of [
      ["createRequest", ["x", 10000n, addresses.slice(2, 4), [5000, 5000]]],
      ["payRequest", [1]],
      ["cancelRequest", [1]],
    ])
      await fail(
        signers[0].sendTransaction({
          to: split.target,
          data: split.interface.encodeFunctionData(name, args),
          value: 1n,
        }),
      );
  });
  it("creator-only cancel and both race orderings; one of two concurrent payers settles", async () => {
    let id = await create();
    await fail(split.connect(signers[1]).cancelRequest(id));
    await (await split.cancelRequest(id)).wait();
    assert.equal((await split.getRequest(id)).status, 3n);
    await fail(split.cancelRequest(id));
    await approve();
    await fail(split.connect(signers[1]).payRequest(id));
    id = await create();
    await (await split.connect(signers[1]).payRequest(id)).wait();
    await fail(split.cancelRequest(id));
    id = await create();
    await (await token.mint(addresses[0], 100000n)).wait();
    await approve(100000n, signers[0]);
    const outcomes = await Promise.allSettled([
      split.payRequest(id).then((t) => t.wait()),
      split
        .connect(signers[1])
        .payRequest(id)
        .then((t) => t.wait()),
    ]);
    assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
    assert.equal((await split.getRequest(id)).status, 2n);
  });
  it("payer-as-recipient still executes self transferFrom and consumes gross allowance (mock only)", async () => {
    const id = await create(10001n, [5000, 5000], [addresses[1], addresses[3]]);
    await approve(10001n);
    const receipt = await (
      await split.connect(signers[1]).payRequest(id)
    ).wait();
    assert.equal(await token.balanceOf(addresses[1]), 1000000000n - 5001n);
    assert.equal(await token.allowance(addresses[1], split.target), 0n);
    const transfers = receipt.logs.filter((l) => l.address === token.target);
    assert.equal(transfers.length, 2);
  });
});
