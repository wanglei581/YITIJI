# Wave 1 账户安全执行计划（基于已批准方案的修订）

1. 先运行 shared/API 认证基线与现有 auth、QR verify；任何基线失败先诊断，不写实现。
2. 为 shared 状态/action 字面量、双 schema 与双轨 guard 写 RED verify；schema marker 用正则/空白归一化。
3. 添加双数据库 additive status migration，fresh SQLite/PG 重放后使状态 verify 绿；保留并双写 `enabled`。
4. 先扩展 `verify-member-auth`，覆盖 session owner、跨会员隔离、index TTL 不缩短和整户撤销；再用 Lua 实现 Redis session index。
5. 让强认证、可选认证、登录/登出、QR claim 全部遵循 `enabled && status==='active'`；`resolveOptionalEndUser` 必传 Prisma，逐一只做 controller 注入/透传。
6. 写 step-up RED：SMS challenge、HMAC code、5 次失败作废、user+action grant、原子单次消费、短信失败 cleanup、状态拒绝、并发消费。
7. 实现 DTO/service/HTTP 端点与 Redis grant 原语；只复用现有 SMS sender 与 secret，不新增明文日志或新密钥。
8. 将两个 verify 接到 SQLite 与 PostgreSQL CI，跑双数据库 migration、API lint/typecheck/build；Claude 与 Antigravity 对 diff 进行最终安全复审。

每步保持独立提交。只有上述验证通过后才更新进度文档、创建 PR；不合并、不部署，除非另获授权。
