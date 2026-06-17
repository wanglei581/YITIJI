# P0 生产与 CI 门禁补强审查记录

日期：2026-06-17

## 范围

- 生产运行时门禁：`JWT_SECRET`、`FILE_STORAGE_DRIVER`、`DATABASE_URL`
- 7 个历史 JWT 弱 fallback 模块统一切到 `JwtVerifierModule`
- 主 CI 增补智慧校园 / 合作机构 / 招聘会关键 verify
- 部署检查清单与进度文档同步

## 本地验证

- `pnpm --filter @ai-job-print/api verify:production-runtime-gates`：通过
- `pnpm --filter @ai-job-print/api verify:production-db-guard`：通过
- `pnpm --filter @ai-job-print/api build`：通过
- `pnpm --filter @ai-job-print/api typecheck`：通过
- `pnpm --filter @ai-job-print/api lint`：通过
- `pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui`：通过
- `pnpm --filter @ai-job-print/kiosk verify:jobfair-ui`：通过
- `git diff --check`：通过
- `services/api/src` 中弱 JWT fallback 扫描：0 命中

## 双模型审查

- Claude reviewer：Critical = 0，Approve；条件是合并前确认 CI 跑绿新增 DB verify。
- Antigravity reviewer：Critical = 0，Approve。

## 保留风险

本机 `npx prisma db push --accept-data-loss` 报 `Schema engine error:` 空错误，发生在测试库创建阶段。因此以下新增 CI 项必须以 CI 或可正常 `db push` 的环境作为最终通过证据：

- `pnpm --filter @ai-job-print/api verify:partner-smart-campus`
- `pnpm --filter @ai-job-print/api verify:partner-edit`

`verify-public-fair-demo-guard.ts` 对应功能尚未在 main，待 campus-recruitment 功能进入 main 后再接入 CI。

## 结论

本地代码门禁、构建、类型、lint、Kiosk 闭环验证均已通过。可本地提交；合并主干前必须等待 CI 真实跑绿。
