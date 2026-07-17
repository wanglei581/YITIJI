# 用户中心 Wave 1-A 账户安全底座追加安全加固

## 真实闭环与范围

- 上游基线：`main@0c4cdd57`，即 Wave 0 PR #261 合并结果。
- 权威计划：`docs/superpowers/plans/2026-07-16-user-center-wave1-account-security.md`。
- 本分支只交付后端账户状态、会员会话整户撤销、5 分钟单次 step-up 和窄化注销回执 Guard。
- 不修改 Kiosk/Admin 页面，不开放数据导出或账号注销入口，不实现不可逆注销执行器。

## 文件预算

只允许修改权威计划“0. 文件预算与边界”列出的 runtime、verify、CI 和进度文件；任何新增文件必须先证明无法复用并更新本任务记录。

## 安全不变量

- `enabled=false` 或 `status!=active` 均拒绝普通登录和本人访问。
- session/grant 的整户撤销必须原子执行，不能影响其他会员。
- step-up grant 绑定 `endUserId + action`、短 TTL、单次消费；数据库、日志和 Redis 不保存明文验证码、手机号或 token。
- `MemberClosureReceiptGuard` 只暴露 JWT `sub`，不恢复普通会员权限。
- 所有行为按 RED→GREEN 实施，最终 SQLite/PostgreSQL、auth/QR 回归和双模型安全审查均须通过。
