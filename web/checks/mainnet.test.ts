import { test } from "node:test";
import assert from "node:assert/strict";
import { mainnet, getManifest, parseRoute, operationAllowed, reviewedMainnetIdentity, verifyManifestOnChain } from "../src/lib/manifest";
import { assertMainnetFeeCap, MAINNET_FEE_CAP_18 } from "../src/lib/mainnetBudget";
import { ensureArcNetwork } from "../src/lib/walletNetwork";
import { userMessage } from "../src/lib/messages";
test("mainnet default binds reviewed chain, deployment and runtime; old links remain testnet", () => {
  assert.equal(getManifest().chainId, 5042);
  assert.equal(reviewedMainnetIdentity(mainnet), true);
  assert.equal(operationAllowed(mainnet, "pay"), true);
  assert.equal(mainnet.runtimeVerified, false);
  assert.equal(operationAllowed(mainnet, "approveReset"), false);
  for (const changed of [{chainId:5042002}, {deploymentBlock:69317284n}, {rpcUrl:"https://rpc.testnet.arc.io"}, {expectedBytecodeHash:"0x"+"0".repeat(64)}]) assert.equal(operationAllowed({...mainnet,...changed}, "pay"), false);
  assert.equal(parseRoute("5042002", mainnet.contractAddress,"1").m.environment,"arc-testnet");
  assert.equal(parseRoute("5042", mainnet.contractAddress,"1").m.environment,"arc-mainnet");
});
test("mainnet network setup uses chain5042, canonical RPC, no signing methods", async()=> {
  let chain="0x1";const calls:any[]=[];
  await ensureArcNetwork({request:async(p:any)=>{calls.push(p);if(p.method==="eth_chainId")return chain;if(p.method==="wallet_switchEthereumChain"){if(calls.filter(c=>c.method==="wallet_switchEthereumChain").length===1)throw {code:4902};chain=p.params[0].chainId;}}} as any,mainnet);
  const added=calls.find(c=>c.method==="wallet_addEthereumChain").params[0];
  assert.equal(added.chainId,"0x13b2");assert.deepEqual(added.rpcUrls,["https://rpc.mainnet.arc.io"]);
  assert.ok(calls.every(c=>! /sign|sendTransaction/.test(c.method)));
});
test("wrong chain fails closed before deployment/business reads",async()=> {
  const r=await verifyManifestOnChain({getChainId:async()=>5042002} as any,mainnet);
  assert.equal(r.allPassed,false);assert.match(r.failureReason!,/chain ID mismatch/);
});


test("mainnet fees are bounded without any wallet, amount or fixed nonce restriction",()=>{
  assertMainnetFeeCap(mainnet,10241535600000000n);
  assertMainnetFeeCap(mainnet,MAINNET_FEE_CAP_18);
  assert.throws(()=>assertMainnetFeeCap(mainnet,MAINNET_FEE_CAP_18+1n),/0.02/);
  assert.throws(()=>assertMainnetFeeCap(mainnet,-1n));
});
test("pending and changed quote nonce give distinct recovery instructions",()=>{
  assert.match(userMessage(Error("The wallet has a pending transaction. Wait or recover status first.")),/still pending/);
  assert.match(userMessage(Error("The wallet nonce changed. Preview again.")),/Refresh the quote/);
});
