export function userMessage(error: unknown): string {
  const s = error instanceof Error ? error.message : String(error);
  if (/[\u3400-\u9fff]/.test(s) && s.length < 220) return s;
  if (/4001|reject|declin/i.test(s)) return "你已拒绝钱包签名，未自动重试。";
  if (/expired|staleQuote|fee cap increased/i.test(s)) return "报价或费用已变化，请重新预览后再确认。";
  if (/RequestNotOpen|Paid|Cancelled/i.test(s)) return "请求已付款或取消，请刷新链上状态。";
  if (/RequestNotFound/i.test(s)) return "未找到此链上请求，请检查链接编号。";
  if (/insufficientPrincipal|Insufficient USDC/i.test(s)) return "USDC 不足：需保留完整总额（含本人收款份额）及网络费用。";
  if (/insufficientFeeBudget/i.test(s)) return "余额不足以覆盖完整总额、最高 gas 预算及预留。";
  if (/allowance insufficient/i.test(s)) return "授权额度不足，请先单独预览准确总额的授权。";
  if (/context changed|Wallet context/i.test(s)) return "钱包、网络或输入已变化，请重新预览。";
  if (/nonce|pending transaction/i.test(s)) return "钱包仍有待处理交易或 nonce 已变化，请先恢复状态。";
  if (/revert|simulation/i.test(s)) return "模拟未通过，未请求签名。请刷新请求和授权；不要因未知错误重置授权。";
  if (/RPC|fetch|http|network|timeout|integration|unavailable/i.test(s)) return "链上读取或身份验证暂不可用，保持只读。请稍后重试。";
  return "操作尚未核实，已停止。请查看钱包活动并只读恢复，不要重复提交。";
}
