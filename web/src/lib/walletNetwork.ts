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
  if (Number(await provider.request({ method: "eth_chainId" })) !== m.chainId) throw Error(`钱包未切换至 ${m.chainName}，请在钱包内确认。`);
}
export function walletError(error: unknown) {
  if ((error as { code?: number })?.code === 4001) return "你已取消钱包请求，未自动重试。";
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : "钱包请求未完成。请解锁钱包、检查网络并重试；不会自动签名。";
}

export const ensureArcTestnet = (provider: EIP1193Provider) => ensureArcNetwork(provider, {...getManifest(), chainId: 5042002, chainName: "Arc Testnet", rpcUrl: "https://rpc.testnet.arc.io", explorerBase: "https://explorer.testnet.arc.io"});
