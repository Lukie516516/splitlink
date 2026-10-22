# SplitLink — Product and Engineering Design

Version: **1.1** · Revised October 22, 2026 (Asia/Shanghai)
Status: Implementation-ready for the core product; Studio access and competition eligibility have separate gates in Section 13. Network configuration is documented, not operationally certified.
Scope of this revision: design documentation only. No UI prototype changes, software implementation, deployment, signatures, or real transactions.
Language: All product UI, validation messages, README, and submission materials must be in English.

## 1. Product objective

SplitLink creates a fixed-amount, single-use USDC payment request for a small team. A customer opens a shareable link, reviews immutable recipients and allocations, and pays once. The contract distributes payment directly to recipients within one atomic transaction. A receipt identifies the actual on-chain payer and successful settlement transaction.

Primary user: a freelancer coordinating payment for 2–5 people. Primary outcome: one customer payment pays the team without a coordinator manually redistributing funds.

Example: “Website design and development”, 1.00 USDC, Alice 70%, Bob 30%. Alice receives 0.70 USDC and Bob receives 0.30 USDC. Network fees are additional. If the payer is also a recipient, the request total is not the payer's net spend.

Success means a reproducible product and verifiable settlement, not a guaranteed microgrant. A public request being paid does not prove that the current browser user paid it.

## 2. Fixed MVP decisions

- One non-upgradeable `SplitLink` contract per supported Arc network; no deployment per request.
- Canonical USDC is fixed at deployment; no arbitrary tokens.
- Exactly 2–5 ordered, unique, nonzero recipients, excluding `address(this)`. Creator and payer may be recipients.
- Fixed amount with up to six decimals; minimum 0.01 USDC, maximum 1,000,000 USDC.
- Users enter percentages with up to two decimals. Contract shares are positive integer basis points totaling 10,000.
- A request can be paid successfully once, by any wallet. Public links do not reserve payment rights for a customer.
- The creator may cancel an open request. Created terms cannot be edited; corrections require cancellation and a new request.
- SplitLink uses the USDC ERC-20 interface to transfer directly from payer to each recipient. Principal is not held by SplitLink during normal operation.
- No platform fee, escrow, expiration, refund system, disputes, subscriptions, partial payments, designated payer, native-value payment, cross-chain logic, batch payments, or AI agent payment features.
- No backend, database, signer service, indexer service, or trusted transaction relay. `/create` includes a lightweight wallet-scoped **My requests** list reconstructed from contract events and reads.
- The deployment manifest allowlists supported networks/contracts. Public reads use a chain-specific read-only RPC and never require a connected wallet.

This document supersedes the earlier UI prototype as behavioral authority. That prototype's two-member limit, sample addresses, percentages, and simulated payment are not implementation requirements. Do not modify that prototype as part of this revision.

## 3. Architecture and trust boundary

Components: English web client; immutable SplitLink contract; canonical Arc USDC ERC-20 interface; user's wallet; read-only RPC and explorer. Suggested stack: TypeScript/React, viem/wagmi, Solidity, established safe ERC-20 and reentrancy utilities. Pin versions. Use Arc-aware tools and real canonical-token integration checks; ordinary local EVM mocks alone do not reproduce Arc semantics.

URLs, labels, browser storage, wallet notifications, and Studio agent output are untrusted hints. Validate chain, target, method, receipt, and events independently. Canonical business state comes from `getRequest`, not local transaction state or a cached event. Do not execute remote agent prose as commands or treat its reported deployment as attested.

Studio-origin implementation must follow Section 13; a normal local agent session is not automatically an Arc Studio session. The product can be implemented independently of eligibility, but it must not be described as competition-compliant before that gate is resolved.

## 4. Network, units, fees, and deployment configuration

### 4.1 Verified reference configuration

Official documentation read on October 22, 2026 lists:

| Setting | Arc Mainnet | Arc Testnet |
|---|---|---|
| Chain ID | 5042 | 5042002 |
| RPC reference | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` |
| ERC-20 decimals / native decimals | 6 / 18 | 6 / 18 |

References: [network configuration](https://docs.arc.io/arc/references/connect-to-arc.md), [canonical contracts](https://docs.arc.io/arc/references/contract-addresses.md), [EVM differences](https://docs.arc.io/arc/references/evm-differences.md), [gas and fees](https://docs.arc.io/arc/references/gas-and-fees.md), and [transaction lifecycle](https://docs.arc.io/integrate/wallets/transaction-lifecycle.md). Published URLs do not establish browser CORS access, account permissions, uptime, or availability of historical logs. Verify those before integration/deployment.

Arc exposes one USDC balance through two interfaces. Never add native and ERC-20 balances. The app uses six-decimal integers for principal and allocations, and 18-decimal integers for native balance, gas fees, and net-change accounting. Every SplitLink write is nonpayable with `value = 0`.

Some official prose/example snippets are inconsistent: the gas page's native-send example uses six-decimal parsing despite its 18-decimal native model; the generic documentation-index preamble mentions blocklist failures without receipts, while the dedicated lifecycle page describes final failed receipts. This design follows the dedicated unit/lifecycle definitions: native quantities use 18 decimals, successful receipts are verified explicitly, failed receipts mean reverted, and a missing receipt remains unresolved rather than proof of failure. Record observed integration results; never copy inconsistent snippets unexamined.

### 4.2 Configuration and lifecycle

All quantities below are integers unless stated otherwise. These are application policies, not promises from Arc.

| Variable | Type | Purpose / source | Update or invalidation |
|---|---|---|---|
| `chainId` | positive integer | Official network ID | Immutable per manifest entry; check RPC chain ID at startup |
| `rpcUrls` | URL[] | Approved browser-readable providers | Release config; fail over only within same verified chain |
| `explorerBaseUrl` | HTTPS URL | Official explorer links | Manifest release |
| `usdcAddress` | address | Canonical six-decimal USDC | Verify official source, bytecode/interface and `decimals()==6` before enabling writes |
| `splitLinkAddress` | address | Deployed app contract | Manifest release; verify bytecode, ABI and immutable `USDC` |
| `deploymentBlock` | bigint | Deployment receipt block; inclusive log lower bound | Immutable for that deployment; never default to an arbitrary recent block |
| `contractVersion` | string | ABI/protocol identifier, `1.0.0` unless implementation changes ABI | Separate from design version 1.1 |
| `appOrigin` | HTTPS origin | Absolute share-link origin | Hosting config; tested on deployed host |
| `gasLimitMarginBps` | integer, default 12000 | 120% of an actual gas estimate | Configurable; changing invalidates fee quotes |
| `feeCapMarginBps` | integer, default 12000 | Buffer on fresh RPC fee recommendation | Configurable; recompute quotes |
| `minMaxFeePerGas18` | bigint, initial 20000000000 | 20 Gwei floor from official Arc fee reference | Reverify per network release; never use a stale lower floor |
| `quoteTtlMs` | integer, default 30000 | Maximum local quote age | Refresh after expiry and before signature |
| `balanceReserve18` | bigint, default 1000000000000000 | Extra 0.001 USDC cushion beyond fee caps | Configurable; not a guaranteed fee or chain requirement |
| `preApprovalPaymentGasHint` | `{gas:bigint,chainId,bytecodeHash,recipientCount,scenario,testedAt}` or null | Measured canonical-token testnet cost for a comparable deployed build; indicative only | Invalidate on code/token/network/scenario change; absent until measured |
| `logPageBlocks` / `minLogPageBlocks` | bigint, defaults 2000 / 1 | Initial log range and lower retry bound | Provider-specific config; adapt downward on range/response limits |
| `rpcRetryCount` / `readConcurrency` | integers, defaults 3 / 4 | Bounded retries and request-read parallelism | Runtime/config; never allow unbounded automatic retries |
| `rpcRetryDelaysMs` | integer[], default [1000,2000,4000] | Backoff for transient RPC/rate errors | Config; interruptible by account/network context change |
| `pollIntervalMs` / `pendingWarningMs` | integers, defaults 5000 / 120000 | Poll while page is active; warn about unresolved transactions | Foreground timers only; elapsed time never proves failure |

Keep private RPC credentials out of public bundles. If the chosen provider cannot expose safe browser reads without a backend, choose another provider; do not introduce a backend silently.

### 4.3 Integer conversion and funding formulas

Let `S = 10^12`. Principal `P6` converts to native units as `P18 = P6 * S` exactly. Native balance `B18` comes from `eth_getBalance`. ERC-20 `B6` comes from `balanceOf`; it truncates sub-six-decimal native dust. Read both against the same latest block where supported; retry inconsistent/stale reads rather than merging them. ERC-20 sufficiency is `B6 >= P6` under the conservative gross-funding rule, including when payer is a recipient.

For transaction `j`:

- `gasLimit[j] = ceil(estimatedGas[j] * gasLimitMarginBps / 10000)`.
- `maxFeePerGas[j] = max(minMaxFeePerGas18, ceil(rpcRecommendedMaxFeePerGas[j] * feeCapMarginBps / 10000))`; ensure it also covers the current base fee plus chosen priority fee. All prices use native base units per gas, not six-decimal USDC.
- `feeBudget18[j] = gasLimit[j] * maxFeePerGas[j]`.
- A payment-ready wallet must satisfy `B6 >= P6` AND `B18 >= P18 + feeBudget18[payment] + balanceReserve18`.
- Creating/cancelling needs `B18 >= feeBudget18[operation] + balanceReserve18`, with no payment principal requirement.
- For a current reset/approval step, retain principal conservatively: `B18 >= P18 + feeBudget18[currentStep] + balanceReserve18`. If future-step fee estimates exist, display their additional budget; if they do not, explicitly state that more USDC may be needed after approval. Recheck before every step.

Use integer ceiling division, never floating point. Display six-decimal token amounts accurately; display fee upper bounds by rounding upward if converting to six display decimals. A buffered cap is not expected actual spend and cannot guarantee success. Wallet changes to gas settings require recalculation where exposed; otherwise the wallet's final fee/balance validation is authoritative for signing.

### 4.4 Executable estimation and authorization sequence

1. Read request, wallet context, allowance, `B6`, `B18`, and fresh fee data. A failed read is unknown, never zero or insufficient. Stop on non-open request or known principal shortage.
2. If allowance is short, do NOT require a successful `payRequest` estimate: lack of allowance may legitimately make that estimate revert. Display an indicative future payment fee only if `preApprovalPaymentGasHint` matches; label its source as a measured estimate, not an RPC simulation of this unpaid request. Otherwise show “Payment fee unavailable until approval is confirmed.”
3. Simulate and estimate the next real token approval operation for this wallet. Approve exactly `P6`, not unlimited. Canonical integration must establish whether replacing a nonzero insufficient allowance requires reset: if yes, expose `approve(0)` and then `approve(P6)` as separate tracked operations. Estimate each step only when its prerequisites hold. Never assume both can be estimated against the original state.
4. Enable “Approve USDC” when the current reset/approval simulation and estimate succeed, fee data/balances are fresh, and its funding check passes. A missing future payment estimate must not block this button. Require acknowledgment of the explicit future-funding warning when future fees are unavailable; this does not bypass a failed current-step estimate or simulation.
5. After each successful approval receipt, reread allowance, balances and request status. If paid/cancelled, stop the payment flow; approval does not imply payment or auto-revocation. If allowance is still insufficient, report that state instead of enabling Pay.
6. Once allowance is sufficient, estimate AND simulate the actual `payRequest` with current account and exact request ID. Refresh fee data and apply the payment-ready check. If estimate fails due to changed request state, reread and show that state. Other deterministic simulation failures block Pay with their specific reason. Transport failures show an RPC error and Retry.
7. Revalidate chain/account, quote freshness, request status, balances and allowance immediately before signature; invalidate/recompute if changed. Submit only the reviewed call. A successful simulation cannot prevent a later race or fee change. Concurrent unrelated wallet spending is outside this estimate and may also invalidate funding.
8. Creation and cancellation follow the same current-operation simulation, fee estimate, balance check, tracking and reconciliation rules, without token approval.

Error categories: `insufficientPrincipal`, `insufficientFeeBudget`, `estimateUnavailable` (no usable estimate), `rpcUnavailable` (transport/timeout), `simulationReverted` (decoded deterministic contract/token failure), and `staleQuote`. Do not label a reverted estimate as insufficient funds unless data/revert evidence actually establishes that cause. Retry transient errors; do not bypass a known revert with a guessed gas limit.

## 5. Contract variables and data structures

All monetary values are unsigned six-decimal base units; monetary client arithmetic uses `bigint`.

| Variable | Type / source | Purpose and constraints | Update conditions |
|---|---|---|---|
| `USDC` | immutable IERC20 / deployment argument | Canonical payment asset; no setter | Constructor only |
| `BPS_DENOMINATOR` | constant uint256 | 10000 | Never |
| `MIN_AMOUNT` / `MAX_AMOUNT` | constant uint256 | 10000 / 1000000000000 | Never |
| `MAX_RECIPIENTS` | constant uint256 | 5; minimum is 2 | Never |
| `nextRequestId` | uint256 / contract | Starts at 1; unique IDs | Increment on successful creation only |
| `requests` | mapping(uint256 => Request) / contract | Canonical records | Only defined lifecycle transitions |
| `creator` | address / `msg.sender` at creation | Cancelling authority | Immutable per request |
| `title` | string / creation call | 1–120 UTF-8 bytes; public title | Immutable per request |
| `totalAmount` | uint256 / creation call | Exact fixed amount within bounds | Immutable per request |
| `recipients` | address[] / creation call | 2–5 ordered, unique, nonzero, not `address(this)` | Immutable order and values |
| `sharesBps` | uint16[] / creation call | Same length, each positive, total 10000 | Immutable per request |
| `status` | enum / contract | `None=0`, `Open=1`, `Paid=2`, `Cancelled=3` | Create, successful pay, or creator cancel |
| `createdAt` | uint64 / block timestamp | Informational creation time | Set once; not a sorting tie-breaker |
| `payer` | address / payment `msg.sender` | Actual payer; zero before payment | Set once on successful payment |
| `paidAt` | uint64 / payment block timestamp | Settlement time; zero before paid | Set once on successful payment |

On-chain identity is `(chainId, splitLinkAddress, requestId)`. Store no private invoice details, email, legal name, or billing address. Optional recipient labels remain local draft data. Fresh public browsers use canonical wallet addresses. Titles are public forever; escape them as text in the client.

## 6. Percentage editing and allocation algorithm

### 6.1 Exact percentage input

Store each row's raw `percentageInput` string separately from parsed basis points. Trim surrounding whitespace, then accept only ASCII decimal form `digits` or `digits.digits` with 1–2 fractional digits (for example `33`, `33.3`, `33.33`). No signs, commas, exponents, `%`, `.5`, or trailing decimal point in a valid submitted value. Temporary incomplete edits may remain visible but invalid. `33.33` parses by string arithmetic to `3333` bps: `whole * 100 + fraction.padEnd(2,'0')`. Never use `parseFloat` and multiply/round.

- Empty: keep empty; “Enter a percentage.” Never silently convert to zero.
- Malformed: preserve input; “Enter a percentage such as 33.33.”
- More than two fractional digits: preserve input; “Use no more than 2 decimal places.” Do not silently round.
- Zero: invalid; “Each share must be greater than 0%.”
- Over 100%: invalid; “A share cannot exceed 100%.”
- Exactly 100% is syntactically valid but cannot form a valid 2–5-recipient request with all other positive shares.
- Valid rows totaling anything other than 10000 bps: show actual sum and “Shares must add up to 100%.” Block creation.

Add a member with blank address and blank percentage, up to five. Delete down to two. Preserve all other rows' raw inputs and relative order; never rebalance automatically. Show “Total: X%” using exact integer sums for parseable rows. If a row is empty/invalid, show “Total: X% from valid entries — incomplete”; never show a misleading completed 100% indicator. Zero/over-limit rows are excluded from the valid subtotal and flagged. Keep invalid edits editable.

Allocation preview is available only when the amount and all percentage rows are valid, count is 2–5 and total is exactly 100%. Label it as draft when addresses/title remain invalid, and keep creation blocked. If any computed allocation is zero, show the allocations and error and block creation. Invalid percentages/amount hide numeric allocations and show “Complete the amount and shares to preview allocations”; do not leave stale numbers visible. Final creation additionally requires valid title, all address checks, nonzero allocations and successful current-operation preflight.

### 6.2 Immutable allocation

For `i < n-1`, `allocation[i] = floor(totalAmount * sharesBps[i] / 10000)`. Final recipient receives `totalAmount - sum(previous allocations)`. Reject any zero allocation. Show exact amounts, share percentages, full addresses and final-recipient remainder rule before creation/payment. Do not reorder rows after creation.

Example: 1 USDC with `[3333,3333,3334]` gives `[333300,333300,333400]` units. Remainder example: 0.010001 USDC with `[5000,5000]` gives `[5000,5001]` units, displayed as `0.005000` and `0.005001`, not misleading rounded cents. The frontend uses this identical integer algorithm and compares its result with `getAllocations` for canonical requests; a mismatch blocks writes and signals an integration error.

## 7. Contract API and events

All writes are nonpayable and consistently reentrancy-guarded. No owner, proxy, withdrawal, refund or arbitrary `from` parameter.

### `createRequest(string title, uint256 totalAmount, address[] recipients, uint16[] sharesBps) returns (uint256 requestId)`

Any wallet may call. Validate title byte length, amount bounds, recipient count, array lengths, address constraints, unique addresses, positive shares totaling 10000, and nonzero allocations. Store `Open` request with creator/time and advance ID.

Event: `RequestCreated(uint256 indexed requestId, address indexed creator, uint256 totalAmount)`.

Extract ID only from the correct contract's event in the successful creation receipt. Validate creator and stored terms. Never predict IDs from `nextRequestId`. If receipt extraction fails, creation outcome is unresolved at application level; use receipt/event recovery, not automatic recreation.

### `getRequest(uint256 requestId) returns (Request)`

Public read of every canonical field, including arrays. Revert `RequestNotFound` for `None`.

### `getAllocations(uint256 requestId) returns (uint256[])`

Public read using Section 6's exact algorithm for any existing request, regardless of status.

### `payRequest(uint256 requestId)`

Any wallet may pay an `Open` request. Acquire guard; validate status; compute allocations; set `Paid`, payer/time before external calls; safely call `USDC.transferFrom(msg.sender, recipient, allocation)` for every recipient. Emit one `RecipientPaid(uint256 indexed requestId, address indexed recipient, uint256 amount)` per recipient, then `RequestPaid(uint256 indexed requestId, address indexed payer, uint256 totalAmount)`.

Every transfer and state change belongs to one transaction. Any failure reverts all allocations and settlement state/events. Do not catch/ignore failures. Gas already used may still be charged. Payer-as-recipient still performs that recipient's token transfer; do not silently skip it or reduce the approved gross principal.

### `cancelRequest(uint256 requestId)`

Creator only; must be `Open`. Set `Cancelled`; emit `RequestCancelled(uint256 indexed requestId, address indexed creator)`. No USDC transfer; no revocation of allowances. Payment/cancellation race: the first successful execution determines business state and the other must revert.

Define specific errors for missing ID, invalid title/amount/count/address, duplicate recipient, array mismatch, invalid shares, zero allocation, non-open status and unauthorized cancellation. Preserve token/library errors for translation. ABI must expose all events and read structs needed for recovery.

## 8. Client data model and transaction recovery

### 8.1 Client variables

Every chain-derived value includes its context key and read block/time. Clear write readiness on context mismatch; do not overwrite another context's pending records.

| Variable | Type | Purpose / source | Invalidation or update |
|---|---|---|---|
| `draftTitle` / `draftAmount` | string | User input; exact six-decimal amount parser | Every edit; amount rejects signs/exponents and >6 decimals |
| `draftRecipients` | `{rowId:string,addressInput:string,percentageInput:string,localLabel?:string}[]` | Stable local rows preserving raw edits | Explicit edit/add/delete; no auto-allocation |
| `parsedSharesBps` / `shareTotalBps` | bigint[] or invalid / bigint | String-parser output and valid-row subtotal | Recompute on share/count edit |
| `draftAllocations` | bigint[] or null | Section 6 preview | Recompute on valid amount/shares; clear when invalid |
| `canonicalRequest` | `{key:RequestKey,data:Request,readBlock:bigint}` or null | `getRequest` source of truth | Load, foreground poll, relevant write completion, explicit refresh |
| `allocations` | bigint[] or null | Verified canonical allocation | Request/key change; compare with contract result |
| `connectedAccount` / `connectedChainId` | address or null / integer or null | Wallet context for signatures | Wallet events invalidate preflight, not old tx records |
| `allowance6` / `balance6` / `nativeBalance18` | bigint or unknown | Current account token allowance, ERC-20 and native reads | Every step, switch, refresh, quote expiry; unknown blocks relevant write |
| `preflight` | `{contextKey,operation,quoteBlock,quotedAt,estimatedGas,maxFeePerGas18,feeBudget18,simulationResult,feeSource}` or null | Current-operation simulation/estimate, from chain RPC | Any call/terms/account/network/config change or TTL expiry |
| `futurePaymentFeeHint` | bigint or unknown | Indicative fee derived only from matching measured hint | Clear on hint/fee/code/context change; never payment readiness |
| `payerAllocation6` | bigint | Allocation to connected payer, or zero | Derived from canonical addresses and current account |
| `requestLoadState` | enum | `loading`, `ready`, `notFound`, `unsupportedNetwork`, `unsupportedContract`, `rpcError`, `integrationError` | Each route/read outcome |
| `transactionRecords` | TransactionRecord[] | Versioned same-origin local journal below | Persist before wallet prompt and immediately on hash/update; verify on reload |
| `settlementEvidence` | `{requestKey,payer,txHash,blockNumber,logIndex}` or unresolved | Only matching successful `RequestPaid` + canonical read | Recover logs/receipt; never use approval/failed tx hash |
| `historyContext` | `{account,chainId,contractAddress,generation}` or null | Current My requests scope | Account/network/manifest switch increments generation and hides old list |
| `historyRows` | keyed row records | Creation logs plus request reads, each with freshness/error state | Merge verified pages; refresh state; never trust local status |
| `historyScan` | `{snapshotHead,coveredRanges,nextRange,pageSize,state,error}` | Inclusive coverage in `[deploymentBlock,snapshotHead]` | New context resets; successful ranges only advance coverage |
| `historyState` | enum | `disconnected`, `loading`, `partial`, `complete`, `error`, `unsupportedNetwork` | Scan/read progress, retry, context switch |

`RequestKey = {chainId, contractAddress, requestId}`. Serialize bigints as decimal strings, validate all restored records and schema versions, normalize address comparisons, and render labels as text.

### 8.2 TransactionRecord: one model for every write

| Field | Type | Purpose / source | Update or invalidation |
|---|---|---|---|
| `schemaVersion` / `recordId` | integer / local UUID | Journal format and operation identity | Created once; reject incompatible schema safely |
| `chainId` | integer | Original signing chain | Frozen per attempt |
| `contractAddress` | address | SplitLink request contract/context, including for approvals | Frozen per attempt |
| `account` | address | Original signing wallet | Frozen; never replaced by newly connected wallet |
| `operationType` | enum | `create`, `approveReset`, `approve`, `pay`, `cancel` | Frozen per attempt |
| `requestId` | decimal string or null | Known request; null for create until decoded | Set for create only after verified receipt/event extraction |
| `to` / `callData` / `value18` | address / hex / decimal string | Actual reviewed call, including USDC target for approval | Frozen; `value18` is 0; invalidate signing intent if terms change |
| `intent` | typed operation arguments | Expected request terms or approval spender/amount for verification | Frozen snapshot; public data only, no keys/signatures |
| `txHash` | hash or null | Original broadcast hash from wallet | Set immediately when returned; null before known broadcast |
| `effectiveTxHash` / `replacementHashes` | hash or null / hash[] | Known replacement tracking | Change only after independently verifying candidate tx sender, nonce and call |
| `nonce` | bigint string or null | Original transaction nonce from RPC/wallet | Populate when known; not inferred from latest nonce alone |
| `submittedAtBlock` | bigint string or null | Head near submission; recovery search hint | Set if available; not proof of inclusion |
| `createdAtMs` / `updatedAtMs` | integer timestamps | Local journal/UI ages | Update on record changes; no business authority |
| `txState` | enum below | Attempt lifecycle | Wallet/RPC evidence only |
| `businessVerification` | enum | `notChecked`, `pending`, `verified`, `mismatch`, `unavailable` | Operation-specific postreceipt reads/events |
| `receiptBlock` / `receiptStatus` | bigint string or null / `success`, `reverted`, null | Final receipt evidence | Verified from original chain |
| `replacementKind` / `error` | enum or null / structured code+message or null | Repriced/same-intent, wallet-cancel, other-call, or classified failure | Update with evidence; unknown if wallet cannot report it |

Transaction states: `prepared → awaitingSignature → submitted → confirmed | reverted`. Also `rejected` for explicit user refusal, `unknown` for ambiguous broadcast/receipt access, `replaced` when a verified replacement supersedes an attempt, and `cancelledByReplacement` only when a final verified replacement does not execute the intended operation (such as a wallet cancellation). A preparation/estimation error remains a preflight error; it is not an on-chain revert. `confirmed` means receipt execution success, NOT business success until `businessVerification=verified`.

Business request lifecycle is separately `None → Open → Paid` or `None → Open → Cancelled`. Pending create does not establish `Open`; pending cancel does not establish `Cancelled`; approval never establishes `Paid`. Arc finality occurs at committed inclusion; no invented multi-confirmation progress counter.

### 8.3 Persistence and restart reconciliation

Persist a prepared record before requesting a wallet action and persist a returned hash immediately. Storage failure must be visible: “Transaction recovery on this device is unavailable. Save the transaction hash.” Show the hash when available. Keep unresolved records until explicit user dismissal; no silent expiry. Cache storage is not guaranteed, encrypted custody, cross-device sync, or background execution.

On page load/focus, reconnect, and relevant route entry:

1. Restore and validate journal records. Resume reads using each record's original manifest chain, not the currently selected wallet network. No automatic signatures, approvals, resubmissions, or payments.
2. For each known effective hash, query receipt and transaction; verify target/from/call/nonce. Successful receipt triggers operation-specific reconciliation. Postreceipt request/allowance reads must use a block at or after that receipt block; reject a lagging provider result as stale and retry/fail over. Reverted receipt retains its hash only as failed-attempt history and rereads business state.
3. No receipt with a known pending transaction: remain `submitted`. RPC failure or absent transaction: `unknown`; show retry/hash. Two minutes is a warning threshold, not proof of drop/failure.
4. `create`: decode exactly this contract's `RequestCreated`, matching creator and stored terms, then persist ID and offer the public link. If the event/terms cannot be verified, do not announce creation or automatically recreate. My requests can recover its candidates; never guess a matching ID from the latest counter/title alone.
5. `approveReset` / `approve`: verify actual USDC target and spender/amount, then reread allowance, balances and request status. A later approval/payment may already have changed allowance, so report present allowance independently from historical approval success. Never automatically submit the next step after restart.
6. `pay`: apply actual-payer/evidence rules in Section 10, irrespective of this attempt's outcome.
7. `cancel`: inspect matching `RequestCancelled` when available and always reread current request. Only canonical `Cancelled` supports that result. If current state is `Paid`, show actual settlement instead. On reread failure show “Cancellation transaction confirmed. Request status could not be refreshed.” and no unverified cancelled badge.

An interrupted `awaitingSignature` record with no hash is `unknown`, not assumed rejected. The wallet may have broadcast before the browser closed. Explain “No transaction hash was saved. Check your wallet activity before trying again.” Recover creation via history where possible; request state via reads; approval via present allowance. These can recover business state but cannot always identify the lost transaction.

### 8.4 Replacement and recovery limits

When the SDK/wallet reports a replacement, independently read it on the original chain. Same account/nonce plus same `to`, calldata and value means same-intent repricing: follow the replacement hash. A changed call is a different attempt, not proof of original success. If the original nonce is unknown or differs, treat the candidate as unrelated until its connection is established, not as a replacement. Track its final receipt before marking the original attempt superseded/cancelled, and reread any known request even if replacement is a cancellation.

After a closed browser, standard JSON-RPC has no universal “transaction by sender and nonce” lookup. A larger latest nonce only proves something consumed that nonce, not which call. Bounded block scans or wallet-provided candidates may help when available, but are not mandatory guaranteed recovery. If the replacement hash cannot be discovered, retain `unknown`, show known hash/nonce and wallet-history instructions; reconstruct known requests/history separately. Do not declare failed, cancelled, or paid solely from nonce change.

No reliable recovery promise for cleared storage, another browser/device, inaccessible historical RPC, unknown lost hashes, unsupported wallet replacement APIs, or an account's entire mempool. My requests remains recoverable without storage only while the relevant public logs and reads are available. Poll only while the app is active; reconcile when reopened.

## 9. Routes, My requests, and cancellation

### 9.1 Public routing and hosted behavior

- `/create`: draft, immutable-terms review, and My requests; no extra dashboard route.
- `/pay/:chainId/:contractAddress/:requestId`: canonical public payment request.
- `/receipt/:chainId/:contractAddress/:requestId`: canonical settlement or current unpaid/cancelled status.

Validate positive decimal integer IDs and supported manifest chain/contract pairs before reads. Unknown route shape/malformed ID is `Route not found` (application 404); valid shape with unsupported chain is `Unsupported network`; allowed chain with unknown contract is `Unsupported contract`; valid supported tuple with `RequestNotFound` is `Payment request not found`; RPC transport failure is `Unable to load request. Retry.` Never collapse them into empty data or 404.

Hosting must serve the app/router on direct HTTPS requests and refreshes for all three routes (SSR or SPA fallback excluding assets). Generate absolute links from configured `appOrigin`. A clean browser with no cache or wallet must load public request terms, actual paid status/payer, and receipt evidence via public reads. Connecting a wallet is needed only for signatures and wallet-specific history. Hosting/rewrite success is insufficient without browser RPC CORS/historical-log access.

### 9.2 My requests reconstruction

Scope: the connected wallet, selected supported network and its single allowlisted contract. Do not aggregate unsupported networks. Disconnected: “Connect a wallet to see your requests.” Wrong/unsupported wallet network: offer supported selection/switch with no history signing. A supported network switch resets displayed list/preflight, retains old transaction journal, and starts the new history context.

Query `RequestCreated` logs using exact `address=splitLinkAddress` and indexed `creator=currentAccount`. Use the inclusive lower bound `deploymentBlock` and a captured latest committed `snapshotHead`. Scan newest-to-oldest in inclusive pages: `[max(deploymentBlock, end-pageSize+1), end]`, then continue at `start-1`. Never skip gaps. Log order within pages is normalized by block number, transaction index, log index. Deduplicate by chain/contract/transactionHash/logIndex and ultimately request key.

For provider range/size limits halve the page span down to `minLogPageBlocks`, retry that same range; transient errors use bounded backoff. A single-block result too large or inaccessible is a history limitation, not an empty page: stop that gap, retain partial data, and expose Retry/provider failover. Mark coverage only after successful log retrieval. A page range may be complete while individual request reads still failed; track those separately.

Read `getRequest` for each discovered ID with bounded concurrency, validate creator, and render latest known on-chain state. Default sorting is creation block DESC, transaction index DESC, log index DESC; timestamps are display-only because multiple Arc blocks may share a timestamp. Newest-first pages make partial results useful but label them “Partial results”; never claim complete history until every range and row read succeeds. Fetch newly committed blocks above the previous snapshot on refresh, and retry old gaps. Increment generation on account/context switch; discard late responses from older generations.

Cached creation logs and coverage may accelerate rescans only after validating schema/context and referenced committed block hashes; re-fetch latest boundary/new ranges. Every displayed status starts “Refreshing” until chain read succeeds. Cached status never enables Cancel/Pay/receipt success. A failed status read may display last checked status labeled stale, with action disabled. Store no authoritative balances/status in the cache.

Row fields: title, request ID, total USDC, network, creation time/block, canonical business status with freshness, and shortened actual payer when paid (full address on detail). Row actions:

- **Copy payment link**: for any discovered valid request, including paid/cancelled; copied URL shows current state. Use Clipboard API with a selectable-text fallback; show success only after copy succeeds. Public metadata is always on-chain, not embedded amount/recipients in the URL.
- **Open request**: any validated row.
- **View receipt**: only fresh `Paid`; if evidence unavailable, open the receipt route's clearly labeled unresolved-evidence state.
- **Cancel request**: only fresh `Open`, connected account equals canonical creator, correct wallet network, and no unresolved same-request cancel/pay attempt from this device. Revalidate at action time; contract remains final authority.

Loading: skeleton/progress with scanned block range, no empty claim. Partial: show available rows, row-specific read failures and Retry. Failed initial scan with no rows: show error plus Retry, not “No requests”. Complete, all reads successful, zero logs: “No requests found on this network.” Retry resumes failed ranges/rows; it must not duplicate or silently omit history. On active page refresh/poll known row statuses and the new head; do not repeatedly rescan all history every five seconds.

### 9.3 Cancellation interaction

Open a confirmation displaying title, amount, full request ID/contract/network and immutable cancellation effect: “Cancel this payment request? It cannot be paid after cancellation. Network fees apply. Existing USDC approvals are not revoked.” Let the user return without signing. On confirmation, reread `Open` and creator, simulate/estimate/fund-check, then submit a tracked cancel operation.

While awaiting signature/submitted show “Cancellation pending. This request may still be paid until cancellation completes.” Keep canonical state separate. User rejection: “Cancellation was not submitted.” only when explicitly rejected before known broadcast; retain actual request state. Unknown broadcast uses the generic uncertainty message. Revert: “Cancellation failed. Refreshing request status.” Refresh even when the failure is not decoded.

Race: if payment wins, show “This request was paid before it could be cancelled.” with canonical payer and verified receipt; if cancellation wins, display `Cancelled` after reread. Another tab's creator cancellation must also update this view. RPC failure must not make cancel locally successful or enable repeated attempts blindly.

## 10. Payment attribution, receipts, and payer-as-recipient

### 10.1 Actual payer versus current attempt

After any pay attempt, including rejection, revert, unknown or pending status, refresh the request. If `Paid`, disable payment and use canonical `payer` plus verified matching settlement logs. A failed/pending attempt and a settled business request can coexist.

- Current connected wallet equals canonical payer and this attempt's final successful hash equals verified settlement hash: “Your payment is complete.”
- Current connected wallet equals canonical payer but settlement came from another session/hash: “This request was paid by your wallet.” Do not claim this pending/failed attempt succeeded.
- Current wallet differs from canonical payer: “This request was paid by another wallet: [payer].” This applies even when the current attempt is still pending or has reverted.
- No wallet connected: “Paid by [payer].” Do not imply identity or current-user ownership.

Keep a pending/failed attempt as a separately labeled activity item: “Your transaction is still pending” or “Your transaction failed; this request was paid by another wallet.” Never replace its hash with another payer's settlement in the attempt history.

Receipt evidence must be a successful receipt on the allowlisted chain/contract with matching `RequestPaid(requestId,payer,totalAmount)`, canonical `Paid`/payer/terms, and matching `RecipientPaid` allocations. Read logs from deploymentBlock with the same paginated reliability rules as history. A candidate hash is only a hint until verified. Approval, cancelled replacement, unrelated call and reverted hashes cannot be payment proof. Do not infer settlement from token Transfer events alone or double-count Arc native/ERC-20 views.

If state is paid but log/receipt retrieval fails, show actual payer and “Paid — settlement transaction details temporarily unavailable.” Mark evidence unresolved, provide Retry, and omit an unverified explorer transaction link. An unpaid/cancelled receipt URL shows that actual state, never a success template.

### 10.2 Payer is a recipient

Keep the gross approval and funding rule in Section 4; do not require only the net external allocation. Before signing, show:

- “Request total: [P] USDC.”
- “Your wallet is also a recipient. You will receive [A] USDC of this payment.”
- “Amount allocated to other recipients: [P − A] USDC.”
- “Estimated network fee / maximum fee budget: [distinct values, if available].”
- “Estimated net wallet decrease: [P − A + estimated fee] USDC. Actual fees may differ.”

If only fee caps are available, label the last amount “Net decrease budget” instead of an expected actual fee. If fee unknown, show net external allocation and “Net wallet change cannot be estimated until network fees are available.” For approval stage, separate approval fees already spent from future payment fees; do not count confirmed approval fees again in remaining-funds checks.

For the isolated payment transaction, signed native-unit balance delta attributable to this operation is `-(P6 - A6) * 10^12 - actualPaymentFee18`. Across the whole local flow also subtract actual fees from its confirmed approvals/resets (and any failed attempts included in the displayed scope). Do not call an observed before/after wallet balance the exact operation delta if unrelated transactions occurred; label it observed and keep formula-based accounting distinct. Fees use `gasUsed * effectiveGasPrice` where provided, not gas limit * max fee as actual expense.

Canonical USDC integration must verify self-`transferFrom`, allowance consumption, recipient ordering, full rollback, and native/ERC-20 shared-balance observations. A mock or simulation alone does not establish these. If canonical token self-transfer fails, block that scenario in the release and report a specification conflict; do not silently remove the allowed rule or skip the transfer. Request an explicit design revision before release.

## 11. Expected behavior, English messages, and invariants

| Condition | Required result / English message |
|---|---|
| Invalid percentage | Inline specific message from Section 6; preserve input |
| Invalid total share | “Shares must add up to 100%.” Current valid subtotal remains visible |
| Invalid amount precision | “Use no more than 6 decimal places.” |
| Invalid address/title or zero allocation | Mark field; block creation; no stale valid preview |
| Wrong signing network | “Switch to [Arc / Arc Testnet] to continue.” Public reads still work |
| Known principal shortage | “Insufficient USDC for the request total.” Show required and available |
| Known fee-budget shortage | “Insufficient USDC for the amount and network fee budget.” Show separate values |
| Future payment estimate unavailable before approval | “Payment fee unavailable until approval is confirmed. You may need more USDC to complete payment.” |
| Current estimate unavailable | “Network fee estimate unavailable. Retry before signing.” Block only that write step |
| RPC unavailable | “Unable to reach Arc. Your balance and transaction status are unknown. Retry.” |
| Simulation reverted | “This transaction cannot be executed: [decoded reason].” Refresh business state |
| Approval succeeds | “USDC approval confirmed. Checking whether payment can proceed.” No payment success |
| Wallet rejects payment signature | “You declined the payment signature.” Refresh request; do not claim globally unpaid |
| Submitted payment | “Payment submitted. Waiting for its outcome.” No business completion badge |
| Submitted hash cannot be reconciled | “Transaction status is unavailable. It may still complete. Check your wallet before retrying.” |
| Request paid by someone else | “This request was paid by another wallet: [payer].” Show only actual settlement proof |
| User's attempt failed while another payer won | “Your transaction failed; this request was paid by another wallet.” |
| Cancellation pending | “Cancellation pending. This request may still be paid until cancellation completes.” |
| Payment beats cancellation | “This request was paid before it could be cancelled.” |
| Failed receipt | “Transaction failed. Network fees may have been charged.” Reconcile business state separately |
| My requests partial | “Partial results. Some history or request statuses could not be loaded.” Retry preserves known rows |
| My requests empty after full scan | “No requests found on this network.” |
| Paid, evidence unavailable | “Paid — settlement transaction details temporarily unavailable.” |
| Unsupported route/network/contract/missing request | Distinct errors from Section 9; no writes |
| Cancelled request | “This payment request was cancelled.” |

Protocol invariants:

- Immutable terms/order never change; all positive allocations sum exactly to total.
- At most one successful settlement per request; every successfully paid request has exactly one settlement event.
- No caller can spend another wallet's allowance. No successful payment after cancellation; no cancellation after payment.
- Transfer failure rolls back all application/token transfers and business state in that transaction, but not consumed gas.
- No application owner, rescue/withdrawal, proxy, mutable fee settings, arbitrary token/from or metadata execution.
- Unsolicited transfers to SplitLink are unsupported; no rescue mechanism. Explain this limitation in README.
- Canonical issuer controls/chain restrictions can fail transfers. Do not promise guaranteed execution or censorship resistance.
- Settlement proves money movement, not work delivery, identity verification or contract acceptance.
- Pending/unknown transaction state never overrides fresh canonical business state. Cache never authorizes a write.

## 12. Acceptance tests

### 12.1 Contract and exact arithmetic

- Create 2- and 5-member requests; unique IDs, correct events, getter ABI and immutability.
- Boundaries/malformed inputs: UTF-8 titles, amount bounds, mismatch arrays, zero/self/duplicate addresses, positive shares and exact sum, zero allocations.
- Exact six-decimal and remainder examples; property-based sum preservation and agreement between frontend and contract across values/orders.
- Successful payment: all allocations, payer/time/status/events; no principal in contract; second payment fails.
- Insufficient gross balance/allowance, early and later-recipient failure: entire settlement rolls back.
- Creator-only cancel, missing ID, paid/cancelled rejection, both race orderings and nonzero native-value rejection.
- Reentrant mocks against every mutating entry point: no unauthorized transition or double spend.
- Canonical USDC on Arc testnet: approval/reset behavior, actual self-transfer/allowance consumption, ordering and shared balances, fees, later-recipient restriction/failure rollback where the network permits a reproducible test. Record any untestable runtime scenario; do not substitute a claim of coverage from mocks.

### 12.2 Client input and preflight

- Inputs `33.33`, `33.3`, empty, `0`, `100.01`, `33.333`, `.5`, `1e2`, `33%`, trailing decimal and invalid text; verify exact bps/messages and preserved edits.
- Add/delete rows without modifying others; continuously accurate/incomplete subtotal; no stale preview; zero allocation blocks creation.
- Principal-short, fee-short, RPC-down, reverted simulation, stale quote and balance-race cases stay distinct.
- Without allowance, failed payment estimation does not block a separately simulated/estimated affordable approval. Unknown future fee has explicit warning; current-step missing estimate blocks signing.
- After approval/reset, reread allowance/balances/status and estimate/simulate payment; do not assume readiness. If another wallet paid during approval, stop and show actual payer.
- Validate integer 6↔18 conversion, fee ceilings/reserve/TTL, native dust and no double-counting. Recompute on account/network/config changes.
- Payer-as-recipient review shows gross total, self-allocation, others' allocation and separate fees/net decrease. Canonical integration verifies actual outcome; unrelated balance activity is not attributed to this flow.

### 12.3 Transaction recovery and concurrency

- For create, reset/approve, pay and cancel: reload after hash save and close/reopen, resolve successful and reverted outcomes on original chain. Reject/stale local records safely; show storage failure.
- Interrupt signature before hash return; no false rejection/success, no auto-resubmission. Creation recovery decodes correct contract event/creator/terms; simultaneous unrelated creations never cause predicted IDs.
- Wallet/account/network changes during each operation invalidate readiness but retain original context tracking. Wallet rejection is operation-specific.
- RPC timeout with pending, absent and final hashes: no time-based false failure. Same-intent replacement, wallet cancellation and unrelated same-nonce replacement all reconcile correctly.
- Reopen with no replacement callback/hash; nonce advance alone remains unresolved. Document browser limitations; no background/cross-device recovery promise.
- Successful cancel receipt followed by read failure remains unverified; eventual Paid/Cancelled read controls display.
- Two wallets pay one request: exactly one settles. Loser's receipt/attempt never becomes payment proof. Test loser pending, reverted and unknown while winner is known; reveal actual payer.
- Same connected wallet pays in another tab/session while local attempt fails/pends: “paid by your wallet”, not “your attempt succeeded”. Wallet switching after success changes attribution correctly.
- Exclude approval, failed, unrelated and wallet-cancel hashes from receipt proof. Paid but unavailable settlement logs shows actual payer with unresolved evidence.

### 12.4 History, cancellation and deployed routes

- Create with a wallet, clear local cache, reconnect: My requests reconstructs from indexed creator logs starting at deploymentBlock and reads current status. Another wallet's requests never leak into the displayed scope.
- Multiple pages, adaptive page shrink, rate-limit retries, one-block failure, missing row reads, duplicate logs, out-of-order completion and snapshot advancement. Only full coverage with successful row reads shows complete/empty.
- Cache stale statuses cannot enable Cancel. Switching context ignores late results. Retry fills gaps without losing rows.
- Copy links correctly, handle Clipboard API failure honestly; receipt action only on fresh Paid. Confirm cancel and test no-signature return, explicit rejection, ambiguous broadcast, failed cancel, cancellation in another tab and both pay/cancel race orders.
- On the actual intended hosting environment, directly open and hard-refresh `/create`, `/pay/...`, `/receipt/...` without prior root visit. Verify HTTPS, assets, fallback/router rules and RPC CORS.
- In a fresh wallet-disconnected browser with no local storage, display complete public request and paid receipt, including payer and verified explorer hash. Test receipt-log failure separately.
- Distinguish unknown route/malformed ID, unsupported chain, unsupported contract, valid missing request and RPC outage. All copy and errors remain English on mobile/desktop.

## 13. Arc Studio, official verification, and release gates

### 13.1 Evidence register — checked October 22, 2026

| Item | Verified fact / source | What this does NOT establish |
|---|---|---|
| Studio web capabilities | Official [Studio docs](https://docs.arc.io/ai/arc-studio.md) describe editable workbench/terminal, contract generation/compilation, app preview, wallet testnet interactions and GitHub export. [Landing page](https://studio.arc.io/) was readable. | This user's login, usable quota, project access, actual successful tests or eligibility |
| Studio deployment scope | Official web docs and [CLI docs](https://docs.arc.io/ai/arc-studio-cli.md) explicitly say testnet deployment only, not mainnet on the user's behalf. | A one-click Studio mainnet deployment path |
| Studio agent bridge | Official CLI docs describe remote server-side Studio workspaces, context uploads, structured `run` output, `pull`, existing-app selection, public-repo clone and session links; Node 20+ is required for CLI. | That a local agent session/ordinary Git commit counts as Studio-built, or that CLI/import paths meet this event's rules |
| Network/token model | Official sources in Section 4 list both network IDs, reference endpoints and the canonical six-decimal USDC interface. Native gas is the same underlying asset in 18-decimal units. | Endpoint reachability/CORS/log retention or operational token behavior in this environment; these have not been tested in this revision |
| Round summary | Earlier in this conversation, the [DoraHacks-labeled Eventbrite listing](https://www.eventbrite.com/e/httpsdorahacksiohackathonarc-microgrants-2detail-tickets-2003559137314) was read on October 22: 8 × 500 USDC, November 1 submission date, Studio-built app plus real Arc mainnet USDC movement. Recheck in this revision returned HTTP 429. | Full/current official rules, precise cutoff timezone, remaining awards, entrant eligibility, or acceptable Studio-to-mainnet handoff |
| Authoritative round detail | [DoraHacks round page](https://dorahacks.io/hackathon/arc-microgrants-2/detail) was attempted again on October 22 and returned HTTP 405 to the web reader. | No claim that the complete official rules were verified. Prior third-party transcriptions are leads only, not authority. |
| Studio terms | Official [Studio terms](https://studio.arc.io/terms-of-use), last updated September 14, were publicly readable. | This user has accepted terms or meets applicable access/entrant requirements |

This is a dated factual register, not an assertion of entry approval. This design-only revision performed no login, installation, RPC transaction, signatures, or deployment.

### 13.2 Studio implementation path and evidence

For competition-intended work, first confirm Studio access and acceptable provenance. Preferred path is a real Studio web project: supply this spec; generate/review contracts there; run compilation, unit/property tests via the available workbench/terminal; build the English client in the same project; test against canonical USDC on testnet; preserve actual command outputs and project history. If the provided terminal/toolchain cannot run required Arc-specific tests, record the limitation and run supplemental tests outside Studio, clearly labeled external. Do not relabel external tests as Studio tests.

An agent may alternatively drive a real Studio workspace using the documented CLI: authenticate with the user's normal access flow; attach this spec as file context; target a named session/app; request contract, tests and app development; retrieve artifacts/diffs/preview/project URLs using documented outputs and `pull`. Verify results independently. Use the CLI's documented file round-trip/repo import support for changes, but confirm event acceptance of CLI/imported/local-assisted work first. Mere installation of a Circle skill or use of local Codex does not establish Studio provenance. No need to spawn unrelated local subagents to satisfy this path.

Preserve: Studio project/app URL and ID; dated prompts/turn IDs; source revisions and exported commit hashes; build/compiler configuration; actual test commands/results and environment; canonical-token testnet deployment/transaction evidence; app preview; a short video showing meaningful Studio contract/test/app work; and an evidence index mapping each artifact to its origin. Exclude credentials, private keys, access tokens and unrelated private session transcripts. Final mainnet ABI/source must trace to an identified reviewed Studio export; record and retest any external changes.

### 13.3 Explicit conflict and minimum adjustment

The earlier plan implicitly joined Studio development with mainnet deployment. Official Studio documentation limits its deployment feature to testnet, whereas the accessible round summary asks for mainnet evidence. Minimum proposed adjustment: build/test in Studio, export the reviewed source, deploy that same reviewed release separately to mainnet with user-authorized tooling, and host the public app against that deployment. This preserves all MVP behavior. It is a proposed eligibility bridge, not a verified competition permission. If the full rules require a different provenance/deployment route, document the exact conflict and seek an explicit design decision; do not silently substitute testnet evidence, change funds flow, or claim qualification.

### 13.4 Open issues and exact gates

**Before competition-bound implementation starts:**

- **G1 — Access/provenance:** User-specific Studio login, project creation, available quota/cost and usable web or CLI path are unverified. Resolve by opening an actual authorized project, checking its available build/test/export path, and recording the selected workflow. Without G1, a developer may implement the core locally but cannot claim Studio-origin progress or proceed on that assumption.
- **G2 — Authoritative rules:** Obtain the current full round rules from DoraHacks or an organizer-controlled source, specifically accepted Studio web/CLI/import workflow, prior/external work limits, eligible entrants and any exclusion affecting the actual entrant. Confirm whether the export/separate-mainnet path is accepted. Without this, event-specific implementation may need rework; eligibility cannot be promised. Core protocol/client implementation is not technically blocked.

**Before testnet integration/deployment:**

- **G3 — Runtime access:** Verify correct RPC `eth_chainId`, safe browser CORS, historical logs/range limits, USDC bytecode/`decimals`/allowance methods, funding access and actual token self-transfer/reset semantics. Mock-based implementation can start before G3; canonical integration cannot be marked complete. Any self-transfer incompatibility is a release-blocking specification conflict under Section 10.

**Before public/mainnet deployment or competition submission:**

- **G4 — Release infrastructure and funds:** Working mainnet reads/wallet path, correct immutable token/manifest/deployment block, reviewed test evidence, actual host deep-link/refresh/CORS checks, and user-authorized controlled wallets/funding/signatures. No fake mainnet evidence or sample UI addresses.
- **G5 — Submission terms:** Current cutoff timestamp/timezone, required fields/evidence, payout/verification terms and final eligibility decision; confirm separately from the earlier Eventbrite summary. Do not assume an award remains or that local evidence fulfills Studio requirements.

No other product-scope decision is left to developer inference. The developer can start core implementation from this document now. A competition-compliant end-to-end handoff is conditional on G1–G2; production readiness requires G3–G4; submission readiness additionally requires G5. If unresolved, report each named gate and its affected work rather than a generic “pending confirmation”.

## 14. Implementation order and deliverables

1. Read Sections 4 and 13; record verification state. Resolve G1–G2 before representing work as competition-bound Studio implementation. If unavailable, explicitly label any permitted core local work as eligibility-unverified and retain its provenance honestly.
2. Implement/test the immutable contract and shared exact parsers/allocation model. Establish manifest validation and versioned transaction journal before enabling writes.
3. Resolve G3; run canonical-token testnet tests and measure traceable preapproval fee hints. Document unsupported wallet/RPC recovery limits.
4. Implement `/create` with My requests, creator cancellation, public payment and receipt routes, unified per-operation preflight/tracking, restart reconciliation, actual-payer attribution and payer-as-recipient accounting.
5. Run Section 12 checks, including concurrency/failure injection and clean-browser hosted deep-link tests. Review scope, immutable terms, units, fee behavior, event pagination and evidence provenance.
6. Prepare a reviewable release and resolve G4 before deployment: verified source/ABI, deployment manifests, host routing configuration, test reports, controlled-wallet small-value mainnet plan and user participation/authorization for signatures. No deployment is authorized merely by this spec.
7. Resolve G5; assemble accurate Studio URL/evidence, public app/repo, real contract/settlement proof and short English demo/description. Submit only under separately authorized scope and verified rules. Never call the project compliant solely because it functions locally.

Repository deliverables for implementation: contract/ABI, meaningful unit/property/integration and client tests, English client, environment-specific manifest, deployment/hosting instructions, README, secret-free `.env.example`, Studio evidence index, transaction recovery limitations, verification/gate report and English submission draft. No backend/database or added MVP features. This revision itself supplies only the design document.

## 15. Developer-agent handoff prompt

Implement SplitLink according to design v1.1. Sections 2–12 are the behavioral contract; Sections 13–14 define evidence, gates and sequence. Use English throughout. Preserve fixed amounts, 2–5 recipients, public single-use requests, immutable ordered shares, atomic direct USDC payouts, zero platform fee and no backend/database. Add My requests inside `/create` through paginated indexed creator events from deploymentBlock and fresh chain reads; support safe creator cancellation and honest partial/error states. Preserve raw percentage inputs, parse exact integer bps, and never silently rebalance. Implement one durable context-scoped transaction model for create/reset/approve/pay/cancel, original-chain recovery, verified replacements and explicit unrecoverable cases. Separate transaction outcome from business status and attribute payment only to canonical payer and successful settlement evidence. Apply the staged preapproval/postapproval fee procedure with integer 6/18-unit conversion, conservative gross funding, configurable margins and distinct errors. Correctly disclose self-allocation and net wallet decrease. Test direct hosted routes from clean wallet-disconnected browsers. Use a real Studio workspace and preserve provenance when G1–G2 are resolved; do not equate local development with eligibility. Canonical token integration, mainnet release and event submission remain gated as specified. Report exact conflicts and minimal adjustments before changing fixed behavior. Produce a reviewable implementation and evidence report, not fake success states. The earlier UI prototype is visual reference only. This document does not authorize production deployment, signatures or real transactions.

## 16. Revision rationale

v1.1 integrates creator history/cancellation discovery, unified transaction recovery and payer attribution rather than appending optional suggestions. It replaces ambiguous “confirmed means successful product action” wording with receipt plus business verification; replaces a preapproval payment-estimation dependency with staged estimates; replaces raw bps editing with exact percentage parsing; and replaces unqualified “Studio build/test then mainnet” assumptions with dated evidence and explicit gates. It adds conservative gross funding and self-allocation accounting, honest browser/RPC limits, and actual-host route acceptance. These changes remove independent-implementation ambiguity without expanding the payment product's MVP boundary.
