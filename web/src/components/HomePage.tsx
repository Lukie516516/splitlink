import { readCanonical } from "@/lib/runner";
import { getManifest } from "@/lib/manifest";
import { formatUsdc6, requestStatusLabel } from "@/lib/splitlink";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, Copy, ExternalLink, Link2, Plus, ShieldCheck, Sparkles, Users, Wallet } from "lucide-react";
const requestPath="/pay/5042002/0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010/1";
export function HomePage(){
 const [canonical,setCanonical]=useState<Awaited<ReturnType<typeof readCanonical>>|null>(null);
 const [readError,setReadError]=useState("");
 useEffect(()=>{let alive=true;void readCanonical(getManifest(),1n).then(r=>{if(alive){setCanonical(r);setReadError("");}}).catch(()=>{if(alive)setReadError("链上读取暂不可用，请打开详情重试。");});return()=>{alive=false;};},[]);
 const[copied,setCopied]=useState(false),[copyError,setCopyError]=useState('');
 async function copy(){try{await navigator.clipboard.writeText(location.origin+requestPath);setCopied(true);setCopyError('');}catch{setCopyError('请打开请求页面，从地址栏复制链接。');}}
 return <div className="dashboard">
   <section className="page-heading"><div><p className="overline">A LITTLE MORE CONNECTED.</p><h1>一起收款，轻松分账<span>✳</span></h1><p>一个链接，让每一份 USDC 都有明确去向。</p></div><Link to="/create" className="primary-button"><Plus size={18}/>创建分账</Link></section>
   <div className="dashboard-columns"><div className="dashboard-main">
     <section className="balance-card"><div className="card-topline"><span><span className="usdc-symbol">$</span>请求 #1 · 分账总额</span><span className="network-pill"><span className="status-dot"/>TESTNET</span></div><div className="big-amount">{canonical?formatUsdc6(canonical.request.totalAmount):"—"}<span>USDC</span></div><p className="balance-caption">{canonical?.request.title ?? "正在读取指定请求 #1"}</p><div className="balance-bottom"><div className="avatar-stack"><span>A</span><span>B</span></div><span>2 位收款人<span className="separator">·</span>50 / 50 分配</span><Link to={requestPath}>查看详情<ArrowUpRight size={17}/></Link></div><div className="card-orbit orbit-one"/><div className="card-orbit orbit-two"/></section>
     <div className="quick-actions"><Link to="/create"><span className="action-icon blue"><Plus size={21}/></span><span><strong>新建分账</strong><small>设定金额与份额</small></span><ChevronRight size={16}/></Link><button onClick={copy}><span className="action-icon lavender">{copied?<Check size={20}/>:<Copy size={20}/>}</span><span><strong>{copied?'链接已复制':'分享请求'}</strong><small>复制请求 #1 链接</small></span><ChevronRight size={16}/></button></div>{copyError&&<p className="error">{copyError}</p>}
     <section className="requests-panel"><div className="section-heading"><h2>指定链上请求<span>{canonical?"01":"—"}</span></h2><Link to={requestPath}>查看链上状态<ArrowUpRight size={14}/></Link></div><div className="table-labels"><span>请求</span><span>金额</span><span>收款人</span><span/></div><Link className="request-row" to={requestPath}><span className="request-title"><span className="request-icon"><ArrowDownLeft size={21}/></span><span><strong>Canonical test</strong><small>Self first · 请求 #1</small></span></span><span className="request-value">{canonical?formatUsdc6(canonical.request.totalAmount):"—"}<small>USDC</small></span><span className="table-people"><span>A</span><span>B</span></span><ChevronRight size={18}/></Link><div className="table-foot"><span className="status-dot"/>真实测试网请求<span>{canonical?requestStatusLabel(canonical.request.status):readError||"正在核对真实链上状态"}</span></div></section>
     <section className="tip-card"><span className="tip-icon"><Sparkles size={22}/></span><div><h3>把协作，变成一个链接。</h3><p>为团队项目、共同开销或一次合作，提前算清每个人的份额。</p></div><Link to="/create" aria-label="开始创建分账"><ArrowRight size={21}/></Link></section>
   </div><aside className="dashboard-side">
     <section className="allocation-card"><div className="section-heading"><h2>份额分配</h2><Users size={17}/></div><div className="donut-wrap"><div className="allocation-donut"><div><strong>2</strong><span>位收款人</span></div></div><span className="donut-label left">50%</span><span className="donut-label right">50%</span></div><div className="allocation-person"><span className="person-avatar person-a">A</span><div><strong>钱包 A <span>收款人</span></strong><small>0x50df…e483</small></div><div className="person-amount"><strong>{canonical?formatUsdc6(canonical.allocations[0]):"—"}</strong><small>USDC · 50%</small></div></div><div className="allocation-person"><span className="person-avatar person-b">B</span><div><strong>钱包 B</strong><small>0xF766…3497</small></div><div className="person-amount"><strong>{canonical?formatUsdc6(canonical.allocations[1]):"—"}</strong><small>USDC · 50%</small></div></div><p className="rounding-note">最小单位余数归入最后一份，总额精确一致。</p></section>
     <section className="wallet-card"><span className="wallet-card-icon"><Wallet size={22}/></span><h2>你的钱包，你做主。</h2><p>查询公开请求无需连接钱包。私钥、密码与助记词始终由你保管。</p><div><ShieldCheck size={14}/>无托管 · 无平台手续费</div></section>
     <a className="contract-link" href="https://explorer.testnet.arc.io/address/0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010" target="_blank" rel="noreferrer"><span><Link2 size={16}/>查看部署合约</span><ExternalLink size={14}/></a>
   </aside></div>
   <div className="preview-note"><span className="preview-note-dot"/>已审 Arc Testnet 部署 · 创建、准确授权、付款均需本人钱包逐笔确认。完整场景验收另行记录；测试资产无实际货币价值。</div>
 </div>;
}
