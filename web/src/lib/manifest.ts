import { throttledRpcFetch } from "./rpcThrottle";
// Studio export continuation: mandatory reviewed runtime and canonical identity.
import {
  createPublicClient,
  defineChain,
  http,
  isAddress,
  keccak256,
  toHex,
  erc20Abi,
  type PublicClient,
  type Address,
} from "viem";
import { SPLITLINK_ABI } from "./splitlink";
export const ARC_TESTNET_CHAIN_ID = 5042002;
const TOKEN = "0x3600000000000000000000000000000000000000";
export interface NetworkManifest {
  chainId: number;
  chainName: string;
  contractAddress: string;
  deploymentBlock: bigint;
  usdcAddress: string;
  explorerBase: string;
  contractVersion: string;
  isDeployed: boolean;
  hasDeploymentBlock: boolean;
  expectedBytecodeHash?: string;
  rpcUrl?: string;
  environment?: "local-mock" | "arc-testnet" | "arc-mainnet";
  sharedBalance?: boolean;
  resetRequired?: boolean;
  runtimeVerified?: boolean;
  reviewedDeployment?: "arc-testnet-20261027" | "arc-mainnet-20261028";
}
const env = import.meta.env ?? {};
const block = (raw: string) => (/^\d+$/.test(raw) ? BigInt(raw) : 0n);
const built: NetworkManifest = {
  chainId: ARC_TESTNET_CHAIN_ID,
  chainName: "Arc Testnet",
  contractAddress: env.VITE_SPLITLINK_ADDRESS ?? "",
  deploymentBlock: block(env.VITE_SPLITLINK_DEPLOY_BLOCK ?? ""),
  usdcAddress: TOKEN,
  explorerBase: "https://explorer.testnet.arc.io",
  contractVersion: "1.0.0",
  isDeployed: isAddress(env.VITE_SPLITLINK_ADDRESS ?? ""),
  hasDeploymentBlock: block(env.VITE_SPLITLINK_DEPLOY_BLOCK ?? "") > 0n,
  expectedBytecodeHash: env.VITE_SPLITLINK_EXPECTED_BYTECODE_HASH ?? "",
  rpcUrl: "https://rpc.testnet.arc.io",
  environment: "arc-testnet",
  sharedBalance: true,
  resetRequired: false,
  runtimeVerified: false,
  reviewedDeployment: "arc-testnet-20261027",
};
export const mainnet: NetworkManifest = {
  chainId: 5042, chainName: "Arc Mainnet",
  contractAddress: "0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010",
  deploymentBlock: 28269366n, usdcAddress: TOKEN,
  explorerBase: "https://explorer.arc.io", contractVersion: "1.0.0",
  isDeployed: true, hasDeploymentBlock: true,
  expectedBytecodeHash: "0x36f70577a74e10b3f6036c0804f751545226f529d51a7425657c0696236d3e9b",
  rpcUrl: "https://rpc.mainnet.arc.io", environment: "arc-mainnet",
  sharedBalance: true, resetRequired: false, runtimeVerified: false,
  reviewedDeployment: "arc-mainnet-20261028",
};
export const manifests: NetworkManifest[] = [mainnet, built];
export function reviewedMainnetIdentity(m: NetworkManifest) {
  return m.reviewedDeployment === "arc-mainnet-20261028" &&
    m.environment === "arc-mainnet" && m.chainId === 5042 &&
    m.rpcUrl === mainnet.rpcUrl && m.sharedBalance === true &&
    m.contractAddress.toLowerCase() === mainnet.contractAddress.toLowerCase() &&
    m.usdcAddress.toLowerCase() === TOKEN && m.deploymentBlock === 28269366n &&
    m.contractVersion === "1.0.0" &&
    m.expectedBytecodeHash?.toLowerCase() === mainnet.expectedBytecodeHash;
}
export const reviewedIdentity = (m: NetworkManifest) => reviewedTestnetIdentity(m) || reviewedMainnetIdentity(m);
export async function initManifest() {
  if (
    env.VITE_ENABLE_LOCAL === "true" &&
    ["127.0.0.1", "localhost"].includes(location.hostname)
  ) {
    const m = await (
      await fetch("/local-manifest.json", { cache: "no-store" })
    ).json();
    if (
      m.chainId !== 31338 ||
      m.environment !== "local-mock" ||
      new URL(m.rpcUrl).hostname !== "127.0.0.1" ||
      !isAddress(m.contractAddress) ||
      !isAddress(m.usdcAddress) ||
      m.sharedBalance !== false
    )
      throw Error("Invalid local fixture.");
    m.deploymentBlock = BigInt(m.deploymentBlock);
    manifests.unshift(m);
  }
}
export function getManifest() {
  return manifests[0];
}
export function getSupportedManifest(chainId: number, address: string) {
  return (
    manifests.find(
      (m) =>
        m.isDeployed &&
        m.chainId === chainId &&
        m.contractAddress.toLowerCase() === address.toLowerCase(),
    ) ?? null
  );
}
export function publicClientFor(m: NetworkManifest) {
  const chain = defineChain({
    id: m.chainId,
    name: m.chainName,
    nativeCurrency: {
      name: m.sharedBalance ? "USDC" : "LOCAL TEST ETH",
      symbol: m.sharedBalance ? "USDC" : "TEST",
      decimals: 18,
    },
    rpcUrls: { default: { http: [m.rpcUrl!] } },
  });
  return createPublicClient({
    chain,
    transport: http(m.rpcUrl, { batch: { batchSize: 20, wait: 5 }, timeout: 15000, retryCount: 0, fetchFn: throttledRpcFetch }),
  });
}
export function manifestIsReadyForWrites(m: NetworkManifest) {
  return (
    m.isDeployed &&
    m.hasDeploymentBlock &&
    /^0x[\da-f]{64}$/i.test(m.expectedBytecodeHash ?? "") &&
    (m.environment === "local-mock" || reviewedIdentity(m))
  );
}
// Transaction capability is distinct from full scenario/competition acceptance.
// Only this exact independently reviewed deployment can request browser signatures.
export function reviewedTestnetIdentity(m: NetworkManifest) {
  return m.reviewedDeployment === "arc-testnet-20261027" &&
    m.environment === "arc-testnet" && m.chainId === 5042002 &&
    m.rpcUrl === "https://rpc.testnet.arc.io" && m.sharedBalance === true &&
    m.contractAddress.toLowerCase() === "0xab0fd4065973d1e6043057d8e5ddada9e5c16010" &&
    m.usdcAddress.toLowerCase() === TOKEN && m.deploymentBlock === 69317284n &&
    m.contractVersion === "1.0.0" &&
    m.expectedBytecodeHash?.toLowerCase() === "0x36f70577a74e10b3f6036c0804f751545226f529d51a7425657c0696236d3e9b";
}
export function operationAllowed(m: NetworkManifest, op: string) {
  if (m.environment === "local-mock") return manifestIsReadyForWrites(m);
  return manifestIsReadyForWrites(m) && ["create", "approve", "pay"].includes(op);
}
export interface ManifestVerification {
  chainIdMatch: boolean;
  bytecodeNonEmpty: boolean;
  usdcDecimalsCorrect: boolean;
  bytecodeHashMatch: boolean;
  immutableTokenMatch: boolean;
  allPassed: boolean;
  failureReason?: string;
  verifiedAt: number;
}
export async function verifyManifestOnChain(
  c: PublicClient,
  m: NetworkManifest,
): Promise<ManifestVerification> {
  const result: ManifestVerification = {
    chainIdMatch: false,
    bytecodeNonEmpty: false,
    usdcDecimalsCorrect: false,
    bytecodeHashMatch: false,
    immutableTokenMatch: false,
    allPassed: false,
    verifiedAt: Date.now(),
  };
  try {
    if (m.environment !== "local-mock" && !reviewedIdentity(m))
      throw Error("未匹配已审 Arc 部署，保持只读。");
    if (
      !m.isDeployed ||
      !isAddress(m.contractAddress) ||
      !m.hasDeploymentBlock ||
      m.deploymentBlock <= 0n ||
      !/^0x[\da-f]{64}$/i.test(m.expectedBytecodeHash ?? "")
    )
      throw Error(
        "Reviewed runtime hash, contract and deployment block are required.",
      );
    if (
      m.environment !== "local-mock" &&
      (m.usdcAddress.toLowerCase() !== TOKEN || !m.sharedBalance)
    )
      throw Error("Canonical Arc token/balance model mismatch.");
    if (
      m.environment === "local-mock" &&
      (m.chainId !== 31338 || new URL(m.rpcUrl!).hostname !== "127.0.0.1")
    )
      throw Error("Local fixture identity mismatch.");
    result.chainIdMatch = (await c.getChainId()) === m.chainId;
    if (!result.chainIdMatch) throw Error("RPC chain ID mismatch.");
    const [code, token, decimals, tokenCode, head, version, atDeployment, beforeDeployment, deployment] = await Promise.all(
      [
        c.getCode({ address: m.contractAddress as Address }),
        c.readContract({
          address: m.contractAddress as Address,
          abi: SPLITLINK_ABI,
          functionName: "USDC",
        }),
        c.readContract({
          address: m.usdcAddress as Address,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        c.getCode({ address: m.usdcAddress as Address }),
        c.getBlockNumber({ cacheTime: 0 }),
        c.readContract({
          address: m.contractAddress as Address,
          abi: [
            {
              type: "function",
              name: "CONTRACT_VERSION",
              inputs: [],
              outputs: [{ type: "string" }],
              stateMutability: "view",
            },
          ] as const,
          functionName: "CONTRACT_VERSION",
        }),
        c.getCode({ address: m.contractAddress as Address, blockNumber: m.deploymentBlock }),
        m.environment !== "local-mock" ? c.request({ method: "eth_getCode", params: [m.contractAddress as Address, toHex(m.deploymentBlock - 1n)] }) : c.getCode({ address: m.contractAddress as Address, blockNumber: m.deploymentBlock - 1n }),
        (async () => {
          if (m.environment !== "arc-testnet" && m.environment !== "arc-mainnet") return null;
          const hash = m.environment === "arc-mainnet" ? "0xce853fe20ec7a0539a40ba10b74fc6b58b312a0716eb94a34f7d2f9dd69c5ec7" as const : "0xf71ff9f99ab0c3d3e73d9c3741f79e00949cbb68340068996ba67570c4eab463" as const;
          return Promise.all([c.getTransaction({ hash }), c.getTransactionReceipt({ hash }), c.getBlock({ blockNumber: m.deploymentBlock })]);
        })(),
      ],
    );
    result.bytecodeNonEmpty = !!code && code !== "0x";
    result.bytecodeHashMatch =
      result.bytecodeNonEmpty &&
      keccak256(code!).toLowerCase() === m.expectedBytecodeHash!.toLowerCase();
    result.usdcDecimalsCorrect = decimals === 6;
    result.immutableTokenMatch =
      token.toLowerCase() === m.usdcAddress.toLowerCase();
    if (deployment) {
      const [tx, receipt, canonical] = deployment;
      if (tx.to !== null || tx.value !== 0n || tx.nonce !== 0 ||
        keccak256(tx.input) !== "0x1bcd3c4b1c938e94a5294415197ecc8b718737b2716a539bc62fcb750c253393" ||
        tx.from.toLowerCase() !== "0x50df19631d9410ecee43850e21e46322114ee483" ||
        receipt.status !== "success" || receipt.blockNumber !== m.deploymentBlock ||
        receipt.contractAddress?.toLowerCase() !== m.contractAddress.toLowerCase() ||
        receipt.blockHash !== canonical.hash || tx.blockHash !== receipt.blockHash)
        throw Error("部署交易或规范区块身份不匹配。");
    }
    if (
      !result.bytecodeHashMatch ||
      !result.usdcDecimalsCorrect ||
      !result.immutableTokenMatch ||
      !tokenCode ||
      tokenCode === "0x" ||
      head < m.deploymentBlock ||
      version !== m.contractVersion ||
      !atDeployment ||
      atDeployment === "0x" ||
      keccak256(atDeployment).toLowerCase() !==
        m.expectedBytecodeHash!.toLowerCase() ||
      (beforeDeployment !== undefined && beforeDeployment !== "0x") ||
      (m.environment !== "local-mock" && beforeDeployment !== "0x")
    )
      throw Error(
        "Runtime, immutable USDC, token code/decimals, version or deployment block mismatch.",
      );
    result.allPassed = true;
  } catch (e) {
    result.failureReason = (e as Error).message;
  }
  return result;
}
export function requestUrl(m: NetworkManifest, id: bigint, page = "pay") {
  return `${location.origin}/${page}/${m.chainId}/${m.contractAddress}/${id}`;
}
export function parseRoute(
  chain: string | undefined,
  address: string | undefined,
  id: string | undefined,
) {
  if (
    !chain ||
    !/^\d+$/.test(chain) ||
    !Number.isSafeInteger(Number(chain)) ||
    !address ||
    !isAddress(address) ||
    !id ||
    !/^[1-9]\d*$/.test(id) ||
    BigInt(id) >= 2n ** 256n
  )
    throw Error("付款链接格式无效。");
  if (![5042, 5042002, 31338].includes(Number(chain)))
    throw Error("不支持此网络。");
  const m = getSupportedManifest(Number(chain), address);
  if (!m) throw Error("此链接的合约未在本站受支持部署中。");
  return { m, id: BigInt(id) };
}
