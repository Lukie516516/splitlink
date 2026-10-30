import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleHelp, ExternalLink, Link2, ShieldCheck, Wallet, X, Menu } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { TransactionActivity } from "./TransactionActivity";
import { getManifest, parseRoute } from "@/lib/manifest";
export function Layout({ children }: { children: ReactNode }) {
  const wallet = useWallet(), location = useLocation();
  const parts = location.pathname.split("/");
  let m = getManifest();
  if (["pay", "receipt"].includes(parts[1])) {
    try { m = parseRoute(parts[2], parts[3], parts[4]).m; } catch { /* Invalid routes remain non-signing. */ }
  }
  const [error, setError] = useState(""), [menu,setMenu]=useState(false), [scrolled,setScrolled]=useState(false);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const update=()=>setScrolled(window.scrollY>12);
    update();window.addEventListener("scroll",update,{passive:true});
    return()=>window.removeEventListener("scroll",update);
  },[]);
  useEffect(() => {
    setMenu(false);
    window.scrollTo({top:0,left:0,behavior:"instant"});
    if (!main.current || !globalThis.IntersectionObserver) return;
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
      if(entry.isIntersecting){entry.target.classList.add("is-visible");observer.unobserve(entry.target);}
    }),{threshold:0.06});
    const cards=main.current.querySelectorAll(".reveal");cards.forEach(card=>observer.observe(card));
    return()=>observer.disconnect();
  },[location.pathname]);
  const connect=()=>void (wallet.account && wallet.chainId !== m.chainId ? wallet.switchNetwork(m) : wallet.connect(m)).then(()=>setError('')).catch((e)=>setError(e.message));
  return <div className={`app-shell flow-shell ${menu?'menu-open':''} ${scrolled?'is-scrolled':''}`}>
    <div className="ambient-glow" aria-hidden="true"/>
    <header className="site-header">
      <NavLink to="/" className="brand" aria-label="SplitLink overview"><span className="brand-symbol"><Link2 size={23}/></span>SplitLink</NavLink>
      <nav className="desktop-nav" aria-label="Main navigation"><NavLink end to="/">Overview</NavLink><NavLink to="/create">Create split</NavLink></nav>
      <div className="header-actions"><span className="preview-pill">{m.chainName}</span><button className="connect-button" onClick={connect}><Wallet size={16}/>{wallet.account?(wallet.chainId!==m.chainId?`Switch ${m.chainName}`:`${wallet.account.slice(0,6)}…${wallet.account.slice(-4)}`):'Connect wallet'}</button><button className="mobile-menu icon-button" aria-label={menu?'Close menu':'Open menu'} aria-expanded={menu} onClick={()=>setMenu(!menu)}>{menu?<X size={20}/>:<Menu size={20}/>}</button></div>
    </header>
    {menu&&<nav className="mobile-navigation" aria-label="Mobile navigation"><NavLink end to="/">Overview</NavLink><NavLink to="/create">Create split</NavLink></nav>}
    <div className="app-content">
      {error&&<div className="connection-error" role="alert">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
      <main ref={main}>{children}<details className="recovery-disclosure"><summary>Local activity & recovery</summary><TransactionActivity/></details></main>
      <footer><NavLink to="/" className="footer-brand"><Link2 size={16}/>SplitLink</NavLink><span><ShieldCheck size={13}/>Self-custody · No platform fee</span><a href="https://github.com/Lukie516516/splitlink" target="_blank" rel="noreferrer">Source code<ExternalLink size={13}/></a><span><CircleHelp size={13}/>{m.environment === "arc-mainnet" ? "Mainnet USDC" : "Test assets"} · Confirm each transaction in your wallet</span></footer>
    </div>
  </div>;
}
