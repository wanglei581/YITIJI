# Admin 手机号转移密码证明状态门禁

## 真实阻塞

当前 `AdminPhoneTransferService.start` 只校验当前密码哈希，不检查 `passwordProofState`；因此管理员被运营重置出的 `temporary` 密码理论上可直接启动高风险手机号转移，与既定人工门禁不一致。

## 文件预算

允许修改：

- `services/api/src/auth/admin-phone-transfer.service.ts`
- `services/api/scripts/verify-admin-phone-transfer.ts`
- `services/api/scripts/support/admin-phone-transfer-security-cases.ts`
- 必要时专项 verifier runner / `package.json`（只有现有入口无法覆盖时）
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

禁止修改：

- Controller 路由、DTO、API 响应形状
- Prisma schema / migration / 真实预生产数据
- 短信发送、OTP、手机号转移事务语义
- Admin / Partner UI、Kiosk、Terminal Agent
- 旧秒哒目录

## 验收标准

1. `passwordProofState=owner_managed` 且当前密码正确时保持原成功路径。
2. `temporary`、`legacy` 或未知状态即使密码正确，也在创建 Redis ticket、发送短信、写 start 审计之前统一失败。
3. 对外继续使用既有不可枚举错误，不暴露具体失败原因。
4. 现有错误密码、并发、OTP、事务、会话和审计回归全部通过。

## 分析结论

- 仅在 `start` 的当前密码校验成功后检查 `passwordProofState`，避免改变错误密码限流与不可枚举语义。
- 门禁必须早于手机号归属读取、Redis ticket、短信和启动审计。
- `verify` 不重复检查密码证明状态，避免管理员在已签发 ticket 后修改密码时误伤完成流程。
