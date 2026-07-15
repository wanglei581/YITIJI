# 复审与验证结论

## 范围

- 保留 main 的 Partner 通用首次绑定后端；Admin 通用路径按 Guard 注入的 JWT role 分流至严格服务。
- Admin 页面只使用 `AdminInitialPhoneBindingCard`，不修改或导入既有 `PhoneBindingCard`。
- 未修改 Prisma schema / migration、生产 / 共享预生产、Redis、密钥、支付、终端或打印链路。

## 本地验证

- `INTERNAL_AUTH_VERIFY_TARGET=isolated pnpm --filter @ai-job-print/api verify:internal-auth-phone`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/api lint`
- `pnpm --filter @ai-job-print/admin verify:admin-account-settings-ui`
- `pnpm --filter @ai-job-print/admin typecheck`
- `pnpm --filter @ai-job-print/admin lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build`
- `git diff --check origin/main...HEAD`

上述命令均已在本候选的干净 worktree 通过。API verifier 只创建并清理 OS 临时目录下的 SQLite fixture；Admin verifier 用隔离 VM、Map localStorage 和 stub fetch 验证真实 adapter，不访问网络、浏览器真实存储或数据库。

## 发现与处理

1. 首轮正确性复审发现验证响应丢失后仅刷新无法恢复真实绑定状态，以及非空字符串响应 guard 会接受明文手机号。已改为不确定验证结果清临时状态并重新登录；adapter 以 UUID、0–300 安全整数、合法掩码和 canonical ISO 严格验证，并增加 VM 行为级 RED → GREEN 测试。
2. 二轮正确性 / 安全复审发现 500 JSON 错误码会覆盖 `HTTP_5xx` 字符串、JWT `AUTH_TOKEN_INVALID` 未清 ticket。strict adapter 现保留 HTTP status；验证对 0 / 401 / 403 / 5xx、非法响应及会话失效重登，发码对 0 / 5xx / 非法响应保守冷却。对应 mock 500 RED → GREEN 已加入 verifier。
3. 三轮正确性与安全复审均为 APPROVE，未发现 Critical / Warning。

## 未完成的外部门禁

- 未取得可审计的外部 Antigravity + Claude final review；本机 wrapper 没有产生有效终审报告，不能把启动日志或空输出计作批准。
- 未 push、未创建 PR、未跑 GitHub CI、未部署、未发送真实短信、未做受控浏览器真实登录或生产验收。
