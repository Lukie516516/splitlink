import { useEffect, useRef, useState } from "react";
import {
  encodeFunctionData,
  erc20Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { splitAbi } from "./abi";
import {
  recipientErrors,
  preview,
  validateTerms,
  format6,
  percent,
  fee6,
  SCALE,
  type DraftRow,
  type FeeQuote,
} from "./core/math";
import {
  arcNetworks,
  client,
  link,
  manifests,
  resolveRoute,
  type Manifest,
} from "./core/manifest";
import {
  approvalCall,
  eq,
  errorText,
  preflight,
  readRequest,
  reconcile,
  requestCall,
  send,
  settlement,
  statusName,
  walletContext,
  type RequestData,
  type CallIntent,
} from "./core/chain";
import { Journal, type Record as TxRecord } from "./core/journal";
import { boundedMap, scanLogs } from "./core/history";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const row = (): DraftRow => ({
  rowId: crypto.randomUUID(),
  addressInput: "",
  percentageInput: "",
});
function createJournal() {
  try {
    return new Journal(localStorage);
  } catch {
    return new Journal({
      getItem() {
        throw Error("Storage unavailable");
      },
      setItem() {
        throw Error("Storage unavailable");
      },
    });
  }
}
export default function App() {
  const [journal] = useState(createJournal);
  const [, redraw] = useState(0);
  const update = () => redraw((x) => x + 1);
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [message, setMessage] = useState("");
  const [network, setNetwork] = useState(manifests[0]?.chainId ?? 5042002);
  const route = resolveRoute(location.pathname);
  const m =
    "manifest" in route
      ? route.manifest
      : manifests.find((m) => m.chainId === network);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    call: CallIntent;
    quote: FeeQuote;
    account: Address;
    manifest: Manifest;
  } | null>(null);
  const [warningAck, setWarningAck] = useState(false);
  const [resetAck, setResetAck] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [rows, setRows] = useState<DraftRow[]>(() => [row(), row()]);
  const p = preview(amount, rows);
  const addressErrors = recipientErrors(
    rows,
    m?.splitLinkAddress as Address | undefined,
  );
  const titleBytes = new TextEncoder().encode(title).length;
  const titleError =
    titleBytes < 1 || titleBytes > 120
      ? "Title must contain 1–120 UTF-8 bytes."
      : null;
  const [request, setRequest] = useState<Awaited<
    ReturnType<typeof readRequest>
  > | null>(null);
  const [requestError, setRequestError] = useState("");
  const [evidence, setEvidence] = useState<Awaited<
    ReturnType<typeof settlement>
  > | null>(null);
  const [evidenceError, setEvidenceError] = useState("");
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [balances, setBalances] = useState<{ b6: bigint; b18: bigint } | null>(
    null,
  );
  const historyCursor = useRef<{
    head: bigint;
    next: bigint;
    logs: Map<
      string,
      { id: bigint; block: bigint; index: number; log: number }
    >;
  } | null>(null);
  const generation = useRef(0);
  const historyGen = useRef(0);
  const historyFlight = useRef<{ context: string; work: Promise<void> } | null>(
    null,
  );
  const [history, setHistory] = useState<
    {
      id: bigint;
      r?: RequestData;
      error?: string;
      block: bigint;
      index: number;
      log: number;
    }[]
  >([]);
  const [historyState, setHistoryState] = useState("disconnected");
  const [coverage, setCoverage] = useState("");
  const id = "id" in route ? route.id : undefined;
  const contextKey = `${account}/${chainId}/${m?.chainId}/${m?.splitLinkAddress}/${id}`;
  const currentContext = useRef(contextKey);
  currentContext.current = contextKey;
  async function refreshWallet() {
    if (!window.ethereum) return;
    try {
      const c = await walletContext(window.ethereum);
      setAccount(c.account);
      setChainId(c.chainId);
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  useEffect(() => {
    void refreshWallet();
    const handler = () => {
      setReview(null);
      setAllowance(null);
      setBalances(null);
      void refreshWallet();
    };
    window.ethereum?.on?.("accountsChanged", handler);
    window.ethereum?.on?.("chainChanged", handler);
    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handler);
      window.ethereum?.removeListener?.("chainChanged", handler);
    };
  }, []);
  useEffect(() => {
    setReview(null);
    setWarningAck(false);
    setResetAck(false);
  }, [contextKey]);
  async function recover() {
    for (const r of journal.records) {
      const original = manifests.find(
        (m) =>
          m.chainId === r.chainId && eq(m.splitLinkAddress, r.contractAddress),
      );
      if (
        original &&
        (![
          "confirmed",
          "reverted",
          "rejected",
          "cancelledByReplacement",
        ].includes(r.txState) ||
          ["unavailable", "pending", "notChecked"].includes(
            r.businessVerification,
          ))
      )
        await reconcile(journal, r, original);
    }
    update();
  }
  async function refreshRequest() {
    if (contextKey !== currentContext.current) return;
    if (!m || id === undefined) return;
    const g = ++generation.current;
    try {
      const r = await readRequest(m, id);
      if (g !== generation.current) return;
      setRequest(r);
      setRequestError("");
      if (r.data.status === 2) {
        try {
          const e = await settlement(m, id, r.data);
          if (g !== generation.current) return;
          setEvidence(e);
          setEvidenceError("");
        } catch {
          if (g === generation.current) {
            setEvidence(null);
            setEvidenceError(
              "Paid — settlement transaction details temporarily unavailable.",
            );
          }
        }
      } else {
        setEvidence(null);
        setEvidenceError("");
      }
    } catch (e) {
      if (g !== generation.current) return;
      setRequest(null);
      setRequestError(
        /RequestNotFound/.test(errorText(e))
          ? "Request not found."
          : `RPC error: ${errorText(e)}`,
      );
    }
  }
  async function refreshFunds() {
    const key = contextKey;
    if (key !== currentContext.current) return;
    if (!m || !account) {
      setAllowance(null);
      setBalances(null);
      return;
    }
    try {
      const c = client(m),
        block = await c.getBlockNumber({ cacheTime: 0 });
      const [a, b6, b18] = await Promise.all([
        c.readContract({
          address: m.usdcAddress as Address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, m.splitLinkAddress as Address],
          blockNumber: block,
        }),
        c.readContract({
          address: m.usdcAddress as Address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
          blockNumber: block,
        }),
        c.getBalance({ address: account, blockNumber: block }),
      ]);
      if (key !== currentContext.current) return;
      setAllowance(a);
      setBalances({ b6, b18 });
    } catch {
      if (key === currentContext.current) {
        setAllowance(null);
        setBalances(null);
      }
    }
  }
  useEffect(() => {
    setRequest(null);
    setEvidence(null);
    setRequestError("");
    setEvidenceError("");
    void refreshRequest();
    void refreshFunds();
    return () => {
      generation.current++;
    };
  }, [contextKey]);
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (document.visibilityState === "hidden" || running) return;
      running = true;
      try {
        await recover();
        await refreshRequest();
        await refreshFunds();
      } finally {
        running = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 5000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [contextKey]);
  async function scanHistory() {
    if (contextKey !== currentContext.current) return;
    if (historyFlight.current?.context === contextKey)
      return historyFlight.current.work;
    const flight = { context: contextKey, work: Promise.resolve() };
    historyFlight.current = flight;
    flight.work = runHistoryScan().finally(() => {
      if (historyFlight.current === flight) historyFlight.current = null;
    });
    return flight.work;
  }
  async function runHistoryScan() {
    const gen = ++historyGen.current;
    if (!m || !account) {
      setHistory([]);
      setHistoryState(account ? "unsupportedNetwork" : "disconnected");
      return;
    }
    setHistoryState("loading");
    setHistory((old) =>
      old.map((h) => ({ ...h, r: undefined, error: "Refreshing status…" })),
    );
    const c = client(m),
      creator = account;
    try {
      const head = await c.getBlockNumber({ cacheTime: 0 });
      let cursor = historyCursor.current;
      if (!cursor) {
        cursor = {
          head: BigInt(m.deploymentBlock) - 1n,
          next: BigInt(m.deploymentBlock) - 1n,
          logs: new Map(),
        };
        historyCursor.current = cursor;
      }
      const previousHead = cursor.head;
      let complete = true;
      // Fetch only the new committed suffix, then any older gap. Successful pages remain in memory.
      const ranges = [];
      if (head > previousHead)
        ranges.push({
          from:
            previousHead + 1n > BigInt(m.deploymentBlock)
              ? previousHead + 1n
              : BigInt(m.deploymentBlock),
          to: head,
          kind: "new",
        });
      if (cursor.next >= BigInt(m.deploymentBlock))
        ranges.push({
          from: BigInt(m.deploymentBlock),
          to: cursor.next,
          kind: "gap",
        });
      for (const range of ranges) {
        const scan = await scanLogs({
          from: range.from,
          to: range.to,
          fetch: (range) =>
            c.getContractEvents({
              address: m.splitLinkAddress as Address,
              abi: splitAbi,
              eventName: "RequestCreated",
              args: { creator },
              fromBlock: range.from,
              toBlock: range.to,
            }),
          key: (l) => `${l.transactionHash}/${l.logIndex}`,
          progress: (s) => {
            if (gen !== historyGen.current) return;
            setCoverage(`${s.covered.length} ranges read · snapshot ${head}`);
          },
        });
        if (gen !== historyGen.current) return;
        for (const event of scan.items) {
          cursor.logs.set(`${event.transactionHash}/${event.logIndex}`, {
            id: event.args.requestId!,
            block: event.blockNumber,
            index: event.transactionIndex,
            log: event.logIndex,
          });
        }
        if (range.kind === "new") {
          cursor.head = head;
          if (!scan.complete) {
            cursor.next =
              scan.gap!.to > cursor.next ? scan.gap!.to : cursor.next;
          }
        } else
          cursor.next = scan.complete
            ? BigInt(m.deploymentBlock) - 1n
            : scan.gap!.to;
        if (!scan.complete) {
          complete = false;
          setCoverage(`History read failed: ${scan.error}`);
          break;
        }
      }
      if (cursor.next >= BigInt(m.deploymentBlock)) complete = false;
      const sorted = [
        ...new Map([...cursor.logs.values()].map((v) => [v.id, v])).values(),
      ].sort((a, b) =>
        a.block > b.block
          ? -1
          : a.block < b.block
            ? 1
            : b.index - a.index || b.log - a.log,
      );
      const results = await boundedMap(sorted, async (item) => {
        try {
          const read = await readRequest(m, item.id, head);
          if (!eq(read.data.creator, creator)) throw Error("Creator mismatch.");
          return { ...item, r: read.data, error: undefined };
        } catch (e) {
          return { ...item, r: undefined, error: errorText(e) };
        }
      });
      if (gen !== historyGen.current) return;
      const values = results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      setHistory(values);
      setHistoryState(
        complete && values.every((v) => !v.error)
          ? "complete"
          : values.length
            ? "partial"
            : "error",
      );
    } catch (e) {
      if (gen === historyGen.current) {
        setHistoryState("error");
        setCoverage(errorText(e));
      }
    }
  }
  useEffect(() => {
    historyGen.current++;
    historyCursor.current = null;
    setHistory([]);
    setCoverage("");
    void scanHistory();
    return () => {
      historyGen.current++;
    };
  }, [contextKey]);
  useEffect(() => {
    let working = false;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden" || working || !m || !account)
        return;
      working = true;
      void scanHistory().finally(() => {
        working = false;
      });
    }, 15000);
    return () => clearInterval(timer);
  }, [contextKey]);
  function unresolved(requestId: bigint) {
    return journal.records.some(
      (r) =>
        m &&
        r.chainId === m.chainId &&
        eq(r.contractAddress, m.splitLinkAddress) &&
        r.requestId === requestId.toString() &&
        !r.dismissedAtMs &&
        ["prepared", "awaitingSignature", "submitted", "unknown"].includes(
          r.txState,
        ),
    );
  }
  async function prepare(call: CallIntent) {
    if (!m || !account || chainId !== m.chainId) {
      setMessage(`Switch to ${m?.name ?? "a configured network"} to continue.`);
      return;
    }
    setBusy(true);
    setMessage("");
    setReview(null);
    const context = currentContext.current;
    try {
      const q = await preflight(m, account, call);
      if (context !== currentContext.current)
        throw Error("Wallet context changed. Review again.");
      setReview({ call, quote: q, account, manifest: m });
    } catch (e) {
      setMessage(errorText(e));
      await refreshRequest();
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!review || !window.ethereum) return;
    setBusy(true);
    setMessage("");
    const snapshot = review;
    try {
      const r = await send(
        snapshot.manifest,
        snapshot.account,
        snapshot.call,
        snapshot.quote,
        window.ethereum,
        journal,
        update,
      );
      if (
        r.operationType === "create" &&
        r.businessVerification === "verified" &&
        r.requestId
      )
        setCreated(link(snapshot.manifest, BigInt(r.requestId)));
      else if (r.operationType === "approve" && r.txState === "confirmed")
        setMessage(
          "USDC approval confirmed. Checking whether payment can proceed.",
        );
      else if (
        r.operationType === "cancel" &&
        r.txState === "confirmed" &&
        r.businessVerification !== "verified"
      )
        setMessage(
          "Cancellation transaction confirmed. Request status could not be refreshed.",
        );
      else if (r.txState === "rejected")
        setMessage(
          `${r.operationType === "cancel" ? "Cancellation was not submitted." : "You declined the signature."}`,
        );
      else if (r.txState === "unknown")
        setMessage(
          "Transaction status is unavailable. It may still complete. Check your wallet before retrying.",
        );
      else if (r.txState === "reverted")
        setMessage("Transaction failed. Network fees may have been charged.");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setReview(null);
      setBusy(false);
      await refreshRequest();
      await refreshFunds();
      await scanHistory();
    }
  }
  function creation() {
    try {
      validateTerms(title, rows, m?.splitLinkAddress as Address);
      if (p.error || !p.total || !p.allocations) throw Error(p.error);
      if (!m) throw Error("Deployment not configured.");
      void prepare({
        operationType: "create",
        requestId: null,
        to: m.splitLinkAddress as Address,
        data: encodeFunctionData({
          abi: splitAbi,
          functionName: "createRequest",
          args: [
            title,
            p.total,
            rows.map((r) => r.addressInput as Address),
            p.parsed.map((v) => Number(v.bps!)),
          ],
        }),
        intent: {
          title,
          totalAmount: p.total.toString(),
          recipients: rows.map((r) => r.addressInput),
          sharesBps: p.parsed.map((v) => v.bps!.toString()),
        },
        principal: 0n,
      });
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  async function cancel(requestId: bigint, r: RequestData) {
    if (!m) return;
    if (
      !confirm(
        `Cancel this payment request? It cannot be paid after cancellation. Network fees apply. Existing USDC approvals are not revoked.\n\n${r.title}\n${format6(r.totalAmount)} USDC\nRequest ${requestId}\n${m.name}\n${m.splitLinkAddress}`,
      )
    )
      return;
    await prepare(requestCall(m, "cancel", requestId));
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Payment link copied.");
    } catch {
      setMessage(`Copy failed. Select and copy this link: ${url}`);
    }
  }
  const r = request?.data;
  const self =
    r && account
      ? r.recipients.reduce(
          (n, a, i) => n + (eq(a, account) ? request!.amounts[i] : 0n),
          0n,
        )
      : 0n;
  const paidAttempt = evidence
    ? journal.records.find(
        (a) =>
          a.operationType === "pay" &&
          a.effectiveTxHash === evidence.hash &&
          a.businessVerification === "verified",
      )
    : null;
  let draftValid = false;
  try {
    validateTerms(title, rows, m?.splitLinkAddress as Address);
    draftValid = !p.error && !!p.allocations;
  } catch {
    /* inline validation on review */
  }
  const wrongNetwork = !!account && chainId !== m?.chainId;
  const unresolvedCreate = journal.records.some(
    (r) =>
      r.operationType === "create" &&
      r.chainId === m?.chainId &&
      !r.dismissedAtMs &&
      ["prepared", "awaitingSignature", "submitted", "unknown"].includes(
        r.txState,
      ),
  );
  const publicBody =
    r && m && id !== undefined ? (
      <>
        <div className="status">
          {statusName(r.status)} · Request #{id.toString()}
        </div>
        <h1>{r.title}</h1>
        <p>One payment. Directly to every recipient.</p>
        <div className="amount">
          {format6(r.totalAmount)} <span>USDC</span>
        </div>
        <Allocation
          recipients={r.recipients}
          shares={r.sharesBps}
          amounts={request!.amounts}
        />
        <p className="fine">
          Immutable ordered terms. The final recipient receives the rounding
          remainder. Platform fee: 0 USDC.
        </p>
        <details>
          <summary>On-chain terms</summary>
          <p className="address">
            Creator: {r.creator}
            <br />
            Contract: {m.splitLinkAddress}
            <br />
            Created: {new Date(Number(r.createdAt) * 1000).toISOString()}
            <br />
            Network: {m.name}
          </p>
        </details>
        {r.status === 2 ? (
          <>
            <div className="notice success">
              {!account
                ? `Paid by ${r.payer}.`
                : !eq(account, r.payer)
                  ? `This request was paid by another wallet: ${r.payer}.`
                  : paidAttempt && eq(paidAttempt.account, account)
                    ? "Your payment is complete."
                    : "This request was paid by your wallet."}
            </div>
            <p className="address">Actual payer: {r.payer}</p>
            {evidence ? (
              <div className="notice">
                <strong>Verified settlement</strong>
                <p className="address">{evidence.hash}</p>
                {m.explorer && (
                  <a
                    href={`${m.explorer}/tx/${evidence.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                )}
                <p>
                  Actual payment fee: {fee6(evidence.fee)}{" "}
                  {m.sharedBalance ? "USDC" : "local test ETH"} (rounded up).
                  Computed from gas used × effective gas price.
                </p>
                <p>Paid at {new Date(Number(r.paidAt) * 1000).toISOString()}</p>
              </div>
            ) : (
              <div className="notice">
                <span>{evidenceError || "Verifying settlement evidence…"}</span>
                <button onClick={() => void refreshRequest()}>
                  Retry evidence
                </button>
              </div>
            )}
            <a className="button" href={link(m, id, "receipt")}>
              Open receipt
            </a>
          </>
        ) : r.status === 3 ? (
          <div className="notice">This payment request was cancelled.</div>
        ) : (
          <>
            {route.page === "receipt" && (
              <div className="notice">
                This request is Open. There is no payment receipt.
              </div>
            )}
            <div className="notice">
              <strong>Before you pay</strong>
              <p>
                Request total: {format6(r.totalAmount)} USDC. Network fees are
                additional. Public links may be paid by any wallet once.
              </p>
              {self > 0n && (
                <>
                  <p>
                    Your wallet is also a recipient. You will receive{" "}
                    {format6(self)} USDC of this payment.
                  </p>
                  <p>
                    Amount allocated to other recipients:{" "}
                    {format6(r.totalAmount - self)} USDC.
                  </p>
                  <p>
                    Gross approval and funding still require{" "}
                    {format6(r.totalAmount)} USDC.
                  </p>
                  {review?.call.operationType === "pay" ? (
                    <p>
                      Net decrease budget:{" "}
                      {m.sharedBalance
                        ? `${fee6((r.totalAmount - self) * SCALE + review.quote.budget)} USDC`
                        : `${format6(r.totalAmount - self)} USDC external principal plus ${fee6(review.quote.budget)} local test ETH fee`}
                      . This is a cap, not actual spend.
                    </p>
                  ) : (
                    <p>
                      Net wallet change cannot be estimated until network fees
                      are available.
                    </p>
                  )}
                </>
              )}
            </div>
            {!account ? (
              <button className="primary" onClick={() => void connect()}>
                Connect wallet to pay
              </button>
            ) : wrongNetwork ? (
              <div className="notice">
                Switch to {m.name} to continue. Public reads remain available.
              </div>
            ) : allowance === null ? (
              <div className="notice">
                Allowance and balances unavailable. Retry before signing.
                <button onClick={() => void refreshFunds()}>Retry funds</button>
              </div>
            ) : allowance < r.totalAmount ? (
              <>
                <div className="notice">
                  Payment fee unavailable until approval is confirmed. You may
                  need more USDC to complete payment.
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={warningAck}
                    onChange={(e) => {
                      setWarningAck(e.target.checked);
                      setReview(null);
                    }}
                  />{" "}
                  I understand future payment fees are unknown and approval does
                  not pay this request.
                </label>
                {m.resetRequired && allowance > 0n && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={resetAck}
                      onChange={(e) => {
                        setResetAck(e.target.checked);
                        setReview(null);
                      }}
                    />{" "}
                    Reset the existing insufficient allowance to zero first.
                    This is a separate transaction.
                  </label>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !warningAck ||
                    (m.resetRequired && allowance > 0n && !resetAck) ||
                    unresolved(id)
                  }
                  onClick={() =>
                    void prepare(
                      approvalCall(
                        m,
                        id,
                        r.totalAmount,
                        m.resetRequired && allowance > 0n,
                      ),
                    )
                  }
                >
                  {m.resetRequired && allowance > 0n
                    ? "Review allowance reset"
                    : "Review USDC approval"}
                </button>
              </>
            ) : (
              <button
                className="primary"
                disabled={busy || unresolved(id)}
                onClick={() =>
                  void prepare(requestCall(m, "pay", id, r.totalAmount))
                }
              >
                Review payment
              </button>
            )}
            {balances && (
              <p className="fine">
                Token balance: {format6(balances.b6)} USDC · Native balance:{" "}
                {balances.b18.toString()} base units (18 decimals).{" "}
                {m.sharedBalance
                  ? "These are views of one balance; they are never added."
                  : "LOCAL MOCK: native test ETH and mock USDC are separate assets."}
              </p>
            )}
            {account && eq(account, r.creator) && (
              <button
                disabled={busy || wrongNetwork || unresolved(id)}
                onClick={() => void cancel(id, r)}
              >
                Cancel request
              </button>
            )}
          </>
        )}
      </>
    ) : null;
  async function connect() {
    if (!window.ethereum) {
      setMessage(
        "No injected wallet found. Install or open a compatible wallet. Public requests do not require a wallet.",
      );
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await refreshWallet();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  return (
    <>
      <header>
        <a className="brand" href="/create">
          <span className="mark">↗</span> SplitLink
        </a>
        <span className="network">
          {m?.name ?? arcNetworks.find((n) => n.chainId === network)?.name}{" "}
          {m?.environment === "local-mock"
            ? "· LOCAL MOCK"
            : "· not configured"}
        </span>
        <button onClick={() => void connect()}>
          {account ? short(account) : "Connect wallet"}
        </button>
      </header>
      <main>
        {"error" in route ? (
          <section className="panel">
            <h1>{route.error}</h1>
            <a href="/create">Create a request</a>
          </section>
        ) : route.page === "create" ? (
          <>
            <div className="intro">
              <div className="eyebrow">TEAM PAYMENTS, WITHOUT THE HANDOFF</div>
              <h1>
                One payment.
                <br />
                The whole team.
              </h1>
              <p>Set the shares. Send a link. Everyone gets paid directly.</p>
            </div>
            <div className="layout">
              <section className="panel">
                <h2>Create a payment link</h2>
                <label>
                  Network
                  <select
                    value={network}
                    onChange={(e) => {
                      setNetwork(Number(e.target.value));
                      setReview(null);
                    }}
                  >
                    {[...manifests, ...arcNetworks].map((n) => (
                      <option key={n.chainId} value={n.chainId}>
                        {n.name}
                        {"environment" in n
                          ? " · LOCAL MOCK"
                          : " · not configured"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Public title
                  <input
                    aria-label="Public title"
                    aria-invalid={!!titleError}
                    value={title}
                    placeholder="e.g. Website design and development"
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setReview(null);
                    }}
                  />
                </label>
                {titleError && <p className="error inline">{titleError}</p>}
                <p className="fine">
                  1–120 UTF-8 bytes. Public forever. Do not include private
                  billing details.
                </p>
                <label>
                  Request amount · USDC
                  <input
                    aria-label="Request amount"
                    inputMode="decimal"
                    value={amount}
                    placeholder="0.000000"
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setReview(null);
                    }}
                  />
                </label>
                <div className="section-heading">
                  <h3>Team members</h3>
                  <span>2–5 recipients</span>
                </div>
                {rows.map((r, i) => (
                  <div className="member" key={r.rowId}>
                    <div className="avatar">{i + 1}</div>
                    <div>
                      <label>
                        Recipient {i + 1}
                        <input
                          aria-label={`Recipient ${i + 1} address`}
                          aria-invalid={!!addressErrors[i]}
                          value={r.addressInput}
                          placeholder="0x… full wallet address"
                          onChange={(e) => {
                            setRows((old) =>
                              old.map((v) =>
                                v.rowId === r.rowId
                                  ? { ...v, addressInput: e.target.value }
                                  : v,
                              ),
                            );
                            setReview(null);
                          }}
                        />
                      </label>
                      {addressErrors[i] && (
                        <p className="error inline">{addressErrors[i]}</p>
                      )}
                      <div className="share-row">
                        <label>
                          Share %
                          <input
                            aria-label={`Recipient ${i + 1} percentage`}
                            inputMode="decimal"
                            value={r.percentageInput}
                            placeholder="33.33"
                            onChange={(e) => {
                              setRows((old) =>
                                old.map((v) =>
                                  v.rowId === r.rowId
                                    ? { ...v, percentageInput: e.target.value }
                                    : v,
                                ),
                              );
                              setReview(null);
                            }}
                          />
                        </label>
                        <button
                          aria-label={`Remove recipient ${i + 1}`}
                          disabled={rows.length <= 2}
                          onClick={() => {
                            setRows((old) =>
                              old.filter((v) => v.rowId !== r.rowId),
                            );
                            setReview(null);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                      {p.parsed[i].error && (
                        <p className="error inline">{p.parsed[i].error}</p>
                      )}
                    </div>
                  </div>
                ))}
                <button
                  disabled={rows.length >= 5}
                  onClick={() => {
                    setRows((old) => [...old, row()]);
                    setReview(null);
                  }}
                >
                  ＋ Add member
                </button>
                <p
                  className={
                    p.subtotal === 10000n && !p.incomplete
                      ? "total valid"
                      : "total"
                  }
                >
                  Total: {percent(p.subtotal)}%
                  {p.incomplete ? " from valid entries — incomplete" : ""}
                </p>
                {p.error && <p className="error">{p.error}</p>}
                {!m && (
                  <div className="notice">
                    Deployment not configured. Arc writes are disabled. Local
                    implementation; Studio provenance and competition
                    eligibility are unverified.
                  </div>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !m ||
                    !draftValid ||
                    !account ||
                    wrongNetwork ||
                    unresolvedCreate
                  }
                  onClick={creation}
                >
                  Review immutable request →
                </button>
                {wrongNetwork && (
                  <p className="error">
                    Switch to {m?.name ?? "a configured network"} to continue.
                  </p>
                )}
              </section>
              <aside className="panel preview">
                <div className="eyebrow">PAYMENT LINK PREVIEW · DRAFT</div>
                <h2>{title || "Your team’s next project"}</h2>
                {p.total && p.allocations ? (
                  <>
                    <div className="amount">
                      {format6(p.total)} <span>USDC</span>
                    </div>
                    <Allocation
                      recipients={rows.map((r) => r.addressInput as Address)}
                      shares={p.parsed.map((s) => Number(s.bps ?? 0n))}
                      amounts={p.allocations}
                    />
                  </>
                ) : (
                  <div className="placeholder">
                    Complete the amount and shares to preview allocations.
                  </div>
                )}
                <div className="notice">
                  Terms become immutable on creation. Review full addresses,
                  exact amounts and ordered shares. The last recipient receives
                  any rounding remainder.
                </div>
                <div className="fee-line">
                  <span>Platform fee</span>
                  <strong>0 USDC</strong>
                </div>
                <div className="fee-line">
                  <span>Network fee</span>
                  <span>Reviewed before signing</span>
                </div>
                <p className="fine">
                  No escrow. No coordinator payout. Every transfer succeeds
                  together or the entire payment reverts. Failed transactions
                  may consume gas.
                </p>
              </aside>
            </div>
            {created && (
              <section className="panel success">
                <h2>Payment link created and verified</h2>
                <a className="address" href={created}>
                  {created}
                </a>
                <button onClick={() => void copy(created)}>
                  Copy payment link
                </button>
              </section>
            )}
            <section className="panel history">
              <div className="section-heading">
                <h2>My requests</h2>
                <button
                  disabled={!account || !m}
                  onClick={() => void scanHistory()}
                >
                  Refresh history
                </button>
              </div>
              <p className="fine">
                {account
                  ? `${account} · ${m?.name ?? "unconfigured"}`
                  : "Connect a wallet to discover requests from public creation events."}
              </p>
              <p>
                {historyState === "complete" && !history.length
                  ? "No requests found on this network."
                  : historyState === "partial"
                    ? "Partial results. Some history or request statuses could not be loaded."
                    : historyState === "error"
                      ? "History error. Retry; this is not an empty list."
                      : historyState === "loading"
                        ? "Loading public history…"
                        : historyState === "unsupportedNetwork"
                          ? "Unsupported or unconfigured deployment."
                          : history.length
                            ? "History complete."
                            : ""}
              </p>
              <p className="fine">{coverage}</p>
              {history.map((h) => (
                <article className="history-row" key={h.id.toString()}>
                  <div>
                    <strong>{h.r?.title ?? `Request #${h.id}`}</strong>
                    <p>
                      {h.r
                        ? `${format6(h.r.totalAmount)} USDC · ${statusName(h.r.status)} · ${new Date(Number(h.r.createdAt) * 1000).toISOString()}`
                        : `Status unavailable: ${h.error}`}
                    </p>
                    <small>
                      #{h.id.toString()} · {m?.name} · Created at block{" "}
                      {h.block.toString()}
                      {h.r?.status === 2 ? ` · Payer ${short(h.r.payer)}` : ""}
                    </small>
                  </div>
                  <div className="actions">
                    {m && (
                      <>
                        <a href={link(m, h.id)}>Open request</a>
                        <button onClick={() => void copy(link(m, h.id))}>
                          Copy link
                        </button>
                        {h.r?.status === 2 && (
                          <a href={link(m, h.id, "receipt")}>View receipt</a>
                        )}
                        {h.r?.status === 1 &&
                          account &&
                          eq(h.r.creator, account) && (
                            <button
                              disabled={
                                busy || wrongNetwork || unresolved(h.id)
                              }
                              onClick={() => void cancel(h.id, h.r!)}
                            >
                              Cancel
                            </button>
                          )}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : (
          <section className="panel public">
            {!request && !requestError ? (
              <p>Reading public request…</p>
            ) : requestError ? (
              <>
                <h1>{requestError}</h1>
                <button onClick={() => void refreshRequest()}>Retry</button>
              </>
            ) : (
              publicBody
            )}
          </section>
        )}
        {message && (
          <div role="alert" className="notice error">
            {message}
          </div>
        )}
        {review && (
          <section className="panel review" aria-label="Transaction review">
            <div className="eyebrow">
              FINAL REVIEW · {review.call.operationType.toUpperCase()}
            </div>
            <h2>Review before signing</h2>
            <p>
              Network: {review.manifest.name} · {review.manifest.environment}
            </p>
            <p className="address">
              Account: {review.account}
              <br />
              Target: {review.call.to}
            </p>
            {review.call.operationType === "create" && p.allocations && (
              <Allocation
                recipients={rows.map((r) => r.addressInput as Address)}
                shares={p.parsed.map((s) => Number(s.bps))}
                amounts={p.allocations}
              />
            )}
            <p>
              Estimated current fee: {fee6(review.quote.estimate)} · Maximum fee
              budget: {fee6(review.quote.budget)}{" "}
              {review.manifest.sharedBalance ? "USDC" : "local test ETH"}{" "}
              (rounded upward).
            </p>
            <p>
              Reserve: 0.001{" "}
              {review.manifest.sharedBalance ? "USDC" : "local test ETH"}. Fee
              quote expires after 30 seconds; prerequisites are checked again
              before prompting. The wallet may apply its final fee validation.
            </p>
            {review.call.operationType === "cancel" && (
              <p>
                Cancellation pending. This request may still be paid until
                cancellation completes.
              </p>
            )}
            <details>
              <summary>Reviewed calldata (value = 0)</summary>
              <p className="address">{review.call.data}</p>
            </details>
            <div className="actions">
              <button disabled={busy} onClick={() => setReview(null)}>
                Return without signing
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy
                  ? "Waiting for wallet / chain…"
                  : "Sign reviewed transaction"}
              </button>
            </div>
          </section>
        )}
        <Activity
          journal={journal}
          refresh={() => void recover()}
          dismiss={(r) => {
            if (
              confirm(
                "Check your wallet activity and fresh request status first. Dismiss this unresolved attempt from the local retry guard? This does not cancel, fail or resend the transaction. It may still complete.",
              )
            ) {
              journal.update(r, { dismissedAtMs: Date.now() });
              update();
            }
          }}
        />
        <footer>
          SplitLink · Direct atomic splits · Public on-chain terms
          <br />
          Local implementation. Arc runtime, Studio provenance, public hosting
          and eligibility remain unverified.
        </footer>
      </main>
    </>
  );
}
function Allocation({
  recipients,
  shares,
  amounts,
}: {
  recipients: readonly string[];
  shares: readonly number[];
  amounts: readonly bigint[];
}) {
  return (
    <div className="allocations">
      {recipients.map((a, i) => (
        <div className="allocation" key={i}>
          <span className="avatar">{i + 1}</span>
          <div className="allocation-address">
            <span>Recipient {i + 1}</span>
            <code>{a || "Address incomplete"}</code>
          </div>
          <div className="allocation-value">
            <strong>{format6(amounts[i])}</strong>
            <small>{percent(BigInt(shares[i]))}%</small>
          </div>
        </div>
      ))}
    </div>
  );
}
function Activity({
  journal,
  refresh,
  dismiss,
}: {
  journal: Journal;
  refresh: () => void;
  dismiss: (r: TxRecord) => void;
}) {
  return (
    <>
      {journal.warning && (
        <div role="alert" className="notice error">
          {journal.warning}
        </div>
      )}
      {journal.records.length > 0 && (
        <section className="panel activity">
          <div className="section-heading">
            <h2>Transactions on this device</h2>
            <button onClick={refresh}>Reconcile</button>
          </div>
          <p className="fine">
            Attempts are separate from request status. No automatic resubmission
            or next-step signing. Check wallet history before retrying unknown
            attempts.
          </p>
          {[...journal.records].reverse().map((r: TxRecord) => (
            <article key={r.recordId}>
              <strong>
                {r.operationType} · {r.txState}
              </strong>
              <p>
                Business verification: {r.businessVerification} · Original chain{" "}
                {r.chainId} · {short(r.account)}
              </p>
              {r.effectiveTxHash && (
                <p className="address">Attempt hash: {r.effectiveTxHash}</p>
              )}
              {r.actualFee18 && (
                <p>
                  Actual attempt fee: {fee6(BigInt(r.actualFee18))} native token
                  (rounded up)
                </p>
              )}
              {r.error && <p className="error">{r.error}</p>}
              {r.txState === "unknown" && !r.dismissedAtMs && (
                <button onClick={() => dismiss(r)}>
                  Dismiss after checking wallet activity
                </button>
              )}
              {r.dismissedAtMs && (
                <p>
                  Retry guard dismissed explicitly. Outcome remains {r.txState}.
                </p>
              )}
              {r.txState === "submitted" &&
                Date.now() - r.createdAtMs > 120000 && (
                  <p>
                    Still unresolved. Elapsed time does not establish failure.
                    Check wallet activity.
                  </p>
                )}
              {r.operationType === "create" &&
                r.txState === "confirmed" &&
                r.receiptStatus === "success" &&
                r.effectiveTxHash &&
                r.businessVerification === "verified" &&
                r.requestId && (
                  <a
                    href={`/pay/${r.chainId}/${r.contractAddress}/${r.requestId}`}
                  >
                    Open verified created request #{r.requestId}
                  </a>
                )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
