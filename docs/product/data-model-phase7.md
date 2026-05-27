# Phase 7 正式 DTO 定义

> 版本：Phase 7  
> 状态：设计稿，Phase 7 后端实现前冻结  
> 更新日期：2026-05-25  
> 说明：本文件定义所有 `/api/v1` 接口的响应 DTO。前端消费方只使用此文件中的类型，不依赖 mock 本地类型。

---

## 目录

1. [通用类型](#1-通用类型)
2. [ExternalJobDTO](#2-externalJobDTO)
3. [ExternalJobFairDTO](#3-externalJobFairDTO)
4. [FairCompanyDTO](#4-fairCompanyDTO)
5. [FairZoneDTO](#5-fairZoneDTO)
6. [FairBoothDTO](#6-fairBoothDTO)
7. [FairMaterialDTO](#7-fairMaterialDTO)
8. [FairLiveStatsDTO](#8-fairLiveStatsDTO)
9. [DataSourceDTO](#9-dataSourceDTO)
10. [ImportBatchDTO](#10-importBatchDTO)
11. [SyncLogDTO](#11-syncLogDTO)
12. [TerminalDTO](#12-terminalDTO)
13. [PrintOrderDTO](#13-printOrderDTO)
14. [ScanFileDTO](#14-scanFileDTO)
15. [ResumeRecordDTO](#15-resumeRecordDTO)
16. [设计原则](#16-设计原则)

---

## 1. 通用类型

以下枚举类型在 `packages/shared/src/types/` 中维护，可跨应用使用。

```typescript
// 审核状态（所有外部数据通用）
type ReviewStatus = 'pending' | 'reviewing' | 'approved' | 'rejected'

// 发布状态（与审核解耦）
type PublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'

// 来源种类
type SourceKind =
  | 'job_platform'      // 招聘平台
  | 'hr_company'        // 人力资源机构
  | 'school'            // 高校就业中心
  | 'fair_organizer'    // 招聘会主办方
  | 'aggregator'        // 聚合数据源
  | 'manual'            // 手动录入

// 接入方式
type AccessMode = 'api' | 'excel' | 'csv' | 'json' | 'webhook' | 'manual'

// 认证类型（合作机构后台配置，不出现在响应 DTO 中）
type AuthType = 'bearer' | 'oauth2' | 'api_key' | 'basic' | 'custom'

// 企业规模
type CompanyScale = 'startup' | 'small' | 'medium' | 'large' | 'enterprise'

// 招聘会状态
type FairStatus = 'draft' | 'upcoming' | 'ongoing' | 'ended' | 'cancelled'

// 展位状态
type FairBoothStatus = 'available' | 'occupied' | 'reserved'

// 企业签到状态
type CompanyCheckinStatus = 'pending' | 'checked_in' | 'absent'

// 资料类型
type FairMaterialType =
  | 'schedule'       // 活动日程
  | 'venue_map'      // 场馆地图
  | 'company_list'   // 企业名录
  | 'position_list'  // 岗位汇总
  | 'brochure'       // 宣传册
  | 'other'          // 其他

// 终端状态
type TerminalStatus = 'online' | 'offline' | 'error' | 'maintenance'

// 打印机状态
type PrinterStatus = 'ready' | 'printing' | 'offline' | 'error' | 'low_paper' | 'paper_jam'

// 打印订单状态
type PrintOrderStatus = 'pending' | 'queued' | 'printing' | 'completed' | 'failed' | 'cancelled'

// 颜色模式
type ColorMode = 'bw' | 'color'

// 双面模式
type DuplexMode = 'single' | 'double'

// 扫描任务状态
type ScanJobStatus = 'pending' | 'scanning' | 'completed' | 'failed'

// AI 任务状态
type AiTaskStatus = 'pending' | 'processing' | 'completed' | 'failed'

// 同步日志级别
type SyncLogLevel = 'info' | 'warn' | 'error'

// 导入批次状态
type ImportBatchStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'partial'
```

---

## 2. ExternalJobDTO

岗位信息展示 DTO（公开接口响应）。

```typescript
interface ExternalJobDTO {
  // 标识
  id: string
  externalId: string              // 来源平台的原始 ID
  sourceOrgId: string             // 来源机构 ID
  sourceName: string              // 来源机构名称（展示用）
  sourceUrl: string               // 来源平台岗位链接（用于跳转）
  syncTime: string                // 最近一次同步时间（ISO 8601）

  // 岗位基本信息
  title: string
  companyName: string
  companyLogo?: string            // 签名 URL，有效期 24h
  industry: string
  city: string
  district?: string
  address?: string

  // 薪资（展示用，不做筛选逻辑计算）
  salaryMin?: number              // 元/月
  salaryMax?: number
  salaryDisplay: string           // "8000-12000元/月" 直接展示

  // 岗位详情
  description?: string
  requirements?: string
  workType: 'full_time' | 'part_time' | 'internship' | 'contract'
  educationRequired?: string      // "本科" / "大专" 等
  experienceRequired?: string     // "1-3年" 等
  headcount: number

  // 审核与发布
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus

  // 合规字段（必须展示）
  dataSourceNote: string          // "数据来源：xx平台，仅供参考，请前往来源平台办理"
}
```

**合规说明**：响应中不包含企业联系方式、HR 联系方式、候选人相关任何字段。

---

## 3. ExternalJobFairDTO

招聘会基本信息 DTO。

```typescript
interface ExternalJobFairDTO {
  // 标识
  id: string
  externalId?: string
  sourceOrgId: string
  sourceName: string
  sourceUrl?: string              // 来源平台招聘会链接（用于跳转/扫码）
  syncTime: string

  // 基本信息
  name: string
  status: FairStatus
  startTime: string               // ISO 8601
  endTime: string
  venue: string                   // 场馆名称
  address: string
  city: string
  organizer: string               // 主办方名称

  // 统计概览
  expectedCompanies: number
  expectedPositions: number

  // 审核与发布
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus

  // 现场数字服务（由系统管理，非外部来源）
  hasManagedData: boolean         // 是否已录入展区/企业/资料等数字化数据

  // 合规字段
  dataSourceNote: string
}
```

---

## 4. FairCompanyDTO

参会企业 DTO。

```typescript
interface FairCompanyPositionDTO {
  id: string
  title: string
  headcount: number
  salary?: string                 // 展示字符串，如 "8K-12K"
  requirements?: string
  workType?: string
}

interface FairCompanyDTO {
  id: string
  fairId: string

  // 企业信息
  companyName: string
  industry: string
  scale: CompanyScale
  description?: string
  companyLogo?: string            // 签名 URL

  // 展位
  boothNumber?: string
  zoneId?: string
  zoneName?: string

  // 岗位列表（展示用，不支持平台内投递）
  positions: FairCompanyPositionDTO[]

  // 签到状态（管理端使用）
  checkinStatus: CompanyCheckinStatus
  checkinTime?: string

  // 跳转
  sourceUrl?: string              // 来源平台企业主页链接

  // 合规字段
  applyNote: string               // "如需了解更多，请扫码前往来源平台"
}
```

**合规说明**：不含企业联系人、HR 信息、简历收件邮箱等任何可用于私下投递的字段。

---

## 5. FairZoneDTO

展区 DTO。

```typescript
interface FairZoneDTO {
  id: string
  fairId: string
  zoneName: string
  description?: string
  industry?: string               // 该展区主导行业（如 "IT互联网"）
  boothCount: number
  checkedInCount: number
  color?: string                  // 展区标识色（hex），用于地图渲染
  sortOrder: number
}
```

---

## 6. FairBoothDTO

展位 DTO。

```typescript
interface FairBoothDTO {
  id: string
  fairId: string
  zoneId: string
  zoneName: string
  boothNumber: string             // 如 "A-01"
  status: FairBoothStatus
  areaSqm?: number
  positionX?: number              // 可选：在展位平面图中的坐标（Phase 8 扩展）
  positionY?: number
  companyId?: string
  companyName?: string            // 已入驻企业名称
}
```

---

## 7. FairMaterialDTO

活动资料 DTO。

```typescript
interface FairMaterialDTO {
  id: string
  fairId: string
  name: string
  type: FairMaterialType
  description?: string

  // 文件信息
  pageCount: number
  fileSizeKB: number
  previewUrl?: string             // 签名预览 URL（有效期 2h），不返回原始 fileUrl

  // 权限
  allowPrint: boolean
  publishStatus: PublishStatus

  // 统计
  printCount: number

  updatedAt: string
}
```

> 注：`fileUrl` 原始路径**永远不出现在响应中**，只返回签名 `previewUrl`，由服务端控制访问。

---

## 8. FairLiveStatsDTO

现场准实时数据 DTO（服务端缓存 30s）。

```typescript
interface FairLiveStatsDTO {
  fairId: string

  // 企业数据
  totalCompanies: number
  checkedInCompanies: number

  // 岗位数据
  totalPositions: number
  totalHeadcount: number

  // 服务行为统计（不含求职者个人信息）
  browseCount: number             // 信息浏览次数
  scanCount: number               // 二维码展示次数
  printCount: number              // 资料打印次数
  checkinCount: number            // 现场签到次数（企业，非求职者）

  lastUpdated: string             // ISO 8601，数据快照时间
  isMockData: boolean             // Phase 7 完成前为 true
}
```

**合规说明**：不含求职者个人信息，不含企业筛选结果，不含任何招聘闭环数据。

---

## 9. DataSourceDTO

数据源配置 DTO（响应）。

```typescript
interface DataSourceDTO {
  id: string
  orgId: string                   // 所属合作机构 ID
  sourceName: string
  sourceKind: SourceKind
  accessMode: AccessMode
  baseUrl?: string
  syncFrequency: 'realtime' | 'hourly' | 'daily' | 'weekly' | 'manual'
  isActive: boolean

  // 凭证状态（永远不返回实际凭证）
  credentialConfigured: boolean   // true = 服务端已配置凭证
  authType?: AuthType             // 仅告知类型，不返回值

  // 字段映射（简要展示）
  mappingFieldCount: number       // 已配置映射字段数

  // 同步统计
  lastSyncAt?: string
  lastSyncStatus?: 'success' | 'partial' | 'failed'
  totalImported: number
  totalApproved: number
  totalRejected: number

  // 审核
  approvalStatus: 'pending' | 'approved' | 'suspended'
  approvedAt?: string
  approvedBy?: string

  createdAt: string
  updatedAt: string
}
```

**安全约束**：`apiToken`、`apiSecret`、`accessToken`、`clientSecret`、`password` 等敏感字段**绝对不出现在此 DTO 及任何前端响应中**。

---

## 10. ImportBatchDTO

导入批次 DTO。

```typescript
interface ImportBatchDTO {
  id: string
  sourceId: string
  sourceName: string
  orgId: string

  status: ImportBatchStatus
  accessMode: AccessMode          // 本批次导入方式

  // 数量统计
  totalRows: number
  processedRows: number
  successRows: number
  failedRows: number
  skippedRows: number             // 重复跳过

  // 错误摘要（前 10 条）
  errors: Array<{
    row: number
    field: string
    message: string
    value?: string
  }>

  // 关联
  importedJobCount?: number
  importedFairCount?: number

  startedAt: string
  completedAt?: string
  createdBy: string               // 操作账号 ID
}
```

---

## 11. SyncLogDTO

同步日志 DTO。

```typescript
interface SyncLogDTO {
  id: string
  sourceId: string
  sourceName: string
  orgId: string

  level: SyncLogLevel
  action: 'sync_start' | 'sync_complete' | 'sync_failed' | 'item_imported' | 'item_rejected' | 'mapping_error' | 'auth_failed'
  message: string

  // 关联数据（可选）
  relatedItemId?: string
  relatedItemType?: 'job' | 'fair' | 'company'
  batchId?: string

  metadata?: Record<string, string | number | boolean>  // 附加上下文

  createdAt: string
}
```

---

## 12. TerminalDTO

终端设备 DTO。

```typescript
interface TerminalDTO {
  id: string
  terminalCode: string            // 如 "T-HZ-001"
  displayName: string
  locationId?: string
  locationName?: string           // 如 "杭州市人才市场 1F"

  status: TerminalStatus
  printerStatus: PrinterStatus

  // 硬件指标
  diskFreeGB?: number
  cpuPercent?: number
  memUsedPercent?: number
  screenResolution?: string       // "1920x1080"

  // 网络
  ipAddress?: string
  networkType?: 'ethernet' | 'wifi'

  // 版本
  agentVersion?: string
  osVersion?: string

  // 统计
  printOrdersToday: number
  printOrdersTotal: number
  lastOnlineAt?: string

  // 管理
  isActive: boolean
  registeredAt: string
  lastHeartbeatAt?: string
}
```

---

## 13. PrintOrderDTO

打印订单 DTO。

```typescript
interface PrintOrderDTO {
  id: string
  terminalId: string
  terminalCode: string
  sessionId: string               // 匿名会话 ID

  // 文件信息
  fileId: string
  fileName: string
  pageCount: number

  // 打印参数
  copies: number
  colorMode: ColorMode
  duplexMode: DuplexMode
  paperSize: 'A4'                 // 当前硬件仅支持 A4
  staple: boolean
  pageRange?: string              // 如 "1-3,5"

  // 费用
  estimatedCostYuan: number
  actualCostYuan?: number

  // 状态
  status: PrintOrderStatus
  errorMessage?: string

  // 奔图打印任务
  pantumTaskId?: string

  // 时间
  createdAt: string
  startedAt?: string
  completedAt?: string
  cancelledAt?: string
}
```

---

## 14. ScanFileDTO

扫描文件记录 DTO。

```typescript
interface ScanFileDTO {
  id: string
  terminalId: string
  sessionId: string

  // 文件信息
  fileName: string
  fileSizeKB: number
  pageCount: number
  format: 'pdf' | 'jpeg' | 'png' | 'tiff'

  // 扫描参数
  dpi: number
  colorMode: ColorMode | 'gray'
  duplexScan: boolean
  adfUsed: boolean

  // 状态
  status: ScanJobStatus
  errorMessage?: string

  // 访问
  downloadUrl?: string            // 临时签名 URL，有效期 2h
  expiresAt?: string

  createdAt: string
  completedAt?: string
}
```

---

## 15. ResumeRecordDTO

AI 简历服务记录 DTO。

```typescript
interface ResumeParseResult {
  name?: string
  contact?: string                // 脱敏后：手机号保留前3后4，邮箱显示域名
  education: Array<{
    school: string
    degree: string
    major: string
    startYear?: number
    endYear?: number
  }>
  experience: Array<{
    company: string
    title: string
    startDate?: string
    endDate?: string
    description?: string
  }>
  skills: string[]
  languages?: string[]
  summary?: string
}

interface ResumeScoreDetail {
  dimension: string               // "格式规范" / "工作经验" / "技能匹配" 等
  score: number                   // 0-100
  feedback: string
  suggestions: string[]
}

interface ResumeOptimizeSuggestion {
  section: string                 // "工作经验" / "个人简介" 等
  original?: string
  suggested: string
  reason: string
}

interface ResumeRecordDTO {
  id: string
  terminalId: string
  sessionId: string

  // 来源文件
  sourceFileId: string
  sourceType: 'upload' | 'scan'

  // 解析结果
  parseStatus: AiTaskStatus
  parseResult?: ResumeParseResult
  parseError?: string

  // 诊断评分
  overallScore?: number           // 0-100
  scoreDetails?: ResumeScoreDetail[]
  scoreDisclaimer: string         // "AI 评分仅供参考，不代表真实录用率"

  // 优化建议
  optimizeStatus?: AiTaskStatus
  optimizeSuggestions?: ResumeOptimizeSuggestion[]
  targetJobTitle?: string

  // 导出
  exportFileId?: string           // 优化后导出文件
  exportUrl?: string              // 临时签名 URL

  createdAt: string
  updatedAt: string

  // 数据保留
  autoDeleteAt: string            // 默认创建后 24h 自动删除
}
```

**隐私说明**：联系方式字段响应前脱敏，不存储完整手机号或邮箱。文件 24 小时后自动清理。

---

## 16. 设计原则

### 安全原则

1. **凭证永不出现在 DTO 中**：`apiSecret`、`accessToken`、`clientSecret`、`password` 等字段只存服务端，响应中只有 `credentialConfigured: boolean`。
2. **文件 URL 全签名**：所有文件访问 URL 必须是签名 URL（含过期时间），不暴露原始存储路径。
3. **个人信息最小化**：简历解析结果中联系方式脱敏后才出现在 DTO 中。
4. **数据自动过期**：简历文件 24h 后自动删除，扫描文件 48h 后自动删除，签名 URL 最长 2h。

### 合规原则

1. **审核前不展示**：所有 `reviewStatus !== 'approved'` 的数据不出现在公开接口响应中。
2. **来源必须展示**：所有外部数据 DTO 必须包含 `sourceName`、`syncTime`、`dataSourceNote` 字段。
3. **禁止招聘闭环字段**：任何 DTO 中不允许出现 `candidates`、`applications`、`interviewInvitations`、`offers`、`resumeDelivery` 等字段。

### 演进原则

1. **向后兼容**：v1 API 字段只增不改，废弃字段标记 `@deprecated` 保留两个大版本。
2. **DTO 与 DB 分离**：DTO 是面向前端的响应结构，不等于数据库表结构，服务层负责转换。
3. **mock 替换路径**：前端通过 API client 钩子消费，Phase 7 完成后只需切换 mock → real API，不改页面组件逻辑。
