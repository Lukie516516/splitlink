import { z } from "zod";
import {
  createPublicClient,
  defineChain,
  http,
  isAddress,
  keccak256,
  erc20Abi,
  type Address,
} from "viem";
import { splitAbi } from "../abi";
const addr = z.string().refine(isAddress);
const decimal = z.string().regex(/^\d+$/);
export const manifestSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string(),
  environment: z.enum(["local-mock", "arc-testnet", "arc-mainnet"]),
  rpcUrl: z.string().url(),
  explorer: z.string().url().nullable(),
  usdcAddress: addr,
  splitLinkAddress: addr,
  deploymentBlock: decimal,
  contractVersion: z.literal("1.0.0"),
  bytecodeHash: z.string().regex(/^0x[\da-fA-F]{64}$/),
  resetRequired: z.boolean(),
  sharedBalance: z.boolean(),
  writesEnabled: z.boolean(),
  appOrigin: z.string().url(),
});
export type Manifest = z.infer<typeof manifestSchema>;
export const arcNetworks = [
  {
    chainId: 5042002,
    name: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
  },
  {
    chainId: 5042,
    name: "Arc Mainnet",
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
  },
];
export const manifests: Manifest[] = [];
export async function loadManifests() {
  // Built-time allowlist. Local addresses are accepted only from an explicitly enabled loopback fixture.
  if (
    import.meta.env.VITE_ENABLE_LOCAL === "true" &&
    ["localhost", "127.0.0.1"].includes(location.hostname)
  ) {
    const response = await fetch("/local-manifest.json", { cache: "no-store" });
    if (response.ok) {
      const m = manifestSchema.parse(await response.json());
      if (
        m.chainId !== 31337 ||
        m.environment !== "local-mock" ||
        new URL(m.rpcUrl).hostname !== "127.0.0.1"
      )
        throw Error("Invalid local fixture.");
      manifests.push(m);
    }
  }
  // Reviewed Arc release manifests must be imported here, after G3/G4. No arbitrary URL targets.
}
export function client(m: Manifest) {
  const chain = defineChain({
    id: m.chainId,
    name: m.name,
    nativeCurrency: {
      name: m.sharedBalance ? "USDC" : "LOCAL TEST ETH",
      symbol: m.sharedBalance ? "USDC" : "TEST",
      decimals: 18,
    },
    rpcUrls: { default: { http: [m.rpcUrl] } },
  });
  return createPublicClient({
    chain,
    transport: http(m.rpcUrl, { timeout: 10000, retryCount: 1 }),
  });
}
export async function verifyDeployment(m: Manifest) {
  manifestSchema.parse(m);
  const c = client(m);
  if ((await c.getChainId()) !== m.chainId)
    throw Error("integrationError: RPC chain ID mismatch.");
  const code = await c.getCode({ address: m.splitLinkAddress as Address });
  if (!code || keccak256(code) !== m.bytecodeHash)
    throw Error("integrationError: SplitLink bytecode mismatch.");
  const [token, decimals] = await Promise.all([
    c.readContract({
      address: m.splitLinkAddress as Address,
      abi: splitAbi,
      functionName: "USDC",
    }),
    c.readContract({
      address: m.usdcAddress as Address,
      abi: erc20Abi,
      functionName: "decimals",
    }),
  ]);
  if (token.toLowerCase() !== m.usdcAddress.toLowerCase() || decimals !== 6)
    throw Error("integrationError: Immutable token or decimals mismatch.");
  if (m.environment !== "local-mock")
    throw Error("Arc runtime validation is pending. Writes are disabled.");
  if (
    ((await c.getCode({ address: m.usdcAddress as Address })) ?? "0x") === "0x"
  )
    throw Error("integrationError: Local mock token missing.");
  if ((await c.getBlockNumber()) < BigInt(m.deploymentBlock))
    throw Error("integrationError: Deployment block is ahead of RPC.");
  return c;
}
export function resolveRoute(path: string) {
  if (path === "/" || path === "/create") return { page: "create" as const };
  const match =
    /^\/(pay|receipt)\/(\d+)\/(0x[\da-fA-F]{40})\/([1-9]\d*)\/?$/.exec(path);
  if (
    !match ||
    !Number.isSafeInteger(Number(match[2])) ||
    BigInt(match[4]) >= 2n ** 256n
  )
    return { error: "Malformed or unknown route." };
  const [, page, chain, address, id] = match;
  if (![...arcNetworks, ...manifests].some((m) => m.chainId === Number(chain)))
    return { error: "Unsupported network." };
  const m = manifests.find(
    (m) =>
      m.chainId === Number(chain) &&
      m.splitLinkAddress.toLowerCase() === address.toLowerCase(),
  );
  if (!m)
    return {
      error: "Unsupported contract. This deployment is not configured.",
    };
  return { page: page as "pay" | "receipt", manifest: m, id: BigInt(id) };
}
export function link(m: Manifest, id: bigint, page = "pay") {
  const origin = m.environment === "local-mock" ? location.origin : m.appOrigin;
  return `${origin}/${page}/${m.chainId}/${m.splitLinkAddress}/${id}`;
}
