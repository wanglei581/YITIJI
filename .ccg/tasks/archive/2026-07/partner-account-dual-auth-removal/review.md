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

## 实施终审（2026-07-18）

### 审查覆盖

- 独立代码审查代理：正确性、Nest 路由/DI、UI 状态机与回归。
- 独立安全审查代理：授权绑定、Redis 原子语义、并发密码尝试、OTP、票据、手机号唯一竞态、会话版本与审计脱敏。
- Claude 聚焦终审：action/rebind/Redis/删除可信绑定四个核心文件。
- Antigravity 最终调用已执行，但本机账号/资格状态未返回有效报告，不能计为最终批准；设计阶段已有有效 Antigravity APPROVE。

### 已关闭问题

- 当前密码验证兼容历史短管理员密码；新密码强度仍由改密/重置入口控制。
- Admin 重置 Partner 密码后立即刷新 `availableActionVerificationMethods`。
- 非法 `challengeId` 不再产生 500，统一按挑战不可用 fail closed。
- 密码校验改为 bcrypt 前 Redis Lua 原子预约；12 个并发请求最多 5 个进入 bcrypt，第五个预约重新获得完整 300 秒锁定 TTL。
- 补齐 Admin 验证失败、action ticket 消费失败、删除提交锁冲突和换绑 start/resend/verify/commit 的分类审计；专项门禁证明不包含密码、手机号、验证码或 ticket。
- Claude 提出的“禁用 Partner 可换绑”未采纳为缺陷：本功能明确服务于暂时停用但仍保留的机构账号，账号在重新启用前仍无法登录；删除同样必须支持停用账号。所有换绑仍要求旧因子、新手机号和双版本绑定。

### 最终结论

- 代码审查代理：`APPROVE`。
- 安全审查代理：`APPROVE`。
- Claude：无 Critical；有效 Warning 已修复或按上述产品语义有据取舍。
- Antigravity：最终实现报告不可用，未虚报批准。
- 剩余发布边界：应用层未记录敏感自定义 Header，但生产网关/APM 的 Header 脱敏仍须在部署验收中确认；本任务未授权 push、生产 migration、真实短信或部署。
