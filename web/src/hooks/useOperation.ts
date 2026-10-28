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
  const [message, setMessage] = useState("");
  useEffect(() => {
    setReview(null);
  }, [wallet.generation, m]);
  const prepare = async (call: Intent) => {
    if (!wallet.account || wallet.chainId !== m.chainId) {
      setMessage(`请切换至 ${m.chainName} 后继续。`);
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
      setMessage(userMessage(e));
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
          ? record.operationType === "create" ? `创建已核实，请在下方打开实际请求 #${record.requestId} 并分享。` : record.operationType === "approve" ? "授权交易和准确额度已核实；这不是付款，请重新预览付款费用。" : "付款交易、分配事件与链上状态已核实；完整测试验收与余额归因单独列示。"
          : record.txState === "rejected"
            ? "你已拒绝本次签名。"
            : `本次状态：${record.txState}；链上结果核验：${record.businessVerification}。${record.error ? userMessage(record.error.message) : "结果未决时仅恢复，不重复提交。"}`,
      );
    } catch (e) {
      setMessage(userMessage(e));
    } finally {
      setReview(null);
      setBusy(false);
      await onComplete();
    }
  };
  return {
    manifest: m,
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
