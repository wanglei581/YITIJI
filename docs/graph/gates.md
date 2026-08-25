<!-- 本文件由 scripts/generate-project-graph.mjs 自动生成，请勿手改。 -->
<!-- 手改会在下次 `node scripts/generate-project-graph.mjs` 时被覆盖。 -->
# 门禁图谱

## 为什么要有这一册

「门禁存在」「门禁有名字」「门禁在 CI 里跑」是三件不同的事，任何一层都可能断：

| 层 | 断了会怎样 | 谁在守 |
| --- | --- | --- |
| 脚本文件存在 → package.json 里有脚本名 | 门禁写完就从没跑过，**零信号** | 本册（下方「无脚本名」表） |
| 有脚本名 → 进 CI 执行闭包 | 本地能跑、CI 不跑 | `scripts/verify-ci-gate-coverage.mjs`（权威） |
| 断言的路径 → 文件真实存在 | 断言恒真，门禁形同虚设 | 本册（下方「断言路径不存在」表） |

`verify:ci-gate-coverage` 枚举的是 package.json 里**已声明**的脚本名。
一个 `.mjs` 文件如果压根没被起过名字，它连枚举入口都进不去 —— 那一层只有本册能看见。

──────────────────────────────────────────────────────────────────────

## 无脚本名：文件存在，但从未被执行（3）

判定：文件在 `scripts/` 下、不是被别的门禁 import 的辅助库、且没有任何
workspace 包的 `package.json` scripts 指向它。

| 门禁脚本 | 断言文件数 |
| --- | --- |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | 3 |
| `apps/kiosk/scripts/verify-jobfairs-terminal-priority.mjs` | 1 |
| `scripts/verify-self-assessment-r3-pick.mjs` | 11 |

──────────────────────────────────────────────────────────────────────

## 有脚本名但不在 CI 执行闭包里（3）

这一栏是**尽力而为的推断**，权威是 `verify:ci-gate-coverage` 加
`scripts/ci-gate-exemptions.json`。已在豁免清单里登记的（需要真实凭证 / 真机 /
本地服务）出现在这里是正常的。

| 门禁脚本 | 脚本名 |
| --- | --- |
| `scripts/generate-project-graph.mjs` | `ai-job-print-terminal::graph`<br/>`ai-job-print-terminal::graph:check` |
| `scripts/project-graph-query.mjs` | `ai-job-print-terminal::graph:query` |
| `scripts/verify-deploy-authorization-gate.mjs` | `ai-job-print-terminal::verify:deploy-authorization-gate` |

──────────────────────────────────────────────────────────────────────

## 断言了不存在的路径（3）

门禁里写着某个仓库路径，但该路径在 git 里不存在。可能是文件被移动/删除后门禁
没跟着改 —— 这类断言往往已经恒真或恒假，需要人确认。

| 门禁脚本 | 找不到的路径 |
| --- | --- |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | `src/routes/partners/PartnerAccountDeletionDialog.tsx` |
| `apps/kiosk/scripts/verify-fusion-w4.mjs` | `services/api/prisma/postgres/migrations/20260802120000_add_wx_open_id_to_end_user/migration.sql` |
| `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs` | `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs` |

──────────────────────────────────────────────────────────────────────

## 反向索引：文件 → 断言它的门禁

**改文件前查这里**，就知道会红哪条门禁。共 749 个文件被至少一条门禁断言。

命令行版本（推荐，支持前缀匹配）：
```bash
node scripts/project-graph-query.mjs file <路径>
```


<details>
<summary><code>.ccg/tasks/archive/</code> — 8 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.ccg/tasks/archive/2026-07/user-center-commercial-closure-plan/plan.md` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-commercial-closure-plan/requirements.md` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-commercial-closure-plan/review.md` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-commercial-closure-plan/task.json` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-wave0-truth-baseline/plan.md` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-wave0-truth-baseline/requirements.md` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-wave0-truth-baseline/review.md` | `verify-profile-commercial-first-batch.mjs` |
| `.ccg/tasks/archive/2026-07/user-center-wave0-truth-baseline/task.json` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>.github/workflows/ci.yml/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.github/workflows/ci.yml` | `verify-data-request-ui.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-ai-ui.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-lightflow-k2c-interview.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-mic-capability-truth.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-service-desk-foundation.mjs`<br/>`gates.mjs`<br/>`verify-ci-gate-coverage.mjs`<br/>`verify-deploy-authorization-gate.mjs` |

</details>

<details>
<summary><code>.github/workflows/cleanup-stale-releases.yml/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.github/workflows/cleanup-stale-releases.yml` | `verify-deploy-authorization-gate.mjs` |

</details>

<details>
<summary><code>.github/workflows/deploy-precheck.yml/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.github/workflows/deploy-precheck.yml` | `verify-deploy-authorization-gate.mjs` |

</details>

<details>
<summary><code>.github/workflows/deploy.yml/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.github/workflows/deploy.yml` | `verify-deploy-vite-env-coverage.mjs`<br/>`verify-deploy-authorization-gate.mjs` |

</details>

<details>
<summary><code>.github/workflows/server-cleanup.yml/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.github/workflows/server-cleanup.yml` | `verify-deploy-authorization-gate.mjs` |

</details>

<details>
<summary><code>apps/admin/package.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/admin/package.json` | `verify-data-request-ui.mjs` |

</details>

<details>
<summary><code>apps/admin/scripts/</code> — 2 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/admin/scripts/verify-admin-file-lifecycle.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/admin/scripts/verify-honest-placeholders.mjs` | `verify-partner-stats-contract.mjs` |

</details>

<details>
<summary><code>apps/admin/src/</code> — 66 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/admin/src/layouts/AdminLayoutWrapper.tsx` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-billing-ui.mjs`<br/>`verify-admin-content-trust-ui.mjs`<br/>`verify-admin-job-materials-ui.mjs`<br/>`verify-admin-print-scan-ui.mjs`<br/>`verify-data-request-ui.mjs` |
| `apps/admin/src/routes/account-settings/AdminInitialPhoneBindingCard.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/admin/src/routes/account-settings/AdminPhoneTransferCard.tsx` | `verify-admin-phone-transfer-ui.mjs` |
| `apps/admin/src/routes/account-settings/PhoneBindingCard.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/admin/src/routes/account-settings/index.tsx` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-phone-transfer-ui.mjs` |
| `apps/admin/src/routes/ai-services/index.tsx` | `verify-job-ai-ops-dashboard-ui.mjs` |
| `apps/admin/src/routes/billing/index.tsx` | `verify-admin-billing-ui.mjs` |
| `apps/admin/src/routes/components/BulkPublishButton.tsx` | `verify-admin-content-trust-ui.mjs` |
| `apps/admin/src/routes/devices/TerminalFleetOverview.tsx` | `verify-admin-device-fleet-overview-ui.mjs` |
| `apps/admin/src/routes/devices/index.tsx` | `verify-admin-device-fleet-overview-ui.mjs` |
| `apps/admin/src/routes/fair-sources/index.tsx` | `verify-source-publish-actions.mjs` |
| `apps/admin/src/routes/files/index.tsx` | `verify-profile-documents-inkpaper.mjs` |
| `apps/admin/src/routes/index.tsx` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-billing-ui.mjs`<br/>`verify-admin-job-materials-ui.mjs`<br/>`verify-admin-print-scan-ui.mjs`<br/>`verify-data-request-ui.mjs`<br/>`frontend.mjs` |
| `apps/admin/src/routes/job-materials/index.tsx` | `verify-admin-job-materials-ui.mjs` |
| `apps/admin/src/routes/job-sources/index.tsx` | `verify-source-publish-actions.mjs` |
| `apps/admin/src/routes/login/index.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/admin/src/routes/member-privacy/index.tsx` | `verify-data-request-ui.mjs` |
| `apps/admin/src/routes/orders/index.tsx` | `verify-admin-orders-readonly-ui.mjs` |
| `apps/admin/src/routes/partners/OrgContentTrustPanel.tsx` | `verify-admin-content-trust-ui.mjs` |
| `apps/admin/src/routes/partners/PartnerAccountActionDialog.tsx` | `verify-partner-account-action-ui.mjs` |
| `apps/admin/src/routes/partners/PartnerAccountManager.tsx` | `verify-partner-account-action-ui.mjs`<br/>`verify-partner-account-delete-ui.mjs` |
| `apps/admin/src/routes/partners/contentTrustRules.ts` | `verify-admin-content-trust-ui.mjs` |
| `apps/admin/src/routes/partners/index.tsx` | `verify-admin-content-trust-ui.mjs`<br/>`verify-partner-account-delete-ui.mjs` |
| `apps/admin/src/routes/partners/partner-account-action-steps/ActionCredentialSteps.tsx` | `verify-partner-account-action-ui.mjs` |
| `apps/admin/src/routes/partners/partner-account-action-steps/PhoneRebindSteps.tsx` | `verify-partner-account-action-ui.mjs` |
| `apps/admin/src/routes/partners/usePartnerAccountAction.ts` | `verify-partner-account-action-ui.mjs` |
| `apps/admin/src/routes/peripherals/index.tsx` | `verify-honest-placeholders.mjs` |
| `apps/admin/src/routes/permissions/index.tsx` | `verify-honest-placeholders.mjs` |
| `apps/admin/src/routes/policy-sources/index.tsx` | `verify-source-publish-actions.mjs` |
| `apps/admin/src/routes/print-scan/CloseUnpaidPrintTaskForm.tsx` | `verify-admin-print-scan-ui.mjs` |
| `apps/admin/src/routes/print-scan/index.tsx` | `verify-admin-print-scan-ui.mjs` |
| `apps/admin/src/routes/sync-sources/index.tsx` | `verify-backend-p0-contracts.mjs` |
| `apps/admin/src/routes/terminals/CreatePlannedTerminalDialog.tsx` | `verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/routes/terminals/TerminalBindCodeDialog.tsx` | `verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/routes/terminals/TerminalLifecycleActions.tsx` | `verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/routes/terminals/TerminalNetworkDiagnostics.tsx` | `verify-admin-terminal-network-diagnostics-ui.mjs` |
| `apps/admin/src/routes/terminals/index.tsx` | `verify-admin-terminal-bind-code-ui.mjs`<br/>`verify-admin-terminal-network-diagnostics-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/TerminalToolboxPanel.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/TerminalToolboxRow.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/ToolboxAllowedHostPanel.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/ToolboxGovernancePanel.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/ToolboxLaunchSummaryCard.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/constants.ts` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/index.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/users/UserDetailDrawer.tsx` | `verify-admin-users-ui.mjs` |
| `apps/admin/src/routes/users/index.tsx` | `verify-admin-users-ui.mjs` |
| `apps/admin/src/routes/users/userPresentation.ts` | `verify-admin-users-ui.mjs` |
| `apps/admin/src/services/api/adminAiHttpAdapter.ts` | `verify-job-ai-ops-dashboard-ui.mjs` |
| `apps/admin/src/services/api/adminBilling.ts` | `verify-admin-billing-ui.mjs` |
| `apps/admin/src/services/api/adminHttpAdapter.ts` | `verify-admin-device-fleet-overview-ui.mjs`<br/>`verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/services/api/adminMockAdapter.ts` | `verify-admin-device-fleet-overview-ui.mjs`<br/>`verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/services/api/adminOrdersReadonly.ts` | `verify-admin-orders-readonly-ui.mjs` |
| `apps/admin/src/services/api/adminPrintJobs.ts` | `verify-admin-orders-readonly-ui.mjs` |
| `apps/admin/src/services/api/adminUsers.ts` | `verify-admin-users-ui.mjs` |
| `apps/admin/src/services/api/aiUsage.ts` | `verify-job-ai-ops-dashboard-ui.mjs` |
| `apps/admin/src/services/api/client.ts` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/services/api/devices.ts` | `verify-admin-device-fleet-overview-ui.mjs`<br/>`verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/services/api/files.ts` | `verify-admin-file-lifecycle.mjs` |
| `apps/admin/src/services/api/jobMaterials.ts` | `verify-admin-job-materials-ui.mjs` |
| `apps/admin/src/services/api/memberPrivacyAdmin.ts` | `verify-data-request-ui.mjs` |
| `apps/admin/src/services/api/offlineAgenciesAdmin.ts` | `verify-backend-p0-contracts.mjs` |
| `apps/admin/src/services/api/orgsAdmin.ts` | `verify-partner-account-action-ui.mjs`<br/>`verify-partner-account-delete-ui.mjs` |
| `apps/admin/src/services/api/printScan.ts` | `verify-admin-print-scan-ui.mjs` |
| `apps/admin/src/services/api/toolbox.ts` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/services/api/types.ts` | `verify-admin-device-fleet-overview-ui.mjs`<br/>`verify-admin-terminal-bind-code-ui.mjs`<br/>`verify-admin-terminal-network-diagnostics-ui.mjs`<br/>`verify-job-ai-ops-dashboard-ui.mjs` |
| `apps/admin/src/services/auth/index.ts` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-phone-transfer-ui.mjs`<br/>`verify-partner-account-action-ui.mjs` |

</details>

<details>
<summary><code>apps/kiosk/package.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/package.json` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |

</details>

<details>
<summary><code>apps/kiosk/playwright.w3.config.ts/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/playwright.w3.config.ts` | `verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>apps/kiosk/playwright.w4.config.ts/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/playwright.w4.config.ts` | `verify-fusion-w4.mjs` |

</details>

<details>
<summary><code>apps/kiosk/scripts/</code> — 34 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-fusion-baseline.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-fusion-home.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-fusion-shell.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-fusion-w3.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-fusion-w4.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-fusion-w5.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-home-toolbox-ui.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs` | `verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/scripts/verify-job-material-library-ui.mjs` | `verify-fusion-w4.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-kiosk-visible-actions-truth.mjs` | `verify-fusion-w4.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/scripts/verify-member-login-dialog.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-member-print-orders-ui.mjs` | `verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/scripts/verify-print-confirm-honest.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-print-done-truth.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-profile-activity-inkpaper.mjs` | `verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/scripts/verify-profile-ai-records-inkpaper.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-profile-documents-inkpaper.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-profile-feedback-inkpaper.mjs` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-profile-inkpaper-home.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-profile-print-orders-inkpaper.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-profile-print-orders-login-smoke.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-profile-resumes-notifications-inkpaper.mjs` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-resume-diagnosis-flow-ui.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-scan-session-truth.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-smart-campus-ui.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-user-center-wave0.mjs` | `verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/scripts/verify-visual-evidence-manifest.mjs` | `verify-fusion-w4.mjs` |

</details>

<details>
<summary><code>apps/kiosk/src/</code> — 351 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/src/ai/AiEvidence.tsx` | `verify-kiosk-ai-primitives.mjs` |
| `apps/kiosk/src/ai/AiTaskRegion.tsx` | `verify-kiosk-ai-primitives.mjs` |
| `apps/kiosk/src/ai/aiOutage.ts` | `verify-ai-down-fallbacks.mjs` |
| `apps/kiosk/src/ai/index.ts` | `verify-kiosk-ai-primitives.mjs` |
| `apps/kiosk/src/ai/useAiTask.ts` | `verify-kiosk-ai-primitives.mjs` |
| `apps/kiosk/src/auth/AuthContext.tsx` | `verify-contract-review-session.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs` |
| `apps/kiosk/src/auth/KioskCapabilityGuard.tsx` | `verify-fusion-w4.mjs`<br/>`verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/auth/KioskPrivacyGuard.tsx` | `verify-fusion-shell.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-member-session-closure.mjs` |
| `apps/kiosk/src/auth/KioskSessionControlContext.tsx` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/auth/kioskSensitiveSession.ts` | `verify-contract-review-session.mjs`<br/>`verify-job-material-library-ui.mjs` |
| `apps/kiosk/src/auth/returnPath.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/components/FileContentPreview.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/components/FilePreviewDialog.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/components/KioskDeviceStatusPills.tsx` | `verify-device-status-honest.mjs` |
| `apps/kiosk/src/components/KioskFeedbackDialog.tsx` | `verify-kiosk-feedback-entry.mjs` |
| `apps/kiosk/src/components/ServiceReadinessStrip.tsx` | `verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/components/hid-guard/KioskHidScanGuard.tsx` | `verify-scan-input-safety.mjs` |
| `apps/kiosk/src/components/hid-guard/hidBurstDetector.ts` | `verify-scan-input-safety.mjs` |
| `apps/kiosk/src/components/kiosk-shell/KioskAppTopbar.tsx` | `verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/components/kiosk-shell/KioskFullscreenShell.tsx` | `verify-fusion-w3.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/components/kiosk-shell/KioskStageFit.tsx` | `verify-fusion-shell.mjs` |
| `apps/kiosk/src/hooks/useAiAdvisorCallSession.ts` | `verify-assistant-trtc-guard.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-prod-build-config.mjs`<br/>`verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/hooks/useApiReadiness.ts` | `verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/hooks/useKioskStageFit.ts` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/hooks/useSmartCampusConfig.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/hooks/useTerminalDeviceStatus.ts` | `verify-device-status-honest.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/hooks/useToolboxConfig.ts` | `verify-fusion-w4.mjs`<br/>`verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/index.css` | `verify-fusion-shell.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-kiosk-ai-primitives.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-service-desk-foundation.mjs` |
| `apps/kiosk/src/layouts/KioskRoot.tsx` | `verify-device-status-honest.mjs`<br/>`verify-fusion-home.mjs`<br/>`verify-fusion-shell.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-kiosk-shell-active-nav.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/layouts/KioskRuntimeRoot.tsx` | `verify-fusion-shell.mjs`<br/>`verify-scan-input-safety.mjs` |
| `apps/kiosk/src/lib/capabilityReasons.ts` | `verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/lib/fileName.ts` | `verify-file-display-truth.mjs` |
| `apps/kiosk/src/lib/regions.ts` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/lib/url.ts` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/main.tsx` | `verify-fusion-w4.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/pages/activities/BenefitActivitiesPage.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/activities/activities-detail-inkpaper.css` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/assistant/AdvisorConversation.tsx` | `verify-advisor-provider-gate.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/AdvisorTools.tsx` | `verify-advisor-provider-gate.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/AssistantCallPanel.tsx` | `verify-assistant-trtc-guard.mjs`<br/>`verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/assistant/AssistantPage.tsx` | `verify-advisor-provider-gate.mjs`<br/>`verify-assistant-trtc-guard.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/advisorProvider.ts` | `verify-advisor-provider-gate.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/advisorScenes.ts` | `verify-advisor-provider-gate.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-advisor.css` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-inkpaper.css` | `verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-call-gate.css` | `verify-assistant-trtc-guard.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-call-live.css` | `verify-assistant-trtc-guard.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-call-responsive.css` | `verify-assistant-trtc-guard.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-call-shell.css` | `verify-assistant-trtc-guard.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-call.css` | `verify-assistant-trtc-guard.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-chat.css` | `verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-content.css` | `verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/assistant/assistant-lightflow-shell.css` | `verify-fusion-w3.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs` |
| `apps/kiosk/src/pages/auth/LoginPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs`<br/>`verify-qr-login-ui.mjs`<br/>`verify-user-center-wave0.mjs` |
| `apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx` | `verify-fusion-shell.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-qr-login-ui.mjs` |
| `apps/kiosk/src/pages/auth/ScanQrLoginPanel.tsx` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-qr-login-ui.mjs` |
| `apps/kiosk/src/pages/auth/components/MemberAgreement.tsx` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs` |
| `apps/kiosk/src/pages/auth/components/MemberLoginDialog.tsx` | `verify-member-login-dialog.mjs` |
| `apps/kiosk/src/pages/auth/components/MemberPhoneLoginPane.tsx` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs` |
| `apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-member-session-closure.mjs` |
| `apps/kiosk/src/pages/auth/login.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/mobile-qr-service-desk.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-dialog.css` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-form.css` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-keypad.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-responsive.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-shell.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/campus/CampusPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-page-size.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/campus/components/CampusTabs.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs` |
| `apps/kiosk/src/pages/companies/CompaniesPage.tsx` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/companies/CompanyDetailPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/pages/contract-review/ContractReviewHomePage.tsx` | `verify-contract-review-session.mjs` |
| `apps/kiosk/src/pages/contract-review/ContractReviewProcessingPage.tsx` | `verify-contract-review-session.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs` |
| `apps/kiosk/src/pages/contract-review/ContractReviewResultPage.tsx` | `verify-contract-review-report-print.mjs`<br/>`verify-contract-review-session.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/contract-review/ContractReviewSessionNotice.tsx` | `verify-contract-review-session.mjs` |
| `apps/kiosk/src/pages/contract-review/contractReviewReportPrintFlow.ts` | `verify-contract-review-report-print.mjs` |
| `apps/kiosk/src/pages/contract-review/contractReviewSession.ts` | `verify-contract-review-session.mjs` |
| `apps/kiosk/src/pages/errors/KioskRouteErrorPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/pages/help/HelpCenterPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/help/help-service-desk.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/home/HomePage.tsx` | `verify-device-status-honest.mjs`<br/>`verify-fusion-home.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-service-entry-readiness.mjs`<br/>`verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/home/components/ContinuePanel.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/home/components/ToolboxLaunchModals.tsx` | `verify-fusion-w5.mjs`<br/>`verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/pages/home/components/V6HomeFooterPanels.tsx` | `verify-fusion-home.mjs`<br/>`verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/home/components/V6HomeView.tsx` | `verify-fusion-home.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/pages/home/components/kioskAppLaunch.ts` | `verify-fusion-w5.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/home/homeDomainStatus.ts` | `verify-fusion-home.mjs` |
| `apps/kiosk/src/pages/home/homeV6Domains.ts` | `verify-fusion-home.mjs`<br/>`verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts` | `verify-prod-build-config.mjs`<br/>`verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/pages/home/hooks/useHomeJobFairHighlight.ts` | `verify-fusion-home.mjs`<br/>`verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/home/serviceGroups.ts` | `verify-job-material-library-ui.mjs`<br/>`verify-jobfair-checkin.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/home/styles/home-v6-footer.css` | `verify-fusion-home.mjs`<br/>`verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/home/styles/home-v6-motion-responsive.css` | `verify-fusion-home.mjs` |
| `apps/kiosk/src/pages/home/styles/home-v6.css` | `verify-fusion-home.mjs` |
| `apps/kiosk/src/pages/interview/InterviewReportPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-lightflow-k2c-interview.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/interview/InterviewReportsPage.tsx` | `verify-fusion-w3.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/InterviewServiceHubPage.tsx` | `verify-kiosk-frontend-debt.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/interview/InterviewSessionPage.tsx` | `verify-fusion-w3.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-lightflow-k2c-interview.mjs`<br/>`verify-mic-capability-truth.mjs` |
| `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx` | `verify-ai-down-fallbacks.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/InterviewShell.tsx` | `verify-fusion-w3.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/InterviewTipsPage.tsx` | `verify-fusion-w3.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/interview-service-desk.css` | `verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/session/InterviewAnswerDock.tsx` | `verify-lightflow-k2c-interview.mjs`<br/>`verify-mic-capability-truth.mjs` |
| `apps/kiosk/src/pages/interview/session/InterviewSessionPanels.tsx` | `verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/session/types.ts` | `verify-fusion-w3.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/styles/interview-report.css` | `verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/styles/interview-responsive.css` | `verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/styles/interview-session.css` | `verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/interview/styles/interview-shell.css` | `verify-fusion-w3.mjs`<br/>`verify-lightflow-k2c-interview.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairCompaniesPage.tsx` | `verify-jobfair-commercial-closure.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx` | `verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-page-size.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairMapPage.tsx` | `verify-jobfair-ui.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairMaterialsPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairStatsPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairVisitPlanPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairsServiceHubPage.tsx` | `verify-kiosk-frontend-debt.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/job-fairs/JobFairCheckinPage.tsx` | `verify-jobfair-checkin.mjs` |
| `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-checkin.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-page-size.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx` | `verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-jobfairs-terminal-priority.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/FairCalendarPopover.tsx` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/FairCompanyDetailSections.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/FairDataScreen.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/JobFairDetailTabs.tsx` | `verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/MapBlock.tsx` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/RegionPicker.tsx` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/jobs-fairs-prototype.css` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/jobs/JobDetailPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-job-ai-ui.mjs`<br/>`verify-job-info-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/pages/jobs/JobsPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-job-ai-ui.mjs`<br/>`verify-job-info-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/pages/jobs/JobsServiceHubPage.tsx` | `verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/jobs/components/JobAiConsentModal.tsx` | `verify-job-ai-ui.mjs` |
| `apps/kiosk/src/pages/jobs/components/JobAiResultPanel.tsx` | `verify-job-ai-ui.mjs` |
| `apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx` | `verify-job-ai-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/pages/jobs/components/ResumeSelectModal.tsx` | `verify-job-ai-ui.mjs` |
| `apps/kiosk/src/pages/jobs/components/W4Presentation.tsx` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/legal/LegalDocPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/legal/legal-service-desk.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `apps/kiosk/src/pages/offline-agencies/OfflineAgencyDetailPage.tsx` | `verify-backend-p0-contracts.mjs` |
| `apps/kiosk/src/pages/offline-agencies/OfflineJobDetailPage.tsx` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/placeholders/CampusWelcomePage.tsx` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/placeholders/ErrorOfflinePage.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/placeholders/FreshmanInsightsPage.tsx` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/placeholders/MeActivityDetailPage.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/placeholders/NotificationsPage.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/policy/PolicyServiceHubPage.tsx` | `verify-kiosk-frontend-debt.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-feedback-entry.mjs`<br/>`verify-p39-print-hub-fidelity.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/print-scan/SignStampPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/print-scan/components/V6PrintHubView.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-p39-print-hub-fidelity.mjs` |
| `apps/kiosk/src/pages/print-scan/printHubContent.ts` | `verify-p39-print-hub-fidelity.mjs` |
| `apps/kiosk/src/pages/print-scan/styles/print-hub-v6.css` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-p39-print-hub-fidelity.mjs` |
| `apps/kiosk/src/pages/print-scan/styles/print-scan-fusion.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print-scan/styles/print-scan-uplift.css` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/pages/print/CashierPaymentPanel.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-scan-input-safety.mjs` |
| `apps/kiosk/src/pages/print/DevSandboxControls.tsx` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/PrintCashierPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-feedback-entry.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-scan-input-safety.mjs` |
| `apps/kiosk/src/pages/print/PrintConfirmPage.tsx` | `verify-contract-review-report-print.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-price-single-source.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/print/PrintDonePage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-feedback-entry.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-done-truth.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs` |
| `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-scan-input-safety.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `apps/kiosk/src/pages/print/PrintPreviewPage.tsx` | `verify-device-status-honest.mjs`<br/>`verify-file-display-truth.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-price-single-source.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs` |
| `apps/kiosk/src/pages/print/PrintProgressPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs` |
| `apps/kiosk/src/pages/print/PrintPrototypeLayout.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-parameter-capability.mjs` |
| `apps/kiosk/src/pages/print/PrintUploadPage.tsx` | `verify-file-display-truth.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/print/cashierStatus.ts` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/components/MaterialCheckPresentation.tsx` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/print-prototype.css` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-print-cta-contrast.mjs` |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-entry-source-split.mjs` |
| `apps/kiosk/src/pages/print/printUsageEstimate.ts` | `verify-file-display-truth.mjs` |
| `apps/kiosk/src/pages/print/styles/print-cashier.css` | `verify-kiosk-visual-unity.mjs`<br/>`verify-print-cta-contrast.mjs` |
| `apps/kiosk/src/pages/print/styles/print-pickup-claim.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/styles/print-upload.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/profile/ProfilePage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/assets/format.ts` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/profile/assets/useMemberProfileOverview.ts` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/components/ProfileHeader.tsx` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/JobAiSessionRecords.tsx` | `verify-job-ai-history-privacy-ui.mjs`<br/>`verify-profile-ai-records-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MeListShell.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyActivityPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-ai-records-inkpaper.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-file-retention-ui.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs` |
| `apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx` | `verify-data-request-ui.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx` | `verify-data-request-ui.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-user-center-wave0.mjs` |
| `apps/kiosk/src/pages/profile/me/activityPresentation.ts` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/FeedbackDetailPanel.tsx` | `verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/FeedbackFormPanel.tsx` | `verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/FeedbackListPanel.tsx` | `verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/types.ts` | `verify-fusion-w5.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-ai-records-inkpaper.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/OrderPaymentSummary.tsx` | `verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/PickupCodePanel.tsx` | `verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/__fixtures__/member-print-orders-login-smoke.json` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/paymentCopy.ts` | `verify-fusion-w5.mjs`<br/>`verify-member-print-orders-ui.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/statusRefresh.ts` | `verify-fusion-w5.mjs`<br/>`verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/styles/me-assets.css` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/styles/me-detail-base.css` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/styles/me-orders.css` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/styles/me-records.css` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/styles/me-settings-feedback.css` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/profile-inkpaper.css` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/profile-lightflow-directory.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/profile-lightflow-shell.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/profile-lightflow-state.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/profileEntries.ts` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-user-center-wave0.mjs` |
| `apps/kiosk/src/pages/profile/profileTypes.ts` | `verify-fusion-w5.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/renshi/EligibilityPanel.tsx` | `verify-policy-eligibility-ui.mjs` |
| `apps/kiosk/src/pages/renshi/EligibilityResults.tsx` | `verify-policy-eligibility-ui.mjs` |
| `apps/kiosk/src/pages/renshi/NoticePanel.tsx` | `verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/PolicyPanel.tsx` | `verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/RegisterPanel.tsx` | `verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/RenshiPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-policy-eligibility-ui.mjs`<br/>`verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/SocialPanel.tsx` | `verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/builtinData.ts` | `verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/components.tsx` | `verify-policy-eligibility-ui.mjs`<br/>`verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/renshi/eligibilityOutcome.ts` | `verify-policy-eligibility-ui.mjs` |
| `apps/kiosk/src/pages/renshi/renshi-policy-fusion.css` | `verify-policy-eligibility-ui.mjs` |
| `apps/kiosk/src/pages/renshi/shared.ts` | `verify-policy-eligibility-ui.mjs`<br/>`verify-renshi-policy-ui.mjs` |
| `apps/kiosk/src/pages/resume/CareerPlanPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k2a-career.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/resume/JobFitActionsPage.tsx` | `verify-job-fit-m1-5-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/pages/resume/JobFitPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/resume/ResumeExportPage.tsx` | `verify-fusion-w3.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs` |
| `apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx` | `verify-ai-down-fallbacks.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/ResumeGeneratePreviewPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/resume/ResumeOptimizeComparePage.tsx` | `verify-ai-down-fallbacks.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx` | `verify-fusion-w3.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/resume/ResumeParsePage.tsx` | `verify-ai-down-fallbacks.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/ResumeReportPage.tsx` | `verify-ai-down-fallbacks.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/ResumeServiceHubPage.tsx` | `verify-kiosk-visible-actions-truth.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx` | `verify-ai-down-fallbacks.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx` | `verify-fusion-w3.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs` |
| `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/resume/aiResumeSession.ts` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/careerPlan-lightflow.css` | `verify-lightflow-k2a-career.mjs` |
| `apps/kiosk/src/pages/resume/components/DiagnosisDirectionForm.tsx` | `verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/components/OptimizedResumeEditor.tsx` | `verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/components/ResumeDiagnosisFailExits.tsx` | `verify-ai-down-fallbacks.mjs` |
| `apps/kiosk/src/pages/resume/components/ResumeLayoutControls.tsx` | `verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/components/ResumeTranscriptConfirmDialog.tsx` | `verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/components/ResumeUsbImportPanel.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/resume/components/ResumeVoiceInputButton.tsx` | `verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/hooks/useResumeLayout.ts` | `verify-fusion-w3.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/pages/resume/jobFit-inkpaper.css` | `verify-fusion-w3.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx` | `verify-job-fit-m1-5-ui.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx` | `verify-job-fit-m1-5-ui.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/DecisionSummaryBar.tsx` | `verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/FitSkillMap.tsx` | `verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/GapActionCards.tsx` | `verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/MemberJobFitConsentCard.tsx` | `verify-job-fit-m1-5-ui.mjs` |
| `apps/kiosk/src/pages/resume/jobFit/ResumeRewriteCard.tsx` | `verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/resume/jobMaterialDraft.ts` | `verify-fusion-w3.mjs`<br/>`verify-job-material-library-ui.mjs` |
| `apps/kiosk/src/pages/resume/resume-authoring-lightflow.css` | `verify-lightflow-k2b-ai-resume.mjs` |
| `apps/kiosk/src/pages/resume/resume-diagnosis-lightflow.css` | `verify-lightflow-k2b-ai-resume.mjs` |
| `apps/kiosk/src/pages/resume/resume-fusion-youth.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/resume-library-lightflow.css` | `verify-lightflow-k2b-ai-resume.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-authoring.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-common.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-diagnosis.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-job-fit.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-library.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/scan/ScanProgressPage.tsx` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/scan/ScanResultPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/scan/ScanSettingsPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-scan-session-truth.mjs` |
| `apps/kiosk/src/pages/scan/ScanStartPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-scan-session-truth.mjs` |
| `apps/kiosk/src/pages/scan/styles/scan-fusion.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-screensaver-empty-shell.mjs` |
| `apps/kiosk/src/pages/screensaver/screensaver-service-desk.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/session-resume/SessionResumePage.tsx` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/pages/smart-campus/FreshmanInsightsPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/smart-campus/SmartCampusGuard.tsx` | `verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/smart-campus/SmartCampusHomePage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/smart-campus/SmartCampusServicePage.tsx` | `verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/smart-campus/SmartCampusWelcomePage.tsx` | `verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/styles/campus-policy-fusion.css` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/styles/jobs-companies-fusion.css` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/styles/jobs-fairs-foundation.css` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/toolbox/ToolboxZonePage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-smart-campus-ui.mjs` |
| `apps/kiosk/src/pages/toolbox/toolbox-zone.css` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx` | `verify-fusion-shell.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/upload/phone-upload-service-desk.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/routes/index.tsx` | `verify-advisor-provider-gate.mjs`<br/>`verify-data-request-ui.mjs`<br/>`verify-fusion-baseline.mjs`<br/>`verify-fusion-shell.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-jobfair-checkin.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-ai-records-inkpaper.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-qr-login-ui.mjs`<br/>`verify-resume-phone-upload-ui.mjs`<br/>`verify-smart-campus-ui.mjs`<br/>`verify-visual-evidence-manifest.mjs`<br/>`frontend.mjs` |
| `apps/kiosk/src/services/api/activity.ts` | `verify-jobfair-checkin.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-activity-inkpaper.mjs` |
| `apps/kiosk/src/services/api/ai.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/services/api/aiHttpAdapter.ts` | `verify-member-session-closure.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/services/api/aiMockAdapter.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/services/api/benefitActivities.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/careerPlan.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/client.ts` | `verify-production-real-services.mjs` |
| `apps/kiosk/src/services/api/contractReview.ts` | `verify-contract-review-report-print.mjs`<br/>`verify-contract-review-session.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs` |
| `apps/kiosk/src/services/api/fairVisitPlan.ts` | `verify-jobfair-commercial-closure.mjs` |
| `apps/kiosk/src/services/api/filesHttpAdapter.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/filesMockAdapter.ts` | `verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/services/api/httpAdapter.ts` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/services/api/index.ts` | `verify-job-ai-ui.mjs`<br/>`verify-job-material-library-ui.mjs` |
| `apps/kiosk/src/services/api/interview.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/jobAi.ts` | `verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-ai-ui.mjs` |
| `apps/kiosk/src/services/api/jobAiHttpAdapter.ts` | `verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-ai-ui.mjs` |
| `apps/kiosk/src/services/api/jobFairs.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/services/api/jobFit.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/services/api/jobHttpAdapter.ts` | `verify-job-info-ui.mjs` |
| `apps/kiosk/src/services/api/jobMaterials.ts` | `verify-job-material-library-ui.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/services/api/kioskCapabilityValidation.ts` | `verify-fusion-w4.mjs`<br/>`verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/services/api/kioskFeedback.ts` | `verify-kiosk-feedback-entry.mjs` |
| `apps/kiosk/src/services/api/materials.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/memberAssets.ts` | `verify-file-retention-ui.mjs`<br/>`verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/memberFavorites.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/memberFeedback.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/memberNotifications.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/memberPrintOrders.ts` | `verify-member-session-closure.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs` |
| `apps/kiosk/src/services/api/memberPrivacy.ts` | `verify-data-request-ui.mjs` |
| `apps/kiosk/src/services/api/mockAdapter.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/services/api/offlineAgencies.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/services/api/pendingTasks.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/policy-eligibility.ts` | `verify-policy-eligibility-ui.mjs` |
| `apps/kiosk/src/services/api/printScanCapabilities.ts` | `verify-prod-build-config.mjs`<br/>`verify-runtime-terminal-identity.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/services/api/printSign.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/services/api/screensaver.ts` | `verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/services/api/selfAssessment.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/services/api/terminalConfig.ts` | `verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/services/api/toolboxLaunchEvents.ts` | `verify-home-toolbox-ui.mjs` |
| `apps/kiosk/src/services/api/uploadSessions.ts` | `verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/services/api/userErrorMessage.ts` | `verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/services/auth/memberAuthApi.ts` | `verify-member-session-closure.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/services/auth/memberAuthDevice.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/auth/memberQrLoginApi.ts` | `verify-qr-login-ui.mjs` |
| `apps/kiosk/src/services/auth/memberSessionEvents.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/files/usbImportApi.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/services/print/localPrintWakeApi.ts` | `verify-print-confirm-honest.mjs` |
| `apps/kiosk/src/services/print/paymentApi.ts` | `verify-print-confirm-honest.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/services/print/priceConfigApi.ts` | `verify-price-single-source.mjs` |
| `apps/kiosk/src/services/print/printJobsApi.ts` | `verify-print-confirm-honest.mjs`<br/>`verify-prod-build-config.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-runtime-terminal-identity.mjs` |
| `apps/kiosk/src/styles/ai-primitives.css` | `verify-kiosk-ai-primitives.mjs` |
| `apps/kiosk/src/styles/kiosk-stage-fit.css` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/styles/kiosk-uplift.css` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/styles/prototype-v1.css` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/styles/warm-professional-override.css` | `verify-device-status-honest.mjs`<br/>`verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/utils/micCapability.ts` | `verify-mic-capability-truth.mjs` |
| `apps/kiosk/src/utils/wavRecorder.ts` | `verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/vite-env.d.ts` | `verify-assistant-trtc-guard.mjs` |

</details>

<details>
<summary><code>apps/kiosk/tests/</code> — 22 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/tests/fixtures/api-router.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/fixtures/fusion-w4-api.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/fixtures/fusion-w2-binary-route.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/tests/visual/fixtures/fusion-w6-api.ts` | `verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs` |
| `apps/kiosk/tests/visual/fixtures/fusion-w6-route-cases.ts` | `verify-fusion-w6.mjs`<br/>`verify-print-done-truth.mjs` |
| `apps/kiosk/tests/visual/fixtures/kiosk-p1-evidence-capture-api.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/fixtures/kiosk-p1-visual-evidence-targets.ts` | `verify-fusion-w4.mjs`<br/>`verify-visual-evidence-manifest.mjs` |
| `apps/kiosk/tests/visual/fusion-self-assessment-flow.spec.ts` | `verify-fusion-w3.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-self-assessment-r3-pick.mjs` |
| `apps/kiosk/tests/visual/fusion-smoke.spec.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/fusion-w2-print.spec.ts` | `verify-fusion-w6.mjs` |
| `apps/kiosk/tests/visual/fusion-w2-scan.spec.ts` | `verify-fusion-w6.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/tests/visual/fusion-w2-tools.spec.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/tests/visual/fusion-w3.spec.ts` | `verify-fusion-w3.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/tests/visual/fusion-w4.spec.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/fusion-w5.spec.ts` | `verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs` |
| `apps/kiosk/tests/visual/fusion-w6-routes.spec.ts` | `verify-fusion-w6.mjs` |
| `apps/kiosk/tests/visual/kiosk-p1-visual-evidence.spec.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/kiosk-privacy-timeout.spec.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/kiosk-visible-actions-truth.spec.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/print-done-truth.spec.ts` | `verify-fusion-w4.mjs`<br/>`verify-print-done-truth.mjs` |
| `apps/kiosk/tests/visual/route-manifest.ts` | `verify-fusion-baseline.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-visual-evidence-manifest.mjs` |
| `apps/kiosk/tests/visual/scan-session-truth.spec.ts` | `verify-fusion-w4.mjs` |

</details>

<details>
<summary><code>apps/kiosk/vite.config.ts/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/vite.config.ts` | `verify-deploy-vite-env-coverage.mjs` |

</details>

<details>
<summary><code>apps/miniapp/app.js/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/app.js` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/miniapp/app.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/app.json` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/miniapp/custom-tab-bar/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/custom-tab-bar/index.js` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/miniapp/pages/</code> — 19 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/pages/ai-records/ai-records.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/ai/ai.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/career-plan/career-plan.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/documents/documents.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/help/help.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/job-fit/job-fit.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/launch/launch.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/me/me.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/membership/membership.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/notifications/notifications.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/order-detail/order-detail.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/orders/orders.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/package-code/package-code.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/print-pay/print-pay.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/print-pickup/print-pickup.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/print-store/print-store.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/print-upload/print-upload.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/print/print.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/pages/settings/settings.js` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/miniapp/project.config.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/project.config.json` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/miniapp/scripts/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/scripts/verify-miniapp-static.mjs` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/miniapp/utils/</code> — 6 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/miniapp/utils/api.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/utils/auth.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/utils/config.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/utils/pickup-qrcode.js` | `verify-miniapp-static.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `apps/miniapp/utils/request.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/utils/storage.js` | `verify-miniapp-static.mjs` |

</details>

<details>
<summary><code>apps/partner/scripts/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/partner/scripts/verify-excel-template-download-ui.mjs` | `verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>apps/partner/src/</code> — 17 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/partner/src/layouts/PartnerLayoutWrapper.tsx` | `verify-service-desk-jobs-ui.mjs` |
| `apps/partner/src/routes/account/index.tsx` | `verify-honest-placeholders.mjs`<br/>`verify-partner-stats-contract.mjs` |
| `apps/partner/src/routes/index.tsx` | `frontend.mjs` |
| `apps/partner/src/routes/jobs/components/JobQualitySummaryPanel.tsx` | `verify-job-quality-dashboard-ui.mjs` |
| `apps/partner/src/routes/jobs/index.tsx` | `verify-job-quality-dashboard-ui.mjs`<br/>`verify-service-desk-jobs-ui.mjs` |
| `apps/partner/src/routes/login/index.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/partner/src/routes/sources/ExcelImportModal.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-excel-template-download-ui.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `apps/partner/src/routes/sources/index.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `apps/partner/src/routes/stats/index.tsx` | `verify-partner-stats-contract.mjs` |
| `apps/partner/src/routes/terminals/index.tsx` | `verify-honest-placeholders.mjs`<br/>`verify-partner-stats-contract.mjs` |
| `apps/partner/src/services/api/client.ts` | `verify-partner-relative-api-url.mjs` |
| `apps/partner/src/services/api/partnerContent.ts` | `verify-excel-template-download-ui.mjs` |
| `apps/partner/src/services/api/partnerHttpAdapter.ts` | `verify-excel-template-download-ui.mjs`<br/>`verify-job-quality-dashboard-ui.mjs`<br/>`verify-partner-relative-api-url.mjs` |
| `apps/partner/src/services/api/partnerMockAdapter.ts` | `verify-excel-template-download-ui.mjs`<br/>`verify-job-quality-dashboard-ui.mjs` |
| `apps/partner/src/services/api/stats.ts` | `verify-partner-stats-contract.mjs` |
| `apps/partner/src/services/api/types.ts` | `verify-job-quality-dashboard-ui.mjs` |
| `apps/partner/src/services/auth/index.ts` | `verify-admin-account-settings-ui.mjs` |

</details>

<details>
<summary><code>apps/terminal-agent/config/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/terminal-agent/config/agent-config.example.json` | `verify-printer-config.mjs` |

</details>

<details>
<summary><code>apps/terminal-agent/installer/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/terminal-agent/installer/verify-installer-inputs.mjs` | `verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>apps/terminal-agent/scripts/</code> — 4 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/terminal-agent/scripts/diagnose-production-agent.ps1` | `verify-agent-unauthorized.mjs` |
| `apps/terminal-agent/scripts/install-production-agent.ps1` | `verify-agent-unauthorized.mjs` |
| `apps/terminal-agent/scripts/verify-usb-import-agent.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/scripts/verify-windows-service-recovery.mjs` | `verify-agent-unauthorized.mjs` |

</details>

<details>
<summary><code>apps/terminal-agent/src/</code> — 17 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/terminal-agent/src/agent/api-client.ts` | `verify-agent-unauthorized.mjs` |
| `apps/terminal-agent/src/agent/auth-state.ts` | `verify-agent-unauthorized.mjs` |
| `apps/terminal-agent/src/agent/config-manager.ts` | `verify-agent-config-resilience.mjs`<br/>`verify-agent-unauthorized.mjs`<br/>`verify-printer-config.mjs` |
| `apps/terminal-agent/src/agent/db.ts` | `verify-print-scan-agent.mjs` |
| `apps/terminal-agent/src/agent/heartbeat.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-print-scan-agent.mjs` |
| `apps/terminal-agent/src/agent/offline-queue.ts` | `verify-agent-unauthorized.mjs` |
| `apps/terminal-agent/src/agent/profile-guard.ts` | `verify-agent-profile-guard.mjs` |
| `apps/terminal-agent/src/agent/scan-watcher.ts` | `verify-agent-unauthorized.mjs` |
| `apps/terminal-agent/src/agent/startup-diagnostics.ts` | `verify-agent-config-resilience.mjs` |
| `apps/terminal-agent/src/agent/task-runner.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-print-scan-agent.mjs`<br/>`verify-printer-config.mjs` |
| `apps/terminal-agent/src/agent/types.ts` | `verify-print-scan-agent.mjs` |
| `apps/terminal-agent/src/config.ts` | `verify-printer-config.mjs` |
| `apps/terminal-agent/src/index.ts` | `verify-agent-config-resilience.mjs`<br/>`verify-agent-profile-guard.mjs`<br/>`verify-agent-unauthorized.mjs`<br/>`verify-print-scan-agent.mjs`<br/>`verify-printer-config.mjs` |
| `apps/terminal-agent/src/local-api/qr-login-server.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/src/local-api/types.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/src/local-api/wire.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/src/printer/print.ts` | `verify-printer-config.mjs` |

</details>

<details>
<summary><code>docs/acceptance/kiosk-8177-5299-fusion-visual-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/kiosk-8177-5299-fusion-visual-runbook.md` | `verify-fusion-w4.mjs`<br/>`verify-visual-evidence-manifest.mjs` |

</details>

<details>
<summary><code>docs/acceptance/member-print-orders-login-smoke.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/member-print-orders-login-smoke.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs` |

</details>

<details>
<summary><code>docs/acceptance/profile-commercial-preprod-redeploy-and-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/profile-commercial-preprod-redeploy-and-acceptance.md` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |

</details>

<details>
<summary><code>docs/acceptance/user-center-wave0-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-center-wave0-acceptance.md` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>docs/compliance/contract-review-release-gate.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/compliance/contract-review-release-gate.md` | `verify-fusion-w4.mjs` |

</details>

<details>
<summary><code>docs/compliance/launch-review-submissions.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/compliance/launch-review-submissions.md` | `verify-legal-retention-copy.mjs` |

</details>

<details>
<summary><code>docs/design/kiosk-ai-os-v3-2026-08/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/design/kiosk-ai-os-v3-2026-08/39-print-hub.html` | `verify-p39-print-hub-fidelity.mjs` |

</details>

<details>
<summary><code>docs/design/kiosk-proto-2026-07/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/design/kiosk-proto-2026-07/73-assistant-call.html` | `verify-visual-evidence-manifest.mjs` |

</details>

<details>
<summary><code>docs/design/kiosk-proto-2026-07-migration-matrix.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/design/kiosk-proto-2026-07-migration-matrix.md` | `verify-fusion-baseline.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-visual-evidence-manifest.mjs` |

</details>

<details>
<summary><code>docs/product/feature-scope.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/product/feature-scope.md` | `verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>docs/product/user-center-commercial-closure-plan-2026-07.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/product/user-center-commercial-closure-plan-2026-07.md` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>docs/product/user-data-flow-matrix.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/product/user-data-flow-matrix.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |

</details>

<details>
<summary><code>docs/progress/current-progress.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/progress/current-progress.md` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-self-assessment-r3-pick.mjs` |

</details>

<details>
<summary><code>docs/progress/next-tasks.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/progress/next-tasks.md` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |

</details>

<details>
<summary><code>docs/progress/today-claude.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/progress/today-claude.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>docs/reviews/2026-08-02-self-assessment-v1-three-model-review.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/reviews/2026-08-02-self-assessment-v1-three-model-review.md` | `verify-self-assessment-r3-pick.mjs` |

</details>

<details>
<summary><code>docs/reviews/self-assessment-v1-review-scope.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/reviews/self-assessment-v1-review-scope.md` | `verify-self-assessment-r3-pick.mjs` |

</details>

<details>
<summary><code>docs/reviews/user-center-commercial-closure-audit-2026-07-16.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/reviews/user-center-commercial-closure-audit-2026-07-16.md` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>docs/superpowers/plans/</code> — 10 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/superpowers/plans/2026-07-04-print-status-tracking-ui.md` | `verify-profile-inkpaper-home.mjs` |
| `docs/superpowers/plans/2026-07-04-profile-commercial-first-batch-execution.md` | `verify-profile-documents-inkpaper.mjs` |
| `docs/superpowers/plans/2026-07-12-sign-stamp-implementation.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `docs/superpowers/plans/2026-07-16-user-center-wave0-truth-baseline.md` | `verify-profile-commercial-first-batch.mjs` |
| `docs/superpowers/plans/2026-07-16-user-center-wave0-wave1-program.md` | `verify-profile-commercial-first-batch.mjs` |
| `docs/superpowers/plans/2026-07-16-user-center-wave1-account-security.md` | `verify-profile-commercial-first-batch.mjs` |
| `docs/superpowers/plans/2026-07-16-user-center-wave1-data-rights.md` | `verify-profile-commercial-first-batch.mjs` |
| `docs/superpowers/plans/2026-07-16-user-center-wave1-ops-ui.md` | `verify-profile-commercial-first-batch.mjs` |
| `docs/superpowers/plans/2026-07-24-kiosk-8177-5299-fusion-w4.md` | `verify-fusion-w4.mjs` |
| `docs/superpowers/plans/2026-07-26-kiosk82-visual-evidence-and-truth-batch2.md` | `verify-fusion-w4.mjs` |

</details>

<details>
<summary><code>docs/superpowers/specs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/superpowers/specs/2026-07-12-sign-stamp-design.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>package.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `package.json` | `verify-service-desk-dashboard-ui.mjs`<br/>`verify-miniapp-static.mjs`<br/>`verify-dependency-security.mjs` |

</details>

<details>
<summary><code>packages/shared/src/</code> — 15 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `packages/shared/src/index.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/pickupCode.ts` | `verify-backend-p0-contracts.mjs` |
| `packages/shared/src/types/adminUsers.ts` | `verify-admin-users-ui.mjs` |
| `packages/shared/src/types/ai.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/complianceCopy.ts` | `verify-legal-retention-copy.mjs`<br/>`verify-compliance-copy.mjs` |
| `packages/shared/src/types/fairDto.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/file.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/job.ts` | `verify-job-quality-dashboard-ui.mjs` |
| `packages/shared/src/types/jobMaterials.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/member-privacy.ts` | `verify-profile-commercial-first-batch.mjs` |
| `packages/shared/src/types/memberPrivacy.ts` | `verify-data-request-ui.mjs` |
| `packages/shared/src/types/mockInterview.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/print.ts` | `verify-print-parameter-capability.mjs` |
| `packages/shared/src/types/printSign.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/uploadSession.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>packages/ui/src/</code> — 12 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `packages/ui/src/components/Drawer.tsx` | `verify-admin-users-ui.mjs` |
| `packages/ui/src/components/KioskPageFrame.tsx` | `verify-kiosk-visual-unity.mjs` |
| `packages/ui/src/components/KioskTopbar.tsx` | `verify-kiosk-visual-unity.mjs` |
| `packages/ui/src/index.ts` | `verify-fusion-youth-foundation.mjs`<br/>`verify-service-desk-foundation.mjs` |
| `packages/ui/src/layouts/AdminLayout.tsx` | `verify-service-desk-foundation.mjs` |
| `packages/ui/src/layouts/KioskLayout.tsx` | `verify-fusion-shell.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-service-desk-foundation.mjs` |
| `packages/ui/src/layouts/PartnerLayout.tsx` | `verify-service-desk-foundation.mjs` |
| `packages/ui/src/styles/fusion-youth.css` | `verify-kiosk-visual-unity.mjs`<br/>`verify-fusion-youth-foundation.mjs` |
| `packages/ui/src/styles/kiosk-components.css` | `verify-kiosk-visual-unity.mjs` |
| `packages/ui/src/styles/kiosk-shell.css` | `verify-kiosk-visual-unity.mjs` |
| `packages/ui/src/styles/service-desk.css` | `verify-service-desk-foundation.mjs` |
| `packages/ui/src/theme/visualTheme.ts` | `verify-fusion-youth-foundation.mjs`<br/>`verify-service-desk-foundation.mjs` |

</details>

<details>
<summary><code>scripts/ci-gate-exemptions.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/ci-gate-exemptions.json` | `verify-ci-gate-coverage.mjs` |

</details>

<details>
<summary><code>scripts/generate-project-graph.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/generate-project-graph.mjs` | `orphans.mjs` |

</details>

<details>
<summary><code>scripts/mock-server-contract-bindings.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/mock-server-contract-bindings.json` | `verify-mock-server-contract.mjs` |

</details>

<details>
<summary><code>scripts/project-graph-query.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph-query.mjs` | `orphans.mjs` |

</details>

<details>
<summary><code>services/api/package.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/package.json` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |

</details>

<details>
<summary><code>services/api/prisma/</code> — 7 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/prisma/migrations/20260711120000_add_fair_material_print_bridge/migration.sql` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/prisma/migrations/20260712090000_add_job_fit_anonymous_consent/migration.sql` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/prisma/postgres/migrations/20260711120000_add_fair_material_print_bridge/migration.sql` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/prisma/postgres/migrations/20260712090000_add_job_fit_anonymous_consent/migration.sql` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/prisma/postgres/migrations/20260805132000_repair_notification_legal_defaults/migration.sql` | `verify-fusion-w4.mjs` |
| `services/api/prisma/postgres/schema.prisma` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/prisma/schema.prisma` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>services/api/scripts/</code> — 32 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/scripts/d2-same-host/governance.mjs` | `verify-governance-invocation.mjs` |
| `services/api/scripts/lib/verify-governed-job-fit-runtime.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-admin-fairs.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-benefit-redemption.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-career-plan.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-change-password.ts` | `run-verify-change-password.mjs` |
| `services/api/scripts/verify-contract-review-contract.ts` | `verify-fusion-w4.mjs` |
| `services/api/scripts/verify-fair-company-positions.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-fair-info-fields.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-fair-visit-plan.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-governed-job-fit.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-http-exception-filter.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-job-ai-backend.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-job-ai-privacy.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-job-fit-governance.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-job-fit-print.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-job-fit.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-job-materials.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-jobfair-venue-guide.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-kiosk-cashier-ui.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-member-assets.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-member-data-request-truth.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-member-step-up.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-partner-excel-import.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-payment-flow.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-print-scan-first-release.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-print-sign.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-production-real-services.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-production-runtime-gates.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-profile-commercial-first-batch-acceptance.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-upload-sessions.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-wave2-account-rebind.ts` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>services/api/src/</code> — 84 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/src/ai/ai.module.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/ai/job-fit.controller.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/ai/resume/appended-self-assessment.service.ts` | `verify-self-assessment-r3-pick.mjs` |
| `services/api/src/ai/resume/career-plan.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-self-assessment-r3-pick.mjs` |
| `services/api/src/ai/resume/fair-visit-plan.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/ai/resume/job-fit-pdf.service.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/ai/resume/job-fit.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `services/api/src/ai/resume/llm-career-plan.service.ts` | `verify-self-assessment-r3-pick.mjs` |
| `services/api/src/ai/resume/llm-job-fit.service.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/ai/resume/resume-pdf.service.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/ai/resume/self-assessment.service.ts` | `verify-self-assessment-r3-pick.mjs` |
| `services/api/src/ai/self-assessment.controller.ts` | `verify-self-assessment-r3-pick.mjs` |
| `services/api/src/app.module.ts` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/audit/audit.types.ts` | `verify-self-assessment-r3-pick.mjs` |
| `services/api/src/common/filters/http-exception.filter.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/src/common/pickup-code.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/config/production-runtime-gates.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/src/files/dto/kiosk-upload-options.dto.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/files/file-validation.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-self-assessment-r3-pick.mjs` |
| `services/api/src/files/file.types.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/files/files.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/files/retention-policy.ts` | `verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/files/signing.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/job-ai/governed-job-fit.service.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/job-ai/job-ai.controller.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/job-ai/job-ai.module.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/job-ai/job-ai.service.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/job-materials/job-materials.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/job-materials/job-materials.types.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/job-sync/job-sync.controller.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/job-sync/job-sync.service.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/jobs/admin-fairs.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/fair-material-print-bridge.cleanup.task.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/fair-material-print-bridge.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/fair-material.service.ts` | `verify-ai-artifact-print-url-contract.mjs` |
| `services/api/src/jobs/jobs-excel.service.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/jobs-partner.service.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `services/api/src/jobs/jobs-shared.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/jobs.controller.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/jobs.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/jobs.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/partner-capabilities.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/jobs/partner-import-file.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/src/member-assets/member-assets.controller.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-assets/member-assets.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/member-auth/dto/phone-rebind.dto.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-auth/member-auth.controller.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-auth/member-auth.module.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-auth/member-phone-rebind.service.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-auth/member-step-up.types.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-feedback/dto/kiosk-feedback.dto.ts` | `verify-kiosk-feedback-entry.mjs` |
| `services/api/src/member-print-orders/member-print-order-create.service.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/member-privacy/member-data-export.mapper.ts` | `verify-data-request-ui.mjs` |
| `services/api/src/member-privacy/member-data-request.service.ts` | `verify-data-request-ui.mjs` |
| `services/api/src/member-privacy/member-privacy.service.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/mock-interview/interview-practice-sheet-pdf.service.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/mock-interview/interview-practice-sheet.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/mock-interview/mock-interview.controller.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/mock-interview/mock-interview.module.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/mock-interview/mock-interview.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/offline-agencies/admin-offline-agencies.controller.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/offline-agencies/offline-agencies.service.ts` | `verify-fusion-w4.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `services/api/src/orgs/admin-org-content-trust.service.ts` | `verify-admin-content-trust-ui.mjs` |
| `services/api/src/orgs/admin-orgs.controller.ts` | `verify-admin-content-trust-ui.mjs` |
| `services/api/src/payment/online-payment.service.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/src/payment/order-status.service.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/payment/payment-session-token.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/src/payment/payment.controller.ts` | `verify-price-single-source.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/src/payment/pricing.service.ts` | `verify-price-single-source.mjs` |
| `services/api/src/print-jobs/dto/claim-pickup.dto.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/print-jobs/pickup-claim-lockout.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/print-jobs/pickup-order.service.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/print-jobs/print-jobs.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign-geometry.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.controller.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.dto.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.types.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/prisma/prisma.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/storage/object-key.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/sync/sync.controller.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/sync/sync.service.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/upload-sessions/upload-sessions.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |

</details>
