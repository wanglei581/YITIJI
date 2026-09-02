<!-- 本文件由 scripts/generate-project-graph.mjs 自动生成，请勿手改。 -->
<!-- 手改会在下次 `node scripts/generate-project-graph.mjs` 时被覆盖。 -->
# API 端点图谱

`472` 个端点，全局前缀 `/api/v1`（`services/api/src/main.ts` 的 `setGlobalPrefix`）。

端点来自 `@Controller` / `@Get` / `@Post` 等装饰器的**剥注释后**解析。
本仓库多数 controller 顶部有一整块历史路由清单注释；那些注释不参与本表，
所以**本表和注释不一致时，以本表为准**（本表反映装饰器，注释可能已过期）。

模型列 = 该端点调用的 service 在受限闭包内触达的 Prisma 模型（见 README 的边界说明）。


## `services/api/src/activities/activities.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/activities` | ActivitiesController.findAll | — | — | — |
| GET | `/api/v1/kiosk/activities/:id` | ActivitiesController.findOne | — | — | — |

## `services/api/src/activity/activity.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/activity/browse` | ActivityController.browse | — | ActivityService | BrowseLog<br/>CompanyProfile<br/>ExternalJumpLog<br/>FairCompany<br/>Job<br/>JobFair<br/>PolicyPost |
| POST | `/api/v1/activity/external-jump` | ActivityController.externalJump | — | ActivityService | BrowseLog<br/>CompanyProfile<br/>ExternalJumpLog<br/>FairCompany<br/>Job<br/>JobFair<br/>PolicyPost |

## `services/api/src/activity/me-activity.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/browse-logs` | MeActivityController.browseLogs | — | ActivityService | BrowseLog<br/>CompanyProfile<br/>ExternalJumpLog<br/>FairCompany<br/>Job<br/>JobFair<br/>PolicyPost |
| DELETE | `/api/v1/me/browse-logs/:id` | MeActivityController.deleteBrowseLog | — | ActivityService<br/>AuditService | AuditLog<br/>BrowseLog<br/>CompanyProfile<br/>ExternalJumpLog<br/>FairCompany<br/>Job<br/>JobFair<br/>PolicyPost |
| GET | `/api/v1/me/external-jump-logs` | MeActivityController.jumpLogs | — | ActivityService | BrowseLog<br/>CompanyProfile<br/>ExternalJumpLog<br/>FairCompany<br/>Job<br/>JobFair<br/>PolicyPost |
| DELETE | `/api/v1/me/external-jump-logs/:id` | MeActivityController.deleteJumpLog | — | ActivityService<br/>AuditService | AuditLog<br/>BrowseLog<br/>CompanyProfile<br/>ExternalJumpLog<br/>FairCompany<br/>Job<br/>JobFair<br/>PolicyPost |

## `services/api/src/admin-ops/admin-ops.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/alerts` | AdminOpsController.listAlerts | admin | AdminOpsService | AlertDisposition<br/>PrintTask |
| POST | `/api/v1/admin/alerts/disposition` | AdminOpsController.disposeAlert | admin | AdminAlertActionsService | — |
| GET | `/api/v1/admin/print-tasks` | AdminOpsController.listPrintTasks | admin | AdminOpsService | AlertDisposition<br/>PrintTask |

## `services/api/src/admin-orders-readonly/admin-orders-readonly.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/orders` | AdminOrdersReadonlyController.list | admin | AdminOrdersReadonlyService | EndUser<br/>Order<br/>PrintTaskStatusLog<br/>Terminal |
| GET | `/api/v1/admin/orders/:id` | AdminOrdersReadonlyController.getById | admin | AdminOrdersReadonlyService | EndUser<br/>Order<br/>PrintTaskStatusLog<br/>Terminal |

## `services/api/src/admin-print-scan/admin-print-scan.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/print-scan/tasks` | AdminPrintScanController.listTasks | admin | AdminPrintScanService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal |
| GET | `/api/v1/admin/print-scan/tasks/:type/:taskId` | AdminPrintScanController.getTaskDetail | admin | AdminPrintScanService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal |
| POST | `/api/v1/admin/print-scan/tasks/:type/:taskId/actions` | AdminPrintScanController.applyAction | admin | AdminPrintScanService<br/>AuditService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal |
| POST | `/api/v1/admin/print-scan/tasks/print/:taskId/close-unpaid` | AdminPrintScanController.closeUnpaidPrintTask | admin | AdminPrintScanService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal |

## `services/api/src/admin-users/admin-users.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/users` | AdminUsersController.list | admin | AdminUsersService | AiResumeResult<br/>AuditLog<br/>BrowseLog<br/>EndUser<br/>ExternalJumpLog<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/admin/users/:endUserId` | AdminUsersController.getDetail | admin | AdminUsersService | AiResumeResult<br/>AuditLog<br/>BrowseLog<br/>EndUser<br/>ExternalJumpLog<br/>FileObject<br/>PrintTask |

## `services/api/src/advisor/advisor.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/advisor/availability` | CreateAdvisorSessionDto.availability | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| POST | `/api/v1/advisor/sessions` | CreateAdvisorSessionDto.create | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| GET | `/api/v1/advisor/sessions/:sessionId` | CreateAdvisorSessionDto.get | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| POST | `/api/v1/advisor/sessions/:sessionId/artifacts/:artifactId/print` | CreateAdvisorSessionDto.print | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| POST | `/api/v1/advisor/sessions/:sessionId/ask` | CreateAdvisorSessionDto.ask | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| POST | `/api/v1/advisor/sessions/:sessionId/pins` | CreateAdvisorSessionDto.pin | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| DELETE | `/api/v1/advisor/sessions/:sessionId/pins/:pinId` | CreateAdvisorSessionDto.unpin | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| POST | `/api/v1/advisor/sessions/:sessionId/run` | CreateAdvisorSessionDto.run | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| PATCH | `/api/v1/advisor/sessions/:sessionId/skill` | CreateAdvisorSessionDto.switchSkill | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |
| POST | `/api/v1/advisor/sessions/:sessionId/slots` | CreateAdvisorSessionDto.fillSlot | — | AdvisorService | AdvisorArtifact<br/>AdvisorPin<br/>AdvisorSession<br/>AiServiceLog<br/>AuditLog |

## `services/api/src/ai/ai.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/ai/logs` | AiController.getAiLogs | admin | AiLogService | AiServiceLog |
| GET | `/api/v1/admin/ai/usage` | AiController.getAiUsage | admin | AiLogService<br/>AiService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/assistant/chat` | AiController.chatWithAssistant | — | AiService<br/>AuditService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/resume/generate` | AiController.submitResumeGenerate | — | AiService<br/>AuditService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/resume/generate/:taskId` | AiController.getResumeGenerate | — | AiService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/resume/generate/export` | AiController.exportGeneratedResume | — | AiService<br/>AuditService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/resume/parse` | AiController.submitResumeParse | — | AiService<br/>AuditService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/resume/records/:taskId` | AiController.getResumeRecord | — | AiService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/resume/records/:taskId/layout-adjust` | AiController.adjustResumeLayout | — | AiService<br/>AuditService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/resume/records/:taskId/optimize` | AiController.getResumeOptimize | — | AiService<br/>AuditService<br/>BenefitRedemptionService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>BenefitGrant<br/>FairMaterialPrintBridge<br/>FileObject<br/>Order<br/>PrintTask<br/>RedemptionRecord |
| POST | `/api/v1/resume/voice/transcribe` | AiController.transcribeResumeVoice | — | AiLogService<br/>AsrService | AiServiceLog |

## `services/api/src/ai/career-plan.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/resume/career-plan/:taskId` | CareerPlanController.latest | — | CareerPlanService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewSession<br/>PrintTask |
| POST | `/api/v1/resume/career-plan/:taskId` | CareerPlanController.generate | — | CareerPlanService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewSession<br/>PrintTask |
| POST | `/api/v1/resume/career-plan/:taskId/print` | CareerPlanController.print | — | CareerPlanService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewSession<br/>PrintTask |

## `services/api/src/ai/fair-visit-plan.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/job-fairs/:fairId/visit-plan/:taskId` | FairVisitPlanController.latest | — | FairVisitPlanService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>ExternalJumpLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>JobFair<br/>PrintTask |
| POST | `/api/v1/job-fairs/:fairId/visit-plan/:taskId` | FairVisitPlanController.generate | — | FairVisitPlanService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>ExternalJumpLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>JobFair<br/>PrintTask |
| POST | `/api/v1/job-fairs/:fairId/visit-plan/:taskId/print` | FairVisitPlanController.print | — | FairVisitPlanService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>ExternalJumpLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>JobFair<br/>PrintTask |

## `services/api/src/ai/job-fit.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/resume/job-fit` | JobFitRequestDto.analyze | — | GovernedJobFitService | AiResumeResult<br/>AiServiceLog<br/>ContractReviewTask<br/>Job<br/>JobAiRecommendation<br/>JobAiSession<br/>UserAiConsent |
| GET | `/api/v1/resume/job-fit/:taskId` | JobFitRequestDto.latest | — | JobFitService | AiResumeResult<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>Job<br/>PrintTask |
| POST | `/api/v1/resume/job-fit/:taskId/print` | JobFitRequestDto.print | — | JobFitService | AiResumeResult<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>Job<br/>PrintTask |
| POST | `/api/v1/resume/job-fit/consent` | JobFitRequestDto.grantConsent | — | JobFitService | AiResumeResult<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>Job<br/>PrintTask |
| DELETE | `/api/v1/resume/job-fit/consent/:taskId` | JobFitRequestDto.revokeConsent | — | JobFitService | AiResumeResult<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>Job<br/>PrintTask |
| GET | `/api/v1/resume/job-fit/consent/:taskId` | JobFitRequestDto.consentStatus | — | JobFitService | AiResumeResult<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>Job<br/>PrintTask |

## `services/api/src/ai/llm/ai-config.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/ai-config` | AiConfigController.get | admin | LlmConfigService | — |
| GET | `/api/v1/admin/ai-config` | AiConfigController.getAll | admin | LlmConfigService | — |
| PUT | `/api/v1/admin/ai-config` | AiConfigController.update | admin | LlmConfigService | — |
| GET | `/api/v1/admin/ai-config/:featureKey` | AiConfigController.getOne | admin | LlmConfigService | — |
| PUT | `/api/v1/admin/ai-config/:featureKey` | AiConfigController.updateOne | admin | LlmConfigService | — |
| POST | `/api/v1/admin/ai-config/:featureKey/test` | AiConfigController.testOne | admin | LlmChatService<br/>LlmConfigService | AiServiceLog |
| POST | `/api/v1/admin/ai-config/test` | AiConfigController.test | admin | LlmChatService<br/>LlmConfigService | AiServiceLog |

## `services/api/src/ai/self-assessment.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/resume/self-assessment` | SelfAssessmentController.submit | — | — | — |
| DELETE | `/api/v1/resume/self-assessment/:taskId` | SelfAssessmentController.withdraw | — | SelfAssessmentService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/resume/self-assessment/:taskId` | SelfAssessmentController.latest | — | SelfAssessmentService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/resume/self-assessment/:taskId/append` | SelfAssessmentController.appendToResume | — | — | — |
| POST | `/api/v1/resume/self-assessment/:taskId/print` | SelfAssessmentController.print | — | SelfAssessmentService | AiResumeResult<br/>AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |

## `services/api/src/audit/audit.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/audit-logs` | AuditController.list | admin | AuditService | AuditLog |

## `services/api/src/auth/auth.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/admin/phone/initial-bind/cancel` | AuthController.cancelAdminInitialPhoneBind | admin | — | — |
| POST | `/api/v1/auth/admin/phone/initial-bind/start` | AuthController.startAdminInitialPhoneBind | admin | — | — |
| POST | `/api/v1/auth/admin/phone/initial-bind/verify` | AuthController.verifyAdminInitialPhoneBind | admin | — | — |
| POST | `/api/v1/auth/admin/phone/transfer/cancel` | AuthController.cancelAdminPhoneTransfer | admin | — | — |
| POST | `/api/v1/auth/admin/phone/transfer/start` | AuthController.startAdminPhoneTransfer | admin | AdminPhoneTransferService | AuditLog<br/>User |
| POST | `/api/v1/auth/admin/phone/transfer/verify` | AuthController.verifyAdminPhoneTransfer | admin | — | — |
| POST | `/api/v1/auth/login` | AuthController.login | — | AuthService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/auth/login/sms` | AuthController.smsLogin | — | AuthService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/auth/logout` | AuthController.logout | — | — | — |
| GET | `/api/v1/auth/me` | AuthController.me | — | — | — |
| POST | `/api/v1/auth/password/change` | AuthController.changePassword | admin/partner | — | — |
| POST | `/api/v1/auth/password/first-admin-change` | AuthController.completeFirstAdminPasswordChange | — | — | — |
| POST | `/api/v1/auth/password/reset/complete` | AuthController.completePasswordReset | — | — | — |
| POST | `/api/v1/auth/password/reset/start` | AuthController.startPasswordReset | — | — | — |
| POST | `/api/v1/auth/password/reset/verify` | AuthController.verifyPasswordReset | — | — | — |
| POST | `/api/v1/auth/phone/code` | AuthController.sendOwnPhoneCode | — | — | — |
| POST | `/api/v1/auth/phone/initial-bind/start` | AuthController.startInitialPhoneBind | admin/partner | — | — |
| POST | `/api/v1/auth/phone/initial-bind/verify` | AuthController.verifyInitialPhoneBind | admin/partner | — | — |
| POST | `/api/v1/auth/phone/verify` | AuthController.verifyOwnPhone | — | — | — |
| POST | `/api/v1/auth/sms-code` | AuthController.sendSmsCode | — | — | — |

## `services/api/src/benefit-activities/admin-benefit-activities.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/benefit-activities` | AdminBenefitActivitiesController.list | admin | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| POST | `/api/v1/admin/benefit-activities` | AdminBenefitActivitiesController.create | admin | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| PATCH | `/api/v1/admin/benefit-activities/:id` | AdminBenefitActivitiesController.update | admin | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| GET | `/api/v1/admin/benefit-activities/:id/claims` | AdminBenefitActivitiesController.claims | admin | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| PATCH | `/api/v1/admin/benefit-activities/:id/end` | AdminBenefitActivitiesController.end | admin | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| PATCH | `/api/v1/admin/benefit-activities/:id/publish` | AdminBenefitActivitiesController.publish | admin | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |

## `services/api/src/benefit-activities/benefit-activities.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/activities` | BenefitActivitiesController.list | — | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| GET | `/api/v1/activities/:id` | BenefitActivitiesController.detail | — | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |
| POST | `/api/v1/activities/:id/claim` | BenefitActivitiesController.claim | — | BenefitActivitiesService | AuditLog<br/>BenefitActivity<br/>BenefitClaim<br/>BenefitGrant<br/>EndUser |

## `services/api/src/benefit-redemption/order-redeem.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/orders/:id/redeem` | OrderRedeemController.redeem | — | BenefitRedemptionService | AuditLog<br/>BenefitGrant<br/>Order<br/>RedemptionRecord |

## `services/api/src/bulk-publish/bulk-publish.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/admin/bulk-publish/execute` | BulkPublishController.execute | admin | BulkPublishService | Job<br/>JobFair<br/>Organization<br/>PolicyPost |
| POST | `/api/v1/admin/bulk-publish/preview` | BulkPublishController.preview | admin | BulkPublishService | Job<br/>JobFair<br/>Organization<br/>PolicyPost |

## `services/api/src/common/health.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/health` | HealthController.health | — | — | — |
| GET | `/api/v1/health/ready` | HealthController.ready | — | — | — |

## `services/api/src/companies/companies.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/companies` | CompaniesController.adminList | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| POST | `/api/v1/admin/companies` | CompaniesController.adminCreate | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/admin/companies/:id` | CompaniesController.adminGet | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| PATCH | `/api/v1/admin/companies/:id` | CompaniesController.adminUpdate | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| POST | `/api/v1/admin/companies/:id/jobs` | CompaniesController.adminLinkJobs | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| DELETE | `/api/v1/admin/companies/:id/jobs/:jobId` | CompaniesController.adminUnlinkJob | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/admin/companies/:id/linkable-jobs` | CompaniesController.adminLinkableJobs | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| PATCH | `/api/v1/admin/companies/:id/publish` | CompaniesController.adminPublish | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| PATCH | `/api/v1/admin/companies/:id/review` | CompaniesController.adminReview | admin | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/companies` | CompaniesController.list | — | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/companies/:id` | CompaniesController.detail | — | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/companies/:id/jobs` | CompaniesController.companyJobs | — | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/companies/filters` | CompaniesController.filters | — | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/companies/stats` | CompaniesController.stats | — | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| GET | `/api/v1/partner/companies` | CompaniesController.partnerList | partner | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| PATCH | `/api/v1/partner/companies/:id` | CompaniesController.partnerUpdate | partner | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| PATCH | `/api/v1/partner/companies/:id/publish` | CompaniesController.partnerUnpublish | partner | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |
| POST | `/api/v1/partner/companies/import` | CompaniesController.partnerImport | partner | CompaniesService | AuditLog<br/>CompanyProfile<br/>Job<br/>Organization |

## `services/api/src/content/ai-poster.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/admin/ai-posters/generations` | AiPosterController.generate | admin | AiPosterService | — |
| GET | `/api/v1/admin/ai-posters/generations/:id` | AiPosterController.get | admin | AiPosterService | — |
| POST | `/api/v1/admin/ai-posters/generations/:id/accept` | AiPosterController.accept | admin | AiPosterService | — |
| GET | `/api/v1/admin/ai-posters/status` | AiPosterController.status | admin | AiPosterService | — |

## `services/api/src/content/content.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/ad-assets/:id/content` | ContentController.serveAssetContent | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| GET | `/api/v1/admin/ad-assets` | ContentController.listAssets | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| POST | `/api/v1/admin/ad-assets` | ContentController.uploadAsset | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| DELETE | `/api/v1/admin/ad-assets/:id` | ContentController.deleteAsset | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| PATCH | `/api/v1/admin/ad-assets/:id` | ContentController.updateAsset | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| POST | `/api/v1/admin/ad-assets/external-video` | ContentController.createExternalAsset | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| GET | `/api/v1/admin/ad-playlists` | ContentController.listPlaylists | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| POST | `/api/v1/admin/ad-playlists` | ContentController.createPlaylist | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| DELETE | `/api/v1/admin/ad-playlists/:id` | ContentController.deletePlaylist | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| PUT | `/api/v1/admin/ad-playlists/:id` | ContentController.updatePlaylist | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| GET | `/api/v1/admin/screensaver/terminals` | ContentController.listScreensaverTerminals | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| GET | `/api/v1/admin/terminals/:terminalId/screensaver-config` | ContentController.getTerminalConfig | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| PUT | `/api/v1/admin/terminals/:terminalId/screensaver-config` | ContentController.saveTerminalConfig | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |
| GET | `/api/v1/terminals/:terminalId/screensaver` | ContentController.getKioskPlaylist | admin | ContentService | AdAsset<br/>AdPlaylist<br/>AdPlaylistItem<br/>Terminal<br/>TerminalScreensaverConfig |

## `services/api/src/contract-review/contract-review.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/contract-reviews` | ContractReviewController.create | — | ContractReviewLifecycleService | ContractReviewTask<br/>FileObject<br/>PrintTask |
| DELETE | `/api/v1/contract-reviews/:id` | ContractReviewController.remove | — | ContractReviewLifecycleService | ContractReviewTask<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/contract-reviews/:id` | ContractReviewController.get | — | ContractReviewLifecycleService | ContractReviewTask<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/contract-reviews/:id/confirm` | ContractReviewController.confirm | — | ContractReviewLifecycleService | ContractReviewTask<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/contract-reviews/:id/report` | ContractReviewController.report | — | ContractReviewLifecycleService | ContractReviewTask<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/contract-reviews/consent-scope` | ContractReviewController.consentScope | — | ContractReviewConsentService | ContractReviewTask<br/>UserAiConsent |
| DELETE | `/api/v1/contract-reviews/reports/:fileId` | ContractReviewController.abandonReport | — | ContractReviewLifecycleService | ContractReviewTask<br/>FileObject<br/>PrintTask |

## `services/api/src/device-fleet/device-fleet.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/device-fleet/overview` | DeviceFleetController.overview | admin | DeviceFleetService | Terminal<br/>TerminalScreensaverConfig<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig |

## `services/api/src/files/files.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/files` | FilesController.list | admin | FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/files` | FilesController.upload | — | FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| DELETE | `/api/v1/files/:id` | FilesController.remove | — | AuditService<br/>FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/files/:id/complete` | FilesController.complete | — | FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/files/:id/content` | FilesController.content | — | FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/files/:id/download-url` | FilesController.downloadUrl | — | — | — |
| GET | `/api/v1/files/:id/preview-url` | FilesController.previewUrl | — | — | — |
| PUT | `/api/v1/files/:id/raw` | FilesController.rawUpload | — | — | — |
| PATCH | `/api/v1/files/:id/retention` | FilesController.updateRetention | — | AuditService<br/>FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/files/:id/url` | FilesController.signedUrl | — | AuditService<br/>FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/files/cleanup-expired` | FilesController.cleanupExpired | admin | AuditService<br/>FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/files/kiosk-upload` | FilesController.kioskUpload | — | — | — |
| GET | `/api/v1/files/lifecycle-summary` | FilesController.lifecycleSummary | admin | FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/files/upload-intent` | FilesController.uploadIntent | — | FilesService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |

## `services/api/src/help/help.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/help` | HelpController.findAll | — | — | — |

## `services/api/src/job-ai/job-ai.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/jobs` | JobAiController.list | — | JobAiService | AiResumeResult<br/>AiServiceLog<br/>ContractReviewTask<br/>Job<br/>JobAiRecommendation<br/>JobAiSession<br/>UserAiConsent |
| DELETE | `/api/v1/jobs/:id` | JobAiController.remove | — | JobAiService | AiResumeResult<br/>AiServiceLog<br/>ContractReviewTask<br/>Job<br/>JobAiRecommendation<br/>JobAiSession<br/>UserAiConsent |
| POST | `/api/v1/jobs/:id/ai/explain` | JobAiController.explain | — | JobAiService | AiResumeResult<br/>AiServiceLog<br/>ContractReviewTask<br/>Job<br/>JobAiRecommendation<br/>JobAiSession<br/>UserAiConsent |
| POST | `/api/v1/jobs/:id/ai/match` | JobAiController.match | — | GovernedJobFitService | AiResumeResult<br/>AiServiceLog<br/>ContractReviewTask<br/>Job<br/>JobAiRecommendation<br/>JobAiSession<br/>UserAiConsent |
| POST | `/api/v1/jobs/ai/recommendations` | JobAiController.recommendations | — | JobAiService | AiResumeResult<br/>AiServiceLog<br/>ContractReviewTask<br/>Job<br/>JobAiRecommendation<br/>JobAiSession<br/>UserAiConsent |

## `services/api/src/job-materials/job-materials.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/job-materials/generate` | JobMaterialsController.generate | — | JobMaterialsService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/job-materials/summary` | JobMaterialsController.summary | — | JobMaterialsService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/job-materials/templates` | JobMaterialsController.templates | — | JobMaterialsService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |

## `services/api/src/job-sync/job-sync.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/job-sync/sources` | JobSyncController.listApiSources | admin | — | — |
| GET | `/api/v1/admin/job-sync/sources/:sourceId` | JobSyncController.getSource | admin | — | — |
| PATCH | `/api/v1/admin/job-sync/sources/:sourceId/enabled` | JobSyncController.setSourceEnabled | admin | JobSyncService | AuditLog<br/>Job<br/>JobDataQualitySnapshot<br/>JobFair<br/>JobSource<br/>SyncLog |
| GET | `/api/v1/admin/job-sync/sources/:sourceId/impact` | JobSyncController.getSourceImpact | admin | JobSyncService | AuditLog<br/>Job<br/>JobDataQualitySnapshot<br/>JobFair<br/>JobSource<br/>SyncLog |
| PUT | `/api/v1/admin/job-sync/sources/:sourceId/response-config` | JobSyncController.updateResponseConfig | admin | — | — |
| POST | `/api/v1/admin/job-sync/sources/:sourceId/trigger` | JobSyncController.triggerSync | admin | — | — |
| POST | `/api/v1/admin/job-sync/sources/:sourceId/unpublish-content` | JobSyncController.unpublishSourceContent | admin | JobSyncService | AuditLog<br/>Job<br/>JobDataQualitySnapshot<br/>JobFair<br/>JobSource<br/>SyncLog |

## `services/api/src/jobs/admin-fairs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/fairs` | AdminFairsController.listFairs | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/admin/fairs/:id` | AdminFairsController.getFairDetail | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| PATCH | `/api/v1/admin/fairs/:id` | AdminFairsController.updateFair | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| POST | `/api/v1/admin/fairs/:id/companies` | AdminFairsController.createCompany | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| DELETE | `/api/v1/admin/fairs/:id/companies/:companyId` | AdminFairsController.deleteCompany | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| PATCH | `/api/v1/admin/fairs/:id/companies/:companyId` | AdminFairsController.updateCompany | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| POST | `/api/v1/admin/fairs/:id/materials` | AdminFairsController.uploadMaterial | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| DELETE | `/api/v1/admin/fairs/:id/materials/:materialId` | AdminFairsController.deleteMaterial | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| PATCH | `/api/v1/admin/fairs/:id/materials/:materialId` | AdminFairsController.updateMaterial | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| PATCH | `/api/v1/admin/fairs/:id/materials/:materialId/publish` | AdminFairsController.publishMaterial | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/admin/fairs/:id/stats` | AdminFairsController.getStats | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| DELETE | `/api/v1/admin/fairs/:id/venue-guide` | AdminFairsController.deleteVenueGuide | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/admin/fairs/:id/venue-guide` | AdminFairsController.getVenueGuide | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| PUT | `/api/v1/admin/fairs/:id/venue-guide` | AdminFairsController.saveVenueGuide | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| POST | `/api/v1/admin/fairs/:id/zones` | AdminFairsController.createZone | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| DELETE | `/api/v1/admin/fairs/:id/zones/:zoneId` | AdminFairsController.deleteZone | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| PATCH | `/api/v1/admin/fairs/:id/zones/:zoneId` | AdminFairsController.updateZone | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/job-fairs/materials/:materialId/content` | AdminFairsController.serveMaterialContent | admin | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |

## `services/api/src/jobs/jobs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/fair-sources` | JobsController.getFairSources | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/admin/fair-sources/:id/publish` | JobsController.publishFairSource | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/admin/fair-sources/:id/review` | JobsController.reviewFairSource | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/admin/import-batches` | JobsController.getAdminImportBatches | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/admin/job-sources` | JobsController.getJobSources | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/admin/job-sources/:id/publish` | JobsController.publishJobSource | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/admin/job-sources/:id/review` | JobsController.reviewJobSource | admin | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/admin/jobs/quality-summary` | JobsController.getAdminJobQualitySummary | admin | JobQualityService | Job<br/>JobDataQualitySnapshot |
| GET | `/api/v1/job-fairs` | JobsController.getJobFairs | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/job-fairs/:id` | JobsController.getJobFairById | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/job-fairs/:id/companies` | JobsController.getFairCompanies | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/job-fairs/:id/companies/:companyId` | JobsController.getFairCompanyById | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/job-fairs/:id/companies/:companyId/print-url` | JobsController.prepareFairCompanyPrint | — | FairCompanyPrintService | FairCompany<br/>FairMaterialPrintBridge<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/job-fairs/:id/detail` | JobsController.getJobFairDetail | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/job-fairs/:id/map` | JobsController.getFairMap | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/job-fairs/:id/materials` | JobsController.getFairMaterials | — | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| POST | `/api/v1/job-fairs/:id/materials/:materialId/print-url` | JobsController.prepareFairMaterialPrint | — | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/job-fairs/:id/stats` | JobsController.getFairStats | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/job-fairs/:id/venue-guide` | JobsController.getFairVenueGuide | — | AdminFairsService | AuditLog<br/>FairCompany<br/>FairMaterial<br/>FairMaterialPrintBridge<br/>FairVenueFacility<br/>FairVenueGuide<br/>FairVenueHall<br/>FairZone<br/>FileObject<br/>JobFair<br/>PrintTask |
| GET | `/api/v1/job-fairs/:id/zones` | JobsController.getFairZones | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/jobs` | JobsController.getJobs | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/jobs/:id` | JobsController.getJobById | — | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/jobs/requirement-stats` | JobsController.getJobRequirementStats | — | JobRequirementStatsService | Job |
| GET | `/api/v1/partner/dashboard` | JobsController.getPartnerDashboard | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/partner/data-sources` | JobsController.getPartnerDataSources | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/data-sources` | JobsController.createPartnerDataSource | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/partner/data-sources/:id/toggle` | JobsController.togglePartnerDataSource | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/partner/data-sources/capabilities` | JobsController.getPartnerDataSourceCapabilities | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| DELETE | `/api/v1/partner/excel/:batchId` | JobsController.cancelExcelImport | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/excel/:batchId/confirm` | JobsController.confirmExcelImport | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/partner/excel/mapping-rule` | JobsController.getMappingRule | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/excel/parse` | JobsController.parseExcel | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/excel/preview` | JobsController.previewExcel | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/partner/excel/template` | JobsController.downloadExcelTemplate | partner | — | — |
| GET | `/api/v1/partner/fairs` | JobsController.getPartnerFairs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/partner/fairs/:id` | JobsController.updatePartnerFair | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/partner/fairs/:id/publish` | JobsController.unpublishPartnerFair | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/fairs/import` | JobsController.importFairs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/partner/jobs` | JobsController.getPartnerJobs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/partner/jobs/:id` | JobsController.updatePartnerJob | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| PATCH | `/api/v1/partner/jobs/:id/publish` | JobsController.unpublishPartnerJob | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/jobs/import` | JobsController.importJobs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| GET | `/api/v1/partner/jobs/quality-summary` | JobsController.getPartnerJobQualitySummary | partner | JobQualityService | Job<br/>JobDataQualitySnapshot |
| GET | `/api/v1/partner/sync-logs` | JobsController.getPartnerSyncLogs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |

## `services/api/src/jobs/recruitment-integration.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/partner/data-sources/integration-contract` | RecruitmentIntegrationController.getContract | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/data-sources/preflight/fairs` | RecruitmentIntegrationController.preflightFairs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |
| POST | `/api/v1/partner/data-sources/preflight/jobs` | RecruitmentIntegrationController.preflightJobs | partner | JobsService | FairCompany<br/>FairZone<br/>FieldMappingRule<br/>ImportBatch<br/>ImportRecord<br/>Job<br/>JobFair<br/>JobSource<br/>Organization<br/>PolicyPost<br/>SyncLog<br/>Terminal |

## `services/api/src/kiosk-session/kiosk-session.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/kiosk/session/extend` | KioskSessionController.extend | — | — | — |
| POST | `/api/v1/kiosk/session/heartbeat` | KioskSessionController.heartbeat | — | — | — |

## `services/api/src/legal/admin-legal-docs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/legal-doc-versions` | AdminLegalDocsController.list | admin | LegalService | LegalDocVersion |
| POST | `/api/v1/admin/legal-doc-versions` | AdminLegalDocsController.create | admin | — | — |
| PATCH | `/api/v1/admin/legal-doc-versions/:id/activate` | AdminLegalDocsController.activate | admin | LegalService | LegalDocVersion |

## `services/api/src/legal/legal.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/legal/:type` | LegalController.getActive | — | LegalService | LegalDocVersion |

## `services/api/src/materials/materials.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/materials/tasks` | MaterialsController.createTask | — | MaterialsService | DocumentProcessTask<br/>FileObject<br/>PiiFinding |
| GET | `/api/v1/materials/tasks/:id` | MaterialsController.getTask | — | MaterialsService | DocumentProcessTask<br/>FileObject<br/>PiiFinding |
| POST | `/api/v1/materials/tasks/:id/pii-findings/decisions` | MaterialsController.decidePiiFindings | — | MaterialsService | DocumentProcessTask<br/>FileObject<br/>PiiFinding |
| GET | `/api/v1/materials/tasks/:id/print-param-suggestions` | MaterialsController.getPrintParamSuggestions | — | PrintParamSuggestionService | DocumentProcessTask<br/>FileObject<br/>PiiFinding |

## `services/api/src/member-assets/member-assets.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/ai-records` | MemberAssetsController.aiRecords | — | MemberAssetsService | AiResumeResult<br/>FileObject<br/>JobAiSession |
| DELETE | `/api/v1/me/ai-records/:id` | MemberAssetsController.deleteAiRecord | — | — | — |
| GET | `/api/v1/me/documents` | MemberAssetsController.documents | — | MemberAssetsService | AiResumeResult<br/>FileObject<br/>JobAiSession |
| GET | `/api/v1/me/resumes` | MemberAssetsController.resumes | — | MemberAssetsService | AiResumeResult<br/>FileObject<br/>JobAiSession |
| DELETE | `/api/v1/me/resumes/:id` | MemberAssetsController.deleteResume | — | — | — |

## `services/api/src/member-auth/member-auth.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/member/auth/login` | MemberAuthController.login | — | MemberAuthService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/auth/logout` | MemberAuthController.logout | — | — | — |
| POST | `/api/v1/member/auth/qr/:ticketId/claim` | MemberAuthController.claimQrLogin | — | MemberQrLoginService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/auth/qr/:ticketId/confirm` | MemberAuthController.confirmQrLogin | — | MemberQrLoginService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/auth/qr/:ticketId/confirm-by-token` | MemberAuthController.confirmQrLoginByToken | — | MemberQrLoginService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| GET | `/api/v1/member/auth/qr/:ticketId/status` | MemberAuthController.qrLoginStatus | — | MemberQrLoginService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/auth/qr/create` | MemberAuthController.createQrLogin | — | MemberQrLoginService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/auth/sms-code` | MemberAuthController.sendSmsCode | — | MemberAuthService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/auth/step-up/sms-code` | MemberAuthController.sendStepUpCode | — | MemberStepUpService | AuditLog<br/>EndUser |
| POST | `/api/v1/member/auth/step-up/verify` | MemberAuthController.verifyStepUp | — | MemberStepUpService | AuditLog<br/>EndUser |
| POST | `/api/v1/member/auth/wx-login` | MemberAuthController.wxLogin | — | MemberAuthService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| GET | `/api/v1/member/me` | MemberAuthController.me | — | MemberAuthService | EndUser<br/>LegalDocVersion<br/>MemberLegalConsent |
| POST | `/api/v1/member/phone/rebind` | MemberAuthController.rebindPhone | — | MemberPhoneRebindService | AuditLog<br/>EndUser |

## `services/api/src/member-benefits/admin-member-benefits.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/member-benefits` | AdminMemberBenefitsController.list | admin | AdminMemberBenefitsService | AuditLog<br/>BenefitGrant<br/>EndUser |
| POST | `/api/v1/admin/member-benefits` | AdminMemberBenefitsController.grant | admin | AdminMemberBenefitsService | AuditLog<br/>BenefitGrant<br/>EndUser |
| PATCH | `/api/v1/admin/member-benefits/:id/revoke` | AdminMemberBenefitsController.revoke | admin | AdminMemberBenefitsService | AuditLog<br/>BenefitGrant<br/>EndUser |
| GET | `/api/v1/admin/member-benefits/users` | AdminMemberBenefitsController.searchUsers | admin | AdminMemberBenefitsService | AuditLog<br/>BenefitGrant<br/>EndUser |

## `services/api/src/member-benefits/member-benefits.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/benefits` | MemberBenefitsController.list | — | — | — |
| GET | `/api/v1/me/benefits/redemptions` | MemberBenefitsController.listRedemptions | — | — | — |

## `services/api/src/member-favorites/member-favorites.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/favorites` | MemberFavoritesController.list | — | — | — |
| POST | `/api/v1/me/favorites` | MemberFavoritesController.add | — | MemberFavoritesService | Favorite<br/>Job<br/>JobFair<br/>PolicyPost |
| DELETE | `/api/v1/me/favorites/:targetType/:targetId` | MemberFavoritesController.remove | — | — | — |

## `services/api/src/member-feedback/admin-member-feedback.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/feedback` | AdminMemberFeedbackController.list | admin | — | — |
| GET | `/api/v1/admin/feedback/:id` | AdminMemberFeedbackController.get | admin | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |
| POST | `/api/v1/admin/feedback/:id/replies` | AdminMemberFeedbackController.reply | admin | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |
| PATCH | `/api/v1/admin/feedback/:id/status` | AdminMemberFeedbackController.status | admin | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |

## `services/api/src/member-feedback/kiosk-feedback.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/kiosk/feedback` | KioskFeedbackController.submit | — | KioskFeedbackService | FeedbackTicket<br/>PrintTask<br/>ScanTask<br/>Terminal |

## `services/api/src/member-feedback/member-feedback.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/feedback` | MemberFeedbackController.list | — | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |
| POST | `/api/v1/me/feedback` | MemberFeedbackController.create | — | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |
| GET | `/api/v1/me/feedback/:id` | MemberFeedbackController.get | — | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |
| PATCH | `/api/v1/me/feedback/:id/close` | MemberFeedbackController.close | — | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |
| POST | `/api/v1/me/feedback/:id/replies` | MemberFeedbackController.reply | — | MemberFeedbackService | AuditLog<br/>BroadcastReadState<br/>FeedbackReply<br/>FeedbackTicket<br/>MemberNotification<br/>PrintTask<br/>SystemBroadcast |

## `services/api/src/member-notifications/admin-member-notifications.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/notifications/broadcasts` | AdminMemberNotificationsController.listBroadcasts | admin | — | — |
| POST | `/api/v1/admin/notifications/broadcasts` | AdminMemberNotificationsController.createBroadcast | admin | MemberNotificationsService | AuditLog<br/>BroadcastReadState<br/>MemberNotification<br/>SystemBroadcast |
| DELETE | `/api/v1/admin/notifications/broadcasts/:id` | AdminMemberNotificationsController.deleteBroadcast | admin | — | — |

## `services/api/src/member-notifications/member-notifications.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/notifications` | MemberNotificationsController.list | — | MemberNotificationsService | AuditLog<br/>BroadcastReadState<br/>MemberNotification<br/>SystemBroadcast |
| DELETE | `/api/v1/me/notifications/:kind/:id` | MemberNotificationsController.remove | — | — | — |
| PATCH | `/api/v1/me/notifications/:kind/:id/read` | MemberNotificationsController.read | — | MemberNotificationsService | AuditLog<br/>BroadcastReadState<br/>MemberNotification<br/>SystemBroadcast |
| PATCH | `/api/v1/me/notifications/read-all` | MemberNotificationsController.readAll | — | — | — |

## `services/api/src/member-print-orders/member-print-orders.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/print-orders` | MemberPrintOrdersController.list | — | — | — |
| GET | `/api/v1/me/print-orders` | MemberPrintOrdersController.list | — | MemberPrintOrdersService | Order<br/>PrintTask |
| POST | `/api/v1/me/print-orders` | MemberPrintOrdersController.create | — | MemberPrintOrderCreateService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PiiFinding<br/>Terminal<br/>TerminalCapability |
| GET | `/api/v1/me/print-orders/:orderId` | MemberPrintOrdersController.detail | — | MemberPrintOrderCreateService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PiiFinding<br/>Terminal<br/>TerminalCapability |
| POST | `/api/v1/me/print-orders/:orderId/cancel` | MemberPrintOrdersController.cancel | — | MemberPrintOrderCreateService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PiiFinding<br/>Terminal<br/>TerminalCapability |
| GET | `/api/v1/me/print-orders/cloud` | MemberPrintOrdersController.listCloud | — | MemberPrintOrderCreateService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PiiFinding<br/>Terminal<br/>TerminalCapability |

## `services/api/src/member-privacy/admin-member-privacy.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/member-privacy/data-requests` | AdminMemberPrivacyController.list | admin | MemberDataRequestService | AuditLog<br/>EndUser<br/>UserAiConsent<br/>UserDataRequest |
| POST | `/api/v1/admin/member-privacy/data-requests/:id/reject` | AdminMemberPrivacyController.reject | admin | MemberDataRequestService | AuditLog<br/>EndUser<br/>UserAiConsent<br/>UserDataRequest |
| POST | `/api/v1/admin/member-privacy/data-requests/:id/retry` | AdminMemberPrivacyController.retry | admin | MemberDataRequestService | AuditLog<br/>EndUser<br/>UserAiConsent<br/>UserDataRequest |

## `services/api/src/member-privacy/member-data-export.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/member/data-exports/:id/content` | MemberDataExportController.download | — | MemberDataExportDownloadService | AuditLog<br/>EndUser<br/>FileObject<br/>UserDataRequest |

## `services/api/src/member-privacy/member-privacy.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/me/ai-consents` | MemberPrivacyController.list | — | — | — |
| POST | `/api/v1/me/ai-consents` | MemberPrivacyController.grantConsent | — | MemberPrivacyService | ContractReviewTask<br/>UserAiConsent |
| POST | `/api/v1/me/ai-consents` | MemberPrivacyController.create | — | — | — |
| POST | `/api/v1/me/ai-consents/:id/download-authorizations` | MemberPrivacyController.authorizeDownload | — | — | — |
| POST | `/api/v1/me/ai-consents/:scope/revoke` | MemberPrivacyController.revokeConsent | — | MemberPrivacyService | ContractReviewTask<br/>UserAiConsent |
| GET | `/api/v1/me/ai-consents/status` | MemberPrivacyController.getConsentStatus | — | MemberPrivacyService | ContractReviewTask<br/>UserAiConsent |

## `services/api/src/mock-interview/mock-interview.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/mock-interviews` | CreateInterviewDto.list | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews` | CreateInterviewDto.create | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| DELETE | `/api/v1/mock-interviews/:id` | CreateInterviewDto.remove | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| GET | `/api/v1/mock-interviews/:id` | CreateInterviewDto.get | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/answer` | CreateInterviewDto.answer | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/end` | CreateInterviewDto.end | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/practice-sheet` | CreateInterviewDto.practiceSheet | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| GET | `/api/v1/mock-interviews/:id/report` | CreateInterviewDto.report | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/report/print` | CreateInterviewDto.print | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/start` | CreateInterviewDto.start | — | MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/transcribe` | CreateInterviewDto.transcribe | — | AiLogService<br/>AsrService<br/>MockInterviewService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| POST | `/api/v1/mock-interviews/:id/turns/:idx/audio` | CreateInterviewDto.questionAudio | — | AiLogService<br/>MockInterviewService<br/>TtsService | AiServiceLog<br/>AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>MockInterviewReport<br/>MockInterviewSession<br/>MockInterviewTurn<br/>PrintTask |
| GET | `/api/v1/mock-interviews/capabilities/voice` | CreateInterviewDto.voiceCapability | — | — | — |

## `services/api/src/notifications/notifications.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/notifications` | NotificationsController.findAll | — | — | — |
| PATCH | `/api/v1/kiosk/notifications/:id/read` | NotificationsController.markRead | — | — | — |

## `services/api/src/offline-agencies/admin-offline-agencies.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/offline-agencies` | AdminOfflineAgenciesController.findAll | admin | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |
| POST | `/api/v1/admin/offline-agencies` | AdminOfflineAgenciesController.create | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| DELETE | `/api/v1/admin/offline-agencies/:id` | AdminOfflineAgenciesController.remove | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| GET | `/api/v1/admin/offline-agencies/:id` | AdminOfflineAgenciesController.findOne | admin | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |
| PUT | `/api/v1/admin/offline-agencies/:id` | AdminOfflineAgenciesController.update | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| GET | `/api/v1/admin/offline-agencies/:id/jobs` | AdminOfflineAgenciesController.getJobs | admin | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |
| POST | `/api/v1/admin/offline-agencies/:id/jobs` | AdminOfflineAgenciesController.createJob | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| DELETE | `/api/v1/admin/offline-agencies/:id/jobs/:jobId` | AdminOfflineAgenciesController.deleteJob | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| PUT | `/api/v1/admin/offline-agencies/:id/jobs/:jobId` | AdminOfflineAgenciesController.updateJob | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| PATCH | `/api/v1/admin/offline-agencies/:id/publish` | AdminOfflineAgenciesController.publish | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |
| PATCH | `/api/v1/admin/offline-agencies/:id/review` | AdminOfflineAgenciesController.review | admin | AuditService<br/>OfflineAgenciesService | AuditLog<br/>OfflineAgency<br/>OfflineJob |

## `services/api/src/offline-agencies/kiosk-offline-jobs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/offline-jobs/:id` | KioskOfflineJobsController.findOne | — | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |

## `services/api/src/offline-agencies/offline-agencies.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/offline-agencies` | OfflineAgenciesController.findAll | — | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |
| GET | `/api/v1/kiosk/offline-agencies/:id` | OfflineAgenciesController.findOne | — | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |
| GET | `/api/v1/kiosk/offline-agencies/:id/jobs` | OfflineAgenciesController.findJobsByAgency | — | OfflineAgenciesService | OfflineAgency<br/>OfflineJob |

## `services/api/src/orgs/admin-orgs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/orgs` | AdminOrgsController.listOrgs | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs` | AdminOrgsController.createOrg | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| GET | `/api/v1/admin/orgs/:id` | AdminOrgsController.getOrgDetail | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| PATCH | `/api/v1/admin/orgs/:id` | AdminOrgsController.updateOrg | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs/:id/accounts` | AdminOrgsController.createAccount | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| PUT | `/api/v1/admin/orgs/:id/accounts/:accountId/email` | AdminOrgsController.bindAccountEmail | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| PATCH | `/api/v1/admin/orgs/:id/accounts/:accountId/password` | AdminOrgsController.resetAccountPassword | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| PATCH | `/api/v1/admin/orgs/:id/accounts/:accountId/status` | AdminOrgsController.setAccountStatus | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| GET | `/api/v1/admin/orgs/:id/content-trust` | AdminOrgsController.getContentTrust | admin | AdminOrgContentTrustService | AuditLog<br/>Organization |
| PATCH | `/api/v1/admin/orgs/:id/content-trust` | AdminOrgsController.setContentTrust | admin | AdminOrgContentTrustService | AuditLog<br/>Organization |
| PATCH | `/api/v1/admin/orgs/:id/status` | AdminOrgsController.setOrgStatus | admin | AdminOrgsService | AuditLog<br/>Organization<br/>User |

## `services/api/src/orgs/partner-account-action.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| DELETE | `/api/v1/admin/orgs/:orgId/accounts/:accountId` | PartnerAccountActionController.deleteAccount | admin | PartnerAccountActionService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs/:orgId/accounts/:accountId/action-challenges` | PartnerAccountActionController.createChallenge | admin | PartnerAccountActionService | AuditLog<br/>Organization<br/>User |
| DELETE | `/api/v1/admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId` | PartnerAccountActionController.cancelChallenge | admin | PartnerAccountActionService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId/verify` | PartnerAccountActionController.verifyChallenge | admin | PartnerAccountActionService | AuditLog<br/>Organization<br/>User |
| DELETE | `/api/v1/admin/orgs/:orgId/accounts/:accountId/action-tickets/current` | PartnerAccountActionController.revokeActionTicket | admin | PartnerAccountActionService | AuditLog<br/>Organization<br/>User |
| DELETE | `/api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/current` | PartnerAccountActionController.revokeRebindTicket | admin | PartnerPhoneRebindService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/resend-new` | PartnerAccountActionController.resendNewPhone | admin | PartnerPhoneRebindService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/start` | PartnerAccountActionController.startPhoneRebind | admin | PartnerPhoneRebindService | AuditLog<br/>Organization<br/>User |
| POST | `/api/v1/admin/orgs/:orgId/accounts/:accountId/phone-rebind/verify` | PartnerAccountActionController.verifyNewPhone | admin | PartnerPhoneRebindService | AuditLog<br/>Organization<br/>User |

## `services/api/src/orgs/partner-org.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/partner/profile` | UpdateOwnOrgProfileDto.getProfile | partner | AdminOrgsService | AuditLog<br/>Organization<br/>User |
| PUT | `/api/v1/partner/profile` | UpdateOwnOrgProfileDto.updateProfile | partner | AdminOrgsService | AuditLog<br/>Organization<br/>User |

## `services/api/src/orgs/partner-stats.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/partner/stats` | PartnerStatsQueryDto.getStats | partner | PartnerStatsService | CompanyProfile<br/>Job<br/>JobFair<br/>JobSource<br/>PolicyPost<br/>SyncLog |

## `services/api/src/payment/admin-billing.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/billing/price-config` | AdminBillingController.list | admin | AdminBillingService | AuditLog<br/>PriceConfig |
| PUT | `/api/v1/admin/billing/price-config/:serviceKey` | AdminBillingController.update | admin | AdminBillingService | AuditLog<br/>PriceConfig |
| GET | `/api/v1/admin/billing/reconciliation` | AdminBillingController.reconcile | admin | ReconciliationService | AuditLog<br/>Order<br/>PaymentAttempt<br/>Refund |

## `services/api/src/payment/admin-order-actions.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/admin/orders/:id/mark-paid` | AdminOrderActionsController.markPaid | admin | OrderStatusService | AuditLog<br/>Order |
| POST | `/api/v1/admin/orders/:id/refund` | AdminOrderActionsController.refund | admin | RefundService | AuditLog<br/>Order<br/>PaymentAttempt<br/>PrintTask<br/>Refund |

## `services/api/src/payment/order-quote.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/orders/quote` | OrderQuoteController.quote | — | OrderQuoteService | FileObject<br/>PriceConfig<br/>Terminal<br/>TerminalCapability |

## `services/api/src/payment/payment.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/orders/:id/code-pay` | PaymentController.createCodePayAttempt | — | OnlinePaymentService | AuditLog<br/>Order<br/>PaymentAttempt |
| POST | `/api/v1/orders/:id/pay` | PaymentController.createPayAttempt | — | OnlinePaymentService | AuditLog<br/>Order<br/>PaymentAttempt |
| GET | `/api/v1/orders/:id/pay-status` | PaymentController.getPayStatus | — | OnlinePaymentService | AuditLog<br/>Order<br/>PaymentAttempt |
| POST | `/api/v1/orders/:id/pay/reconcile` | PaymentController.reconcile | — | OnlinePaymentService | AuditLog<br/>Order<br/>PaymentAttempt |
| POST | `/api/v1/payment/callback/:channel` | PaymentController.callback | — | — | — |
| GET | `/api/v1/payment/channels` | PaymentController.getChannels | — | OnlinePaymentService | AuditLog<br/>Order<br/>PaymentAttempt |
| POST | `/api/v1/payment/sandbox/simulate` | PaymentController.simulate | — | OnlinePaymentService | AuditLog<br/>Order<br/>PaymentAttempt |
| POST | `/api/v1/payment/wechat/refund-notify` | PaymentController.wechatRefundNotify | — | RefundService | AuditLog<br/>Order<br/>PaymentAttempt<br/>PrintTask<br/>Refund |
| GET | `/api/v1/print/price-config` | PaymentController.getPrintPriceConfig | — | PricingService | PriceConfig |

## `services/api/src/policies/policies.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/policy-sources` | PoliciesController.getPolicySources | admin | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| GET | `/api/v1/admin/policy-sources/:id/eligibility-rules` | PoliciesController.getAdminEligibilityRules | admin | PolicyEligibilityService | AuditLog<br/>PolicyEligibilityRule<br/>PolicyPost |
| PATCH | `/api/v1/admin/policy-sources/:id/publish` | PoliciesController.publishPolicy | admin | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| PATCH | `/api/v1/admin/policy-sources/:id/review` | PoliciesController.reviewPolicy | admin | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| GET | `/api/v1/partner/policies` | PoliciesController.getPartnerPolicies | partner | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| POST | `/api/v1/partner/policies` | PoliciesController.createPartnerPolicy | partner | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| DELETE | `/api/v1/partner/policies/:id` | PoliciesController.deletePartnerPolicy | partner | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| PATCH | `/api/v1/partner/policies/:id` | PoliciesController.updatePartnerPolicy | partner | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| POST | `/api/v1/partner/policies/:id/eligibility-preview` | PoliciesController.previewPartnerEligibility | partner | PolicyEligibilityService | AuditLog<br/>PolicyEligibilityRule<br/>PolicyPost |
| GET | `/api/v1/partner/policies/:id/eligibility-rules` | PoliciesController.getPartnerEligibilityRules | partner | PolicyEligibilityService | AuditLog<br/>PolicyEligibilityRule<br/>PolicyPost |
| PUT | `/api/v1/partner/policies/:id/eligibility-rules` | PoliciesController.replacePartnerEligibilityRules | partner | PolicyEligibilityService | AuditLog<br/>PolicyEligibilityRule<br/>PolicyPost |
| PATCH | `/api/v1/partner/policies/:id/publish` | PoliciesController.unpublishPartnerPolicy | partner | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| GET | `/api/v1/policies` | PoliciesController.getPolicies | — | PoliciesService | AuditLog<br/>Organization<br/>PolicyPost |
| POST | `/api/v1/policies/eligibility-check` | PoliciesController.checkEligibility | — | PolicyEligibilityService | AuditLog<br/>PolicyEligibilityRule<br/>PolicyPost |
| GET | `/api/v1/policies/eligibility-questions` | PoliciesController.getEligibilityQuestions | — | PolicyEligibilityService | AuditLog<br/>PolicyEligibilityRule<br/>PolicyPost |

## `services/api/src/print-conversion/print-conversion.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/print/convert/images-to-pdf` | PrintConversionController.imagesToPdf | — | PrintConversionService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |

## `services/api/src/print-jobs/admin-print-jobs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/admin/print-jobs/:id/abandon` | AdminPrintJobsController.abandonPending | admin | AdminPrintJobsAbandonService | AuditLog<br/>Order<br/>PrintTask<br/>PrintTaskStatusLog<br/>User |
| POST | `/api/v1/admin/print-jobs/:id/verify-outcome` | AdminPrintJobsController.verifyOutcome | admin | — | — |

## `services/api/src/print-jobs/print-jobs.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/print/jobs` | PrintJobsController.create | — | PrintJobsService | AuditLog<br/>DocumentProcessTask<br/>FairMaterialPrintBridge<br/>FileObject<br/>Order<br/>PiiFinding<br/>PriceConfig<br/>PrintTask<br/>Terminal<br/>TerminalCapability |
| POST | `/api/v1/print/jobs/:orderId/release` | PrintJobsController.releasePickup | — | PickupOrderService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PiiFinding<br/>PrintTask<br/>Terminal<br/>TerminalCapability |
| GET | `/api/v1/print/jobs/:taskId` | PrintJobsController.getStatus | — | PrintJobsService | AuditLog<br/>DocumentProcessTask<br/>FairMaterialPrintBridge<br/>FileObject<br/>Order<br/>PiiFinding<br/>PriceConfig<br/>PrintTask<br/>Terminal<br/>TerminalCapability |
| POST | `/api/v1/print/jobs/claim-pickup` | PrintJobsController.claimPickup | — | PickupOrderService | AuditLog<br/>DocumentProcessTask<br/>FileObject<br/>Order<br/>PiiFinding<br/>PrintTask<br/>Terminal<br/>TerminalCapability |

## `services/api/src/print-sign/print-sign.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/print/sign/compose` | PrintSignController.compose | — | PrintSignService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask<br/>Terminal<br/>TerminalCapability |
| POST | `/api/v1/print/sign/inspect` | PrintSignController.inspect | — | PrintSignService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>PrintTask<br/>Terminal<br/>TerminalCapability |

## `services/api/src/recruitment-content/admin-recruitment-content.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/recruitment-content/agency-profiles` | AdminRecruitmentContentController.listAgencyProfiles | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/agency-profiles/:profileId` | AdminRecruitmentContentController.getAgencyProfile | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/agency-profiles/:profileId/branches/:branchId` | AdminRecruitmentContentController.getAgencyBranch | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/organizations/:organizationId/qualifications` | AdminRecruitmentContentController.listQualifications | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/organizations/:organizationId/qualifications/:qualificationId` | AdminRecruitmentContentController.getQualification | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/organizations/:organizationId/qualifications/:qualificationId/evidence-access` | AdminRecruitmentContentController.getQualificationEvidence | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/platform-directories` | AdminRecruitmentContentController.listDirectories | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |
| GET | `/api/v1/admin/recruitment-content/platform-directories/:id` | AdminRecruitmentContentController.getDirectory | admin | RecruitmentContentReadService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>OfflineAgencyBranch<br/>OfflineAgencyProfile<br/>OnlinePlatformDirectory<br/>Organization<br/>PrintTask<br/>QualificationRecord |

## `services/api/src/scan-tasks/scan-tasks.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/scan/sessions` | ScanTasksController.create | — | ScanTasksService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask<br/>ScanTask<br/>Terminal<br/>TerminalCapability |
| DELETE | `/api/v1/scan/sessions/:id` | ScanTasksController.cancel | — | ScanTasksService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask<br/>ScanTask<br/>Terminal<br/>TerminalCapability |
| GET | `/api/v1/scan/sessions/:id` | ScanTasksController.status | — | ScanTasksService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask<br/>ScanTask<br/>Terminal<br/>TerminalCapability |
| POST | `/api/v1/terminals/:terminalId/scan-sessions/deliver` | ScanTasksController.deliver | — | ScanTasksService<br/>TerminalsService | AuditLog<br/>FairMaterialPrintBridge<br/>FileObject<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCapability<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |

## `services/api/src/screensaver/screensaver.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/kiosk/screensaver-content` | ScreensaverController.findAll | — | — | — |

## `services/api/src/smart-campus/smart-campus.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/smart-campus/terminals` | SmartCampusController.listTerminals | admin | SmartCampusService | Organization<br/>Terminal<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| GET | `/api/v1/admin/terminals/:terminalId/smart-campus-config` | SmartCampusController.getConfig | admin | SmartCampusService | Organization<br/>Terminal<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| PUT | `/api/v1/admin/terminals/:terminalId/smart-campus-config` | SmartCampusController.saveConfig | admin | AuditService<br/>SmartCampusService | AuditLog<br/>Organization<br/>Terminal<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| GET | `/api/v1/partner/smart-campus/terminals` | SmartCampusController.listPartnerTerminals | partner | SmartCampusService | Organization<br/>Terminal<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| PUT | `/api/v1/partner/smart-campus/terminals/:terminalId/config` | SmartCampusController.savePartnerConfig | partner | AuditService<br/>SmartCampusService | AuditLog<br/>Organization<br/>Terminal<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| GET | `/api/v1/terminals/:terminalId/smart-campus` | SmartCampusController.getKioskConfig | admin | SmartCampusService | Organization<br/>Terminal<br/>TerminalSmartCampusConfig<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |

## `services/api/src/sync/sync.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/sync/webhook` | SyncController.webhook | — | — | — |

## `services/api/src/terminals/admin-printers.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/printers` | AdminPrintersController.list | admin | — | — |

## `services/api/src/terminals/admin-release-observation.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/release-observation-plans` | AdminReleaseObservationController.list | admin | ReleaseObservationService | ActiveReleaseObservationAssignment<br/>AgentReleaseArtifact<br/>AgentReleasePlan<br/>AgentReleaseTarget<br/>AuditLog<br/>PrintTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalReleaseObservation |
| POST | `/api/v1/admin/release-observation-plans` | AdminReleaseObservationController.create | admin | ReleaseObservationService | ActiveReleaseObservationAssignment<br/>AgentReleaseArtifact<br/>AgentReleasePlan<br/>AgentReleaseTarget<br/>AuditLog<br/>PrintTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalReleaseObservation |
| PATCH | `/api/v1/admin/release-observation-plans/:planId` | AdminReleaseObservationController.update | admin | ReleaseObservationService | ActiveReleaseObservationAssignment<br/>AgentReleaseArtifact<br/>AgentReleasePlan<br/>AgentReleaseTarget<br/>AuditLog<br/>PrintTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalReleaseObservation |

## `services/api/src/terminals/admin-terminals.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/terminals` | AdminTerminalsController.list | admin | — | — |
| POST | `/api/v1/admin/terminals` | AdminTerminalsController.createPlannedTerminal | admin | AuditService<br/>TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| POST | `/api/v1/admin/terminals/:terminalId/bind-code` | AdminTerminalsController.createBindCode | admin | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| GET | `/api/v1/admin/terminals/:terminalId/capabilities` | AdminTerminalsController.listCapabilities | admin | — | — |
| PUT | `/api/v1/admin/terminals/:terminalId/capabilities/:capabilityKey` | AdminTerminalsController.updateCapability | admin | — | — |
| POST | `/api/v1/admin/terminals/:terminalId/emergency-revoke` | AdminTerminalsController.emergencyRevoke | admin | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| PATCH | `/api/v1/admin/terminals/:terminalId/lifecycle` | AdminTerminalsController.updateLifecycle | admin | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| PATCH | `/api/v1/admin/terminals/:terminalId/org` | AdminTerminalsController.assignOrg | admin | AuditService<br/>TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| PATCH | `/api/v1/admin/terminals/:terminalId/profile` | AdminTerminalsController.updateProfile | admin | AuditService<br/>TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| GET | `/api/v1/admin/terminals/org-options` | AdminTerminalsController.orgOptions | admin | — | — |

## `services/api/src/terminals/admin-toolbox.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/v1/admin/terminals/:terminalId/toolbox-config` | AdminToolboxController.getConfig | admin | TerminalToolboxService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| PUT | `/api/v1/admin/terminals/:terminalId/toolbox-config` | AdminToolboxController.saveConfig | admin | AuditService<br/>TerminalToolboxService | AuditLog<br/>Terminal<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| GET | `/api/v1/admin/toolbox/allowed-hosts` | AdminToolboxController.listAllowedHosts | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/allowed-hosts` | AdminToolboxController.upsertAllowedHost | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/allowed-hosts/:hostId/review` | AdminToolboxController.reviewAllowedHost | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| GET | `/api/v1/admin/toolbox/apps` | AdminToolboxController.listApps | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps` | AdminToolboxController.createApp | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps/:appKey/suspend` | AdminToolboxController.suspendApp | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| GET | `/api/v1/admin/toolbox/apps/:appKey/versions` | AdminToolboxController.listVersions | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps/:appKey/versions` | AdminToolboxController.createVersion | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps/:appKey/versions/:version/approve` | AdminToolboxController.approveVersion | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps/:appKey/versions/:version/publish` | AdminToolboxController.publishVersion | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps/:appKey/versions/:version/reject` | AdminToolboxController.rejectVersion | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| POST | `/api/v1/admin/toolbox/apps/:appKey/versions/:version/submit` | AdminToolboxController.submitVersion | admin | ToolboxGovernanceService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxAllowedHost<br/>ToolboxApp<br/>ToolboxAppVersion<br/>ToolboxLaunchEvent |
| GET | `/api/v1/admin/toolbox/launch-summary` | AdminToolboxController.getLaunchSummary | admin | TerminalToolboxService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| GET | `/api/v1/admin/toolbox/terminals` | AdminToolboxController.listTerminals | admin | TerminalToolboxService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |

## `services/api/src/terminals/terminals.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/auth/terminal/exchange-bind-code` | TerminalsController.exchangeBindCode | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| POST | `/api/v1/auth/terminal/register` | TerminalsController.register | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| PATCH | `/api/v1/print-tasks/:taskId/status` | TerminalsController.patchTaskStatus | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| GET | `/api/v1/terminals/:terminalId/capabilities` | TerminalsController.getTerminalCapabilities | — | TerminalCapabilitiesService | Terminal<br/>TerminalCapability |
| GET | `/api/v1/terminals/:terminalId/config` | TerminalsController.getTerminalConfig | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| PUT | `/api/v1/terminals/:terminalId/heartbeat` | TerminalsController.heartbeat | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| GET | `/api/v1/terminals/:terminalId/printer-status` | TerminalsController.getTerminalPrinterStatus | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| PUT | `/api/v1/terminals/:terminalId/release-observation` | TerminalsController.reportReleaseObservation | — | ReleaseObservationService | ActiveReleaseObservationAssignment<br/>AgentReleaseArtifact<br/>AgentReleasePlan<br/>AgentReleaseTarget<br/>AuditLog<br/>PrintTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalReleaseObservation |
| GET | `/api/v1/terminals/:terminalId/release-observation-plan` | TerminalsController.getReleaseObservationPlan | — | ReleaseObservationService | ActiveReleaseObservationAssignment<br/>AgentReleaseArtifact<br/>AgentReleasePlan<br/>AgentReleaseTarget<br/>AuditLog<br/>PrintTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalReleaseObservation |
| POST | `/api/v1/terminals/:terminalId/scan-deletion-audits` | TerminalsController.reportScanDeletionAudit | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| POST | `/api/v1/terminals/:terminalId/tasks/claim` | TerminalsController.claimTasks | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| POST | `/api/v1/terminals/:terminalId/toolbox-events` | TerminalsController.recordToolboxLaunchEvent | — | TerminalToolboxService | Terminal<br/>TerminalToolboxConfig<br/>ToolboxLaunchEvent |
| GET | `/api/v1/terminals/public` | TerminalsController.listPublicTerminals | — | TerminalsService | AuditLog<br/>Order<br/>Organization<br/>PrintTask<br/>PrintTaskStatusLog<br/>ScanTask<br/>Terminal<br/>TerminalBindCode<br/>TerminalCredential<br/>TerminalHeartbeat<br/>TerminalSmartCampusConfig |
| GET | `/api/v1/test/sample-visible.pdf` | TerminalsController.getSampleVisiblePdf | — | — | — |
| GET | `/api/v1/test/sample.png` | TerminalsController.getSamplePng | — | — | — |

## `services/api/src/trtc/trtc.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/trtc/session` | TrtcController.startSession | — | — | — |
| POST | `/api/v1/trtc/session/stop` | TrtcController.stopSession | — | — | — |

## `services/api/src/upload-sessions/upload-sessions.controller.ts`

| 方法 | 路径 | handler | 角色 | Service | Prisma 模型 |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/v1/upload-sessions` | UploadSessionsController.create | — | UploadSessionsService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| DELETE | `/api/v1/upload-sessions/:sessionId` | UploadSessionsController.cancel | — | UploadSessionsService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| GET | `/api/v1/upload-sessions/:sessionId` | UploadSessionsController.status | — | UploadSessionsService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/upload-sessions/:sessionId/confirm` | UploadSessionsController.confirm | — | UploadSessionsService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
| POST | `/api/v1/upload-sessions/:sessionId/files` | UploadSessionsController.upload | — | UploadSessionsService | FairMaterialPrintBridge<br/>FileObject<br/>PrintTask |
