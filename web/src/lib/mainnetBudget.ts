import { decodeFunctionData, erc20Abi, parseAbiItem, type PublicClient, type Address, type Hex } from "viem";
import type { NetworkManifest } from "./manifest";
import { SPLITLINK_ABI } from "./splitlink";
import type { OperationType } from "./preflight";
export const MAINNET_FEE_CAP_18 = 10000000000000000n;
export const PROJECT_WALLET = "0x50df19631d9410ecee43850e21e46322114ee483";
export const PROJECT_GROSS_6 = 10001n;
const DEPLOY_FEE_18 = 34922950000000000n;
const equal=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const funded=(m:NetworkManifest,a:string)=>m.environment==="arc-mainnet"&&equal(a,PROJECT_WALLET);
// A finite, globally non-reusable nonce sequence bounds spend across browsers,
// cleared storage and later incoming funds. No balance delta resets this allowance.
export function assertMainnetBudget(m:NetworkManifest,account:string,operation:OperationType,principal6:bigint,fee18:bigint,nonce:number,createAmount6?:bigint) {
  if(m.environment!=="arc-mainnet")return;
  if(fee18<0n||fee18>MAINNET_FEE_CAP_18)throw Error("本次 gas 超过 0.01 USDC 硬上限。");
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
  const hashes=new Set<Hex>();
  const created=parseAbiItem("event RequestCreated(uint256 indexed requestId,address indexed creator,uint256 totalAmount)");
  const approval=parseAbiItem("event Approval(address indexed owner,address indexed spender,uint256 value)");
  for(let from=m.deploymentBlock;from<=head;from+=2000n){
    const to=from+1999n<head?from+1999n:head;
    const logs=await c.getLogs({address:m.contractAddress as Address,event:created,args:{creator:account},fromBlock:from,toBlock:to,strict:true});
    for(const l of logs)if(l.transactionHash)hashes.add(l.transactionHash);
    if(nonce===3){
      const approvals=await c.getLogs({address:m.usdcAddress as Address,event:approval,args:{owner:account,spender:m.contractAddress as Address},fromBlock:from,toBlock:to,strict:true});
      for(const l of approvals)if(l.transactionHash)hashes.add(l.transactionHash);
    }
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
