<!-- 本文件由 scripts/generate-project-graph.mjs 自动生成，请勿手改。 -->
<!-- 手改会在下次 `node scripts/generate-project-graph.mjs` 时被覆盖。 -->
# 孤儿候选清单

> **本清单不删任何东西，也不构成删除许可。**
> 删除必须由产品负责人逐条确认后，另开 PR 执行。

## 判定标准

照 CLAUDE.md §8「删除旧代码必须有证据」的五条，全部满足才进 `low`：

1. 无路由引用 —— 不在任何 `createBrowserRouter` 路由表里
2. 无 import 引用 —— 不在应用入口 `main.tsx` 的 import 闭包内
3. 无测试 / verify 依赖 —— 没有门禁脚本断言它
4. 无当前文档声明 —— 全仓没有任何 `.md` 提到它
5. 不会被生产部署或硬件链路使用 —— 不在 `.github/`、`scripts/`、package.json 的引用里

任何一条不满足就降级到 `medium` / `high`，并写出是哪条引用拦住的。

## 分级汇总

| 风险 | 含义 | 数量 |
| --- | --- | --- |
| **protected** | 硬名单，即使零引用也不得删除 | 4 |
| **high** | 仍被 CI / 门禁 / 包脚本引用 | 12 |
| **medium** | 只被文档或其它文件提及 | 13 |
| **low** | 全仓零提及 | 126 |


──────────────────────────────────────────────────────────────────────

## ⚠ 自相矛盾的门禁（1）

同一个路径，一条门禁断言它**必须存在**，另一条断言它**必须不存在**。

**这不只是「该删一条」。** 它说明这两条门禁的作者互相不知道对方存在——
是流程信号，不是代码信号。而且因为其中一条通常没接线，矛盾不会以 CI 红的
形式暴露，只会在某天有人把它接上时才炸。

### `src/routes/partners/PartnerAccountDeletionDialog.tsx`

该路径在仓库中**不存在**。

| 断言方向 | 门禁 | 是否会执行 |
| --- | --- | --- |
| 必须存在 | `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | **无脚本名，不会执行** |
| 必须不存在 | `apps/admin/scripts/verify-partner-account-action-ui.mjs` | CI 会跑 |


──────────────────────────────────────────────────────────────────────

## low — 全仓零提及（126）

五条证据全部满足。**仍需人确认**：脚本看不见运行时动态引用，也不知道
某个文件是不是刻意保留的下一步入口。

### 页面/组件（4）

| 路径 | 判定依据 |
| --- | --- |
| `apps/kiosk/src/pages/print/pageRange.ts` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `apps/kiosk/src/services/api/smartCampus.ts` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `apps/kiosk/src/services/api/smartCampusHttpAdapter.ts` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `apps/kiosk/src/services/api/smartCampusMockAdapter.ts` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |

### 文档（122）

| 路径 | 判定依据 |
| --- | --- |
| `docs/acceptance/wave1-resume-optimize-preprod-acceptance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/business/AI求职打印服务终端-B2G-B2B2C方案-专家评审报告.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/business/百宝箱商业价值与实用性说明.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/business/职易达AI求职服务终端-参赛项目简介.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/business/职易达AI求职服务终端-青岛OPC创业大赛商业计划书.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/design/job-link-risk-analysis.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/design/kiosk-ai-orchestration-2026-08/README.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/design/kiosk-ai-orchestration-2026-08/_RESUME-NOTE.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/design/kiosk-ai-os-fusion-2026-08/README.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/design/kiosk-ai-os-prototype-2026-08/README.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/design/mini-proto-v2-2026-07/CRAFT-NOTES.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/device/deploy-unfreeze-runbook-2026-08-17.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/device/release-batching-2026-08-17.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/patent/README.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/patent/对接清单.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/product/miniapp-life-circle-plan-v0.1.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/product/miniprogram-phase-a-prototype-changelist-2026-07.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/product/operation-manual-benchmark-plan.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/product/pii-redaction-decision-2026-08.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/progress/audit/2026-06-09-doc-consistency.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/progress/owners.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/agency-phase2-closeout-review.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/agency-project-structure-review.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/ai-resume-phase0-contract-lock-review.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/codex-phase0-followup.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/dev-status-consolidation-2026-07-17.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/empty-catalogs-root-cause-2026-08-16.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/f1-d2-prime-cgroup-consistency-root-cause-2026-08-01.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/global-seamless-data-refresh-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/kiosk-page-split-backlog.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/me-resumes-actions-hardening.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/me-resumes-page.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/my-documents-delete-action.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/operating-charter-2026-08-16.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/phase6.5-data-chain-review.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/profile-print-feedback-link.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/project-normalization-ignore-proposal.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/project-normalization-local-tools-landing.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/project-normalization-task-evidence-triage.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/real-file-print-2026-08-17/README.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/reviews/task-card-x1-n2-n4-admin-fe-split.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-18-benefit-activities-real-validation.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-18-profile-notifications-feedback-p1.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-20-project-normalization-p0.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-22-admin-file-lifecycle-view.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-22-cos-lifecycle-privacy-acceptance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-22-file-assets-gate2-readiness-recheck.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-22-file-assets-trial-acceptance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-26-user-file-upload-flow.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-ai-resume-commercial-closure.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-ai-resume-diagnosis-config-ui.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-ai-resume-diagnosis-context-phase1.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-ai-resume-overall-assessment-implementation.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-global-seamless-data-refresh.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-job-materials-commercial-closure.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-06-29-resume-phone-qr-upload-closure.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-03-deploy-data-safety-gate.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-03-resume-optimize-wave2-layout.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-03-resume-template-fill-wave3.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-03-resume-voice-wave4.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-10-real-scan-implementation-plan.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-10-remaining-work-report-and-roadmap.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-11-material-check-real-implementation-plan.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-12-c5-4-redemption-settlement-consistency.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-12-isolated-production-p0-launch.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-12-node20-pdf-renderer-compatibility.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-12-ocr-live-renderer-verify.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-12-preprod-test-print-seed-guard-implementation.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-13-payment-qr-auto-reconcile.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-13-preprod-payment-timeout-acceptance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-13-print-unpaid-task-controlled-cancellation.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-13-qingxu-lightflow-core-tabs-4188-layout.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-13-qingxu-lightflow-k2a-ai-career.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-13-qingxu-lightflow-k2b-ai-resume.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-14-alipay-f2f-codepay.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-14-assistant-voice-consultation-restore.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-14-qingxu-lightflow-4188-layout-parity.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-14-windows-agent-reliability-p0.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-15-admin-billing-description-editor.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-15-admin-credential-recovery-and-auth-verify-safety.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-15-admin-partner-warm-theme-governance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-15-production-deployment-integrated.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-15-terminal-fleet-f0-overview.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-16-admin-partner-phone-transfer.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-16-partner-account-member-safe-removal.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-17-dependency-security-remediation-main.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-18-partner-account-dual-auth-removal-implementation.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w1.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w2.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w3.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w5.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w6.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-25-partner-email-login-alias.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-26-home-job-fairs-print-scan-visual-balance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-26-partner-account-phone-transfer-ux.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-26-qingxu-lightflow-kiosk87-shell-closure.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-29-p0-1b-kiosk-session-warning.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-30-agent-loop-ci-gates-implementation.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-07-30-f1-d3-single-owner-governance.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-08-01-f1-d2-integration-reconcile.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-08-01-f1-d2-invocation-uniqueness.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/plans/2026-08-09-contract-review-report-printing.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-06-22-cos-lifecycle-privacy-acceptance-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-06-29-ai-resume-overall-assessment-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-06-29-job-materials-commercial-closure-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-06-29-smart-campus-toolbox-home-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-03-resume-optimize-wave2-layout-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-03-resume-template-fill-wave3-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-03-resume-voice-wave4-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-12-ocr-live-renderer-verify-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-12-preprod-test-print-seed-guard-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-13-payment-qr-auto-reconcile-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-13-qingxu-lightflow-core-tabs-4188-layout-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-14-assistant-voice-consultation-restore-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-14-qingxu-lightflow-4188-layout-parity-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-14-windows-agent-reliability-p0-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-15-admin-billing-description-editor-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-15-production-deployment-integrated-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-16-f1-release-provenance-manifest-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-16-partner-account-member-safe-removal-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-26-partner-account-phone-transfer-ux-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |
| `docs/superpowers/specs/2026-07-29-p0-1b-kiosk-session-warning-design.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 全仓零提及：无路由、无 import、无门禁、无文档、无 CI |


──────────────────────────────────────────────────────────────────────

## medium — 只被文档或其它文件提及（13）

### 页面/组件（12）

| 路径 | 判定依据 |
| --- | --- |
| `apps/kiosk/src/App.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/reviews/agency-project-structure-review.md、docs/reviews/legacy-capability-inventory-2026-08-16.md |
| `apps/kiosk/src/components/KioskNumPad.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/progress/archive/2026-06-20-current-progress-pre-normalization.md |
| `apps/kiosk/src/pages/interview/InterviewTopbar.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w3.md |
| `apps/kiosk/src/pages/jobs-fairs-prototype.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/design/kiosk-proto-2026-07-migration-matrix.md、docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w4.md |
| `apps/kiosk/src/pages/jobs/components/JobAiEntryPanel.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/reviews/ai-capability-wiring-matrix-2026-08-16.md、docs/superpowers/plans/2026-06-30-job-info-ai-commercial-closure.md |
| `apps/kiosk/src/pages/jobs/components/JobFilterAssistant.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/reviews/ai-capability-wiring-matrix-2026-08-16.md |
| `apps/kiosk/src/pages/jobs/components/JobListInsights.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/reviews/ai-capability-wiring-matrix-2026-08-16.md、docs/superpowers/plans/2026-06-30-job-info-ai-commercial-closure.md |
| `apps/kiosk/src/pages/placeholders/OfflineAgenciesPage.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/design/kiosk-v6-migration-matrix.md、docs/reviews/legacy-capability-inventory-2026-08-16.md |
| `apps/kiosk/src/pages/placeholders/OfflineJobDetailPage.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/design/kiosk-v6-migration-matrix.md |
| `apps/kiosk/src/pages/placeholders/PrintScanConvertPage.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/design/kiosk-proto-2026-07-migration-matrix.md、docs/design/kiosk-v6-migration-matrix.md |
| `apps/kiosk/src/pages/placeholders/PrintScanFeaturePage.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/design/kiosk-proto-2026-07-migration-matrix.md、docs/design/kiosk-v6-migration-matrix.md |
| `apps/kiosk/src/pages/placeholders/PrintScanSignPage.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仅被文档提及：docs/design/kiosk-proto-2026-07-migration-matrix.md、docs/design/kiosk-v6-migration-matrix.md |

### 样式（1）

| 路径 | 判定依据 |
| --- | --- |
| `apps/kiosk/src/pages/print-scan/styles/print-scan-home.css` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被其它文件提及：apps/kiosk/src/pages/print-scan/styles/print-scan-uplift.css |


──────────────────────────────────────────────────────────────────────

## high — 仍被 CI / 门禁 / 包脚本引用（12）

### 页面/组件（6）

| 路径 | 判定依据 |
| --- | --- |
| `apps/admin/src/routes/account-settings/PhoneBindingCard.tsx` | 不在 apps/admin/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/admin/scripts/verify-admin-account-settings-ui.mjs |
| `apps/kiosk/src/components/ComingSoonNotice.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-fusion-w4.mjs |
| `apps/kiosk/src/components/KioskDeviceStatusPills.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-device-status-honest.mjs |
| `apps/kiosk/src/pages/auth/components/MemberLoginDialog.tsx` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-member-login-dialog.mjs |
| `apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-prod-build-config.mjs、apps/kiosk/scripts/verify-runtime-terminal-identity.mjs |
| `apps/kiosk/src/pages/home/serviceGroups.ts` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-job-material-library-ui.mjs、apps/kiosk/scripts/verify-jobfair-checkin.mjs、apps/kiosk/scripts/verify-jobfair-commercial-closure.mjs |

### 门禁脚本（3）

| 路径 | 判定依据 |
| --- | --- |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | 文件存在，但没有任何 package.json 脚本名指向它 —— 从未被执行过<br/>→ 仍被 CI / 门禁 / 包脚本引用：scripts/ci-gate-exemptions.json、scripts/verify-ci-gate-coverage.mjs |
| `apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs` | 文件存在，但没有任何 package.json 脚本名指向它 —— 从未被执行过<br/>→ 仍被 CI / 门禁 / 包脚本引用：scripts/ci-gate-exemptions.json |
| `scripts/verify-self-assessment-r3-pick.mjs` | 文件存在，但没有任何 package.json 脚本名指向它 —— 从未被执行过<br/>→ 仍被 CI / 门禁 / 包脚本引用：scripts/ci-gate-exemptions.json |

### 样式（2）

| 路径 | 判定依据 |
| --- | --- |
| `apps/kiosk/src/pages/print-scan/styles/print-scan-uplift.css` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-kiosk-visual-unity.mjs |
| `apps/kiosk/src/styles/kiosk-uplift.css` | 不在 apps/kiosk/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/kiosk/scripts/verify-fusion-home.mjs、apps/kiosk/scripts/verify-kiosk-visual-unity.mjs |

### 测试（1）

| 路径 | 判定依据 |
| --- | --- |
| `apps/admin/src/routes/partners/partnerAccountActionMachine.test.ts` | 不在 apps/admin/src/main.tsx 的 import 闭包内，也不在路由表中<br/>→ 仍被 CI / 门禁 / 包脚本引用：apps/admin/package.json |


──────────────────────────────────────────────────────────────────────

## protected — 硬名单，即使零引用也不得删除（4）

这些路径即使零引用也**不得删除**。它们的价值不在「被代码引用」，
而在作为回归基线、目标设计或产权归属。

### 文档（4）

| 路径 | 判定依据 |
| --- | --- |
| `docs/design/kiosk-ai-os-v3-2026-08/IMPLEMENTATION-NOTES.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 当前 V6 目标设计，是「将要实现」而不是「已被引用」 |
| `docs/design/kiosk-ai-os-v3-2026-08/STATUS.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 当前 V6 目标设计，是「将要实现」而不是「已被引用」 |
| `docs/design/kiosk-ai-os-v3-2026-08/backlog-triage-2026-08-09.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 当前 V6 目标设计，是「将要实现」而不是「已被引用」 |
| `docs/design/kiosk-ai-os-v3-2026-08/phase2-home-pilot-plan.md` | 全仓没有任何其它文件提到这个路径或文件名<br/>→ 当前 V6 目标设计，是「将要实现」而不是「已被引用」 |
