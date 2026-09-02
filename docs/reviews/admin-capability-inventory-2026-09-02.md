# 管理员后台能力盘点（2026-09-02）

> 只读盘点，不改任何实现文件。数据源：`docs/graph/graph.json`（`api.endpoints` + `apps.admin.routes`）
> 与 `apps/admin/src/**`、`services/api/src/**` 的实际源码。

## 0. 方法与口径（先读这一节）

### 0.1 为什么不用关键词匹配

本次盘点明确**不用正则从业务域名去猜端点是否存在**。Admin 端大量使用通用命名空间
（`/admin/ai/logs`、`/admin/ai/usage`、`/admin/print-scan/tasks`），路径里根本不含业务域词，
按业务词去 grep 会连续误判成「没有这个能力」。

本文的做法是**先穷举、后归类**：

1. 从 `docs/graph/graph.json` 取出 `api.endpoints` 中 `path` 以 `/api/v1/admin/` 开头的**全部 187 条**，
   排序后落盘，逐条编号（第 1 章表格 187 行，一条不少）。
2. 从同文件取 `apps.admin.routes` 的 **37 条**路由（无 `/*` 通配路由）。
3. 端点 → 页面的对应关系**不采用图谱自带的 `routes[].endpoints`**。理由见
   [docs/graph/README.md](../graph/README.md) 边界第 2 条：那是 import 可达性（上界），
   实测会把 `/` 工作台算成调用 47 个端点（含全部 `/auth/*`），无法用于判断「运营够不够得着」。
   本文改用两步实测：
   - 扫描 `apps/admin/src/**` 全部 `.ts/.tsx`，抽取 `/admin/...` 路径字面量（含
     `` `${var}` `` 模板、`${BASE}` 常量与 `'a/'+id+'/b'` 字符串拼接三种写法），归一化为
     `:param` 形式后与 187 条端点精确比对；
   - 再解析每个 `apps/admin/src/routes/**` 文件对 `services/api/*` 的 import，得到
     「API 模块 → 页面」映射，把命中该模块的端点落到具体页面。

### 0.2 「不存在」的判定范围

本文出现「无页面 / 前端零引用」时，穷举范围是：`apps/admin/src` 目录下**全部** 138 个
`.ts/.tsx` 源文件（`graph.json` 记 `sourceFileCount: 138`）。凡结论为「不存在」的，
都另外在 `apps/`、`services/`、`packages/`、`scripts/` 四个目录做过全仓 grep 复核，
并在对应条目里写明复核结果（例如某端点只有 verify 脚本引用）。

**没有任何一条结论是"我没搜到所以不存在"。**

| 1 | `GET` | `/admin/ad-assets` | 宣传屏素材 AdAsset | 看得见 | /screensaver |
| 2 | `POST` | `/admin/ad-assets` | 宣传屏素材 AdAsset | 改得了 | /screensaver |
| 3 | `DELETE` | `/admin/ad-assets/:id` | 宣传屏素材 AdAsset | 停得掉 | /screensaver |
| 4 | `PATCH` | `/admin/ad-assets/:id` | 宣传屏素材 AdAsset | 改得了 + 停得掉 | /screensaver |
| 5 | `POST` | `/admin/ad-assets/external-video` | 宣传屏素材 AdAsset | 改得了 | /screensaver |
| 6 | `GET` | `/admin/ad-playlists` | 宣传屏播放方案 AdPlaylist | 看得见 | /screensaver |
| 7 | `POST` | `/admin/ad-playlists` | 宣传屏播放方案 AdPlaylist | 改得了 | /screensaver |
| 8 | `DELETE` | `/admin/ad-playlists/:id` | 宣传屏播放方案 AdPlaylist | 停得掉 | /screensaver |
| 9 | `PUT` | `/admin/ad-playlists/:id` | 宣传屏播放方案 AdPlaylist | 改得了 + 停得掉 | /screensaver |
| 10 | `GET` | `/admin/ai-config` | AI 模型配置 LlmConfig（旧单例路径） | 看得见 | —（无页面） |
| 11 | `PUT` | `/admin/ai-config` | AI 模型配置 LlmConfig（旧单例路径） | 改得了 + 停得掉 | —（无页面） |
| 12 | `POST` | `/admin/ai-config/test` | AI 模型配置 LlmConfig（旧单例路径） | 改得了 | —（无页面） |
| 13 | `GET` | `/admin/ai-configs` | AI 模型配置 LlmConfig | 看得见 | /ai-config |
| 14 | `GET` | `/admin/ai-configs/:featureKey` | AI 模型配置 LlmConfig | 看得见 | /ai-config |
| 15 | `PUT` | `/admin/ai-configs/:featureKey` | AI 模型配置 LlmConfig | 改得了 + 停得掉 | /ai-config |
| 16 | `POST` | `/admin/ai-configs/:featureKey/test` | AI 模型配置 LlmConfig | 改得了 | /ai-config |
| 17 | `POST` | `/admin/ai-posters/generations` | AI 海报生成 AiPosterGeneration | 改得了 | —（无页面） |
| 18 | `GET` | `/admin/ai-posters/generations/:id` | AI 海报生成 AiPosterGeneration | 看得见 | —（无页面） |
| 19 | `POST` | `/admin/ai-posters/generations/:id/accept` | AI 海报生成 AiPosterGeneration | 改得了 | —（无页面） |
| 20 | `GET` | `/admin/ai-posters/status` | AI 海报生成 AiPosterGeneration | 看得见 | /screensaver |
| 21 | `GET` | `/admin/ai/logs` | AI 调用日志与用量 AiServiceLog | 看得见 | /ai-services |
| 22 | `GET` | `/admin/ai/usage` | AI 调用日志与用量 AiServiceLog | 看得见 | /ai-services |
| 23 | `GET` | `/admin/alerts` | 运营告警 | 看得见 | /alerts + /(工作台) |
| 24 | `GET` | `/admin/audit-logs` | 审计日志 AuditLog | 查得到 | /audit + /account-settings + /(工作台) / /audit |
| 25 | `GET` | `/admin/benefit-activities` | 权益活动 BenefitActivity | 看得见 | /benefit-activities |
| 26 | `POST` | `/admin/benefit-activities` | 权益活动 BenefitActivity | 改得了 | /benefit-activities |
| 27 | `PATCH` | `/admin/benefit-activities/:id` | 权益活动 BenefitActivity | 改得了 | /benefit-activities |
| 28 | `GET` | `/admin/benefit-activities/:id/claims` | 权益活动 BenefitActivity | 看得见 | /benefit-activities |
| 29 | `PATCH` | `/admin/benefit-activities/:id/end` | 权益活动 BenefitActivity | 停得掉 | /benefit-activities |
| 30 | `PATCH` | `/admin/benefit-activities/:id/publish` | 权益活动 BenefitActivity | 改得了 | /benefit-activities |
| 31 | `GET` | `/admin/billing/price-config` | 计费价目与对账 ServicePriceConfig | 看得见 | /billing |
| 32 | `PUT` | `/admin/billing/price-config/:serviceKey` | 计费价目与对账 ServicePriceConfig | 改得了 + 停得掉 | /billing |
| 33 | `GET` | `/admin/billing/reconciliation` | 计费价目与对账 ServicePriceConfig | 查得到 | /billing |
| 34 | `POST` | `/admin/bulk-publish/execute` | 批量发布（岗位/招聘会/政策） | 改得了 + 停得掉 | /job-sources + /fair-sources + /policy-sources（BulkPublishButton） |
| 35 | `POST` | `/admin/bulk-publish/preview` | 批量发布（岗位/招聘会/政策） | 改得了 | /job-sources + /fair-sources + /policy-sources（BulkPublishButton） |
| 36 | `GET` | `/admin/companies` | 企业展示 CompanyProfile | 看得见 | /companies |
| 37 | `POST` | `/admin/companies` | 企业展示 CompanyProfile | 改得了 | /companies |
| 38 | `GET` | `/admin/companies/:id` | 企业展示 CompanyProfile | 看得见 | /companies |
| 39 | `PATCH` | `/admin/companies/:id` | 企业展示 CompanyProfile | 改得了 | /companies |
| 40 | `POST` | `/admin/companies/:id/jobs` | 企业展示 CompanyProfile | 改得了 | /companies |
| 41 | `DELETE` | `/admin/companies/:id/jobs/:jobId` | 企业展示 CompanyProfile | 停得掉 | /companies |
| 42 | `GET` | `/admin/companies/:id/linkable-jobs` | 企业展示 CompanyProfile | 看得见 | /companies |
| 43 | `PATCH` | `/admin/companies/:id/publish` | 企业展示 CompanyProfile | 改得了 + 停得掉 | /companies |
| 44 | `PATCH` | `/admin/companies/:id/review` | 企业展示 CompanyProfile | 改得了 + 停得掉 | /companies |
| 45 | `GET` | `/admin/device-fleet/overview` | 设备集群总览 | 看得见 | /devices（设备总览 tab） |
| 46 | `GET` | `/admin/fair-sources` | 招聘会信息源（外部数据） | 看得见 | /fair-sources + /(工作台) |
| 47 | `PATCH` | `/admin/fair-sources/:id/publish` | 招聘会信息源（外部数据） | 改得了 + 停得掉 | /fair-sources |
| 48 | `PATCH` | `/admin/fair-sources/:id/review` | 招聘会信息源（外部数据） | 改得了 + 停得掉 | /fair-sources |
| 49 | `GET` | `/admin/fairs` | 招聘会内容运营 JobFair | 看得见 | /fairs |
| 50 | `GET` | `/admin/fairs/:id` | 招聘会内容运营 JobFair | 看得见 | /fairs |
| 51 | `PATCH` | `/admin/fairs/:id` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 52 | `POST` | `/admin/fairs/:id/companies` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 53 | `DELETE` | `/admin/fairs/:id/companies/:companyId` | 招聘会内容运营 JobFair | 停得掉 | /fairs |
| 54 | `PATCH` | `/admin/fairs/:id/companies/:companyId` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 55 | `POST` | `/admin/fairs/:id/materials` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 56 | `DELETE` | `/admin/fairs/:id/materials/:materialId` | 招聘会内容运营 JobFair | 停得掉 | /fairs |
| 57 | `PATCH` | `/admin/fairs/:id/materials/:materialId` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 58 | `PATCH` | `/admin/fairs/:id/materials/:materialId/publish` | 招聘会内容运营 JobFair | 改得了 + 停得掉 | /fairs |
| 59 | `GET` | `/admin/fairs/:id/stats` | 招聘会内容运营 JobFair | 看得见 | /fairs |
| 60 | `DELETE` | `/admin/fairs/:id/venue-guide` | 招聘会内容运营 JobFair | 停得掉 | /fairs |
| 61 | `GET` | `/admin/fairs/:id/venue-guide` | 招聘会内容运营 JobFair | 看得见 | /fairs |
| 62 | `PUT` | `/admin/fairs/:id/venue-guide` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 63 | `POST` | `/admin/fairs/:id/zones` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 64 | `DELETE` | `/admin/fairs/:id/zones/:zoneId` | 招聘会内容运营 JobFair | 停得掉 | /fairs |
| 65 | `PATCH` | `/admin/fairs/:id/zones/:zoneId` | 招聘会内容运营 JobFair | 改得了 | /fairs |
| 66 | `GET` | `/admin/feedback` | 意见反馈工单 FeedbackTicket | 看得见 | /member-feedback |
| 67 | `GET` | `/admin/feedback/:id` | 意见反馈工单 FeedbackTicket | 看得见 | /member-feedback |
| 68 | `POST` | `/admin/feedback/:id/replies` | 意见反馈工单 FeedbackTicket | 改得了 | /member-feedback |
| 69 | `PATCH` | `/admin/feedback/:id/status` | 意见反馈工单 FeedbackTicket | 改得了 + 停得掉 | /member-feedback |
| 70 | `GET` | `/admin/import-batches` | Excel 导入批次 ImportBatch | 看得见 | /import-batches |
| 71 | `GET` | `/admin/job-materials/summary` | 求职材料模板 | 看得见 | /job-materials |
| 72 | `GET` | `/admin/job-sources` | 岗位信息源（外部数据） | 看得见 | /job-sources + /(工作台) |
| 73 | `PATCH` | `/admin/job-sources/:id/publish` | 岗位信息源（外部数据） | 改得了 + 停得掉 | /job-sources |
| 74 | `PATCH` | `/admin/job-sources/:id/review` | 岗位信息源（外部数据） | 改得了 + 停得掉 | /job-sources |
| 75 | `GET` | `/admin/job-sync/sources` | 数据接入通道 DataSourceConfig | 看得见 | /sync-sources（页面内直连） |
| 76 | `GET` | `/admin/job-sync/sources/:sourceId` | 数据接入通道 DataSourceConfig | 看得见 | /sync-sources（页面内直连） |
| 77 | `PATCH` | `/admin/job-sync/sources/:sourceId/enabled` | 数据接入通道 DataSourceConfig | 改得了 + 停得掉 | /sync-sources（页面内直连） |
| 78 | `GET` | `/admin/job-sync/sources/:sourceId/impact` | 数据接入通道 DataSourceConfig | 查得到 | /sync-sources（页面内直连） |
| 79 | `PUT` | `/admin/job-sync/sources/:sourceId/response-config` | 数据接入通道 DataSourceConfig | 改得了 | /sync-sources（页面内直连） |
| 80 | `POST` | `/admin/job-sync/sources/:sourceId/trigger` | 数据接入通道 DataSourceConfig | 改得了 | /sync-sources（页面内直连） |
| 81 | `POST` | `/admin/job-sync/sources/:sourceId/unpublish-content` | 数据接入通道 DataSourceConfig | 停得掉 | /sync-sources（页面内直连） |
| 82 | `GET` | `/admin/jobs/quality-summary` | 岗位数据质量 | 看得见 | /ai-services |
| 83 | `GET` | `/admin/legal-doc-versions` | 法务文档版本 LegalDocVersion | 看得见 | /legal-docs |
| 84 | `POST` | `/admin/legal-doc-versions` | 法务文档版本 LegalDocVersion | 改得了 | /legal-docs |
| 85 | `PATCH` | `/admin/legal-doc-versions/:id/activate` | 法务文档版本 LegalDocVersion | 改得了 | /legal-docs |
| 86 | `GET` | `/admin/member-benefits` | 会员权益发放 MemberBenefit | 看得见 | /member-benefits |
| 87 | `POST` | `/admin/member-benefits` | 会员权益发放 MemberBenefit | 改得了 | /member-benefits |
| 88 | `PATCH` | `/admin/member-benefits/:id/revoke` | 会员权益发放 MemberBenefit | 停得掉 | /member-benefits |
| 89 | `GET` | `/admin/member-benefits/users` | 会员权益发放 MemberBenefit | 看得见 | /member-benefits |
| 90 | `GET` | `/admin/member-privacy/data-requests` | 数据权利工单 DataRequest | 看得见 | /privacy-requests / /member-privacy |
| 91 | `POST` | `/admin/member-privacy/data-requests/:id/reject` | 数据权利工单 DataRequest | 停得掉 | /privacy-requests / /member-privacy |
| 92 | `POST` | `/admin/member-privacy/data-requests/:id/retry` | 数据权利工单 DataRequest | 改得了 | /privacy-requests / /member-privacy |
| 93 | `GET` | `/admin/notifications/broadcasts` | 系统广播 SystemBroadcast | 看得见 | /member-notifications |
| 94 | `POST` | `/admin/notifications/broadcasts` | 系统广播 SystemBroadcast | 改得了 | /member-notifications |
| 95 | `DELETE` | `/admin/notifications/broadcasts/:id` | 系统广播 SystemBroadcast | 停得掉 | /member-notifications |
| 96 | `GET` | `/admin/offline-agencies` | 线下机构与线下岗位 | 看得见 | /offline-agencies |
| 97 | `POST` | `/admin/offline-agencies` | 线下机构与线下岗位 | 改得了 | /offline-agencies |
| 98 | `DELETE` | `/admin/offline-agencies/:id` | 线下机构与线下岗位 | 停得掉 | /offline-agencies |
| 99 | `GET` | `/admin/offline-agencies/:id` | 线下机构与线下岗位 | 看得见 | /offline-agencies |
| 100 | `PUT` | `/admin/offline-agencies/:id` | 线下机构与线下岗位 | 改得了 | /offline-agencies |
| 101 | `GET` | `/admin/offline-agencies/:id/jobs` | 线下机构与线下岗位 | 看得见 | /offline-agencies |
| 102 | `POST` | `/admin/offline-agencies/:id/jobs` | 线下机构与线下岗位 | 改得了 | /offline-agencies |
| 103 | `DELETE` | `/admin/offline-agencies/:id/jobs/:jobId` | 线下机构与线下岗位 | 停得掉 | /offline-agencies |
| 104 | `PUT` | `/admin/offline-agencies/:id/jobs/:jobId` | 线下机构与线下岗位 | 改得了 | /offline-agencies |
| 105 | `PATCH` | `/admin/offline-agencies/:id/publish` | 线下机构与线下岗位 | 改得了 + 停得掉 | /offline-agencies |
| 106 | `PATCH` | `/admin/offline-agencies/:id/review` | 线下机构与线下岗位 | 改得了 + 停得掉 | /offline-agencies |
| 107 | `GET` | `/admin/orders` | 订单 Order（支付/退款） | 看得见 | /orders |
| 108 | `GET` | `/admin/orders/:id` | 订单 Order（支付/退款） | 看得见 | /orders |
| 109 | `POST` | `/admin/orders/:id/mark-paid` | 订单 Order（支付/退款） | 改得了 | —（无页面） |
| 110 | `POST` | `/admin/orders/:id/refund` | 订单 Order（支付/退款） | 改得了 | /orders |
| 111 | `GET` | `/admin/orgs` | 合作机构与机构账号 Organization | 看得见 | /partners |
| 112 | `POST` | `/admin/orgs` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 113 | `GET` | `/admin/orgs/:id` | 合作机构与机构账号 Organization | 看得见 | /partners |
| 114 | `PATCH` | `/admin/orgs/:id` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 115 | `POST` | `/admin/orgs/:id/accounts` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 116 | `PUT` | `/admin/orgs/:id/accounts/:accountId/email` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 117 | `PATCH` | `/admin/orgs/:id/accounts/:accountId/password` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 118 | `PATCH` | `/admin/orgs/:id/accounts/:accountId/status` | 合作机构与机构账号 Organization | 改得了 + 停得掉 | /partners |
| 119 | `GET` | `/admin/orgs/:id/content-trust` | 合作机构与机构账号 Organization | 看得见 | /partners |
| 120 | `PATCH` | `/admin/orgs/:id/content-trust` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 121 | `PATCH` | `/admin/orgs/:id/status` | 合作机构与机构账号 Organization | 改得了 + 停得掉 | /partners |
| 122 | `DELETE` | `/admin/orgs/:orgId/accounts/:accountId` | 合作机构与机构账号 Organization | 停得掉 | /partners |
| 123 | `POST` | `/admin/orgs/:orgId/accounts/:accountId/action-challenges` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 124 | `DELETE` | `/admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId` | 合作机构与机构账号 Organization | 停得掉 | /partners |
| 125 | `POST` | `/admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId/verify` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 126 | `DELETE` | `/admin/orgs/:orgId/accounts/:accountId/action-tickets/current` | 合作机构与机构账号 Organization | 停得掉 | /partners |
| 127 | `DELETE` | `/admin/orgs/:orgId/accounts/:accountId/phone-rebind/current` | 合作机构与机构账号 Organization | 停得掉 | /partners |
| 128 | `POST` | `/admin/orgs/:orgId/accounts/:accountId/phone-rebind/resend-new` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 129 | `POST` | `/admin/orgs/:orgId/accounts/:accountId/phone-rebind/start` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 130 | `POST` | `/admin/orgs/:orgId/accounts/:accountId/phone-rebind/verify` | 合作机构与机构账号 Organization | 改得了 | /partners |
| 131 | `GET` | `/admin/policy-sources` | 政策信息源 | 看得见 | /policy-sources |
| 132 | `GET` | `/admin/policy-sources/:id/eligibility-rules` | 政策信息源 | 看得见 | —（无页面） |
| 133 | `PATCH` | `/admin/policy-sources/:id/publish` | 政策信息源 | 改得了 + 停得掉 | /policy-sources |
| 134 | `PATCH` | `/admin/policy-sources/:id/review` | 政策信息源 | 改得了 + 停得掉 | /policy-sources |
| 135 | `POST` | `/admin/print-jobs/:id/abandon` | 打印任务 PrintTask（订单侧动作） | 停得掉 | /orders |
| 136 | `POST` | `/admin/print-jobs/:id/verify-outcome` | 打印任务 PrintTask（订单侧动作） | 改得了 | /orders |
| 137 | `GET` | `/admin/print-scan/tasks` | 打印/扫描任务运维 | 看得见 | /print-scan |
| 138 | `GET` | `/admin/print-scan/tasks/:type/:taskId` | 打印/扫描任务运维 | 看得见 | /print-scan |
| 139 | `POST` | `/admin/print-scan/tasks/:type/:taskId/actions` | 打印/扫描任务运维 | 改得了 + 停得掉 | /print-scan |
| 140 | `POST` | `/admin/print-scan/tasks/print/:taskId/close-unpaid` | 打印/扫描任务运维 | 停得掉 | /print-scan |
| 141 | `GET` | `/admin/print-tasks` | 打印任务 PrintTask（只读列表） | 看得见 | /alerts + /(工作台) |
| 142 | `GET` | `/admin/printers` | 打印机 Printer | 看得见 | /devices（打印机 tab） |
| 143 | `GET` | `/admin/recruitment-content/agency-profiles` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 144 | `GET` | `/admin/recruitment-content/agency-profiles/:profileId` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 145 | `GET` | `/admin/recruitment-content/agency-profiles/:profileId/branches/:branchId` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 146 | `GET` | `/admin/recruitment-content/organizations/:organizationId/qualifications` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 147 | `GET` | `/admin/recruitment-content/organizations/:organizationId/qualifications/:qualificationId` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 148 | `GET` | `/admin/recruitment-content/organizations/:organizationId/qualifications/:qualificationId/evidence-access` | 招聘内容合规底稿（机构档案/资质/平台名录） | 查得到 | —（无页面） |
| 149 | `GET` | `/admin/recruitment-content/platform-directories` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 150 | `GET` | `/admin/recruitment-content/platform-directories/:id` | 招聘内容合规底稿（机构档案/资质/平台名录） | 看得见 | —（无页面） |
| 151 | `GET` | `/admin/release-observation-plans` | 发布观察计划 | 看得见 | /devices（终端 tab · ReleaseObservationPanel） |
| 152 | `POST` | `/admin/release-observation-plans` | 发布观察计划 | 改得了 | /devices（终端 tab · ReleaseObservationPanel） |
| 153 | `PATCH` | `/admin/release-observation-plans/:planId` | 发布观察计划 | 改得了 + 停得掉 | /devices（终端 tab · ReleaseObservationPanel） |
| 154 | `GET` | `/admin/screensaver/terminals` | 宣传屏终端配置 | 看得见 | /screensaver |
| 155 | `GET` | `/admin/smart-campus/terminals` | 智慧校园配置 | 看得见 | /smart-campus |
| 156 | `GET` | `/admin/terminals` | 终端 Terminal | 看得见 | /devices（终端 tab） |
| 157 | `POST` | `/admin/terminals` | 终端 Terminal | 改得了 | /devices（终端 tab） |
| 158 | `POST` | `/admin/terminals/:terminalId/bind-code` | 终端 Terminal | 改得了 | /devices（终端 tab） |
| 159 | `GET` | `/admin/terminals/:terminalId/capabilities` | 终端能力开关 TerminalCapability | 看得见 | /print-scan |
| 160 | `PUT` | `/admin/terminals/:terminalId/capabilities/:capabilityKey` | 终端能力开关 TerminalCapability | 改得了 + 停得掉 | /print-scan |
| 161 | `POST` | `/admin/terminals/:terminalId/emergency-revoke` | 终端 Terminal | 停得掉 | /devices（终端 tab） |
| 162 | `PATCH` | `/admin/terminals/:terminalId/lifecycle` | 终端 Terminal | 改得了 + 停得掉 | /devices（终端 tab） |
| 163 | `PATCH` | `/admin/terminals/:terminalId/org` | 终端 Terminal | 改得了 | /devices（终端 tab） |
| 164 | `PATCH` | `/admin/terminals/:terminalId/profile` | 终端 Terminal | 改得了 + 停得掉 | /devices（终端 tab） |
| 165 | `GET` | `/admin/terminals/:terminalId/screensaver-config` | 宣传屏终端配置 | 看得见 | /screensaver |
| 166 | `PUT` | `/admin/terminals/:terminalId/screensaver-config` | 宣传屏终端配置 | 改得了 + 停得掉 | /screensaver |
| 167 | `GET` | `/admin/terminals/:terminalId/smart-campus-config` | 智慧校园配置 | 看得见 | /smart-campus |
| 168 | `PUT` | `/admin/terminals/:terminalId/smart-campus-config` | 智慧校园配置 | 改得了 + 停得掉 | /smart-campus |
| 169 | `GET` | `/admin/terminals/:terminalId/toolbox-config` | 百宝箱终端配置 | 看得见 | /toolbox |
| 170 | `PUT` | `/admin/terminals/:terminalId/toolbox-config` | 百宝箱终端配置 | 改得了 + 停得掉 | /toolbox |
| 171 | `GET` | `/admin/terminals/org-options` | 终端 Terminal | 看得见 | /devices（终端 tab） |
| 172 | `GET` | `/admin/toolbox/allowed-hosts` | 百宝箱应用治理 ToolboxApp | 看得见 | /toolbox |
| 173 | `POST` | `/admin/toolbox/allowed-hosts` | 百宝箱应用治理 ToolboxApp | 改得了 | /toolbox |
| 174 | `POST` | `/admin/toolbox/allowed-hosts/:hostId/review` | 百宝箱应用治理 ToolboxApp | 改得了 + 停得掉 | /toolbox |
| 175 | `GET` | `/admin/toolbox/apps` | 百宝箱应用治理 ToolboxApp | 看得见 | /toolbox |
| 176 | `POST` | `/admin/toolbox/apps` | 百宝箱应用治理 ToolboxApp | 改得了 | /toolbox |
| 177 | `POST` | `/admin/toolbox/apps/:appKey/suspend` | 百宝箱应用治理 ToolboxApp | 停得掉 | /toolbox |
| 178 | `GET` | `/admin/toolbox/apps/:appKey/versions` | 百宝箱应用治理 ToolboxApp | 看得见 | /toolbox |
| 179 | `POST` | `/admin/toolbox/apps/:appKey/versions` | 百宝箱应用治理 ToolboxApp | 改得了 | /toolbox |
| 180 | `POST` | `/admin/toolbox/apps/:appKey/versions/:version/approve` | 百宝箱应用治理 ToolboxApp | 改得了 | /toolbox |
| 181 | `POST` | `/admin/toolbox/apps/:appKey/versions/:version/publish` | 百宝箱应用治理 ToolboxApp | 改得了 | /toolbox |
| 182 | `POST` | `/admin/toolbox/apps/:appKey/versions/:version/reject` | 百宝箱应用治理 ToolboxApp | 停得掉 | /toolbox |
| 183 | `POST` | `/admin/toolbox/apps/:appKey/versions/:version/submit` | 百宝箱应用治理 ToolboxApp | 改得了 | /toolbox |
| 184 | `GET` | `/admin/toolbox/launch-summary` | 百宝箱应用治理 ToolboxApp | 看得见 | /toolbox |
| 185 | `GET` | `/admin/toolbox/terminals` | 百宝箱应用治理 ToolboxApp | 看得见 | /toolbox |
| 186 | `GET` | `/admin/users` | 终端用户 EndUser | 看得见 | /users |
| 187 | `GET` | `/admin/users/:endUserId` | 终端用户 EndUser | 看得见 | /users |

**动作类型合计**（一个端点可计入两类，故合计大于 187）：

| 类别 | 端点数 |
| --- | --- |
| 看得见（read） | 72 |
| 改得了（write） | 88 |
| 停得掉（disable/revoke） | 53 |
| 查得到（audit/trace） | 4 |

---

## 2. 按业务对象汇总：每类有几个「看得见 / 改得了 / 停得掉 / 查得到」

「无页面」列 = 该对象下前端零引用的端点数。

| 业务对象 | 端点总数 | 看得见 | 改得了 | 停得掉 | 查得到 | 无页面 | 对应页面 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 合作机构与机构账号 Organization | 20 | 3 | 13 | 6 | 0 | 0 | /partners |
| 招聘会内容运营 JobFair | 17 | 4 | 9 | 5 | 0 | 0 | /fairs |
| 百宝箱应用治理 ToolboxApp | 14 | 5 | 7 | 3 | 0 | 0 | /toolbox |
| 线下机构与线下岗位 | 11 | 3 | 6 | 4 | 0 | 0 | /offline-agencies |
| 企业展示 CompanyProfile | 9 | 3 | 5 | 3 | 0 | 0 | /companies |
| 招聘内容合规底稿（机构档案/资质/平台名录） | 8 | 7 | 0 | 0 | 1 | 8 | —（无页面） |
| 终端 Terminal | 8 | 2 | 5 | 3 | 0 | 0 | /devices（终端 tab） |
| 数据接入通道 DataSourceConfig | 7 | 2 | 3 | 2 | 1 | 0 | /sync-sources（页面内直连） |
| 权益活动 BenefitActivity | 6 | 2 | 3 | 1 | 0 | 0 | /benefit-activities |
| 宣传屏素材 AdAsset | 5 | 1 | 3 | 2 | 0 | 0 | /screensaver |
| 宣传屏播放方案 AdPlaylist | 4 | 1 | 2 | 2 | 0 | 0 | /screensaver |
| AI 模型配置 LlmConfig | 4 | 2 | 2 | 1 | 0 | 0 | /ai-config |
| AI 海报生成 AiPosterGeneration | 4 | 2 | 2 | 0 | 0 | 3 | —（无页面）、/screensaver |
| 意见反馈工单 FeedbackTicket | 4 | 2 | 2 | 1 | 0 | 0 | /member-feedback |
| 会员权益发放 MemberBenefit | 4 | 2 | 1 | 1 | 0 | 0 | /member-benefits |
| 订单 Order（支付/退款） | 4 | 2 | 2 | 0 | 0 | 1 | /orders、—（无页面） |
| 政策信息源 | 4 | 2 | 2 | 2 | 0 | 1 | /policy-sources、—（无页面） |
| 打印/扫描任务运维 | 4 | 2 | 1 | 2 | 0 | 0 | /print-scan |
| AI 模型配置 LlmConfig（旧单例路径） | 3 | 1 | 2 | 1 | 0 | 3 | —（无页面） |
| 计费价目与对账 ServicePriceConfig | 3 | 1 | 1 | 1 | 1 | 0 | /billing |
| 招聘会信息源（外部数据） | 3 | 1 | 2 | 2 | 0 | 0 | /fair-sources + /(工作台)、/fair-sources |
| 岗位信息源（外部数据） | 3 | 1 | 2 | 2 | 0 | 0 | /job-sources + /(工作台)、/job-sources |
| 法务文档版本 LegalDocVersion | 3 | 1 | 2 | 0 | 0 | 0 | /legal-docs |
| 数据权利工单 DataRequest | 3 | 1 | 1 | 1 | 0 | 0 | /privacy-requests / /member-privacy |
| 系统广播 SystemBroadcast | 3 | 1 | 1 | 1 | 0 | 0 | /member-notifications |
| 发布观察计划 | 3 | 1 | 2 | 1 | 0 | 0 | /devices（终端 tab · ReleaseObservationPanel） |
| 宣传屏终端配置 | 3 | 2 | 1 | 1 | 0 | 0 | /screensaver |
| 智慧校园配置 | 3 | 2 | 1 | 1 | 0 | 0 | /smart-campus |
| AI 调用日志与用量 AiServiceLog | 2 | 2 | 0 | 0 | 0 | 0 | /ai-services |
| 批量发布（岗位/招聘会/政策） | 2 | 0 | 2 | 1 | 0 | 0 | /job-sources + /fair-sources + /policy-sources（BulkPublishButton） |
| 打印任务 PrintTask（订单侧动作） | 2 | 0 | 1 | 1 | 0 | 0 | /orders |
| 终端能力开关 TerminalCapability | 2 | 1 | 1 | 1 | 0 | 0 | /print-scan |
| 百宝箱终端配置 | 2 | 1 | 1 | 1 | 0 | 0 | /toolbox |
| 终端用户 EndUser | 2 | 2 | 0 | 0 | 0 | 0 | /users |
| 运营告警 | 1 | 1 | 0 | 0 | 0 | 0 | /alerts + /(工作台) |
| 审计日志 AuditLog | 1 | 0 | 0 | 0 | 1 | 0 | /audit + /account-settings + /(工作台) / /audit |
| 设备集群总览 | 1 | 1 | 0 | 0 | 0 | 0 | /devices（设备总览 tab） |
| Excel 导入批次 ImportBatch | 1 | 1 | 0 | 0 | 0 | 0 | /import-batches |
| 求职材料模板 | 1 | 1 | 0 | 0 | 0 | 0 | /job-materials |
| 岗位数据质量 | 1 | 1 | 0 | 0 | 0 | 0 | /ai-services |
| 打印任务 PrintTask（只读列表） | 1 | 1 | 0 | 0 | 0 | 0 | /alerts + /(工作台) |
| 打印机 Printer | 1 | 1 | 0 | 0 | 0 | 0 | /devices（打印机 tab） |

### 2.1 关于「查得到」只有 4 条 —— 不要误读

上表「查得到」列只统计**专门用于事后追溯的端点**（`GET /admin/audit-logs`、
资质取证 `evidence-access`、对账 `billing/reconciliation`、数据源影响面 `job-sync/.../impact`）。

**这不代表其它 42 类业务对象没有追溯能力。** 大部分写端点会在自己的 service 里落
`AuditLog`，追溯统一收敛到 `GET /admin/audit-logs` 一个入口（`/audit` 页）。
已逐个复核确认写审计的例子：

- `services/api/src/jobs/jobs-admin.service.ts:87` —— 岗位/招聘会信息源 review 落审计
  （注意：`graph.json` 的 `serviceFiles` 闭包只走深度 2，**漏标**了这条，按图谱会误判成"无审计"）
- `services/api/src/admin-print-scan/admin-print-scan.controller.ts:104` —— 打印扫描动作落审计
- `services/api/src/recruitment-content/admin-recruitment-content.controller.ts:72-89` —— 资质取证访问落审计
- 批量发布 `services/api/src/bulk-publish/bulk-publish.service.ts:173/182/190` 复用单条
  `publishJobSource / publishFairSource / publishPolicy`，审计由单条路径写入

### 2.2 缺口一：只有「看得见」、没有「改得了 / 停得掉」的对象

| 业务对象 | 现状 | 影响 |
| --- | --- | --- |
| 终端用户 EndUser | 仅 `GET /admin/users`、`GET /admin/users/:endUserId` | **无法封禁 / 停用任何终端用户**，详见 §6.1 |
| AI 调用日志与用量 AiServiceLog | 仅 2 条 GET | 只能看，不能限流、不能按用户拦截，详见 §5 |
| 打印机 Printer | 仅 `GET /admin/printers` | 打印机状态由心跳聚合，Admin 不能停用某台打印机 |
| 运营告警 | 仅 `GET /admin/alerts` | 告警不可确认 / 不可静默 / 不可关闭 |
| 设备集群总览 / Excel 导入批次 / 求职材料模板 / 岗位数据质量 | 各 1 条 GET | 均为只读投影，符合设计 |
| 招聘内容合规底稿 | 8 条全 GET，且**全部无页面** | 详见 §3 |

### 2.3 缺口二：有「改得了」、没有「停得掉」的对象

| 业务对象 | 有的写能力 | 缺的停用能力 |
| --- | --- | --- |
| 法务文档版本 LegalDocVersion | `POST` 新建、`PATCH :id/activate` 激活 | **没有停用 / 回滚端点**。`services/api/src/legal/admin-legal-docs.controller.ts` 只有 3 个 handler（16/22/34 行），激活后只能靠再激活一个新版本顶掉，无法直接下线一个已生效版本 |
| 订单 Order | `mark-paid`、`refund` | `/admin/orders` 下没有取消 / 关闭订单端点。唯一的关单路径在别的命名空间：`POST /admin/print-scan/tasks/print/:taskId/close-unpaid`（仅限未付款未领取的打印任务） |
| AI 海报生成 | `POST generations`、`POST accept` | 无撤销；但一期本就是 stub（见 §3） |

---

## 3. 有端点无页面：16 条（运营在 Admin 里够不着）

判定方式见 §0.1 / §0.2：`apps/admin/src` 全部 138 个源文件里没有任何字面量、
模板串或字符串拼接命中这些路径；每条另做过全仓 grep 复核，复核结果写在「全仓复核」列。

| # | 端点 | 全仓复核 | 性质 |
| --- | --- | --- | --- |
| 1 | `GET /admin/ai-config` | 仅 `services/api/src/ai/llm/ai-config.controller.ts:37` 定义 + `services/api/scripts/verify-toolbox-ai-skill-real-acceptance.ts:105` 引用 | **重复端点，非缺口**。前端走复数版 `/admin/ai-configs`（`apps/admin/src/services/api/aiConfig.ts:92`）。两个 Controller 在同一文件里（`AiConfigController` 37 行 / `AiConfigsController` 81 行），共用同一个 `LlmConfigService`，能力等价 |
| 2 | `PUT /admin/ai-config` | 同上 | 同上（旧单例写路径，未带 `:featureKey`，默认落 `assistant_chat`） |
| 3 | `POST /admin/ai-config/test` | 同上 | 同上 |
| 4 | `POST /admin/ai-posters/generations` | 全仓 `ai-posters` 只有 3 处命中：controller 自身、其注释、`apps/admin/src/services/api/screensaver.ts:115`（只调 `/status`） | **按设计的二期占位**。`AI_IMAGE_PROVIDER=disabled` 时这三条一律返回 400 `AI_POSTER_NOT_ENABLED`（`services/api/src/content/ai-poster.controller.ts:9-13`），不算能力缺口 |
| 5 | `GET /admin/ai-posters/generations/:id` | 同上 | 同上 |
| 6 | `POST /admin/ai-posters/generations/:id/accept` | 同上 | 同上 |
| 7 | `POST /admin/orders/:id/mark-paid` | `apps/admin/src` grep `mark-paid` / `markPaid` → **0 命中**；后端 `services/api/src/payment/admin-order-actions.controller.ts:30`，verify 脚本 `verify-order.ts:654` / `verify-payment-flow.ts:723` 有覆盖 | **真缺口**。线下收款标记付款只有端点与门禁，`/orders` 页只做了 refund（`apps/admin/src/routes/orders/index.tsx:201`）和 abandon/verify-outcome，没有 mark-paid 按钮 |
| 8 | `GET /admin/policy-sources/:id/eligibility-rules` | `apps/admin/src` grep `eligibilit` 只命中权益类型字符串 `subsidy_eligibility_hint`，非本端点；Partner 侧有对应能力 `apps/partner/src/services/api/policies.ts:229` | **真缺口**。后端注释明写「只读复核」（`services/api/src/policies/policies.controller.ts:39`），但 `/policy-sources` 页审政策时看不到 Partner 填的资格规则 |
| 9 | `GET /admin/recruitment-content/platform-directories` | 全仓仅 `services/api/scripts/verify-recruitment-content-http.ts` 引用 | **真缺口** |
| 10 | `GET /admin/recruitment-content/platform-directories/:id` | 同上 | 真缺口 |
| 11 | `GET /admin/recruitment-content/agency-profiles` | 同上 | 真缺口 |
| 12 | `GET /admin/recruitment-content/agency-profiles/:profileId` | 同上 | 真缺口 |
| 13 | `GET /admin/recruitment-content/agency-profiles/:profileId/branches/:branchId` | 同上 | 真缺口 |
| 14 | `GET /admin/recruitment-content/organizations/:organizationId/qualifications` | 同上 | 真缺口 |
| 15 | `GET /admin/recruitment-content/organizations/:organizationId/qualifications/:qualificationId` | 同上 | 真缺口 |
| 16 | `GET /admin/recruitment-content/organizations/:organizationId/qualifications/:qualificationId/evidence-access` | 同上 | 真缺口，**且是唯一一条会落审计的取证端点**（`admin-recruitment-content.controller.ts:72-89`）—— 后端把「谁看了资质证据」记下来了，前端却没有任何地方能触发它 |

**归类**：16 条里 3 条是重复端点（ai-config 单例版）、3 条是设计内的二期 stub（ai-posters），
**真正够不着的是 10 条**：`recruitment-content` 全部 8 条 + `orders/mark-paid` + `policy-sources 资格规则`。

### 3.1 端点能力强于页面（不算"无页面"，但运营用不到）

| 端点 | 后端支持 | 页面实际暴露 |
| --- | --- | --- |
| `GET /admin/audit-logs` | `action / actorId / targetType / targetId / startAt / endAt / limit / offset` 八个筛选（`apps/admin/src/services/api/adminHttpAdapter.ts:209-222`） | `/audit` 页只做了 `action / startAt / endAt` + 分页（`apps/admin/src/routes/audit/index.tsx:75-92`），**按操作人、按对象追溯查不了** |
| `GET /admin/users` | `page/pageSize/keyword/phone/enabled/registeredFrom/registeredTo`（`services/api/src/admin-users/admin-users.controller.ts:53-61`） | **筛选全都接了**（`apps/admin/src/services/api/adminUsers.ts:44-55`，页面 `routes/users/index.tsx:161-173`）。问题不在筛选：页面 38-41 行渲染「正常 / 已停用」状态柱、161 行提供「已停用」筛选项，**但全仓没有任何端点能把用户改成「已停用」**（见 §6.1）—— 这一列在生产里恒为「正常」 |

---

## 4. 有页面无端点

37 条路由逐条核对，结果分四类：

### 4.1 真空页面（0 个后端调用，且页面自述"本阶段不开放"）

| 路由 | 文件 | 说明 |
| --- | --- | --- |
| `/permissions` | `apps/admin/src/routes/permissions/index.tsx`（15 行） | 全文只有一个 `EmptyState`：「账号与角色由平台侧统一管理…本页不开放细粒度权限编辑」。全仓**没有任何 RBAC 端点**，页面表述与后端一致，不是伪造 |
| `/peripherals` | `apps/admin/src/routes/peripherals/index.tsx`（12 行） | 同为 `EmptyState`：外设由 Terminal Agent 提供，本阶段不做独立管理。作为 `/devices` 的第 4 个 tab 渲染 |

这两页符合 CLAUDE.md §9「不伪造能力」：没有端点就明说没有，没有编造假数据。

### 4.2 只做重定向的路由（3 条）

`/terminals`、`/printers`、`/peripherals` 在 `apps/admin/src/routes/index.tsx:50-52` 均为
`<Navigate to="/devices?tab=..." replace />`，实际页面是 `/devices` 的 tab
（`apps/admin/src/routes/devices/index.tsx:1-5` 直接 import 这三个组件）。
本文第 1 章表格里这三类端点统一记到「/devices（xx tab）」。

### 4.3 使用非 `/admin/` 命名空间端点的页面（不在 187 条内，但不是无端点）

| 路由 | 实际调用 |
| --- | --- |
| `/files` | `GET /files`、`GET /files/lifecycle-summary`、`GET /files/:id/url`、`DELETE /files/:id`、`POST /files/cleanup-expired`（`apps/admin/src/services/api/files.ts:142-155`） |
| `/login`、`/account-settings` | `/auth/*` 系列（`apps/admin/src/services/auth/index.ts`）；`/account-settings` 另外用了 `GET /admin/audit-logs` |
| `/job-materials` | 除 `GET /admin/job-materials/summary` 外，还用 `GET /job-materials/templates`（`apps/admin/src/services/api/jobMaterials.ts:65`） |

**这是本次盘点的一个方法论提醒**：只按 `/admin/` 前缀穷举会漏掉 `/files/*`
这一整块真实的管理能力（文件列表、签名 URL、删除、过期清理）。文件管理不是"没做"，
是它不在 `admin` 命名空间下。

### 4.4 一套端点被两个页面重复消费

`/member-privacy` 与 `/privacy-requests` 是**两个独立导航项**
（`apps/admin/src/layouts/AdminLayoutWrapper.tsx:120` 和 `:124`），
分别通过两个独立的 service 模块 `memberPrivacyAdmin.ts` / `adminPrivacyRequests.ts`
调用**完全相同的 3 条端点**（`GET/POST/POST /admin/member-privacy/data-requests*`）。
两页的能力重合，属于重复入口，与 CLAUDE.md §15「不新增重复入口 / 同义卡片」的口径冲突。
本文只做记录，不在此任务内处置。

---

## 5. AI 管理能力专项（逐行读代码，不按名字猜）

### 5.1 `GET /admin/ai/usage` 实际返回什么

实现链：`services/api/src/ai/ai.controller.ts:442` → `AiLogService.getUsage()`
（`services/api/src/ai/ai-log.service.ts:408-462`）。

**入参：一个都没有。** Controller 方法签名是 `async getAiUsage(): Promise<AdminAiUsage>`，
没有任何 `@Query`。窗口写死在 `ai-log.service.ts:306`：`AI_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000`，
取数上限写死 `take: 10_000`（`:489`）。**不能选时间范围、不能选能力、不能选 provider、不能选终端。**

返回结构（`AdminAiUsage`，`ai-log.service.ts:105-140`）：

| 字段 | 是否分能力 | 说明 |
| --- | --- | --- |
| `byOperation: Record<AiOperation, number>` | ✅ **分能力** | 每个 operation 的调用次数 |
| `costByOperation: Record<AiOperation, {cny, calls, measuredCalls}>` | ✅ **分能力** | 每个 operation 的成本三态（已采集金额 / 总调用 / 已采集调用） |
| `totalCalls` / `successCount` / `failCount` / `successRate` | ❌ 仅总量 | 不分能力 |
| `avgLatencyMs` | ❌ 仅总量 | 只算成功请求的平均值，不分能力 |
| `errorDistribution: [{code, count}]` | ❌ 仅总量 | 错误码分布不带 operation 维度 |
| `tokenUsageTotals` | ❌ 仅总量 | prompt/completion/total 三个数，不分能力 |
| `estimatedCostCny` / `unmeasuredCalls` / `costCollectionSince` | ❌ 仅总量 | 全窗口成本下限 + 未采集笔数 + 采集起始日 |
| `alerts` | ❌ 仅总量 | 失败率 / 成本 / 单终端异常告警 |
| `providerName` | ❌ | 取自 `AiService.getProviderName()`，是**全局当前 provider**，不是分能力的 |

`AiOperation` 全集 17 个（`ai-log.service.ts:160-177`）：`parseResume`、`optimizeResume`、
`adjustResumeLayout`、`generateResume`、`chatAssistant`、`classifyIntent`、`jobRecommend`、
`jobExplain`、`jobMatch`、`careerPlan`、`fairVisitPlan`、`interviewQuestion`、`interviewReport`、
`voiceTranscribe`、`voiceSynthesize`、`selfAssessment`、`contractReview`。

**结论：调用量和成本可以按服务拆开看；成功率、延迟、错误码、token 只有总量。**

### 5.2 `GET /admin/ai/logs` 实际返回什么

实现：`ai.controller.ts:449-456` → `AiLogService.getLogs()`（`ai-log.service.ts:464-483`）。

**入参只有一个 `limit`**，`Math.min(limit, 500)`，默认 100。
**没有 operation 筛选、没有 status 筛选、没有时间范围、没有 offset/分页、没有 provider 筛选。**

每条 entry 字段：`taskId`(= `AiServiceLog.id`)、`provider`、`operation`、`latencyMs`、
`status`、`tokenUsage`、`estimatedCostCny`、`errorCode`、`createdAt`、`terminalId`。

值得单独指出：Prisma 里 `AiServiceLog` 有 `endUserId` 字段并建了索引
（`services/api/prisma/schema.prisma:1760-1766`），
但 `getLogs` / `getUsage` **都不 select 它**，返回体里没有用户维度 —— 这与合规约束一致
（页面注释 `apps/admin/src/routes/ai-services/index.tsx:4-8` 明写只展示元数据），
但同时意味着**从 AI 日志无法定位到具体滥用账号**。

同样值得指出：schema 第 1764 行已经建了 `@@index([operation, createdAt])` —— 数据库为按能力查询做好了索引，**端点层没有开这个筛选**。

### 5.3 能否按 `AiServiceLog.operation` 的逐服务取值分开查询与统计

| 需求 | 服务端 | 前端 |
| --- | --- | --- |
| 分服务**统计调用量** | ✅ `usage.byOperation` | ✅ `/ai-services` 有全量 17 行表格（`index.tsx:421-490`），只显示 `calls>0` 的行 |
| 分服务**统计成本** | ✅ `usage.costByOperation` 三态 | ✅ 同表格「估算成本」列，未采集显示「未估算」而非 ¥0 |
| 分服务**查询日志** | ❌ 端点无 operation 参数 | ⚠️ **只有客户端筛选**：页面取回最近 100 条后用 `logs.filter()` 在浏览器里过滤（`index.tsx:271-275`） |
| 分服务看**成功率 / 延迟 / 错误码** | ❌ 只有总量 | ❌ 页面也只能显示总量 |

**关键限制**：`/ai-services` 页固定请求 `getAiLogs(100)`（`index.tsx:173`）。
所以按能力筛日志时，筛的是「最近 100 条里属于该能力的」，
不是「该能力的最近 100 条」。**低频能力（如 `contractReview`）很容易在筛选后显示为空，
而它其实有调用** —— 这是本次盘点里最容易被误读成「该能力没在用」的地方。

### 5.4 `apps/admin/src/routes/ai-services/index.tsx`（697 行）到底渲染了哪些字段

逐项确认，不按名字推测：

| 字段 | 在页面上？ | 位置与形态 |
| --- | --- | --- |
| 成本（总额） | ✅ | 322-347 行「预估成本」卡片，`unmeasuredCalls>0` 时标注「下限 · 另有 N 次未采集」 |
| 成本（分能力） | ✅ | 421-490 行表格「估算成本」列，三态：`measured` 显金额 / `partial` 显金额+缺口 / `uncollected` 显「未估算」 |
| 延迟 | ⚠️ 两处，都不分能力 | 335 行「平均响应时间」（全局总量）；624-628 行日志表每行的单次 `latencyMs` |
| provider | ✅ | 351-357 行「当前 Provider」卡片（全局）；609-613 行日志表每行 provider 标签 |
| token | ⚠️ 仅总量 | 375-382 行「真实 token 用量」卡片（总/输入/输出）。**分能力 token 页面上没有，后端也没提供** |
| 失败率 | ⚠️ 仅总量 | 327-334 行「成功率」卡片（`successCount / failCount`）。**分能力失败率没有** |
| 错误码 | ✅ 两处 | 550-571 行「失败原因分布」（全局 code + count）；616-618 行日志表每行 `errorCode` |
| 按服务筛选 | ✅ 但是客户端筛选 | 583-600 行 18 个按钮（全部 + 17 个 operation），配合 602-618 行状态筛选（全部/成功/失败），生效范围见 §5.3 |
| 岗位 AI 专区 | ✅ | 385-417 行：`jobRecommend / jobExplain / jobMatch` 三项调用量 + 成本 |
| 岗位来源质量 | ✅ | 519-548 行，数据来自 `GET /admin/jobs/quality-summary`（同页第三个请求） |
| 成本采集起始日 | ✅ | 508-511 行，如实声明该日期前的历史成本不完整且不回填 |

**页面上没有的**：分能力延迟、分能力成功率、分能力 token、按用户/终端维度的用量、
导出 CSV（全 `apps/admin/src` 无任何导出实现）、任何写操作按钮。
`/ai-services` 是**纯只读页**。

### 5.5 有没有「停得掉」类的 AI 管理能力

逐条查证，结论分三种：

| 诉求 | 有没有 | 证据 |
| --- | --- | --- |
| **停用某个 AI 能力** | ✅ **有** | `PUT /admin/ai-configs/:featureKey` 的 body 含 `enabled?: boolean`（`services/api/src/ai/llm/ai-config.controller.ts:29`、`:117`），`/ai-config` 页有开关（`apps/admin/src/routes/ai-config/index.tsx:370`）。关掉后页面明写「未启用，相关功能会明确失败或走既有默认应答」（`:227`） |
| **切换 / 禁用某个 provider** | ✅ **有，但是按能力切，不是全局禁用** | 同一端点可改 `vendor / model / baseURL / apiKey`（`ai-config.controller.ts:110-119`）。**没有"禁用某 provider"这个动作**；等价做法是把用到它的 feature 逐个改 vendor 或 `enabled:false`。注意 `/ai-services` 页的「当前 Provider」卡片提示「切换需修改服务端 AI_PROVIDER」（`ai-services/index.tsx:354`），与 `/ai-config` 的按能力切换是两套口径 |
| **限流 / 配额** | ❌ **不能在后台配** | 限流是代码级装饰器 `@PaidAiThrottle(4)`（`ai-config.controller.ts:71`、`:120`，实现在 `services/api/src/common/throttler/terminal-throttle.ts:266`）。187 条 admin 端点里**没有任何一条**路径或 body 涉及 quota / throttle / rate-limit（已对全部 187 条逐条核对） |
| **封禁滥用账号** | ❌ **后端根本没有写入路径**，详见 §6.1 | |
| **AI 配置变更留痕** | ❌ **不写审计** | `services/api/src/ai/llm/llm-config.service.ts` 共 506 行，`grep -n audit` **零命中**；`services/api/src/ai/llm/` 整个目录零命中；`main.ts` / `app.module.ts` 无全局审计 interceptor。也就是说**改 AI 模型 / 改 apiKey / 关停某能力，`/audit` 页查不到** |
