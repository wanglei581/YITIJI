# 用户中心 Wave 1-A 追加安全加固终审

归档日期：2026-07-17

## 结论

- 本地候选首次在 `bbdd4176` 整合主线，并在终审期间继续无冲突整合 `origin/main@30d168ce`。
- Antigravity：`Gemini 3.5 Flash (High)`，`APPROVE`，Critical 0 / Warning 0。
- Claude：`APPROVE`，Critical 0；2 项非阻塞交付条件已转为正式任务门禁。
- 合并冲突只读复核：初始 15 个冲突（4 add/add + 11 content）均已解决；未回退 release provenance、Admin 手机转移、会员打印订单和 governed job-fit 主线修复。

## 已关闭的风险

1. Redis challenge 使用单 Lua 原子状态机；缺失、错类型、无 TTL、持久化或已耗尽状态均 fail closed。
2. session/grant owner 索引、TTL 单调、整户撤销与跨用户隔离由 Lua 和并发验证锁定。
3. provider 投递结果不确定时只清除 challenge secret，保留有界 cooldown/rate reservation。
4. grant 使用 32-byte opaque token，仅保存 hash，绑定 user/action/device/statusChangedAt，原子单次消费且拒绝 hash 碰撞覆盖。
5. 会员 JWT 最终签发在 session 注册后重新检查账户状态，异常或状态变化时清理 session 并 fail closed。
6. step-up HTTP 不再自行解析原始 `X-Forwarded-For`，响应使用 `Cache-Control: no-store`；注销回执 guard 仅验 JWT 并暴露 `sub`，不恢复普通会员权限。

## 非阻塞交付条件

- 生产反代必须按实际 nginx 层级显式配置 Express `trust proxy` 可信跳数并验证 `req.ip`；不得使用无边界的 `trust proxy=true`。本轮不在未知生产拓扑下修改全局代理配置。
- Wave 1-B 的每次账户状态迁移必须与 `statusChangedAt` 更新处于同一数据库事务，才能让状态纪元防御在真实写路径成立。

## 验证证据

- SQLite：全新数据库重放 59 条正式 migration；账户状态、step-up、member-auth、QR 登录、Partner tombstone/并发移除/机构管理、内部手机号认证与 Admin 手机转移均通过。
- PostgreSQL 16.14：全新数据库重放 31 条正式 migration；账户状态、step-up、member-auth、QR 登录、会员打印订单、governed job-fit、Partner 机构管理/并发移除与 Admin 手机转移均通过；测试数据库和角色已删除。
- 静态与构建：shared/API/Admin typecheck，shared/API/Admin lint，API/Admin build，PostgreSQL schema sync 均通过。
- 主线回归：release provenance、Admin 手机转移 UI 与 Partner 账号移除 UI 验证均通过。
- 隔离清理：专用 Redis DB 从 0 开始并在验证后清空；未连接生产 Redis/PostgreSQL，未发送真实短信。
- 依赖审计：`pnpm audit --prod --audit-level=critical` 退出 0，无 critical；报告 2 high / 6 moderate，均为未在本分支修改的仓库依赖基线。
- 范围检查：`git diff --check` 与 staged diff check 均通过；相对 `origin/main` 只有预期账户安全、验证与进度/任务文件。

## 外部动作边界

未 push、未创建 PR、未合并远端、未部署、未修改生产配置或数据。后续远程交付须另行获得用户授权。
