// Studio export continuation: mandatory reviewed runtime and canonical identity.
import {
  createPublicClient,
  defineChain,
  http,
  isAddress,
  keccak256,
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
};
export const manifests: NetworkManifest[] = [built];
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
    transport: http(m.rpcUrl, { timeout: 8000, retryCount: 1 }),
  });
}
export function manifestIsReadyForWrites(m: NetworkManifest) {
  return (
    m.isDeployed &&
    m.hasDeploymentBlock &&
    /^0x[\da-f]{64}$/i.test(m.expectedBytecodeHash ?? "") &&
    (m.environment === "local-mock" || m.runtimeVerified === true)
  );
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
    const [code, token, decimals, tokenCode, head, version] = await Promise.all(
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
      ],
    );
    result.bytecodeNonEmpty = !!code && code !== "0x";
    result.bytecodeHashMatch =
      result.bytecodeNonEmpty &&
      keccak256(code!).toLowerCase() === m.expectedBytecodeHash!.toLowerCase();
    result.usdcDecimalsCorrect = decimals === 6;
    result.immutableTokenMatch =
      token.toLowerCase() === m.usdcAddress.toLowerCase();
    const [atDeployment, beforeDeployment] = await Promise.all([
      c.getCode({
        address: m.contractAddress as Address,
        blockNumber: m.deploymentBlock,
      }),
      c.getCode({
        address: m.contractAddress as Address,
        blockNumber: m.deploymentBlock - 1n,
      }),
    ]);
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
      (beforeDeployment !== undefined && beforeDeployment !== "0x")
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
    throw Error("Malformed payment route.");
  if (![5042, 5042002, 31338].includes(Number(chain)))
    throw Error("Unsupported network.");
  const m = getSupportedManifest(Number(chain), address);
  if (!m) throw Error("Unsupported contract.");
  return { m, id: BigInt(id) };
}
