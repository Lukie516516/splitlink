import { test } from 'node:test';
import assert from 'node:assert/strict';
const expect=(v:any)=>({toBe:(x:any)=>assert.equal(v,x),toEqual:(x:any)=>assert.deepEqual(v,x),toBeGreaterThan:(x:number)=>assert.ok(v>x),rejects:{toEqual:async(x:any)=>{try{await v;assert.fail('expected rejection')}catch(e){assert.deepEqual(e,x)}}}});
import { reviewedTestnetIdentity, operationAllowed, type NetworkManifest } from '../src/lib/manifest';
import { checkFunding, isQuoteStale, freshQuoteFitsReview, type PreflightQuote } from '../src/lib/preflight';
import { JournalStore } from '../src/lib/journal';
import { ensureArcTestnet } from '../src/lib/walletNetwork';
const m: NetworkManifest = {chainId:5042002,chainName:'Arc Testnet',contractAddress:'0xAb0FD4065973d1E6043057D8E5DdAda9E5C16010',deploymentBlock:69317284n,usdcAddress:'0x3600000000000000000000000000000000000000',explorerBase:'https://explorer.testnet.arc.io',contractVersion:'1.0.0',isDeployed:true,hasDeploymentBlock:true,expectedBytecodeHash:'0x36f70577a74e10b3f6036c0804f751545226f529d51a7425657c0696236d3e9b',rpcUrl:'https://rpc.testnet.arc.io',environment:'arc-testnet',sharedBalance:true,runtimeVerified:false,reviewedDeployment:'arc-testnet-20261027'};
test('only exact reviewed deployment enables supported operations, without full acceptance',()=>{expect(reviewedTestnetIdentity(m)).toBe(true);for(const op of ['create','approve','pay'])expect(operationAllowed(m,op)).toBe(true);for(const op of ['cancel','approveReset'])expect(operationAllowed(m,op)).toBe(false);expect(operationAllowed({...m,chainId:5042},'pay')).toBe(false);expect(operationAllowed({...m,expectedBytecodeHash:'0x'+'0'.repeat(64)},'pay')).toBe(false);});
test('expired and future quotes stop',()=>{expect(isQuoteStale({quotedAt:Date.now()-30000} as PreflightQuote)).toBe(true);expect(isQuoteStale({quotedAt:Date.now()+60000} as PreflightQuote)).toBe(true);});
test('gross principal, fee and reserve use one shared balance',()=>{expect(checkFunding({operation:'pay',principal6:10001n,feeBudget18:5000000000000000n,balance6:10001n,nativeBalance18:10001000000000000n,sharedBalance:true}).ok).toBe(false);});
test('storage read/write failure remains fail closed',()=>{const s=new JournalStore({getItem(){throw Error('denied');},setItem(){throw Error('denied');}});expect(s.warning.length).toBeGreaterThan(0);s.refreshFromStorage();expect(s.warning.length).toBeGreaterThan(0);});
test('switch rejection does not add a chain or request signatures',async()=>{const calls:string[]=[];await expect(ensureArcTestnet({request:async({method}:any)=>{calls.push(method);if(method==='eth_chainId')return '0x1';throw {code:4001};}} as any)).rejects.toEqual({code:4001});expect(calls).toEqual(['eth_chainId','wallet_switchEthereumChain']);});

import { recoverOperation, requestIntent } from '../src/lib/runner';
import { type TransactionRecord, STORAGE_KEY } from '../src/lib/journal';
import { keccak256 } from 'viem';
const account='0x50df19631d9410ECee43850E21E46322114ee483';
const record=(id:string):TransactionRecord=>({schemaVersion:1,recordId:id,chainId:5042002,contractAddress:m.contractAddress,account,operationType:'pay',requestId:'1',to:m.contractAddress,callData:requestIntent(m,'pay',1n,10001n).data,value18:'0',intent:{principal6:'10001'},txHash:null,effectiveTxHash:null,replacementHashes:[],nonce:'4',submittedAtBlock:'1',createdAtMs:1,updatedAtMs:1,txState:'unknown',businessVerification:'notChecked',receiptBlock:null,receiptStatus:null,replacementKind:null,error:null});
test('background recovery refreshes inside shared lock and preserves another tab intent',async()=>{
 let raw='[]',writes=0,busy=false;const names:string[]=[];
 const storage={getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v;writes++}};
 const a=new JournalStore(storage);a.put(record('old'));const b=new JournalStore(storage);b.put(record('new'));
 Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(name:string,_opts:any,fn:any)=>{names.push(name);return fn(busy?null:{name})}}});
 const before=raw;busy=true;await recoverOperation(a,a.records[0],m,{} as any);assert.equal(raw,before);
 busy=false;await recoverOperation(a,a.records[0],m,{} as any);
 const saved=JSON.parse(raw);assert.deepEqual(saved.map((r:any)=>r.recordId).sort(),['new','old']);assert.equal(saved.find((r:any)=>r.recordId==='new').txState,'unknown');assert.ok(names.every(n=>n==='splitlink-journal-write:v1'));assert.ok(writes>0);
});
test('returned transaction with different nonce cannot replace frozen intent nonce or become verified',async()=>{
 let raw='[]';const store=new JournalStore({getItem:()=>raw,setItem:(_k:string,v:string)=>{raw=v}});
 const local={...m,chainId:31338,environment:'local-mock',rpcUrl:'http://127.0.0.1:9547',sharedBalance:false,deploymentBlock:1n,expectedBytecodeHash:keccak256('0x6000')} as NetworkManifest;
 const r={...record('mismatch'),chainId:31338,txHash:('0x'+'a'.repeat(64)),effectiveTxHash:('0x'+'a'.repeat(64))};store.put(r);
 const blockHash='0x'+'b'.repeat(64);let businessReads=0;
 const rpc={getChainId:async()=>31338,getCode:async({blockNumber}:any)=>blockNumber===0n?'0x':'0x6000',getBlockNumber:async()=>2n,readContract:async({functionName}:any)=>{if(functionName==='decimals')return 6;if(functionName==='USDC')return local.usdcAddress;if(functionName==='CONTRACT_VERSION')return '1.0.0';businessReads++;throw Error('must not reach business reads')},getTransactionReceipt:async()=>({transactionHash:r.txHash,to:r.to,from:r.account,blockNumber:2n,blockHash,status:'success'}),getTransaction:async()=>({to:r.to,from:r.account,input:r.callData,value:0n,nonce:5,blockNumber:2n,blockHash}),getBlock:async()=>({hash:blockHash})};
 await recoverOperation(store,r,local,rpc as any);
 assert.equal(store.records[0].nonce,'4');assert.equal(store.records[0].txState,'unknown');assert.equal(store.records[0].businessVerification,'unavailable');assert.equal(businessReads,0);
});

test('fee changes inside reviewed envelope do not require a higher authorization',()=>{
 const reviewed={nonce:2,gasLimit:120n,maxFeePerGas18:120n,priorityFee18:2n} as PreflightQuote;
 const fresh={nonce:2,estimatedGas:110n,gasLimit:132n,requiredMaxFeePerGas18:110n,maxFeePerGas18:132n,priorityFee18:2n} as PreflightQuote;
 assert.equal(freshQuoteFitsReview(reviewed,fresh),true);
 for(const changed of [{estimatedGas:121n},{requiredMaxFeePerGas18:121n},{priorityFee18:3n},{nonce:3}])assert.equal(freshQuoteFitsReview(reviewed,{...fresh,...changed}),false);
});
