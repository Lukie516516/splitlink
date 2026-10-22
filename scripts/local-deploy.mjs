import fs from "node:fs";
import { JsonRpcProvider, ContractFactory, keccak256 } from "ethers";
const rpc = "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(rpc);
if ((await provider.getNetwork()).chainId !== 31337n)
  throw Error("Refusing non-local chain.");
const signer = await provider.getSigner(0);
const artifact = (name) =>
  JSON.parse(fs.readFileSync(`artifacts/contracts/${name}.sol/${name}.json`));
const deploy = async (name) => {
  const a = artifact(name);
  return new ContractFactory(a.abi, a.bytecode, signer).deploy(
    ...(name === "SplitLink" ? [await token.getAddress()] : []),
  );
};
const token = await deploy("LocalMockUSDC");
await token.waitForDeployment();
for (let i = 0; i < 5; i++)
  await (
    await token.mint(
      await (await provider.getSigner(i)).getAddress(),
      100000000000n,
    )
  ).wait();
const split = await deploy("SplitLink");
await split.waitForDeployment();
const receipt = await split.deploymentTransaction().wait();
const manifest = {
  chainId: 31337,
  name: "Local EVM / Mock USDC",
  environment: "local-mock",
  rpcUrl: rpc,
  explorer: null,
  usdcAddress: await token.getAddress(),
  splitLinkAddress: await split.getAddress(),
  deploymentBlock: receipt.blockNumber.toString(),
  contractVersion: "1.0.0",
  bytecodeHash: keccak256(await provider.getCode(await split.getAddress())),
  resetRequired: false,
  sharedBalance: false,
  writesEnabled: true,
  appOrigin: "http://127.0.0.1:5173",
};
fs.mkdirSync("public", { recursive: true });
fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(
  "public/local-manifest.json",
  JSON.stringify(manifest, null, 2),
);
fs.writeFileSync(
  "outputs/local-deployment.json",
  JSON.stringify({ environment: "LOCAL MOCK ONLY", manifest }, null, 2),
);
console.log(
  "LOCAL MOCK ONLY: deployed on isolated chain 31337. Manifest: public/local-manifest.json",
);
