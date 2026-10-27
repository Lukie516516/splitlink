import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  erc20Abi,
  decodeEventLog,
  type Address,
} from "viem";
import { generatedAbi as SPLITLINK_ABI } from "../../src/lib/generatedAbi";
const m = JSON.parse(fs.readFileSync("public/local-manifest.json", "utf8"));
const c = createPublicClient({
    transport: http("http://127.0.0.1:9547"),
    cacheTime: 0,
  }),
  w = createWalletClient({ transport: http("http://127.0.0.1:9547") });
let accounts: Address[] = [];
test.beforeAll(async () => {
  accounts = await w.getAddresses();
});
test.beforeEach(async () => {
  const hash = await w.writeContract({
    chain: null,
    account: accounts[1],
    address: m.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [m.contractAddress, 0n],
  });
  await c.waitForTransactionReceipt({ hash });
});
const path = (id: string, page = "pay") =>
  `/${page}/31338/${m.contractAddress}/${id}`;
async function wallet(context: BrowserContext, index = 0) {
  await context.addInitScript(
    ({ account }) => {
      const listeners: Record<string, Function[]> = {};
      const state = {
        account,
        chain: "0x7a6a",
        reject: false,
        pause: false,
        prompts: [] as any[],
      };
      (window as any).__fixture = state;
      (window as any).ethereum = {
        request: async ({ method, params = [] }: any) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [state.account];
          if (method === "eth_chainId") return state.chain;
          if (method === "eth_sendTransaction") {
            state.prompts.push(params[0]);
            if (state.pause)
              await new Promise<void>(
                (resolve) => ((window as any).__releasePrompt = resolve),
              );
            if (state.reject)
              throw Object.assign(Error("LOCAL explicit rejection"), {
                code: 4001,
              });
          }
          const response = await fetch("http://127.0.0.1:9547", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params,
            }),
          });
          const result = await response.json();
          if (result.error)
            throw Object.assign(Error(result.error.message), result.error);
          return result.result;
        },
        on: (e: string, f: Function) => (listeners[e] ??= []).push(f),
        removeListener: (e: string, f: Function) => {
          listeners[e] = (listeners[e] ?? []).filter((v) => v !== f);
        },
      };
      (window as any).__changeWallet = (account: string, chain?: string) => {
        state.account = account as Address;
        if (chain) state.chain = chain;
        for (const name of ["accountsChanged", "chainChanged"])
          for (const f of listeners[name] ?? []) f();
      };
    },
    { account: accounts[index] },
  );
}
async function create(title: string, recipients = accounts.slice(2, 4)) {
  const hash = await w.writeContract({
    chain: null,
    account: accounts[0],
    address: m.contractAddress,
    abi: SPLITLINK_ABI,
    functionName: "createRequest",
    args: [title, 10001n, recipients, [5000, 5000]],
  });
  const receipt = await c.waitForTransactionReceipt({ hash });
  const event = receipt.logs
    .filter((l) => l.address.toLowerCase() === m.contractAddress.toLowerCase())
    .flatMap((l) => {
      try {
        return [
          decodeEventLog({
            abi: SPLITLINK_ABI,
            data: l.data,
            topics: l.topics,
          }),
        ];
      } catch {
        return [];
      }
    })
    .find((e) => e.eventName === "RequestCreated");
  if (event?.eventName !== "RequestCreated")
    throw Error("Missing actual event.");
  return event.args.requestId.toString();
}
async function sign(page: Page) {
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign reviewed transaction" }).click();
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toHaveCount(0, { timeout: 25000 });
}
async function ack(page: Page) {
  await page.getByRole("checkbox", { name: /I understand future/ }).check();
}
async function seedRecord(context: BrowserContext, record: unknown) {
  await context.addInitScript(
    (r) => localStorage.setItem("splitlink:journal:v1", JSON.stringify([r])),
    record,
  );
}

test("Studio-derived product: actual create → new context → approve → reload → pay → wallet-disconnected receipt/hard refresh", async ({
  browser,
}) => {
  const creator = await browser.newContext();
  await wallet(creator, 0);
  const p = await creator.newPage();
  await p.goto("/create");
  await p.getByLabel("Public title").fill("Studio-origin browser flow");
  await p.getByLabel("Request amount").fill("0.010001");
  for (let i = 1; i <= 2; i++) {
    await p.getByLabel(`Recipient ${i} address`).fill(accounts[i + 1]);
    await p.getByLabel(`Recipient ${i} percentage`).fill("50");
  }
  await p.getByRole("button", { name: "Review immutable request" }).click();
  await sign(p);
  const link = p.getByRole("link", { name: /Open verified created request/ });
  await expect(link).toBeVisible();
  const url = await link.getAttribute("href");
  const payer = await browser.newContext();
  await wallet(payer, 1);
  const payment = await payer.newPage();
  await payment.goto(url!);
  await ack(payment);
  await payment.getByRole("button", { name: "Review USDC approval" }).click();
  await sign(payment);
  await expect(
    payment.getByRole("button", { name: "Review payment", exact: true }),
  ).toBeEnabled();
  await payment.reload();
  await expect(
    payment.getByText("approve · confirmed", { exact: true }),
  ).toBeVisible();
  await payment
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await sign(payment);
  await expect(
    payment.getByText("Your payment is complete.", { exact: true }),
  ).toBeVisible();
  const publicContext = await browser.newContext();
  const receipt = await publicContext.newPage();
  await receipt.goto(url!.replace("/pay/", "/receipt/"));
  await expect(
    receipt.getByText("Verified settlement", { exact: true }),
  ).toBeVisible();
  await receipt.reload();
  await expect(
    receipt.getByText(`Paid by ${accounts[1]}.`, { exact: true }),
  ).toBeVisible();
  expect(await receipt.evaluate(() => localStorage.length)).toBe(0);
  await receipt.setViewportSize({ width: 390, height: 844 });
  expect(
    await receipt.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await receipt.screenshot({
    path: "evidence/receipt-mobile.png",
    fullPage: true,
  });
  for (const ctx of [creator, payer, publicContext]) await ctx.close();
});

test("raw percentages/addresses preserved, no rebalance, incomplete total clears preview, 2–5 rows", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByLabel("Request amount").fill("1");
  for (let i = 1; i <= 2; i++)
    await page.getByLabel(`Recipient ${i} percentage`).fill("50");
  await expect(page.locator(".preview .allocation")).toHaveCount(2);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(
    page.getByText("Total: 100.00% from valid entries — incomplete"),
  ).toBeVisible();
  await expect(page.locator(".preview .allocation")).toHaveCount(0);
  await page.getByLabel("Recipient 3 percentage").fill("33.333");
  await expect(
    page.getByText("Use no more than 2 decimal places.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Recipient 1 percentage")).toHaveValue("50");
  await page.getByRole("button", { name: "Remove recipient 3" }).click();
  await expect(page.locator(".preview .allocation")).toHaveCount(2);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByRole("button", { name: "Add member" })).toBeDisabled();
  await page.screenshot({
    path: "evidence/create-desktop.png",
    fullPage: true,
  });
});

test("explicit reset and approval remain separate operations; reset reload recovers and pending pay never inherits approval hash", async ({
  browser,
}) => {
  const id = await create("Reset checkpoints");
  const initial = await w.writeContract({
    chain: null,
    account: accounts[1],
    address: m.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [m.contractAddress, 1n],
  });
  await c.waitForTransactionReceipt({ hash: initial });
  const context = await browser.newContext();
  await wallet(context, 1);
  await context.route("**/local-manifest.json", (route) =>
    route.fulfill({ json: { ...m, resetRequired: true } }),
  );
  const page = await context.newPage();
  await page.goto(path(id));
  await ack(page);
  await page.getByRole("checkbox", { name: /Explicitly reset/ }).check();
  await page.getByRole("button", { name: "Review allowance reset" }).click();
  await sign(page);
  await page.reload();
  await expect(
    page.getByText("approveReset · confirmed", { exact: true }),
  ).toBeVisible();
  await ack(page);
  await page.getByRole("button", { name: "Review USDC approval" }).click();
  await sign(page);
  const approvalHash = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("splitlink:journal:v1")!).find(
        (r: any) => r.operationType === "approve",
      ).txHash,
  );
  await page.evaluate(() => {
    (window as any).__fixture.pause = true;
    (window as any).__fixture.reject = true;
  });
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign reviewed transaction" }).click();
  await expect(
    page.getByText("pay · awaitingSignature", { exact: true }),
  ).toBeVisible();
  const during = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("splitlink:journal:v1")!).find(
      (r: any) => r.operationType === "pay",
    ),
  );
  expect(during.txHash).toBe(null);
  expect(during.effectiveTxHash).toBe(null);
  expect(approvalHash).toMatch(/^0x/);
  await page.evaluate(() => (window as any).__releasePrompt());
  await expect(page.getByText("pay · rejected", { exact: true })).toBeVisible();
  await context.close();
});

test("creator cancellation: no-signature return, actual canonical Cancelled, restart recovery", async ({
  browser,
}) => {
  const id = await create("Cancel UI");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  await page.goto(path(id));
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await sign(page);
  await expect(
    page.getByText("This payment request was cancelled.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("cancel · confirmed", { exact: true }),
  ).toBeVisible();
  await context.close();
});

test("public routing uses original public chain when wallet is wrong, distinguishes malformed/missing/unconfigured/RPC", async ({
  browser,
}) => {
  const id = await create("Wrong-chain public");
  const context = await browser.newContext();
  await wallet(context, 1);
  const page = await context.newPage();
  await page.goto(path(id));
  await page.evaluate(() => {
    (window as any).__changeWallet((window as any).__fixture.account, "0x1");
  });
  await expect(page.getByText(/Switch to Local EVM/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wrong-chain public" }),
  ).toBeVisible();
  await page.goto("/pay/31338/0x1111111111111111111111111111111111111111/1");
  await expect(
    page.getByText("Unsupported contract.", { exact: true }),
  ).toBeVisible();
  await page.goto(path("999999999999999"));
  await expect(
    page.getByText("Request not found.", { exact: true }),
  ).toBeVisible();
  await page.goto("/pay/nope");
  await expect(page.getByText("Unknown route.", { exact: true })).toBeVisible();
  await page.route("http://127.0.0.1:9547", (route) => route.abort());
  await page.goto(path(id));
  await expect(
    page.getByRole("heading", { name: /RPC \/ integration error/ }),
  ).toBeVisible({ timeout: 25000 });
  await context.close();
});

test("Paid without historical logs retains actual payer and omits fabricated proof; same wallet other session attribution", async ({
  browser,
}) => {
  const id = await create("Unavailable evidence");
  let hash = await w.writeContract({
    chain: null,
    account: accounts[1],
    address: m.usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [m.contractAddress, 10001n],
  });
  await c.waitForTransactionReceipt({ hash });
  hash = await w.writeContract({
    chain: null,
    account: accounts[1],
    address: m.contractAddress,
    abi: SPLITLINK_ABI,
    functionName: "payRequest",
    args: [BigInt(id)],
  });
  await c.waitForTransactionReceipt({ hash });
  const context = await browser.newContext();
  await wallet(context, 1);
  const page = await context.newPage();
  await page.route("http://127.0.0.1:9547", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "eth_getLogs")
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "logs temporarily inaccessible" },
        },
      });
    else await route.continue();
  });
  await page.goto(path(id, "receipt"));
  await expect(
    page.getByText("This request was paid by your wallet.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Paid — settlement transaction details temporarily unavailable.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByText("Verified settlement", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "View verified transaction" }),
  ).toHaveCount(0);
  await context.close();
});

test("storage quota failure and forged terminal success restore are visible without automatic signatures", async ({
  browser,
}) => {
  const id = await create("Storage UI");
  const context = await browser.newContext();
  await wallet(context, 1);
  await context.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw Error("LOCAL injected quota");
    };
  });
  const page = await context.newPage();
  await page.goto(path(id));
  await ack(page);
  await page.getByRole("button", { name: "Review USDC approval" }).click();
  await sign(page);
  await expect(
    page.getByText(
      "Transaction recovery on this device is unavailable. Save the transaction hash.",
      { exact: true },
    ),
  ).toBeVisible();
  await context.close();
  const forged = await browser.newContext();
  const data = encodeFunctionData({
    abi: SPLITLINK_ABI,
    functionName: "payRequest",
    args: [BigInt(id)],
  });
  await seedRecord(forged, {
    schemaVersion: 1,
    recordId: "forged-record",
    chainId: 31338,
    contractAddress: m.contractAddress,
    account: accounts[1],
    operationType: "pay",
    requestId: id,
    to: m.contractAddress,
    callData: data,
    value18: "0",
    intent: {},
    txHash: null,
    effectiveTxHash: null,
    replacementHashes: [],
    nonce: null,
    submittedAtBlock: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    txState: "reverted",
    businessVerification: "verified",
    receiptBlock: "999",
    receiptStatus: "success",
    replacementKind: null,
    error: null,
  });
  const publicPage = await forged.newPage();
  await publicPage.goto("/create");
  await expect(
    publicPage.getByText("pay · unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(
      "No transaction hash was saved. Check your wallet activity before trying again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    publicPage.getByText("Business verification: verified", { exact: false }),
  ).toHaveCount(0);
  await forged.close();
});

test("actual history component preserves gaps/rows, row read failure prevents complete, retries and account generations recover", async ({
  browser,
}) => {
  await create("History independent");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  let mode = "gap";
  await page.route("http://127.0.0.1:9547", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "eth_getLogs") {
      const q = body.params[0];
      if (
        BigInt(q.toBlock) - BigInt(q.fromBlock) > 1n ||
        (mode === "gap" &&
          BigInt(q.fromBlock) <= BigInt(m.deploymentBlock) + 1n)
      ) {
        await route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32000, message: "range limit" },
          },
        });
        return;
      }
    }
    if (
      mode === "row" &&
      body.method === "eth_call" &&
      body.params[0].data.startsWith("0x")
    ) {
      if (
        body.params[0].data.startsWith(
          encodeFunctionData({
            abi: SPLITLINK_ABI,
            functionName: "getRequest",
            args: [1n],
          }),
        )
      ) {
        await route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32000, message: "specific row read failure" },
          },
        });
        return;
      }
    }
    await route.continue();
  });
  await page.goto("/create");
  await expect(
    page.getByText(
      "Partial results. Some history or request statuses could not be loaded.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByText("History independent", { exact: true }),
  ).toBeVisible();
  mode = "row";
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(
    page.getByText(
      "Partial results. Some history or request statuses could not be loaded.",
      { exact: true },
    ),
  ).toBeVisible();
  mode = "ok";
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(
    page.getByText("History complete.", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (account) => (window as any).__changeWallet(account, "0x1"),
    accounts[4],
  );
  await expect(
    page.getByText("No requests found on this network.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("History independent", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("async UI preflight detects account change after await and never opens a stale signature", async ({
  browser,
}) => {
  const id = await create("Delayed context");
  const context = await browser.newContext();
  await wallet(context, 1);
  const page = await context.newPage();
  await page.goto(path(id));
  await ack(page);
  let changed = false;
  await page.route("http://127.0.0.1:9547", async (route) => {
    const body = route.request().postDataJSON();
    if (!changed && body.method === "eth_getCode") {
      changed = true;
      await page.evaluate(
        (account) => (window as any).__changeWallet(account, "0x1"),
        accounts[4],
      );
      await new Promise((r) => setTimeout(r, 250));
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Review USDC approval" }).click();
  await expect(page.getByText(/Switch to Local EVM/)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__fixture.prompts.length),
  ).toBe(0);
  await context.close();
});

test("late old-wallet head response cannot contaminate the new wallet history cursor", async ({
  browser,
}) => {
  await create("Old context must stay isolated");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  let held = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("http://127.0.0.1:9547", async (route) => {
    const body = route.request().postDataJSON();
    if (!held && body.method === "eth_blockNumber") {
      held = true;
      await gate;
    }
    await route.continue();
  });
  await page.goto("/create");
  await expect.poll(() => held).toBe(true);
  await page.evaluate(
    (account) => (window as any).__changeWallet(account),
    accounts[4],
  );
  await expect(
    page.getByText("No requests found on this network.", { exact: true }),
  ).toBeVisible();
  release();
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(
    page.getByText("No requests found on this network.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Old context must stay isolated", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("SFA-1 mounted history: held old-gap Retry plus focus/manual overlap cannot lose a failed new suffix; retry recovers missing request without reload", async ({
  browser,
}) => {
  test.setTimeout(75000);
  await create("SFA1 known old request");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  let mode: "initialFailure" | "holdOldGap" | "newSuffixFailure" | "recover" =
    "initialFailure";
  let held = false,
    release!: () => void,
    oldHead = 0n,
    suffixFailures = 0,
    overlapFetches = 0;
  const succeeded: { from: bigint; to: bigint }[] = [];
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("http://127.0.0.1:9547", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method !== "eth_getLogs") {
      await route.continue();
      return;
    }
    const query = body.params[0],
      from = BigInt(query.fromBlock),
      to = BigInt(query.toBlock);
    if (mode === "initialFailure") {
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "RPC offline" },
        },
      });
      return;
    }
    if (mode === "holdOldGap" && !held) {
      held = true;
      oldHead = to;
      await gate;
      await route.continue();
      return;
    }
    if (held && mode === "holdOldGap") overlapFetches++;
    if (mode === "newSuffixFailure" && to > oldHead) {
      suffixFailures++;
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "RPC offline" },
        },
      });
      return;
    }
    if (mode === "recover") succeeded.push({ from, to });
    await route.continue();
  });
  await page.goto("/create");
  await expect(
    page.getByText("History error. Retry; this is not an empty list.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 25000 });
  mode = "holdOldGap";
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect.poll(() => held).toBe(true);
  const missingId = await create("SFA1 missing new suffix request");
  const newHead = await c.getBlockNumber({ cacheTime: 0 });
  expect(newHead > oldHead).toBe(true);
  // Distinct production entry points queue while the original gap response is held.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "Refresh history" }).click();
  await page.waitForTimeout(100);
  expect(overlapFetches).toBe(0);
  mode = "newSuffixFailure";
  release();
  await expect
    .poll(() => suffixFailures, { timeout: 25000 })
    .toBeGreaterThanOrEqual(4);
  await expect(
    page.getByText(
      "Partial results. Some history or request statuses could not be loaded.",
      { exact: true },
    ),
  ).toBeVisible({ timeout: 25000 });
  await expect(
    page.getByText("SFA1 known old request", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("SFA1 missing new suffix request", { exact: true }),
  ).toHaveCount(0);
  mode = "recover";
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(
    page.getByText("SFA1 missing new suffix request", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("History complete.", { exact: true }),
  ).toBeVisible();
  expect(succeeded.some((r) => r.from <= oldHead + 1n && r.to >= newHead)).toBe(
    true,
  );
  expect(
    await page
      .getByRole("link", { name: "Open request", exact: true })
      .all()
      .then(async (links) =>
        Promise.all(links.map((l) => l.getAttribute("href"))),
      ),
  ).toContain(`${new URL(page.url()).origin}${path(missingId)}`);
  await context.close();
});
