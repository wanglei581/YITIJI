# Phase 6.5 数据链路一致性复查

> 复查时间：2026-05-25  
> 复查人：Codex  
> 范围：Kiosk / Admin / Partner 三端外部岗位、招聘会、数据源、同步日志相关 mock 数据与 shared 类型

## 复查结论

Phase 6.5 可以封板，允许进入 Phase 7 后端 API 与数据模型设计。

Claude 对 6 项小修的处理方向正确：审核状态、发布状态、来源字段和招聘会状态命名已经与 `packages/shared/src/types/job.ts` 的核心语义对齐。当前遗留的 R1-R4 属于 Phase 7 API/DTO 层面的结构性风险，不建议在前端 mock 阶段用临时 adapter 掩盖。

## 验收结果

| 检查项 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |

说明：首次 `pnpm build` 因沙箱无法写入 `tsconfig.tsbuildinfo` 失败，提权后构建三端均通过。构建日志仅有 Node `DEP0205 module.register()` deprecation warning，不阻塞当前阶段。

## 通过项

### 1. shared 状态模型已统一

`packages/shared/src/types/job.ts` 当前定义：

- `ReviewStatus`: `pending | reviewing | approved | rejected`
- `PublishStatus`: `draft | published | unpublished | expired`
- `JobFairStatus`: `upcoming | ongoing | ended`

Admin 与 Partner 的岗位/招聘会页面本地状态值已覆盖这些状态，没有发现旧的 `published` 审核状态或缺失 `reviewing/draft/expired` 的情况。

### 2. 审核与发布流程语义正确

Admin 岗位信息源和招聘会信息源已按两段式处理：

- `审核通过`: `reviewStatus -> approved`，`publishStatus -> draft`
- `发布`: `publishStatus -> published`
- `下架`: `publishStatus -> unpublished`

这避免了“审核通过即发布”的语义混淆，符合后续后端审核流设计。

### 3. 来源字段命名已完成小修

已确认以下命名对齐：

- `sourceOrg` 已改为 `sourceName`
- `reserveUrl` 已改为 `sourceUrl`
- `fairStatus` 已改为 `status`

Kiosk 标准数据、Admin 信息源、Partner 岗位/招聘会页面的核心字段语义一致。

### 4. 合规边界未跑偏

代码中未发现新增以下功能：

- 平台内一键投递
- 候选人管理
- 简历筛选
- 企业端面试邀约
- 企业收简历

命中词主要集中在合规文档、进度文档和允许文案“去来源平台投递”中。当前页面仍保持“第三方来源信息展示 + 外部来源跳转/二维码”的产品边界。

## 发现的问题

未发现阻塞 Phase 6.5 封板的问题。

需要注意的是，Partner `jobs/fairs`、Admin `job-sources/fair-sources` 当前仍使用页面内本地接口而不是直接引用 `ExternalJob / ExternalJobFair`。这在 mock 阶段可接受，但 Phase 7 需要通过后端 DTO 收敛。

## R1-R4 风险确认

### R1: Admin 信息源缺完整来源字段

确认属于 Phase 7 结构性风险。

Admin 当前表格只展示审核所需最小字段，缺少 `sourceUrl`、`sourceOrgId`、`description`、`tags`、`requirements` 等完整外部数据字段。若当前阶段强行补齐，会把审核表格变重，也无法代表真实 API 形态。

Phase 7 应由 Admin 审核 API 返回完整 `ExternalJob / ExternalJobFair` DTO，前端按详情/列表场景分别展示。

### R2: Partner jobs/fairs 缺 sourceName

确认属于 Phase 7 结构性风险。

Partner 当前有 `sourceOrgId`，无 `sourceName`。这符合“合作机构账号上下文自动补充来源名称”的设计方向，不应要求合作机构手动填写来源机构名称。

Phase 7 应由服务端根据登录机构账号或数据源配置补全 `sourceName`。

### R3: SyncLog 本地字段与 SyncLogEntry 共享类型不一致

确认属于 Phase 7 结构性风险。

Partner 同步日志需要展示 `dupCount`、`errorFields`、`failReason` 等运营字段，shared 当前 `SyncLogEntry` 只覆盖基础计数。当前强行改成 shared 类型会丢失运营信息。

Phase 7 应扩展同步日志 DTO，统一 `successCount/failCount/result` 与 `addedCount/errorCount/status` 的命名。

### R4: DisplaySource 不对应 DataSourceConfig

确认属于 Phase 7 结构性风险。

Partner 数据源列表当前是视图模型 `DisplaySource`，字段与 `DataSourceConfig` 差异较大。这是前端 mock 展示模型，不应在当前阶段写临时转换器。

Phase 7 应由 `/data-sources` API 返回标准 `DataSourceConfig`，前端再从标准数据派生列表展示字段。

## 是否允许进入 Phase 7

允许进入 Phase 7。

建议 Phase 7 第一项不是直接写接口，而是先定义数据表与 API DTO：

1. 外部岗位 / 招聘会标准 DTO
2. 数据源配置 DTO
3. 导入批次与导入记录 DTO
4. 审核发布 DTO
5. 同步日志 DTO

完成 DTO 设计后，再实现后端 API 和前端 mock 数据替换。
