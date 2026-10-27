// Self-contained local-only CI. Owns and cleans only its Anvil child process.
import { spawn } from "node:child_process";
import net from "node:net";
const port = 9547;
const occupied = await new Promise((resolve) => {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.once("connect", () => {
    socket.destroy();
    resolve(true);
  });
  socket.once("error", () => {
    socket.destroy();
    resolve(false);
  });
});
if (occupied)
  throw Error(
    "Port9547 is already in use. Refusing to reuse or stop another chain.",
  );
const chain = spawn(
  "anvil",
  [
    "--silent",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    "31338",
  ],
  { stdio: "ignore" },
);
const run = (args, env = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn("pnpm", args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
    });
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(Error(`pnpm ${args.join(" ")} exited ${code}`)),
    );
  });
let failure;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (chain.exitCode !== null)
      throw Error(
        "Owned local chain failed to start. Is port9547 already occupied?",
      );
    try {
      const r = await fetch(`http://127.0.0.1:${port}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if ((await r.json()).result === "0x7a6a") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Local chain readiness timeout.");
  await run(["compile"]);
  await run(["local:deploy"]);
  await run(["test:local"]);
  await run(["build"], { VITE_ENABLE_LOCAL: "true" });
  await run(["test:browser"]);
} catch (e) {
  failure = e;
} finally {
  chain.kill("SIGTERM");
}
if (failure) {
  console.error(failure.message);
  process.exitCode = 1;
}
