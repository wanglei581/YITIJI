# 招聘闭环能力分期设计（许可证闸门驱动）

> 创建：2026-09-02
> 定性：产品负责人已确认「招聘闭环是必要能力，取得人力资源服务许可证后启用」。
> 本文档解决的问题是：**如何让今天的开发在拿证后不必推倒重来，同时不在无证期形成任何可用的招聘闭环。**
> 关联：[CLAUDE.md](../../CLAUDE.md) §2 §8.1 §16 | [compliance-boundary.md](../compliance/compliance-boundary.md) §2 §4.4 §4.5 §8.1 | [feature-scope.md](feature-scope.md) | [role-boundary.md](role-boundary.md) §1
>
> 本文档不是需求变更，不解除任何现行红线。**在第 8 节的待批项逐条签字前，第 2 节以外的内容一律不得进入实现。**

---

## 1. 术语先分清（分歧根源）

「投递闭环」在讨论中被当成一个词，实际是性质完全不同的五种形态：

| | 形态 | 是否需要人力资源服务许可证 | 现状 | 本方案裁定 |
|---|---|---|---|---|
| A | 平台内投递：我方收简历 → 转交企业 | **需要**（职业中介 / 网络招聘服务） | 无 | 拿证后启用，见 §4 §5 |
| B | 代投：我方用自动化替用户在第三方平台投递 | 需要，且叠加第三方服务条款与反爬风险 | 无 | **永久不做**，见 §7 |
| C | 代发邮件：我方把简历发到企业 HR 邮箱 | 需要（实质是提供投递通道） | 无 | 归入 A，不单独开口子 |
| D | 投递跟踪：用户在第三方投完后回本系统登记进度 | 不需要（我方不接触企业侧） | 小程序有本地版，Kiosk / 后端无 | **本期做**，见 §3 |
| E | 投递辅助：岗位定制简历 + 深链 / 扫码跳转 + 跳转记录 | 不需要 | 已有，断在跳出那一刻 | 本期随 D 补齐 |

法规依据（条款适用以法务及当地人社部门口径为准，本节只记事实）：

- 《人力资源市场暂行条例》（国务院令第 700 号）：从事职业中介活动须取得人力资源服务许可证；其他人力资源服务须备案。
- 《网络招聘服务管理规定》（人社部令第 44 号）：从事网络招聘服务的经营性人力资源服务机构应当依法取得人力资源服务许可证，并承担用人单位主体核验、招聘信息审查、服务日志留存、投诉举报处理、个人信息保护等义务。
- 《个人信息保护法》第二十三条：向第三方提供个人信息须取得**单独同意**，并告知接收方名称、联系方式、处理目的与信息种类。
- 五部门《关于规范网络平台招聘类信息发布的通知》（2026-01）：已在 [compliance-boundary.md §4.3A](../compliance/compliance-boundary.md) 逐条登记。

---

## 2. 拿证后需要重新开发吗：组件级复用矩阵

结论：**11 个组件中 8 个已存在且无需重写，2 个必须新写（约占整套工程量 1/4），1 个是本期要做的、其建模方式直接决定复用率。**

| # | 组件 | 现状（代码取证） | 拿证后动作 |
|---|---|---|---|
| 1 | 求职者身份 / 登录 / 同意快照 | `EndUser`、`MemberLegalConsent`（版本快照，只追加）、`UserAiConsent`（`scope` + `consentVersion` + `revokedAt`） | 新增一个 consent scope，不重写 |
| 2 | 简历存储 / 版本 / 临时签名 URL / 到期清理 | `FileObject` 全套 + `SIGNED_URL_PURPOSES` + 清理策略 | 不重写 |
| 3 | 岗位数据 + 审核发布状态机 | `Job`（来源四要素必填）+ `reviewStatus` / `publishStatus` + `content-trust` 发布闸门 | 不重写 |
| 4 | 岗位真实性 / 歧视性表述筛查 | `job-content-screening.ts`、`JobQualityService`（`ready/partial/insufficient`）、`job-validity.ts` | 按 44 号令补规则并接上发布闸门，不重写 |
| 5 | **投递记录 + 进度** | **缺**。仅 `apps/miniapp/pages/job-tracker/`（197 行，`wx.getStorageSync` 本地，不回传） | **本期新建，建法见 §3** |
| 6 | 用人单位主体核验 | `QualificationRecord`（`licenseNumber` / `validFrom` / `validUntil` / `status` / `evidenceFile` / `verifiedBy` / 审计）+ `content-trust` 判据。当前服务于线下机构 | 扩 `qualificationType` 覆盖用人单位，不重写 |
| 7 | 审计日志 | `AuditLog`，公示保留期 ≥180 天 | 不重写；按 44 号令确认服务日志留存年限后调整策略 |
| 8 | 投诉举报处理 | `FeedbackTicket` / `FeedbackReply`（分类、状态机、幂等去重、匿名与会员双通道） | 新增 category，不重写 |
| 9 | 个人信息导出 / 删除 | `UserDataRequest`（worker、幂等键、导出过期、执行版本号） | 不重写 |
| 10 | **投递路由：简历 → 企业收件** | 无 | **必须新写** |
| 11 | **企业侧账号 / 收件箱 / 通知** | 无。`Organization.type` 只有来源 / 合作机构，`User` 只有 admin / partner | **必须新写**，可复用 Partner 后台的鉴权、审计、列表框架 |

**因此「拿证后是否要重新开发」的准确回答是：#10 #11 躲不掉，其余不用重开——前提是 #5 按 §3 的建法二落地。**

---

## 3. 核心设计决策：`JobApplication` 的前向兼容建模

### 3.1 两种建法

**建法一（手账，否决）**：`{ company: String, position: String, status, note }`，公司名岗位名全由用户手打。与 `Job` 无关联、无渠道概念、无企业侧对端。拿证后接 A，必须新建表，旧数据迁移或废弃。

**建法二（投递记录，采纳）**：

```text
JobApplication
  id
  endUserId        本人维度唯一过滤键（沿用 member-favorites 的越权防线写法）
  channel          'external_self_reported'   ← 无证期唯一合法取值
                   'platform'                 ← 拿证后新增
  jobId?           关联本站已审核已发布岗位；用户手填时为 null
  companyName      快照。jobId 非空时由服务端从 Job 派生，禁止前端传入
  positionTitle    同上
  sourceName?      快照，同上
  status           intention | applied | interviewing | offered | rejected | closed
  statusSource     'self_reported'            ← 无证期唯一合法取值
                   'employer_feedback'        ← 拿证后新增
  note?            用户自填备注
  resumeFileId?    无证期恒 null，由门禁断言
  consentId?       无证期恒 null，拿证后指向 PIPL §23 单独同意记录
  selfReportedAt?       用户自填
  createdAt / updatedAt / expiresAt
```

### 3.2 无证期的硬约束（必须由门禁断言，不能靠约定）

1. `channel` 的运行时白名单**只含** `'external_self_reported'`，其他取值一律 400；白名单来源是 §4 的能力闸门，不是常量数组。
2. `statusSource` 同理，只含 `'self_reported'`。
3. `resumeFileId`、`consentId` 无任何写入路径，DTO 白名单直接拒绝（沿用 `companies/dto/company.dto.ts` 的「超白名单字段 400」写法）。
4. 服务端只接受用户自填状态，**不存在任何从第三方回流状态的入口**——这是 D 与 A 的分界线。
5. 所有快照字段（公司、岗位、来源）在 `jobId` 非空时由服务端从**已审核已发布**的 `Job` 派生，前端不得伪造（沿用 `member-favorites.service.ts` 的 `resolvePublishedTitle`）。

### 3.3 为什么"预留空槽位"不等于"写好了关开关"

| | 空槽位（本方案） | 通电线路加开关（否决） |
|---|---|---|
| 业务链路 | 不存在 | 完整存在 |
| 写入路径 | 无 | 有，只是被 if 挡住 |
| 对端 | 无（企业侧不存在） | 有 |
| 门禁 | 断言字段恒 null | 需要为禁词与断言开豁免 |
| 尽调 / 现场核查观感 | 一个空列 | 一条可用的收简历通道 |

仓库内已有直接教训：[`services/api/src/common/content-trust.ts`](../../services/api/src/common/content-trust.ts) 文件头记录的事故是——`Organization.contentTrustStatus` 等 5 列早已建好，但「闸门根本没装在门上，靠的是人不点那个按钮」，导致裁定为「未授权不进入生产」的机构内容仍被推上生产公网。**结论：字段可以先建，闸门必须装在门上。**

---

## 4. 资质闸门（不是开关）

### 4.1 判据

沿用 `content-trust` 的 fail-closed 范式，**未知即拒绝**：

```text
招聘闭环能力可用  ⟺  存在一条 PlatformQualification 满足
                     qualificationType === 'hr_service_license'
                  && status === 'approved'
                  && validFrom <= now < validUntil
                  && archivedAt == null
```

`null`、`pending`、`rejected`、已过期、记录不存在——一律拒绝。

**为什么新建 `PlatformQualification` 而不复用 `QualificationRecord`**：
后者的 `organizationId` 是指向 `Organization` 的**必填** FK，而 `Organization` 在本系统里的语义是
「来源机构 / 合作机构」（种子数据为 `org-uni-001` 高校、`org-hr-002` 人力资源公司），平台自身**不是**其中一行。
为复用而插入一条代表平台自身的 `Organization`，会让它进入以机构为维度的所有列表、统计、审核与发布路径，
需要在每一处单独排除——这正是 `content-trust.ts` 记录的那类事故的成因。
因此平台自身资质独立成表，字段形状照抄 `QualificationRecord`
（`licenseNumber` / `issuerName` / `validFrom` / `validUntil` / `status` / `evidenceFileId` /
`verifiedBy` / `verifiedAt` / `archivedAt`），审计与证据文件访问沿用同一套写法。

### 4.2 硬性设计约束

1. **无 env 后门**。不接受 `process.env.*` 作为判据的任何一部分；门禁需断言全仓无该形式的旁路。
2. **不是 admin 可点的 boolean**。判据来自资质记录本身，管理员能做的是"上传并核验一份真实许可证"，不是"打开一个开关"。
3. **双人复核 + 审计**。资质记录的 approve 走 `AuditLog`，与现有 `recruitment.qualification_evidence_access` 同口径。
4. **到期自动失效**。`validUntil` 过期即判据不成立，无需人工操作，也不允许人工延期覆盖。
5. **闸门装在门上**。判据必须在**每一条**写入路径的入口处求值（`channel='platform'` 的创建、简历路由、企业侧收件），不得只在 UI 层或列表页判断。

### 4.3 本期交付范围

本期只交付判据函数 + 资质记录扩展 + 门禁，**后面不接任何业务代码**。闸门打开后系统行为不发生任何变化。这一刀的价值是把"将来怎么开"钉死在一处，防止后续有人在某个 controller 里加一行 env 绕过去。

---

## 5. 拿证后的义务 → 工程项映射

拿证是入场券，不是终点线。启用 A 之前必须逐项交付：

| 义务（法规） | 工程项 | 复用基础 |
|---|---|---|
| 用人单位主体核验（营业执照、招聘简章） | 企业入驻 + 资质核验流 | `QualificationRecord` + `content-trust` |
| 招聘信息真实性审查 | 发布闸门接 `JobQualityService`（当前 `publishJobSource` 完全不读它，见 compliance §4.3B） | 已有算法，缺接线 |
| 向第三方提供个人信息须单独同意 | 投递前单独同意弹窗 + 同意快照 + 可撤回 | `UserAiConsent`（`scope`/`consentVersion`/`revokedAt`） |
| 告知接收方名称、联系方式、处理目的、信息种类 | 同意弹窗内容 + 企业主体信息展示 | 新写文案，数据来自 #6 |
| 服务日志留存 | 留存策略与年限（**年限待法务确认**；《网络安全法》第二十一条另有网络日志不少于六个月的要求） | `AuditLog` |
| 投诉举报机制 | 招聘类工单分类 + 处理时限 | `FeedbackTicket` / `FeedbackReply` |
| 个人信息删除 / 导出权 | 投递记录纳入导出与删除范围 | `UserDataRequest` |
| 简历访问最小化 | 企业侧只能看被投递岗位对应的那份简历，签名 URL + TTL + 访问日志 | `FileObject` + `SIGNED_URL_PURPOSES` |

同时需要一次性切换的**现有防线**（这就是为什么"顺手留个开关"成本不低）：

- `packages/shared/src/types/complianceCopy.ts`：7 条禁词、7 条对外公示横幅（`KIOSK_CAMPUS_TOP`、`ADMIN_JOB_SOURCES_TOP`、`PARTNER_DASHBOARD_TOP` 明文写「不代收求职者简历」「未取得人力资源服务许可证」）
- `scripts/verify-compliance-copy.mjs` + `services/api/scripts/` 内 18 个硬编码禁词的 verify
- `services/api/src/member-favorites/member-favorites.service.ts`、`packages/shared/src/types/memberFavorites.ts` 的「绝不记录投递状态」注释与断言
- `services/api/src/companies/dto/company.dto.ts` 的超白名单字段 400
- 文档：`CLAUDE.md` §2、`compliance-boundary.md` §2 §4.4 §4.5 §8.1、`role-boundary.md` §1、`feature-scope.md`

**这些改动必须与资质记录生效同批次、同 PR、经法务复核后执行，不允许提前铺垫。**

---

## 6. 分期计划

### 第 1 刀：资质闸门 + 本设计文档 —— **已交付（2026-09-02）**

- 范围：`PlatformQualification` 模型（理由见 §4.1）+ `services/api/src/common/recruitment-capability.ts` 判据模块（仿 `content-trust.ts`）+ `verify:recruitment-capability-gate` 门禁，双 CI job 已接线。
- 未新增入口、页面、端点或任何前端改动；闸门当前**零调用点**，由门禁断言。
- 实际改动：schema 2 处 + 迁移 2 份（SQLite / PostgreSQL）+ 判据模块 1 + 门禁脚本 1 + `package.json` 与 `ci.yml` 接线 + 本文档 + 进度记录。
- 验证结果：`verify:recruitment-capability-gate` **63 PASS / 0 FAIL**；`typecheck` / `lint` 退出 0；`verify:repository-integrity` 与 `verify:ci-gate-coverage` 通过；两套迁移各自对空库 `migrate deploy` 成功，`migrate diff` 均报 **No difference detected**。
- 未迁移生产数据库，未部署。

### 第 2 刀：`JobApplication`（D + E，需 §8 待批项 1 先签字）

- 范围：后端模型 + 本人维度 CRUD + Kiosk「我的求职进度」页 + 岗位详情页「记录一次投递」入口；`ExternalJumpLog` 的 `external_apply` 与本表建立可选关联。
- 文案：全程不出现「投递简历」等禁词；用「我的求职进度」「记录一次投递」——主语是用户不是平台。
- 文件预算：API 约 5 文件、Kiosk 约 3 文件、shared 1 类型、1 门禁（`verify:job-application-track`，断言 §3.2 五条约束）。
- 验证：`verify:compliance-copy`、新门禁、typecheck / lint / `kiosk-browser-smoke`。
- **排期**：属新增功能。当前处于上线前收口（生产内容未进、真机未验收），按 CLAUDE.md §16 不应插队，建议排在 F1 上线之后 —— **§8 第 4 项仍待确认**。

### 第 3 刀：小程序对齐（第 2 刀之后）

- 本地 `wx.getStorageSync` 改为后端同步，与 Kiosk 同一份数据。
- 走小程序专用 worktree + 契约门禁，不在主 checkout 动。

### 第 4 刀：形态 A（**取得许可证之后才启动**）

- 前置：许可证到手并录入资质记录 + §5 义务清单逐项交付 + 法务复核通过 + 至少一个真实企业客户愿意作为收件方。
- 内容：#10 投递路由 + #11 企业侧账号与收件箱。
- 三条不变量：`JobApplication` 表结构不变（只加 channel 取值）、历史记录继续有效、无数据迁移。

---

## 7. 即使取得许可证也不做的（永久边界）

许可证解锁的是「平台内投递」与「收简历转交」。以下几项与许可证无关，属产品定位选择，**拿证后同样不做**：

- 形态 B（自动化代投）：叠加第三方服务条款与反爬风险，且无法对投递内容负责。
- 企业端候选人筛选、面试邀约、Offer 管理：这是 ATS / 招聘 SaaS，属另一个产品，不在「AI 求职打印服务终端」定位内。
- 主动向企业推荐候选人。
- 把用户简历用于本人发起的投递之外的任何用途（包括训练、画像、转售）。

`CLAUDE.md` §2 的八条禁令据此分为两类，后续修订该节时必须保留这个区分：**许可证解锁类**（平台内一键投递、收简历转交、企业发岗直收简历、自营招聘闭环）与**永久边界类**（候选人筛选、面试邀约、Offer 管理、主动推荐候选人）。

---

## 8. 待产品负责人签字的事项

| # | 事项 | 影响 | 状态 |
|---|---|---|---|
| 1 | ~~`compliance-boundary.md` §4.4 修订~~ | 2026-09-02 获具名授权，已落为 §4.4A（含六条硬边界），并同步 `CLAUDE.md` §10 / `AGENTS.md` / `feature-scope.md` §2.7.1 / `user-data-flow-matrix.md` / `next-tasks.md` | **已签字，第 2 刀阻塞解除** |
| 2 | 招聘闭环长期定性：拿证后启用（形态 A） | 已口头确认，需落入 `CLAUDE.md` §2 与 `compliance-boundary.md` §2 的措辞修订 | **已确认，待落文** |
| 3 | ~~第 1 刀是否现在执行~~ | 已执行并通过验证（2026-09-02） | **已完成** |
| 4 | 第 2 刀排期：F1 上线前 or 上线后 | 建议上线后 | **待确认** |
| 5 | §7 永久边界清单是否认可 | 决定 `CLAUDE.md` §2 如何重写 | **待确认** |
