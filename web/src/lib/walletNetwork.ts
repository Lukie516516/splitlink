import type { EIP1193Provider } from "viem";
export const ARC_CHAIN_HEX = "0x4cef52";
export async function ensureArcTestnet(provider: EIP1193Provider) {
  if (Number(await provider.request({ method: "eth_chainId" })) === 5042002) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
  } catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code ?? (error as { cause?: { code?: number } }).cause?.code;
    if (code !== 4902) throw error;
    await provider.request({ method: "wallet_addEthereumChain", params: [{ chainId: ARC_CHAIN_HEX, chainName: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: ["https://rpc.testnet.arc.io"], blockExplorerUrls: ["https://explorer.testnet.arc.io"] }] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== 5042002) throw Error("钱包未切换至 Arc Testnet，请在钱包内确认。");
}
export function walletError(error: unknown) {
  if ((error as { code?: number })?.code === 4001) return "你已取消钱包请求，未自动重试。";
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : "钱包请求未完成。请解锁钱包、检查网络并重试；不会自动签名。";
}
