# 管理员与合作机构账号手机号安全转移

## 背景

当前内部账号使用全局唯一的 `User.phoneHash`。同一手机号已经属于合作机构账号时，管理员严格首次绑定会安全拒绝。用户只有一个手机号，同时需要保留合作机构账号继续使用，因此不能删除机构账号、复制手机号或弱化唯一约束。

## 目标

- 已登录且尚未绑定手机号的 Admin 可以在验证当前密码和短信验证码后，将该手机号从一个 Partner 账号原子转移到自己名下。
- Partner 账号、用户名、密码、机构归属和历史业务关系全部保留，转移后仍可用用户名和密码登录。
- Partner 的手机号、短信登录和短信找回能力被清除，旧会话立即趋于失效；Admin 可继续通过既有入口重置 Partner 密码。
- 全程保留手机号全局唯一约束，写入必要且脱敏的审计记录。

## 安全不变量

- 只允许来源账号 `role=partner`；禁止转移另一 Admin 或其他角色的手机号。
- 必须同时具备有效 Admin 会话、正确 Admin 当前密码和发送到目标手机号的正确 OTP。
- 清空 Partner 手机号与绑定 Admin 必须处于同一个数据库事务中，并按“先清 Partner、后绑 Admin”的顺序执行。
- 事务内递增 Partner `tokenVersion`，事务提交后清理其会话缓存；缓存清理失败不得回滚已提交的数据库真值，但必须记录脱敏告警。
- Ticket 必须绑定 Admin、Partner、双方 tokenVersion、phoneHash 和加密手机号，并受 TTL、单活动 ticket、验证锁和 CAS 约束。
- 响应、日志和审计不得包含手机号明文、`phoneHash`、`phoneEnc`、密码、OTP 或 ticket 内容。

## 允许范围

- 后端：`services/api/src/auth/` 内新增独立转移服务、controller/module 接线、必要 DTO 或审计类型；新增独立 verifier。
- Admin：既有“账号设置”页面内增加转移分支、独立组件和 API 适配；不新增页面或导航入口。
- 文档：正式设计、实施计划、当前进度和下一步任务。
- CI：只接入本功能的确定性静态/隔离 verifier。

## 明确不做

- 不修改 Prisma schema、手机号唯一约束、生产数据库或环境变量。
- 不删除 Partner 账号或机构业务数据，不改变 Partner 的用户名和密码。
- 不修改、复制或依赖未合并的 Partner 账号安全删除候选分支。
- 不迁移到多角色账户模型，不处理 Admin↔Admin 或 EndUser 手机号转移。
- 不部署、不发真实短信、不执行真实转移，除非代码、CI、双模型终审全部通过且用户另行明确授权。

## 验收

- TDD 覆盖正常转移、事务回滚、唯一约束顺序、并发竞争、陈旧 ticket、非 Partner 拒绝、OTP 重试、Partner 会话失效、Admin 会话保持、审计脱敏和 Partner 用户名密码登录兜底。
- API/Admin typecheck、lint、build、专项 verifier、`git diff --check` 全部通过。
- Antigravity 与 Claude 双模型终审必须有真实报告；当前 Antigravity 配额阻塞不得伪装为通过。
