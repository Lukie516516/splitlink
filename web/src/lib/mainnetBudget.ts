import { decodeFunctionData, erc20Abi, type PublicClient, type Address, type Hex, formatUnits } from "viem";
import type { NetworkManifest } from "./manifest";
import { SPLITLINK_ABI } from "./splitlink";
import type { OperationType } from "./preflight";
import { journal } from "./journal";
export const MAINNET_FEE_CAP_18 = 20000000000000000n;
export const PROJECT_WALLET = "0x50df19631d9410ecee43850e21e46322114ee483";
export const PROJECT_GROSS_6 = 10001n;
const DEPLOY_FEE_18 = 34922950000000000n;
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const funded=(m:NetworkManifest,a:string)=>m.environment==="arc-mainnet"&&equal(a,PROJECT_WALLET);
// A finite, globally non-reusable nonce sequence bounds spend across browsers,
// cleared storage and later incoming funds. No balance delta resets this allowance.
export function assertMainnetBudget(m:NetworkManifest,account:string,operation:OperationType,principal6:bigint,fee18:bigint,nonce:number,createAmount6?:bigint) {
  if(m.environment!=="arc-mainnet")return;
  if(fee18<0n||fee18>MAINNET_FEE_CAP_18)throw Error(`本次最高 gas 预算 ${formatUnits(fee18, 18)} USDC，超过单笔 0.02 USDC 上限。尚未请求钱包签名或发送交易；请稍后重新预览。`);
  if(!funded(m,account))return;
  if(!Number.isInteger(nonce)||({1:"create",2:"approve",3:"pay"} as Record<number,string>)[nonce]!==operation)
    throw Error("项目钱包仅开放 nonce1 创建、nonce2 授权、nonce3 付款；其他活动或后续使用需另行核对预算。");
  if(operation==="create"?createAmount6!==PROJECT_GROSS_6:principal6!==PROJECT_GROSS_6)
    throw Error("项目钱包本轮仅开放总额 0.010001 USDC 的一次分账。");
}
// Prior successful operation bodies and actual fees are reconciled from public
// canonical receipts. Missing/reverted/unrelated nonces block the finite sequence.
export async function verifyProjectHistory(m:NetworkManifest,account:Address,nonce:number,c:PublicClient,head:bigint) {
  if(!funded(m,account)||nonce===1)return;
  const required=nonce-1;
  if(required<1||required>2)throw Error("项目 nonce 超出已审有限预算序列。");
  // Public hash is only a locator. The body, nonce, canonical receipt and fee
  // are revalidated below on every preflight; no cached success grants writes.
  const hashes=new Set<Hex>(["0xebaff31c93112144f540ba85ff3ec344db1de3c5fa761087c7f1eeb848441bbc"]);
  if(required===2){
    const local=journal().records.filter(r=>r.chainId===m.chainId&&equal(r.account,account)&&equal(r.contractAddress,m.contractAddress)&&r.nonce==="2");
    const candidates=local.map(r=>r.effectiveTxHash??r.txHash).filter((h):h is Hex=>!!h&&/^0x[0-9a-fA-F]{64}$/.test(h));
    if(candidates.length)for(const h of candidates)hashes.add(h);
    else hashes.add(await locateNonceTransaction(c,account,2,m.deploymentBlock,head));
  }
  const seen=new Set<number>();let spent=DEPLOY_FEE_18;
  for(const hash of hashes){
    const tx=await c.getTransaction({hash});
    if(!equal(tx.from,account)||tx.nonce<1||tx.nonce>required)continue;
    if(seen.has(tx.nonce)||tx.value!==0n||tx.blockNumber===null)throw Error("项目历史交易无法唯一核对。");
    const receipt=await c.getTransactionReceipt({hash});
    const block=await c.getBlock({blockNumber:receipt.blockNumber});
    if(receipt.status!=="success"||receipt.blockHash!==block.hash||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||!equal(receipt.from,account))throw Error("项目历史收据不匹配规范区块。");
    const maxPrice=tx.maxFeePerGas??tx.gasPrice;
    if(maxPrice==null||tx.gas*maxPrice>MAINNET_FEE_CAP_18||receipt.gasUsed*receipt.effectiveGasPrice>MAINNET_FEE_CAP_18)throw Error("历史费用超过已审单笔预算，停止后续操作。");
    if(tx.nonce===1){
      const d=decodeFunctionData({abi:SPLITLINK_ABI,data:tx.input});
      if(!tx.to||!equal(tx.to,m.contractAddress)||d.functionName!=="createRequest"||(d.args as readonly unknown[])[1]!==PROJECT_GROSS_6)throw Error("nonce1 不是本轮固定金额创建。");
    }else{
      const d=decodeFunctionData({abi:erc20Abi,data:tx.input});
      if(!tx.to||!equal(tx.to,m.usdcAddress)||d.functionName!=="approve"||!equal(String(d.args![0]),m.contractAddress)||d.args![1]!==PROJECT_GROSS_6)throw Error("nonce2 不是本轮准确总额授权。");
    }
    seen.add(tx.nonce);spent+=receipt.gasUsed*receipt.effectiveGasPrice;
  }
  if(seen.size!==required)throw Error("缺少前一步规范收据；未知、失败或外部活动需核对，不能重置预算继续。");
  // Deployment + actual prior fees + remaining worst-case fees + full gross.
  const maxRemaining=spent+BigInt(4-nonce)*MAINNET_FEE_CAP_18+PROJECT_GROSS_6*1000000000000n;
  if(maxRemaining>1000000000000000000n)throw Error("累计实际花费与剩余预留超过项目 1 USDC 上限。");
}

// At most logarithmic historical nonce reads, instead of one getLogs request
// per 2,000 blocks for every preview. A new browser can recover without storage.
export async function locateNonceTransaction(c:PublicClient,account:Address,nonce:number,start:bigint,head:bigint):Promise<Hex>{
  if(await c.getTransactionCount({address:account,blockNumber:head})<=nonce)throw Error("缺少前一步已上链交易，停止后续操作。");
  let lo=start,hi=head;
  while(lo<hi){
    const mid=(lo+hi)/2n;
    if(await c.getTransactionCount({address:account,blockNumber:mid})>nonce)hi=mid;
    else lo=mid+1n;
  }
  const block=await c.getBlock({blockNumber:lo,includeTransactions:true});
  const matches=block.transactions.filter(tx=>typeof tx!=="string"&&equal(tx.from,account)&&tx.nonce===nonce);
  if(matches.length!==1||typeof matches[0]==="string")throw Error("无法唯一定位前一步交易，停止后续操作。");
  return matches[0].hash;
}
