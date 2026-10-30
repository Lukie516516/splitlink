import { getManifest, publicClientFor, verifyManifestOnChain } from "@/lib/manifest";
import { formatFee18 } from "@/lib/preflight";
import { useWallet } from "@/hooks/useWallet";
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, Link2, Plus, ShieldCheck, Wallet } from "lucide-react";
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
     if (!result.allPassed) throw Error("Mainnet verification is unavailable. Try again later; transactions remain disabled.");
     if (alive) setVerified(true);
     if (wallet.account && wallet.chainId === m.chainId) {
       const value = await c.getBalance({ address: wallet.account, blockTag: "latest" });
       if (alive) setBalance(value);
     }
   })().catch(e => { if (alive) setError(e.message); });
   return () => { alive = false; };
 }, [m, wallet.account, wallet.chainId]);
 return <div className="dashboard flow-home">
   <section className="flow-hero">
     <p className="hero-eyebrow"><span className="status-dot"/>BUILT ON ARC · USDC PAYMENTS</p>
     <h1>Work together.<br/><span>Split simply.</span></h1>
     <p className="hero-description">One link. Every USDC share, accounted for.</p>
     <section className="launch-card" aria-label="USDC split workspace">
       <div className="launch-tabs"><span className="selected">Split</span><span>USDC · Arc Mainnet</span><ShieldCheck size={17}/></div>
       <div className="launch-amount"><div><span className="field-caption">{wallet.account ? "Wallet balance" : "Your next team payment"}</span><div className="launch-number">{balance === null ? "USDC" : formatFee18(balance)}</div><p>{wallet.account ? `${wallet.account.slice(0,6)}…${wallet.account.slice(-4)}` : "Set an amount. Choose every share."}</p></div><span className="token-pill"><span className="usdc-symbol">$</span>USDC</span></div>
       <div className="flow-connector"><ArrowRight size={17}/></div>
       <div className="launch-recipients"><div className="recipient-avatar-group"><span>A</span><span>B</span><span>+</span></div><div><strong>2–5 recipients</strong><p>Your shares. One atomic payment.</p></div><Link2 size={19}/></div>
       <Link to="/create" className="launch-cta">Create a split link<ArrowRight size={19}/></Link>
       <div className="launch-security"><ShieldCheck size={13}/>{verified ? "Deployment and contract code verified" : error || "Verifying mainnet deployment…"}</div>
     </section>
     <p className="hero-footnote">Creation moves no funds · Confirm payment in your wallet</p>
     <div className="hero-decoration decoration-a" aria-hidden="true">$</div><div className="hero-decoration decoration-b" aria-hidden="true"><Link2 size={28}/></div>
   </section>
   <section className="flow-features reveal"><div className="feature-heading"><p className="overline">ONE LINK. EVERY SHARE.</p><h2>From teamwork to settlement.</h2><p>Public terms. Fixed shares. A clear record at every step.</p></div><div className="feature-grid">
     <article className="feature-card"><span className="feature-icon"><Link2 size={23}/></span><span className="step-number">01</span><h3>Create & share</h3><p>Set the amount and shares, then send a single payment link.</p><Link to="/create">Create split<ArrowUpRight size={15}/></Link></article>
     <article className="feature-card"><span className="feature-icon"><Wallet size={23}/></span><span className="step-number">02</span><h3>Approve exactly. Confirm personally.</h3><p>Review the amount and fees, then confirm in your wallet. Your funds stay in your control.</p><span className="feature-note"><ShieldCheck size={13}/>Non-custodial · No platform fee</span></article>
     <article className="feature-card"><span className="feature-icon"><Check size={23}/></span><span className="step-number">03</span><h3>Public onchain receipts</h3><p>Verify every recipient amount against the transaction and distribution events.</p><a href={`${m.explorerBase}/address/${m.contractAddress}`} target="_blank" rel="noreferrer">View mainnet contract<ArrowUpRight size={15}/></a></article>
   </div></section>
   <section className="requests-panel reveal"><div className="section-heading"><h2>My mainnet requests</h2><Link to="/create">New request<Plus size={15}/></Link></div><MyRequests revision={wallet.generation}/></section>
   <div className="preview-note"><span className="preview-note-dot"/>Arc Mainnet · Gas capped at 0.02 USDC per transaction · Creation, approval and payment are confirmed separately. No automatic next transaction.</div>
 </div>;
}
