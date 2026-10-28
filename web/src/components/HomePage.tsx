import { getManifest, publicClientFor, verifyManifestOnChain } from "@/lib/manifest";
import { formatFee18 } from "@/lib/preflight";
import { useWallet } from "@/hooks/useWallet";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, ChevronRight, ExternalLink, Link2, Plus, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
import { MyRequests } from "./MyRequests";
export function HomePage() {
 const m = getManifest(), wallet = useWallet();
 const [verified, setVerified] = useState(false), [error, setError] = useState("");
 const [balance, setBalance] = useState<bigint | null>(null);
 useEffect(() => {
   let alive = true; setVerified(false); setError(""); setBalance(null);
   const c = publicClientFor(m);
   void (async () => {
     const result = await verifyManifestOnChain(c as any, m);
     if (!result.allPassed) throw Error("主网暂未核实，请稍后重试。交易保持关闭。");
     if (alive) setVerified(true);
     if (wallet.account && wallet.chainId === m.chainId) {
       const value = await c.getBalance({ address: wallet.account, blockTag: "latest" });
       if (alive) setBalance(value);
     }
   })().catch(e => { if (alive) setError(e.message); });
   return () => { alive = false; };
 }, [m, wallet.account, wallet.chainId]);
 return <div className="dashboard">
   <section className="page-heading"><div><p className="overline">A LITTLE MORE CONNECTED.</p><h1>一起收款，轻松分账<span>✳</span></h1><p>一个链接，让每一份 USDC 都有明确去向。</p></div><Link to="/create" className="primary-button"><Plus size={18}/>创建分账</Link></section>
   <div className="dashboard-columns"><div className="dashboard-main">
     <section className="balance-card"><div className="card-topline"><span><span className="usdc-symbol">$</span>{wallet.account ? "当前钱包 · 主网余额" : "你的 USDC 分账工作台"}</span><span className="network-pill"><span className="status-dot"/>MAINNET</span></div><div className="big-amount">{balance === null ? "—" : formatFee18(balance)}<span>USDC</span></div><p className="balance-caption">{wallet.account && wallet.chainId === m.chainId ? wallet.account : "连接 Arc 主网钱包，开始创建与分享"}</p><div className="balance-bottom"><span><ShieldCheck size={16}/> {verified ? "部署与合约代码已核实" : error || "正在核对主网部署"}</span><Link to="/create">开始分账<ArrowUpRight size={17}/></Link></div><div className="card-orbit orbit-one"/><div className="card-orbit orbit-two"/></section>
     <div className="quick-actions"><Link to="/create"><span className="action-icon blue"><Plus size={21}/></span><span><strong>新建分账</strong><small>金额、收款人与份额</small></span><ChevronRight size={16}/></Link><a href={`${m.explorerBase}/address/${m.contractAddress}`} target="_blank" rel="noreferrer"><span className="action-icon lavender"><ExternalLink size={20}/></span><span><strong>主网合约</strong><small>公开代码与交易记录</small></span><ChevronRight size={16}/></a></div>
     <section className="requests-panel"><div className="section-heading"><h2>我的主网请求</h2><Link to="/create">新建<ArrowUpRight size={14}/></Link></div><MyRequests revision={wallet.generation}/></section>
     <section className="tip-card"><span className="tip-icon"><Sparkles size={22}/></span><div><h3>把协作，变成一个链接。</h3><p>创建请求不转移本金。分享实际创建的链接，由付款人准确授权后支付。</p></div><Link to="/create" aria-label="开始创建分账"><ArrowRight size={21}/></Link></section>
   </div><aside className="dashboard-side">
     <section className="allocation-card"><div className="section-heading"><h2>三步，清晰到每一份</h2><Users size={17}/></div><div className="allocation-person"><span className="person-avatar person-a">1</span><div><strong>创建与分享</strong><small>2–5 个地址，自定义份额</small></div></div><div className="allocation-person"><span className="person-avatar person-b">2</span><div><strong>准确授权，逐笔付款</strong><small>预览本金与 gas，再由钱包确认</small></div></div><div className="allocation-person"><span className="person-avatar person-a"><Check size={16}/></span><div><strong>公开链上收据</strong><small>按实际事件核对每一份分配</small></div></div><p className="rounding-note">最小单位余数归入最后一份，总额精确一致。</p></section>
     <section className="wallet-card"><span className="wallet-card-icon"><Wallet size={22}/></span><h2>你的钱包，你做主。</h2><p>这是 Arc 主网，交易消耗真实 USDC。查询公开请求无需连接；私钥与助记词始终由你保管。</p><div><ShieldCheck size={14}/>无托管 · 无平台手续费</div></section>
     <a className="contract-link" href={`${m.explorerBase}/tx/0xce853fe20ec7a0539a40ba10b74fc6b58b312a0716eb94a34f7d2f9dd69c5ec7`} target="_blank" rel="noreferrer"><span><Link2 size={16}/>查看真实主网部署</span><ExternalLink size={14}/></a>
   </aside></div>
   <div className="preview-note"><span className="preview-note-dot"/>Arc Mainnet · 每笔 gas 硬上限 0.01 USDC · 创建、授权与付款分别确认，不自动发起下一笔。</div>
 </div>;
}
