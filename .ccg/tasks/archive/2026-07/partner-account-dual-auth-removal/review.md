# 双模型设计审查统一结论

## 审查对象

- 设计规格：`docs/superpowers/specs/2026-07-18-partner-account-dual-auth-removal-design.md`
- 最终语义版本：`da1f3d51`
- 审查模型：Claude、Antigravity

## 第一轮

两边均要求修改，主要问题包括 Redis challenge/ticket 命名和状态、Admin 近期验证、票据消费与提交锁、跨 purpose OTP 限流、legacy 账号可用性、rebind TTL/重发、路由和错误语义、双库并发及生产 migration 协调。

## 第二轮

- Antigravity：`APPROVE`，无 Critical；提出 rebind ticket 显式绑定 Admin、active 指针强校验和多管理员冲突提示。
- Claude：`REQUEST_CHANGES`，无 Critical；提出 Lua 返回可信绑定字段、提交锁冲突错误、换绑最终唯一性复核、失败审计、UI 超时回退和 Lua 测试。

所有 Warning 均已写入 `da1f3d51`。

## 最终复审

- Claude：`APPROVE`，Critical 0，Warning 0。
- Antigravity：`APPROVE`，Critical 0，Warning 0。
- 双方确认上一轮问题全部关闭，核心方案可进入实施计划阶段。

## 统一取舍

- 保留 `legacy | temporary | owner_managed` 三态密码证明，不能简化为布尔值。
- 不采纳超级管理员绕过或 Admin 重置密码后直接删除；双因子均不可用时进入本任务外的线下恢复流程。
- 删除采用目标本人授权票据、机构级提交锁和 PostgreSQL Serializable 三层保护。
- 实施前仍需用户确认最终书面规格；本次审查不授权业务代码或生产发布。

## 实施终审（2026-07-18 至 2026-07-19）

### 审查覆盖

- 独立代码审查代理：正确性、Nest 路由/DI、UI 状态机、认证旁路与回归。
- 独立安全审查代理：授权绑定、Redis 原子语义、OTP/票据、密码证明来源、手机号唯一性、TOCTOU、会话隔离与审计脱敏。
- Claude 在核心实现较早一轮复审无 Critical，当时 Warning 已修复；2026-07-19 最终差异复审因 CLI 账户状态失败，没有生成新的有效报告。
- Antigravity 实施阶段较早一轮有效复审为 `APPROVE`；2026-07-19 最终差异复审因 CLI 登录/资格状态失败，没有生成新的有效报告。

### 已关闭问题

- 当前密码验证兼容历史短管理员密码；新密码强度仍由改密/重置入口控制。
- Admin 重置 Partner 密码后立即刷新 `availableActionVerificationMethods`。
- 非法 `challengeId` 不再产生 500，统一按挑战不可用 fail closed。
- 密码校验改为 bcrypt 前 Redis Lua 原子预约；12 个并发请求最多 5 个进入 bcrypt，第五个预约重新获得完整 300 秒锁定 TTL。
- 补齐 Admin 验证失败、action ticket 消费失败、删除提交锁冲突和换绑 start/resend/verify/commit 的分类审计；专项门禁证明不包含密码、手机号、验证码或 ticket。
- Claude 提出的“禁用 Partner 可换绑”未采纳为缺陷：本功能明确服务于暂时停用但仍保留的机构账号，账号在重新启用前仍无法登录；删除同样必须支持停用账号。所有换绑仍要求旧因子、新手机号和双版本绑定。
- 修复 Admin 重置目标密码后，Partner 用临时密码自助改密升级 `owner_managed` 的旁路；Partner 自助改密现在保留 `legacy/temporary`，只有已验证手机找回才建立新持有人证明。
- 修复 Admin 预录未验证手机号的旁路：旧 `/auth/phone/code` 与 `/auth/phone/verify` 均拒绝非 `owner_managed` Partner，最终写入同时 CAS `phoneEnc/passwordProofState/tokenVersion`。
- 首次绑号最终写入增加 `passwordProofState + tokenVersion` CAS，确定性竞态测试在“验证通过后、写入前”注入 Admin reset，必须返回 `PHONE_BIND_CONFLICT` 且不写手机号。
- 新内部 JWT 带随机 `jti`，Admin 近期高风险验证以 Bearer SHA-256 指纹分区；同秒多次登录不共享，`/auth/me` 不回显服务端 `sessionId`。
- 前端修复忙碌期到期中断、方式切换竞态、新手机 OTP 错误步骤、短信发送失败恢复与 busy `alertdialog` 焦点承接；18 项状态机测试已接入 CI，行/分支/函数覆盖率门禁分别为 97%/80%/100%。

### 最终结论

- 代码审查代理：`APPROVE`，Critical 0，Warning 0。
- 安全审查代理：最终文档收口复核后 `APPROVE`，Critical 0，Warning 0。
- 外部模型：保留历史有效报告；2026-07-19 最终差异的 Claude/Antigravity CLI 均未产生有效报告，不虚报批准。
- 验证：API/Admin typecheck、lint、build，18 项前端状态机及覆盖率门禁，内部认证/改密/OTP/SQLite 动作流，真实 Redis Lua，PostgreSQL 全新空库 34 个 migration + 并发删除/换绑，以及双库 schema 同步均通过。
- 剩余发布边界：应用层未记录敏感自定义 Header，但生产网关/APM 的 Header 脱敏仍须在部署验收中确认；本任务已获用户授权 push/PR/CI，仍未授权 merge、生产 migration、真实短信或部署。
