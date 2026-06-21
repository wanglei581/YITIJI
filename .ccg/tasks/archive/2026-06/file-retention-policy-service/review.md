# 文件保存期限服务与清理门禁审查结果

## 验证结果

- PASS: `pnpm --filter @ai-job-print/api verify:file-retention`
- PASS: `pnpm --filter @ai-job-print/api exec prisma validate --schema=prisma/schema.prisma`
- PASS: `pnpm --filter @ai-job-print/api exec prisma validate --schema=prisma/postgres/schema.prisma`
- PASS: `pnpm --filter @ai-job-print/api db:pg:sync:check`
- PASS: `pnpm --filter @ai-job-print/api typecheck`
- PASS: `pnpm --filter @ai-job-print/shared typecheck`
- PASS: `pnpm --filter @ai-job-print/admin typecheck`
- PASS: `pnpm --filter @ai-job-print/kiosk typecheck`
- PASS: 最小 SQLite 手动迁移验证，`FileObject.expiresAt` 迁移后允许 `NULL`

## 未完成的外部/环境验证

- `verify:member-assets` 未完成：本地运行缺少 `DATABASE_URL`；使用临时 SQLite 时 Prisma schema-engine 返回 `undefined`。
- `verify:member-assets-c2d` 未完成：本地运行缺少 `TERMINAL_ADMIN_SECRET`，且同样依赖本地 Redis/Prisma 环境。
- 以上为本地环境门禁问题，不是本任务新增断言失败；本分支用 `verify:file-retention` 和最小 SQLite 迁移验证覆盖了新增留存策略风险。

## 双模型审查结论

### 首轮全量审查

- Antigravity: APPROVE，无 Critical / Warning；Info 建议补 DTO 注释并明确 90/180 天口径。
- Claude: 无 Critical；Warning:
  - `consentVersion` 不应只校验非空。
  - 会员原始简历默认 90 天是隐私留存姿态变更，需要产品/合规确认。

### 修复后复审

- 已新增 `CURRENT_RETENTION_CONSENT_VERSION = 'file-retention-v1'`，`months_6` / `long_term` 必须传入当前版本，否则返回 `RETENTION_CONSENT_INVALID`。
- 已补 `verify:file-retention` 的非法版本断言。
- Claude: APPROVE，无 Critical / Warning。
- Antigravity: APPROVE，无 Critical / Warning。

## 当前落地决策

- 原始文件 `original`：首批只允许 `months_3` / `months_6`，不开放 `long_term`。
- 成果物 `optimized` / `derived`：允许 `months_3` / `months_6` / `long_term`。
- 证件 `id_scan`、匿名文件、系统文件、机构素材：保持 `system_short`，不能被拉长到账号保存期。
- `long_term` 使用 `expiresAt = null` 表示；`cleanupExpired` 不清理 null。
- 会员文档列表显式包含 `expiresAt = null` 的长期文件；AI 结果表的 `expiresAt = null` 历史语义保持“已过期”，不改。
- `PATCH /files/:id/retention` 仅会员本人可调用，后台用户不能代改。
