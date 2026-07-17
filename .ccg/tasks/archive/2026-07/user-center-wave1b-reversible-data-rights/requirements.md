# 用户中心 Wave 1-B 可逆数据权利闭环

## 真实功能闭环

在不触发账户不可逆注销的前提下，把既有“导出我的数据”占位请求升级为可审计、可重试、可过期、一次性领取的真实异步闭环，并继续对 `delete` 请求保持严格 fail-closed。

## 本次范围

- `export`：step-up 授权、幂等创建、会员级高风险请求互斥、BullMQ 异步生成、白名单数据包、24 小时内私有短期文件、一次性下载租约、`finish/close` 补偿、过期与清理对账。
- `revoke_consent`：保留兼容入口，把撤回同请求记录和安全审计收敛到同一事务。
- `delete`：在消费 step-up、写 `UserDataRequest`、修改 `EndUser` 之前返回 `ACCOUNT_CLOSURE_NOT_AVAILABLE`；不注册、不入队、不执行任何注销作业。
- Admin：只允许对 export 的失败请求 retry、对 pending/failed export reject；禁止直接写 ready/completed/expired/failed，禁止以 Admin 操作绕开状态机。
- HTTP：接入 export 创建/查询、下载授权和公开一次性内容领取端点；不新增 Kiosk 页面或首页入口。

## 不在范围

- 账户关闭、匿名化、手机号墓碑、金融/法务保留处置、注销回执。
- Kiosk/Web 下载页 UI、Admin 新页面、任何新功能入口。
- 部署、生产数据迁移执行、密钥修改、第三方资源变更。

## 安全与合规不变量

1. `UserDataRequest` 是状态真相；Redis 只保存短时 capability/claim，BullMQ 只负责调度。
2. export/delete 共用 `${endUserId}:privacy-exclusive` 唯一 `activeKey`；本次 delete 不产生记录，因此只能与历史 active delete 冲突。
3. 幂等重放必须先返回旧记录，不再次消费 step-up；跨用户或跨类型复用同一幂等键必须拒绝。不同幂等键的同会员并发创建必须由会员级锁串行，在确定 activeKey 独占权之前不得消费 grant。
4. Redis/BullMQ 不可用时 export fail closed；禁止 inline fallback。
5. 导出只包含明确白名单字段；不得包含密码摘要、token、验证码、内部审计 payload、对象 storage key、模型密钥或其他用户数据。
6. 导出文件必须是 `member_data_export + highly_sensitive + private + system_short`，过期时间不超过 24 小时。
7. 对象存储写成功而数据库写失败时必须补偿物理删除；对象删除成功后才允许账本进入 completed/expired 并释放 `activeKey`。
8. 下载 ticket 只通过 header 传递；ticket 本身只在 Redis 保存摘要/绑定信息，领取使用短时单次 claim。
9. HTTP `finish` 之前请求保持 ready；`close` 先发生只释放 claim 并保留对象；`finish` 后清理失败保留 activeKey 并进入可重试失败态。
10. 所有关键状态变更使用 CAS/事务并写 required audit；审计失败时关键事务整体失败。
11. 任何日志、审计 payload、错误响应都不得包含 step-up token、download ticket、claim secret、手机号、文件内容或 storage key。
12. worker 崩在 handling 后必须能按 `lastAttemptAt` 租约恢复；陈旧 pending/handling 不得永久占用 activeKey。
13. 旧 `me/data-requests` controller 必须收敛为唯一入口，旧 service 不得保留绕过新状态机的创建/处理方法。

## 验收门禁

- SQLite 与 PostgreSQL schema 同步检查通过。
- 新增 RED 验证先失败，实施后 GREEN。
- `verify:member-data-request-truth`、`verify:member-step-up`、`verify:file-retention`、`verify:member-account-status` 保持通过。
- API typecheck/build/lint 与相关 integration verify 通过。
- 双模型分析和双模型安全复审完成；Critical/High 问题清零。
