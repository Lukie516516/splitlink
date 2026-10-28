# Mainnet web R2：MW-1 聚焦独立复审

**PASS：MW-1 已关闭，仅限 A 的一次有限项目演示流程及此前通过范围。** 无新增阻断项，不代表发布或实际主网create/approve/pay完成。

43源文件聚合SHA256：`7340dfd6c9e59d5050a0ce58b4cd2795d93598980f5c384379a24eaba0e1ebf4`。
排序[{path,sha256}]紧凑JSON独立重算；43文件及8份开发evidence哈希匹配，审查前后本候选及原68296915均未改。改动仅mainnetBudget、runner、CreatePage、Review、mainnetchecks及report；精确路径见JSON。主网manifest/network/journal/accepted CSS未变，复用前轮已通过项，不重复旧链上清单或publicverifier。

MW-1修复不再用初始额减余额当累计花费。A在chain5042仅nonce1=create总额10001、nonce2=approve总额10001、nonce3=pay总额10001，每笔value0、最大gas预算<=0.01真实USDC。入账、退款、跨副本或清storage不会增加已用链上nonce，nonce0/4及后续、错操作或大额本金均拒绝。这是一次固定演示流程，非可续充钱包预算。

进入nonce2/3之前，以公开RequestCreated/Approval日志定位前序交易，检查实际sender/target/nonce/value/calldata金额，成功规范receipt与包含块，以及tx.gas×maxFee和actualfee均<=0.01。缺失/失败/无关/进位无法跳过，要求另行核对。实际部署费0.03492295+三笔最大费用0.03+完整gross0.010001=**0.07492395USDC**，低于项目1USDC。

独立frozen/offline/ignore-scripts安装、TypeScript noEmit和Vite生产构建通过；13项focusedsynthetic全部通过。额外4组最小独立补测通过：正常create/approve/pay及完整前序两笔body/receipt/fees可用；前序nonce2的最大/实际fee覆盖、revert或无关target均阻塞pay；旧MW-1的0.3本金和nonce4/5/999均拒绝，不存在余额/storage输入可刷新预算；最坏合计金额独立计算匹配。没有做真实钱包或新链上交易。

runner将freshquote frozen nonce和create金额送入policy，在预览和提交时检查；publichistory发生在锁内freshprepare流程，前序事实按canonicalreceipt核对。UI说明项目钱包仅本轮一次，提供unsigned A/B50/50填表，不自动签名。其他钱包保留自有资金确认流程，不能据此使用A资助授权。

此前通过的主网identity/runtime/route-specificwallet/真实USDC提示、无伪mainnetRequest1、全局journal锁与锁内storage刷新、frozennonce、TTL/context、unknown不重试、gross共享资金和有序事件证明保持。runtimeVerified仍false，完整场景/归因不由operationAllowed冒称完成。

限制：nonce序列只约束本app对A发出的许可请求，不能阻止本人在外部钱包另行签任意交易或在弹窗改费；前序费用被override会被后续历史核对拒绝，不能许诺钱包外全账户总支出永远受app控制。失败/无关nonce推进后需单独再授权，不能自动续跑。已交钱包的弹窗超TTL仍无法撤回，现文案要求拒绝过期弹窗。

本轮0publicRPC、0钱包请求/签名广播、0secret/Keychain/helper/keystore或真实journal访问；只临时syntheticfixture与源码检查。前轮独立liveappidentity结果因相关模块未改而复用，不冒称本轮新链上读取。Workbrowser禁用，仍无新browserQA；无Site重试/发布、法律条款接受、真实主网请求/授权/付款、hosting/video/资格或提交完成声明。未重跑旧全套或在线audit。

完整source/candidate及独立evidencehash、实际补测和限制：`outputs/mainnet-web-r2-independent-review.json`；独立日志与反例：`outputs/mainnet-web-r2-independent-evidence/`。
