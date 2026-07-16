# Wave 1 账户安全：执行前收敛

## 真实闭环与范围

本任务只建立后端账户安全底座：`EndUser` additive 状态、会员会话整户撤销、绑定会员与动作的短时单次 step-up。它是 Wave 1 数据导出、注销和运营处理的前置，不向 Kiosk/Admin 开放任何新入口，也不执行导出或注销。

允许层：`packages/shared` 契约、`services/api` schema/migration、认证/Redis/Guard、静态与动态 verify、CI 与进度文档。

明确不涉及：`apps/kiosk`、`apps/admin`、`services/worker`、`member-privacy` 业务执行器、支付/退款/权益、Terminal Agent、招聘/投递闭环、生产部署与密钥。

## 已批准设计与必须前置修正

既有批准计划：`docs/superpowers/plans/2026-07-16-user-center-wave1-account-security.md`。

本轮双模型分析确认可实施，但必须优先落实：

1. Redis 会话 Lua 必须验证 session owner，并且用户 session index 的 TTL 只能延长、不能被短会话缩短；整户撤销只能删除同一会员拥有的会话。
2. 账户状态 verify 以空白归一化/正则检查 schema，不能依赖 Prisma 对齐空格。
3. `resolveOptionalEndUser` 的 `PrismaService` 形参必须必填，让 TypeScript 暴露全部调用点；各 controller 只允许增加注入与参数透传，禁止改业务分支。
4. 当前 Redis 是单实例；Lua key 不宣称 Redis Cluster 可用。切换 Cluster 前必须另行设计同 hash slot 的 key 布局。
5. 发布瞬间已有的旧 Redis session 没有 user index，只会在现有 30 分钟 TTL 内自然到期；此边界必须记录，不能把新索引误称为历史会话全量撤销。

## 验收门禁

- `enabled=false` 或 `status!=active` 的会员无法登录、无法通过强/可选认证；QR 确认与 claim 间状态变化不签发 session。
- 多会话整户撤销不影响其他会员，会话所有权冲突不删除他人 session，index TTL 不缩短。
- step-up 不存明文验证码、grant 或手机号；grant 仅能被同一会员、同一 action 原子消费一次。
- SQLite 与 PostgreSQL migration、verify 都通过；没有 schema 破坏性变更、没有生产部署声明。
