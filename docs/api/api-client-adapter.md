# API Client Adapter 设计说明

> 适用范围：`apps/kiosk/src/services/api/`、`apps/admin/src/services/api/`、`apps/partner/src/services/api/`  
> 版本：Phase 7.5

---

## 概述

Kiosk 前台使用双 Adapter 架构访问后端接口，通过环境变量在**构建时**切换，页面层代码不变。

```
页面层（JobFairsPage / FairMapPage / ...）
  │  import { getJobFairs, getFairMap, ... }
  ▼
jobFairs.ts（服务函数导出层）
  │  const adapter = API_MODE === 'http' ? httpAdapter : mockAdapter
  ▼
┌─────────────────────┐    ┌─────────────────────────────┐
│  mockJobFairAdapter │    │  httpJobFairAdapter          │
│  mockAdapter.ts     │    │  httpAdapter.ts              │
│  ─────────────────  │    │  ─────────────────────────── │
│  读取本地 fairData  │    │  fetch /api/v1/job-fairs/... │
│  isMockData: true   │    │  解析 ApiResponse<T>         │
└─────────────────────┘    └─────────────────────────────┘
```

---

## 三种运行场景（强制行为规范）

> **适配器选择在构建时确定（`API_MODE` 由 `import.meta.env` 内联），运行时不允许动态切换。**

| 场景 | `VITE_API_MODE` | 后端状态 | 行为 | 是否允许 |
|------|-----------------|----------|------|----------|
| **场景 1** | `mock`（默认） | 无需后端 | 使用 `mockAdapter`，数据来自本地 `fairData.ts`，页面显示"当前为模拟数据"横幅 | ✅ 正常开发流程 |
| **场景 2** | `http` | 后端正常运行 | 使用 `httpAdapter`，`fetch /api/v1/...` 返回真实数据，`isMockData: false`，不显示横幅 | ✅ 生产/联调流程 |
| **场景 3** | `http` | 后端失败 / 未启动 | `httpAdapter` 抛出 `ApiHttpError`，页面显示错误状态（"加载失败，请稍后重试"），**不回退到 mock 数据** | ✅ 强制行为 |

**禁止行为（第四种场景）：**

> ❌ `VITE_API_MODE=http` + 后端失败 → 静默切换到 `mockAdapter` → 用户看到假数据以为是真的

这种行为在代码层面**没有实现路径**：
- `jobFairs.ts` 的 `adapter` 在构建时绑定，运行时不可变
- `httpAdapter` 的任何失败路径都以 `throw` 结束，不调用 `mockAdapter` 的任何方法

---

## 环境变量配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `VITE_API_MODE` | `mock`（本地）或 `http`（真实后端） | `mock` |
| `VITE_API_BASE_URL` | 后端 API 基础路径，`http` 模式必须配置 | `/api/v1` |

> **注意**：`VITE_` 前缀变量在 Vite 构建时被内联，修改后必须重启 dev server 生效。

---

## 本地开发方式

### 默认：Mock 模式（无需后端）

```bash
# .env.local 不需要配置任何变量，或显式写：
VITE_API_MODE=mock
```

启动后所有招聘会数据来自 `apps/kiosk/src/data/fairData.ts`，页面右上角显示 **"当前为模拟数据"** 提示横幅。

### 接入真实后端：HTTP 模式

```bash
# apps/kiosk/.env.local
VITE_API_MODE=http
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

重启 dev server 后，kiosk 招聘会模块所有请求将发往 `http://localhost:3000/api/v1/job-fairs/...`。

> 后端必须已实现 Phase 7 API 路由，详见 [api-v1-design.md](./api-v1-design.md)。

---

## API 路由对照

| 服务函数 | HTTP 方法 | 路径 |
|----------|-----------|------|
| `getJobFairs(params?)` | GET | `/job-fairs?status=xxx` |
| `getJobFairById(id)` | GET | `/job-fairs/:id` |
| `getFairCompanies(fairId)` | GET | `/job-fairs/:fairId/companies` |
| `getFairCompanyById(fairId, id)` | GET | `/job-fairs/:fairId/companies/:id` |
| `getFairZones(fairId)` | GET | `/job-fairs/:fairId/zones` |
| `getFairMap(fairId)` | GET | `/job-fairs/:fairId/map` |
| `getFairMaterials(fairId)` | GET | `/job-fairs/:fairId/materials` |
| `getFairStats(fairId)` | GET | `/job-fairs/:fairId/stats` |

---

## 错误处理

### HTTP Adapter 的错误抛出规则

`httpAdapter.ts` 对所有非 2xx 响应抛出 `ApiHttpError`：

```typescript
throw new ApiHttpError(code, message, httpStatus)
// 例：ApiHttpError { code: 'DATA_NOT_APPROVED', message: '...', status: 403 }
```

后端应返回标准错误体：

```json
{
  "error": {
    "code": "DATA_NOT_APPROVED",
    "message": "该招聘会数据尚未审核通过"
  }
}
```

页面层已有 `.catch(() => setError(true))` 统一处理，无需额外适配。

### 为什么不允许 HTTP 失败自动 fallback 到 Mock

**原则：生产环境错误必须暴露，不能静默掩盖。**

如果 http 模式请求失败后自动切换到 mock 数据：

1. **用户看到过时/错误数据**：mock 数据是开发时写死的，不反映真实招聘会状态。对求职者来说，这是信息误导。
2. **故障被掩盖**：后端宕机、网络断开、API 密钥失效等真实故障，运维人员无法感知。
3. **告警失效**：告警系统依赖页面 error 状态上报，fallback 后 error 状态不触发。

正确行为：**http 请求失败 → 页面显示错误状态 → 用户看到"加载失败，请稍后重试" → 告警触发 → 运维介入修复。**

**代码层面的保证（`httpAdapter.ts`）：**

```typescript
// httpAdapter 所有失败路径都以 throw 结束：
async function get<T>(path, params): Promise<T> {
  const res = await fetch(...)    // 网络错误 → 直接传播，不 catch
  if (!res.ok) {
    // 尝试解析错误体（仅用于提取 code/message）
    try { /* parse error body */ } catch { /* keep defaults */ }
    throw new ApiHttpError(code, message, res.status)  // 必须 throw
  }
  return res.json()               // 2xx → 正常返回
}
// ↑ 没有任何路径调用 mockAdapter 的方法
```

---

## 上线注意事项

### 部署前检查清单

- [ ] 后端已部署并可访问 `VITE_API_BASE_URL`
- [ ] CORS 已配置，允许来自 kiosk 页面的跨域请求
- [ ] 后端所有招聘会数据 `reviewStatus === 'approved'` 且 `publishStatus === 'published'`
- [ ] `FairLiveStatsDTO.isMockData` 后端返回 `false`（UI 将自动隐藏 Mock 提示横幅）
- [ ] 后端 DTO 字段中**不含** `apiSecret`、`accessToken`、原始 `fileUrl`
- [ ] `FairMaterialDTO.previewUrl` 使用带有效期的签名 URL（不公开永久链接）

### 生产环境构建

```bash
# 生产构建时通过 CI 环境变量注入
VITE_API_MODE=http VITE_API_BASE_URL=https://api.your-domain.com/api/v1 pnpm --filter kiosk build
```

> 不要把生产 API 地址提交到 `.env.local`，通过 CI/CD 系统注入环境变量。

---

## Jobs 模块（Phase 7.3）

岗位模块与招聘会模块遵循完全相同的 adapter 模式。

### 文件结构

| 文件 | 职责 |
|------|------|
| `jobs.ts` | 服务函数出口，按 `API_MODE` 选 adapter |
| `jobMockAdapter.ts` | 读 `MOCK_JOBS`，转换为 `ExternalJobDTO` |
| `jobHttpAdapter.ts` | `fetch /api/v1/jobs`，复用 `ApiHttpError` |

### API 路由对照（Jobs）

| 服务函数 | HTTP 方法 | 路径 |
|----------|-----------|------|
| `getJobs(params?)` | GET | `/jobs?tag=xxx` |
| `getJobById(id)` | GET | `/jobs/:id` |

### 三种场景（同招聘会模块规则）

| 场景 | 行为 |
|------|------|
| `VITE_API_MODE=mock` | `jobMockAdapter` 返回本地数据，`salaryDisplay`/"薪资面议" 已填充 |
| `VITE_API_MODE=http` + 后端正常 | `jobHttpAdapter` 返回真实 `ExternalJobDTO` |
| `VITE_API_MODE=http` + 后端失败 | 抛出 `ApiHttpError`，页面显示错误状态，**不 fallback** |

### 新增 ExternalJobDTO 字段说明

`ExternalJobDTO extends ExternalJob`，额外字段由 mockAdapter/后端填充：

| 字段 | 说明 | mock 值 |
|------|------|---------|
| `salaryDisplay` | 格式化薪资（必填） | `salary` 原值，为空时填 `"薪资面议"` |
| `workType` | 工作类型（可选） | 从 `tags` 推导：全职→`full_time`，兼职→`part_time`，实习→`internship` |
| `dataSourceNote` | 合规来源说明（必填，必须展示） | `"数据来源：${sourceName} · 同步于 ${date} · 仅供参考"` |

### 合规约束

- 按钮仅使用：`去来源平台投递` / `扫码投递`（CLAUDE.md 明确允许）
- QR overlay 标题：`来源平台二维码`（不含"投递"动词）
- 不新增：一键投递、立即投递、平台内投递、候选人管理、简历筛选、面试邀约
- `dataSourceNote` 字段必须在页面合规说明区域展示

---

## Admin Service（Phase 7.4）

Admin 后台使用独立的 service 层，架构与 Kiosk 完全一致。

### 文件结构

| 文件 | 职责 |
|------|------|
| `apps/admin/src/services/api/client.ts` | `API_MODE`、`API_BASE_URL`、`ApiHttpError`（与 Kiosk 版本结构相同，独立实例） |
| `apps/admin/src/services/api/types.ts` | `AdminJobSourceRecord`、`AdminFairSourceRecord`、re-export 共享类型 |
| `apps/admin/src/services/api/adminMockAdapter.ts` | 模块级可变状态、120ms 延迟、8 个异步方法 |
| `apps/admin/src/services/api/adminHttpAdapter.ts` | `GET/PATCH` fetch、`ApiHttpError` throw |
| `apps/admin/src/services/api/sources.ts` | `AdminSourceServiceInterface`、adapter 选择、8 个导出函数 |
| `apps/admin/src/services/api/index.ts` | `export * from './client'` + `'./sources'` |

### 架构图

```
job-sources/index.tsx + fair-sources/index.tsx
  │  import { getJobSources, approveJobSource, ... }
  ▼
sources.ts（服务函数出口层）
  │  const adapter = API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter
  ▼
┌──────────────────────┐    ┌──────────────────────────────────┐
│  adminMockAdapter    │    │  adminHttpAdapter                │
│  ────────────────    │    │  ────────────────────────────── │
│  模块级可变 let 数组 │    │  fetch /api/v1/admin/job-sources │
│  8 个异步方法 120ms  │    │  fetch /api/v1/admin/fair-sources│
└──────────────────────┘    └──────────────────────────────────┘
```

### API 路由对照（Admin）

| 服务函数 | HTTP 方法 | 路径 |
|----------|-----------|------|
| `getJobSources()` | GET | `/admin/job-sources` |
| `approveJobSource(id)` | PATCH | `/admin/job-sources/:id` |
| `rejectJobSource(id)` | PATCH | `/admin/job-sources/:id` |
| `publishJobSource(id)` | PATCH | `/admin/job-sources/:id` |
| `unpublishJobSource(id)` | PATCH | `/admin/job-sources/:id` |
| `getFairSources()` | GET | `/admin/fair-sources` |
| `approveFairSource(id)` | PATCH | `/admin/fair-sources/:id` |
| `rejectFairSource(id)` | PATCH | `/admin/fair-sources/:id` |
| `publishFairSource(id)` | PATCH | `/admin/fair-sources/:id` |
| `unpublishFairSource(id)` | PATCH | `/admin/fair-sources/:id` |

### 审核状态流

```
pending → reviewing → approved/rejected
                           │
                        approved → draft → published ⇄ unpublished
```

---

## Partner Service（Phase 7.5）

合作机构后台有 2 个独立 service 文件，分别对应数据源和内容管理。

### 文件结构

| 文件 | 职责 |
|------|------|
| `apps/partner/src/services/api/client.ts` | `API_MODE`、`API_BASE_URL`、`ApiHttpError` |
| `apps/partner/src/services/api/types.ts` | 9 个类型：`PartnerDataSource`、`PartnerJobRecord`、`PartnerFairRecord`、`PartnerSyncLog` 等 |
| `apps/partner/src/services/api/partnerMockAdapter.ts` | 4 组模块级状态、11 个异步方法 |
| `apps/partner/src/services/api/partnerHttpAdapter.ts` | `GET/PATCH/POST` fetch、`ApiHttpError` throw |
| `apps/partner/src/services/api/dataSources.ts` | 数据源 3 个导出函数 |
| `apps/partner/src/services/api/partnerContent.ts` | 岗位/招聘会/日志 5 个导出函数 |
| `apps/partner/src/services/api/index.ts` | `client` + `dataSources` + `partnerContent` |

### 架构图

```
sources/index.tsx ──→ dataSources.ts ──┐
jobs/index.tsx ─────┐                  │  const adapter = API_MODE === 'http'
fairs/index.tsx ────┼→ partnerContent.ts┤    ? partnerHttpAdapter
sync-logs/index.tsx ┘                  │    : partnerMockAdapter
                                       ▼
                        ┌──────────────────────────┐
                        │  partnerMockAdapter      │
                        │  ─────────────────────   │
                        │  4 个 let 状态数组       │
                        │  11 个异步方法 120ms     │
                        └──────────────────────────┘
                        ┌──────────────────────────┐
                        │  partnerHttpAdapter      │
                        │  ─────────────────────   │
                        │  get/patch/post 辅助函数 │
                        │  5 组 API 端点           │
                        └──────────────────────────┘
```

### API 路由对照（Partner）

| 服务函数 | HTTP 方法 | 路径 |
|----------|-----------|------|
| `getDataSources()` | GET | `/partner/data-sources` |
| `toggleDataSource(id)` | PATCH | `/partner/data-sources/:id` |
| `createDataSource(name)` | POST | `/partner/data-sources` |
| `getPartnerJobs()` | GET | `/partner/jobs` |
| `unpublishPartnerJob(id)` | PATCH | `/partner/jobs/:id` |
| `getPartnerFairs()` | GET | `/partner/fairs` |
| `unpublishPartnerFair(id)` | PATCH | `/partner/fairs/:id` |
| `getSyncLogs()` | GET | `/partner/sync-logs` |

### `ExcelImportWizard` 边界说明

`partner/sources/index.tsx` 内的 `ExcelImportWizard` 组件包含 4 步向导纯 UI 仿真常量（`MOCK_DETECTED_FIELDS`、`AUTO_SUGGEST`、`MOCK_RECORDS`）。这些常量属于向导 UI 层，不是数据访问层，因此**保留在页面文件中**，不移入 adapter。真实 Excel 解析逻辑由后端实现后，这些常量将被 API 调用替换。

---

## 后续扩展（Phase 7.6+）

下一个需要 service 层的模块（如政策公告 `/policy`）参照此文件模式：

1. 新建 `policyMockAdapter.ts` + `policyHttpAdapter.ts`，实现同一接口
2. 新建 `policy.ts`，按 `API_MODE` 选 adapter
3. 在 `index.ts` 追加 `export * from './policy'`
4. 不改动任何页面文件

后端实现时，httpAdapter 端点前缀遵循：
- Kiosk：`/api/v1/job-fairs/...`、`/api/v1/jobs/...`
- Admin：`/api/v1/admin/...`
- Partner：`/api/v1/partner/...`
