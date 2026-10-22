import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import { Contract, JsonRpcProvider } from "ethers";
const m = JSON.parse(fs.readFileSync("public/local-manifest.json", "utf8"));
const splitArtifact = JSON.parse(
  fs.readFileSync("artifacts/contracts/SplitLink.sol/SplitLink.json", "utf8"),
);
const tokenArtifact = JSON.parse(
  fs.readFileSync(
    "artifacts/contracts/LocalMockUSDC.sol/LocalMockUSDC.json",
    "utf8",
  ),
);
const rpc = new JsonRpcProvider("http://127.0.0.1:8545");
let addresses: string[] = [];
test.beforeAll(async () => {
  addresses = await Promise.all(
    [0, 1, 2, 3, 4].map(async (i) => (await rpc.getSigner(i)).getAddress()),
  );
});
test.beforeEach(async () => {
  // Isolate each test's allowance; approval is shared token state across requests.
  const token = new Contract(
    m.usdcAddress,
    tokenArtifact.abi,
    await rpc.getSigner(1),
  );
  await (await token.approve(m.splitLinkAddress, 0n)).wait();
});
async function wallet(context: BrowserContext, index = 0) {
  await context.addInitScript(
    ({ account }) => {
      const listeners: Record<string, Function[]> = {};
      const state = { account, chain: "0x7a69", reject: false, delay: 0 };
      (window as any).__localWallet = state;
      (window as any).ethereum = {
        request: async ({ method, params = [] }: any) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [state.account];
          if (method === "eth_chainId") return state.chain;
          if (method === "eth_sendTransaction" && state.reject)
            throw Object.assign(Error("LOCAL MOCK user rejected"), {
              code: 4001,
            });
          if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
          const response = await fetch("http://127.0.0.1:8545", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: Date.now(),
              method,
              params,
            }),
          });
          const body = await response.json();
          if (body.error)
            throw Object.assign(Error(body.error.message), body.error);
          return body.result;
        },
        on: (event: string, fn: Function) => (listeners[event] ??= []).push(fn),
        removeListener: (event: string, fn: Function) => {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
        },
      };
      (window as any).__changeLocalWallet = (
        account: string,
        chain?: string,
      ) => {
        state.account = account;
        if (chain) state.chain = chain;
        for (const e of ["accountsChanged", "chainChanged"])
          for (const fn of listeners[e] ?? []) fn();
      };
    },
    { account: addresses[index] },
  );
}
async function createOnChain(title = "Browser fixture") {
  const signer = await rpc.getSigner(0);
  const split = new Contract(m.splitLinkAddress, splitArtifact.abi, signer);
  const receipt = await (
    await split.createRequest(
      title,
      10001n,
      addresses.slice(2, 4),
      [5000, 5000],
    )
  ).wait();
  const event = receipt.logs
    .flatMap((l: any) => {
      try {
        return [split.interface.parseLog(l)];
      } catch {
        return [];
      }
    })
    .find((e: any) => e?.name === "RequestCreated");
  return event.args.requestId.toString();
}
const route = (id: string, page = "pay") =>
  `/${page}/31337/${m.splitLinkAddress}/${id}`;
async function sign(page: Page) {
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign reviewed transaction" }).click();
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toHaveCount(0, { timeout: 25000 });
}

test("LOCAL MOCK full production-browser flow: create → new context → approve → pay → public receipt → hard refresh", async ({
  browser,
}) => {
  const creator = await browser.newContext();
  await wallet(creator, 0);
  const page = await creator.newPage();
  await page.goto("/create");
  await page
    .getByLabel("Public title", { exact: true })
    .fill("Browser end-to-end");
  await page.getByLabel("Request amount", { exact: true }).fill("0.010001");
  for (let i = 1; i <= 2; i++) {
    await page.getByLabel(`Recipient ${i} address`).fill(addresses[i + 1]);
    await page.getByLabel(`Recipient ${i} percentage`).fill("50");
  }
  await page.getByRole("button", { name: "Review immutable request" }).click();
  await sign(page);
  await expect(
    page.getByText("Payment link created and verified"),
  ).toBeVisible();
  const href = await page.locator(".success a").getAttribute("href");
  expect(href).toContain("/pay/31337/");
  const payer = await browser.newContext();
  await wallet(payer, 1);
  const payment = await payer.newPage();
  await payment.goto(href!);
  await expect(
    payment.getByRole("heading", { name: "Browser end-to-end" }),
  ).toBeVisible();
  await payment.getByRole("checkbox", { name: /I understand future/ }).check();
  await payment.getByRole("button", { name: "Review USDC approval" }).click();
  await sign(payment);
  await expect(
    payment.getByRole("button", { name: "Review payment", exact: true }),
  ).toBeEnabled();
  await payment.reload();
  await expect(payment.getByText("approve · confirmed")).toBeVisible();
  await payment
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await sign(payment);
  await expect(payment.getByText("Your payment is complete.")).toBeVisible();
  await expect(
    payment.getByText("Verified settlement", { exact: true }),
  ).toBeVisible();
  const receipt = href!.replace("/pay/", "/receipt/");
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  await publicPage.goto(receipt);
  await expect(
    publicPage.getByText(`Paid by ${addresses[1]}.`, { exact: true }),
  ).toBeVisible();
  await publicPage.reload();
  await expect(
    publicPage.getByText("Verified settlement", { exact: true }),
  ).toBeVisible();
  expect(await publicPage.evaluate(() => localStorage.length)).toBe(0);
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({
    path: "outputs/browser-receipt-mobile.png",
    fullPage: true,
  });
  expect(
    await publicPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await publicContext.close();
  await payer.close();
  await creator.close();
});

test("percentages preserve edits, no stale preview, add/delete does not rebalance, up to five rows", async ({
  page,
}) => {
  await page.goto("/create");
  await page.getByLabel("Request amount", { exact: true }).fill("1");
  for (let i = 1; i <= 2; i++)
    await page.getByLabel(`Recipient ${i} percentage`).fill("50");
  await expect(page.locator(".preview .allocation")).toHaveCount(2);
  await page.getByRole("button", { name: "Add member" }).click();
  await expect(
    page.getByText("Total: 100.00% from valid entries — incomplete"),
  ).toBeVisible();
  await expect(page.locator(".preview .allocation")).toHaveCount(0);
  await expect(page.getByLabel("Recipient 1 percentage")).toHaveValue("50");
  await page.getByLabel("Recipient 3 percentage").fill("33.333");
  await expect(
    page.getByText("Use no more than 2 decimal places.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Recipient 3 percentage")).toHaveValue("33.333");
  await page.getByLabel("Remove recipient 3").click();
  await expect(page.locator(".preview .allocation")).toHaveCount(2);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Add member" }).click();
  await expect(page.getByRole("button", { name: "Add member" })).toBeDisabled();
  await expect(page.getByLabel("Recipient 1 percentage")).toHaveValue("50");
  await page.screenshot({
    path: "outputs/browser-create-desktop.png",
    fullPage: true,
  });
});

test("creator cancel with confirmation, no-signature return, fresh canonical status and public cancelled receipt", async ({
  browser,
}) => {
  const id = await createOnChain("Cancel browser");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  await page.goto(route(id));
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
  await expect(page.getByText("cancel · confirmed")).toBeVisible();
  await context.close();
});

test("wrong wallet chain disables signatures; public request remains readable; explicit rejection is journaled", async ({
  browser,
}) => {
  const id = await createOnChain("Reject browser");
  const context = await browser.newContext();
  await wallet(context, 1);
  const page = await context.newPage();
  await page.goto(route(id));
  await page.evaluate(() => {
    (window as any).__changeLocalWallet(
      (window as any).__localWallet.account,
      "0x1",
    );
  });
  await expect(page.getByText(/Switch to Local EVM/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review USDC approval" }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).__changeLocalWallet(
      (window as any).__localWallet.account,
      "0x7a69",
    );
    (window as any).__localWallet.reject = true;
  });
  await page.getByRole("checkbox", { name: /I understand future/ }).check();
  await page.getByRole("button", { name: "Review USDC approval" }).click();
  await sign(page);
  await expect(page.getByText("approve · rejected")).toBeVisible();
  await page.reload();
  await expect(page.getByText("approve · rejected")).toBeVisible();
  await context.close();
});

test("direct routes distinguish malformed, unsupported network/contract, missing request and RPC outage", async ({
  page,
}) => {
  await page.goto("/pay/nope");
  await expect(page.getByText("Malformed or unknown route.")).toBeVisible();
  await page.goto(`/pay/999/${m.splitLinkAddress}/1`);
  await expect(
    page.getByText("Unsupported network.", { exact: true }),
  ).toBeVisible();
  await page.goto("/pay/5042002/0x1111111111111111111111111111111111111111/1");
  await expect(page.getByText(/Unsupported contract/)).toBeVisible();
  await page.goto(route("999999999"));
  await expect(
    page.getByText("Request not found.", { exact: true }),
  ).toBeVisible();
  await page.route("http://127.0.0.1:8545", (r) => r.abort());
  await page.goto(route("1"));
  await expect(page.getByRole("heading", { name: /RPC error/ })).toBeVisible({
    timeout: 20000,
  });
});

test("Paid remains canonical when logs are unavailable; omit unverified explorer link", async ({
  page,
}) => {
  const id = await createOnChain("Paid no logs");
  const s = await rpc.getSigner(1);
  const token = new Contract(m.usdcAddress, tokenArtifact.abi, s);
  await (await token.approve(m.splitLinkAddress, 10001n)).wait();
  await (
    await new Contract(m.splitLinkAddress, splitArtifact.abi, s).payRequest(id)
  ).wait();
  await page.route("http://127.0.0.1:8545", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "eth_getLogs")
      await route.fulfill({
        json: {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32000, message: "logs unavailable" },
        },
      });
    else await route.continue();
  });
  await page.goto(route(id, "receipt"));
  await expect(
    page.getByText(`Paid by ${addresses[1]}.`, { exact: true }),
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
    page.getByRole("link", { name: "View transaction" }),
  ).toHaveCount(0);
});

test("same wallet another session and another wallet attribution never adopts a failed attempt hash", async ({
  browser,
}) => {
  const id = await createOnChain("Attribution browser");
  const signer = await rpc.getSigner(1),
    token = new Contract(m.usdcAddress, tokenArtifact.abi, signer);
  await (await token.approve(m.splitLinkAddress, 10001n)).wait();
  await (
    await new Contract(
      m.splitLinkAddress,
      splitArtifact.abi,
      signer,
    ).payRequest(id)
  ).wait();
  for (const index of [1, 0]) {
    // Mine a real reverted duplicate payment on the isolated local chain.
    const attemptSigner = await rpc.getSigner(index);
    const data = new Contract(
      m.splitLinkAddress,
      splitArtifact.abi,
    ).interface.encodeFunctionData("payRequest", [id]);
    let attemptHash = "";
    await rpc.send("evm_setAutomine", [false]);
    try {
      const tx = await attemptSigner.sendTransaction({
        to: m.splitLinkAddress,
        data,
        gasLimit: 200000n,
      });
      attemptHash = tx.hash;
      await rpc.send("evm_mine", []);
    } finally {
      await rpc.send("evm_setAutomine", [true]);
    }
    const receipt = await rpc.getTransactionReceipt(attemptHash);
    expect(receipt!.status).toBe(0);
    const context = await browser.newContext();
    await wallet(context, index);
    await context.addInitScript(
      ({ account, target, id, data, hash, block }) => {
        localStorage.setItem(
          "splitlink.transactions.v1",
          JSON.stringify([
            {
              schemaVersion: 1,
              recordId: crypto.randomUUID(),
              chainId: 31337,
              contractAddress: target,
              account,
              operationType: "pay",
              requestId: id,
              to: target,
              callData: data,
              value18: "0",
              intent: { requestId: id },
              txHash: hash,
              effectiveTxHash: hash,
              replacementHashes: [],
              nonce: null,
              submittedAtBlock: null,
              createdAtMs: Date.now(),
              updatedAtMs: Date.now(),
              txState: "reverted",
              businessVerification: "notChecked",
              receiptBlock: block,
              receiptStatus: "reverted",
              replacementKind: null,
              error: null,
            },
          ]),
        );
      },
      {
        account: addresses[index],
        target: m.splitLinkAddress,
        id,
        data,
        hash: attemptHash,
        block: receipt!.blockNumber.toString(),
      },
    );
    const page = await context.newPage();
    await page.goto(route(id));
    await expect(
      page.getByText(
        index === 1
          ? "This request was paid by your wallet."
          : `This request was paid by another wallet: ${addresses[1]}.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText("Your payment is complete.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("pay · reverted", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Attempt hash: ${attemptHash}`, { exact: true }),
    ).toBeVisible();
    await context.close();
  }
});

test("storage failure stays visible; no-hash interrupted signature restores unknown without automatic submission", async ({
  browser,
}) => {
  const id = await createOnChain("Storage browser");
  const context = await browser.newContext();
  await wallet(context, 1);
  await context.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw Error("LOCAL injected quota failure");
    };
  });
  const page = await context.newPage();
  await page.goto(route(id));
  await page.getByRole("checkbox", { name: /I understand future/ }).check();
  await page.getByRole("button", { name: "Review USDC approval" }).click();
  await sign(page);
  await expect(
    page.getByText(
      "Transaction recovery on this device is unavailable. Save the transaction hash.",
    ),
  ).toBeVisible();
  await context.close();
  const restore = await browser.newContext();
  await restore.addInitScript(
    ({ address, target }) => {
      localStorage.setItem(
        "splitlink.transactions.v1",
        JSON.stringify([
          {
            schemaVersion: 1,
            recordId: crypto.randomUUID(),
            chainId: 31337,
            contractAddress: target,
            account: address,
            operationType: "pay",
            requestId: "1",
            to: target,
            callData: "0x1234",
            value18: "0",
            intent: {},
            txHash: null,
            effectiveTxHash: null,
            replacementHashes: [],
            nonce: null,
            submittedAtBlock: null,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            txState: "awaitingSignature",
            businessVerification: "notChecked",
            receiptBlock: null,
            receiptStatus: null,
            replacementKind: null,
            error: null,
          },
        ]),
      );
    },
    { address: addresses[1], target: m.splitLinkAddress },
  );
  const restored = await restore.newPage();
  await restored.goto("/create");
  await expect(restored.getByText("pay · unknown")).toBeVisible();
  await expect(
    restored.getByText(
      "No transaction hash was saved. Check your wallet activity before trying again.",
      { exact: true },
    ),
  ).toBeVisible();
  await restore.close();
});

test("history reconstructs from chain after cache clear and account switch excludes old creator rows", async ({
  browser,
}) => {
  const id = await createOnChain("History reconstruction");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  await page.goto("/create");
  await expect(
    page.getByText("History reconstruction", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(
    page.getByText("History reconstruction", { exact: true }),
  ).toBeVisible();
  await page.evaluate(
    (account) => (window as any).__changeLocalWallet(account),
    addresses[4],
  );
  await expect(
    page.getByText("No requests found on this network.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("History reconstruction", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("history range shrink and one-block failure remain partial; Retry fills gap without discarding known rows", async ({
  browser,
}) => {
  await createOnChain("Range failure history");
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  let failGap = true;
  await page.route("http://127.0.0.1:8545", async (route) => {
    const body = route.request().postDataJSON();
    if (body.method === "eth_getLogs") {
      const query = body.params[0];
      const from = BigInt(query.fromBlock),
        to = BigInt(query.toBlock);
      if (
        to - from > 1n ||
        (failGap && from <= BigInt(m.deploymentBlock) + 1n)
      ) {
        await route.fulfill({
          json: {
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32000, message: "LOCAL injected range limit" },
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
    page.getByText("Range failure history", { exact: true }),
  ).toBeVisible();
  failGap = false;
  await page.getByRole("button", { name: "Refresh history" }).click();
  await expect(
    page.getByText("History complete.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Range failure history", { exact: true }),
  ).toHaveCount(1);
  await context.close();
});

test("slow RPC does not invent an empty request; cancellation race after review blocks signing", async ({
  browser,
}) => {
  const id = await createOnChain("Slow race browser");
  const context = await browser.newContext();
  await wallet(context, 1);
  const page = await context.newPage();
  await page.route("http://127.0.0.1:8545", async (route) => {
    await new Promise((r) => setTimeout(r, 150));
    await route.continue();
  });
  await page.goto(route(id));
  await expect(
    page.getByRole("heading", { name: "Slow race browser" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /I understand future/ }).check();
  await page.getByRole("button", { name: "Review USDC approval" }).click();
  await expect(
    page.getByRole("region", { name: "Transaction review" }),
  ).toBeVisible();
  const split = new Contract(
    m.splitLinkAddress,
    splitArtifact.abi,
    await rpc.getSigner(0),
  );
  await (await split.cancelRequest(id)).wait();
  await sign(page);
  await expect(
    page.getByText("This payment request was cancelled.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("approve · submitted", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("postreceipt interruption recovers all five operation types through actual application entry point; cached fake success stays unverified", async ({
  browser,
}) => {
  const contract = new Contract(
    m.splitLinkAddress,
    splitArtifact.abi,
    await rpc.getSigner(0),
  );
  const payerToken = new Contract(
    m.usdcAddress,
    tokenArtifact.abi,
    await rpc.getSigner(1),
  );
  const payerSplit = new Contract(
    m.splitLinkAddress,
    splitArtifact.abi,
    await rpc.getSigner(1),
  );
  const id = await createOnChain("Interrupted verification");
  const creationEvent = contract.interface.getEvent("RequestCreated")!;
  const logs = await rpc.getLogs({
    address: m.splitLinkAddress,
    fromBlock: Number(m.deploymentBlock),
    topics: [
      creationEvent.topicHash,
      `0x${BigInt(id).toString(16).padStart(64, "0")}`,
    ],
  });
  const createdReceipt = await rpc.getTransactionReceipt(
    logs[0].transactionHash,
  );
  const reset = await (await payerToken.approve(m.splitLinkAddress, 0n)).wait();
  const approval = await (
    await payerToken.approve(m.splitLinkAddress, 10001n)
  ).wait();
  const paid = await (await payerSplit.payRequest(id)).wait();
  const otherId = await createOnChain("Interrupted cancellation");
  const cancelled = await (await contract.cancelRequest(otherId)).wait();
  const records = [];
  for (const [op, receipt, requestId] of [
    ["create", createdReceipt, null],
    ["approveReset", reset, id],
    ["approve", approval, id],
    ["pay", paid, id],
    ["cancel", cancelled, otherId],
  ] as const) {
    const tx = await rpc.getTransaction(receipt!.hash);
    const intent =
      op === "create"
        ? {
            title: "Interrupted verification",
            totalAmount: "10001",
            recipients: addresses.slice(2, 4),
            sharesBps: ["5000", "5000"],
          }
        : op.startsWith("approve")
          ? {
              spender: m.splitLinkAddress,
              amount: op === "approveReset" ? "0" : "10001",
            }
          : { requestId };
    records.push({
      schemaVersion: 1,
      recordId: crypto.randomUUID(),
      chainId: 31337,
      contractAddress: m.splitLinkAddress,
      account: tx!.from,
      operationType: op,
      requestId,
      to: tx!.to,
      callData: tx!.data,
      value18: "0",
      intent,
      txHash: tx!.hash,
      effectiveTxHash: tx!.hash,
      replacementHashes: [],
      nonce: tx!.nonce.toString(),
      submittedAtBlock: null,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      txState: "confirmed",
      businessVerification: "pending",
      receiptBlock: receipt!.blockNumber.toString(),
      receiptStatus: "success",
      replacementKind: null,
      error: null,
    });
  }
  const forged = {
    ...records[0],
    recordId: crypto.randomUUID(),
    requestId: "999999998",
    businessVerification: "verified",
    intent: { ...records[0].intent, title: "Falsified cached terms" },
  };
  const noHash = {
    ...forged,
    recordId: crypto.randomUUID(),
    requestId: "999999997",
    txHash: null,
    effectiveTxHash: null,
  };
  const context = await browser.newContext();
  await wallet(context, 0);
  await context.addInitScript(
    (records) => {
      // Seed only the initial visit; subsequent hard refresh uses real persisted recovery.
      if (!localStorage.getItem("fixture-seeded")) {
        localStorage.setItem("fixture-seeded", "true");
        localStorage.setItem(
          "splitlink.transactions.v1",
          JSON.stringify(records),
        );
      }
    },
    [...records, forged, noHash],
  );
  const page = await context.newPage();
  let signatures = 0;
  await page.route("http://127.0.0.1:8545", async (r) => {
    if (r.request().postDataJSON().method === "eth_sendTransaction")
      signatures++;
    await r.continue();
  });
  await page.goto("/create");
  await page.getByRole("button", { name: "Reconcile", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rows = JSON.parse(
          localStorage.getItem("splitlink.transactions.v1") ?? "[]",
        );
        return rows.filter((r: any) => r.businessVerification === "verified")
          .length;
      }),
    )
    .toBe(5);
  await expect(
    page.getByRole("link", {
      name: `Open verified created request #${id}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: /Open verified created request #999999998/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: /Open verified created request #999999997/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Creation terms mismatch.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("link", {
      name: `Open verified created request #${id}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(signatures).toBe(0);
  await context.close();
});

test("history keeps automatic polling after wallet-only chain switch and back", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext();
  await wallet(context, 0);
  const page = await context.newPage();
  await page.goto("/create");
  await expect(
    page.getByText("History complete.", { exact: true }),
  ).toBeVisible();
  for (const [chain, title] of [
    ["0x1", "Auto history while wallet elsewhere"],
    ["0x7a69", "Auto history after return"],
  ]) {
    await page.evaluate((chain) => {
      (window as any).__changeLocalWallet(
        (window as any).__localWallet.account,
        chain,
      );
    }, chain);
    await expect(
      page.getByText("History complete.", { exact: true }),
    ).toBeVisible();
    await createOnChain(title);
    // No click or account/deployment change: exercise the actual 15-second timer.
    await expect(page.getByText(title, { exact: true })).toBeVisible({
      timeout: 22000,
    });
  }
  await context.close();
});

test("production browser can read real Arc chain IDs through CORS, without wallet or writes", async ({
  page,
}) => {
  test.skip(
    process.env.RUN_ARC_READONLY !== "true",
    "External RPC probe is opt-in; local CI does not certify Arc integration.",
  );
  await page.goto("/create");
  const result = await page.evaluate(async () => {
    return Promise.all(
      ["https://rpc.testnet.arc.io", "https://rpc.mainnet.arc.io"].map(
        async (rpc) => {
          try {
            const response = await fetch(rpc, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_chainId",
                params: [],
              }),
              signal: AbortSignal.timeout(10000),
            });
            return { rpc, result: await response.json() };
          } catch (e) {
            return { rpc, error: String(e) };
          }
        },
      ),
    );
  });
  fs.writeFileSync(
    "outputs/arc-browser-cors.json",
    JSON.stringify(
      {
        environment:
          "real public read-only RPC, local production browser Origin http://127.0.0.1:4173; actual host pending",
        checkedAt: new Date().toISOString(),
        result,
      },
      null,
      2,
    ),
  );
  // This is a capability observation, not an assumption that network access succeeds.
  expect(result).toHaveLength(2);
  for (const entry of result) {
    if ("result" in entry)
      expect(Number(BigInt(entry.result.result))).toBe(
        entry.rpc.includes("testnet") ? 5042002 : 5042,
      );
    else throw Error(`Arc browser read failed: ${entry.error}`);
  }
});
