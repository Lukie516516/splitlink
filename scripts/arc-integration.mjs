// Prepared real TESTNET runner. This task invokes only the default no-write path.
// No mainnet path. Secrets are accepted only in process environment, never output.
import fs from "node:fs";
import {
  JsonRpcProvider,
  Wallet,
  Contract,
  getAddress,
  isAddress,
  keccak256,
} from "ethers";
const TOKEN = "0x3600000000000000000000000000000000000000";
const CHAIN = 5042002n;
if (!process.argv.includes("--execute-authorized-testnet-writes")) {
  console.log(
    "SKIPPED / BLOCKED: real canonical-token integration not executed. Explicit testnet write authorization, controlled funded wallets and reviewed deployment are required. This default invocation does not load a signer or send transactions.",
  );
  console.log(
    "Prepared runner: provide ARC_TESTNET_SPLITLINK_ADDRESS, ARC_TESTNET_DEPLOYMENT_BLOCK, ARC_TESTNET_BYTECODE_HASH, ARC_TESTNET_RECIPIENT (controlled by the operator), ARC_TESTNET_SIGNER_KEY via a secure environment, then explicitly invoke the --execute-authorized-testnet-writes flag only after authorization. No mainnet execution is supported.",
  );
  process.exit(0);
}
const required = [
  "ARC_TESTNET_SPLITLINK_ADDRESS",
  "ARC_TESTNET_DEPLOYMENT_BLOCK",
  "ARC_TESTNET_BYTECODE_HASH",
  "ARC_TESTNET_RECIPIENT",
  "ARC_TESTNET_SIGNER_KEY",
];
for (const name of required)
  if (!process.env[name]) throw Error(`Missing ${name}; no writes executed.`);
const target = getAddress(process.env.ARC_TESTNET_SPLITLINK_ADDRESS);
const other = getAddress(process.env.ARC_TESTNET_RECIPIENT);
const deploymentBlock = BigInt(process.env.ARC_TESTNET_DEPLOYMENT_BLOCK);
const expectedHash = process.env.ARC_TESTNET_BYTECODE_HASH;
if (
  !isAddress(target) ||
  !isAddress(other) ||
  !/^0x[\da-f]{64}$/i.test(expectedHash)
)
  throw Error("Invalid reviewed deployment configuration.");
const rpc = process.env.ARC_TESTNET_RPC_URL ?? "https://rpc.testnet.arc.io";
if (new URL(rpc).protocol !== "https:")
  throw Error("Testnet RPC must use HTTPS.");
const provider = new JsonRpcProvider(rpc);
if ((await provider.getNetwork()).chainId !== CHAIN)
  throw Error("Refusing any chain other than real Arc Testnet 5042002.");
const artifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/SplitLink.sol/SplitLink.json", "utf8"),
);
const code = await provider.getCode(target);
if (
  code === "0x" ||
  keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
)
  throw Error("Reviewed deployed bytecode hash mismatch.");
if ((await provider.getBlockNumber()) < deploymentBlock)
  throw Error("Deployment block is ahead of RPC.");
let signer;
try {
  signer = new Wallet(process.env.ARC_TESTNET_SIGNER_KEY, provider);
} catch {
  throw Error("Invalid signer secret; details redacted.");
}
if (
  other.toLowerCase() === signer.address.toLowerCase() ||
  other.toLowerCase() === target.toLowerCase()
)
  throw Error("Use a distinct, operator-controlled recipient.");
const split = new Contract(target, artifact.abi, signer);
const token = new Contract(
  TOKEN,
  [
    "function decimals() view returns(uint8)",
    "function balanceOf(address) view returns(uint256)",
    "function allowance(address,address) view returns(uint256)",
    "function approve(address,uint256) returns(bool)",
  ],
  signer,
);
if (
  (await split.USDC()).toLowerCase() !== TOKEN.toLowerCase() ||
  (await token.decimals()) !== 6n
)
  throw Error("Immutable canonical token/precision mismatch.");
if ((await provider.getCode(TOKEN)) === "0x")
  throw Error(
    "Canonical interface has no ordinary bytecode. Investigate the official system-interface model before proceeding.",
  );
const report = {
  environment:
    "REAL ARC TESTNET — only when explicitly executed by an authorized operator",
  chainId: CHAIN.toString(),
  contract: target,
  bytecodeHash: expectedHash,
  deploymentBlock: deploymentBlock.toString(),
  signer: signer.address,
  checkedAt: new Date().toISOString(),
  cases: [],
  unexecuted: [
    "mainnet",
    "five-recipient canonical scenario (separate controlled addresses needed)",
    "issuer-restriction later-recipient rollback (requires a reproducible controlled restriction)",
    "second-wallet competition (separate controlled wallet needed)",
    "actual public-host browser/wallet recovery",
  ],
};
const serial = (value) =>
  JSON.stringify(
    value,
    (_, x) => (typeof x === "bigint" ? x.toString() : x),
    2,
  );
const persist = () => {
  fs.mkdirSync("outputs", { recursive: true });
  fs.writeFileSync(
    "outputs/arc-testnet-integration-evidence.json",
    serial(report),
  );
};
const assert = (value, message) => {
  if (!value) throw Error(message);
};
async function snapshot() {
  const block = await provider.getBlockNumber();
  const [native, balance] = await Promise.all([
    provider.getBalance(signer.address, block),
    token.balanceOf(signer.address, { blockTag: block }),
  ]);
  assert(
    native / 1000000000000n === balance,
    "Shared native/ERC20 observation mismatch.",
  );
  return { block, native, balance };
}
async function send(name, contract, method, args, principal = 0n) {
  // Real executable estimate. Never guess past a revert or missing estimate.
  await contract[method].staticCall(...args);
  const estimate = await contract[method].estimateGas(...args);
  const [fees, block] = await Promise.all([
    provider.getFeeData(),
    provider.getBlock("latest"),
  ]);
  assert(fees.maxFeePerGas !== null, "No fresh fee recommendation.");
  const gasLimit = (estimate * 12000n + 9999n) / 10000n;
  const priority = fees.maxPriorityFeePerGas ?? 0n;
  const maxFeePerGas = [
    20000000000n,
    (fees.maxFeePerGas * 12000n + 9999n) / 10000n,
    (block.baseFeePerGas ?? 0n) + priority,
  ].reduce((a, b) => (a > b ? a : b));
  const before = await snapshot();
  assert(before.balance >= principal, "Gross principal shortage.");
  assert(
    before.native >=
      principal * 1000000000000n + gasLimit * maxFeePerGas + 1000000000000000n,
    "Insufficient principal plus current-step fee/reserve.",
  );
  const tx = await contract[method](...args, {
    value: 0,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas: priority,
    chainId: CHAIN,
  });
  // Save the actual returned hash immediately. This is not a browser recovery guarantee.
  const item = { name, hash: tx.hash, state: "submitted" };
  report.cases.push(item);
  persist();
  const receipt = await tx.wait(1);
  assert(receipt && receipt.status === 1, "Failed testnet receipt.");
  Object.assign(item, {
    state: "confirmed",
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    actualFee18: receipt.gasUsed * receipt.gasPrice,
  });
  persist();
  return { receipt, item };
}
function events(receipt) {
  return receipt.logs
    .filter((l) => l.address.toLowerCase() === target.toLowerCase())
    .flatMap((l) => {
      try {
        return [split.interface.parseLog(l)];
      } catch {
        return [];
      }
    });
}
const total = 10001n;
async function create(recipients, label) {
  const result = await send(label, split, "createRequest", [
    `SplitLink controlled test — ${label}`,
    total,
    recipients,
    [5000, 5000],
  ]);
  const found = events(result.receipt).filter(
    (e) =>
      e?.name === "RequestCreated" &&
      e.args.creator.toLowerCase() === signer.address.toLowerCase(),
  );
  assert(found.length === 1, "Creation ID cannot be verified.");
  const id = found[0].args.requestId;
  const r = await split.getRequest(id, {
    blockTag: result.receipt.blockNumber,
  });
  assert(
    r.totalAmount === total &&
      r.recipients.every(
        (a, i) => a.toLowerCase() === recipients[i].toLowerCase(),
      ),
    "Creation terms mismatch.",
  );
  Object.assign(result.item, {
    requestId: id,
    businessVerification: "verified",
  });
  persist();
  return id;
}
try {
  // The operator explicitly authorizes every named approval/reset probe in this runner.
  await send(
    "explicit allowance reset probe",
    token,
    "approve",
    [target, 0n],
    total,
  );
  await send("nonzero allowance probe", token, "approve", [target, 1n], total);
  let resetRequired = false;
  try {
    await token.approve.staticCall(target, total);
  } catch {
    resetRequired = true;
  }
  report.resetRequiredObserved = resetRequired;
  if (resetRequired)
    await send(
      "explicit prerequisite reset after observed replacement failure",
      token,
      "approve",
      [target, 0n],
      total,
    );
  for (const [label, recipients] of [
    ["self first", [signer.address, other]],
    ["self last", [other, signer.address]],
  ]) {
    const id = await create(recipients, label);
    await send(
      `exact approval — ${label}`,
      token,
      "approve",
      [target, total],
      total,
    );
    const allowance = await token.allowance(signer.address, target);
    assert(allowance >= total, "Approval did not establish gross allowance.");
    const before = await snapshot();
    const { receipt, item } = await send(
      `payment — ${label}`,
      split,
      "payRequest",
      [id],
      total,
    );
    const r = await split.getRequest(id, { blockTag: receipt.blockNumber });
    const allocations = await split.getAllocations(id, {
      blockTag: receipt.blockNumber,
    });
    assert(
      r.status === 2n && r.payer.toLowerCase() === signer.address.toLowerCase(),
      "Canonical payer/status mismatch.",
    );
    assert(
      allocations[0] === 5000n && allocations[1] === 5001n,
      "Exact allocation mismatch.",
    );
    const emitted = events(receipt),
      paid = emitted.filter((e) => e?.name === "RequestPaid"),
      recipientsPaid = emitted.filter((e) => e?.name === "RecipientPaid");
    assert(
      paid.length === 1 &&
        paid[0].args.requestId === id &&
        paid[0].args.payer.toLowerCase() === signer.address.toLowerCase() &&
        paid[0].args.totalAmount === total,
      "Settlement event mismatch.",
    );
    assert(
      recipientsPaid.length === 2 &&
        recipientsPaid.every(
          (e, i) =>
            e.args.requestId === id &&
            e.args.recipient.toLowerCase() === recipients[i].toLowerCase() &&
            e.args.amount === allocations[i],
        ),
      "Ordered recipient events mismatch.",
    );
    assert(
      (await token.allowance(signer.address, target, {
        blockTag: receipt.blockNumber,
      })) ===
        allowance - total,
      "Gross allowance consumption mismatch.",
    );
    const after = await snapshot();
    Object.assign(item, {
      businessVerification: "verified",
      requestId: id,
      allocations,
      before,
      after,
      measuredGasHint: {
        gas: receipt.gasUsed,
        chainId: CHAIN,
        bytecodeHash: expectedHash,
        recipientCount: 2,
        scenario: label,
        testedAt: new Date().toISOString(),
      },
    });
    persist();
  }
  const cancelId = await create(
    [signer.address, other],
    "creator cancellation",
  );
  const cancelled = await send("creator cancellation", split, "cancelRequest", [
    cancelId,
  ]);
  assert(
    (
      await split.getRequest(cancelId, {
        blockTag: cancelled.receipt.blockNumber,
      })
    ).status === 3n,
    "Cancellation status mismatch.",
  );
  let blocked = false;
  try {
    await split.payRequest.staticCall(cancelId);
  } catch {
    blocked = true;
  }
  assert(blocked, "Cancelled request unexpectedly payable.");
  Object.assign(cancelled.item, {
    businessVerification: "verified",
    requestId: cancelId,
  });
  report.status =
    "executed named canonical testnet cases only; listed unexecuted cases remain open";
  persist();
  console.log(
    "Actual testnet evidence saved to outputs/arc-testnet-integration-evidence.json. This does not close every G3/G4 case.",
  );
} catch (e) {
  report.status = "failed / incomplete";
  report.failure = e.shortMessage ?? e.message;
  persist();
  console.error(report.failure);
  process.exitCode = 1;
}
