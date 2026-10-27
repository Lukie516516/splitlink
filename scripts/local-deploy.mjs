import fs from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256 } from "viem";
const transport = http("http://127.0.0.1:9547");
const c = createPublicClient({ transport }),
  w = createWalletClient({ transport });
if ((await c.getChainId()) !== 31338)
  throw Error("Refusing non-local fixture chain.");
const accounts = await w.getAddresses();
const artifact = (n) =>
  JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`));
async function deploy(n, args = []) {
  const a = artifact(n);
  const hash = await w.deployContract({
    account: accounts[0],
    chain: null,
    abi: a.abi,
    bytecode: a.bytecode,
    args,
  });
  const receipt = await c.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw Error("Local fixture deployment failed.");
  return {
    address: receipt.contractAddress,
    block: receipt.blockNumber,
    abi: a.abi,
  };
}
const token = await deploy("LocalToken");
for (const account of accounts.slice(0, 6)) {
  const hash = await w.writeContract({
    account: accounts[0],
    chain: null,
    address: token.address,
    abi: token.abi,
    functionName: "mint",
    args: [account, 100000000000n],
  });
  await c.waitForTransactionReceipt({ hash });
}
const split = await deploy("SplitLink", [token.address]);
const code = await c.getCode({ address: split.address });
const m = {
  chainId: 31338,
  chainName: "Local EVM / Mock USDC",
  environment: "local-mock",
  contractAddress: split.address,
  usdcAddress: token.address,
  deploymentBlock: split.block.toString(),
  expectedBytecodeHash: keccak256(code),
  rpcUrl: "http://127.0.0.1:9547",
  explorerBase: "",
  contractVersion: "1.0.0",
  isDeployed: true,
  hasDeploymentBlock: true,
  sharedBalance: false,
  resetRequired: false,
  runtimeVerified: true,
};
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/local-manifest.json", JSON.stringify(m, null, 2));
console.log(
  "LOCAL MOCK ONLY: fixture deployed on loopback chain31338; no Arc transactions.",
);
