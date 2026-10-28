import { test } from "node:test";
import assert from "node:assert/strict";
import { mainnet, getManifest, parseRoute, operationAllowed, reviewedMainnetIdentity, verifyManifestOnChain } from "../src/lib/manifest";
import { assertMainnetBudget, verifyProjectHistory, PROJECT_WALLET, MAINNET_FEE_CAP_18 } from "../src/lib/mainnetBudget";
import { ensureArcNetwork } from "../src/lib/walletNetwork";
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
test("finite project nonces and amount cannot be replenished by incoming funds", () => {
  assertMainnetBudget(mainnet,PROJECT_WALLET,"create",0n,MAINNET_FEE_CAP_18,1,10001n);
  assertMainnetBudget(mainnet,PROJECT_WALLET,"approve",10001n,MAINNET_FEE_CAP_18,2);
  assertMainnetBudget(mainnet,PROJECT_WALLET,"pay",10001n,MAINNET_FEE_CAP_18,3);
  assert.throws(()=>assertMainnetBudget(mainnet,PROJECT_WALLET,"pay",10001n,MAINNET_FEE_CAP_18+1n,3));
  assert.throws(()=>assertMainnetBudget(mainnet,PROJECT_WALLET,"pay",300000n,MAINNET_FEE_CAP_18,3)); // MW1: incoming cannot authorize0.3 gross
  for(const nonce of [0,4,5,100])assert.throws(()=>assertMainnetBudget(mainnet,PROJECT_WALLET,"pay",10001n,1n,nonce));
  assert.throws(()=>assertMainnetBudget(mainnet,PROJECT_WALLET,"create",0n,1n,2,10001n));
  assert.throws(()=>assertMainnetBudget(mainnet,PROJECT_WALLET,"create",0n,1n,1,300000n));
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

test("missing prior nonce cannot advance finite project budget",async()=>{
  await assert.rejects(verifyProjectHistory(mainnet,PROJECT_WALLET as any,2,{getLogs:async()=>[]} as any,mainnet.deploymentBlock),/missing|nonce|\u7f3a\u5c11/);
});

import { encodeFunctionData } from "viem";
import { SPLITLINK_ABI } from "../src/lib/splitlink";
test("prior canonical fees are counted; reverted, unrelated, and fee-overridden transactions stop",async()=>{
 const hash=("0x"+"a".repeat(64)) as any, bh=("0x"+"b".repeat(64)) as any;
 const input=encodeFunctionData({abi:SPLITLINK_ABI,functionName:"createRequest",args:["demo",10001n,[PROJECT_WALLET as any,"0xF76635258fF551Dc2224ee7434B5b88dF3c93497"],[5000,5000]]});
 const tx={from:PROJECT_WALLET,to:mainnet.contractAddress,nonce:1,value:0n,blockNumber:mainnet.deploymentBlock+1n,blockHash:bh,input,gas:300000n,maxFeePerGas:20000000000n};
 const receipt={from:PROJECT_WALLET,status:"success",blockNumber:tx.blockNumber,blockHash:bh,gasUsed:200000n,effectiveGasPrice:20000000000n};
 const rpc=(t:any=tx,r:any=receipt)=>({getLogs:async()=>[{transactionHash:hash}],getTransaction:async()=>t,getTransactionReceipt:async()=>r,getBlock:async()=>({hash:bh})}) as any;
 await verifyProjectHistory(mainnet,PROJECT_WALLET as any,2,rpc(),tx.blockNumber);
 await assert.rejects(verifyProjectHistory(mainnet,PROJECT_WALLET as any,2,rpc({...tx,maxFeePerGas:100000000000n}),tx.blockNumber));
 await assert.rejects(verifyProjectHistory(mainnet,PROJECT_WALLET as any,2,rpc(tx,{...receipt,status:"reverted"}),tx.blockNumber));
 await assert.rejects(verifyProjectHistory(mainnet,PROJECT_WALLET as any,2,rpc({...tx,to:PROJECT_WALLET}),tx.blockNumber));
});
