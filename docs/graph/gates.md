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

## 无脚本名：文件存在，但从未被执行（1）

判定：文件在 `scripts/` 下、不是被别的门禁 import 的辅助库、且没有任何
workspace 包的 `package.json` scripts 指向它。

| 门禁脚本 | 断言文件数 |
| --- | --- |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | 3 |

──────────────────────────────────────────────────────────────────────

## 有脚本名但不在 CI 执行闭包里（7）

这一栏是**尽力而为的推断**，权威是 `verify:ci-gate-coverage` 加
`scripts/ci-gate-exemptions.json`。已在豁免清单里登记的（需要真实凭证 / 真机 /
本地服务）出现在这里是正常的。

| 门禁脚本 | 脚本名 |
| --- | --- |
| `scripts/generate-project-graph.mjs` | `ai-job-print-terminal::graph`<br/>`ai-job-print-terminal::graph:check` |
| `scripts/project-graph-query.mjs` | `ai-job-print-terminal::graph:query` |
| `scripts/verify-deploy-authorization-gate.mjs` | `ai-job-print-terminal::verify:deploy-authorization-gate` |
| `services/api/scripts/verify-cos-live.ts` | `@ai-job-print/api::verify:cos:live` |
| `services/api/scripts/verify-llm-connectivity.ts` | `@ai-job-print/api::verify:llm-connectivity` |
| `services/api/scripts/verify-ocr-baidu-live.ts` | `@ai-job-print/api::verify:ocr-baidu-live` |
| `services/api/scripts/verify-upload-sessions-http.ts` | `@ai-job-print/api::verify:upload-sessions:http` |

──────────────────────────────────────────────────────────────────────

## 断言了不存在的路径（5）

门禁里写着某个仓库路径，但该路径在 git 里不存在。可能是文件被移动/删除后门禁
没跟着改 —— 这类断言往往已经恒真或恒假，需要人确认。

| 门禁脚本 | 找不到的路径 |
| --- | --- |
| `apps/admin/scripts/verify-partner-account-delete-ui.mjs` | `src/routes/partners/PartnerAccountDeletionDialog.tsx` |
| `apps/kiosk/scripts/verify-fusion-w4.mjs` | `services/api/prisma/postgres/migrations/20260802120000_add_wx_open_id_to_end_user/migration.sql` |
| `apps/kiosk/scripts/verify-profile-commercial-first-batch.mjs` | `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs` |
| `services/api/scripts/verify-policy-eligibility-authoring.ts` | `services/api/policies.ts` |
| `services/api/scripts/verify-wave2-account-rebind.ts` | `services/auth/memberAuthApi.ts` |

──────────────────────────────────────────────────────────────────────

## 反向索引：文件 → 断言它的门禁

**改文件前查这里**，就知道会红哪条门禁。共 1230 个文件被至少一条门禁断言。

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
| `.github/workflows/ci.yml` | `verify-data-request-ui.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-ai-ui.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-lightflow-k2b-ai-resume.mjs`<br/>`verify-lightflow-k2c-interview.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-mic-capability-truth.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-service-desk-foundation.mjs`<br/>`gates.mjs`<br/>`verify-ci-gate-coverage.mjs`<br/>`verify-contract-review-preprod-readiness.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-job-ai-privacy.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-info-ai-real-acceptance.ts`<br/>`verify-partner-excel-template.ts`<br/>`verify-policy-eligibility-authoring.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-profile-commercial-first-batch-acceptance.ts` |

</details>

<details>
<summary><code>.github/workflows/deploy.yml/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `.github/workflows/deploy.yml` | `verify-deploy-vite-env-coverage.mjs`<br/>`verify-deploy-authorization-gate.mjs` |

</details>

<details>
<summary><code>apps/admin/package.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/admin/package.json` | `verify-service-desk-dashboard-ui.mjs`<br/>`verify-data-request-ui.mjs` |

</details>

<details>
<summary><code>apps/admin/scripts/</code> — 3 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/admin/scripts/support/admin-phone-transfer-ui-contract.mjs` | `verify-admin-phone-transfer-ui.mjs` |
| `apps/admin/scripts/verify-admin-file-lifecycle.mjs` | `verify-profile-documents-inkpaper.mjs` |
| `apps/admin/scripts/verify-honest-placeholders.mjs` | `verify-partner-stats-contract.mjs` |

</details>

<details>
<summary><code>apps/admin/src/</code> — 69 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/admin/src/layouts/AdminLayoutWrapper.tsx` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-billing-ui.mjs`<br/>`verify-admin-content-trust-ui.mjs`<br/>`verify-admin-job-materials-ui.mjs`<br/>`verify-admin-print-scan-ui.mjs`<br/>`verify-service-desk-dashboard-ui.mjs`<br/>`verify-data-request-ui.mjs`<br/>`verify-legal-doc-version.ts` |
| `apps/admin/src/routes/account-settings/AdminInitialPhoneBindingCard.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/admin/src/routes/account-settings/AdminPhoneTransferCard.tsx` | `verify-admin-phone-transfer-ui.mjs` |
| `apps/admin/src/routes/account-settings/PhoneBindingCard.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/admin/src/routes/account-settings/index.tsx` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-phone-transfer-ui.mjs` |
| `apps/admin/src/routes/ai-services/index.tsx` | `verify-job-ai-ops-dashboard-ui.mjs` |
| `apps/admin/src/routes/billing/index.tsx` | `verify-admin-billing-ui.mjs` |
| `apps/admin/src/routes/components/BulkPublishButton.tsx` | `verify-admin-content-trust-ui.mjs` |
| `apps/admin/src/routes/dashboard/index.tsx` | `verify-service-desk-dashboard-ui.mjs` |
| `apps/admin/src/routes/devices/TerminalFleetOverview.tsx` | `verify-admin-device-fleet-overview-ui.mjs` |
| `apps/admin/src/routes/devices/index.tsx` | `verify-admin-device-fleet-overview-ui.mjs` |
| `apps/admin/src/routes/fair-sources/index.tsx` | `verify-source-publish-actions.mjs`<br/>`verify-jobfair-checkin.ts` |
| `apps/admin/src/routes/files/index.tsx` | `verify-profile-documents-inkpaper.mjs` |
| `apps/admin/src/routes/index.tsx` | `verify-admin-account-settings-ui.mjs`<br/>`verify-admin-billing-ui.mjs`<br/>`verify-admin-job-materials-ui.mjs`<br/>`verify-admin-print-scan-ui.mjs`<br/>`verify-data-request-ui.mjs`<br/>`frontend.mjs` |
| `apps/admin/src/routes/job-materials/index.tsx` | `verify-admin-job-materials-ui.mjs` |
| `apps/admin/src/routes/job-sources/index.tsx` | `verify-source-publish-actions.mjs`<br/>`verify-job-content-screening.ts` |
| `apps/admin/src/routes/legal-docs/index.tsx` | `verify-legal-doc-version.ts` |
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
| `apps/admin/src/routes/print-scan/index.tsx` | `verify-admin-print-scan-ui.mjs`<br/>`verify-print-color-duplex-capability.ts` |
| `apps/admin/src/routes/sync-sources/index.tsx` | `verify-backend-p0-contracts.mjs` |
| `apps/admin/src/routes/terminals/CreatePlannedTerminalDialog.tsx` | `verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/routes/terminals/TerminalBindCodeDialog.tsx` | `verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/routes/terminals/TerminalLifecycleActions.tsx` | `verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/routes/terminals/TerminalNetworkDiagnostics.tsx` | `verify-admin-terminal-network-diagnostics-ui.mjs` |
| `apps/admin/src/routes/terminals/index.tsx` | `verify-admin-terminal-bind-code-ui.mjs`<br/>`verify-admin-terminal-network-diagnostics-ui.mjs`<br/>`verify-print-scan-first-release.ts`<br/>`verify-terminal-device-config.ts` |
| `apps/admin/src/routes/toolbox/components/TerminalToolboxPanel.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/TerminalToolboxRow.tsx` | `verify-toolbox-review-ui.mjs`<br/>`verify-terminal-device-config.ts` |
| `apps/admin/src/routes/toolbox/components/ToolboxAllowedHostPanel.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/ToolboxGovernancePanel.tsx` | `verify-toolbox-review-ui.mjs` |
| `apps/admin/src/routes/toolbox/components/ToolboxLaunchSummaryCard.tsx` | `verify-toolbox-review-ui.mjs`<br/>`verify-toolbox-launch-events.ts` |
| `apps/admin/src/routes/toolbox/constants.ts` | `verify-toolbox-review-ui.mjs`<br/>`verify-terminal-device-config.ts` |
| `apps/admin/src/routes/toolbox/index.tsx` | `verify-toolbox-review-ui.mjs`<br/>`verify-toolbox-launch-events.ts` |
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
| `apps/admin/src/services/api/companiesAdmin.ts` | `verify-companies.ts` |
| `apps/admin/src/services/api/devices.ts` | `verify-admin-device-fleet-overview-ui.mjs`<br/>`verify-admin-terminal-bind-code-ui.mjs` |
| `apps/admin/src/services/api/files.ts` | `verify-admin-file-lifecycle.mjs` |
| `apps/admin/src/services/api/jobMaterials.ts` | `verify-admin-job-materials-ui.mjs` |
| `apps/admin/src/services/api/memberPrivacyAdmin.ts` | `verify-data-request-ui.mjs` |
| `apps/admin/src/services/api/offlineAgenciesAdmin.ts` | `verify-backend-p0-contracts.mjs` |
| `apps/admin/src/services/api/orgsAdmin.ts` | `verify-partner-account-action-ui.mjs`<br/>`verify-partner-account-delete-ui.mjs` |
| `apps/admin/src/services/api/printScan.ts` | `verify-admin-print-scan-ui.mjs`<br/>`verify-print-color-duplex-capability.ts` |
| `apps/admin/src/services/api/toolbox.ts` | `verify-toolbox-review-ui.mjs`<br/>`verify-toolbox-launch-events.ts` |
| `apps/admin/src/services/api/types.ts` | `verify-admin-device-fleet-overview-ui.mjs`<br/>`verify-admin-terminal-bind-code-ui.mjs`<br/>`verify-admin-terminal-network-diagnostics-ui.mjs`<br/>`verify-job-ai-ops-dashboard-ui.mjs`<br/>`verify-jobfair-checkin.ts`<br/>`verify-print-scan-first-release.ts` |
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
<summary><code>apps/kiosk/scripts/</code> — 35 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/kiosk/scripts/lib/fusion-baseline-contract.mjs` | `verify-fusion-baseline.mjs` |
| `apps/kiosk/scripts/verify-ai-artifact-print-url-contract.mjs` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/scripts/verify-fusion-baseline.mjs` | `verify-fusion-w4.mjs` |
| `apps/kiosk/scripts/verify-fusion-home.mjs` | `verify-fusion-w4.mjs`<br/>`verify-home-narrow-visual-balance.mjs`<br/>`verify-home-prototype-v1.mjs` |
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
<summary><code>apps/kiosk/src/</code> — 355 个文件</summary>

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
| `apps/kiosk/src/hooks/useSmartCampusConfig.ts` | `verify-fusion-w4.mjs`<br/>`verify-terminal-device-config.ts` |
| `apps/kiosk/src/hooks/useTerminalDeviceStatus.ts` | `verify-device-status-honest.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/hooks/useToolboxConfig.ts` | `verify-fusion-w4.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-terminal-device-config.ts` |
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
| `apps/kiosk/src/pages/assistant/AssistantPage.tsx` | `verify-advisor-provider-gate.mjs`<br/>`verify-assistant-trtc-guard.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-lightflow-k2a-ai-career.mjs`<br/>`verify-toolbox-ai-skill-intents.ts` |
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
| `apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-legal-doc-version.ts` |
| `apps/kiosk/src/pages/auth/login.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/mobile-qr-service-desk.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-dialog.css` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-member-login-dialog.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-form.css` | `verify-lightflow-k1-public-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-keypad.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-responsive.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/auth/styles/login-shell.css` | `verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/pages/campus/CampusPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-page-size.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-activity-logs.ts` |
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
| `apps/kiosk/src/pages/home/HomePage.tsx` | `verify-device-status-honest.mjs`<br/>`verify-fusion-home.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-member-login-dialog.mjs`<br/>`verify-service-entry-readiness.mjs`<br/>`verify-smart-campus-ui.mjs`<br/>`verify-terminal-device-config.ts` |
| `apps/kiosk/src/pages/home/components/ContinuePanel.tsx` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/home/components/ToolboxLaunchModals.tsx` | `verify-fusion-w5.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-toolbox-launch-events.ts` |
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
| `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx` | `verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-page-size.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-activity-logs.ts` |
| `apps/kiosk/src/pages/job-fairs/FairMapPage.tsx` | `verify-jobfair-ui.mjs`<br/>`verify-kiosk-visible-actions-truth.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairMaterialsPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairStatsPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairVisitPlanPage.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/job-fairs/FairsServiceHubPage.tsx` | `verify-kiosk-frontend-debt.mjs`<br/>`verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/job-fairs/JobFairCheckinPage.tsx` | `verify-jobfair-checkin.mjs` |
| `apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-checkin.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-page-size.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-activity-logs.ts` |
| `apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx` | `verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-jobfairs-terminal-priority.mjs`<br/>`verify-activity-logs.ts` |
| `apps/kiosk/src/pages/job-fairs/components/FairCalendarPopover.tsx` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/FairCompanyDetailSections.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-kiosk-frontend-debt.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/FairDataScreen.tsx` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/JobFairDetailTabs.tsx` | `verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/MapBlock.tsx` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/job-fairs/components/RegionPicker.tsx` | `verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/jobs-fairs-prototype.css` | `verify-fusion-w4.mjs`<br/>`verify-jobfair-ui.mjs` |
| `apps/kiosk/src/pages/jobs/JobDetailPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-job-ai-ui.mjs`<br/>`verify-job-info-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-activity-logs.ts` |
| `apps/kiosk/src/pages/jobs/JobsPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-job-ai-ui.mjs`<br/>`verify-job-info-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/pages/jobs/JobsServiceHubPage.tsx` | `verify-service-entry-readiness.mjs` |
| `apps/kiosk/src/pages/jobs/components/JobAiConsentModal.tsx` | `verify-job-ai-ui.mjs` |
| `apps/kiosk/src/pages/jobs/components/JobAiResultPanel.tsx` | `verify-job-ai-ui.mjs` |
| `apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx` | `verify-job-ai-ui.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-job-headcount.ts` |
| `apps/kiosk/src/pages/jobs/components/ResumeSelectModal.tsx` | `verify-job-ai-ui.mjs` |
| `apps/kiosk/src/pages/jobs/components/W4Presentation.tsx` | `verify-fusion-w4.mjs` |
| `apps/kiosk/src/pages/legal/LegalDocPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-legal-doc-version.ts` |
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
| `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-feedback-entry.mjs`<br/>`verify-p39-print-hub-fidelity.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-service-entry-readiness.mjs`<br/>`verify-print-color-duplex-capability.ts` |
| `apps/kiosk/src/pages/print-scan/SignStampPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/src/pages/print-scan/components/V6PrintHubView.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-p39-print-hub-fidelity.mjs` |
| `apps/kiosk/src/pages/print-scan/printHubContent.ts` | `verify-p39-print-hub-fidelity.mjs` |
| `apps/kiosk/src/pages/print-scan/styles/print-hub-v6.css` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-p39-print-hub-fidelity.mjs` |
| `apps/kiosk/src/pages/print-scan/styles/print-scan-fusion.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print-scan/styles/print-scan-uplift.css` | `verify-kiosk-visual-unity.mjs` |
| `apps/kiosk/src/pages/print/CashierPaymentPanel.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-scan-input-safety.mjs`<br/>`verify-payment-codepay.ts` |
| `apps/kiosk/src/pages/print/DevSandboxControls.tsx` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/PrintCashierPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-feedback-entry.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-scan-input-safety.mjs`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-payment-codepay.ts`<br/>`verify-print-rollout-config.ts` |
| `apps/kiosk/src/pages/print/PrintConfirmPage.tsx` | `verify-contract-review-report-print.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-price-single-source.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-wave3-print-aftercare.ts` |
| `apps/kiosk/src/pages/print/PrintDonePage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-feedback-entry.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-done-truth.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-wave3-print-aftercare.ts` |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs` |
| `apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-scan-input-safety.mjs`<br/>`verify-backend-p0-contracts.mjs`<br/>`verify-miniapp-cloud-print-m2.ts` |
| `apps/kiosk/src/pages/print/PrintPreviewPage.tsx` | `verify-device-status-honest.mjs`<br/>`verify-file-display-truth.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-legal-retention-copy.mjs`<br/>`verify-price-single-source.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-print-color-duplex-capability.ts` |
| `apps/kiosk/src/pages/print/PrintProgressPage.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-confirm-honest.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-wave3-print-aftercare.ts` |
| `apps/kiosk/src/pages/print/PrintPrototypeLayout.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-parameter-capability.mjs` |
| `apps/kiosk/src/pages/print/PrintUploadPage.tsx` | `verify-file-display-truth.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-print-entry-source-split.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-service-entry-readiness.mjs`<br/>`verify-file-display-truth.ts` |
| `apps/kiosk/src/pages/print/cashierStatus.ts` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-payment-codepay.ts` |
| `apps/kiosk/src/pages/print/components/MaterialCheckPresentation.tsx` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/print-prototype.css` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-kiosk-visual-unity.mjs`<br/>`verify-print-cta-contrast.mjs` |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-print-entry-source-split.mjs` |
| `apps/kiosk/src/pages/print/printUsageEstimate.ts` | `verify-file-display-truth.mjs` |
| `apps/kiosk/src/pages/print/styles/print-cashier.css` | `verify-kiosk-visual-unity.mjs`<br/>`verify-print-cta-contrast.mjs` |
| `apps/kiosk/src/pages/print/styles/print-pickup-claim.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/print/styles/print-upload.css` | `verify-fusion-w2-print-scan.mjs` |
| `apps/kiosk/src/pages/profile/ProfilePage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-activity-logs.ts` |
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
| `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-print-orders-login-smoke.mjs` |
| `apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx` | `verify-data-request-ui.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx` | `verify-fusion-w5.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx` | `verify-data-request-ui.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-user-center-wave0.mjs` |
| `apps/kiosk/src/pages/profile/me/activityPresentation.ts` | `verify-lightflow-profile-entry.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/FeedbackDetailPanel.tsx` | `verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/FeedbackFormPanel.tsx` | `verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/FeedbackListPanel.tsx` | `verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/feedback/types.ts` | `verify-fusion-w5.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs` |
| `apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-profile-entry.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-ai-records-inkpaper.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/OrderPaymentSummary.tsx` | `verify-lightflow-profile-entry.mjs`<br/>`verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
| `apps/kiosk/src/pages/profile/me/printOrders/PickupCodePanel.tsx` | `verify-lightflow-profile-entry.mjs`<br/>`verify-member-print-orders-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs` |
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
| `apps/kiosk/src/pages/renshi/RenshiPage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-policy-eligibility-ui.mjs`<br/>`verify-renshi-policy-ui.mjs`<br/>`verify-activity-logs.ts` |
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
| `apps/kiosk/src/pages/resume/SelfAssessmentFlow.tsx` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs`<br/>`verify-compliance.ts` |
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
| `apps/kiosk/src/pages/resume/self-assessment-lightflow.css` | `verify-compliance.ts` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-authoring.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-common.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-diagnosis.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-job-fit.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/styles/resume-fusion-library.css` | `verify-fusion-w3.mjs` |
| `apps/kiosk/src/pages/resume/useSelfAssessmentIdleExit.ts` | `verify-resume-phone-upload-ui.mjs` |
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
| `apps/kiosk/src/pages/toolbox/ToolboxZonePage.tsx` | `verify-fusion-w4.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-smart-campus-ui.mjs`<br/>`verify-terminal-device-config.ts` |
| `apps/kiosk/src/pages/toolbox/toolbox-zone.css` | `verify-fusion-w5.mjs` |
| `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx` | `verify-fusion-shell.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx` | `verify-fusion-w2-print-scan.mjs`<br/>`verify-fusion-w3.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/pages/upload/phone-upload-service-desk.css` | `verify-fusion-w5.mjs`<br/>`verify-lightflow-k1-public-entry.mjs` |
| `apps/kiosk/src/routes/index.tsx` | `verify-advisor-provider-gate.mjs`<br/>`verify-data-request-ui.mjs`<br/>`verify-fusion-baseline.mjs`<br/>`verify-fusion-shell.mjs`<br/>`verify-fusion-w2-print-scan.mjs`<br/>`verify-fusion-w4.mjs`<br/>`verify-fusion-w5.mjs`<br/>`verify-fusion-w6.mjs`<br/>`verify-home-toolbox-ui.mjs`<br/>`verify-job-material-library-ui.mjs`<br/>`verify-jobfair-checkin.mjs`<br/>`verify-jobfair-commercial-closure.mjs`<br/>`verify-jobfair-ui.mjs`<br/>`verify-kiosk-runtime-error-boundary.mjs`<br/>`verify-lightflow-k1-public-entry.mjs`<br/>`verify-print-parameter-capability.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-profile-ai-records-inkpaper.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-qr-login-ui.mjs`<br/>`verify-resume-phone-upload-ui.mjs`<br/>`verify-smart-campus-ui.mjs`<br/>`verify-visual-evidence-manifest.mjs`<br/>`frontend.mjs` |
| `apps/kiosk/src/services/api/activity.ts` | `verify-jobfair-checkin.mjs`<br/>`verify-member-session-closure.mjs`<br/>`verify-profile-activity-inkpaper.mjs`<br/>`verify-activity-logs.ts` |
| `apps/kiosk/src/services/api/ai.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/services/api/aiHttpAdapter.ts` | `verify-member-session-closure.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs` |
| `apps/kiosk/src/services/api/aiMockAdapter.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-resume-diagnosis-flow-ui.mjs`<br/>`verify-toolbox-ai-skill-intents.ts` |
| `apps/kiosk/src/services/api/benefitActivities.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/careerPlan.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/api/client.ts` | `verify-production-real-services.mjs` |
| `apps/kiosk/src/services/api/companies.ts` | `verify-companies.ts` |
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
| `apps/kiosk/src/services/api/materials.ts` | `verify-member-session-closure.mjs`<br/>`verify-material-task-token-transport.ts` |
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
| `apps/kiosk/src/services/api/screensaver.ts` | `verify-runtime-terminal-identity.mjs`<br/>`verify-print-scan-first-release.ts` |
| `apps/kiosk/src/services/api/selfAssessment.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-kiosk-frontend-debt.mjs`<br/>`verify-compliance.ts` |
| `apps/kiosk/src/services/api/terminalConfig.ts` | `verify-home-toolbox-ui.mjs`<br/>`verify-print-scan-first-release.ts`<br/>`verify-terminal-device-config.ts` |
| `apps/kiosk/src/services/api/toolboxLaunchEvents.ts` | `verify-home-toolbox-ui.mjs`<br/>`verify-toolbox-launch-events.ts` |
| `apps/kiosk/src/services/api/uploadSessions.ts` | `verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/services/api/userErrorMessage.ts` | `verify-kiosk-runtime-error-boundary.mjs` |
| `apps/kiosk/src/services/auth/legalConsentVersions.ts` | `verify-legal-doc-version.ts` |
| `apps/kiosk/src/services/auth/memberAuthApi.ts` | `verify-member-session-closure.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-legal-doc-version.ts` |
| `apps/kiosk/src/services/auth/memberAuthDevice.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/auth/memberQrLoginApi.ts` | `verify-qr-login-ui.mjs` |
| `apps/kiosk/src/services/auth/memberSessionEvents.ts` | `verify-member-session-closure.mjs` |
| `apps/kiosk/src/services/files/usbImportApi.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-phone-upload-ui.mjs` |
| `apps/kiosk/src/services/print/localPrintWakeApi.ts` | `verify-print-confirm-honest.mjs` |
| `apps/kiosk/src/services/print/paymentApi.ts` | `verify-print-confirm-honest.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-payment-codepay.ts` |
| `apps/kiosk/src/services/print/priceConfigApi.ts` | `verify-price-single-source.mjs` |
| `apps/kiosk/src/services/print/printJobsApi.ts` | `verify-print-confirm-honest.mjs`<br/>`verify-prod-build-config.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-runtime-terminal-identity.mjs`<br/>`verify-print-scan-first-release.ts` |
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
| `apps/kiosk/tests/visual/fusion-self-assessment-flow.spec.ts` | `verify-fusion-w3.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `apps/kiosk/tests/visual/fusion-smoke.spec.ts` | `verify-fusion-w4.mjs` |
| `apps/kiosk/tests/visual/fusion-w2-print.spec.ts` | `verify-fusion-w6.mjs`<br/>`verify-print-color-duplex-capability.ts` |
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
| `apps/miniapp/pages/print-pay/print-pay.js` | `verify-miniapp-static.mjs`<br/>`verify-miniapp-cloud-print-m2.ts` |
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
| `apps/miniapp/utils/api.js` | `verify-miniapp-static.mjs`<br/>`verify-miniapp-cloud-print-m2.ts` |
| `apps/miniapp/utils/auth.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/utils/config.js` | `verify-miniapp-static.mjs` |
| `apps/miniapp/utils/pickup-qrcode.js` | `verify-miniapp-static.mjs`<br/>`verify-pickup-qrcode.mjs`<br/>`verify-backend-p0-contracts.mjs` |
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
<summary><code>apps/partner/src/</code> — 21 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/partner/src/layouts/PartnerLayoutWrapper.tsx` | `verify-service-desk-jobs-ui.mjs` |
| `apps/partner/src/routes/account/index.tsx` | `verify-honest-placeholders.mjs`<br/>`verify-partner-stats-contract.mjs` |
| `apps/partner/src/routes/companies/index.tsx` | `verify-companies.ts` |
| `apps/partner/src/routes/fairs/index.tsx` | `verify-partner-refresh-safe.mjs`<br/>`verify-jobfair-checkin.ts` |
| `apps/partner/src/routes/index.tsx` | `frontend.mjs` |
| `apps/partner/src/routes/jobs/components/JobQualitySummaryPanel.tsx` | `verify-job-quality-dashboard-ui.mjs` |
| `apps/partner/src/routes/jobs/index.tsx` | `verify-job-quality-dashboard-ui.mjs`<br/>`verify-partner-refresh-safe.mjs`<br/>`verify-service-desk-jobs-ui.mjs` |
| `apps/partner/src/routes/login/index.tsx` | `verify-admin-account-settings-ui.mjs` |
| `apps/partner/src/routes/policy/index.tsx` | `verify-partner-refresh-safe.mjs` |
| `apps/partner/src/routes/sources/ExcelImportModal.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-excel-template-download-ui.mjs`<br/>`verify-backend-p0-contracts.mjs`<br/>`verify-job-headcount.ts` |
| `apps/partner/src/routes/sources/index.tsx` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-backend-p0-contracts.mjs` |
| `apps/partner/src/routes/stats/index.tsx` | `verify-partner-stats-contract.mjs` |
| `apps/partner/src/routes/terminals/index.tsx` | `verify-honest-placeholders.mjs`<br/>`verify-partner-stats-contract.mjs` |
| `apps/partner/src/services/api/client.ts` | `verify-partner-relative-api-url.mjs` |
| `apps/partner/src/services/api/partnerCompanies.ts` | `verify-companies.ts` |
| `apps/partner/src/services/api/partnerContent.ts` | `verify-excel-template-download-ui.mjs` |
| `apps/partner/src/services/api/partnerHttpAdapter.ts` | `verify-excel-template-download-ui.mjs`<br/>`verify-job-quality-dashboard-ui.mjs`<br/>`verify-partner-relative-api-url.mjs` |
| `apps/partner/src/services/api/partnerMockAdapter.ts` | `verify-excel-template-download-ui.mjs`<br/>`verify-job-quality-dashboard-ui.mjs` |
| `apps/partner/src/services/api/stats.ts` | `verify-partner-stats-contract.mjs` |
| `apps/partner/src/services/api/types.ts` | `verify-job-quality-dashboard-ui.mjs`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-jobfair-checkin.ts` |
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
| `apps/terminal-agent/scripts/install-production-agent.ps1` | `verify-agent-unauthorized.mjs`<br/>`verify-terminal-bind-code.ts` |
| `apps/terminal-agent/scripts/verify-usb-import-agent.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/scripts/verify-windows-service-recovery.mjs` | `verify-agent-unauthorized.mjs` |

</details>

<details>
<summary><code>apps/terminal-agent/src/</code> — 29 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `apps/terminal-agent/src/agent/api-client.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-direct-http-agents.ts` |
| `apps/terminal-agent/src/agent/auth-state.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-scan-deletion-audit.ts`<br/>`verify-task-reliability.ts` |
| `apps/terminal-agent/src/agent/config-manager.ts` | `verify-agent-config-resilience.mjs`<br/>`verify-agent-unauthorized.mjs`<br/>`verify-printer-config.mjs` |
| `apps/terminal-agent/src/agent/db.ts` | `verify-print-scan-agent.mjs`<br/>`verify-scan-deletion-audit.ts`<br/>`verify-task-reliability.ts` |
| `apps/terminal-agent/src/agent/dead-letter-operator.ts` | `verify-task-reliability.ts` |
| `apps/terminal-agent/src/agent/heartbeat.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-print-scan-agent.mjs` |
| `apps/terminal-agent/src/agent/network-diagnostics.ts` | `verify-network-diagnostics.ts` |
| `apps/terminal-agent/src/agent/offline-queue.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-task-reliability.ts` |
| `apps/terminal-agent/src/agent/profile-guard.ts` | `verify-agent-profile-guard.mjs` |
| `apps/terminal-agent/src/agent/release-observation.ts` | `verify-release-observation-boundary.mjs` |
| `apps/terminal-agent/src/agent/scan-deletion-audit-reporter.ts` | `verify-scan-deletion-audit.ts` |
| `apps/terminal-agent/src/agent/scan-input/verified-folder.ts` | `verify-scan-input-health.ts` |
| `apps/terminal-agent/src/agent/scan-input/windows-secure-reader.ts` | `verify-scan-input-health.ts` |
| `apps/terminal-agent/src/agent/scan-watcher.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-scan-deletion-audit.ts`<br/>`verify-scan-watcher.ts` |
| `apps/terminal-agent/src/agent/startup-diagnostics.ts` | `verify-agent-config-resilience.mjs` |
| `apps/terminal-agent/src/agent/task-runner-control.ts` | `verify-task-runner-wake.ts` |
| `apps/terminal-agent/src/agent/task-runner.ts` | `verify-agent-unauthorized.mjs`<br/>`verify-print-monitor-truth.ts`<br/>`verify-print-scan-agent.mjs`<br/>`verify-printer-config.mjs`<br/>`verify-task-reliability.ts` |
| `apps/terminal-agent/src/agent/types.ts` | `verify-local-print-wake.ts`<br/>`verify-local-qr-proxy.ts`<br/>`verify-print-scan-agent.mjs`<br/>`verify-scan-deletion-audit.ts`<br/>`verify-scan-input-health.ts`<br/>`verify-scan-watcher.ts`<br/>`verify-task-reliability.ts`<br/>`verify-usb-import-agent.ts` |
| `apps/terminal-agent/src/agent/wmi.ts` | `verify-print-monitor-truth.ts` |
| `apps/terminal-agent/src/config.ts` | `verify-printer-config.mjs` |
| `apps/terminal-agent/src/index.ts` | `verify-agent-config-resilience.mjs`<br/>`verify-agent-profile-guard.mjs`<br/>`verify-agent-unauthorized.mjs`<br/>`verify-print-scan-agent.mjs`<br/>`verify-printer-config.mjs`<br/>`verify-task-reliability.ts` |
| `apps/terminal-agent/src/local-api/origin-guard.ts` | `verify-local-qr-proxy.ts` |
| `apps/terminal-agent/src/local-api/qr-login-server.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-local-print-wake.ts`<br/>`verify-local-qr-proxy.ts`<br/>`verify-usb-import-agent.ts` |
| `apps/terminal-agent/src/local-api/types.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/src/local-api/wire.ts` | `verify-profile-documents-inkpaper.mjs` |
| `apps/terminal-agent/src/printer/image-to-pdf.ts` | `verify-image-scale-truth.ts` |
| `apps/terminal-agent/src/printer/print-with-pdf-to-printer.ts` | `verify-print-monitor-truth.ts` |
| `apps/terminal-agent/src/printer/print.ts` | `verify-image-scale-truth.ts`<br/>`verify-printer-config.mjs` |
| `apps/terminal-agent/src/usb/usb-files.ts` | `verify-usb-import-agent.ts` |

</details>

<details>
<summary><code>docs/acceptance/contract-review-preprod-acceptance-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/contract-review-preprod-acceptance-runbook.md` | `verify-contract-review-preprod-readiness.ts` |

</details>

<details>
<summary><code>docs/acceptance/job-customer-sample-import-readiness.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/job-customer-sample-import-readiness.md` | `verify-job-customer-sample-readiness.ts` |

</details>

<details>
<summary><code>docs/acceptance/job-info-ai-preprod-execution-record.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/job-info-ai-preprod-execution-record.md` | `verify-job-info-ai-real-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/job-info-ai-real-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/job-info-ai-real-acceptance.md` | `verify-job-customer-sample-readiness.ts`<br/>`verify-job-info-ai-real-acceptance.ts` |

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
<summary><code>docs/acceptance/print-scan-field-execution-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/print-scan-field-execution-runbook.md` | `verify-print-scan-first-release.ts` |

</details>

<details>
<summary><code>docs/acceptance/print-scan-first-release-acceptance-package.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/print-scan-first-release-acceptance-package.md` | `verify-print-scan-first-release.ts` |

</details>

<details>
<summary><code>docs/acceptance/profile-commercial-preprod-redeploy-and-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/profile-commercial-preprod-redeploy-and-acceptance.md` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-commercial-first-batch-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/toolbox-ai-skill-real-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/toolbox-ai-skill-real-acceptance.md` | `verify-toolbox-ai-skill-real-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/toolbox-ai-skill-real-execution-record.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/toolbox-ai-skill-real-execution-record.md` | `verify-toolbox-ai-skill-real-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/toolbox-micro-app-governance-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/toolbox-micro-app-governance-acceptance.md` | `verify-toolbox-governance-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/toolbox-micro-app-governance-execution-record.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/toolbox-micro-app-governance-execution-record.md` | `verify-toolbox-governance-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/toolbox-preprod-acceptance-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/toolbox-preprod-acceptance-runbook.md` | `verify-toolbox-preprod-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-center-wave0-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-center-wave0-acceptance.md` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-commercial-closure-audit.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-commercial-closure-audit.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-gate2-approval-package.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-gate2-approval-package.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-gate2-local-artifact-check.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-gate2-local-artifact-check.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-gate2-readiness-recheck.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-gate2-readiness-recheck.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-gate2-runtime-build-check.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-gate2-runtime-build-check.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-preprod-cos-switch-approval.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-preprod-cos-switch-approval.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-preprod-execution-record.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-preprod-execution-record.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/acceptance/user-file-assets-trial-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/acceptance/user-file-assets-trial-acceptance.md` | `verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/api/cos-object-storage.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/api/cos-object-storage.md` | `verify-cos-lifecycle-policy.ts` |

</details>

<details>
<summary><code>docs/compliance/contract-review-release-gate.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/compliance/contract-review-release-gate.md` | `verify-fusion-w4.mjs`<br/>`verify-contract-review-gate0.ts`<br/>`verify-contract-review-preprod-readiness.ts` |

</details>

<details>
<summary><code>docs/compliance/file-retention-and-cos-lifecycle.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/compliance/file-retention-and-cos-lifecycle.md` | `verify-cos-lifecycle-policy.ts` |

</details>

<details>
<summary><code>docs/compliance/launch-review-submissions.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/compliance/launch-review-submissions.md` | `verify-legal-retention-copy.mjs` |

</details>

<details>
<summary><code>docs/compliance/member-personal-data-retention.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/compliance/member-personal-data-retention.md` | `verify-ai-user-text-retention.ts`<br/>`verify-member-data-retention.ts` |

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
<summary><code>docs/device/f1-d2-same-host-dual-port-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/device/f1-d2-same-host-dual-port-runbook.md` | `verify-contract.mjs` |

</details>

<details>
<summary><code>docs/device/postgres-load-hardening-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/device/postgres-load-hardening-runbook.md` | `verify-db-load-indexes.ts` |

</details>

<details>
<summary><code>docs/device/print-scan-first-release-acceptance.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/device/print-scan-first-release-acceptance.md` | `verify-print-scan-first-release.ts` |

</details>

<details>
<summary><code>docs/device/production-deployment-and-windows-host-checklist.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/device/production-deployment-and-windows-host-checklist.md` | `verify-cos-lifecycle-policy.ts`<br/>`verify-file-assets-trial-acceptance.ts` |

</details>

<details>
<summary><code>docs/device/production-deployment-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/device/production-deployment-runbook.md` | `verify-cos-lifecycle-policy.ts` |

</details>

<details>
<summary><code>docs/operations/price-config-production.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/operations/price-config-production.md` | `verify-print-rollout-config.ts` |

</details>

<details>
<summary><code>docs/operations/recruitment-wave2-readonly-planning-runbook.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/operations/recruitment-wave2-readonly-planning-runbook.md` | `verify-recruitment-wave2-full-inventory.ts` |

</details>

<details>
<summary><code>docs/product/feature-scope.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/product/feature-scope.md` | `verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>docs/product/role-boundary.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/product/role-boundary.md` | `verify-member-data-retention.ts` |

</details>

<details>
<summary><code>docs/product/toolbox-micro-app-platform.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/product/toolbox-micro-app-platform.md` | `verify-toolbox-ai-skill-intents.ts`<br/>`verify-toolbox-ai-skill-real-acceptance.ts`<br/>`verify-toolbox-governance-acceptance.ts`<br/>`verify-toolbox-micro-app-platform.ts`<br/>`verify-toolbox-review-workflow.ts` |

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
| `docs/product/user-data-flow-matrix.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-member-data-retention.ts` |

</details>

<details>
<summary><code>docs/progress/current-progress.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/progress/current-progress.md` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-contract-review-preprod-readiness.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-info-ai-real-acceptance.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-profile-commercial-first-batch-acceptance.ts`<br/>`verify-toolbox-ai-skill-intents.ts`<br/>`verify-toolbox-ai-skill-real-acceptance.ts`<br/>`verify-toolbox-governance-acceptance.ts`<br/>`verify-toolbox-preprod-acceptance.ts` |

</details>

<details>
<summary><code>docs/progress/next-tasks.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/progress/next-tasks.md` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-inkpaper-home.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-contract-review-preprod-readiness.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-info-ai-real-acceptance.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-profile-commercial-first-batch-acceptance.ts`<br/>`verify-toolbox-ai-skill-intents.ts`<br/>`verify-toolbox-ai-skill-real-acceptance.ts`<br/>`verify-toolbox-governance-acceptance.ts`<br/>`verify-toolbox-preprod-acceptance.ts` |

</details>

<details>
<summary><code>docs/progress/today-claude.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/progress/today-claude.md` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |

</details>

<details>
<summary><code>docs/reviews/ai-resume-assets-closure-planning.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/reviews/ai-resume-assets-closure-planning.md` | `verify-member-data-retention.ts` |

</details>

<details>
<summary><code>docs/reviews/user-center-commercial-closure-audit-2026-07-16.md/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/reviews/user-center-commercial-closure-audit-2026-07-16.md` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>docs/superpowers/plans/</code> — 14 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `docs/superpowers/plans/2026-06-22-file-assets-preprod-execution.md` | `verify-file-assets-trial-acceptance.ts` |
| `docs/superpowers/plans/2026-06-22-file-assets-preprod-gate2-refresh.md` | `verify-file-assets-trial-acceptance.ts` |
| `docs/superpowers/plans/2026-06-22-file-assets-preprod-integration.md` | `verify-file-assets-trial-acceptance.ts` |
| `docs/superpowers/plans/2026-07-01-toolbox-micro-app-platform.md` | `verify-toolbox-micro-app-platform.ts` |
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
| `package.json` | `verify-miniapp-static.mjs`<br/>`verify-dependency-security.mjs` |

</details>

<details>
<summary><code>packages/refresh/src/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `packages/refresh/src/index.ts` | `verify-refresh-safe.mjs` |

</details>

<details>
<summary><code>packages/shared/src/</code> — 29 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `packages/shared/src/index.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-companies.ts`<br/>`verify-contract-review-contract.ts`<br/>`verify-job-ai.ts`<br/>`verify-job-materials.ts`<br/>`verify-job-requirement-stats.ts`<br/>`verify-toolbox-micro-app-platform.ts` |
| `packages/shared/src/pickupCode.ts` | `verify-backend-p0-contracts.mjs` |
| `packages/shared/src/types/adminUsers.ts` | `verify-admin-users-ui.mjs`<br/>`verify-admin-users.ts` |
| `packages/shared/src/types/ai.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-job-ai-history-privacy-ui.mjs`<br/>`verify-job-fit-m1-5-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-job-ai.ts`<br/>`verify-resume-diagnosis-context.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-voice-generate.ts`<br/>`verify-toolbox-ai-skill-intents.ts` |
| `packages/shared/src/types/audit.ts` | `verify-change-password.ts` |
| `packages/shared/src/types/company.ts` | `verify-companies.ts` |
| `packages/shared/src/types/complianceCopy.ts` | `verify-legal-retention-copy.mjs`<br/>`verify-compliance-copy.mjs` |
| `packages/shared/src/types/contractReview.ts` | `verify-contract-review-contract.ts` |
| `packages/shared/src/types/device.ts` | `verify-terminal-device-config.ts` |
| `packages/shared/src/types/fairDto.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-fair-stats-truth.ts` |
| `packages/shared/src/types/file.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-contract-review-contract.ts` |
| `packages/shared/src/types/job.ts` | `verify-job-quality-dashboard-ui.mjs`<br/>`verify-job-ai.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-jobfair-checkin.ts` |
| `packages/shared/src/types/jobMaterials.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-resume-template-fill.ts` |
| `packages/shared/src/types/jobRequirementStats.ts` | `verify-job-requirement-stats.ts` |
| `packages/shared/src/types/kioskApp.ts` | `verify-terminal-device-config.ts` |
| `packages/shared/src/types/legalDocs.ts` | `verify-legal-doc-version.ts` |
| `packages/shared/src/types/member-privacy.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-member-data-request-contract.ts`<br/>`verify-member-step-up.helpers.ts`<br/>`verify-member-step-up.ts`<br/>`verify-wave2-account-rebind.ts` |
| `packages/shared/src/types/memberAssets.ts` | `verify-jobfair-checkin.ts` |
| `packages/shared/src/types/memberPrivacy.ts` | `verify-data-request-ui.mjs` |
| `packages/shared/src/types/mockInterview.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/partner.ts` | `verify-partner-smart-campus.ts` |
| `packages/shared/src/types/payment.ts` | `verify-admin-order-filters.ts` |
| `packages/shared/src/types/print.ts` | `verify-print-parameter-capability.mjs`<br/>`verify-print-parameter-capability.ts` |
| `packages/shared/src/types/printScanCapability.ts` | `verify-admin-print-scan.ts`<br/>`verify-print-color-duplex-capability.ts` |
| `packages/shared/src/types/printSign.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `packages/shared/src/types/scanTask.ts` | `verify-contract-review-contract.ts` |
| `packages/shared/src/types/selfAssessment.ts` | `verify-compliance.ts` |
| `packages/shared/src/types/toolboxMicroApp.ts` | `verify-toolbox-ai-skill-intents.ts`<br/>`verify-toolbox-micro-app-platform.ts` |
| `packages/shared/src/types/uploadSession.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-contract-review-contract.ts` |

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
<summary><code>scripts/fixture-time-bomb-baseline.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/fixture-time-bomb-baseline.json` | `verify-fixture-time-bombs.mjs` |

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
<summary><code>scripts/project-graph/backend.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/backend.mjs` | `build.mjs` |

</details>

<details>
<summary><code>scripts/project-graph/build.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/build.mjs` | `generate-project-graph.mjs` |

</details>

<details>
<summary><code>scripts/project-graph/frontend.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/frontend.mjs` | `build.mjs` |

</details>

<details>
<summary><code>scripts/project-graph/gates.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/gates.mjs` | `build.mjs`<br/>`verify-ci-gate-coverage.mjs` |

</details>

<details>
<summary><code>scripts/project-graph/orphans.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/orphans.mjs` | `generate-project-graph.mjs`<br/>`project-graph-query.mjs`<br/>`build.mjs`<br/>`render.mjs` |

</details>

<details>
<summary><code>scripts/project-graph/render.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/render.mjs` | `generate-project-graph.mjs` |

</details>

<details>
<summary><code>scripts/project-graph/repo.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/project-graph/repo.mjs` | `generate-project-graph.mjs`<br/>`project-graph-query.mjs`<br/>`backend.mjs`<br/>`build.mjs`<br/>`frontend.mjs`<br/>`gates.mjs`<br/>`orphans.mjs`<br/>`verify-ci-gate-coverage.mjs` |

</details>

<details>
<summary><code>scripts/verify-ci-gate-coverage.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/verify-ci-gate-coverage.mjs` | `verify-policy-eligibility-authoring.ts` |

</details>

<details>
<summary><code>scripts/verify-fixture-time-bombs.mjs/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `scripts/verify-fixture-time-bombs.mjs` | `verify-fixture-time-bombs.mjs` |

</details>

<details>
<summary><code>services/api/.env.example/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/.env.example` | `verify-cleanup-contract.mjs` |

</details>

<details>
<summary><code>services/api/package.json/</code> — 1 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/package.json` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-contract-review-preprod-readiness.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-job-info-ai-real-acceptance.ts`<br/>`verify-policy-eligibility-authoring.ts`<br/>`verify-profile-commercial-first-batch-acceptance.ts`<br/>`verify-toolbox-ai-skill-intents.ts`<br/>`verify-toolbox-ai-skill-real-acceptance.ts`<br/>`verify-toolbox-governance-acceptance.ts`<br/>`verify-toolbox-micro-app-platform.ts`<br/>`verify-toolbox-preprod-acceptance.ts` |

</details>

<details>
<summary><code>services/api/prisma/</code> — 31 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/prisma/migrations/20260629120000_add_terminal_device_profile/migration.sql` | `verify-partner-smart-campus.ts`<br/>`verify-terminal-device-config.ts` |
| `services/api/prisma/migrations/20260629123000_add_terminal_toolbox_config/migration.sql` | `verify-partner-smart-campus.ts`<br/>`verify-terminal-device-config.ts` |
| `services/api/prisma/migrations/20260701123000_add_toolbox_launch_events/migration.sql` | `verify-toolbox-launch-events.ts` |
| `services/api/prisma/migrations/20260702002000_add_toolbox_governance/migration.sql` | `verify-toolbox-review-workflow.ts` |
| `services/api/prisma/migrations/20260705193000_add_terminal_bind_code/migration.sql` | `verify-terminal-bind-code.ts` |
| `services/api/prisma/migrations/20260706070000_add_db_load_indexes/migration.sql` | `verify-db-load-indexes.ts` |
| `services/api/prisma/migrations/20260711120000_add_fair_material_print_bridge/migration.sql` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/prisma/migrations/20260712090000_add_job_fit_anonymous_consent/migration.sql` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/prisma/migrations/20260716193000_add_partner_account_tombstone/migration.sql` | `verify-admin-orgs-delete-schema.ts` |
| `services/api/prisma/migrations/20260717090000_add_member_account_status/migration.sql` | `verify-member-account-status.ts` |
| `services/api/prisma/migrations/20260717130000_extend_user_data_requests/migration.sql` | `verify-member-data-request-contract.ts` |
| `services/api/prisma/migrations/20260717140000_complete_member_data_export/migration.sql` | `verify-member-data-request-contract.ts` |
| `services/api/prisma/migrations/20260718143000_add_partner_password_proof_state/migration.sql` | `verify-admin-orgs-delete-schema.ts`<br/>`verify-partner-account-action-schema.ts` |
| `services/api/prisma/migrations/20260901090000_add_agent_release_observation/migration.sql` | `verify-release-observation-contract.mjs` |
| `services/api/prisma/postgres/migrations/20260701123000_add_toolbox_launch_events/migration.sql` | `verify-toolbox-launch-events.ts` |
| `services/api/prisma/postgres/migrations/20260702002000_add_toolbox_governance/migration.sql` | `verify-toolbox-review-workflow.ts` |
| `services/api/prisma/postgres/migrations/20260706070000_add_db_load_indexes/migration.sql` | `verify-db-load-indexes.ts` |
| `services/api/prisma/postgres/migrations/20260711120000_add_fair_material_print_bridge/migration.sql` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/prisma/postgres/migrations/20260712090000_add_job_fit_anonymous_consent/migration.sql` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/prisma/postgres/migrations/20260716193000_add_partner_account_tombstone/migration.sql` | `verify-admin-orgs-delete-schema.ts` |
| `services/api/prisma/postgres/migrations/20260717090000_add_member_account_status/migration.sql` | `verify-member-account-status.ts` |
| `services/api/prisma/postgres/migrations/20260717130000_extend_user_data_requests/migration.sql` | `verify-member-data-request-contract.ts` |
| `services/api/prisma/postgres/migrations/20260717140000_complete_member_data_export/migration.sql` | `verify-member-data-request-contract.ts` |
| `services/api/prisma/postgres/migrations/20260718143000_add_partner_password_proof_state/migration.sql` | `verify-admin-orgs-delete-schema.ts`<br/>`verify-partner-account-action-schema.ts` |
| `services/api/prisma/postgres/migrations/20260724165000_repair_terminal_bind_code/migration.sql` | `verify-terminal-bind-code.ts` |
| `services/api/prisma/postgres/migrations/20260805132000_repair_notification_legal_defaults/migration.sql` | `verify-fusion-w4.mjs` |
| `services/api/prisma/postgres/migrations/20260901090000_add_agent_release_observation/migration.sql` | `verify-release-observation-contract.mjs` |
| `services/api/prisma/postgres/schema.prisma` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-orgs-delete-schema.ts`<br/>`verify-db-load-indexes.ts`<br/>`verify-job-ai.ts`<br/>`verify-job-application-track.ts`<br/>`verify-job-fit-governance.ts`<br/>`verify-job-headcount.ts`<br/>`verify-jobfair-checkin.ts`<br/>`verify-legal-doc-version.ts`<br/>`verify-member-account-status.ts`<br/>`verify-member-data-request-contract.ts`<br/>`verify-partner-account-action-schema.ts`<br/>`verify-policy-eligibility.ts`<br/>`verify-recruitment-capability-gate.ts`<br/>`verify-recruitment-p1-schema.ts`<br/>`verify-release-observation-contract.mjs`<br/>`verify-terminal-bind-code.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-network-diagnostics.ts`<br/>`verify-toolbox-launch-events.ts`<br/>`verify-toolbox-review-workflow.ts` |
| `services/api/prisma/schema.prisma` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-orgs-delete-schema.ts`<br/>`verify-ai-user-text-retention.ts`<br/>`verify-db-load-indexes.ts`<br/>`verify-job-ai.ts`<br/>`verify-job-application-track.ts`<br/>`verify-job-fit-governance.ts`<br/>`verify-job-headcount.ts`<br/>`verify-jobfair-checkin.ts`<br/>`verify-legal-doc-version.ts`<br/>`verify-member-account-status.ts`<br/>`verify-member-data-request-contract.ts`<br/>`verify-partner-account-action-schema.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-policy-eligibility.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-recruitment-capability-gate.ts`<br/>`verify-recruitment-p1-schema.ts`<br/>`verify-release-observation-contract.mjs`<br/>`verify-terminal-bind-code.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-network-diagnostics.ts`<br/>`verify-toolbox-launch-events.ts`<br/>`verify-toolbox-review-workflow.ts` |
| `services/api/prisma/seed-guard.ts` | `verify-demo-seed-guard.ts` |
| `services/api/prisma/seed.ts` | `verify-partner-account-action-schema.ts` |

</details>

<details>
<summary><code>services/api/scripts/</code> — 76 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/scripts/backfill-terminal-credentials.ts` | `verify-terminal-bind-code.ts` |
| `services/api/scripts/change-password-verify-target.ts` | `verify-change-password-target-guard.ts`<br/>`verify-change-password.ts` |
| `services/api/scripts/d2-release-fixture.mjs` | `d2-docker-drill.mjs`<br/>`drill.mjs` |
| `services/api/scripts/d2-same-host/contract.mjs` | `drill.mjs`<br/>`verify-contract.mjs` |
| `services/api/scripts/d2-same-host/control-plane.mjs` | `drill.mjs`<br/>`managed-scope.mjs`<br/>`verify-contract.mjs` |
| `services/api/scripts/d2-same-host/diagnostics.mjs` | `drill.mjs`<br/>`verify-contract.mjs` |
| `services/api/scripts/d2-same-host/governance-contract.mjs` | `governance-git.mjs`<br/>`governance-invocation.mjs`<br/>`governance-reservation.mjs`<br/>`governance-state.mjs`<br/>`governance-store.mjs`<br/>`governance.mjs`<br/>`invocation-worker-fixture.mjs`<br/>`reservation-worker-fixture.mjs`<br/>`verify-governance-crash.mjs`<br/>`verify-governance-git.mjs`<br/>`verify-governance-invocation.mjs`<br/>`verify-governance-reservation.mjs`<br/>`verify-governance-store.mjs`<br/>`verify-governance-wiring.mjs`<br/>`verify-governance.mjs` |
| `services/api/scripts/d2-same-host/governance-git.mjs` | `governance-invocation.mjs`<br/>`governance-reservation.mjs`<br/>`governance.mjs`<br/>`verify-governance-git.mjs` |
| `services/api/scripts/d2-same-host/governance-invocation.mjs` | `governance.mjs` |
| `services/api/scripts/d2-same-host/governance-reservation.mjs` | `governance.mjs`<br/>`verify-governance-reservation.mjs` |
| `services/api/scripts/d2-same-host/governance-state.mjs` | `governance-invocation.mjs`<br/>`governance-reservation.mjs` |
| `services/api/scripts/d2-same-host/governance-store.mjs` | `governance-invocation.mjs`<br/>`governance-reservation.mjs`<br/>`governance.mjs` |
| `services/api/scripts/d2-same-host/governance-wiring-contract.mjs` | `governance-contract.mjs` |
| `services/api/scripts/d2-same-host/governance.mjs` | `invocation-worker-fixture.mjs`<br/>`reservation-worker-fixture.mjs`<br/>`verify-governance-crash.mjs`<br/>`verify-governance-git.mjs`<br/>`verify-governance-invocation.mjs`<br/>`verify-governance-reservation.mjs`<br/>`verify-governance-store.mjs` |
| `services/api/scripts/d2-same-host/invocation-worker-fixture.mjs` | `verify-governance-invocation.mjs` |
| `services/api/scripts/d2-same-host/reservation-worker-fixture.mjs` | `verify-governance-crash.mjs` |
| `services/api/scripts/d2-same-host/verify-cleanup-contract.mjs` | `verify-contract.mjs` |
| `services/api/scripts/d2-same-host/verify-governance-crash.mjs` | `verify-governance.mjs` |
| `services/api/scripts/d2-same-host/verify-governance-git.mjs` | `verify-governance.mjs` |
| `services/api/scripts/d2-same-host/verify-governance-invocation.mjs` | `verify-governance.mjs` |
| `services/api/scripts/d2-same-host/verify-governance-reservation.mjs` | `verify-governance.mjs` |
| `services/api/scripts/d2-same-host/verify-governance-store.mjs` | `verify-governance.mjs` |
| `services/api/scripts/d2-same-host/verify-governance-wiring.mjs` | `verify-governance.mjs` |
| `services/api/scripts/deploy-data-safety-gate.ts` | `verify-deploy-data-safety-gate.ts` |
| `services/api/scripts/lib/verify-fair-residue.ts` | `verify-activity-logs.ts`<br/>`verify-admin-fairs.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-jobfair-venue-guide.ts`<br/>`verify-partner-edit.ts`<br/>`verify-public-fair-demo-guard.ts` |
| `services/api/scripts/lib/verify-governed-job-fit-runtime.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-governed-job-fit.ts` |
| `services/api/scripts/recruitment-wave2-restored-dry-run.ts` | `verify-recruitment-wave2-readonly.ts` |
| `services/api/scripts/release-provenance-fixture.ts` | `verify-release-genesis.ts`<br/>`verify-release-provenance.ts` |
| `services/api/scripts/support/admin-phone-transfer-security-cases.ts` | `verify-admin-phone-transfer.ts` |
| `services/api/scripts/support/admin-phone-transfer-static-contract.ts` | `verify-admin-phone-transfer.ts` |
| `services/api/scripts/support/boot-api-child.ts` | `verify-error-observability.ts`<br/>`verify-redis-degradation-truth.ts` |
| `services/api/scripts/support/content-pipeline-fixtures.ts` | `verify-content-pipeline-e2e.ts` |
| `services/api/scripts/support/content-pipeline-harness.ts` | `verify-content-pipeline-e2e.ts` |
| `services/api/scripts/support/internal-auth-verify-harness.ts` | `verify-admin-phone-transfer.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/scripts/support/isolated-verification-database.ts` | `verify-admin-order-filters.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-file-cleanup-cas-ledger.ts`<br/>`verify-isolated-verification-database.ts`<br/>`verify-kiosk-anonymous-feedback.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-member-print-orders.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-redis-degradation-truth.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-scan-deletion-audit-reporting.ts` |
| `services/api/scripts/support/minimal-pdf.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/scripts/support/partner-account-action-static-contract.ts` | `verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/scripts/support/recruitment-wave2-full-inventory.ts` | `verify-recruitment-wave2-full-inventory.ts` |
| `services/api/scripts/support/recruitment-wave2-public-snapshot.ts` | `verify-recruitment-wave2-full-inventory.ts` |
| `services/api/scripts/verify-admin-fairs.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-benefit-redemption.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-career-plan.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-change-password.ts` | `run-verify-change-password.mjs` |
| `services/api/scripts/verify-contract-review-contract.ts` | `verify-fusion-w4.mjs` |
| `services/api/scripts/verify-fair-company-positions.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-fair-info-fields.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-fair-visit-plan.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-file-assets-trial-acceptance.ts` | `verify-file-assets-trial-acceptance.ts` |
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
| `services/api/scripts/verify-member-step-up-adversarial.ts` | `verify-member-step-up.ts` |
| `services/api/scripts/verify-member-step-up-http.ts` | `verify-member-step-up.ts` |
| `services/api/scripts/verify-member-step-up.helpers.ts` | `verify-member-step-up-adversarial.ts`<br/>`verify-member-step-up-http.ts`<br/>`verify-member-step-up.ts` |
| `services/api/scripts/verify-member-step-up.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/scripts/verify-partner-excel-import.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-payment-flow.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-print-scan-first-release.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-print-sign.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-production-real-services.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-production-runtime-gates.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-profile-commercial-first-batch-acceptance.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-print-orders-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs` |
| `services/api/scripts/verify-recruitment-p1-preflight.ts` | `verify-recruitment-p1-schema.ts` |
| `services/api/scripts/verify-resume-generate.ts` | `verify-file-assets-trial-acceptance.ts` |
| `services/api/scripts/verify-toolbox-ai-skill-intents.ts` | `verify-toolbox-ai-skill-real-acceptance.ts` |
| `services/api/scripts/verify-upload-sessions.ts` | `verify-profile-documents-inkpaper.mjs` |
| `services/api/scripts/verify-wave2-account-rebind.ts` | `verify-profile-commercial-first-batch.mjs` |

</details>

<details>
<summary><code>services/api/src/</code> — 414 个文件</summary>

| 文件 | 被这些门禁断言 |
| --- | --- |
| `services/api/src/activity/activity.controller.ts` | `verify-activity-logs.ts` |
| `services/api/src/activity/activity.service.ts` | `verify-activity-logs.ts`<br/>`verify-companies.ts`<br/>`verify-jobfair-checkin.ts`<br/>`verify-member-data-retention.ts` |
| `services/api/src/activity/activity.types.ts` | `verify-activity-logs.ts`<br/>`verify-jobfair-checkin.ts` |
| `services/api/src/activity/me-activity.controller.ts` | `verify-activity-logs.ts` |
| `services/api/src/admin-ops/admin-alert-actions.service.ts` | `verify-admin-ops.ts` |
| `services/api/src/admin-ops/admin-ops.controller.ts` | `verify-admin-ops.ts` |
| `services/api/src/admin-ops/admin-ops.service.ts` | `verify-admin-ops.ts`<br/>`verify-admin-print-outcome.ts` |
| `services/api/src/admin-ops/derived-alerts.ts` | `verify-admin-ops.ts` |
| `services/api/src/admin-orders-readonly/admin-orders-readonly.controller.ts` | `verify-admin-order-filters.ts` |
| `services/api/src/admin-orders-readonly/admin-orders-readonly.service.ts` | `verify-admin-order-filters.ts`<br/>`verify-admin-orders-readonly.ts` |
| `services/api/src/admin-print-scan/admin-print-scan.service.ts` | `verify-admin-print-scan.ts`<br/>`verify-refund-idempotent.ts` |
| `services/api/src/admin-users/admin-users.controller.ts` | `verify-admin-users.ts` |
| `services/api/src/admin-users/admin-users.service.ts` | `verify-admin-users.ts` |
| `services/api/src/admin-users/admin-users.types.ts` | `verify-admin-users.ts` |
| `services/api/src/admin-users/dto/list-admin-users.dto.ts` | `verify-admin-users.ts` |
| `services/api/src/advisor/advisor-artifact.service.ts` | `verify-advisor-work.ts` |
| `services/api/src/advisor/advisor-artifact.types.ts` | `verify-advisor-work.ts` |
| `services/api/src/advisor/advisor-pdf.service.ts` | `verify-advisor-work.ts` |
| `services/api/src/advisor/advisor-retention.task.ts` | `verify-advisor-work.ts`<br/>`verify-ai-user-text-retention.ts` |
| `services/api/src/advisor/advisor-skills.ts` | `verify-advisor-work.ts` |
| `services/api/src/advisor/advisor.module.ts` | `verify-ai-user-text-retention.ts` |
| `services/api/src/advisor/advisor.service.ts` | `verify-advisor-work.ts`<br/>`verify-ai-user-text-retention.ts` |
| `services/api/src/advisor/llm-advisor.service.ts` | `verify-advisor-work.ts` |
| `services/api/src/ai/ai-log.service.ts` | `verify-advisor-work.ts`<br/>`verify-ai-cost-coverage.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-career-plan.ts`<br/>`verify-fair-visit-review.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-mock-interview.ts` |
| `services/api/src/ai/ai-public-quota.service.ts` | `verify-ai-public-quota.ts` |
| `services/api/src/ai/ai-result.cleanup.task.ts` | `verify-assess-isolation.ts`<br/>`verify-job-ai-backend.ts` |
| `services/api/src/ai/ai.controller.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-ai-public-quota.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-assistant-provider-label.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-multipart-field-nesting.ts`<br/>`verify-resume-diagnosis-context.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-resume-voice-generate.ts`<br/>`verify-throttle-dimension.ts` |
| `services/api/src/ai/ai.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-assess-isolation.ts`<br/>`verify-fair-visit-plan.ts`<br/>`verify-governed-job-fit.ts` |
| `services/api/src/ai/ai.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-ai-persistence-consistency.ts`<br/>`verify-ai-result-ownership.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-assistant-provider-label.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-member-data-retention.ts`<br/>`verify-real-resume-diagnosis.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-adjust.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-optimize.ts`<br/>`verify-resume-template-fill.ts` |
| `services/api/src/ai/dto/assistant-chat.dto.ts` | `verify-assistant-provider-label.ts`<br/>`verify-toolbox-ai-skill-intents.ts` |
| `services/api/src/ai/dto/resume-generate.dto.ts` | `verify-resume-export-formats.ts`<br/>`verify-resume-layout-adjust.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-template-fill.ts` |
| `services/api/src/ai/dto/resume-parse.dto.ts` | `verify-resume-diagnosis-context.ts` |
| `services/api/src/ai/dto/resume-voice.dto.ts` | `verify-resume-voice-generate.ts` |
| `services/api/src/ai/fair-visit-plan.controller.ts` | `verify-fair-visit-plan.ts` |
| `services/api/src/ai/interfaces/ai-provider.interface.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-assistant-provider-label.ts`<br/>`verify-resume-diagnosis-context.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-adjust.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-toolbox-ai-skill-intents.ts` |
| `services/api/src/ai/job-fit.controller.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-governed-job-fit.ts`<br/>`verify-job-fit-governance.ts`<br/>`verify-job-fit-print.ts` |
| `services/api/src/ai/llm/llm-chat.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-ai-user-text-retention.ts`<br/>`verify-llm-input-pii-mask.ts`<br/>`verify-toolbox-ai-skill-intents.ts` |
| `services/api/src/ai/llm/llm-config.service.ts` | `verify-ai-config.ts`<br/>`verify-ai-feature-keys.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-llm-connectivity.ts`<br/>`verify-print-param-suggestion.ts` |
| `services/api/src/ai/llm/llm-guard.ts` | `verify-llm-guard.ts` |
| `services/api/src/ai/llm/llm-http.ts` | `verify-ai-throttle-dimension.ts`<br/>`verify-llm-timeout-concurrency.ts` |
| `services/api/src/ai/llm/llm-presets.ts` | `verify-llm-input-pii-mask.ts` |
| `services/api/src/ai/providers/claude.provider.stub.ts` | `verify-ai-cost-coverage.ts` |
| `services/api/src/ai/providers/llm.provider.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-real-resume-diagnosis.ts`<br/>`verify-resume-optimize.ts` |
| `services/api/src/ai/providers/local.provider.stub.ts` | `verify-ai-cost-coverage.ts` |
| `services/api/src/ai/providers/mock.provider.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-toolbox-ai-skill-intents.ts` |
| `services/api/src/ai/providers/openai.provider.stub.ts` | `verify-ai-cost-coverage.ts` |
| `services/api/src/ai/providers/qwen.provider.stub.ts` | `verify-ai-cost-coverage.ts` |
| `services/api/src/ai/providers/zhipu.provider.stub.ts` | `verify-ai-cost-coverage.ts` |
| `services/api/src/ai/resume/appended-self-assessment.service.ts` | `verify-assess-isolation.ts`<br/>`verify-compliance.ts` |
| `services/api/src/ai/resume/career-plan-degraded-pdf.service.ts` | `verify-career-plan-degraded.ts`<br/>`verify-career-plan.ts` |
| `services/api/src/ai/resume/career-plan-degraded.ts` | `verify-career-plan-degraded.ts` |
| `services/api/src/ai/resume/career-plan-pdf.service.ts` | `verify-aigc-pdf-metadata.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-career-plan.ts` |
| `services/api/src/ai/resume/career-plan.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-ai-cost-coverage.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-career-plan.ts`<br/>`verify-compliance.ts` |
| `services/api/src/ai/resume/fair-visit-plan-pdf.service.ts` | `verify-aigc-pdf-metadata.ts`<br/>`verify-fair-visit-plan.ts`<br/>`verify-fair-visit-review.ts` |
| `services/api/src/ai/resume/fair-visit-plan.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-ai-cost-coverage.ts`<br/>`verify-fair-visit-plan.ts`<br/>`verify-fair-visit-review.ts` |
| `services/api/src/ai/resume/job-fit-pdf.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-aigc-pdf-metadata.ts`<br/>`verify-job-fit-print.ts` |
| `services/api/src/ai/resume/job-fit.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-assess-isolation.ts`<br/>`verify-governed-job-fit.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-job-fit-governance.ts`<br/>`verify-job-fit-print.ts`<br/>`verify-job-fit.ts` |
| `services/api/src/ai/resume/llm-career-plan.service.ts` | `verify-ai-feature-keys.ts`<br/>`verify-career-plan.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/ai/resume/llm-fair-visit-plan.service.ts` | `verify-ai-feature-keys.ts`<br/>`verify-fair-visit-plan.ts`<br/>`verify-fair-visit-review.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/ai/resume/llm-job-fit.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-ai-feature-keys.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-job-fit.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/ai/resume/llm-resume-generate.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-llm-input-pii-mask.ts`<br/>`verify-real-resume-diagnosis.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-optimize.ts` |
| `services/api/src/ai/resume/llm-resume-optimize.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-ai-feature-keys.ts`<br/>`verify-llm-input-pii-mask.ts`<br/>`verify-real-resume-diagnosis.ts`<br/>`verify-resume-layout-adjust.ts`<br/>`verify-resume-optimize.ts` |
| `services/api/src/ai/resume/llm-resume.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-llm-input-pii-mask.ts`<br/>`verify-real-resume-diagnosis.ts`<br/>`verify-resume-diagnosis-context.ts`<br/>`verify-resume-optimize.ts` |
| `services/api/src/ai/resume/llm-self-assessment.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-ai-feature-keys.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-compliance.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/ai/resume/ocr/baidu-ocr.provider.ts` | `verify-ai-throttle-dimension.ts`<br/>`verify-ocr-baidu-live.ts`<br/>`verify-ocr-baidu.ts`<br/>`verify-resume-extraction.ts` |
| `services/api/src/ai/resume/ocr/disabled-ocr.provider.ts` | `verify-ocr-baidu-live.ts`<br/>`verify-ocr-baidu.ts`<br/>`verify-resume-extraction.ts` |
| `services/api/src/ai/resume/ocr/ocr.service.ts` | `verify-materials-processing.ts`<br/>`verify-ocr-baidu-live.ts`<br/>`verify-ocr-baidu.ts`<br/>`verify-resume-extraction.ts` |
| `services/api/src/ai/resume/ocr/pdf-page-renderer.ts` | `verify-ocr-baidu-live.ts`<br/>`verify-ocr-baidu.ts` |
| `services/api/src/ai/resume/ocr/tencent-ocr.provider.stub.ts` | `verify-ocr-baidu-live.ts`<br/>`verify-ocr-baidu.ts`<br/>`verify-resume-extraction.ts` |
| `services/api/src/ai/resume/resume-docx.service.ts` | `verify-resume-export-formats.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-template-fill.ts` |
| `services/api/src/ai/resume/resume-extraction.service.ts` | `verify-fair-visit-review.ts`<br/>`verify-ocr-baidu-live.ts`<br/>`verify-ocr-baidu.ts`<br/>`verify-resume-extraction.ts` |
| `services/api/src/ai/resume/resume-pdf.service.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-aigc-pdf-metadata.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-optimize.ts`<br/>`verify-resume-template-fill.ts` |
| `services/api/src/ai/resume/resume-text.service.ts` | `verify-resume-export-formats.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-template-fill.ts` |
| `services/api/src/ai/resume/self-assessment-pdf.service.ts` | `verify-aigc-pdf-metadata.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-compliance.ts` |
| `services/api/src/ai/resume/self-assessment-questions.ts` | `verify-assess-isolation.ts`<br/>`verify-compliance.ts` |
| `services/api/src/ai/resume/self-assessment-scoring.ts` | `verify-self-assessment.ts` |
| `services/api/src/ai/resume/self-assessment.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-assess-isolation.ts`<br/>`verify-compliance.ts` |
| `services/api/src/ai/resume/self-assessment.types.ts` | `verify-assess-isolation.ts`<br/>`verify-compliance.ts` |
| `services/api/src/ai/self-assessment.controller.ts` | `verify-assess-isolation.ts`<br/>`verify-compliance.ts` |
| `services/api/src/app.module.ts` | `verify-fusion-w4.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-contract-review-http.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-privacy.ts`<br/>`verify-job-application-track.ts`<br/>`verify-job-favorites-http.ts`<br/>`verify-job-materials.ts`<br/>`verify-member-assets-c2d.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-qr-login.ts`<br/>`verify-member-step-up.ts`<br/>`verify-trtc-ownership.ts` |
| `services/api/src/asr/asr.service.ts` | `verify-ai-throttle-dimension.ts`<br/>`verify-resume-voice-generate.ts` |
| `services/api/src/audit/audit.module.ts` | `verify-contract-review-http.ts` |
| `services/api/src/audit/audit.service.ts` | `verify-activity-logs.ts`<br/>`verify-admin-billing.ts`<br/>`verify-admin-fairs.ts`<br/>`verify-admin-ops.ts`<br/>`verify-admin-orders-refund.ts`<br/>`verify-admin-orgs.ts`<br/>`verify-admin-pending-dispose.ts`<br/>`verify-admin-phone-transfer.ts`<br/>`verify-admin-print-outcome.ts`<br/>`verify-admin-print-scan.ts`<br/>`verify-admin-users.ts`<br/>`verify-advisor-work.ts`<br/>`verify-audit-logs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-benefit-redemption.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-career-plan.ts`<br/>`verify-change-password.ts`<br/>`verify-companies.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-cos-files.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-fair-visit-review.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-job-fit.ts`<br/>`verify-job-materials.ts`<br/>`verify-job-review.ts`<br/>`verify-job-sync.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-jobfair-venue-guide.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-kiosk-upload-print-contract.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-member-data-request-contract.ts`<br/>`verify-member-data-request-truth.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-mock-interview.ts`<br/>`verify-order.ts`<br/>`verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-email-login-alias.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-partner-smart-campus.ts`<br/>`verify-partner-source-capabilities.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-policies.ts`<br/>`verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts`<br/>`verify-print-jobs.ts`<br/>`verify-public-fair-demo-guard.ts`<br/>`verify-publish-expiry-completeness.ts`<br/>`verify-recruitment-content-http.ts`<br/>`verify-redemption-audit.ts`<br/>`verify-refund-convergence.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-optimize.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-scan-deletion-audit-reporting.ts`<br/>`verify-scan-tasks.ts`<br/>`verify-terminal-credentials.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-provisioning.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/audit/audit.types.ts` | `verify-assess-isolation.ts`<br/>`verify-change-password.ts` |
| `services/api/src/auth/admin-initial-phone-bind.service.ts` | `verify-admin-phone-transfer.ts`<br/>`verify-internal-auth-phone.ts` |
| `services/api/src/auth/admin-phone-transfer.service.ts` | `verify-admin-phone-transfer.ts` |
| `services/api/src/auth/auth.controller.ts` | `verify-change-password.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-partner-account-action-schema.ts` |
| `services/api/src/auth/auth.module.ts` | `verify-internal-auth-phone.ts` |
| `services/api/src/auth/auth.service.ts` | `verify-admin-orgs.ts`<br/>`verify-change-password.ts`<br/>`verify-first-admin-bootstrap.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-partner-account-action-schema.ts`<br/>`verify-partner-email-login-alias.ts` |
| `services/api/src/auth/dto/internal-auth.dto.ts` | `verify-change-password.ts`<br/>`verify-internal-auth-phone.ts` |
| `services/api/src/auth/first-admin-bootstrap.ts` | `verify-first-admin-bootstrap-postgres.ts`<br/>`verify-first-admin-bootstrap.ts` |
| `services/api/src/auth/initial-phone-bind.service.ts` | `verify-internal-auth-phone.ts`<br/>`verify-partner-account-action-schema.ts` |
| `services/api/src/auth/internal-auth-verify-target.ts` | `verify-admin-phone-transfer.ts`<br/>`verify-internal-auth-phone-target-guard.ts`<br/>`verify-internal-auth-phone.ts` |
| `services/api/src/auth/internal-otp.service.ts` | `verify-admin-phone-transfer.ts`<br/>`verify-change-password.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-partner-account-action-otp.ts`<br/>`verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/src/auth/internal-otp.types.ts` | `verify-partner-account-action-otp.ts` |
| `services/api/src/auth/partner-account-action-ticket.ts` | `verify-partner-account-action.ts` |
| `services/api/src/auth/partner-account-action.service.ts` | `verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/src/auth/partner-phone-rebind.service.ts` | `verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/src/auth/password-proof-state.ts` | `verify-admin-phone-transfer.ts` |
| `services/api/src/benefit-activities/admin-benefit-activities.controller.ts` | `verify-benefit-activities.ts` |
| `services/api/src/benefit-activities/benefit-activities.controller.ts` | `verify-benefit-activities.ts` |
| `services/api/src/benefit-activities/benefit-activities.service.ts` | `verify-benefit-activities.ts` |
| `services/api/src/benefit-redemption/benefit-redemption.service.ts` | `verify-benefit-redemption.ts`<br/>`verify-payment-flow.ts`<br/>`verify-redemption-audit.ts` |
| `services/api/src/bulk-publish/bulk-publish.service.ts` | `verify-bulk-publish.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-publish-expiry-completeness.ts` |
| `services/api/src/common/auth/optional-end-user.ts` | `verify-member-account-status.ts`<br/>`verify-member-auth.ts` |
| `services/api/src/common/boot/boot-readiness.ts` | `verify-redis-degradation-truth.ts` |
| `services/api/src/common/client-ip.ts` | `verify-trust-proxy.ts` |
| `services/api/src/common/constants/internal-session.constants.ts` | `verify-file-internal-auth.ts` |
| `services/api/src/common/content-trust.ts` | `verify-content-trust-publish-gate.ts` |
| `services/api/src/common/crypto/email-identity.ts` | `verify-partner-email-login-alias.ts` |
| `services/api/src/common/crypto/phone-identity.ts` | `verify-admin-phone-transfer.ts`<br/>`verify-admin-users.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-member-assets-c2d.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-member-qr-login.ts`<br/>`verify-member-step-up.ts`<br/>`verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/src/common/crypto/secret-cipher.ts` | `verify-content-pipeline-e2e.ts` |
| `services/api/src/common/decorators/current-user.decorator.ts` | `verify-admin-fairs.ts`<br/>`verify-admin-orgs.ts`<br/>`verify-admin-users.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-review.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-jobfair-venue-guide.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-member-data-export-files.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-email-login-alias.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-partner-source-capabilities.ts`<br/>`verify-policies.ts`<br/>`verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts`<br/>`verify-publish-expiry-completeness.ts` |
| `services/api/src/common/decorators/roles.decorator.ts` | `verify-admin-users.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-change-password.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-member-benefits-admin.ts` |
| `services/api/src/common/filters/http-exception.filter.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-ops.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-contract-review-http.ts`<br/>`verify-error-observability.ts`<br/>`verify-http-exception-filter.ts`<br/>`verify-job-favorites-http.ts`<br/>`verify-member-assets-c2d.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-qr-login.ts`<br/>`verify-member-step-up.ts`<br/>`verify-recruitment-content-http.ts` |
| `services/api/src/common/guards/end-user-auth.guard.ts` | `verify-benefit-activities.ts`<br/>`verify-content-pipeline-e2e.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-file-internal-auth.ts`<br/>`verify-job-favorites-http.ts`<br/>`verify-kiosk-anonymous-feedback.ts`<br/>`verify-member-account-status.ts`<br/>`verify-member-assets.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-favorites-benefits.ts`<br/>`verify-member-print-orders.ts`<br/>`verify-upload-sessions-http.ts` |
| `services/api/src/common/guards/jwt-auth.guard.ts` | `verify-admin-ops.ts`<br/>`verify-admin-phone-transfer.ts`<br/>`verify-admin-users.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-change-password.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-recruitment-content-http.ts`<br/>`verify-redis-degradation-truth.ts` |
| `services/api/src/common/guards/member-closure-receipt.guard.ts` | `verify-member-account-status.ts` |
| `services/api/src/common/guards/optional-end-user-auth.guard.ts` | `verify-benefit-activities.ts`<br/>`verify-member-account-status.ts`<br/>`verify-member-auth.ts` |
| `services/api/src/common/guards/roles.guard.ts` | `verify-admin-ops.ts`<br/>`verify-admin-users.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-recruitment-content-http.ts` |
| `services/api/src/common/jwt-verifier.module.ts` | `verify-production-runtime-gates.ts`<br/>`verify-upload-sessions-http.ts` |
| `services/api/src/common/middleware/request-id.middleware.ts` | `verify-error-observability.ts` |
| `services/api/src/common/pdf/aigc-pdf-metadata.ts` | `verify-aigc-pdf-metadata.ts` |
| `services/api/src/common/pickup-code.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts` |
| `services/api/src/common/pii/llm-input-mask.ts` | `verify-llm-input-pii-mask.ts` |
| `services/api/src/common/pii/pii-masker.ts` | `verify-llm-input-pii-mask.ts` |
| `services/api/src/common/recruitment-capability.ts` | `verify-recruitment-capability-gate.ts` |
| `services/api/src/common/redis/member-data-export-redis.service.ts` | `verify-member-data-export-download.ts` |
| `services/api/src/common/redis/partner-account-action-redis.service.ts` | `verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action-redis.ts`<br/>`verify-partner-account-action.ts` |
| `services/api/src/common/redis/redis-degradation.ts` | `verify-file-internal-auth.ts`<br/>`verify-redis-degradation-truth.ts` |
| `services/api/src/common/redis/redis.service.ts` | `verify-activity-logs.ts`<br/>`verify-admin-ops.ts`<br/>`verify-admin-phone-transfer.ts`<br/>`verify-ai-public-quota.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-change-password.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-kiosk-upload-print-contract.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-qr-login.ts`<br/>`verify-member-step-up.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts`<br/>`verify-recruitment-content-http.ts`<br/>`verify-redis-degradation-truth.ts`<br/>`verify-trtc-ownership.ts` |
| `services/api/src/common/throttler/terminal-throttle.ts` | `verify-ai-throttle-dimension.ts`<br/>`verify-throttle-dimension.ts` |
| `services/api/src/companies/companies.controller.ts` | `verify-companies.ts` |
| `services/api/src/companies/companies.service.ts` | `verify-companies.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-job-validity-expiry.ts` |
| `services/api/src/companies/companies.types.ts` | `verify-companies.ts` |
| `services/api/src/config/body-parsers.ts` | `verify-payment-real-channels.ts` |
| `services/api/src/config/production-runtime-gates.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-payment-flow.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-production-real-services.ts`<br/>`verify-production-runtime-gates.ts` |
| `services/api/src/config/trust-proxy.ts` | `verify-trust-proxy.ts` |
| `services/api/src/content/content-signing.ts` | `verify-screensaver-content.ts` |
| `services/api/src/content/content.controller.ts` | `verify-multipart-field-nesting.ts` |
| `services/api/src/content/content.service.ts` | `verify-external-video-e2e.ts`<br/>`verify-screensaver-content.ts` |
| `services/api/src/content/external-video-url.ts` | `verify-external-video.ts` |
| `services/api/src/contract-review/__tests__/contract-review-http-controller.test.ts` | `verify-ai-throttle-dimension.ts` |
| `services/api/src/contract-review/contract-review-error-log.ts` | `verify-contract-review-timeout.ts` |
| `services/api/src/contract-review/contract-review-failure-reason.ts` | `verify-contract-review-timeout.ts` |
| `services/api/src/contract-review/contract-review-http.module.ts` | `verify-contract-review-http.ts` |
| `services/api/src/contract-review/contract-review-orchestrator.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/contract-review/contract-review-pii-masker.ts` | `verify-llm-input-pii-mask.ts` |
| `services/api/src/contract-review/contract-review-provider.service.ts` | `verify-ai-cost-coverage.ts`<br/>`verify-ai-throttle-dimension.ts`<br/>`verify-contract-review-timeout.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/contract-review/contract-review-report-pdf.service.ts` | `verify-aigc-pdf-metadata.ts` |
| `services/api/src/contract-review/contract-review-task-view.mapper.ts` | `verify-contract-review-timeout.ts` |
| `services/api/src/contract-review/contract-review-timing.ts` | `verify-contract-review-timeout.ts` |
| `services/api/src/contract-review/contract-review.queue.ts` | `verify-contract-review-http.ts` |
| `services/api/src/contract-review/contract-review.types.ts` | `verify-contract-review-http.ts`<br/>`verify-contract-review-timeout.ts` |
| `services/api/src/contract-review/dto/contract-review.dto.ts` | `verify-contract-review-http.ts` |
| `services/api/src/device-fleet/device-fleet.controller.ts` | `verify-device-fleet-overview.ts` |
| `services/api/src/device-fleet/device-fleet.projection.ts` | `verify-device-fleet-overview.ts` |
| `services/api/src/device-fleet/device-fleet.service.ts` | `verify-device-fleet-overview.ts` |
| `services/api/src/device-fleet/device-fleet.types.ts` | `verify-device-fleet-overview.ts` |
| `services/api/src/files/content-sniff.ts` | `verify-cos-files.ts`<br/>`verify-upload-sessions.ts` |
| `services/api/src/files/dto/kiosk-upload-options.dto.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-print-sign.ts` |
| `services/api/src/files/file-page-count.util.ts` | `verify-file-display-truth.ts`<br/>`verify-print-sign.ts` |
| `services/api/src/files/file-validation.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-cos-storage.ts`<br/>`verify-file-display-truth.ts`<br/>`verify-member-data-export-files.ts`<br/>`verify-upload-sessions.ts` |
| `services/api/src/files/file.types.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-kiosk-upload-print-contract.ts`<br/>`verify-member-data-export-files.ts`<br/>`verify-member-data-retention.ts`<br/>`verify-upload-sessions.ts` |
| `services/api/src/files/files.cleanup.task.ts` | `verify-file-assets-trial-acceptance.ts` |
| `services/api/src/files/files.controller.ts` | `verify-file-assets-trial-acceptance.ts`<br/>`verify-file-internal-auth.ts`<br/>`verify-kiosk-upload-print-contract.ts`<br/>`verify-member-data-export-files.ts`<br/>`verify-multipart-field-nesting.ts` |
| `services/api/src/files/files.module.ts` | `verify-file-assets-trial-acceptance.ts` |
| `services/api/src/files/files.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-cos-files.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-visit-review.ts`<br/>`verify-file-assets-trial-acceptance.ts`<br/>`verify-file-cleanup-cas-ledger.ts`<br/>`verify-file-delete-consistency.ts`<br/>`verify-file-internal-auth.ts`<br/>`verify-file-lifecycle-summary.ts`<br/>`verify-file-retention.ts`<br/>`verify-job-materials.ts`<br/>`verify-jobfair-venue-guide.ts`<br/>`verify-kiosk-upload-print-contract.ts`<br/>`verify-member-assets-c2d.ts`<br/>`verify-member-data-export-files.ts`<br/>`verify-recruitment-content-http.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-optimize.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-scan-tasks.ts` |
| `services/api/src/files/lifecycle-summary.ts` | `verify-file-lifecycle-summary.ts` |
| `services/api/src/files/member-data-export-file.service.ts` | `verify-member-data-export-files.ts` |
| `services/api/src/files/retention-policy.ts` | `verify-file-retention-ui.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-file-retention.ts`<br/>`verify-member-data-retention.ts`<br/>`verify-resume-generate.ts`<br/>`verify-upload-sessions.ts` |
| `services/api/src/files/signing.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-admin-print-scan.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-kiosk-upload-print-contract.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-conversion.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-sign.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/job-ai/governed-job-fit.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-governed-job-fit.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-privacy.ts` |
| `services/api/src/job-ai/job-ai-llm.service.ts` | `verify-ai-feature-keys.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-llm-input-pii-mask.ts` |
| `services/api/src/job-ai/job-ai-quota.service.ts` | `verify-job-ai-backend.ts`<br/>`verify-job-ai-privacy.ts` |
| `services/api/src/job-ai/job-ai.controller.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-governed-job-fit.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-privacy.ts` |
| `services/api/src/job-ai/job-ai.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-governed-job-fit.ts`<br/>`verify-job-ai-backend.ts` |
| `services/api/src/job-ai/job-ai.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-assess-isolation.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-job-ai-privacy.ts`<br/>`verify-job-validity-expiry.ts` |
| `services/api/src/job-ai/job-context.service.ts` | `verify-job-ai-backend.ts` |
| `services/api/src/job-ai/job-quality.service.ts` | `verify-admin-fairs.ts`<br/>`verify-ai-throttle-dimension.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-review.ts`<br/>`verify-job-sync.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-partner-source-capabilities.ts`<br/>`verify-public-fair-demo-guard.ts` |
| `services/api/src/job-applications/dto/create-job-application.dto.ts` | `verify-job-application-track.ts` |
| `services/api/src/job-applications/dto/update-job-application.dto.ts` | `verify-job-application-track.ts` |
| `services/api/src/job-applications/job-application.types.ts` | `verify-job-application-track.ts` |
| `services/api/src/job-applications/job-applications.controller.ts` | `verify-job-application-track.ts` |
| `services/api/src/job-applications/job-applications.module.ts` | `verify-job-application-track.ts` |
| `services/api/src/job-applications/job-applications.service.ts` | `verify-job-application-track.ts` |
| `services/api/src/job-materials/job-material-pdf.service.ts` | `verify-job-materials.ts` |
| `services/api/src/job-materials/job-material-templates.ts` | `verify-resume-template-fill.ts` |
| `services/api/src/job-materials/job-materials.controller.ts` | `verify-job-materials.ts` |
| `services/api/src/job-materials/job-materials.module.ts` | `verify-job-materials.ts` |
| `services/api/src/job-materials/job-materials.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-job-materials.ts` |
| `services/api/src/job-materials/job-materials.types.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/job-sync/job-sync.controller.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-backend-p0-http.ts` |
| `services/api/src/job-sync/job-sync.module.ts` | `verify-job-data-quality.ts` |
| `services/api/src/job-sync/job-sync.service.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-backend-p0-http.ts`<br/>`verify-content-pipeline-e2e.ts`<br/>`verify-import-review-reset.mjs`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-headcount.ts`<br/>`verify-job-sync.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-partner-source-capabilities.ts` |
| `services/api/src/jobs/admin-fairs.controller.ts` | `verify-jobfair-venue-guide.ts`<br/>`verify-multipart-field-nesting.ts` |
| `services/api/src/jobs/admin-fairs.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-jobfair-venue-guide.ts` |
| `services/api/src/jobs/dto/admin-fair.dto.ts` | `verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts` |
| `services/api/src/jobs/dto/excel-import.dto.ts` | `verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-headcount.ts`<br/>`verify-partner-excel-template.ts` |
| `services/api/src/jobs/dto/import-fairs.dto.ts` | `verify-jobfair-checkin.ts`<br/>`verify-recruitment-integration-readiness.ts` |
| `services/api/src/jobs/dto/import-jobs.dto.ts` | `verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-recruitment-integration-readiness.ts` |
| `services/api/src/jobs/dto/partner-edit.dto.ts` | `verify-jobfair-checkin.ts` |
| `services/api/src/jobs/excel-template.ts` | `verify-job-headcount.ts`<br/>`verify-partner-excel-import.ts`<br/>`verify-partner-excel-template.ts` |
| `services/api/src/jobs/fair-company-print.service.ts` | `verify-backend-p0-http.ts` |
| `services/api/src/jobs/fair-company-zone.service.ts` | `verify-admin-fairs.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-jobfair-venue-guide.ts` |
| `services/api/src/jobs/fair-material-print-bridge.cleanup.task.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/jobs/fair-material-print-bridge.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-jobfair-venue-guide.ts` |
| `services/api/src/jobs/fair-material-signing.ts` | `verify-admin-fairs.ts` |
| `services/api/src/jobs/fair-material.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-jobfair-venue-guide.ts` |
| `services/api/src/jobs/fair-venue-guide.service.ts` | `verify-admin-fairs.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-jobfair-venue-guide.ts` |
| `services/api/src/jobs/job-content-screening.ts` | `verify-job-content-screening.ts` |
| `services/api/src/jobs/job-requirement-certificates.ts` | `verify-job-requirement-stats.ts` |
| `services/api/src/jobs/job-requirement-stats.rules.ts` | `verify-job-requirement-stats.ts` |
| `services/api/src/jobs/job-requirement-stats.service.ts` | `verify-backend-p0-http.ts`<br/>`verify-job-requirement-stats.ts` |
| `services/api/src/jobs/job-validity.ts` | `verify-job-validity-expiry.ts` |
| `services/api/src/jobs/jobs-admin.service.ts` | `verify-admin-fairs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-review.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-public-fair-demo-guard.ts`<br/>`verify-publish-expiry-completeness.ts` |
| `services/api/src/jobs/jobs-excel.service.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-headcount.ts`<br/>`verify-job-review.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-excel-import.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-public-fair-demo-guard.ts` |
| `services/api/src/jobs/jobs-kiosk.service.ts` | `verify-admin-fairs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-fair-stats-truth.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-headcount.ts`<br/>`verify-job-requirement-stats.ts`<br/>`verify-job-review.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-public-fair-demo-guard.ts` |
| `services/api/src/jobs/jobs-partner.service.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-backend-p0-contracts.mjs`<br/>`verify-backend-p0-http.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-headcount.ts`<br/>`verify-job-review.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-partner-source-capabilities.ts`<br/>`verify-public-fair-demo-guard.ts` |
| `services/api/src/jobs/jobs-shared.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-fair-list-integrity.ts`<br/>`verify-fair-stats-truth.ts`<br/>`verify-job-content-screening.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-partner-excel-import.ts` |
| `services/api/src/jobs/jobs.controller.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-backend-p0-http.ts`<br/>`verify-job-ai-ops-dashboard.ts`<br/>`verify-job-requirement-stats.ts`<br/>`verify-multipart-field-nesting.ts`<br/>`verify-partner-excel-template.ts` |
| `services/api/src/jobs/jobs.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-job-data-quality.ts` |
| `services/api/src/jobs/jobs.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-job-customer-sample-readiness.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-review.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-public-fair-demo-guard.ts`<br/>`verify-publish-expiry-completeness.ts`<br/>`verify-recruitment-integration-readiness.ts` |
| `services/api/src/jobs/partner-capabilities.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/jobs/partner-import-file.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-partner-excel-import.ts` |
| `services/api/src/jobs/recruitment-integration.contract.ts` | `verify-recruitment-integration-readiness.ts` |
| `services/api/src/jobs/recruitment-integration.controller.ts` | `verify-recruitment-integration-readiness.ts` |
| `services/api/src/jobs/work-type.ts` | `verify-job-customer-sample-readiness.ts` |
| `services/api/src/legal/admin-legal-docs.controller.ts` | `verify-legal-doc-version.ts` |
| `services/api/src/legal/legal-constants.ts` | `verify-legal-doc-version.ts` |
| `services/api/src/legal/legal.controller.ts` | `verify-legal-doc-version.ts` |
| `services/api/src/legal/legal.service.ts` | `verify-legal-doc-version.ts` |
| `services/api/src/materials/image-print-quality.util.ts` | `verify-file-display-truth.ts` |
| `services/api/src/materials/materials.controller.ts` | `verify-material-task-token-transport.ts`<br/>`verify-throttle-dimension.ts` |
| `services/api/src/materials/materials.service.ts` | `verify-materials-processing.ts`<br/>`verify-print-param-suggestion.ts` |
| `services/api/src/materials/materials.types.ts` | `verify-print-param-suggestion.ts` |
| `services/api/src/materials/print-param-suggestion.rules.ts` | `verify-print-param-suggestion.ts` |
| `services/api/src/materials/print-param-suggestion.service.ts` | `verify-print-param-suggestion.ts` |
| `services/api/src/materials/print-param-suggestion.types.ts` | `verify-print-param-suggestion.ts` |
| `services/api/src/member-assets/member-assets.controller.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-wave2-account-rebind.ts` |
| `services/api/src/member-assets/member-assets.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-assess-isolation.ts`<br/>`verify-career-plan.ts`<br/>`verify-fair-visit-plan.ts`<br/>`verify-job-materials.ts`<br/>`verify-member-assets.ts`<br/>`verify-wave2-account-rebind.ts` |
| `services/api/src/member-assets/member-assets.types.ts` | `verify-assess-isolation.ts` |
| `services/api/src/member-auth/dto/member-login.dto.ts` | `verify-legal-doc-version.ts` |
| `services/api/src/member-auth/dto/member-step-up.dto.ts` | `verify-member-step-up.ts` |
| `services/api/src/member-auth/dto/phone-rebind.dto.ts` | `verify-profile-commercial-first-batch.mjs` |
| `services/api/src/member-auth/member-auth.controller.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-member-account-status.ts`<br/>`verify-member-step-up.ts`<br/>`verify-wave2-account-rebind.ts` |
| `services/api/src/member-auth/member-auth.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-wave2-account-rebind.ts` |
| `services/api/src/member-auth/member-auth.service.ts` | `verify-legal-doc-version.ts`<br/>`verify-member-account-status.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-data-retention.ts`<br/>`verify-member-sms-provider-errors.ts` |
| `services/api/src/member-auth/member-phone-rebind.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-wave2-account-rebind.ts` |
| `services/api/src/member-auth/member-qr-login.service.ts` | `verify-legal-doc-version.ts`<br/>`verify-member-auth.ts` |
| `services/api/src/member-auth/member-step-up.service.ts` | `verify-member-step-up.ts` |
| `services/api/src/member-auth/member-step-up.types.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-member-step-up.ts`<br/>`verify-wave2-account-rebind.ts` |
| `services/api/src/member-auth/sms/sms-sender.ts` | `verify-change-password.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-member-sms-provider-errors.ts`<br/>`verify-member-step-up.helpers.ts`<br/>`verify-member-step-up.ts`<br/>`verify-sms-provider.ts`<br/>`verify-sms-send.ts` |
| `services/api/src/member-benefits/admin-member-benefits.controller.ts` | `verify-member-benefits-admin.ts` |
| `services/api/src/member-benefits/admin-member-benefits.service.ts` | `verify-member-benefits-admin.ts` |
| `services/api/src/member-benefits/member-benefits.service.ts` | `verify-benefit-activities.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-member-favorites-benefits.ts`<br/>`verify-wave3-print-aftercare.ts` |
| `services/api/src/member-favorites/member-favorites.service.ts` | `verify-member-favorites-benefits.ts` |
| `services/api/src/member-feedback/admin-member-feedback.controller.ts` | `verify-feedback-notifications.ts` |
| `services/api/src/member-feedback/dto/kiosk-feedback.dto.ts` | `verify-kiosk-feedback-entry.mjs`<br/>`verify-kiosk-anonymous-feedback.ts` |
| `services/api/src/member-feedback/dto/member-feedback.dto.ts` | `verify-kiosk-anonymous-feedback.ts` |
| `services/api/src/member-feedback/kiosk-feedback.controller.ts` | `verify-kiosk-anonymous-feedback.ts` |
| `services/api/src/member-feedback/kiosk-feedback.service.ts` | `verify-kiosk-anonymous-feedback.ts` |
| `services/api/src/member-feedback/member-feedback.controller.ts` | `verify-feedback-notifications.ts`<br/>`verify-kiosk-anonymous-feedback.ts` |
| `services/api/src/member-feedback/member-feedback.service.ts` | `verify-feedback-notifications.ts` |
| `services/api/src/member-notifications/admin-member-notifications.controller.ts` | `verify-feedback-notifications.ts` |
| `services/api/src/member-notifications/member-notifications.controller.ts` | `verify-feedback-notifications.ts` |
| `services/api/src/member-notifications/member-notifications.service.ts` | `verify-feedback-notifications.ts` |
| `services/api/src/member-print-orders/member-print-order-create.service.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-print-color-duplex-capability.ts` |
| `services/api/src/member-print-orders/member-print-orders.controller.ts` | `verify-member-print-orders.ts`<br/>`verify-miniapp-cloud-print-m2.ts` |
| `services/api/src/member-print-orders/member-print-orders.service.ts` | `verify-member-print-orders.ts`<br/>`verify-order.ts` |
| `services/api/src/member-privacy/admin-member-privacy.controller.ts` | `verify-job-ai-privacy.ts`<br/>`verify-member-data-request-state-machine.ts` |
| `services/api/src/member-privacy/member-data-export-download.service.ts` | `verify-member-data-export-download.ts`<br/>`verify-member-data-request-truth.ts` |
| `services/api/src/member-privacy/member-data-export-reconciler.service.ts` | `verify-member-data-export-download.ts`<br/>`verify-member-data-request-truth.ts` |
| `services/api/src/member-privacy/member-data-export.controller.ts` | `verify-member-data-export-download.ts` |
| `services/api/src/member-privacy/member-data-export.mapper.ts` | `verify-data-request-ui.mjs`<br/>`verify-job-application-track.ts`<br/>`verify-member-data-export.ts` |
| `services/api/src/member-privacy/member-data-export.service.ts` | `verify-member-data-export.ts` |
| `services/api/src/member-privacy/member-data-request.service.ts` | `verify-data-request-ui.mjs`<br/>`verify-job-ai-privacy.ts`<br/>`verify-member-data-request-state-machine.ts`<br/>`verify-member-data-request-truth.ts` |
| `services/api/src/member-privacy/member-privacy.controller.ts` | `verify-job-ai-privacy.ts`<br/>`verify-job-fit-governance.ts` |
| `services/api/src/member-privacy/member-privacy.module.ts` | `verify-job-ai-privacy.ts` |
| `services/api/src/member-privacy/member-privacy.processor.ts` | `verify-member-data-export.ts` |
| `services/api/src/member-privacy/member-privacy.queue.ts` | `verify-member-data-export.ts`<br/>`verify-member-data-request-state-machine.ts` |
| `services/api/src/member-privacy/member-privacy.scheduler.ts` | `verify-member-data-export-download.ts` |
| `services/api/src/member-privacy/member-privacy.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-privacy.ts`<br/>`verify-member-data-request-state-machine.ts`<br/>`verify-member-data-request-truth.ts` |
| `services/api/src/member-privacy/member-privacy.types.ts` | `verify-job-ai-privacy.ts` |
| `services/api/src/mock-interview/asr/asr.service.ts` | `verify-mock-interview.ts` |
| `services/api/src/mock-interview/asr/tts.service.ts` | `verify-ai-throttle-dimension.ts`<br/>`verify-mock-interview.ts` |
| `services/api/src/mock-interview/interview-practice-sheet-pdf.service.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-mock-interview.ts` |
| `services/api/src/mock-interview/interview-practice-sheet.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/mock-interview/interview-report-pdf.service.ts` | `verify-aigc-pdf-metadata.ts`<br/>`verify-mock-interview.ts` |
| `services/api/src/mock-interview/mock-interview-llm.service.ts` | `verify-llm-input-pii-mask.ts`<br/>`verify-mock-interview.ts` |
| `services/api/src/mock-interview/mock-interview.controller.ts` | `verify-ai-down-fallbacks.mjs`<br/>`verify-ai-cost-coverage.ts`<br/>`verify-multipart-field-nesting.ts` |
| `services/api/src/mock-interview/mock-interview.module.ts` | `verify-ai-down-fallbacks.mjs` |
| `services/api/src/mock-interview/mock-interview.service.ts` | `verify-ai-artifact-print-url-contract.mjs`<br/>`verify-ai-down-fallbacks.mjs`<br/>`verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-ai-cost-coverage.ts`<br/>`verify-ai-user-text-retention.ts`<br/>`verify-member-data-retention.ts`<br/>`verify-mock-interview.ts` |
| `services/api/src/offline-agencies/admin-offline-agencies.controller.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-backend-p0-http.ts` |
| `services/api/src/offline-agencies/offline-agencies.service.ts` | `verify-fusion-w4.mjs`<br/>`verify-backend-p0-contracts.mjs`<br/>`verify-backend-p0-http.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-offline-agencies-contract.ts`<br/>`verify-offline-agencies-page.ts` |
| `services/api/src/orgs/admin-org-account-view.ts` | `verify-admin-orgs-delete-schema.ts`<br/>`verify-partner-account-action-schema.ts` |
| `services/api/src/orgs/admin-org-content-trust.service.ts` | `verify-admin-content-trust-ui.mjs`<br/>`verify-content-trust-publish-gate.ts` |
| `services/api/src/orgs/admin-orgs.controller.ts` | `verify-admin-content-trust-ui.mjs` |
| `services/api/src/orgs/admin-orgs.service.ts` | `verify-admin-orgs-delete-concurrency.ts`<br/>`verify-admin-orgs-delete-schema.ts`<br/>`verify-admin-orgs.ts`<br/>`verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action-schema.ts`<br/>`verify-partner-account-action.ts`<br/>`verify-partner-email-login-alias.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-partner-smart-campus.ts` |
| `services/api/src/orgs/dto/partner-account-action.dto.ts` | `verify-partner-account-action.ts` |
| `services/api/src/orgs/partner-stats.controller.ts` | `verify-partner-stats-contract.ts` |
| `services/api/src/orgs/partner-stats.service.ts` | `verify-partner-stats-contract.ts` |
| `services/api/src/payment/admin-billing.controller.ts` | `verify-admin-billing.ts` |
| `services/api/src/payment/admin-billing.service.ts` | `verify-admin-billing.ts` |
| `services/api/src/payment/admin-order-actions.controller.ts` | `verify-order.ts`<br/>`verify-payment-flow.ts` |
| `services/api/src/payment/code-payment-convergence.task.ts` | `verify-payment-codepay.ts` |
| `services/api/src/payment/dto/admin-billing.dto.ts` | `verify-admin-billing.ts` |
| `services/api/src/payment/dto/order-action.dto.ts` | `verify-order.ts`<br/>`verify-payment-flow.ts` |
| `services/api/src/payment/online-payment.service.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-admin-print-scan.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-payment-codepay.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts` |
| `services/api/src/payment/order-quote.service.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-print-color-duplex-capability.ts`<br/>`verify-print-param-suggestion.ts`<br/>`verify-print-parameter-capability.ts` |
| `services/api/src/payment/order-status.service.ts` | `verify-admin-fairs.ts`<br/>`verify-admin-print-scan.ts`<br/>`verify-backend-p0-contracts.mjs`<br/>`verify-career-plan-degraded.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-redemption-audit.ts`<br/>`verify-refund-convergence.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/payment/payment-provider.factory.ts` | `verify-admin-print-scan.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-order.ts`<br/>`verify-payment-codepay.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-refund-convergence.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/payment/payment-provider.types.ts` | `verify-admin-orders-refund.ts`<br/>`verify-admin-print-outcome.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts` |
| `services/api/src/payment/payment-session-token.ts` | `verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-admin-print-scan.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-member-print-orders.ts`<br/>`verify-payment-codepay.ts`<br/>`verify-payment-flow.ts`<br/>`verify-refund-idempotent.ts` |
| `services/api/src/payment/payment.controller.ts` | `verify-price-single-source.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-payment-codepay.ts` |
| `services/api/src/payment/payment.module.ts` | `verify-payment-codepay.ts` |
| `services/api/src/payment/payment.types.ts` | `verify-admin-order-filters.ts` |
| `services/api/src/payment/price-config.seed.ts` | `verify-admin-billing.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-pricing.ts`<br/>`verify-print-color-duplex-capability.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/payment/pricing.service.ts` | `verify-price-single-source.mjs`<br/>`verify-admin-billing.ts`<br/>`verify-admin-fairs.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-pricing.ts`<br/>`verify-print-color-duplex-capability.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/payment/providers/alipay.provider.ts` | `verify-payment-real-channels.ts`<br/>`verify-refund-real-channels.ts` |
| `services/api/src/payment/providers/sandbox-payment.provider.ts` | `verify-admin-print-scan.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-payment-codepay.ts`<br/>`verify-payment-flow.ts`<br/>`verify-refund-idempotent.ts` |
| `services/api/src/payment/providers/wechat-pay.provider.ts` | `verify-payment-codepay.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-refund-convergence.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/payment/qr-payment-expiry.task.ts` | `verify-payment-codepay.ts` |
| `services/api/src/payment/reconciliation.service.ts` | `verify-reconciliation.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/payment/refund-convergence.task.ts` | `verify-refund-convergence.ts` |
| `services/api/src/payment/refund.service.ts` | `verify-admin-orders-refund.ts`<br/>`verify-admin-print-outcome.ts`<br/>`verify-order.ts`<br/>`verify-refund-convergence.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/policies/dto/policy.dto.ts` | `verify-policies.ts`<br/>`verify-policy-eligibility.ts` |
| `services/api/src/policies/policies.service.ts` | `verify-assess-isolation.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-policies.ts`<br/>`verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts`<br/>`verify-publish-expiry-completeness.ts` |
| `services/api/src/policies/policy-eligibility.engine.ts` | `verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts` |
| `services/api/src/policies/policy-eligibility.service.ts` | `verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts` |
| `services/api/src/policies/policy-eligibility.types.ts` | `verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts` |
| `services/api/src/print-conversion/print-conversion.service.ts` | `verify-print-conversion.ts` |
| `services/api/src/print-jobs/admin-closed-pending-print-task-disposition.service.ts` | `verify-closed-pending-print-task-disposition.ts` |
| `services/api/src/print-jobs/admin-legacy-pending-print-task-disposition.service.ts` | `verify-legacy-pending-print-task-disposition.ts` |
| `services/api/src/print-jobs/admin-print-jobs-abandon.service.ts` | `verify-admin-pending-dispose.ts` |
| `services/api/src/print-jobs/admin-print-jobs-verify-outcome.service.ts` | `verify-admin-print-outcome.ts` |
| `services/api/src/print-jobs/dto/claim-pickup.dto.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-miniapp-cloud-print-m2.ts` |
| `services/api/src/print-jobs/dto/create-print-job.dto.ts` | `verify-print-color-duplex-capability.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-parameter-capability.ts` |
| `services/api/src/print-jobs/page-range.util.ts` | `verify-pricing.ts` |
| `services/api/src/print-jobs/pickup-claim-lockout.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-miniapp-cloud-print-m2.ts` |
| `services/api/src/print-jobs/pickup-order.service.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-miniapp-cloud-print-m2.ts` |
| `services/api/src/print-jobs/print-jobs.controller.ts` | `verify-miniapp-cloud-print-m2.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-throttle-dimension.ts` |
| `services/api/src/print-jobs/print-jobs.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-profile-feedback-inkpaper.mjs`<br/>`verify-profile-resumes-notifications-inkpaper.mjs`<br/>`verify-admin-fairs.ts`<br/>`verify-admin-print-scan.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-closed-pending-print-task-disposition.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-legacy-pending-print-task-disposition.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-color-duplex-capability.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-param-suggestion.ts`<br/>`verify-print-parameter-capability.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/print-jobs/print-page-count.service.ts` | `verify-admin-fairs.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/print-jobs/print-pricing.ts` | `verify-order.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-pricing.ts`<br/>`verify-print-color-duplex-capability.ts` |
| `services/api/src/print-jobs/verified-print-parameters.ts` | `verify-print-color-duplex-capability.ts`<br/>`verify-print-param-suggestion.ts`<br/>`verify-print-parameter-capability.ts` |
| `services/api/src/print-sign/print-sign-geometry.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-print-sign.ts` |
| `services/api/src/print-sign/print-sign.controller.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.dto.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.module.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs` |
| `services/api/src/print-sign/print-sign.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-print-sign.ts` |
| `services/api/src/print-sign/print-sign.types.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-print-sign.ts` |
| `services/api/src/prisma/create-client.ts` | `verify-production-db-guard.ts`<br/>`verify-scan-tasks.ts` |
| `services/api/src/prisma/prisma.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-activity-logs.ts`<br/>`verify-admin-billing.ts`<br/>`verify-admin-fairs.ts`<br/>`verify-admin-ops.ts`<br/>`verify-admin-order-filters.ts`<br/>`verify-admin-orders-readonly.ts`<br/>`verify-admin-orders-refund.ts`<br/>`verify-admin-orgs.ts`<br/>`verify-admin-pending-dispose.ts`<br/>`verify-admin-phone-transfer.ts`<br/>`verify-admin-print-outcome.ts`<br/>`verify-admin-print-scan.ts`<br/>`verify-admin-users.ts`<br/>`verify-advisor-work.ts`<br/>`verify-ai-cost-coverage.ts`<br/>`verify-ai-result-ownership.ts`<br/>`verify-audit-logs.ts`<br/>`verify-backend-p0-http.ts`<br/>`verify-benefit-activities.ts`<br/>`verify-benefit-redemption.ts`<br/>`verify-bulk-publish.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-career-plan.ts`<br/>`verify-change-password.ts`<br/>`verify-closed-pending-print-task-disposition.ts`<br/>`verify-companies.ts`<br/>`verify-content-pipeline-e2e.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-cos-files.ts`<br/>`verify-deploy-data-safety-gate.ts`<br/>`verify-end-user-asset-ownership.ts`<br/>`verify-external-video-e2e.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-fair-list-integrity.ts`<br/>`verify-fair-visit-review.ts`<br/>`verify-feedback-notifications.ts`<br/>`verify-field-mapping-rule.ts`<br/>`verify-file-cleanup-cas-ledger.ts`<br/>`verify-first-admin-bootstrap-postgres.ts`<br/>`verify-first-admin-bootstrap.ts`<br/>`verify-internal-auth-phone.ts`<br/>`verify-job-ai-backend.ts`<br/>`verify-job-ai-privacy.ts`<br/>`verify-job-application-track.ts`<br/>`verify-job-data-quality.ts`<br/>`verify-job-favorites-http.ts`<br/>`verify-job-fit.ts`<br/>`verify-job-headcount.ts`<br/>`verify-job-materials.ts`<br/>`verify-job-review.ts`<br/>`verify-job-sync.ts`<br/>`verify-job-validity-expiry.ts`<br/>`verify-jobfair-campus-priority.ts`<br/>`verify-jobfair-review.ts`<br/>`verify-jobfair-venue-guide.ts`<br/>`verify-kiosk-anonymous-feedback.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-legacy-pending-print-task-disposition.ts`<br/>`verify-materials-processing.ts`<br/>`verify-member-assets-c2d.ts`<br/>`verify-member-assets.ts`<br/>`verify-member-auth.ts`<br/>`verify-member-benefits-admin.ts`<br/>`verify-member-data-request-contract.ts`<br/>`verify-member-data-request-truth.ts`<br/>`verify-member-favorites-benefits.ts`<br/>`verify-member-print-orders.ts`<br/>`verify-member-qr-login.ts`<br/>`verify-member-step-up.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-mock-interview.ts`<br/>`verify-offline-agencies-contract.ts`<br/>`verify-order.ts`<br/>`verify-partner-account-action-postgres.ts`<br/>`verify-partner-account-action.ts`<br/>`verify-partner-edit.ts`<br/>`verify-partner-email-login-alias.ts`<br/>`verify-partner-org-self.ts`<br/>`verify-partner-smart-campus.ts`<br/>`verify-partner-source-capabilities.ts`<br/>`verify-partner-stats-contract.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-policies.ts`<br/>`verify-policy-eligibility-authoring.ts`<br/>`verify-policy-eligibility.ts`<br/>`verify-pricing.ts`<br/>`verify-print-color-duplex-capability.ts`<br/>`verify-print-jobs.ts`<br/>`verify-public-fair-demo-guard.ts`<br/>`verify-publish-expiry-completeness.ts`<br/>`verify-real-resume-diagnosis.ts`<br/>`verify-reconciliation.ts`<br/>`verify-recruitment-content-http.ts`<br/>`verify-redemption-audit.ts`<br/>`verify-redis-degradation-truth.ts`<br/>`verify-refund-convergence.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-optimize.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-scan-deletion-audit-reporting.ts`<br/>`verify-screensaver-content.ts`<br/>`verify-terminal-credentials.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-provisioning.ts`<br/>`verify-terminal-test-print-seed-guard.ts`<br/>`verify-toolbox-review-workflow.ts`<br/>`verify-upload-sessions-http.ts`<br/>`verify-wave3-print-aftercare.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/recruitment-content/admin-recruitment-content.controller.ts` | `verify-recruitment-content-http.ts` |
| `services/api/src/recruitment-content/recruitment-content-read.service.ts` | `verify-recruitment-content-http.ts` |
| `services/api/src/recruitment-content/recruitment-content-verify-target.ts` | `verify-recruitment-content-http.ts` |
| `services/api/src/recruitment-content/recruitment-wave2-plan.ts` | `verify-recruitment-wave2-proposed-governance.ts`<br/>`verify-recruitment-wave2-readonly.ts` |
| `services/api/src/recruitment-content/recruitment-wave2-proposed-governance-plan.ts` | `verify-recruitment-wave2-proposed-governance.ts` |
| `services/api/src/recruitment-content/recruitment-wave2-proposed-governance-rules.ts` | `verify-recruitment-wave2-proposed-governance.ts` |
| `services/api/src/recruitment-content/recruitment-wave2-proposed-governance.types.ts` | `verify-recruitment-wave2-proposed-governance.ts` |
| `services/api/src/recruitment-content/recruitment-wave2-target.ts` | `verify-recruitment-wave2-full-inventory.ts`<br/>`verify-recruitment-wave2-readonly.ts` |
| `services/api/src/release-provenance/release-activation.ts` | `verify-release-genesis.ts`<br/>`verify-release-provenance.ts` |
| `services/api/src/release-provenance/release-current-launcher.ts` | `verify-release-provenance.ts` |
| `services/api/src/release-provenance/release-genesis-cli.ts` | `verify-release-genesis.ts` |
| `services/api/src/release-provenance/release-genesis.ts` | `verify-release-genesis.ts` |
| `services/api/src/release-provenance/release-guard.ts` | `verify-release-provenance.ts` |
| `services/api/src/release-provenance/release-manifest-cli.ts` | `verify-release-provenance.ts` |
| `services/api/src/release-provenance/release-provenance.ts` | `verify-release-genesis.ts`<br/>`verify-release-provenance.ts` |
| `services/api/src/release-provenance/release-runtime-contract.ts` | `verify-release-genesis.ts`<br/>`verify-release-provenance.ts` |
| `services/api/src/scan-tasks/dto/create-scan-task.dto.ts` | `verify-scan-tasks.ts` |
| `services/api/src/scan-tasks/scan-task-reaper.task.ts` | `verify-scan-tasks.ts` |
| `services/api/src/scan-tasks/scan-tasks.controller.ts` | `verify-multipart-field-nesting.ts`<br/>`verify-throttle-dimension.ts` |
| `services/api/src/scan-tasks/scan-tasks.service.ts` | `verify-admin-print-scan.ts`<br/>`verify-scan-tasks.ts` |
| `services/api/src/smart-campus/dto/save-smart-campus-config.dto.ts` | `verify-partner-smart-campus.ts` |
| `services/api/src/smart-campus/smart-campus.module.ts` | `verify-terminal-device-config.ts` |
| `services/api/src/smart-campus/smart-campus.service.ts` | `verify-partner-smart-campus.ts`<br/>`verify-terminal-device-config.ts` |
| `services/api/src/smart-campus/smart-campus.types.ts` | `verify-partner-smart-campus.ts` |
| `services/api/src/storage/cos-signing.ts` | `verify-cos-storage.ts` |
| `services/api/src/storage/cos-storage.backend.ts` | `verify-cos-lifecycle-policy.ts`<br/>`verify-cos-live.ts` |
| `services/api/src/storage/object-key.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-cos-storage.ts`<br/>`verify-member-data-export-files.ts` |
| `services/api/src/storage/storage.interface.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-materials-processing.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/storage/storage.module.ts` | `verify-contract-review-http.ts` |
| `services/api/src/storage/storage.service.ts` | `verify-admin-fairs.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-content-trust-publish-gate.ts`<br/>`verify-cos-files.ts`<br/>`verify-external-video-e2e.ts`<br/>`verify-fair-company-positions.ts`<br/>`verify-fair-info-fields.ts`<br/>`verify-job-materials.ts`<br/>`verify-jobfair-venue-guide.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-materials-processing.ts`<br/>`verify-member-data-retention.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-resume-export-formats.ts`<br/>`verify-resume-generate.ts`<br/>`verify-resume-layout-export.ts`<br/>`verify-resume-optimize.ts`<br/>`verify-resume-template-fill.ts`<br/>`verify-scan-tasks.ts`<br/>`verify-screensaver-content.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/sync/dto/webhook-payload.dto.ts` | `verify-job-customer-sample-readiness.ts` |
| `services/api/src/sync/sync.controller.ts` | `verify-backend-p0-contracts.mjs` |
| `services/api/src/sync/sync.service.ts` | `verify-backend-p0-contracts.mjs`<br/>`verify-job-customer-sample-readiness.ts` |
| `services/api/src/terminals/admin-terminals.controller.ts` | `verify-terminal-bind-code.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-provisioning.ts` |
| `services/api/src/terminals/admin-toolbox.controller.ts` | `verify-terminal-device-config.ts`<br/>`verify-toolbox-launch-events.ts`<br/>`verify-toolbox-review-workflow.ts` |
| `services/api/src/terminals/dto/create-terminal-bind-code.dto.ts` | `verify-terminal-bind-code.ts` |
| `services/api/src/terminals/dto/exchange-terminal-bind-code.dto.ts` | `verify-terminal-bind-code.ts` |
| `services/api/src/terminals/dto/heartbeat.dto.ts` | `verify-terminal-network-diagnostics.ts` |
| `services/api/src/terminals/dto/record-toolbox-launch-event.dto.ts` | `verify-toolbox-launch-events.ts` |
| `services/api/src/terminals/dto/save-toolbox-config.dto.ts` | `verify-terminal-device-config.ts` |
| `services/api/src/terminals/release-observation.service.ts` | `verify-release-observation-contract.mjs` |
| `services/api/src/terminals/terminal-capabilities.service.ts` | `verify-admin-fairs.ts`<br/>`verify-admin-print-scan.ts`<br/>`verify-career-plan-degraded.ts`<br/>`verify-kiosk-cashier-ui.ts`<br/>`verify-legacy-pending-print-task-disposition.ts`<br/>`verify-miniapp-cloud-print-m2.ts`<br/>`verify-order.ts`<br/>`verify-payment-flow.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-color-duplex-capability.ts`<br/>`verify-print-jobs.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-refund-real-channels.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-wechat-refund-notify.ts`<br/>`verify-wechat-refund-regression.ts` |
| `services/api/src/terminals/terminal-capabilities.types.ts` | `verify-admin-print-scan.ts`<br/>`verify-print-color-duplex-capability.ts` |
| `services/api/src/terminals/terminal-config.types.ts` | `verify-terminal-device-config.ts` |
| `services/api/src/terminals/terminal-credential-security.service.ts` | `verify-terminal-bind-code.ts`<br/>`verify-terminal-device-config.ts` |
| `services/api/src/terminals/terminal-toolbox.service.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-order.ts`<br/>`verify-partner-smart-campus.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-terminal-credentials.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-provisioning.ts`<br/>`verify-terminal-test-print-seed-guard.ts`<br/>`verify-toolbox-launch-events.ts`<br/>`verify-toolbox-micro-app-platform.ts`<br/>`verify-toolbox-review-workflow.ts` |
| `services/api/src/terminals/terminal-utils.ts` | `verify-print-rollout-config.ts`<br/>`verify-terminal-bind-code.ts` |
| `services/api/src/terminals/terminals-admin.service.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-legacy-pending-print-task-disposition.ts`<br/>`verify-order.ts`<br/>`verify-partner-smart-campus.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-terminal-credentials.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-network-diagnostics.ts`<br/>`verify-terminal-provisioning.ts`<br/>`verify-terminal-test-print-seed-guard.ts` |
| `services/api/src/terminals/terminals-agent.service.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-legacy-pending-print-task-disposition.ts`<br/>`verify-order.ts`<br/>`verify-partner-smart-campus.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-scan-deletion-audit-reporting.ts`<br/>`verify-terminal-bind-code.ts`<br/>`verify-terminal-credentials.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-network-diagnostics.ts`<br/>`verify-terminal-provisioning.ts`<br/>`verify-terminal-status-idempotency.ts`<br/>`verify-terminal-test-print-seed-guard.ts` |
| `services/api/src/terminals/terminals.controller.ts` | `verify-print-color-duplex-capability.ts`<br/>`verify-release-observation-contract.mjs`<br/>`verify-scan-deletion-audit-reporting.ts`<br/>`verify-terminal-bind-code.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-throttle-dimension.ts`<br/>`verify-toolbox-launch-events.ts` |
| `services/api/src/terminals/terminals.service.ts` | `verify-kiosk-cashier-ui.ts`<br/>`verify-legacy-pending-print-task-disposition.ts`<br/>`verify-order.ts`<br/>`verify-partner-smart-campus.ts`<br/>`verify-payment-real-channels.ts`<br/>`verify-print-jobs.ts`<br/>`verify-print-rollout-config.ts`<br/>`verify-print-scan-first-release.ts`<br/>`verify-refund-idempotent.ts`<br/>`verify-terminal-bind-code.ts`<br/>`verify-terminal-credentials.ts`<br/>`verify-terminal-device-config.ts`<br/>`verify-terminal-provisioning.ts`<br/>`verify-terminal-test-print-seed-guard.ts` |
| `services/api/src/terminals/toolbox-governance.helpers.ts` | `verify-toolbox-review-workflow.ts` |
| `services/api/src/terminals/toolbox-governance.service.ts` | `verify-toolbox-review-workflow.ts` |
| `services/api/src/terminals/toolbox-governance.ts` | `verify-toolbox-micro-app-platform.ts`<br/>`verify-toolbox-review-workflow.ts` |
| `services/api/src/terminals/toolbox-policy.ts` | `verify-terminal-device-config.ts`<br/>`verify-toolbox-micro-app-platform.ts` |
| `services/api/src/terminals/toolbox-projection.ts` | `verify-toolbox-review-workflow.ts` |
| `services/api/src/trtc/trtc.controller.ts` | `verify-trtc-ownership.ts` |
| `services/api/src/trtc/trtc.service.ts` | `verify-llm-input-pii-mask.ts` |
| `services/api/src/upload-sessions/upload-sessions.controller.ts` | `verify-multipart-field-nesting.ts`<br/>`verify-upload-sessions.ts` |
| `services/api/src/upload-sessions/upload-sessions.service.ts` | `verify-profile-commercial-first-batch.mjs`<br/>`verify-profile-documents-inkpaper.mjs`<br/>`verify-upload-sessions.ts` |

</details>
