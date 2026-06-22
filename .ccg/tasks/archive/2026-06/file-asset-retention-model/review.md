# 文件资产留存模型 Branch 1 双模型方案审查

> 日期：2026-06-21
> 分支：`codex/file-asset-retention-model`
> 范围：数据库 schema、迁移、共享类型、后端文件类型基础字段。

## 只读分析结论

### Claude

结论：可实施，无 Critical。

Warning：

- 本分支保持纯 additive，不改 `FileObject.expiresAt` 非空约束，不改 `FileMetadata.expiresAt` / `fileExpiresAt` 契约，不改 `files.service.ts` 和前端。
- `FileObject` 新增字段使用 `String`，不要用 Prisma enum。
- `sourceFileId` 必须 nullable，Prisma 自关联使用独立关系名，例如 `FileAssetDerivation`，并 `onDelete: SetNull`。
- SQLite 自关联列 `ADD COLUMN ... REFERENCES` 不能带非空默认值。
- `FileMetadata` 新增字段先设为 optional，避免要求所有现有序列化和前端消费者立刻更新。

### Antigravity

结论：可实施，无 Critical。

Warning：

- 若本分支把 `expiresAt` 改为可空，需要同步适配 `files.service.ts`、上传响应和 `toMetadata()`，否则严格类型检查会失败。
- 建议 `FileObject.expiresAt` 可空以支持后续 `long_term`。

## Codex 裁决

本分支采用 Claude 的纯 additive 方案：

- 新增 `assetCategory`、`sourceFileId`、`retentionPolicy`、`retentionSetBy`、`retentionConsentAt`、`retentionConsentVersion`、`retentionLockedReason`。
- 不修改 `expiresAt` 非空约束，不改 `cleanupExpired`，不改 Kiosk/Admin。
- `long_term => expiresAt=null` 放到 Branch 2“保存期限服务、权限、清理 verify”中处理，届时同步改 `expiresAt` 可空、序列化和查询契约。
- `assetCategory` 默认 `original`，历史文件保持兼容。
- `retentionPolicy` 和 `retentionSetBy` 在数据库层 nullable，避免新增字段被误解为已经执行保存策略；应用层类型提供字面量 union，后续 Branch 2 负责写入策略。
- 新增类型字段在 `FileMetadata` 中先做 optional，避免现有 API 响应强制暴露未序列化字段。

## 验证计划

- `npx prisma validate --schema=services/api/prisma/schema.prisma`
- `npx prisma validate --schema=services/api/prisma/postgres/schema.prisma`
- `pnpm --filter @ai-job-print/api db:pg:sync:check`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/api verify:member-assets`
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`
- 最终 Claude + Antigravity 审查 `git diff`。

## 实施后验证记录

已通过：

- `pnpm --filter @ai-job-print/api exec prisma validate --schema=prisma/schema.prisma`
- `pnpm --filter @ai-job-print/api exec prisma validate --schema=prisma/postgres/schema.prisma`
- `pnpm --filter @ai-job-print/api db:pg:sync:check`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/api db:pg:generate`
- `git diff --check`
- 占位词扫描无命中。
- 使用最小 SQLite `FileObject` 表执行 `services/api/prisma/migrations/20260621154500_file_asset_retention_model/migration.sql`，验证 `sourceFileId` 自关联 `ON DELETE SET NULL` 生效，`PRAGMA foreign_key_check` 无输出。

未完成：

- `pnpm --filter @ai-job-print/api verify:member-assets` 初次运行缺少 `DATABASE_URL`。
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d` 初次运行缺少 `TERMINAL_ADMIN_SECRET` / `TERMINAL_ACTION_TOKEN_SECRET`。
- 为补齐本地 SQLite 库，尝试 `prisma migrate deploy`、`prisma migrate status`、`prisma db push`，均在当前环境返回 Prisma `Schema engine error: undefined`，未创建临时 dev.db；因此无法在本轮用完整临时库复跑上述两个 verify。

结论：本分支的 schema、迁移 SQL、类型契约和生成客户端验证通过；需要最终双模型审查确认未完成 verify 是否可接受，或是否要求后续在可用 DB engine/预生产环境补跑。

## 最终双模型审查

### Antigravity

Verdict：APPROVE。

Critical：无。

Warning：无。

Info：

- `verify:member-assets*` 因本地 sandbox 缺运行时环境和 Prisma CLI engine 兼容性未完整跑；本分支只有 additive schema 与类型定义，不阻塞合入。
- 完整验证应在预生产或 Branch 2 测试阶段补跑。

### Claude

Verdict：APPROVE。

Critical：无。

Warning：

- `verify:member-assets` / `verify:member-assets-c2d` 未在完整临时库复跑，不阻塞本 additive 分支；但 Branch 2 写入策略和清理逻辑时，必须把这两个 verify 作为合入门禁补跑，不得继续顺延。

Info：

- Branch 2 处理 `long_term` 时，必须同步把 `FileObject.expiresAt` 改可空，并适配 `files.service.ts`、上传响应与 `toMetadata()`。
- 若后续 API 要返回新增字段，需要在 `toMetadata()` 显式回填；当前 optional 字段保持现有 API 响应不变。

## 当前裁决

本分支作为 Branch 1 可以提交：它只落地文件资产留存模型基础字段，不改变现有运行行为。Branch 2 必须补齐保存策略写入、`expiresAt=null`、清理/序列化契约和 `verify:member-assets*`。
