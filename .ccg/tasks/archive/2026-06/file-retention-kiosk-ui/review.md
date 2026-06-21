# file-retention-kiosk-ui 审查与验证记录

## 任务范围

- 分支：`codex/file-retention-kiosk-ui`
- 基线：`codex/file-retention-policy-service`
- 目标：在 Kiosk `/me/documents` 复用既有文档卡片，让会员本人查看并修改文件保存期限。
- 非目标：不新增首页 / 我的页入口，不新增数据库字段，不新增后端 API，不做 Admin 生命周期运营视图，不做 COS 生命周期配置，不开发招聘平台闭环。

## 实现结论

- `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`
  - 展示当前 `retentionPolicy` / `expiresAt`。
  - 只用后端返回的 `allowedRetentionPolicies` 渲染可选项，并过滤系统短期策略。
  - 6 个月 / 长期保存需要确认弹层，确认后调用保存期限更新 API。
  - 查看、删除、保存期限更新共享 pending 互斥；保存中状态精确到目标 policy。
  - 保存失败时透出 `MemberAssetsApiError.message`，便于用户看到后端策略原因。
- `apps/kiosk/src/services/api/memberAssets.ts`
  - 增加 `PATCH /files/:id/retention` adapter。
  - 6 个月 / 长期保存自动附带 `FILE_RETENTION_CONSENT_VERSION`。
- `packages/shared/src/types/file.ts`、`services/api/src/files/file.types.ts`、`services/api/src/files/retention-policy.ts`
  - 增加并复用 `FILE_RETENTION_CONSENT_VERSION`，后端校验常量不再直接写散落字符串。
- `apps/kiosk/scripts/verify-file-retention-ui.mjs`
  - 增加 Kiosk UI / adapter / shared-backend 常量一致性防回退验证。

## 验证

- `pnpm --filter @ai-job-print/kiosk verify:file-retention-ui`：通过。
- `pnpm --filter @ai-job-print/kiosk typecheck`：通过。
- `pnpm --filter @ai-job-print/shared typecheck`：通过。
- `pnpm --filter @ai-job-print/api typecheck`：通过。
- `pnpm --filter @ai-job-print/kiosk lint`：通过；仅保留既有 `KioskBusyContext.tsx` Fast Refresh warning，无本任务新增 error。
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`：通过；保留既有大 chunk warning。
- `pnpm --filter @ai-job-print/api verify:file-retention`：通过。

## 双模型审查

第一轮：

- Antigravity：无 Critical，提出 pending 互斥、保存中状态精确性、验证脚本正则脆弱等 Warning。
- Claude：无 Critical，提出保存条款版本 SSOT、错误提示吞掉后端 message 等 Warning。

已修复：

- `open` / `remove` / `submitRetention` / `selectRetention` 全部纳入 `retentionBusy` 互斥。
- 保存中状态从按文件改为按 `{ fileId, policy }` 精确显示。
- `FILE_RETENTION_CONSENT_VERSION` 收敛到 shared 与 API 本地副本常量，后端校验和 Kiosk adapter 分别复用对应契约常量。
- 验证脚本比对 shared 与 API 本地副本常量，并兼容单双引号正则。
- 保存期限更新失败时展示 `MemberAssetsApiError.message`。

第二轮：

- Claude：无 Critical / Warning；确认六项关注点全部闭环，仅记录不影响合入的 Info。
- Antigravity：无 Critical / Warning；评分 100/100，结论 APPROVE，仅建议未来可加 Escape 关闭确认弹层。

## 后续

- 下一独立任务进入 Admin 文件生命周期运营视图。
- COS 生命周期策略、隐私政策保存期限文案、生产/试运营真实验收仍属于后续闭环。
