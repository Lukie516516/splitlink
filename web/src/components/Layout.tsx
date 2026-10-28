import { NavLink, useLocation } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, CircleHelp, ExternalLink, LayoutDashboard, Link2, Plus, ShieldCheck, Wallet, X, Menu } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { TransactionActivity } from "./TransactionActivity";
export function Layout({ children }: { children: ReactNode }) {
  const wallet = useWallet(), location = useLocation();
  const [error, setError] = useState(""), [menu,setMenu]=useState(false);
  const connect=()=>void (wallet.account && wallet.chainId !== 5042002 ? wallet.switchNetwork() : wallet.connect()).then(()=>setError('')).catch((e)=>setError(e.message));
  const request="/pay/5042002/0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010/1";
  return <div className={`app-shell ${menu?'menu-open':''}`}>
    <aside className="sidebar">
      <NavLink to="/" className="brand"><span className="brand-symbol"><Link2 size={24}/></span>SplitLink<span className="brand-dot">®</span></NavLink>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="主导航"><NavLink end to="/" onClick={()=>setMenu(false)}><LayoutDashboard size={19}/>概览</NavLink><NavLink to="/create" onClick={()=>setMenu(false)}><Plus size={19}/>创建分账</NavLink><NavLink to={request} onClick={()=>setMenu(false)}><Link2 size={19}/>链上请求<span className="nav-count">1</span></NavLink></nav>
      <div className="sidebar-bottom"><div className="network-box"><span className="status-dot"/><div><strong>Arc Testnet</strong><small>测试网络 · Chain 5042002</small></div><ArrowUpRight size={15}/></div><a href="https://github.com/Lukie516516/splitlink" target="_blank" rel="noreferrer"><ExternalLink size={17}/>开源代码<ArrowUpRight size={14}/></a><div className="sidebar-caption"><ShieldCheck size={14}/>自持钱包 · 不托管资金</div></div>
    </aside>
    {menu&&<button className="menu-scrim" aria-label="关闭菜单" onClick={()=>setMenu(false)}/>}
    <div className="app-content"><header className="topbar"><button className="mobile-menu icon-button" aria-label="打开菜单" onClick={()=>setMenu(!menu)}>{menu?<X size={20}/>:<Menu size={20}/>}</button><div className="breadcrumb">工作空间 <span>/</span> <strong>{location.pathname==='/create'?'创建分账':location.pathname.startsWith('/pay')?'请求详情':location.pathname.startsWith('/receipt')?'链上收据':'概览'}</strong></div><div className="topbar-right"><span className="preview-pill">测试网</span><button className="connect-button" onClick={connect}><Wallet size={16}/>{wallet.account?(wallet.chainId!==5042002?'切换 Arc Testnet':`${wallet.account.slice(0,6)}…${wallet.account.slice(-4)}`):'连接钱包'}</button></div></header>
      {error&&<div className="connection-error" role="alert">{error}<button aria-label="关闭错误" onClick={()=>setError('')}><X size={14}/></button></div>}
      <main>{children}<details className="recovery-disclosure"><summary>本机交易记录与恢复</summary><TransactionActivity/></details></main>
      <footer><span>SplitLink · USDC 分账工作台</span><span><CircleHelp size={13}/>测试网预览 · 钱包逐笔确认</span></footer>
    </div>
  </div>;
}
