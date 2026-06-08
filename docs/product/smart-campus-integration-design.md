# 智慧校园对接设计规范

> 最后更新：2026-06-08（首版，仅设计不开发；+§十三 账号归属/菜单显隐/数据隔离 实现级判定逻辑）
> 对应规划：[feature-scope.md §6.8](./feature-scope.md) | [next-tasks.md §智慧校园 产品规划](../progress/next-tasks.md)
> 合规前置：[compliance-boundary.md §九 校园 / 学生数据隐私边界](../compliance/compliance-boundary.md)（**硬阻断**）
> 对标文档：[external-data-source-design.md](./external-data-source-design.md)（本规范复用其双维度接入与审核机制）
> 关联代码（复用，非新造）：`packages/shared/src/types/job.ts`（DataSourceConfig / AccessMode / ReviewStatus）、W3 JobSource 凭证加密、T2 BullMQ 拉取 worker、StorageService/COS、宣传屏外部直链

---

## 一、本规范要回答的问题

「智慧校园」四个子功能（迎新系统 / 校园大数据 / 行李帮运 / 校园全景）的数据从哪来、怎么和学校的系统对接、各自落到什么模型、谁负责哪一段、后台在哪里管理。**核心矛盾**：既要让学校能把自己的数据/接口接进来，又**绝不能把学生个人明细落到我们这**。

---

## 二、最高原则（任何对接方式不得违反）

1. **我方是受托处理者，不是数据控制者**：学校是其学生数据的控制者；我方仅按学校授权展示其**已聚合脱敏**的统计，须签数据授权书 + DPA。
2. **只接聚合，不接明细**：对接链路只接收"汇总数字"，**绝不接收单条学生记录**（姓名 / 学号 / 身份证 / 手机号 / 照片 / 班级 / 宿舍）。
3. **模型层物理隔绝**：聚合数据落 `CampusStatistic`（指标/维度/值），表结构**没有任何承载个人明细的字段**——学校即使误传明细也存不进来，是双保险的第二道。
4. **默认待审核**：所有学校提交/拉取的内容默认 `reviewStatus: pending`，管理员审核 `approved` 后才上终端。
5. **免鉴权终端开关端点不含数据**：见 §八。
6. **不碰招聘闭环**：子功能涉及岗位/招聘会仍走"去来源平台"，无投递/收简历/候选人语义。

---

## 三、子功能 → 数据 → 来源 → 对接方式 总览

| 子功能 | 数据内容 | 来源方 | 对接方式 | 目标模型 | 个人信息风险 |
|--------|----------|--------|----------|----------|--------------|
| 迎新系统 | 报到流程、办事窗口、校园地图、官方系统/公众号链接 | 学校（学工/招生处） | 手工录入 / Excel 导入 / 仅外链深跳 | `OrientationContent` + 外链 | 无（仅展示+外链） |
| 校园大数据 | 男女比例、专业/年龄/生源地分布、报到率（**聚合**） | 学校（教务/迎新指挥部）授权 | ①手工填表 ②汇总 Excel ③API 拉取 | `CampusStatistic` | **高**（受 §九 全部红线约束） |
| 行李帮运 | 第三方物流方信息 + 下单小程序/网址 | 第三方物流公司 | 外链 / 扫码配置 | `CampusExternalLink` | 无（第三方入口） |
| 校园全景 | 360 全景图 / 视频 | 学校或全景供应商 | 上传对象存储 / 登记 HTTPS 直链 | `PanoramaScene` | 无（媒体素材） |

> 结论：只有「校园大数据」需要真正的数据/接口对接；其余三者是"内容录入 + 外链/素材"，技术轻，且全部复用既有能力。

---

## 四、目标数据模型

> 以下为设计草案（不写代码）。命名沿用项目既有风格；敏感字段一律不进 `packages/shared`。

### 4.1 `CampusStatistic`（校园大数据聚合指标——最关键）

```typescript
interface CampusStatistic {
  id: string
  orgId: string            // 学校机构 ID（多租户隔离键）
  termCode: string         // 期次/年级，如 "2025级新生"
  metricKey: string        // 指标键：gender_ratio / major_count / age_dist / origin_dist / checkin_rate ...
  dimension: string        // 维度名：性别 / 专业 / 年龄段 / 省份
  dimensionValue: string   // 维度取值：男 / 计算机 / 18 / 山东
  value: number            // 聚合值
  valueType: 'count' | 'percent'
  sampleBelowThreshold: boolean   // 是否因 k-匿名被合并/隐藏
  visibility: 'public' | 'backend_only'  // 见 §八：是否允许在公共终端展示
  reviewStatus: ReviewStatus      // 默认 pending
  sourceId?: string        // 来自哪个数据源（manual/excel/api），null=手工
  syncTime: string
  // 注意：无 studentId / name / idCard / phone 等任何个人字段
}
```

**k-匿名约束（录入与展示双层）**：任一单元格 `value`（count）低于阈值（建议 k≥10，最低不得<5）时，录入层强制合并入"其他"或置 `sampleBelowThreshold=true`；展示层对 `sampleBelowThreshold` 一律显示"<阈值"或不展示。性别×专业×年龄等多维交叉单元格同样套阈值。

### 4.2 `OrientationContent`（迎新内容）

```typescript
interface OrientationContent {
  id: string
  orgId: string
  type: 'flow_step' | 'service_window' | 'map' | 'official_link'
  title: string
  detail?: string          // 说明文字
  location?: string        // 办事窗口位置
  externalUrl?: string     // 官方系统/公众号链接（深跳，不拉数据）
  sortOrder: number
  reviewStatus: ReviewStatus
}
```

### 4.3 `CampusExternalLink`（行李帮运等第三方入口）

```typescript
interface CampusExternalLink {
  id: string
  orgId: string
  category: 'luggage' | 'other'
  providerName: string     // 服务方名称
  sourceUrl: string        // 外链 / 小程序路径
  disclaimer: string       // 免责声明文案（必填）
  reviewStatus: ReviewStatus
}
```

### 4.4 `PanoramaScene`（校园全景）

```typescript
interface PanoramaScene {
  id: string
  orgId: string
  title: string            // 图书馆 / 体育馆 / 宿舍
  mediaType: 'image_360' | 'video_360'
  mediaUrl: string         // 对象存储签名 URL 或 HTTPS 直链
  authorizationNote?: string  // 素材版权/人脸授权说明
  reviewStatus: ReviewStatus
}
```

---

## 五、对接方式：复用现有"双维度"，校园场景的取值

沿用 [external-data-source-design.md](./external-data-source-design.md) 的 `SourceKind × AccessMode`，校园场景下：

| 维度 | 取值 |
|------|------|
| `sourceKind` | `school`（高校，已存在）；行李帮运可记 `aggregator`/`manual` |
| `accessMode` | 校园大数据：`manual` / `excel` / `api`；迎新：`manual` / `excel`；行李/全景：`manual`（外链/素材登记） |

**关键差异（与岗位数据源不同，必须注意）**：
- 岗位/招聘会标准化为 `ExternalJob/JobFair`（逐条记录 + `FieldMappingRule` 逐行映射）。
- **校园大数据是少量聚合指标（几十个数字），不要复用 Job 的逐条字段映射引擎**——单独做"指标级"映射（外部指标名→`metricKey`），从语义上和数据流上都物理隔绝"逐条学生记录"。

---

## 六、校园大数据的三档对接（按学校能力渐进）

| 档 | 适用 | 学校怎么给 | 我们怎么收 | 推荐 |
|---|---|---|---|---|
| **① 手工填表** | 绝大多数学校 | 在 partner 后台逐项填指标 | 表单校验 + k-匿名 → `CampusStatistic(pending)` | ⭐ MVP 首选，最安全 |
| **② 汇总 Excel** | 有数据无接口 | 上传**已汇总**的 Excel（一行一指标，非一行一学生） | 指标级解析 → k-匿名 → 落库；导入批次沿用 `ImportBatch` 但 record 是指标行 | ⭐ 次选 |
| **③ API 拉取** | 少数有教务/迎新系统且 IT 配合 | 暴露**只返回聚合数字**的 HTTPS 接口 | `DataSourceConfig`(accessMode=api) + 凭证加密 + BullMQ worker 周期拉 | ◐ 可选升级，不强求 |

> 落地顺序强约束：先上①②，③只对有能力的学校做。**不要预先把工程压在 API 对接上**——多数学校给不出聚合接口。

### 6.1 ③ API 拉取的数据流（复用 W3 + T2 已验证机制）

```
学校聚合接口(HTTPS, 只吐聚合)
   │  Bearer / api_key 鉴权
   ▼
DataSourceConfig(accessMode=api, orgId=学校)   ← 凭证 AES-256-GCM 加密只存服务端
   ▼
BullMQ 拉取 worker(周期 claim)                  ← 复用 T2 JobSync worker 范式
   ▼
指标级字段映射(外部指标名 → metricKey/dimension)
   ▼
k-匿名校验(小样本合并/隐藏)
   ▼
CampusStatistic(reviewStatus: pending)
   ▼
管理员审核 approved
   ▼
按 visibility 走【公共终端只读端点】或【仅后台展示】（见 §八）
```

接口契约（写进对接文档/合同）：**接口只返回聚合数字，不返回学生名单**。即使误传明细，`CampusStatistic` 也接不住（无对应字段）——双保险。

---

## 七、对接责任划分（你跟学校谈对接时按这个讲）

| 事项 | 学校 IT / 学校 | 我方（平台） |
|------|----------------|--------------|
| 数据授权书 + DPA 签署 | ✅ 提供授权、明确范围 | ✅ 拟定、约定删除义务 |
| 聚合数据/接口 | ✅ 出聚合接口 或 提供汇总 Excel / 手工填 | — |
| 保证不含个人明细 | ✅ 合同义务 | ✅ 模型物理隔绝兜底 |
| 凭证安全 | 提供 api_key/token | ✅ 服务端加密存储、不回显 |
| 拉取/解析/映射 | — | ✅ worker + 指标映射 |
| k-匿名脱敏阈值 | 共同确认 k 值 | ✅ 录入与展示双层强制 |
| 内容审核 | 提交内容 | ✅ admin 审核后才上终端 |
| 终端归属/开关 | 提需求 | ✅ 运营配置（Phase 1）/ 学校自助（Phase 2） |
| 终端使用统计回传 | — | ✅ 生成浏览/点击/唤醒统计给学校 |
| 全景/行李素材与外链 | 提供素材/服务方信息 | ✅ 审核、存储、展示 |

---

## 八、终端展示边界（公共一体机 vs 后台）—— 重要设计决策

校园大数据原始诉求是"在校内屏给新生/家长看"。但公共一体机是无登录、任何人可触摸的终端，敏感聚合直接公开有风险。**两类端点必须分离**：

1. **开关端点（免鉴权）** `GET /terminals/:terminalId/smart-campus`：只返回 `{ enabled, modules 开关位, 已审核外链元数据 }`，**绝不含任何统计 value**（写自动化测试断言）。
2. **数据端点**：校园大数据数字单独走。

对校园大数据的展示，按 `visibility` 分流（设计决策，建议如下）：

| visibility | 含义 | 端点 | 适用数据 |
|------------|------|------|----------|
| `public` | 可在公共终端展示 | 独立**只读**端点，只回 `approved` + k-匿名达标 + `visibility=public` 的聚合，限流 | 学校**已授权对外公开**的宣传性聚合（招生简章级，如"男女比例、专业规模"） |
| `backend_only` | 仅后台展示 | partner / admin 后台鉴权端点 | 更敏感的多维交叉、内部运营报表 |

> 推荐默认：公共终端只展示学校明确授权对外公开的宣传性聚合；敏感多维交叉只在后台给学校领导/运营看（作为"迎新成果看板"）。**这条需在 §九 落条款并在合同里与学校确认每个指标的 visibility。**

---

## 九、后台功能区设计

### 9.1 partner 后台（学校登录，按 `orgId` 隔离）——新增「智慧校园」模块

| 子区 | 能力 |
|------|------|
| 终端开关 | 开/关本校机器的智慧校园及各子功能（Phase 1 运营代配，Phase 2 放给学校自助） |
| 迎新内容管理 | `OrientationContent` 流程/窗口/地图/外链 CRUD |
| 校园大数据录入 | 手工填表 / 汇总 Excel 上传 / 配置 API 数据源；指标 + 维度 + 值 + visibility；同步日志 |
| 行李/全景管理 | `CampusExternalLink` / `PanoramaScene` 维护 |
| 使用统计 | 本校终端上各功能的浏览/点击/唤醒（我方生成回传） |

### 9.2 admin 后台（你方运营）——监管侧

| 子区 | 能力 |
|------|------|
| 内容审核 | 学校提交内容默认 pending，审核 approved 才上终端 |
| 终端归属 | `Terminal.orgId` 指派哪台机器归哪所学校；批量回填 |
| 凭证与数据源 | API 数据源凭证管理、同步日志、手动触发 |
| k-匿名阈值 | 平台级兜底阈值配置 |
| 审计 | 开关变更、归属变更、数据源接入/更新全部落 AuditLog |

> 端架构（重申，与既有规划一致）：**不新建独立学校端 app；不给学校开 admin 子账号**（admin 全局视角、菜单隐藏≠数据隔离）。学校走 partner 后台 + `Organization.type='school_employment_center'`，service 层强制 `where terminal.orgId = user.orgId`。
>
> 👉 账号归属 / 菜单显隐 / 数据隔离的**实现级判定逻辑**（给 Codex/开发照做）见 **§十三**。

---

## 十、两种"统计"必须分清

| 统计 | 关于谁 | 方向 | 端点/位置 | 价值 |
|------|--------|------|-----------|------|
| 校园大数据 | 学生 | 学校**提供给**我们展示 | `public` 只读端点 / 后台 | 招生宣传、政绩载体（合规敏感） |
| 终端使用统计 | 终端使用情况（浏览/点击/唤醒） | 我方**生成回给**学校 | partner 后台 | 让学校看到机器有用、促续约（合规安全） |

> 别漏了"终端使用统计"——它是让学校觉得值得续约的抓手，且零合规风险。

---

## 十一、落地优先级（接到 [next-tasks.md](../progress/next-tasks.md) 的 Phase）

| 优先级 | 交付项 | 对应 Phase | 状态 |
|--------|--------|-----------|------|
| P0 | compliance §九 合入 + 本设计文档 | Phase 0 | ✅ 本次落地 |
| P1 | `OrientationContent` 手工录入 + 迎新只读展示 | Phase 1 | 待开发（按订单触发） |
| P1 | 终端开关（免鉴权端点白名单）+ admin 代配置 | Phase 1 | 待开发 |
| P1 | `CampusExternalLink` / `PanoramaScene` 外链与素材 | Phase 2 | 待开发 |
| P1 | partner 后台智慧校园模块 + 使用统计回传 | Phase 2 | 待开发 |
| P2 | `CampusStatistic` + ①手工 ②Excel 录入 + k-匿名 + public 只读端点 | Phase 3 | 门控（需授权书+DPA） |
| P2 | ③ API 拉取（复用 DataSourceConfig + BullMQ worker） | Phase 3 | 门控、仅有能力学校 |

---

## 十二、对接前必须确认的事项（给学校谈对接时核对）

- [ ] 学校能否签数据授权书 + DPA（拿不到则校园大数据一律不做）
- [ ] 校园大数据由谁提供：手工 / Excel / API？学校 IT 能否出"只吐聚合"的接口？
- [ ] 每个指标的 `visibility`（公共终端可展示 vs 仅后台）由学校逐项确认
- [ ] k-匿名阈值 k 值（建议≥10）学校与法务确认
- [ ] 行李帮运第三方物流方是否确定、是否正规资质、是否纯外链（涉资金需另做支付合规评审）
- [ ] 全景素材版权与人脸授权是否清晰
- [ ] 终端归属与开关由谁操作（运营代配 vs 学校自助）

---

## 十三、账号归属 / 菜单显隐 / 数据隔离（给实现者 / Codex 的判定逻辑）

> 本节是实现规约，目的是让开发照做不踩坑。**最重要的一条原则：前端隐藏菜单只是 UX，真正的安全边界永远在后端 guard + service 层。** 任何"学校只能看自己数据"的保证，必须由后端强制，不能依赖前端。

### 13.1 涉及的现有模型（不新造，复用）

```
User          { id, role: 'admin'|'partner'|'kiosk', orgId?, ... }   // packages/shared/src/types/user.ts
Organization  { id, type, ... }   // type 已含 'school_employment_center'
Terminal      { id, terminalCode, ... }   // ⚠️ 需新增 orgId（见 §九 / next-tasks Phase 1）
```

JWT payload 已带 `{ sub, role, orgId }`；`RolesGuard` **只校验 role 集合、不做机构隔离**（见 `common/guards/roles.guard.ts`）——所以机构归属必须在 service 层手写。

### 13.2 三层判定（缺一不可）

| 层 | 判定 | 作用 | 在哪实现 |
|----|------|------|----------|
| 第一层：在哪个端 | `role` | 决定登录后进哪个后台 | 登录路由 / 各 app |
| 第二层：看不看得到「智慧校园」 | partner 且 `org.type==='school_employment_center'`（增强：org 被授予 smart_campus 模块） | 菜单/路由显隐（**仅 UX**） | partner 前端 |
| 第三层：能看/改哪些数据 | `terminal.orgId === user.orgId`（admin 例外，全放行） | **真正的安全边界** | services/api service 层 |

### 13.3 判定流程

```
登录请求
  → JwtAuthGuard 校验 JWT → 取 role
     ├─ kiosk   → 一体机前台（无后台；智慧校园展示走免鉴权读端点，见 §八）
     ├─ admin   → 管理员后台：看全部、可代配开关、审核/终端归属/审计
     └─ partner → 合作机构后台
            → 读 org.type
               ├─ school_employment_center → 显示「智慧校园」菜单
               │      → 所有读写 service 层强制 where orgId = user.orgId（只见/只改本校）
               └─ 其它(hr_company / fair_organizer / aggregator ...) → 无「智慧校园」菜单
```

### 13.4 前端：菜单显隐（partner app）

```ts
// 仅 UX：决定侧边栏是否出现「智慧校园」。不承担安全职责。
function canSeeSmartCampus(org: OrgView): boolean {
  // MVP：按机构类型
  return org.type === 'school_employment_center'
  // 增强（推荐）：改为能力开关，平台可单独授予/收回
  // return org.enabledModules?.includes('smart_campus') ?? false
}
```

### 13.5 后端：写端点的强制校验（关键，照抄 jobs.service 范式）

```ts
// 例：学校在 partner 后台保存某终端的智慧校园开关
// 路由：PUT /partner/smart-campus/terminals/:terminalId/config
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'partner')        // 角色门：admin 或 partner 才进得来
async saveTerminalSmartCampusConfig(user: AuthedUser, terminalId: string, input: ...) {
  if (user.role === 'partner') {
    // ① partner 必须是「学校」机构
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || org.type !== 'school_employment_center') throw new ForbiddenException()
    // ② 该终端必须归属本校（防 A 校用 path 里的 terminalId 改 B 校）
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId } })
    if (!terminal || terminal.orgId !== user.orgId) throw new ForbiddenException()
  }
  // admin 角色：平台运营，全放行（Phase 1 由 admin 代配置）
  // ③ 落库 + 写审计 writeAudit('smart_campus_config.update', { terminalId, before, after })
}
```

读列表同理：partner 一律 `where: { orgId: user.orgId }`，绝不读 path/body 里传入的 orgId。

### 13.6 Kiosk 免鉴权读端点（不在权限体系内，但边界同样硬）

```ts
// GET /terminals/:terminalId/smart-campus  —— 无 JwtAuthGuard
// 只返回开关与已审核外链元数据；绝不含任何学生统计 value（见 §八）
// 返回体白名单：{ enabled, modules: {welcome, bigdata, luggage, panorama}, links: [...] }
```

### 13.7 给实现者的 Do / Don't

**Do**
- ✅ 菜单显隐用 `org.type`（或能力开关）；后端写/读端点**独立**再做 `org.type` + `terminal.orgId===user.orgId` 双重校验。
- ✅ partner 所有查询强制注入 `where orgId = user.orgId`，orgId 取自 JWT，不信任前端传参。
- ✅ 越权（非学校 partner、跨校 terminalId）一律 `403 ForbiddenException`，并写审计。
- ✅ 写回归测试：A 校 token 配 B 校终端 → 403；非学校 partner 调智慧校园端点 → 403；免鉴权端点返回体断言不含统计 value。

**Don't**
- ❌ 不要只靠前端隐藏菜单当安全（接口仍可被直接调用）。
- ❌ 不要给学校发 `admin` 账号 / 不要在 admin 端点放开 partner 角色去读全量。
- ❌ 不要从 path/body 读 orgId 决定数据范围（只认 JWT 的 orgId）。
- ❌ 不要在 `RolesGuard` 里塞机构逻辑（它只管 role；机构隔离在 service 层）。
- ❌ 不要把校园大数据统计 value 放进免鉴权端点。
