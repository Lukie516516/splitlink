import { useEffect, useState } from "react";
import { decodeFunctionData, erc20Abi } from "viem";
import { SPLITLINK_ABI, formatUsdc6 } from "@/lib/splitlink";
import { type ReturnTypeOfOperation } from "./reviewTypes";
import { formatFee18, QUOTE_TTL_MS } from "@/lib/preflight";
const names = { create: "创建请求", approve: "设置准确授权额度", pay: "支付分账", approveReset: "重置授权", cancel: "取消请求" };
export function Review({ op }: { op: ReturnTypeOfOperation }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
  const r = op.review;
  if (!r) return op.message ? <p role="alert" className="notice">{op.message}</p> : null;
  const remaining = Math.max(0, Math.ceil((r.quote.quotedAt + QUOTE_TTL_MS - Date.now()) / 1000));
  const approval = ["approve", "approveReset"].includes(r.call.operation);
  const d = decodeFunctionData({ abi: approval ? erc20Abi : SPLITLINK_ABI, data: r.call.data });
  const args = d.args as readonly unknown[];
  return <section className="review" aria-label="交易复核">
    <h2>复核：{names[r.call.operation]}</h2>
    <p>Arc Testnet · 测试 USDC · {remaining > 0 ? `报价还剩 ${remaining} 秒` : "报价已过期，请关闭后重新预览"}</p>
    <code>签名钱包：{r.account}</code><code>交易目标：{r.call.target}</code>
    {r.call.operation === "create" ? <><p>公开标题：{String(args[0])}</p><p>请求总额：{formatUsdc6(args[1] as bigint)} USDC（创建时不转移本金）</p>{(args[2] as readonly string[]).map((a,i)=><code key={a}>收款人 {i+1}：{a} · {Number((args[3] as readonly number[])[i])/100}%</code>)}</> : <p>请求编号：{r.call.requestId?.toString()} · 总额 {formatUsdc6(r.call.principal6)} USDC</p>}
    {approval && <><code>授权给：{String(args[0])}</code><p>设置总额度为 {formatUsdc6(args[1] as bigint)} USDC，不是增加额度；授权不等于付款。</p></>}
    {r.call.operation === "pay" && <p>一次支付完整总额，包含本人作为收款人的份额；必须有完整总额的余额和授权。</p>}
    <p>原生 value：0 · nonce：{r.quote.nonce} · gas 上限：{r.quote.gasLimit.toString()}</p>
    <p>本次最高 gas 预算：<strong>{formatFee18(r.quote.feeBudget18)} USDC</strong>（向上取整，实际费以收据为准）。{r.call.operation === "pay" ? "本金另计。" : ""}</p>
    <p>原生 gas 使用 18 位精度，USDC 合约使用 6 位，两者是同一余额，不能相加。</p>
    <details><summary>查看准确 calldata</summary><code>{r.call.data}</code></details>
    <p>下一步打开钱包，由你本人确认。报价在请求钱包前核验；若在钱包弹窗停留过久，请拒绝并返回重新预览。不会自动重签或重发。</p>
    <button disabled={op.busy} onClick={op.close}>返回，不请求签名</button>
    <button disabled={op.busy || remaining === 0} onClick={() => void op.sign()}>{op.busy ? "等待钱包或链上结果…" : "本人确认，打开钱包签名"}</button>
  </section>;
}
