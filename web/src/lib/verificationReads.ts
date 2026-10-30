import type { PublicClient } from "viem";

// One short-lived verification pass only. Never shared between transactions,
// previews, retries or background recovery runs. Failed reads are not retained.
export function verificationReads(client: PublicClient): PublicClient {
  const reads = new Map<string, Promise<unknown>>();
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const options = args[0] as Record<string, unknown> | undefined;
        const method = String(property);
        const fixedBlock = options?.blockNumber !== undefined || options?.blockHash !== undefined;
        const identityRead = method === "readContract" &&
          ["USDC", "decimals", "CONTRACT_VERSION"].includes(String(options?.functionName));
        const reusable = ["getChainId", "getCode", "getTransaction", "getTransactionReceipt"].includes(method) ||
          (["getBlock", "getBalance"].includes(method) && fixedBlock) ||
          (method === "request" && options?.method === "eth_getCode") ||
          (method === "readContract" && (fixedBlock || identityRead));
        // Fresh heads and mutable latest business reads always go to the RPC.
        if (!reusable) return Reflect.apply(value, target, args);
        const key = method + JSON.stringify(args, (_, v) => typeof v === "bigint" ? { bigint: v.toString() } : v);
        const existing = reads.get(key);
        if (existing) return existing;
        const result = Promise.resolve().then(() => Reflect.apply(value, target, args));
        reads.set(key, result);
        void result.catch(() => { if (reads.get(key) === result) reads.delete(key); });
        return result;
      };
    },
  });
}
