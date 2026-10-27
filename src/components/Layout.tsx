import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { Layers } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getManifest } from "@/lib/manifest";
import { TransactionActivity } from "./TransactionActivity";
export function Layout({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [error, setError] = useState("");
  const m = getManifest();
  return (
    <>
      <header className="site-header">
        <Link className="brand" to="/create">
          <Layers size={23} /> SplitLink
        </Link>
        <span>
          {m.chainName}
          {m.environment === "local-mock" ? " · LOCAL MOCK" : ""}
        </span>
        <button
          onClick={() =>
            void wallet.connect().catch((e) => setError(e.message))
          }
        >
          {wallet.account
            ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}`
            : "Connect wallet"}
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      <main>
        {children}
        <TransactionActivity />
      </main>
      <footer>
        Studio source with external post-export completion. Canonical runtime
        and public release gates remain open.
        <br />
        Local fixtures are mock only. No platform fee, escrow or backend.
      </footer>
    </>
  );
}
