import fs from "node:fs";
const results = [];
const token = "0x3600000000000000000000000000000000000000";
for (const [name, rpc, expected] of [
  ["Arc Testnet", "https://rpc.testnet.arc.io", 5042002],
  ["Arc Mainnet", "https://rpc.mainnet.arc.io", 5042],
]) {
  const checks = {};
  const query = async (method, params) => {
    const response = await fetch(rpc, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:4173",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (body.error) throw Error(JSON.stringify(body.error));
    return {
      value: body.result,
      cors: response.headers.get("access-control-allow-origin"),
    };
  };
  for (const [key, method, params] of [
    ["chainId", "eth_chainId", []],
    ["head", "eth_blockNumber", []],
    ["code", "eth_getCode", [token, "latest"]],
    ["decimals", "eth_call", [{ to: token, data: "0x313ce567" }, "latest"]],
    [
      "historicalLogs",
      "eth_getLogs",
      [{ address: token, fromBlock: "0x0", toBlock: "0x1" }],
    ],
  ]) {
    try {
      checks[key] = await query(method, params);
    } catch (e) {
      checks[key] = { error: e.message };
    }
  }
  results.push({ name, rpc, expectedChainId: expected, checks });
}
const report = {
  checkedAt: new Date().toISOString(),
  environment:
    "real public RPC read-only; CORS header observation is not browser acceptance",
  results,
  notTested: [
    "signatures",
    "deployments",
    "approval/reset",
    "self transferFrom",
    "actual shared funding/gas",
    "token rollback",
  ],
};
fs.writeFileSync(
  "outputs/arc-readonly-check.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
