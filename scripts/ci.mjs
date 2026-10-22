import fs from "node:fs";
import net from "node:net";
import { spawn } from "node:child_process";
import { sourceDigest } from "./source-fingerprint.mjs";

// Identical entry point locally and in hosted CI. No external chain writes or credentials.
const out = "outputs/ci";
fs.mkdirSync(out, { recursive: true });
const children = new Set();
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const report = {
  startedAt: new Date().toISOString(),
  status: "running",
  scope:
    "isolated local EVM and browser; external release/eligibility not certified",
  node: process.version,
  stages: [],
};
const persist = () =>
  fs.writeFileSync(`${out}/summary.json`, JSON.stringify(report, null, 2));

function launch(args, log, env = {}) {
  const stream = fs.createWriteStream(log);
  const child = spawn(pnpm, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  child.once("close", () => {
    children.delete(child);
    stream.end();
  });
  // Register immediately so even an early executable failure is observed.
  child.done = new Promise((resolve) => {
    child.once("error", (error) =>
      resolve({ code: null, error: error.message }),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return child;
}
function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
async function step(name, args, env = {}, timeout = 180000) {
  console.log(`CI: ${name}`);
  const stage = { name, command: `pnpm ${args.join(" ")}`, status: "running" };
  report.stages.push(stage);
  persist();
  const child = launch(args, `${out}/${name}.log`, env);
  const timer = setTimeout(() => stop(child), timeout);
  try {
    const result = await child.done;
    if (result.code !== 0) throw Error(JSON.stringify(result));
    stage.status = "passed";
  } catch (error) {
    stage.status = "failed";
    stage.error = error.message;
    throw error;
  } finally {
    clearTimeout(timer);
    persist();
  }
}
async function vacant(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        Error(
          `Port ${port} is occupied. Stop its owner before CI; existing services will not be reused or killed.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
}
async function waitForChain(child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error("CI chain exited before readiness.");
    try {
      const r = await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
        signal: AbortSignal.timeout(1000),
      });
      if (Number(BigInt((await r.json()).result)) !== 31337)
        throw Error("Wrong chain ID.");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw Error("CI chain readiness timed out.");
}
async function cleanup() {
  for (const c of children) stop(c);
  await Promise.all([...children].map((c) => c.done));
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    report.status = "interrupted";
    persist();
    await cleanup();
    process.exit(130);
  });
}
try {
  // Never silently use a developer's old chain/preview/fault proxy.
  for (const port of [8545, 9545, 4173]) await vacant(port);
  report.source = sourceDigest();
  persist();
  await step("install", ["install", "--frozen-lockfile"]);
  await step("dependency-audit", ["audit", "--audit-level", "high", "--json"]);
  await step("unit-contract", ["test"]);
  await step("format", ["format:check"]);
  const chain = launch(["local:chain"], `${out}/local-chain.log`);
  await waitForChain(chain);
  await step("local-deployment", ["local:deploy"]);
  await step("local-integration", ["test:local"]);
  await step("browser-build", ["build"], { VITE_ENABLE_LOCAL: "true" });
  await step(
    "browser",
    ["test:browser"],
    { CI: "true", RUN_ARC_READONLY: "false" },
    300000,
  );
  await step("release-build", ["build"], { VITE_ENABLE_LOCAL: "false" });
  if (fs.existsSync("dist/local-manifest.json"))
    throw Error("Local manifest leaked into release.");
  for (const file of ["index.html", "_redirects"]) {
    if (!fs.existsSync(`dist/${file}`))
      throw Error(`Missing release file: ${file}`);
  }
  const artifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/SplitLink.sol/SplitLink.json"),
  );
  const abiSource = fs.readFileSync("src/abi.ts", "utf8");
  const checkedAbi = JSON.parse(
    abiSource.slice(abiSource.indexOf("[")).replace(/ as const;\s*$/, ""),
  );
  if (JSON.stringify(checkedAbi) !== JSON.stringify(artifact.abi))
    throw Error("Generated ABI mismatch.");
  const after = sourceDigest();
  if (after.sha256 !== report.source.sha256)
    throw Error(
      "Sources changed during CI (including generated ABI). Review and rerun.",
    );
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.message;
  process.exitCode = 1;
  console.error(`CI FAILED: ${error.message}; inspect ${out}/`);
} finally {
  await cleanup();
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(`CI: ${report.status}. Evidence: ${out}/summary.json`);
}
