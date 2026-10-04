<!-- 本文件由 scripts/generate-project-graph.mjs 自动生成，请勿手改。 -->
<!-- 手改会在下次 `node scripts/generate-project-graph.mjs` 时被覆盖。 -->
# 数据模型图谱

`109` 个 Prisma 模型，来源 `services/api/prisma/schema.prisma`。

下图只画**关系度数最高的 18 个模型**：全量 109 个节点的
ER 图人是读不了的。全量关系见下方表格和 `graph.json`。

```mermaid
flowchart TD
  EndUser["EndUser<br/><small>34 字段</small>"]
  Organization["Organization<br/><small>28 字段</small>"]
  Terminal["Terminal<br/><small>29 字段</small>"]
  FileObject["FileObject<br/><small>50 字段</small>"]
  Job["Job<br/><small>47 字段</small>"]
  JobFair["JobFair<br/><small>39 字段</small>"]
  JobSource["JobSource<br/><small>30 字段</small>"]
  User["User<br/><small>28 字段</small>"]
  PrintTask["PrintTask<br/><small>22 字段</small>"]
  AgentReleaseTarget["AgentReleaseTarget<br/><small>10 字段</small>"]
  Order["Order<br/><small>42 字段</small>"]
  ActiveReleaseObservationAssignment["ActiveReleaseObservationAssignment<br/><small>7 字段</small>"]
  AgentReleasePlan["AgentReleasePlan<br/><small>18 字段</small>"]
  BenefitClaim["BenefitClaim<br/><small>8 字段</small>"]
  DocumentProcessTask["DocumentProcessTask<br/><small>19 字段</small>"]
  FairCompany["FairCompany<br/><small>22 字段</small>"]
  FairVenueGuide["FairVenueGuide<br/><small>8 字段</small>"]
  OfflineAgencyBranch["OfflineAgencyBranch<br/><small>31 字段</small>"]
  EndUser --- BenefitClaim
  EndUser --- DocumentProcessTask
  EndUser --- FileObject
  EndUser --- PrintTask
  Organization --- Job
  Organization --- JobFair
  Organization --- JobSource
  Organization --- Terminal
  Organization --- User
  Terminal --- ActiveReleaseObservationAssignment
  Terminal --- AgentReleaseTarget
  Terminal --- PrintTask
  FileObject --- DocumentProcessTask
  FileObject --- PrintTask
  FileObject --- User
  Job --- JobSource
  Job --- OfflineAgencyBranch
  JobFair --- FairCompany
  JobFair --- FairVenueGuide
  JobFair --- JobSource
  PrintTask --- Order
  AgentReleaseTarget --- ActiveReleaseObservationAssignment
  AgentReleaseTarget --- AgentReleasePlan
  ActiveReleaseObservationAssignment --- AgentReleasePlan
```

## 全部模型

| 模型 | 字段数 | 关联模型 | 被哪些文件读写 |
| --- | --- | --- | --- |
| **ActiveReleaseObservationAssignment** | 7 | AgentReleasePlan、AgentReleaseTarget、Terminal | 1 个文件<br/>`terminals/release-observation.service.ts` |
| **AdAsset** | 19 | AdPlaylistItem | 1 个文件<br/>`content/content.service.ts` |
| **AdPlaylist** | 9 | AdPlaylistItem、TerminalScreensaverConfig | 1 个文件<br/>`content/content.service.ts` |
| **AdPlaylistItem** | 8 | AdAsset、AdPlaylist | 1 个文件<br/>`content/content.service.ts` |
| **AdvisorArtifact** | 11 | AdvisorSession | 6 个文件<br/>`advisor/advisor-artifact.service.ts`<br/>`advisor/advisor-retention.task.ts`<br/>`advisor/advisor.service.ts`<br/>… |
| **AdvisorPin** | 8 | AdvisorSession | 2 个文件<br/>`advisor/advisor.service.ts`<br/>`member-privacy/member-closure.service.ts` |
| **AdvisorSession** | 14 | AdvisorArtifact、AdvisorPin | 3 个文件<br/>`advisor/advisor-retention.task.ts`<br/>`advisor/advisor.service.ts`<br/>`advisor/assistant-summary.service.ts` |
| **AgentReleaseArtifact** | 11 | AgentReleasePlan | 1 个文件<br/>`terminals/release-observation.service.ts` |
| **AgentReleasePlan** | 18 | ActiveReleaseObservationAssignment、AgentReleaseArtifact、AgentReleaseTarget | 1 个文件<br/>`terminals/release-observation.service.ts` |
| **AgentReleaseTarget** | 10 | ActiveReleaseObservationAssignment、AgentReleasePlan、Terminal、TerminalReleaseObservation | 1 个文件<br/>`terminals/release-observation.service.ts` |
| **AiResumeResult** | 16 | EndUser | 15 个文件<br/>`admin-users/admin-users.service.ts`<br/>`ai/ai.service.ts`<br/>`ai/resume-parse-submission.service.ts`<br/>… |
| **AiServiceLog** | 13 | EndUser | 5 个文件<br/>`ai/ai-log.service.ts`<br/>`ai/ai-result.cleanup.task.ts`<br/>`console-screen/console-screen.queries.ts`<br/>… |
| **AiUsageMonthlySummary** | 10 | — | 1 个文件<br/>`ai/usage/ai-usage-retention.ts` |
| **AiUsageRecord** | 18 | EndUser | 4 个文件<br/>`ai/usage/ai-budget.service.ts`<br/>`ai/usage/ai-usage-retention.ts`<br/>`ai/usage/ai-usage-summary.ts`<br/>… |
| **AlertDisposition** | 12 | — | 2 个文件<br/>`admin-ops/admin-alert-actions.service.ts`<br/>`admin-ops/admin-ops.service.ts` |
| **AuditLog** | 12 | User | 23 个文件<br/>`admin-internal-accounts/backup-admin-emergency-enable.ts`<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>`admin-users/admin-user-closure-read.ts`<br/>… |
| **BenefitActivity** | 19 | BenefitClaim、User | 2 个文件<br/>`benefit-activities/benefit-activities.service.ts`<br/>`community/community.service.ts` |
| **BenefitClaim** | 8 | BenefitActivity、BenefitGrant、EndUser | 2 个文件<br/>`benefit-activities/benefit-activities.service.ts`<br/>`member-privacy/member-closure-retention.ts` |
| **BenefitGrant** | 16 | BenefitClaim、EndUser | 8 个文件<br/>`benefit-activities/benefit-activities.service.ts`<br/>`benefit-redemption/benefit-redemption.service.ts`<br/>`benefit-redemption/resume-export-gate.service.ts`<br/>… |
| **BroadcastReadState** | 9 | EndUser、SystemBroadcast | 1 个文件<br/>`member-notifications/member-notifications.service.ts` |
| **BrowseLog** | 12 | EndUser | 4 个文件<br/>`activity/activity.service.ts`<br/>`admin-users/admin-users.service.ts`<br/>`console-screen/console-screen.usage.queries.ts`<br/>… |
| **CompanyProfile** | 37 | Job、Organization | 6 个文件<br/>`activity/activity.service.ts`<br/>`companies/companies.service.ts`<br/>`console-screen/console-screen.queries.ts`<br/>… |
| **ContractReviewTask** | 30 | EndUser | 8 个文件<br/>`contract-review/__tests__/contract-review-orchestrator.test.ts`<br/>`contract-review/contract-review-lifecycle.service.ts`<br/>`contract-review/contract-review-orchestrator.service.ts`<br/>… |
| **DocumentProcessTask** | 19 | EndUser、FileObject、PiiFinding | 6 个文件<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>`materials/materials-manual-confirmation.service.ts`<br/>`materials/materials.service.ts`<br/>… |
| **EndUser** | 34 | AiResumeResult、AiServiceLog、AiUsageRecord、BenefitClaim、BenefitGrant、BroadcastReadState、BrowseLog、ContractReviewTask、DocumentProcessTask、ExternalJumpLog、Favorite、FeedbackTicket、FileObject、JobAiSession、JobApplication、MemberLegalConsent、MemberNotification、PrintTask、ScanTask、UserAiConsent、UserDataRequest | 14 个文件<br/>`admin-orders-readonly/admin-orders-readonly.service.ts`<br/>`admin-users/admin-users.service.ts`<br/>`benefit-activities/benefit-activities.service.ts`<br/>… |
| **ExternalJumpLog** | 13 | EndUser | 6 个文件<br/>`activity/activity.service.ts`<br/>`admin-users/admin-users.service.ts`<br/>`ai/resume/fair-visit-plan.service.ts`<br/>… |
| **FairCompany** | 22 | FairCompanyPosition、FairVenueHallCompany、JobFair | 8 个文件<br/>`activity/activity.service.ts`<br/>`companies/companies.service.ts`<br/>`console-screen/console-screen.queries.ts`<br/>… |
| **FairCompanyBooth** | 9 | — | **无代码读写** |
| **FairCompanyPosition** | 16 | FairCompany | **无代码读写** |
| **FairMaterial** | 19 | FairMaterialPrintBridge、JobFair | 5 个文件<br/>`console-screen/console-screen.queries.ts`<br/>`jobs/admin-fairs.service.ts`<br/>`jobs/fair-material-print-bridge.service.ts`<br/>… |
| **FairMaterialPrintBridge** | 17 | FairMaterial、FileObject | 3 个文件<br/>`files/files.service.ts`<br/>`jobs/fair-material-print-bridge.service.ts`<br/>`print-jobs/print-jobs.service.ts` |
| **FairVenueFacility** | 10 | FairVenueGuide | 1 个文件<br/>`jobs/fair-venue-guide.service.ts` |
| **FairVenueGuide** | 8 | FairVenueFacility、FairVenueHall、JobFair | 1 个文件<br/>`jobs/fair-venue-guide.service.ts` |
| **FairVenueHall** | 12 | FairVenueGuide、FairVenueHallCompany | 1 个文件<br/>`jobs/fair-venue-guide.service.ts` |
| **FairVenueHallCompany** | 9 | FairCompany、FairVenueHall | **无代码读写** |
| **FairZone** | 11 | JobFair | 4 个文件<br/>`console-screen/console-screen.queries.ts`<br/>`jobs/admin-fairs.service.ts`<br/>`jobs/fair-company-zone.service.ts`<br/>… |
| **Favorite** | 7 | EndUser | 4 个文件<br/>`assistant/daily-brief.service.ts`<br/>`console-screen/console-screen.usage.queries.ts`<br/>`member-favorites/member-favorites.service.ts`<br/>… |
| **FeedbackReply** | 8 | FeedbackTicket、User | 2 个文件<br/>`member-feedback/member-feedback.service.ts`<br/>`member-privacy/member-closure-retention.ts` |
| **FeedbackTicket** | 17 | EndUser、FeedbackReply | 5 个文件<br/>`admin-ops/derived-alerts.ts`<br/>`member-feedback/kiosk-feedback.service.ts`<br/>`member-feedback/member-feedback.service.ts`<br/>… |
| **FieldMappingRule** | 9 | JobSource | 1 个文件<br/>`jobs/jobs-excel.service.ts` |
| **FileObject** | 50 | DocumentProcessTask、EndUser、FairMaterialPrintBridge、OnlinePlatformDirectory、PlatformQualification、PrintTask、QualificationRecord、User | 39 个文件<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>`admin-users/admin-users.service.ts`<br/>`ai/ai.service.ts`<br/>… |
| **HelpItem** | 8 | — | **无代码读写** |
| **ImportBatch** | 17 | ImportRecord、JobSource | 2 个文件<br/>`jobs/jobs-admin.service.ts`<br/>`jobs/jobs-excel.service.ts` |
| **ImportRecord** | 10 | ImportBatch | 1 个文件<br/>`jobs/jobs-excel.service.ts` |
| **Job** | 47 | CompanyProfile、JobAiRecommendation、JobApplication、JobDataQualitySnapshot、JobSource、OfflineAgencyBranch、OfflineJob、Organization | 21 个文件<br/>`activity/activity.service.ts`<br/>`ai/resume/job-fit.service.ts`<br/>`assistant/daily-brief.service.ts`<br/>… |
| **JobAiRecommendation** | 12 | Job、JobAiSession | 3 个文件<br/>`job-ai/governed-job-fit.service.ts`<br/>`job-ai/job-ai.service.ts`<br/>`member-privacy/member-closure.service.ts` |
| **JobAiSession** | 14 | EndUser、JobAiRecommendation | 5 个文件<br/>`ai/ai-result.cleanup.task.ts`<br/>`job-ai/governed-job-fit.service.ts`<br/>`job-ai/job-ai.service.ts`<br/>… |
| **JobApplication** | 17 | EndUser、Job | 2 个文件<br/>`job-applications/job-applications.service.ts`<br/>`member-privacy/member-data-export.mapper.ts` |
| **JobDataQualitySnapshot** | 10 | Job、Organization | 1 个文件<br/>`job-ai/job-quality.service.ts` |
| **JobFair** | 39 | FairCompany、FairMaterial、FairVenueGuide、FairZone、JobSource、Organization | 22 个文件<br/>`activity/activity.service.ts`<br/>`ai/resume/fair-visit-plan.service.ts`<br/>`assistant/daily-brief.service.ts`<br/>… |
| **JobMaterialTemplate** | 14 | — | 2 个文件<br/>`ai/ai.service.ts`<br/>`job-materials/job-materials.service.ts` |
| **JobSource** | 30 | FieldMappingRule、ImportBatch、Job、JobFair、Organization、SyncLog | 7 个文件<br/>`job-sync/job-sync.service.ts`<br/>`jobs/data-source-credential-policy.ts`<br/>`jobs/jobs-excel.service.ts`<br/>… |
| **KioskActivity** | 12 | — | **无代码读写** |
| **KioskJobBoardConfig** | 6 | — | 1 个文件<br/>`terminals/kiosk-job-board.service.ts` |
| **KioskSession** | 14 | — | 6 个文件<br/>`ai/resume/resume-draft-source.service.ts`<br/>`console-screen/console-screen.visits.ts`<br/>`kiosk-session/kiosk-session-retention.task.ts`<br/>… |
| **LegalDocVersion** | 10 | — | 3 个文件<br/>`ai/resume/resume-unlabeled-export.ts`<br/>`legal/legal.service.ts`<br/>`member-auth/member-auth.service.ts` |
| **MemberLegalConsent** | 10 | EndUser | 3 个文件<br/>`ai/resume/resume-unlabeled-export.ts`<br/>`member-auth/member-auth.service.ts`<br/>`member-privacy/member-closure-retention.ts` |
| **MemberNotification** | 12 | EndUser | 2 个文件<br/>`member-notifications/member-notifications.service.ts`<br/>`member-privacy/member-data-export.mapper.ts` |
| **MockInterviewReport** | 6 | MockInterviewSession | 2 个文件<br/>`member-privacy/member-closure.service.ts`<br/>`mock-interview/mock-interview.service.ts` |
| **MockInterviewSession** | 21 | MockInterviewReport、MockInterviewTurn | 4 个文件<br/>`ai/resume/career-plan.service.ts`<br/>`member-privacy/member-closure-files.ts`<br/>`member-privacy/member-data-export.mapper.ts`<br/>… |
| **MockInterviewTurn** | 13 | MockInterviewSession | 2 个文件<br/>`member-privacy/member-closure.service.ts`<br/>`mock-interview/mock-interview.service.ts` |
| **OfflineAgency** | 23 | OfflineJob | 2 个文件<br/>`offline-agencies/offline-agencies.service.ts`<br/>`recruitment-hosting/recruitment-emergency.service.ts` |
| **OfflineAgencyBranch** | 31 | Job、OfflineAgencyProfile、QualificationRecord | 1 个文件<br/>`recruitment-content/recruitment-content-read.service.ts` |
| **OfflineAgencyProfile** | 19 | OfflineAgencyBranch、Organization | 1 个文件<br/>`recruitment-content/recruitment-content-read.service.ts` |
| **OfflineJob** | 22 | Job、OfflineAgency | 1 个文件<br/>`offline-agencies/offline-agencies.service.ts` |
| **OnlinePlatformDirectory** | 33 | FileObject、Organization | 3 个文件<br/>`official-channels/official-channels.service.ts`<br/>`recruitment-content/recruitment-content-read.service.ts`<br/>`recruitment-hosting/recruitment-emergency.service.ts` |
| **Order** | 42 | OrderItem、PaymentAttempt、PrintTask、Refund | 30 个文件<br/>`admin-orders-readonly/admin-orders-readonly.service.ts`<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>`assistant/daily-brief.service.ts`<br/>… |
| **OrderItem** | 15 | Order | 7 个文件<br/>`console-screen/console-screen.printed-pages.ts`<br/>`member-print-orders/package-order-fulfillment.service.ts`<br/>`member-privacy/member-closure-retention.ts`<br/>… |
| **OrderSubmissionLedger** | 11 | — | 2 个文件<br/>`member-print-orders/order-submission-ledger.ts`<br/>`member-privacy/member-closure-retention.ts` |
| **Organization** | 28 | CompanyProfile、Job、JobDataQualitySnapshot、JobFair、JobSource、OfflineAgencyProfile、OnlinePlatformDirectory、PolicyPost、QualificationRecord、Terminal、User | 20 个文件<br/>`ai/usage/ai-usage-summary.ts`<br/>`auth/auth.service.ts`<br/>`auth/partner-account-action.service.ts`<br/>… |
| **PartnerOrgNotice** | 8 | — | 2 个文件<br/>`policies/policies.service.ts`<br/>`recruitment-hosting/recruitment-emergency.service.ts` |
| **PaymentAttempt** | 13 | Order | 5 个文件<br/>`admin-orders-readonly/admin-orders-readonly.service.ts`<br/>`member-privacy/member-closure-retention.ts`<br/>`payment/online-payment.service.ts`<br/>… |
| **PiiFinding** | 11 | DocumentProcessTask | 3 个文件<br/>`materials/materials.service.ts`<br/>`member-privacy/member-closure.service.ts`<br/>`print-jobs/pii-scan-gate.ts` |
| **PlatformQualification** | 19 | FileObject | 1 个文件<br/>`common/recruitment-capability.ts` |
| **PolicyEligibilityRule** | 10 | PolicyPost | 1 个文件<br/>`policies/policy-eligibility.service.ts` |
| **PolicyPost** | 26 | Organization、PolicyEligibilityRule | 12 个文件<br/>`activity/activity.service.ts`<br/>`assistant/daily-brief.service.ts`<br/>`bulk-publish/bulk-publish.service.ts`<br/>… |
| **PriceConfig** | 9 | — | 4 个文件<br/>`benefit-redemption/resume-export-gate.service.ts`<br/>`payment/admin-billing.service.ts`<br/>`payment/price-config.seed.ts`<br/>… |
| **PrintMaterialPack** | 9 | — | **无代码读写** |
| **PrintTask** | 22 | EndUser、FileObject、Order、PrintTaskStatusLog、Terminal | 35 个文件<br/>`admin-ops/admin-ops.service.ts`<br/>`admin-ops/derived-alerts.ts`<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>… |
| **PrintTaskStatusLog** | 7 | PrintTask | 12 个文件<br/>`admin-orders-readonly/admin-orders-readonly.service.ts`<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>`console-screen/console-screen.queries.ts`<br/>… |
| **QualificationRecord** | 26 | FileObject、OfflineAgencyBranch、Organization | 1 个文件<br/>`recruitment-content/recruitment-content-read.service.ts` |
| **RecruitmentCircuitBreak** | 7 | — | 2 个文件<br/>`official-channels/official-channels.service.ts`<br/>`recruitment-hosting/recruitment-emergency.service.ts` |
| **RecruitmentEmergencyHold** | 9 | — | 3 个文件<br/>`official-channels/official-channels.service.ts`<br/>`policies/policies.service.ts`<br/>`recruitment-hosting/recruitment-emergency.service.ts` |
| **RedemptionRecord** | 11 | — | 4 个文件<br/>`benefit-redemption/benefit-redemption.service.ts`<br/>`benefit-redemption/resume-export-gate.service.ts`<br/>`member-benefits/member-benefits.service.ts`<br/>… |
| **Refund** | 12 | Order | 4 个文件<br/>`member-privacy/member-closure-retention.ts`<br/>`payment/reconciliation.service.ts`<br/>`payment/refund-amount-hold.ts`<br/>… |
| **ReviewDecision** | 18 | User | **无代码读写** |
| **ScanTask** | 22 | EndUser、Terminal | 11 个文件<br/>`admin-print-scan/admin-print-scan.service.ts`<br/>`console-screen/console-screen.fleet.ts`<br/>`console-screen/console-screen.queries.ts`<br/>… |
| **ScreensaverContent** | 9 | — | **无代码读写** |
| **StorageDeletion** | 6 | — | 2 个文件<br/>`files/closure-file-deletion.ts`<br/>`member-privacy/member-closure-redis.service.ts` |
| **SyncLog** | 15 | JobSource | 6 个文件<br/>`console-screen/console-screen.queries.ts`<br/>`job-sync/job-sync.service.ts`<br/>`jobs/jobs-excel.service.ts`<br/>… |
| **SystemBroadcast** | 9 | BroadcastReadState | 3 个文件<br/>`assistant/daily-brief.service.ts`<br/>`community/community.service.ts`<br/>`member-notifications/member-notifications.service.ts` |
| **Terminal** | 29 | ActiveReleaseObservationAssignment、AgentReleaseTarget、Organization、PrintTask、ScanTask、TerminalBindCode、TerminalCapability、TerminalCredential、TerminalHeartbeat、TerminalScanDeletionAudit | 37 个文件<br/>`activity/activity.controller.ts`<br/>`admin-ops/derived-alerts.ts`<br/>`admin-orders-readonly/admin-orders-readonly.service.ts`<br/>… |
| **TerminalBindCode** | 10 | Terminal | 2 个文件<br/>`terminals/terminal-credential-security.service.ts`<br/>`terminals/terminals-admin.service.ts` |
| **TerminalCapability** | 9 | Terminal | 2 个文件<br/>`console-screen/console-screen.twin.ts`<br/>`terminals/terminal-capabilities.service.ts` |
| **TerminalCredential** | 9 | Terminal | 2 个文件<br/>`terminals/terminal-credential-security.service.ts`<br/>`terminals/terminals-admin.service.ts` |
| **TerminalHeartbeat** | 16 | Terminal | 7 个文件<br/>`admin-ops/derived-alerts.ts`<br/>`console-screen/console-screen.twin.ts`<br/>`orgs/partner-stats.service.ts`<br/>… |
| **TerminalReleaseObservation** | 10 | AgentReleaseTarget | 1 个文件<br/>`terminals/release-observation.service.ts` |
| **TerminalScanDeletionAudit** | 13 | Terminal | 1 个文件<br/>`terminals/terminal-scan-deletion-audit.service.ts` |
| **TerminalScreensaverConfig** | 9 | AdPlaylist | 2 个文件<br/>`content/content.service.ts`<br/>`device-fleet/device-fleet.service.ts` |
| **TerminalSmartCampusConfig** | 7 | — | 3 个文件<br/>`device-fleet/device-fleet.service.ts`<br/>`smart-campus/smart-campus.service.ts`<br/>`terminals/terminals-agent.service.ts` |
| **TerminalToolboxConfig** | 7 | — | 3 个文件<br/>`device-fleet/device-fleet.service.ts`<br/>`terminals/terminal-toolbox.service.ts`<br/>`terminals/toolbox-governance.service.ts` |
| **ToolboxAllowedHost** | 13 | — | 1 个文件<br/>`terminals/toolbox-governance.service.ts` |
| **ToolboxApp** | 12 | ToolboxAppVersion | 1 个文件<br/>`terminals/toolbox-governance.service.ts` |
| **ToolboxAppVersion** | 14 | ToolboxApp | 1 个文件<br/>`terminals/toolbox-governance.service.ts` |
| **ToolboxLaunchEvent** | 10 | — | 1 个文件<br/>`terminals/terminal-toolbox.service.ts` |
| **User** | 28 | AuditLog、BenefitActivity、FeedbackReply、FileObject、Organization、ReviewDecision | 23 个文件<br/>`admin-internal-accounts/admin-internal-accounts.service.ts`<br/>`admin-internal-accounts/admin-step-up.ts`<br/>`admin-internal-accounts/backup-admin-create.service.ts`<br/>… |
| **UserAiConsent** | 8 | EndUser | 5 个文件<br/>`ai-access/ai-access.service.ts`<br/>`member-privacy/member-closure-retention.ts`<br/>`member-privacy/member-data-export.mapper.ts`<br/>… |
| **UserDataRequest** | 22 | EndUser | 10 个文件<br/>`admin-users/admin-user-closure-read.ts`<br/>`member-privacy/member-closure-requests.ts`<br/>`member-privacy/member-closure-retention.ts`<br/>… |
| **UserNotification** | 10 | — | 1 个文件<br/>`member-privacy/member-closure.service.ts` |

## 没有任何代码读写的模型（8）

> 注意：这里的判定只看 \`this.prisma.<model>.<op>\` 形式的调用。
> 通过关系字段级联读写、raw SQL 或迁移脚本访问的模型不会被计入，**不能据此删表**。

- `FairCompanyBooth`
- `FairCompanyPosition`
- `FairVenueHallCompany`
- `HelpItem`
- `KioskActivity`
- `PrintMaterialPack`
- `ReviewDecision`
- `ScreensaverContent`
