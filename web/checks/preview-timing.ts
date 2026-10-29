import { mainnet, publicClientFor } from "../src/lib/manifest";
import { approvalIntent, prepareOperation } from "../src/lib/runner";
const originalFetch=globalThis.fetch;let requests=0,rpcMethods=0;
globalThis.fetch=async(input,init)=>{
  requests++;
  const body=JSON.parse(String(init?.body??"{}"));rpcMethods+=Array.isArray(body)?body.length:1;
  return originalFetch(input,init);
};
const started=performance.now();
const r=await prepareOperation(mainnet,"0x50df19631d9410ECee43850E21E46322114ee483",approvalIntent(mainnet,1n,10001n),publicClientFor(mainnet) as any);
console.log(JSON.stringify({mode:"PUBLIC_READONLY_APPROVE_PREVIEW_TIMING",at:new Date().toISOString(),durationMs:Math.round(performance.now()-started),httpRequests:requests,rpcMethods,nonce:r.quote.nonce,feeBudget18:r.quote.feeBudget18.toString(),quoteRemainingMs:30000-(Date.now()-r.quote.quotedAt),signed:false,broadcast:false},null,2));
