import { getManifest, type NetworkManifest } from "./manifest";
import type { EIP1193Provider } from "viem";
export const ARC_CHAIN_HEX = "0x4cef52";
export async function ensureArcNetwork(provider: EIP1193Provider, m: NetworkManifest = getManifest()) {
  const chainHex = `0x${m.chainId.toString(16)}`;
  if (Number(await provider.request({ method: "eth_chainId" })) === m.chainId) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code ?? (error as { cause?: { code?: number } }).cause?.code;
    if (code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: chainHex, chainName: m.chainName, nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [m.rpcUrl!], blockExplorerUrls: [m.explorerBase] }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== m.chainId) throw Error(`Wallet did not switch to ${m.chainName}. Confirm the network in your wallet.`);
}
export function walletError(error: unknown) {
  if ((error as { code?: number })?.code === 4001) return "You cancelled the wallet request. No automatic retry.";
  return error instanceof Error && !/[\u3400-\u9fff]/.test(error.message) ? error.message : "Wallet request incomplete. Unlock your wallet, check the network and retry. No automatic signing.";
}

export const ensureArcTestnet = (provider: EIP1193Provider) => ensureArcNetwork(provider, {...getManifest(), chainId: 5042002, chainName: "Arc Testnet", rpcUrl: "https://rpc.testnet.arc.io", explorerBase: "https://explorer.testnet.arc.io"});
