import { useState } from "react";
import { encodeFunctionData, isAddress, zeroAddress, type Address } from "viem";
import {
  SPLITLINK_ABI,
  parsePercentage,
  parseDraftAmount,
  computeAllocations,
  formatUsdc6,
} from "@/lib/splitlink";
import { getManifest } from "@/lib/manifest";
import { useWallet } from "@/hooks/useWallet";
import { useOperation } from "@/hooks/useOperation";
import { Review } from "./Review";
import { MyRequests } from "./MyRequests";
import { hasUnresolved, useJournal } from "./TransactionActivity";
const blank = () => ({ id: crypto.randomUUID(), address: "", share: "" });
export function Allocation({
  recipients,
  shares,
  amounts,
}: {
  recipients: readonly string[];
  shares: readonly number[];
  amounts: readonly bigint[];
}) {
  return (
    <div>
      {recipients.map((a, i) => (
        <div className="allocation" key={i}>
          <span>
            Recipient {i + 1} · {(BigInt(shares[i]) / 100n).toString()}.
            {(BigInt(shares[i]) % 100n).toString().padStart(2, "0")}%
          </span>
          <strong>{formatUsdc6(amounts[i])} USDC</strong>
          <code>{a || "Address incomplete"}</code>
        </div>
      ))}
    </div>
  );
}
export function CreatePage() {
  const m = getManifest(),
    wallet = useWallet();
  useJournal();
  const [title, setTitle] = useState(""),
    [amount, setAmount] = useState(""),
    [rows, setRows] = useState(() => [blank(), blank()]);
  const [revision, setRevision] = useState(0);
  const op = useOperation(m, () => setRevision((n) => n + 1));
  const parsed = rows.map((r) => parsePercentage(r.share)),
    sum = parsed.reduce((a, b) => a + (b.ok ? b.bps : 0), 0),
    incomplete = parsed.some((p) => !p.ok),
    money = parseDraftAmount(amount);
  const allocations =
    money.ok && !incomplete && sum === 10000
      ? computeAllocations(
          money.raw,
          parsed.map((p) => (p.ok ? p.bps : 0)),
        )
      : null;
  const titleOk =
    new TextEncoder().encode(title).length > 0 &&
    new TextEncoder().encode(title).length <= 120;
  const errors = rows.map((r, i) =>
    !isAddress(r.address) ||
    r.address.toLowerCase() === zeroAddress ||
    r.address.toLowerCase() === m.contractAddress.toLowerCase()
      ? "Enter a valid nonzero address, excluding SplitLink."
      : rows.some(
            (v, j) =>
              i !== j && v.address.toLowerCase() === r.address.toLowerCase(),
          )
        ? "Recipients must be unique."
        : "",
  );
  const valid =
    titleOk &&
    money.ok &&
    allocations?.every((a) => a > 0n) &&
    errors.every((e) => !e);
  const edit = () => op.invalidate();
  return (
    <>
      <h1>One payment. The whole team.</h1>
      <p>Create a fixed, public USDC link with immutable shares.</p>
      <p>
        {m.chainName} ·{" "}
        {m.environment === "local-mock"
          ? "LOCAL MOCK — isolated test assets"
          : "Canonical deployment unconfigured / release gates open"}
      </p>
      <div className="grid">
        <section className="panel">
          <h2>Create a payment link</h2>
          <label>
            Public title
            <input
              aria-label="Public title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                edit();
              }}
            />
          </label>
          {!titleOk && (
            <p className="error">Title must contain 1–120 UTF-8 bytes.</p>
          )}
          <p>Public forever. Do not include private billing details.</p>
          <label>
            Request amount · USDC
            <input
              aria-label="Request amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                edit();
              }}
            />
          </label>
          {!money.ok && <p className="error">{money.error}</p>}
          <h3>Team members · 2–5</h3>
          {rows.map((r, i) => (
            <div className="member" key={r.id}>
              <label>
                Recipient {i + 1} address
                <input
                  aria-label={`Recipient ${i + 1} address`}
                  value={r.address}
                  onChange={(e) => {
                    setRows((old) =>
                      old.map((v) =>
                        v.id === r.id ? { ...v, address: e.target.value } : v,
                      ),
                    );
                    edit();
                  }}
                />
              </label>
              {errors[i] && <p className="error">{errors[i]}</p>}
              <div className="share-input">
                <label>
                  Share %
                  <input
                    aria-label={`Recipient ${i + 1} percentage`}
                    inputMode="decimal"
                    value={r.share}
                    onChange={(e) => {
                      setRows((old) =>
                        old.map((v) =>
                          v.id === r.id ? { ...v, share: e.target.value } : v,
                        ),
                      );
                      edit();
                    }}
                  />
                </label>
                <button
                  aria-label={`Remove recipient ${i + 1}`}
                  disabled={rows.length <= 2}
                  onClick={() => {
                    setRows((old) => old.filter((v) => v.id !== r.id));
                    edit();
                  }}
                >
                  Remove
                </button>
              </div>
              {!parsed[i].ok && <p className="error">{parsed[i].error}</p>}
            </div>
          ))}
          <button
            disabled={rows.length >= 5}
            onClick={() => {
              setRows((old) => [...old, blank()]);
              edit();
            }}
          >
            Add member
          </button>
          <p>
            Total: {(BigInt(sum) / 100n).toString()}.
            {(BigInt(sum) % 100n).toString().padStart(2, "0")}%
            {incomplete ? " from valid entries — incomplete" : ""}
          </p>
          {sum !== 10000 || incomplete ? (
            <p className="error">Shares must add up to 100%.</p>
          ) : null}
          {allocations?.some((a) => a === 0n) && (
            <p className="error">Every allocation must be nonzero.</p>
          )}
          <div className="notice">
            Created terms cannot be edited. Review full addresses and exact
            amounts. The last recipient receives any rounding remainder.
          </div>
          <button
            disabled={
              !valid ||
              !wallet.account ||
              wallet.chainId !== m.chainId ||
              op.busy ||
              hasUnresolved(m, null)
            }
            onClick={() =>
              void op.prepare({
                operation: "create",
                requestId: null,
                target: m.contractAddress as Address,
                data: encodeFunctionData({
                  abi: SPLITLINK_ABI,
                  functionName: "createRequest",
                  args: [
                    title,
                    money.ok ? money.raw : 0n,
                    rows.map((r) => r.address as Address),
                    parsed.map((p) => (p.ok ? p.bps : 0)),
                  ],
                }),
                principal6: 0n,
              })
            }
          >
            Review immutable request
          </button>
          {wallet.account && wallet.chainId !== m.chainId && (
            <p className="error">Switch to {m.chainName} to continue.</p>
          )}
        </section>
        <aside className="panel preview">
          <p className="split-label">PAYMENT PREVIEW · DRAFT</p>
          <h2>{title || "Your team’s next project"}</h2>
          {allocations && money.ok ? (
            <>
              <div className="amount">{formatUsdc6(money.raw)} USDC</div>
              <Allocation
                recipients={rows.map((r) => r.address)}
                shares={parsed.map((p) => (p.ok ? p.bps : 0))}
                amounts={allocations}
              />
            </>
          ) : (
            <p>Complete the amount and shares to preview allocations.</p>
          )}
          <p>Platform fee: 0 USDC. Network fees reviewed before signing.</p>
        </aside>
      </div>
      <Review op={op} />
      <MyRequests revision={revision} />
    </>
  );
}
