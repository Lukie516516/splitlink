# Web final R2：聚焦独立复审

**PASS：两个上一轮合成反例已关闭，无新增阻断项。** 仅覆盖网页R2修复及此前testnet能力范围，不代表已发布、实际钱包操作或新浏览器QA通过。

精确39源文件聚合SHA256：
`0f5766cf5a16eba4114f05c54a8c08b60dd7d7f69716b8c524a00e3de4a0c280`。
按排序[{path,sha256}]紧凑JSON独立重算；39文件和7份开发evidence逐项核对。审查前后本候选及原fc6f0e23候选哈希均不变。改动范围为runner、TransactionActivity、focused checks及report，其他交易/UI模块未变（精确列表见JSON）。上一轮没有完成的formal PASS，本结论仅引用其已保留反例。

WF-1关闭：submit和全部实际background recover共用origin-wide `splitlink-journal-write:v1` WebLock，不再按wallet拆锁，避免全数组storage跨钱包覆盖。锁内refreshFromStorage，再按recordId找当前对象；恢复旧对象不能覆盖新记录。submit内最终recoverUnlocked沿用已有锁，避免nested deadlock。unused dismiss mutation已删除。静态检索实际store.put/patch调用路径确认均在上述锁中。

WF-2关闭：两处actual tx.nonce覆写已移除，签名前reviewed nonce保持固定。nonce缺失或实际不匹配时unknown/unavailable，不进入business verified。原7项检查实际覆盖nonce5与frozen4不匹配且业务读取0。

独立临时副本frozen/offline/ignore-scripts安装、TypeScript noEmit及Vite生产构建通过（仅chunk体积advisory）；7项针对性检查全通过。额外3项最小补测通过：真实recoverOperation锁内重载当前nonce=null，不采用旧对象nonce4，另一钱包新意图保留；不同wallet提交和background recover确用同一全局锁，锁不可用时provider和storage写入0；代码中actual nonce覆盖消失且内部恢复不嵌套申请锁。

原能力范围未扩大：仅精确已审Arc Testnet部署create/准确approve/pay，reset/cancel/mainnet关闭；identity与fresh检查、钱包账户/链/nonce/calldata/TTL上下文、完整gross+fee+reserve共享余额、unknown仅恢复不重复提交、有序付款事件与canonical收据证明保持。runtimeVerified=false仍表示完整场景验收未完成，operationAllowed不冒称full canonical。已认可蓝白UI无大改。

本轮按要求只做聚焦synthetic检查，无实际钱包请求、签名、广播、secret/helper/Keychain或真实journal操作，无发布、无publicRPC，也未重复旧完整链上测试。原报告记录CUA被Work设置禁用；本轮未做新浏览器QA，不能声称通过。发布账号阻塞不属于本源码PASS的解决范围。

限制：全局锁会保守地让其他钱包/标签等待正在进行的钱包弹窗或receipt流程；这是当前安全取舍。已交给钱包的弹窗超过30秒，网页无法强制撤销，仍需本人拒绝过期弹窗，现文案明确。删除全部浏览器数据、其他设备/应用签名不受本机锁保护。synthetic lock测试不能代替实际多标签/扩展钱包交互验收。收据证明不代替完整gross消费/whole-block余额归因；真实付款、完整canonical场景、HTTPS发布、主网和赛事提交均不在本结论范围。

完整source/evidence哈希、实际补测及限制：`outputs/web-final-r2-independent-review.json`；独立日志和补测源码：`outputs/web-final-r2-independent-evidence/`。
