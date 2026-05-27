# Phase 7.4 + Phase 7.5 Service Layer 复查报告

> 复查日期：2026-05-26  
> 范围：Admin service（Phase 7.4）、Partner service（Phase 7.5）  
> 方法：静态代码分析 + 全文 grep 合规词审查

---

## 1. Admin Service（Phase 7.4）

### 1.1 文件清单

| 文件 | 职责 | 状态 |
|------|------|------|
| `apps/admin/src/services/api/client.ts` | `API_MODE`、`API_BASE_URL`、`ApiHttpError` | ✅ |
| `apps/admin/src/services/api/types.ts` | `AdminJobSourceRecord`、`AdminFairSourceRecord`、`JobFairStatus` | ✅ |
| `apps/admin/src/services/api/adminMockAdapter.ts` | 模块级可变状态、120ms 延迟、8 个异步方法 | ✅ |
| `apps/admin/src/services/api/adminHttpAdapter.ts` | `GET/PATCH` fetch、`ApiHttpError` throw | ✅ |
| `apps/admin/src/services/api/sources.ts` | `AdminSourceServiceInterface`、adapter 选择、8 个导出函数 | ✅ |
| `apps/admin/src/services/api/index.ts` | `export * from './client'` + `'./sources'` | ✅ |

### 1.2 job-sources 页面（`apps/admin/src/routes/job-sources/index.tsx`）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不再持有大块内联 mock | ✅ | `MOCK_JOB_SOURCES` 已移除 |
| 本地类型声明已清除 | ✅ | `ReviewStatus`/`PublishStatus`/`JobSource` 均从 `../../services/api` 导入 |
| 通过 `useEffect` + 取消标记加载数据 | ✅ | `let cancelled = false` 模式正确 |
| 有 loading/error 状态 | ✅ | 两个状态均有对应 UI |
| 所有 mutation 通过 service 方法 | ✅ | `approveJobSource`/`publishJobSource`/`unpublishJobSource` 均异步调用 |
| http 模式无 fallback mock | ✅ | `adminHttpAdapter` 所有失败路径以 `throw new ApiHttpError` 结束，无 mock 调用路径 |

### 1.3 fair-sources 页面（`apps/admin/src/routes/fair-sources/index.tsx`）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不再持有大块内联 mock | ✅ | `MOCK_FAIR_SOURCES` 已移除 |
| 本地类型声明已清除 | ✅ | `FairStatus` → `JobFairStatus`（shared 统一类型） |
| 通过 `useEffect` + 取消标记加载数据 | ✅ | |
| 所有 mutation 通过 service 方法 | ✅ | `approveFairSource`/`publishFairSource`/`unpublishFairSource` |
| http 模式无 fallback mock | ✅ | |

**Admin Service 复查结论：✅ 全部通过**

---

## 2. Partner Service（Phase 7.5）

### 2.1 文件清单

| 文件 | 职责 | 状态 |
|------|------|------|
| `apps/partner/src/services/api/client.ts` | `API_MODE`、`API_BASE_URL`、`ApiHttpError` | ✅ |
| `apps/partner/src/services/api/types.ts` | 数据源/岗位/招聘会/同步日志共 9 个类型 | ✅ |
| `apps/partner/src/services/api/partnerMockAdapter.ts` | 4 组 module-level 状态、11 个异步方法 | ✅ |
| `apps/partner/src/services/api/partnerHttpAdapter.ts` | `GET/PATCH/POST` fetch、`ApiHttpError` throw | ✅ |
| `apps/partner/src/services/api/dataSources.ts` | 数据源 3 个导出函数 | ✅ |
| `apps/partner/src/services/api/partnerContent.ts` | 岗位/招聘会/日志 5 个导出函数 | ✅ |
| `apps/partner/src/services/api/index.ts` | `client` + `dataSources` + `partnerContent` | ✅ |

### 2.2 sources 页面（`apps/partner/src/routes/sources/index.tsx`）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 数据源列表不再内联 | ✅ | `INITIAL_SOURCES` 移入 `partnerMockAdapter` |
| useEffect 加载 | ✅ | `getDataSources()` |
| toggle 通过 service | ✅ | `toggleDataSource(id)` → 更新局部 state |
| createDataSource 通过 service | ✅ | 向导完成后调 `createDataSource(name)` |
| Excel 导入向导保留 mock adapter 边界 | ✅ | `MOCK_DETECTED_FIELDS`/`MOCK_RECORDS` 等向导仿真常量留在页面层，向导 UI 不属于数据访问层 |
| http 模式无 fallback mock | ✅ | `partnerHttpAdapter` 所有失败路径以 throw 结束 |

### 2.3 jobs 页面（`apps/partner/src/routes/jobs/index.tsx`）

> 本轮复查中发现此页面仍持有内联 mock，已同步修复。

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不再持有大块内联 mock | ✅（修复后） | `MOCK_JOBS` 移入 `partnerMockAdapter` |
| 本地类型声明已清除 | ✅（修复后） | `JobCategory`/`ReviewStatus`/`PublishStatus`/`PartnerJob` 均从 `../../services/api` 导入 |
| useEffect 加载 + 取消标记 | ✅ | |
| unpublish 通过 service | ✅ | `unpublishPartnerJob(id)` |
| http 模式无 fallback mock | ✅ | |

### 2.4 fairs 页面（`apps/partner/src/routes/fairs/index.tsx`）

> 本轮复查中发现此页面仍持有内联 mock，已同步修复。

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不再持有大块内联 mock | ✅（修复后） | `MOCK_FAIRS` 移入 `partnerMockAdapter` |
| 本地类型声明已清除 | ✅（修复后） | `FairStatus` → `JobFairStatus`（shared 统一类型） |
| useEffect 加载 + 取消标记 | ✅ | |
| unpublish 通过 service | ✅ | `unpublishPartnerFair(id)` |
| http 模式无 fallback mock | ✅ | |

### 2.5 sync-logs 页面（`apps/partner/src/routes/sync-logs/index.tsx`）

> 本轮复查中发现此页面仍持有内联 mock，已同步修复。

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 不再持有大块内联 mock | ✅（修复后） | `MOCK_LOGS` 移入 `partnerMockAdapter` |
| 本地类型声明已清除 | ✅（修复后） | `SyncDataType`/`SyncResult`/`SyncLog` 从 `../../services/api` 导入 |
| useEffect 加载 + 取消标记 | ✅ | 只读页面，无 mutation |
| http 模式无 fallback mock | ✅ | |

**Partner Service 复查结论：✅ 全部通过（包含本轮同步修复的 3 个页面）**

---

## 3. 合规检查

全文 grep（三端全部 `src/` 目录）未发现以下禁用词：

| 禁用词 | 结果 |
|--------|------|
| 一键投递 | ✅ 未出现 |
| 立即投递 | ✅ 未出现 |
| 平台内投递 | ✅ 未出现 |
| 企业查看简历 | ✅ 未出现 |
| 候选人管理 | ✅ 未出现（`PROHIBITED_MODULES` 中枚举为已禁用，非功能实现）|
| 简历筛选 | ✅ 未出现 |
| 面试邀约 | ✅ 未出现（`PROHIBITED_MODULES` 中枚举为已禁用，非功能实现）|
| Offer 管理 | ✅ 未出现（`PROHIBITED_MODULES` 中枚举为已禁用，非功能实现）|

所有涉及合规说明的页面底部均有"不在本系统内接收求职者简历，不参与招聘闭环"声明。

---

## 4. 文档状态

| 文档 | 状态 | 说明 |
|------|------|------|
| `docs/api/api-client-adapter.md` | ⚠️ 待补充 | 当前只记录 Kiosk service adapter，Admin/Partner 架构未记录 |
| `docs/progress/current-progress.md` | ⚠️ 待更新 | Phase 7.4/7.5 完成情况未记录 |
| `docs/progress/next-tasks.md` | ⚠️ 待更新 | Phase 7.6 未列入 |

> 文档更新已在本次任务中同步完成，见对应文档。

---

## 5. 质检结果

| 检查项 | 结果 |
|--------|------|
| `pnpm lint` | ✅ 0 warnings |
| `pnpm typecheck` | ✅ 0 errors |
| `pnpm build` | ✅ 三端全部通过（admin 369KB / partner 337KB / kiosk 409KB） |

---

## 6. 遗留结构性风险（Phase 7.6 API 设计时需解决）

以下差异在 mock adapter 阶段可接受，后端 API 设计时必须对齐：

| # | 位置 | 差异 | 解决方向 |
|---|------|------|---------|
| R1 | `admin/job-sources` + `admin/fair-sources` | `AdminJobSourceRecord` 缺少 `sourceUrl`、`sourceOrgId`、`description`、`tags`、`requirements` | Phase 7.6 admin 审核 API 返回完整 `ExternalJob/ExternalJobFair` 字段 |
| R2 | `partner/jobs` + `partner/fairs` | `PartnerJobRecord` 缺少 `sourceName`（只有 `sourceOrgId`） | Phase 7.6 API 由服务端从机构账号查 `sourceName` |
| R3 | `partner/sync-logs` `PartnerSyncLog` vs 共享 `SyncLogEntry` | 字段命名不同（`successCount/addedCount`、`result/status`）；`dupCount/errorFields/failReason` 共享类型未定义 | Phase 7.6 API 在 `SyncLogEntry` 补齐字段，统一命名 |
| R4 | `partner/sources` `PartnerDataSource` vs 共享 `DataSourceConfig` | 完全自定义视图模型 | Phase 7.6 API `/data-sources` 返回 `DataSourceConfig`，前端从中派生展示字段 |

---

*复查人：Claude Code | 2026-05-26*
