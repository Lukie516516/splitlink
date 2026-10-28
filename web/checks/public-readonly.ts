import { mainnet, publicClientFor, verifyManifestOnChain } from "../src/lib/manifest";
const c=publicClientFor(mainnet);
const result=await verifyManifestOnChain(c as any,mainnet);
if(!result.allPassed)throw Error(result.failureReason);
const account="0x50df19631d9410ECee43850E21E46322114ee483" as const;
const [balance,nonce,block]=await Promise.all([c.getBalance({address:account,blockTag:"latest"}),c.getTransactionCount({address:account,blockTag:"pending"}),c.getBlockNumber({cacheTime:0})]);
console.log(JSON.stringify({at:new Date().toISOString(),mode:"public-readonly",chainId:5042,verification:result,block:block.toString(),wallet:account,balance18:balance.toString(),pendingNonce:nonce,signedOrBroadcast:false},null,2));
