# Phase 7.6 后端骨架架构设计

> 版本：Draft 1.0  
> 日期：2026-05-26  
> 状态：设计阶段，暂未写真实后端代码  
> 范围：NestJS + Prisma 骨架，不接真实第三方 API，不接真实打印机

---

## 1. 技术选型

| 层次 | 技术 | 理由 |
|------|------|------|
| 运行时 | Node.js 20 LTS | 与前端共享 TypeScript 类型，部署到 Windows 服务器无额外依赖 |
| 框架 | NestJS | 模块化/DI/Pipe/Guard/Interceptor 完整；前后端均 TS，类型复用成本低 |
| ORM | Prisma | Schema-first，migration 可追溯；类型推导与 NestJS 契合 |
| 数据库 | PostgreSQL 16 | 项目 CLAUDE.md 确认技术栈 |
| 缓存 | Redis | 任务队列（BullMQ）+ 短期缓存（岗位列表等） |
| 任务队列 | BullMQ | 打印任务、数据同步任务异步化 |
| 文件存储 | 待定（MinIO / 阿里云 OSS / 腾讯 COS） | Phase 7.6 先用本地路径 stub |
| API 前缀 | `/api/v1` | 已在前端 httpAdapter 全部遵循 |

---

## 2. 目录结构

```
services/
  api-server/
    prisma/
      schema.prisma          ← 数据模型定义
      migrations/            ← Prisma migrate 历史
      seed.ts                ← 开发种子数据

    src/
      main.ts                ← NestJS 入口，监听 3000
      app.module.ts          ← 根模块，汇聚所有子模块

      common/
        dto/
          api-response.dto.ts        ← ApiResponse<T> 包装
          paginated-response.dto.ts  ← PaginatedResponse<T>
          error-response.dto.ts      ← { error: { code, message } }
        filters/
          http-exception.filter.ts   ← 统一异常格式化
        guards/
          auth.guard.ts              ← JWT 鉴权占位（Phase 7.6 先 passthrough）
          partner-auth.guard.ts      ← Partner 只访问自己机构数据
          admin-auth.guard.ts        ← Admin 访问所有数据
        interceptors/
          logging.interceptor.ts     ← 操作日志记录
        decorators/
          current-partner.decorator.ts

      admin/
        admin.module.ts
        job-sources/
          job-sources.controller.ts  ← GET/PATCH /admin/job-sources
          job-sources.service.ts
          dto/
            admin-job-source.dto.ts
        fair-sources/
          fair-sources.controller.ts ← GET/PATCH /admin/fair-sources
          fair-sources.service.ts
          dto/
            admin-fair-source.dto.ts

      partner/
        partner.module.ts
        jobs/
          partner-jobs.controller.ts ← GET/PATCH /partner/jobs
          partner-jobs.service.ts
          dto/
            partner-job.dto.ts
        fairs/
          partner-fairs.controller.ts ← GET/PATCH /partner/fairs
          partner-fairs.service.ts
          dto/
            partner-fair.dto.ts
        sync-logs/
          sync-logs.controller.ts    ← GET /partner/sync-logs
          sync-logs.service.ts
          dto/
            sync-log.dto.ts
        data-sources/
          data-sources.controller.ts ← GET/POST/PATCH /partner/data-sources
          data-sources.service.ts
          dto/
            data-source.dto.ts

      kiosk/
        kiosk.module.ts
        job-fairs/
          job-fairs.controller.ts    ← GET /job-fairs, /job-fairs/:id, ...
          job-fairs.service.ts
          dto/
            job-fair.dto.ts
            fair-company.dto.ts
            fair-map.dto.ts
            fair-material.dto.ts
            fair-stats.dto.ts
        jobs/
          jobs.controller.ts         ← GET /jobs, /jobs/:id
          jobs.service.ts
          dto/
            external-job.dto.ts

      auth/
        auth.module.ts
        auth.service.ts              ← Phase 7.6 stub，直接返回固定 partnerId/adminId
        strategies/
          jwt.strategy.ts
```

---

## 3. Prisma Schema（初稿）

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── 合作机构 ────────────────────────────────────────────────────────────────

model Partner {
  id            String   @id @default(cuid())
  name          String
  partnerType   String   // PartnerType enum
  sceneTemplate String   // SceneTemplate enum
  coopStatus    String   @default("active")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  dataSources   DataSource[]
  externalJobs  ExternalJob[]
  externalFairs ExternalJobFair[]
  syncLogs      SyncLog[]
}

// ─── 数据源配置 ────────────────────────────────────────────────────────────

model DataSource {
  id                   String   @id @default(cuid())
  partnerId            String
  partner              Partner  @relation(fields: [partnerId], references: [id])
  name                 String
  sourceKind           String   // SourceKind
  accessMode           String   // AccessMode
  syncFreq             String   @default("manual")
  isEnabled            Boolean  @default(true)
  credentialConfigured Boolean  @default(false)
  // credentialJson 仅服务端读写，禁止出现在任何前端 DTO
  credentialJson       Json?
  lastSyncAt           DateTime?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  syncLogs SyncLog[]
}

// ─── 外部岗位 ────────────────────────────────────────────────────────────────

model ExternalJob {
  id            String   @id @default(cuid())
  partnerId     String
  partner       Partner  @relation(fields: [partnerId], references: [id])
  externalId    String
  title         String
  company       String
  city          String
  salary        String?
  category      String   // JobCategory
  tags          String[] @default([])
  description   String?
  requirements  String?
  sourceUrl     String
  sourceName    String   // 由服务端从 Partner.name 填充
  sourceOrgId   String
  syncTime      DateTime @default(now())
  reviewStatus  String   @default("pending")   // ReviewStatus
  publishStatus String   @default("draft")     // PublishStatus
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([partnerId, externalId])
  @@index([reviewStatus, publishStatus])
}

// ─── 外部招聘会 ──────────────────────────────────────────────────────────────

model ExternalJobFair {
  id            String   @id @default(cuid())
  partnerId     String
  partner       Partner  @relation(fields: [partnerId], references: [id])
  externalId    String
  name          String
  organizer     String
  startTime     DateTime
  endTime       DateTime
  venue         String
  status        String   // JobFairStatus (upcoming/ongoing/ended)
  sourceUrl     String
  sourceName    String
  sourceOrgId   String
  syncTime      DateTime @default(now())
  reviewStatus  String   @default("pending")
  publishStatus String   @default("draft")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([partnerId, externalId])
  @@index([reviewStatus, publishStatus, status])
}

// ─── 同步日志 ────────────────────────────────────────────────────────────────

model SyncLog {
  id           String    @id @default(cuid())
  no           String    // 显示用编号，如 SL-20260526-001
  partnerId    String
  partner      Partner   @relation(fields: [partnerId], references: [id])
  dataSourceId String?
  dataSource   DataSource? @relation(fields: [dataSourceId], references: [id])
  dataType     String    // SyncDataType: job/fair/policy
  successCount Int       @default(0)
  failCount    Int       @default(0)
  dupCount     Int       @default(0)
  errorFields  String?   // 逗号分隔的异常字段名
  failReason   String?
  result       String    // SyncResult: success/partial/failed
  syncTime     DateTime  @default(now())
}
```

> **安全约束**：`DataSource.credentialJson` 仅由服务端读写，**禁止出现在任何前端 DTO** （前端只读 `credentialConfigured: boolean`）。

---

## 4. API 端点设计

### 4.1 通用响应格式

**成功响应：**
```json
{
  "data": { ... },
  "meta": { "timestamp": "2026-05-26T10:00:00Z" }
}
```

**分页响应：**
```json
{
  "data": [...],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "timestamp": "2026-05-26T10:00:00Z"
  }
}
```

**错误响应：**
```json
{
  "error": {
    "code": "DATA_NOT_FOUND",
    "message": "找不到指定记录"
  }
}
```

错误码规范：`SNAKE_UPPER_CASE`，前端 `ApiHttpError.code` 与之对应。

---

### 4.2 Admin 端点

所有路径前缀：`/api/v1/admin/`  
鉴权：`AdminAuthGuard`（Phase 7.6 先 passthrough）

#### `GET /admin/job-sources`

返回所有外部岗位待审核/已审核列表（含分页）。  
响应解决 **R1**：返回完整 `ExternalJob` 字段，含 `sourceUrl`、`description`、`tags`、`requirements`。

```typescript
// 查询参数
interface AdminJobSourcesQuery {
  reviewStatus?: ReviewStatus
  publishStatus?: PublishStatus
  page?: number
  pageSize?: number
}

// 响应 DTO（解决 R1：补全全部字段）
interface AdminJobSourceDTO {
  id: string
  partnerId: string
  sourceName: string    // 来源机构名（来自 Partner.name）
  sourceOrgId: string
  externalId: string
  title: string
  company: string
  city: string
  salary?: string
  category: JobCategory
  tags: string[]
  description?: string
  requirements?: string
  sourceUrl: string     // R1 补全：admin 可点击验证来源
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
}
```

#### `PATCH /admin/job-sources/:id`

更新单条岗位的审核/发布状态。请求体：

```typescript
interface AdminUpdateJobSourceBody {
  action: 'approve' | 'reject' | 'publish' | 'unpublish'
  reason?: string   // 拒绝时必填
}
```

状态转换规则（服务端强制）：
- `approve`：`reviewStatus` pending/reviewing → approved，`publishStatus` → draft
- `reject`：`reviewStatus` pending/reviewing → rejected
- `publish`：`publishStatus` draft/unpublished → published（前提：reviewStatus === approved）
- `unpublish`：`publishStatus` published → unpublished

**同样结构适用于 `GET/PATCH /admin/fair-sources`。**

---

### 4.3 Partner 端点

所有路径前缀：`/api/v1/partner/`  
鉴权：`PartnerAuthGuard`（Phase 7.6 先 passthrough，固定 partnerId）

#### `GET /partner/jobs`

返回当前 partner 的岗位列表。

```typescript
// 响应 DTO（解决 R2：注入 sourceName）
interface PartnerJobDTO {
  id: string
  externalId: string
  title: string
  company: string
  city: string
  category: JobCategory
  sourceUrl: string
  sourceName: string    // R2 修复：服务端从 Partner.name 填充
  sourceOrgId: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
}
```

#### `PATCH /partner/jobs/:id`

```typescript
interface PartnerUpdateJobBody {
  action: 'unpublish'
}
```

#### `GET /partner/fairs` / `PATCH /partner/fairs/:id`

结构同 jobs，`PartnerFairDTO` 含 `status: JobFairStatus`（R2 同样修复）。

#### `GET /partner/sync-logs`

返回当前 partner 的同步日志列表（只读）。

```typescript
// 响应 DTO（解决 R3：统一字段命名）
interface PartnerSyncLogDTO {
  id: string
  no: string
  source: string        // DataSource.name
  dataType: SyncDataType
  successCount: number  // R3：统一用 successCount（不用 addedCount）
  failCount: number     // R3：统一用 failCount（不用 errorCount）
  dupCount: number      // R3：补全到共享类型
  errorFields: string | null
  failReason: string | null
  result: SyncResult    // R3：统一用 result（不用 status）
  syncTime: string
}
```

#### `GET /partner/data-sources`

```typescript
// 响应 DTO（解决 R4：返回 DataSourceConfig 结构）
interface PartnerDataSourceDTO {
  id: string
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
  syncFreq: SyncFreq
  isEnabled: boolean
  credentialConfigured: boolean  // R4：敏感字段只暴露布尔值
  lastSyncAt: string | null
  // 派生展示字段（服务端计算）
  successCount: number
  failCount: number
  connStatus: 'connected' | 'error' | 'disabled'
}
```

#### `POST /partner/data-sources`

```typescript
interface CreateDataSourceBody {
  name: string
  sourceKind: SourceKind
  accessMode: AccessMode
}
```

#### `PATCH /partner/data-sources/:id`

```typescript
interface UpdateDataSourceBody {
  action: 'enable' | 'disable'
}
```

---

### 4.4 Kiosk 端点（只读）

所有路径前缀：`/api/v1/`  
鉴权：无（公开只读，已审核已发布数据）

自动过滤条件：`reviewStatus === 'approved' AND publishStatus === 'published'`

| 端点 | 说明 |
|------|------|
| `GET /job-fairs` | 招聘会列表，支持 `?status=upcoming\|ongoing\|ended` 筛选 |
| `GET /job-fairs/:id` | 招聘会详情 |
| `GET /job-fairs/:id/companies` | 参会企业列表 |
| `GET /job-fairs/:id/companies/:companyId` | 企业详情 |
| `GET /job-fairs/:id/zones` | 展区列表 |
| `GET /job-fairs/:id/map` | 展馆地图数据 |
| `GET /job-fairs/:id/materials` | 活动资料列表 |
| `GET /job-fairs/:id/stats` | 现场统计数据 |
| `GET /jobs` | 岗位列表，支持 `?tag=` 筛选 |
| `GET /jobs/:id` | 岗位详情 |

---

## 5. 审核状态机

```
                      ┌──────────┐
                      │ pending  │◄── 所有新数据默认状态
                      └────┬─────┘
                    admin: │ approve / reject
                  ┌────────┴────────┐
                  ▼                 ▼
           ┌──────────┐      ┌──────────┐
           │ approved │      │ rejected │  （终态，可重新提交覆盖）
           └────┬─────┘      └──────────┘
                │ publishStatus 独立管理
                ▼
          ┌──────────┐
          │  draft   │◄── approved 后默认
          └────┬─────┘
       admin:  │ publish
               ▼
          ┌───────────┐
          │ published │◄──────┐
          └────┬──────┘       │ re-publish
               │ unpublish    │
               ▼              │
          ┌─────────────┐     │
          │ unpublished ├─────┘
          └─────────────┘
```

---

## 6. 鉴权设计（Phase 7.6 占位）

Phase 7.6 先用**固定 stub**，不实现完整 JWT 体系：

```typescript
// common/guards/auth.guard.ts（Phase 7.6 stub）
@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true  // Phase 7.6：直接放行，后续替换为 JWT 验证
  }
}

@Injectable()
export class PartnerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Phase 7.6：注入固定 partnerId 到 Request，模拟已登录 partner
    const req = context.switchToHttp().getRequest()
    req.partnerId = 'PARTNER_DEV_001'
    return true
  }
}
```

真实 JWT 体系在 Phase 7.7 实现（账号体系）。

---

## 7. DTO 与共享类型对齐

Phase 7.6 修复 R1–R4 后，前端共享包 `packages/shared/src/types/` 需同步调整：

| 调整项 | 变更内容 |
|--------|---------|
| `SyncLogEntry`（`packages/shared/src/types/job.ts`） | 补全 `dupCount`、`errorFields`、`failReason` 字段；`result` 字段替代 `status` |
| Partner 服务类型 | `PartnerJobRecord.sourceName` 字段补全 |
| `DataSourceConfig` | 确认 `credentialConfigured: boolean` 是前端唯一可见的凭证字段 |

httpAdapter DTO 与 Prisma schema 的映射关系：

```
Prisma ExternalJob → AdminJobSourceDTO（全字段，解决 R1）
                   → ExternalJobDTO（Kiosk 展示字段子集）
                   → PartnerJobDTO（partner 视图，注入 sourceName，解决 R2）

Prisma SyncLog → PartnerSyncLogDTO（统一命名，解决 R3）

Prisma DataSource → PartnerDataSourceDTO（隐藏 credentialJson，解决 R4）
```

---

## 8. Phase 7.6 执行计划

> 按步骤顺序执行，每步完成后运行 `pnpm lint && pnpm typecheck`。

### Step 1 — NestJS 骨架初始化

```bash
cd services/api-server
pnpm init
pnpm add @nestjs/core @nestjs/common @nestjs/platform-express reflect-metadata rxjs
pnpm add -D @nestjs/cli typescript ts-node
```

目标：`npm run start:dev` 可启动，`GET /` 返回 200。

### Step 2 — Prisma schema + 种子数据

```bash
pnpm add @prisma/client
pnpm add -D prisma
npx prisma init
```

将第 3 节 schema 写入 `prisma/schema.prisma`；`seed.ts` 写入与前端 mock adapter 数据结构一致的种子数据（便于联调）。

### Step 3 — 公共层

实现：`ApiResponseDto`、`HttpExceptionFilter`、`LoggingInterceptor`、两个 stub Guard。

### Step 4 — Admin 模块

实现 `GET/PATCH /admin/job-sources` + `GET/PATCH /admin/fair-sources`，使用 Prisma Client 查询，返回完整 DTO（解决 R1）。

### Step 5 — Partner 模块

实现 8 个 Partner 端点，注意：
- `PartnerJobDTO`/`PartnerFairDTO` 注入 `sourceName`（R2）
- `PartnerSyncLogDTO` 字段命名统一（R3）
- `PartnerDataSourceDTO` 隐藏 `credentialJson`（R4）

### Step 6 — Kiosk 模块

实现 10 个 Kiosk 只读端点，强制过滤 `reviewStatus=approved AND publishStatus=published`。

### Step 7 — 前端切换 http 模式

```bash
# apps/kiosk/.env.local
VITE_API_MODE=http
VITE_API_BASE_URL=http://localhost:3000/api/v1

# apps/admin/.env.local
VITE_API_MODE=http
VITE_API_BASE_URL=http://localhost:3000/api/v1

# apps/partner/.env.local
VITE_API_MODE=http
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

切换后三端全部走 httpAdapter，验证 21 个端点均正常响应。

---

## 9. 不做的事（Phase 7.6 边界）

| 事项 | 原因 |
|------|------|
| 真实第三方 API 接入（招聘平台爬取/API 拉取） | Phase 7.7+ 做 |
| 真实文件上传/简历解析 | Phase 7.7+ 做 |
| 打印机接口（奔图 appKey/appSecret） | Phase 8 做 |
| 完整 JWT 账号体系 | Phase 7.7 做 |
| Excel 字段映射引擎（服务端解析） | Phase 7.7 做 |
| Windows Terminal Agent | Phase 8 做 |

---

*文档编写：Claude Code | 2026-05-26*
