import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Address, EIP1193Provider } from "viem";
import { providerContext } from "@/lib/runner";
import { ensureArcTestnet, walletError } from "@/lib/walletNetwork";
declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
const Context = createContext<{
  account?: Address;
  chainId?: number;
  generation: number;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  live: () => string;
}>({ generation: 0, connect: async () => {}, switchNetwork: async () => {}, live: () => "" });
export function WalletProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<{
    account?: Address;
    chainId?: number;
    generation: number;
  }>({ generation: 0 });
  const ref = useRef("");
  const refresh = async () => {
    if (!window.ethereum) return;
    try {
      const c = await providerContext(window.ethereum);
      const key = `${c.account}/${c.chainId}`;
      if (key !== ref.current) {
        ref.current = key;
        setContext((old) => ({ ...c, generation: old.generation + 1 }));
      }
    } catch {
      ref.current = "";
      setContext((old) => ({ generation: old.generation + 1 }));
    }
  };
  useEffect(() => {
    void refresh();
    const handler = () => {
      ref.current = "changing";
      setContext((old) => ({ generation: old.generation + 1 }));
      void refresh();
    };
    window.ethereum?.on?.("accountsChanged", handler);
    window.ethereum?.on?.("chainChanged", handler);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handler);
      window.ethereum?.removeListener?.("chainChanged", handler);
    };
  }, []);
  return (
    <Context.Provider
      value={{
        ...context,
        live: () => ref.current,
        connect: async () => {
          if (!window.ethereum)
            throw Error(
              "未检测到浏览器钱包。请安装兼容 EVM 的钱包扩展，或在钱包浏览器中打开本站；公开查询无需连接。",
            );
          try {
            await window.ethereum.request({ method: "eth_requestAccounts" });
            await ensureArcTestnet(window.ethereum);
            await refresh();
          } catch (e) { await refresh(); throw Error(walletError(e)); }
        },
        switchNetwork: async () => {
          if (!window.ethereum) throw Error("未检测到浏览器钱包，请先连接。");
          try { await ensureArcTestnet(window.ethereum); await refresh(); }
          catch (e) { throw Error(walletError(e)); }
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useWallet = () => useContext(Context);
