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
import { PROJECT_WALLET } from "@/lib/mainnetBudget";
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
            收款人 {i + 1} · {(BigInt(shares[i]) / 100n).toString()}.
            {(BigInt(shares[i]) % 100n).toString().padStart(2, "0")}%
          </span>
          <strong>{formatUsdc6(amounts[i])} USDC</strong>
          <code>{a || "地址尚未填完"}</code>
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
  const [connectError, setConnectError] = useState("");
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
      ? "请输入有效的非零地址，不能是本合约地址。"
      : rows.some(
            (v, j) =>
              i !== j && v.address.toLowerCase() === r.address.toLowerCase(),
          )
        ? "收款地址不能重复。"
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
      <h1>创建你的分账链接</h1>
      <p>先定金额，再定份额。每个人应收多少，清清楚楚。</p>
      {m.environment === "arc-mainnet" && wallet.account?.toLowerCase() === PROJECT_WALLET && <p className="notice">项目钱包本轮仅开放一次总额 0.010001 USDC 的创建、准确授权和付款，按 nonce 1 / 2 / 3 依次确认；入账不会重置次数或预算。<button onClick={() => { edit(); setTitle("SplitLink mainnet demo"); setAmount("0.010001"); setRows([{id:crypto.randomUUID(),address:wallet.account!,share:"50"},{id:crypto.randomUUID(),address:"0xF76635258fF551Dc2224ee7434B5b88dF3c93497",share:"50"}]); }}>填入本轮分账信息</button></p>}
      <p>
        {m.chainName} ·{" "}
        {m.environment === "local-mock"
          ? "LOCAL MOCK — isolated test assets"
          : `${m.chainName} · ${m.environment === "arc-mainnet" ? "真实 USDC" : "测试 USDC"} · 每笔操作均由本人钱包确认`}
      </p>
      <div className="grid">
        <section className="panel">
          <h2>分账信息</h2>
          <label>
            公开标题
            <input
              aria-label="公开标题"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                edit();
              }}
            />
          </label>
          {title.length > 0 && !titleOk && (
            <p className="error">标题需为 1–120 个 UTF-8 字节。</p>
          )}
          <p>标题永久公开，请勿填写私人账单资料。</p>
          <label>
            请求总额 · USDC
            <input
              aria-label="请求总额"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                edit();
              }}
            />
          </label>
          {amount.length > 0 && !money.ok && <p className="error">{money.error}</p>}
          <h3>收款人 · 2–5 位</h3>
          {rows.map((r, i) => (
            <div className="member" key={r.id}>
              <label>
                收款人 {i + 1} 地址
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
              {r.address.length > 0 && errors[i] && <p className="error">{errors[i]}</p>}
              <div className="share-input">
                <label>
                  份额 %
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
                  aria-label={`移除 recipient ${i + 1}`}
                  disabled={rows.length <= 2}
                  onClick={() => {
                    setRows((old) => old.filter((v) => v.id !== r.id));
                    edit();
                  }}
                >
                  移除
                </button>
              </div>
              {r.share.length > 0 && !parsed[i].ok && <p className="error">{parsed[i].error}</p>}
            </div>
          ))}
          <button
            disabled={rows.length >= 5}
            onClick={() => {
              setRows((old) => [...old, blank()]);
              edit();
            }}
          >
            添加收款人
          </button>
          <p>
            份额合计： {(BigInt(sum) / 100n).toString()}.
            {(BigInt(sum) % 100n).toString().padStart(2, "0")}%
            {incomplete ? "（尚未填完）" : ""}
          </p>
          {rows.some(r => r.share.length > 0) && (sum !== 10000 || incomplete) ? (
            <p className="error">已填写份额的合计必须为 100%。</p>
          ) : null}
          {allocations?.some((a) => a === 0n) && (
            <p className="error">每位收款人的金额必须大于零。</p>
          )}
          <div className="notice">
            创建后条款不可修改，请核对完整地址和金额。最小单位余数归入最后一位收款人。
          </div>
          {!wallet.account && <button onClick={() => void wallet.connect().catch(e => setConnectError(e.message))}>连接钱包以创建</button>}
          {wallet.account && wallet.chainId !== m.chainId && <button onClick={() => void wallet.switchNetwork(m).catch(e => setConnectError(e.message))}>切换至 {m.chainName}</button>}
          {connectError && <p role="alert" className="notice">{connectError}</p>}
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
            {op.busy ? "正在检查链上状态与费用…" : "预览并复核创建请求"}
          </button>
          <Review op={op} />
          {wallet.account && wallet.chainId !== m.chainId && (
            <p className="error">请切换至 {m.chainName} 后继续。</p>
          )}
        </section>
        <aside className="panel preview">
          <p className="split-label">分账预览 · 草稿</p>
          <h2>{title || "你的下一次团队协作"}</h2>
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
            <p>填写总额和份额，即可预览分配金额。</p>
          )}
          <p>平台手续费为 0，网络费在签名前单独复核。</p>
        </aside>
      </div>
      <MyRequests revision={revision} />
    </>
  );
}
