# Mock 数据 → API 替换计划

> 版本：Phase 7  
> 更新日期：2026-05-25  
> 目标：Phase 7 后端 API 完成后，将前端所有 mock 数据替换为真实 API 调用，不改变页面组件结构。

---

## 当前 Mock 数据清单

### 一体机前台（apps/kiosk）

#### 1. `apps/kiosk/src/data/externalSources.ts`

| 变量名 | 类型 | 当前数据量 | 供给页面 |
|--------|------|-----------|---------|
| `MOCK_FAIRS` | `ExternalJobFair[]` | 2 条 | JobFairsPage, JobFairDetailPage, FairCompaniesPage, FairMapPage, FairMaterialsPage, FairStatsPage |
| `MOCK_JOBS` | `ExternalJob[]` | 6 条 | JobsPage, JobDetailPage |
| `MOCK_SOURCES` | `DataSource[]` | 3 条 | 未直接消费，作为来源元数据 |

**替换方案**
```typescript
// Phase 7 前：直接导入
import { MOCK_FAIRS } from '../../data/externalSources'

// Phase 7 后：通过 API client hook
import { useJobFairs } from '../../hooks/api/useJobFairs'
const { data: fairs, isLoading } = useJobFairs({ status: 'ongoing' })
```

---

#### 2. `apps/kiosk/src/data/fairData.ts`

| 变量名 | 类型 | 当前数据量 | 供给页面 |
|--------|------|-----------|---------|
| `FAIR_ZONES_MAP` | `Record<string, FairZone[]>` | f1: 5条, f2: 3条 | FairMapPage |
| `FAIR_COMPANIES_MAP` | `Record<string, FairCompany[]>` | f1: 7条, f2: 4条 | FairCompaniesPage, FairCompanyDetailPage, JobFairDetailPage |
| `FAIR_BOOTHS_MAP` | `Record<string, FairBooth[]>` | f1: 13条, f2: 8条 | FairMapPage |
| `FAIR_MATERIALS_MAP` | `Record<string, FairMaterial[]>` | f1: 5条, f2: 3条 | FairMaterialsPage, JobFairDetailPage |
| `FAIR_STATS_MAP` | `Record<string, FairLiveStats>` | f1, f2 各1条 | FairStatsPage, JobFairDetailPage |

**替换方案**
```typescript
// Phase 7 前（fairData.ts 静态查表）
import { FAIR_COMPANIES_MAP } from '../../data/fairData'
const companies = FAIR_COMPANIES_MAP[fairId] ?? []

// Phase 7 后（API hook）
import { useFairCompanies } from '../../hooks/api/useFairCompanies'
const { data: companies, isLoading } = useFairCompanies(fairId, { pageSize: 50 })
```

---

### 管理员后台（apps/admin）

#### 3. `apps/admin/src/routes/dashboard/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_METRICS` | 工作台汇总指标 |
| `MOCK_ALERTS` | 告警列表 |
| `MOCK_RECENT_ORDERS` | 最近打印订单 |

**替换方案**：`useAdminDashboard()` hook → `GET /api/v1/admin/dashboard/stats`

---

#### 4. `apps/admin/src/routes/terminals/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_TERMINALS` | 终端列表 |

**替换方案**：`useTerminals()` hook → `GET /api/v1/terminals`

---

#### 5. `apps/admin/src/routes/printers/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_PRINTERS` | 打印机列表与状态 |

**替换方案**：`usePrinters()` hook → `GET /api/v1/admin/printers`（或从 terminal heartbeat 聚合）

---

#### 6. `apps/admin/src/routes/orders/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_ORDERS` | 打印订单列表 |

**替换方案**：`usePrintOrders()` hook → `GET /api/v1/print/orders`

---

#### 7. `apps/admin/src/routes/files/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_FILES` | 文件管理列表 |

**替换方案**：`useAdminFiles()` hook → `GET /api/v1/admin/files`

---

#### 8. `apps/admin/src/routes/alerts/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_ALERTS` | 告警中心列表 |

**替换方案**：`useAlerts()` hook → `GET /api/v1/admin/alerts`

---

#### 9. `apps/admin/src/routes/partners/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_PARTNERS` | 合作机构列表 |

**替换方案**：`usePartners()` hook → `GET /api/v1/admin/partners`

---

#### 10. `apps/admin/src/routes/job-sources/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_JOB_SOURCES` | 岗位数据源列表 |

**替换方案**：`useAdminSources()` hook → `GET /api/v1/admin/sources?kind=job`

---

#### 11. `apps/admin/src/routes/fair-sources/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_FAIR_SOURCES` | 招聘会数据源列表 |

**替换方案**：`useAdminSources()` hook → `GET /api/v1/admin/sources?kind=fair`

---

#### 12. `apps/admin/src/routes/fairs/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_FAIRS` | 招聘会管理列表 |
| `MOCK_COMPANIES` | 参会企业列表 |
| `MOCK_ZONES` | 展区列表 |
| `MOCK_BOOTHS` | 展位列表 |
| `MOCK_MATERIALS` | 活动资料列表 |
| `MOCK_STATS` | 现场统计数据 |

**替换方案**：各自对应 API hook，见下节。

---

### 合作机构后台（apps/partner）

#### 13. `apps/partner/src/routes/dashboard/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_STATS` | 工作台统计指标 |

**替换方案**：`usePartnerDashboard()` hook → `GET /api/v1/partner/dashboard/stats`

---

#### 14. `apps/partner/src/routes/jobs/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_JOBS` | 本机构岗位列表 |

**替换方案**：`usePartnerJobs()` hook → `GET /api/v1/partner/jobs`

---

#### 15. `apps/partner/src/routes/fairs/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_FAIRS` | 本机构招聘会列表 |

**替换方案**：`usePartnerFairs()` hook → `GET /api/v1/partner/fairs`

---

#### 16. `apps/partner/src/routes/sources/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_SOURCES` | 数据源列表 |

**替换方案**：`usePartnerSources()` hook → `GET /api/v1/partner/sources`

---

#### 17. `apps/partner/src/routes/sync-logs/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_LOGS` | 同步日志列表 |

**替换方案**：`useSyncLogs()` hook → `GET /api/v1/partner/sync-logs`

---

#### 18. `apps/partner/src/routes/profile/index.tsx`（inline mock）

| 变量名 | 供给内容 |
|--------|---------|
| `MOCK_PARTNER` | 机构信息 + sceneConfig |

**替换方案**：`usePartnerProfile()` hook → `GET /api/v1/partner/profile`

---

## Phase 7 替换步骤

### 第一步：建立 API client 层（Phase 7.1）

```
packages/shared/src/api/
  client.ts          # axios 实例，统一处理 token、错误、分页
  endpoints.ts       # API 路径常量
  types.ts           # 请求/响应 TS 类型（即 Phase 7 DTO）
```

一体机、管理员、合作机构分别通过各自的 env 变量指定 API_BASE_URL。

---

### 第二步：按模块逐步替换（Phase 7.2 - 7.5）

优先级顺序：

| 优先级 | 模块 | 理由 |
|--------|------|------|
| P0 | 终端心跳 + 打印订单 | 核心业务流程 |
| P0 | 岗位 + 招聘会公开列表 | 一体机展示主入口 |
| P1 | 数据源 + 导入批次 | 合作机构核心功能 |
| P1 | 招聘会数字服务（企业/展位/资料/stats） | 招聘会现场服务 |
| P2 | AI 简历服务 | 依赖 AI 服务上线 |
| P2 | 管理员工作台 + 告警 | 运营监控 |
| P3 | 审计日志 | 合规要求 |

---

### 第三步：删除 mock 数据文件（Phase 7 完成时）

替换完毕后可删除以下文件：

- `apps/kiosk/src/data/externalSources.ts`
- `apps/kiosk/src/data/fairData.ts`
- `apps/kiosk/src/types/fair.ts`（迁移至 `packages/shared/src/types/fair.ts` 正式版）
- 各 admin/partner 路由文件中的 inline `MOCK_*` 变量

删除前需确认：所有引用页面已切换为 API hook，`pnpm build` 无错误。

---

## API Hook 约定

所有 API hook 统一用 TanStack Query（React Query）封装：

```typescript
// 示例：useFairCompanies
function useFairCompanies(fairId: string, params?: { pageSize?: number }) {
  return useQuery({
    queryKey: ['fair-companies', fairId, params],
    queryFn: () => apiClient.get<FairCompanyDTO[]>(`/job-fairs/${fairId}/companies`, { params }),
    staleTime: 30_000,   // 30s 缓存
    enabled: !!fairId,
  })
}
```

页面组件只改一行（数据来源从 mock 变量 → hook），不改 JSX 渲染逻辑：

```typescript
// 替换前
const companies = FAIR_COMPANIES_MAP[fairId] ?? []

// 替换后
const { data: companies = [], isLoading } = useFairCompanies(fairId)
if (isLoading) return <LoadingState />
```

---

## FairLiveStatsDTO 的 `isMockData` 字段

`FairLiveStatsDTO.isMockData` 字段用于在一体机端显示模拟数据提示。  
Phase 7 后端上线后，此字段返回 `false`，前端自动隐藏提示条，无需手动删除组件代码。

---

## 关联文档

- [API v1 设计文档](../api/api-v1-design.md)
- [Phase 7 正式 DTO 定义](./data-model-phase7.md)
- [合作机构权限矩阵](./partner-permission-matrix.md)
