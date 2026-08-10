# 招聘信息内容域统一模型与迁移方案（P1）

> 状态：**方案已冻结 / 实施 NO-GO**
> 基线：`origin/main@1ecf5e988a5a8ff91d445565153f4999a51bd7fd`
> 日期：2026-08-10
> 关联：[外部数据源接入设计](./external-data-source-design.md)｜[后台规划](./console-plan-for-kiosk-proto-2026-07.md)｜[合规边界](../compliance/compliance-boundary.md)｜[生产内容替换清单](../operations/production-content-data-replacement-list-2026-08.md)

## 1. 本轮归位与边界

本方案统一的是“第三方或官方招聘信息的主体、接入、审核、发布、外跳与归档治理”，不是招聘业务闭环。

本轮允许：

- 只读盘点现有 schema、接口、公开生产状态和已归档生产审计。
- 冻结长期实体关系、状态语义、存量映射和分波迁移方案。
- 明确下一实施波的文件预算、验证门禁、回滚和授权要求。

本轮不做：

- 不新增 Prisma 模型或 migration，不执行生产 SQL，不连接生产私有库。
- 不新增 Admin、Partner、Kiosk 页面或入口，不改现有路由和 UI。
- 不运行 seed、SQLite→PostgreSQL 搬数、PG→SQLite 回滚或任何生产部署。
- 不新增申请单、候选人、简历接收、投递结果、预约结果、面试或 Offer 对象。

## 2. 当前事实盘点

### 2.1 公开生产状态

2026-08-09 公网只读探针：

| 对象          |        公开结果 | 公开查询条件                    |
| ------------- | --------------: | ------------------------------- |
| API health    | `ok / postgres` | 真实数据库健康检查              |
| Job           |       `total=0` | `approved + published`          |
| JobFair       |       `total=0` | 公开审核发布条件                |
| PolicyPost    |             `0` | 已发布政策                      |
| OfflineAgency |       `total=0` | `approved + published + active` |

这只能证明当前公开集合为空，不能证明私有表为空。2026-08-07 已归档生产治理记录显示：219 条 Job 中 215 条样例/预生产岗位已下架、3 场已结束招聘会已下架、1 个演示机构和 1 个演示岗位已下架或停用、PolicyPost 为 0、JobSource 共 4 个。该快照不是实时数据；正式 backfill 前必须重新执行具名授权的生产只读盘点。

### 2.2 当前模型孤岛

```text
Organization ──< JobSource ──< Job
      └──────────────────────< Job

OfflineAgency ──< OfflineJob

Kiosk OnlinePlatformsPage ── 4 个代码常量（无数据库、审核、下架和链接巡检）
```

明确缺口：

- `OfflineAgency.sourceOrgId` 只是可空字符串，不是 Organization 外键。
- `OfflineJob` 没有 JobSource、真实用工企业、来源四要素、独立审核发布、有效期和质量快照。
- `Job.sourceId` 可空，唯一键仍是 `(sourceOrgId, externalId)`，不能准确表达同机构多通道幂等。
- `JobSource.enabled` 同时容易被理解为审批、同步和信任状态，操作语义不够清晰。
- Kiosk 线上平台目录是硬编码内容，和 JobSource 技术通道不是同一对象。
- 当前机构审核不能证明许可证有效；内容审核、资质核验和岗位审核必须分开。

### 2.3 双库事实与旧工具风险

- SQLite schema 是模型 SSOT；PostgreSQL schema 由 `sync-postgres-schema.ts` 机械生成，目标模型当前保持一致。
- Wave 1A 合入后 SQLite migration 目录为 79 批、PostgreSQL migration 目录为 51 批；两端历史 SQL 不能按目录数量或文件名一一对应，必须按最终 schema 与行为校验。
- 生产已经运行 PostgreSQL；本方案的“双库”是“SQLite 开发/主 CI 与 PostgreSQL 生产契约保持一致”，不是再次切库。
- 历史 `migrate-sqlite-to-postgres.ts` 的 `MODEL_ORDER` 只覆盖 37 个模型，遗漏 OfflineAgency、OfflineJob 等对象，且所谓“全表对账”仍只遍历 `MODEL_ORDER`；Wave 1A 已将该脚本与 package 命令退役删除，禁止从 Git 历史恢复执行。
- 生产禁止回退 SQLite；数据库回滚以应用回退、保留 additive schema 和 PostgreSQL 备份恢复为准。

## 3. 统一领域模型

### 3.1 关系总图

```text
Organization（法律/合同/账号责任主体）
├─< QualificationRecord（资质事实与证据）
├─< JobSource（API / Webhook / Excel / manual 技术通道）
├─0..1 OfflineAgencyProfile（线下机构公开名片）
│   └─< OfflineAgencyBranch（门店）
└─< Job（线上/线下唯一岗位事实源）
      ├─ sourceId → JobSource
      └─ offlineBranchId? → OfflineAgencyBranch

OnlinePlatformDirectory（官方平台导航目录项）
└─ organizationId? → Organization（可选关联，不继承主体或数据源状态）

OfflineAgency / OfflineJob：迁移期 legacy，只兼容读取和映射，最终退出写路径
```

三个对象必须保持独立生命周期：

1. Organization：谁承担合同、账号、授权和内容责任。
2. JobSource：数据通过什么技术通道进入。
3. OnlinePlatformDirectory：Kiosk 向用户展示哪个官方平台入口。

目录项发布不能自动启用 JobSource；JobSource 获批也不能自动生成目录项或“合作平台”称谓。

### 3.2 Organization

复用现有主体和 Partner 账号归属，保留 `enabled` 作为账号与写入总开关；新增独立内容信任语义：

| 字段                        | 目标语义                                                                   |
| --------------------------- | -------------------------------------------------------------------------- |
| `contentTrustStatus`        | `pending / active / suspended / revoked`；决定关联公开内容是否 fail-closed |
| `contentTrustReviewedBy/At` | 最近一次信任决策                                                           |
| `contentTrustReason`        | 暂停或撤销原因                                                             |
| `archivedAt`                | 主体归档时间，不物理删除                                                   |

在招聘内容域内，`enabled=false` 只作为账号登录和新增写入门禁，不得仅凭它静默批量下架历史招聘内容；需要隐藏内容时必须使用 content trust 动作、展示影响预览并写审计。Organization 在终端、校园等其他业务域的既有语义不由本方案改写。

状态兼容规则：

- 目标枚举补 `pending`；新 Organization / JobSource 的 trust 与 approval 默认 `pending`，不得默认信任。
- Expand 阶段新增字段保持 nullable，旧 reader 不读取新门禁；`null` 不等于 `active`。
- `enabled → syncEnabled` 可机械回填，但 `enabled` 不能反推 approval/trust；后两者必须由 AuditLog、来源证明和人工清单确认。
- 兼容期写路径同时维护 `enabled` 与 `syncEnabled`，读取同步开关使用 `syncEnabled ?? enabled`；只有 backfill 完整率 100%、blocker=0 且验收通过后才切换新 reader。
- Contract 前必须证明新状态字段 `null=0`，再收紧 NOT NULL。

### 3.3 QualificationRecord

资质是独立事实，不复用机构内容审核状态。

| 字段                                     | 说明                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `organizationId`                         | 必填 Organization 外键                                                                                                                  |
| `qualificationType`                      | `business_license / hr_service_license / labor_dispatch_permit / public_service_authority / school_authority / organizer_authorization` |
| `licenseNumber`                          | 服务端保存；公开展示策略独立配置，默认脱敏                                                                                              |
| `validFrom / validUntil`                 | 有效期                                                                                                                                  |
| `status`                                 | `pending / valid / rejected / expired / revoked`                                                                                        |
| `contentVersion / contentHash / approvedContentHash / hashAlgorithmVersion` | 资质事实版本；`valid` 只有在批准 hash 等于当前 hash 时才生效                                             |
| `evidenceFileId`                         | 私有 FileObject；不得返回永久公开 URL                                                                                                   |
| `verifiedBy / verifiedAt / rejectReason` | 核验责任与结论                                                                                                                          |
| `verificationSource / notes`             | 核验来源与内部备注                                                                                                                      |
| `archivedAt`                             | 归档时间                                                                                                                                |

机构页面是否显示“资质信息已核验”，必须由当前有效 QualificationRecord 投影产生，并显示核验截至日期；不得把 `reviewStatus=approved` 当成资质核验。

主体类型与资质门禁首期冻结为：

| Organization.type           | OfflineAgencyProfile 默认资格 | 必需核验                                                                          |
| --------------------------- | ----------------------------- | --------------------------------------------------------------------------------- |
| `licensed_hr_agency`        | 允许                          | 营业执照 + 人力资源服务许可证；若 `serviceScope` 声明劳务派遣，再加劳务派遣许可证 |
| `public_employment_service` | 允许                          | 官方机构身份与公共就业服务职责证明，不用营业执照冒充行政授权                      |
| `school_employment_center`  | 默认不作为线下招聘机构发布    | 学校主体与就业中心授权只用于学校来源能力                                          |
| `fair_organizer`            | 默认不作为线下招聘机构发布    | 每场招聘会另验主办/承办授权，不能继承为常设机构资质                               |
| `enterprise_source`         | 默认不作为线下招聘机构发布    | 企业主体登记只能证明来源企业，不能证明人力资源服务资质                            |

QualificationRecord 还必须记录 `issuerName / jurisdiction / appliesToBranchId? / verificationSource`；服务范围只能由 Admin 从已核验证照投影，Partner 不能通过修改 `serviceScopeJson` 降低必需证照。证照号、有效期、证据文件、适用门店或核验来源变化必须 bump version、重算 hash 并退回 `pending`，不得让旧批准 hash 继续生效。到期/撤销任务按日扫描并立即 fail-closed，恢复必须产生新的核验决定。证据 FileObject 使用独立 `qualification_evidence` purpose、私有访问、替换留版本、到期后按法务留存期归档；Logo 使用公开品牌资产 purpose 和可撤销引用，不复用证照文件。

### 3.4 JobSource

保留 endpoint、凭证、mapping、批次、同步日志等现有能力，逐步把三类状态拆开：

| 状态             | 作用                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `approvalStatus` | `pending / approved / rejected`；Admin 是否允许该通道接入            |
| `syncEnabled`    | 是否继续接收或拉取新数据                                             |
| `trustStatus`    | `pending / active / suspended / revoked`；是否继续信任该来源已有内容 |
| `archivedAt`     | 是否归档                                                             |

另增 `allowedContentDomainsJson / redirectPolicy`，作为该 JobSource 导入内容 URL 的唯一域名策略；API endpoint 域、目录 officialDomains 和内容 URL 域三者不得混用。

兼容期保留旧 `enabled`，不得根据单个布尔值自动推断历史审批结论。正式 backfill 必须结合 AuditLog 和人工清单判定。

### 3.5 OnlinePlatformDirectory

这是 Admin-only 的公开导航目录，不存 API endpoint、credential 或字段映射。

建议字段：

- `organizationId?`：可选关联已核实主体；不得因目录发布自动创建 Partner 账号或授予接入权。关联建立后使用删除限制，不能通过删除主体把“已关联”静默变成“从未关联”；显式解绑必须退审并写 ReviewDecision。
- `name / slug / category / neutralDescription`。
- `officialDomainsJson / landingUrl`：只允许 HTTPS；重定向最终域也必须在白名单。
- `logoFileId`：可选，品牌使用授权未确认时不用 Logo。
- `operatorLegalName / evidenceFileId?`：记录平台运营主体快照和内部核验依据；证据文件不公开。
- `displayOrder / status`。
- `reviewStatus / publishStatus / reviewedBy / reviewedAt / rejectReason`。
- `contentVersion / contentHash / approvedContentHash / hashAlgorithmVersion`；链接、域名、主体或公开文案变化必须退审。
- `linkCheckStatus / lastLinkCheckedAt / lastLinkCheckError`。
- `validFrom / validUntil / archivedAt / createdAt / updatedAt`。

目录 CTA 统一为“前往官方平台查看 / 扫码打开来源平台”。只有具体岗位来源页才使用“去来源平台投递 / 扫码投递”。没有书面合作关系时禁止“合作平台、认证伙伴、官方合作”等表述。

### 3.6 OfflineAgencyProfile 与 OfflineAgencyBranch

`OfflineAgencyProfile` 是 Organization 的线下服务公开扩展，首期一对一；`OfflineAgencyBranch` 表达一对多门店。

Profile 建议字段：

- `organizationId @unique`、`displayName`、`description`、`serviceScopeJson`。
- `reviewStatus / publishStatus / reviewedBy / reviewedAt / rejectReason`。
- `contentVersion / contentHash / approvedContentHash / hashAlgorithmVersion`。
- `archivedAt / createdAt / updatedAt`。

Branch 建议字段：

- `agencyProfileId`、`branchName`。
- 结构化 `provinceCode / cityCode / districtCode` 与展示地址。
- `lat / lng / geoSource`；距离必须说明定位来源。
- `serviceHours / serviceHoursSource`、`publicPhone / website`。
- `status: active / suspended / closed`、`lastVerifiedAt / archivedAt`。
- `reviewStatus / publishStatus / contentVersion / contentHash / approvedContentHash / hashAlgorithmVersion`；地址、电话、营业时间、网站、坐标或状态变化必须 bump version 并退回 `pending + draft`。

不得新增预约名额、到店报名、简历接收邮箱、候选人联系、代收费或办理结果字段。

### 3.7 canonical Job

所有线上/线下岗位最终只写 `Job`。

新增或收紧：

- `sourceId` 长期必填；所有 manual 录入也必须绑定服务端生成的 manual JobSource。
- 幂等唯一键长期改为 `(sourceId, externalId)`；旧 `(sourceOrgId, externalId)` 在 contract 前保留。
- `externalId` 由来源给出或服务端稳定生成，禁止浏览器 `Date.now + random`。
- `contentHash / contentVersion / approvedContentHash / sourceLastSeenAt / archivedAt`。
- `offlineBranchId?`；为空表示普通来源岗位，非空表示关联线下门店。
- `sourceOrgId` 保留为租户隔离和责任主体快照，并强校验 `JobSource.orgId === sourceOrgId`。

当前正式合规契约强制岗位具有 `sourceUrl`。因此第一实施波只允许 `handoffType=external_source`：

- `sourceUrl` 必须是 HTTPS 且命中来源域名白名单。
- 线下岗位没有可验证官方来源 URL、真实用工企业或结构化城市时，只能进入 blocker 清单，不能发布。
- `offline_information_only` 仅作为未来产品决策候选；在正式修订合规边界并完成法务确认前，不进入 schema 枚举和发布路径。

任何公开字段变化必须令 `reviewStatus=pending`、`publishStatus=draft` 并清空旧审核元数据；只刷新 `sourceLastSeenAt` 且 contentHash 未变时可不重审。

URL 校验在导入/upsert、审核、发布、公开读取和定时巡检各层执行；每次 DNS 解析和每次重定向都拒绝 loopback、RFC1918、link-local、云 metadata 地址及 IPv6 私网，限制重定向次数、连接/总超时和响应体大小，不携带内部 cookie、header 或 credential，并防 DNS rebinding/open redirect。失败一律 fail-closed。

### 3.8 ReviewDecision 与 AuditEvent

最新状态字段只用于快速查询，不能替代不可变决定事实。所有内容审核、发布、下架、归档、资质核验、链接核验、来源审批/信任变更、凭证轮换和批量影响操作必须追加写结构化决定：

- `targetType / targetId / contentVersion / contentHash / action / fromStatus / toStatus`。
- `actorId / actorRole / reason / occurredAt / correlationId / requestId`。
- 批量操作附影响对象数量和不可变清单摘要，不写凭证明文、证照 URL 或个人数据。
- approve 记录 `approvedContentHash`；publish 必须校验 `approvedContentHash === contentHash`，否则拒绝。
- canonical hash 冻结字段集合、null/数组/空白归一化和 `hashAlgorithmVersion`；更新使用版本 CAS，避免并发覆盖已审版本。

## 4. 有效可见性

不能使用一个通用谓词强迫目录和机构绑定 JobSource，必须按对象派生：

```text
directoryVisible = directory.approved + published + notArchived + withinValidity
  + approvedContentHash==contentHash
  + landingUrl/finalDomain/linkCheck valid
  + (linkedOrganization == null || organizationTrust active)

agencyVisible = profile.approved + published + notArchived
  + profile.approvedContentHash==profile.contentHash + organizationTrust active
  + approved/published/currentHash activeBranch exists
  + requiredQualificationsByOrgTypeAndServiceScope valid/currentHash

jobVisible = job.approved + published + approvedContentHash==contentHash
  + notArchived + withinValidity + organizationTrust active
  + source.approval approved + source.trust active
  + sourceUrl/finalDomain matches source.allowedContentDomains

offlineJobVisible = jobVisible + agencyVisible
  + selectedBranch approved/published/currentHash/active
  + qualifications applicable to selectedBranch valid/currentHash
```

影响语义必须对运营人员写清：

- 停账号：禁止登录和新增写入，不自动隐藏内容。
- 停同步：停止新同步，现有内容按有效期继续展示。
- 撤销来源信任：关联内容立即 fail-closed。
- 资质到期、门店暂停：机构目录和关联线下岗位立即 fail-closed。
- 链接失效：目录项或岗位进入治理队列并隐藏，不静默跳转未知域名。

任何批量隐藏都必须先返回影响数量、对象类型和恢复方式，二次确认后执行并写 AuditLog。

## 5. 存量映射规则

### 5.1 OfflineAgency

- `sourceOrgId` 有且能精确匹配 Organization：进入人工确认映射。
- `sourceOrgId` 为空、孤儿或名称近似：不得自动合并或自动创建主体。
- 现有名称、描述、服务范围可映射到 Profile；地址、经纬度、电话和营业时间映射到 Branch。
- 演示机构保持 unpublished/archived 候选，不因迁移自动转真。

### 5.2 OfflineJob → Job

| Legacy 字段                | Job 字段                       | 规则                                                                                            |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `externalId`               | `externalId`                   | 非空且在目标 JobSource 内唯一时优先复用；缺失或冲突时才生成稳定值 `offline-job:<OfflineJob.id>` |
| `id`                       | `canonicalJobId / legacyIdMap` | 只用于迁移幂等、旧深链和审计映射，不冒充来源方 externalId                                       |
| `agencyId`                 | `offlineBranchId`              | 先完成主体、Profile、Branch 映射                                                                |
| `jobType`                  | `category`                     | 已知枚举机械映射，未知值进入 blocker                                                            |
| `salaryMin/Max/Unit`       | 同名字段                       | 可机械映射                                                                                      |
| `description/requirements` | 同名字段                       | 可机械映射                                                                                      |
| `education/experience`     | 对应 requirement               | 可机械映射                                                                                      |
| `location`                 | 展示地址                       | 不能直接猜成结构化 city code                                                                    |
| `externalUrl`              | `sourceUrl`                    | 缺失或非合规域名则阻断                                                                          |
| 无字段                     | `company`                      | 必须人工补真实用工企业；禁止用中介机构名冒充                                                    |
| `status=active`            | 审核发布                       | 不继承；所有迁移 Job 默认 `pending + draft`                                                     |

建议 legacy OfflineJob 增加 `canonicalJobId? @unique` 和迁移 checksum，保证 backfill 幂等和旧深链兼容；不能复用 legacy 主键覆盖现有 Job。

若多个 legacy OfflineAgency 指向同一 Organization，每个旧机构默认先生成独立 Branch；Profile 名称、描述或服务范围冲突进入人工合并清单，禁止按迁移顺序后写覆盖先写。

### 5.3 硬编码线上平台

当前四个平台只能作为人工核验清单，不能由 migration 或 seed 自动创建为 published。必须逐项核实官方域名、目标 URL、品牌展示依据、平台运营主体快照和中性文案；Organization 只在存在已核实主体记录时可选关联。先生成 draft，经 Admin 审核发布后才能替换硬编码页。

## 6. 生产只读盘点门禁

正式实施前另行取得具名只读授权，使用专用只读角色并设置 `statement_timeout`、`lock_timeout`、`idle_in_transaction_session_timeout`；数据库查询在 `BEGIN TRANSACTION READ ONLY` 中完成：

1. 数据库内核对 `current_database/current_schema/transaction_read_only`、PostgreSQL 版本和 `_prisma_migrations`；`DEPLOY_SOURCE`、PM2 COMMIT 作为独立主机只读证据采集，不伪装成事务内查询。
2. Organization 按 `type × enabled`，JobSource 按 `sourceKind × accessMode × enabled` 统计。
3. Job、JobFair、PolicyPost、OfflineAgency、OfflineJob 按审核/发布/运行状态统计。
4. 找出 source/org 不一致、空/孤儿 sourceId、重复 externalId、过期仍发布、非 HTTPS 或越域 URL。
5. OfflineAgency 找出空/孤儿 sourceOrgId、重复名称地址、无结构化地区和无资质证据项。
6. OfflineJob 找出无 employer、无 city、无 sourceUrl、重复 externalId、父机构不可见但自身 active 的项。
7. AuditLog 汇总 create/update/review/publish/unpublish/archive/source/qualification 动作与无原因变更。
8. 用数据库理论可见 ID 集合与公开 API ID 集合做差集，不只比较 total；必须分开报告“严格复刻当前部署 reader 的 `currentReaderIds`”与“冻结目标依赖门禁的 `targetSafeIds`”。前者用于识别分页/部署/接口漂移，后者用于识别当前公开内容的治理泄漏，二者不得混用。尚未冻结版本化可见性模型的 JobFair/PolicyPost 标记 unsupported，尚无公开 reader 的 OnlinePlatformDirectory/OfflineAgencyProfile 标记 endpoint absent，不把不存在的接口伪装成空集合。

只允许输出聚合计数、内部 ID、脱敏域名、违规项分类、查询脚本 SHA-256 和执行时间；不得输出口令、加密凭证、完整联系方式、证照文件 URL、ImportRecord 原始行或用户数据。

## 7. Expand / Backfill / Switch / Contract

### Wave 0：方案与盘点冻结（本轮）

- 完成本方案、公开生产探针和历史生产证据盘点。
- 标记旧 SQLite→PG 搬数脚本完整性缺口。
- 不创建 migration、不写生产、不部署。

### Wave 1：Expand（后续独立 PR，仍不部署）

- 只增加 nullable/additive 表、列、索引和 FK：QualificationRecord、OnlinePlatformDirectory、Profile/Branch、Job/JobSource/Organization 扩展、OfflineJob.canonicalJobId。
- `(sourceId, externalId)` 本波只建普通查询索引并由 preflight 报告重复组；生产重复清洗和 Wave 2 backfill 验收前不得提前收紧 unique。
- SQLite 主 schema 为 SSOT，PG schema 机械生成；分别新增 SQLite/PG migration。
- PostgreSQL FK 可先 `NOT VALID`，backfill 后 `VALIDATE CONSTRAINT`；SQLite 避免在 expand 阶段重建旧表。
- 退役删除 `migrate-sqlite-to-postgres.ts`；未来领域 backfill 另建只读 preflight、dry-run 和守恒对账工具。
- 增加 fresh SQLite、upgrade SQLite、fresh PG，以及二选一的安全升级演练：经授权把完整加密生产备份恢复到同等级访问控制的隔离 PostgreSQL 并在验收后受控销毁，或使用批准的招聘内容域脱敏 fixture；原始 dump 不得复制到普通开发环境。

### Wave 2：Shadow backfill（先备份恢复库演练）

- 新增 `--dry-run`、幂等、分批、带 checksum 的 preflight/backfill 工具。
- 每条 legacy 记录只有三种结果：成功映射、明确 blocker、已归档跳过；计数必须守恒。
- 所有新 Job 为 `pending + draft`，不打印业务正文，不伪造 employer/city/sourceUrl。
- Wave 2 退出硬门禁：`(sourceId, externalId)` 重复组必须为 0；随后用 SQLite/PostgreSQL 独立 additive migration 把普通索引收紧为 `@@unique([sourceId, externalId])`，两库 fresh/upgrade 与并发幂等验证通过后才允许进入 Wave 3。
- 生产执行必须另获写授权；失败只停止 backfill，新表数据保留为不可见，不删 legacy。

### Wave 3：写切换与观察

- 先 shadow dual-write：canonical Job 为不可见影子记录，legacy 仍是既有读取源；双写必须在同一事务中完成，任一侧失败全部回滚。
- 进入本波前必须确认双库 `(sourceId, externalId)` unique migration 已应用且验证通过；普通索引状态禁止开启 dual-write。
- 对账稳定后关闭 OfflineJob writer，改为 canonical-only write；旧表只保留读取和 ID 映射，不再继续双写。
- API/Excel/Webhook/manual upsert 统一使用 `(sourceId, externalId)`。
- 至少观察一个完整审核发布周期并对账旧/新字段、公开集合和审计。

### Wave 4：读切换

- Kiosk 线下岗位从 canonical Job 读取；旧 ID 通过 canonicalJobId 兼容。
- Admin 机构详情的岗位 Tab 只跳转统一内容审核页并带筛选，不保留第二套 JobsDrawer 编辑器。
- Kiosk 线上平台页读取已审核目录；请求失败显示诚实空态，不以硬编码平台静默兜底。
- 在任何真实目录/机构/线下岗位重新发布前，先把现有 Kiosk 的通用平台“去来源平台投递”、线下“合作机构 / 应聘到店办理 / 收费以门店公示”等文案改为正式合规 CTA；旧无 sourceUrl OfflineJob 路径继续 fail-closed。
- 旧表保留，不删除。

### Wave 5：Contract（破坏性独立批次）

- 连续两个发布周期证明不再产生 legacy 读写或 legacy 写审计，且审计查看器不依赖 join legacy 表；历史 AuditLog 永久保留。
- 再收紧 Organization/JobSource/Job/Profile/Branch FK 和 NOT NULL，删除旧唯一键与 legacy 字段。
- 删除旧 OfflineJob API、DTO、UI 写入口后，最后单独评估 drop OfflineJob。
- SQLite 需要 rebuild table 的 contract migration 必须独立发布并在生产快照副本演练。

## 8. Admin / Partner 信息架构

Admin 收敛为四个治理域：

1. 机构与资质：主体、公开资料、门店、资质、关联内容只读筛选、变更审计。
2. 数据接入：数据源、文件导入、同步日志、字段映射、连接测试与凭证轮换。
3. 内容审核：岗位、企业、招聘会统一队列；展示来源原始值、标准化值、版本 diff、域名、有效期和质量告警。
4. 外部入口治理：线上平台目录、失效链接、过期/依赖阻塞、归档记录。

Partner 菜单由服务端 capability 投影，只能维护本机构草稿、获准通道、导入批次和 canonical Job；编辑必重审，可紧急下架本机构内容并审计。Partner 不能核验自身资质、修改 Organization.type/sourceKind、发布目录或内容、打“官方/认证”标签、查看用户明细或接收简历。

## 9. 下一实施波文件预算

Wave 1 建议拆为两个独立 PR，避免模型、迁移工具和页面同时堆叠：

### PR A：迁移安全与模型 expand

- `services/api/prisma/schema.prisma`
- 自动生成 `services/api/prisma/postgres/schema.prisma`
- SQLite / PostgreSQL 各 1 个 additive migration
- 删除 `services/api/scripts/migrate-sqlite-to-postgres.ts` 与 `db:pg:migrate-data` 命令
- `services/api/scripts/verify-recruitment-p1-preflight.ts`（新增）
- `services/api/scripts/verify-recruitment-p1-schema.ts`（新增）
- `services/api/package.json`、`.github/workflows/ci.yml`

不改前端、公开读取和生产配置。

### PR B：共享契约与只读 API 骨架

- `packages/shared/src/types/job.ts`
- 新增招聘目录/机构资质共享类型文件（最多 2 个）
- 新增或扩展 API module/controller/service（按平台目录、机构资质分文件；单文件超过 500 行前先拆）
- 真实 HTTP + Prisma verifier

仍不切 Kiosk/Admin/Partner 页面，不写生产。

## 10. 验收与回滚

必须同时满足：

- SQLite/PG schema parity；两套 fresh migration 与升级 migration 全绿。
- 升级演练二选一且需单独授权：在与生产同等级访问控制的隔离 PostgreSQL 恢复完整加密备份并在演练后受控销毁；或使用只含 schema + 招聘内容域表的批准脱敏 fixture，明确排除 EndUser、FileObject 对象引用、ImportRecord.rawData、AuditLog.payload、凭证和个人联系方式。无 drop、无 seed、无 PG→SQLite。
- 5 种 Organization.type 每项 allow/deny；跨机构统一 404，直调 API 也不可越权。
- 导入与迁移默认 `pending + draft`；未审版本不能发布。
- 停账号、停同步、撤销信任、资质到期、门店暂停分别按本方案语义验证。
- 所有具体岗位具备来源四要素、有效 HTTPS URL、版本和审核记录。
- 无 QualificationRecord 不显示资质徽章；证照访问有审计。
- 已发布或有浏览/外跳历史的对象不能 hard delete，只能归档。
- Partner 响应不得包含用户手机号、简历、AI 报告、个人行为序列；聚合统计低于 N=5 显示样本不足。
- 禁词静态扫描和浏览器断言覆盖目录、线上岗位、线下机构三类 CTA。
- Node 22 下 typecheck、lint、build、SQLite 主门禁、postgres-readiness、Admin/Partner/Kiosk 真实 HTTP 全绿。

回滚原则：additive schema 不做 down migration；应用可切回旧读取，新增数据保持不可见并保留；破坏性 contract 只能从 PostgreSQL 备份恢复到新库，不能把生产切回 SQLite。
