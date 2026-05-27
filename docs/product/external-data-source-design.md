# 外部数据源接入设计规范

> 最后更新：2026-05-25  
> 对应代码：`packages/shared/src/types/job.ts`  
> 关联文档：[CLAUDE.md §18](../../CLAUDE.md) | [feature-scope.md](./feature-scope.md)

---

## 一、合规边界（最高优先级，任何接入方式均不得违反）

本系统**只做信息入口**，不做招聘闭环。所有外部数据源接入必须遵守：

| 允许 | 禁止 |
|------|------|
| 接入岗位/招聘会公开或授权的展示信息 | 接收求职者简历 |
| 展示来源机构、同步时间、外部链接 | 同步候选人数据 |
| 提供"去来源平台投递/预约"扫码跳转 | 平台内一键投递 |
| 记录浏览、跳转、打印次数 | 企业端候选人筛选 |
| — | 面试邀约、Offer 管理 |

**所有导入数据默认 `reviewStatus: pending`，管理员审核通过（`approved`）后才能对外展示。**

---

## 二、核心数据模型

统一标准模型，所有数据源接入后适配到：

```
ExternalJob / ExternalJobFair
```

两个模型均继承 `ExternalJobSource`，强制包含来源溯源字段：

```typescript
interface ExternalJobSource {
  sourceOrgId: string    // 来源机构 ID
  externalId: string     // 外部平台唯一 ID（用于去重）
  sourceName: string     // 来源名称，展示用
  sourceUrl: string      // 原文链接（投递/预约跳转目标）
  syncTime: string       // 同步时间
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
}
```

---

## 三、状态定义

### 审核状态 `ReviewStatus`

```
pending → reviewing → approved
                   ↘ rejected
```

| 值 | 含义 |
|----|------|
| `pending` | 刚导入，等待审核（默认值） |
| `reviewing` | 管理员正在审核 |
| `approved` | 审核通过，可发布 |
| `rejected` | 审核拒绝，不展示 |

### 发布状态 `PublishStatus`

| 值 | 含义 |
|----|------|
| `draft` | 草稿，审核通过但未手动发布 |
| `published` | 已发布，前台可见 |
| `unpublished` | 已下架 |
| `expired` | 过期自动下线（如招聘会已结束超过 N 天） |

---

## 四、数据源分类（双维度）

不再使用扁平的 `DataSourceType`，改为两个独立维度：

### `SourceKind` — 来源种类（是谁提供数据）

| 值 | 说明 |
|----|------|
| `job_platform` | 招聘平台（智联招聘、前程无忧、Boss 直聘等） |
| `hr_company` | 人力资源公司 |
| `school` | 高校就业系统 |
| `fair_organizer` | 招聘会主办方 |
| `aggregator` | 第三方数据聚合平台 |
| `manual` | 后台手动录入 |

### `AccessMode` — 接入方式（用什么方式拉取数据）

| 值 | 说明 |
|----|------|
| `api` | REST / GraphQL API 接入 |
| `excel` | Excel 文件导入（.xlsx） |
| `csv` | CSV 文件导入 |
| `json` | JSON 文件导入 |
| `webhook` | 第三方主动推送 |
| `manual` | 后台手动录入 |

典型组合示例：

| 场景 | sourceKind | accessMode |
|------|------------|------------|
| 智联招聘官方 API | `job_platform` | `api` |
| 高校就业系统 Excel | `school` | `excel` |
| 招聘会主办方 Webhook | `fair_organizer` | `webhook` |
| 管理员手动录入 | `manual` | `manual` |

---

## 五、数据源配置类型

```typescript
interface DataSourceConfig {
  id: string
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
  orgId: string           // 关联 partner 机构 ID
  enabled: boolean
  syncEnabled: boolean
  access: DataSourceAccess
  sync: DataSourceSync
  fieldMapping: Record<string, string>  // 外部字段名 → 标准字段名
  createdAt: string
  updatedAt: string
}
```

### `DataSourceAccess` — 接入配置（前端可见的非敏感部分）

```typescript
interface DataSourceAccess {
  // API 类 — 只保留非敏感配置
  apiEndpoint?: string
  apiKeyHeader?: string         // 请求头名称，默认 X-API-Key
  authType?: AuthType           // 'bearer' | 'oauth2' | 'api_key' | 'basic' | 'custom'
  credentialConfigured?: boolean  // 服务端是否已配置凭证（只读，不暴露具体值）

  // 文件导入类
  fileFormat?: 'excel' | 'csv' | 'json' | 'xml'
  fileFields?: Record<string, string>
}
```

**凭证安全规则：**

- `apiSecret` / `accessToken` / `clientSecret` 等敏感字段**永远不出现**在 `packages/shared` 类型中
- 前端只能读取 `credentialConfigured: boolean` 来判断服务端是否已配置凭证
- 凭证由服务端加密存储，仅在服务端发起请求时使用

### `AuthType` 取值

| 值 | 说明 |
|----|------|
| `bearer` | Bearer Token |
| `oauth2` | OAuth 2.0 |
| `api_key` | API Key（通过 Header 或 Query 传递） |
| `basic` | HTTP Basic Auth |
| `custom` | 自定义认证方式 |

> 注意：禁止使用缩写 `key`，统一写 `api_key`。

---

## 六、字段映射

```typescript
interface FieldMappingRule {
  externalField: string      // 外部数据实际字段名
  standardField: string      // packages/shared 标准字段名
  required: boolean
  defaultValue?: string
  transform?: 'trim' | 'lowercase' | 'uppercase' | 'none'
}

interface MappingValidationError {
  externalField: string
  standardField: string
  rowIndex?: number          // 文件导入时的行号
  value: string
  reason: string
}
```

### ExternalJob 标准字段

| 标准字段 | 说明 | 来源 |
|---------|------|------|
| `title` | 岗位名称 | 必填，映射 |
| `company` | 公司名称 | 必填，映射 |
| `city` | 工作城市 | 必填，映射 |
| `salary` | 薪资范围 | 可选，映射 |
| `tags` | 标签列表 | 可选，映射 |
| `description` | 岗位描述 | 可选，映射 |
| `requirements` | 任职要求 | 可选，映射 |
| `sourceOrgId` | 来源机构 ID | 系统填充 |
| `externalId` | 外部唯一 ID | 必填，映射 |
| `sourceName` | 来源名称 | 系统填充 |
| `sourceUrl` | 职位原文链接 | 必填，映射 |
| `syncTime` | 同步时间 | 系统填充 |
| `reviewStatus` | 审核状态 | 系统默认 `pending` |
| `publishStatus` | 发布状态 | 系统默认 `draft` |

### ExternalJobFair 标准字段

| 标准字段 | 说明 | 来源 |
|---------|------|------|
| `name` | 招聘会名称 | 必填，映射 |
| `organizer` | 主办方 | 必填，映射 |
| `startTime` | 开始时间 | 必填，映射 |
| `endTime` | 结束时间 | 必填，映射 |
| `venue` | 地点 | 必填，映射 |
| `status` | 状态 | 系统根据时间计算 |
| `description` | 描述 | 可选，映射 |
| `boothCount` | 展位数量 | 可选，映射 |

---

## 七、文件导入批次

```typescript
interface ImportBatch {
  id: string
  sourceId: string
  fileName: string
  fileSize: number
  totalRows: number
  validRows: number
  invalidRows: number
  dupRows: number
  status: ImportBatchStatus   // 'pending' | 'validating' | 'confirmed' | 'failed' | 'cancelled'
  validationErrors: MappingValidationError[]
  createdAt: string
  confirmedAt?: string
  confirmedBy?: string
}

interface ImportRecord {
  id: string
  batchId: string
  rowIndex: number
  rawData: Record<string, string>
  mappedData: Partial<ExternalJob | ExternalJobFair>
  status: 'ok' | 'invalid' | 'dup'
  errors: MappingValidationError[]
}
```

---

## 八、审核流程

```
导入 → reviewStatus: pending
       ↓ 管理员认领
       reviewStatus: reviewing
       ↓ 审核通过          ↓ 拒绝
       reviewStatus: approved   reviewStatus: rejected
       publishStatus: draft
       ↓ 手动发布
       publishStatus: published
       ↓ 到期 / 下架
       publishStatus: expired / unpublished
```

管理员审核时可以：
- 查看原始数据 + 字段映射后的标准化数据
- 直接通过（→ `draft`，由机构手动发布）
- 修改后通过
- 拒绝并附原因（机构可查看拒绝原因）
- 批量审核同一批次

---

## 九、数据接入流程

### 流程 A — API 接入

1. 填写数据源名称、sourceKind、accessMode = `api`
2. 配置 apiEndpoint、authType、apiKeyHeader
3. 在服务端配置凭证（前端只读 `credentialConfigured`）
4. 配置字段映射
5. 测试连接
6. 开启自动同步

### 流程 B — 文件导入

1. 填写数据源名称、sourceKind、accessMode = `excel`/`csv`/`json`
2. 上传样例文件，系统自动识别字段列表
3. 配置字段映射（外部字段 → 标准字段）
4. 预览解析结果（`ImportBatch` + `ImportRecord`）
5. 确认导入（`confirmedAt` 记录操作人）
6. 进入审核队列（`reviewStatus: pending`）

### 流程 C — Webhook 推送

1. 填写数据源名称、sourceKind、accessMode = `webhook`
2. 系统生成 Webhook 接收端点 URL
3. 第三方配置推送目标（推送时附带签名）
4. 服务端验签后解析数据，进入审核队列

---

## 十、管理员后台能力

- 启用 / 停用数据源
- 查看同步日志（`SyncLogEntry`）
- 手动触发同步
- 配置同步频率（`SyncFrequency`）
- 审核岗位 / 招聘会数据
- 查看 `ImportBatch` 导入批次详情

---

## 十一、实现优先级

| 优先级 | 交付项 | 状态 |
|--------|--------|------|
| P0 | `packages/shared` 类型定义（全量） | ✅ 完成 |
| P0 | Partner 数据源管理页面（UI） | ✅ 完成 |
| P0 | Partner 同步日志页面（UI） | ✅ 完成 |
| P1 | Excel 导入 + 字段映射 UI | 待开发 |
| P1 | 字段映射引擎（服务端） | 待开发 |
| P1 | Admin 审核页面（UI） | 待开发 |
| P2 | API 数据源接入（OAuth2 / api_key） | 待开发 |
| P2 | 定时同步任务 | 待开发 |
| P2 | Webhook 实时推送接入 | 待开发 |
| P3 | 第三方聚合平台预置适配器 | 待开发 |
