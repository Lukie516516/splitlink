import { useEffect, useState, useRef } from "react";
import type { Address } from "viem";
import { useWallet } from "./useWallet";
import { prepareOperation, submitOperation, type Intent } from "@/lib/runner";
import { type NetworkManifest } from "@/lib/manifest";
import type { PreflightQuote } from "@/lib/preflight";
export function useOperation(
  m: NetworkManifest,
  onComplete: () => Promise<void> | void,
) {
  const wallet = useWallet();
  const active = useRef(true),
    version = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      version.current++;
    };
  }, []);
  const [review, setReview] = useState<{
    call: Intent;
    quote: PreflightQuote;
    account: Address;
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setReview(null);
  }, [wallet.generation, m]);
  const prepare = async (call: Intent) => {
    if (!wallet.account || wallet.chainId !== m.chainId) {
      setMessage(`Switch to ${m.chainName} to continue.`);
      return;
    }
    const key = wallet.live(),
      account = wallet.account,
      epoch = ++version.current;
    setBusy(true);
    setMessage("");
    setReview(null);
    try {
      const result = await prepareOperation(m, account, call);
      if (!active.current || epoch !== version.current || key !== wallet.live())
        throw Error("Wallet context changed during preflight.");
      setReview({ call, quote: result.quote, account, key });
    } catch (e) {
      setMessage((e as Error).message);
      await onComplete();
    } finally {
      setBusy(false);
    }
  };
  const sign = async () => {
    if (!review || !window.ethereum) return;
    const r = review,
      epoch = version.current;
    setBusy(true);
    setMessage("");
    try {
      const record = await submitOperation({
        m,
        account: r.account,
        call: r.call,
        reviewed: r.quote,
        provider: window.ethereum,
        contextValid: () =>
          active.current &&
          epoch === version.current &&
          wallet.live() === r.key,
      });
      setMessage(
        record.txState === "confirmed" &&
          record.businessVerification === "verified"
          ? `${record.operationType} transaction and business result verified. Check the separate request state.`
          : record.txState === "rejected"
            ? "You declined this signature."
            : `Attempt ${record.txState}. Business verification: ${record.businessVerification}. ${record.error?.message ?? ""}`,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setReview(null);
      setBusy(false);
      await onComplete();
    }
  };
  return {
    review,
    busy,
    message,
    prepare,
    sign,
    close: () => {
      version.current++;
      setReview(null);
    },
    invalidate: () => {
      version.current++;
      setReview(null);
    },
  };
}
