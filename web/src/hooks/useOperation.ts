import { userMessage } from "@/lib/messages";
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
  const [stage, setStage] = useState<"idle" | "rechecking" | "wallet" | "confirming" | "verifying">("idle");
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
    setStage("rechecking");
    setMessage("");
    setReview(null);
    try {
      const result = await prepareOperation(m, account, call);
      if (!active.current || epoch !== version.current || key !== wallet.live())
        throw Error("Wallet context changed during preflight.");
      setReview({ call, quote: result.quote, account, key });
    } catch (e) {
      setMessage(userMessage(e));
      await onComplete();
    } finally {
      setBusy(false);
      setStage("idle");
    }
  };
  const sign = async () => {
    if (!review || !window.ethereum) return;
    const r = review,
      epoch = version.current;
    setBusy(true);
    setStage("rechecking");
    setMessage("");
    try {
      const record = await submitOperation({
        m,
        account: r.account,
        call: r.call,
        reviewed: r.quote,
        provider: window.ethereum,
        onStage: setStage,
        contextValid: () =>
          active.current &&
          epoch === version.current &&
          wallet.live() === r.key,
      });
      setMessage(
        record.txState === "confirmed" &&
          record.businessVerification === "verified"
          ? record.operationType === "create" ? `Creation verified. Open and share actual request #${record.requestId} below.` : record.operationType === "approve" ? "Approval and exact allowance verified. This is not payment. Preview the payment fees next." : "Payment, distribution events and onchain state verified. Full acceptance and balance attribution are recorded separately."
          : record.txState === "rejected"
            ? "You rejected this signature."
            : `Transaction status: ${record.txState}; Onchain verification: ${record.businessVerification}。${record.error ? userMessage(record.error.message) : "If unresolved, recover status only. Do not submit again."}`,
      );
    } catch (e) {
      setMessage(userMessage(e));
    } finally {
      setReview(null);
      setBusy(false);
      setStage("idle");
      await onComplete();
    }
  };
  return {
    manifest: m,
    review,
    busy,
    stage,
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
