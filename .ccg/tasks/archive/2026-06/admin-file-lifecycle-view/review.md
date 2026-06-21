# Admin 文件生命周期运营视图审查记录

## 范围

- 复用 Admin `/files` 入口展示文件生命周期运营视图。
- 新增 `GET /files/lifecycle-summary` 全库只读统计，不受列表 `limit=200` 截断。
- 展示 `retentionPolicy`、`retentionSetBy`、`retentionConsentAt`、长期保存数量、7/30 天内到期和待清理数量。
- 管理员无保存期限修改入口；文件查看仍走短期签名 URL 和后端审计。

## 双模型审查

- 方案审查：Claude + Antigravity 均确认复用 `/files`，不新增重复入口；Claude 建议新增只读聚合端点避免统计受 `limit=200` 截断，已采纳。
- 首轮代码审查：无 Critical；发现 `retentionConsentAt` 空值错误显示“长期保存”、`Date.now()` 破坏 `useMemo`、生命周期统计未在 DB 层过滤软删除，均已修复并加入防回退验证。
- 复审：Claude PASS；Antigravity 发现 COS 绝对签名 URL 被拼接 API origin 的生产问题，已修复并加入防回退验证。
- 最终复审：Claude + Antigravity 均 PASS / APPROVE，无 Critical / Warning。

## 验证

- `pnpm --filter @ai-job-print/api verify:file-lifecycle-summary`
- `pnpm --filter @ai-job-print/api verify:file-retention`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/shared typecheck`
- `pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui`
- `pnpm --filter @ai-job-print/admin typecheck`
- `pnpm --filter @ai-job-print/admin lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/admin build`
- `git diff --check`

## 剩余事项

- 后续另起分支处理 COS 生命周期策略与隐私文案验收。
- 后续生产/试运营验收需在 PostgreSQL + COS + 会员账号上跑上传、设置保存期限、重登查看、删除、过期清理和审计查询全链路。
