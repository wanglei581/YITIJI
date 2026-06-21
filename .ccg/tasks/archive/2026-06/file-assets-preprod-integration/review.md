# 用户文件资产商用闭环与预生产验收候选集成审查

## 方案审查

双模型结论：APPROVE WITH CONDITIONS。

落实条件：

- 合并方向正确：以 `codex/file-assets-trial-acceptance` 为主体，合入 `codex/preprod-deployment-acceptance`。
- 两点 diff 中大量删除只是 `preprod` 分支未包含文件资产栈造成的假象；实际 merge 不应删除文件资产迁移、保存期限服务、Kiosk/Admin 文件资产 UI 或证据包。
- 真实冲突仅 `docs/progress/current-progress.md`；冲突解决必须保留 `codex/file-assets-trial-acceptance` 和 `codex/preprod-deployment-acceptance` 两套事实。
- 文档必须继续声明：文件资产证据包就绪、预生产阶段性验证通过均不等于正式生产/试运营完成。
- `apps/kiosk/package.json` 必须同时保留 `verify:assistant-trtc-guard`、`verify:file-retention-ui`、`verify:legal-retention-copy`。
- 验证矩阵需要补 shared 包类型检查；实际脚本为 `pnpm --filter @ai-job-print/shared typecheck`。

## 最终审查

Antigravity：APPROVE。

- Critical：无。
- Warning：Prisma client 生成需在生产门禁验证前置；pnpm 安装不应并发执行。
- Info：文件资产栈、TRTC guard、进度边界和验证矩阵完整。

Claude：APPROVE。

- Critical：无。
- Warning：提交前需把未暂存的 progress 文档、task/plan 一并暂存，避免集成结论遗漏。
- Info：无删除文件资产栈；两套事实并存且无生产完成误称；Kiosk 三个 verify 脚本并存；未越界修改 schema、保存期限策略或 TRTC 运行逻辑。

补丁复审：

- 已在 `docs/device/production-deployment-runbook.md` 构建段补充串行 `pnpm install --frozen-lockfile`、`prisma generate` 与 `db:pg:generate` 前置。
- Claude 复审：APPROVE，认为补丁合理且与既有步骤无冲突。
- Antigravity 复审：APPROVE，认为补丁幂等且无生产完成误称。

## 验证记录

已通过：

```bash
pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:cos-lifecycle-policy
pnpm --filter @ai-job-print/api verify:file-retention
pnpm --filter @ai-job-print/api verify:file-lifecycle-summary
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
pnpm --filter @ai-job-print/kiosk verify:file-retention-ui
pnpm --filter @ai-job-print/kiosk verify:legal-retention-copy
pnpm --filter @ai-job-print/admin verify:admin-file-lifecycle-ui
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
git diff --check
```

环境说明：

- 首次 `verify:production-runtime-gates` 因新 worktree 未生成 Prisma client 失败；执行 `prisma generate` 和 `db:pg:generate` 后复跑通过。
- 一次并发运行多个 pnpm 命令时触发 `ENOTEMPTY` 安装竞争；改为串行 `pnpm install --frozen-lockfile` 后恢复。

## 剩余风险

- 本分支是统一预生产候选集成，不执行真实生产部署。
- 正式域名/HTTPS、腾讯短信、百度 OCR live、AI/TRTC/ASR/TTS live、Windows 真机、奔图真实出纸和小范围试运营仍需后续执行。
