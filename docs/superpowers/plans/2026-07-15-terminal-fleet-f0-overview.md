# Terminal Fleet F0 Read-only Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在既有 Admin `/devices` 页面增加面向 5–50 台终端的只读「设备总览」，通过独立白名单 GET 投影展示健康、Agent 版本、受限配置摘要、显式身份冲突和原页面深链。

**Architecture:** 后端新增 `device-fleet` 只读模块，使用 Prisma `select` 一次并行读取 Terminal 最近心跳与三类配置原始引用，再交给纯投影函数按内部主键组织、按 `terminalCode` 输出并显式标记 `terminalCode/id` 双引用、跨终端引用碰撞和孤儿配置。Admin 仅消费该脱敏契约，在现有 `/devices` 增加同页标签；HTTP/mock 适配器保持一致，组件不包含任何写操作。

**Tech Stack:** NestJS 11、Prisma 7（只读查询，无 schema/migration）、React 18、React Router、TypeScript、现有 `@ai-job-print/refresh`、Node `assert` 专项 verify、GitHub Actions。

---

## Scope and file ownership

功能归位：

- 后端：`services/api/src/device-fleet/`，仅只读 controller/service/projection/types。
- 前端：`apps/admin/src/routes/devices/` 与 Admin API adapters；不修改 `routes/terminals/index.tsx`。
- 终端/Kiosk/共享 UI/共享类型：不涉及。
- 数据库：仅现有表只读 `select`；不改双 Prisma schema/migration。
- 文档：本计划及两份进度 SSOT。

后端 worker 独占：

- Create `services/api/src/device-fleet/device-fleet.types.ts`
- Create `services/api/src/device-fleet/device-fleet.projection.ts`
- Create `services/api/src/device-fleet/device-fleet.service.ts`
- Create `services/api/src/device-fleet/device-fleet.controller.ts`
- Create `services/api/src/device-fleet/device-fleet.module.ts`
- Create `services/api/scripts/verify-device-fleet-overview.ts`
- Modify `services/api/src/app.module.ts`
- Modify `services/api/package.json`

前端 worker 独占：

- Create `apps/admin/src/routes/devices/TerminalFleetOverview.tsx`
- Create `apps/admin/scripts/verify-admin-device-fleet-overview-ui.mjs`
- Modify `apps/admin/src/routes/devices/index.tsx`
- Modify `apps/admin/src/services/api/types.ts`
- Modify `apps/admin/src/services/api/devices.ts`
- Modify `apps/admin/src/services/api/adminHttpAdapter.ts`
- Modify `apps/admin/src/services/api/adminMockAdapter.ts`
- Modify `apps/admin/package.json`

主 agent 独占：

- Modify `.github/workflows/ci.yml`
- Modify `docs/progress/current-progress.md`
- Modify `docs/progress/next-tasks.md`
- Maintain `.ccg/tasks/f0-terminal-fleet-overview/*`

禁止修改：`services/api/prisma/**`、`apps/terminal-agent/**`、`apps/kiosk/**`、打印/支付/凭据/生产配置代码。

## Locked API contract

```ts
type DeviceFleetHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'
type DeviceFleetConfigState = 'unconfigured' | 'configured' | 'legacy_reference' | 'conflict'
type DeviceFleetConfigArea = 'screensaver' | 'smart_campus' | 'toolbox'

interface DeviceFleetOverview {
  generatedAt: string
  onlineWindowSeconds: 180
  summary: {
    total: number
    healthy: number
    degraded: number
    offline: number
    unknown: number
    disabled: number
    configurationConflictTerminals: number
    orphanConfigurationRecords: number
  }
  terminals: Array<{
    terminalCode: string
    displayName: string | null
    locationLabel: string | null
    orgName: string | null
    enabled: boolean
    health: DeviceFleetHealth
    healthReason: 'heartbeat_fresh' | 'agent_reported_degraded' | 'agent_reported_offline' | 'agent_reported_error' | 'heartbeat_stale' | 'never_reported'
    lastHeartbeatAt: string | null
    agentVersion: string | null
    hasConfigurationConflict: boolean
    config: {
      screensaver: { state: DeviceFleetConfigState; enabled: boolean | null; playlistConfigured: boolean | null; updatedAt: string | null }
      smartCampus: { state: DeviceFleetConfigState; enabled: boolean | null; enabledModuleCount: number | null; updatedAt: string | null }
      toolbox: { state: DeviceFleetConfigState; enabled: boolean | null; itemCount: number | null; updatedAt: string | null }
    }
  }>
  issues: Array<{
    area: DeviceFleetConfigArea
    kind: 'dual_reference_config' | 'cross_terminal_reference_collision' | 'orphan_config'
    affectedTerminalCodes: string[]
  }>
}
```

白名单不得出现：`id`、`orgId`、`macAddress`、`ipAddress`、`deviceFingerprint`、`agentToken`、`bindCode`、`codeHash`、`printerStatus`、`localTaskDatabaseAvailable`、`diskFreeGb`、capabilities、文件/打印/扫描/用户数据。

冲突解析规则：

1. Terminal 输出始终一行一个内部 `id`，不按 `terminalCode` 去重；响应只暴露 `terminalCode`。
2. 单个配置引用只命中该终端 `terminalCode`：`configured`。
3. 单个配置引用只命中该终端内部 `id`：`legacy_reference`，允许展示摘要但不自动迁移。
4. 同一终端 code/id 两条配置同时存在：`conflict` + `dual_reference_config`，摘要值全部置 `null`，禁止选择其一。
5. 一个引用同时属于终端 A 的 code 与终端 B 的 id：受影响终端对应配置为 `conflict` + `cross_terminal_reference_collision`，禁止分配。
6. 配置引用无任何 Terminal owner：只增加 `orphan_config` issue/count，不返回原始引用值。

### Task 1: Backend RED — executable projection/security verify

**Files:**

- Create: `services/api/scripts/verify-device-fleet-overview.ts`
- Modify: `services/api/package.json`

- [x] **Step 1: Write the failing verify first**

脚本用 `node:assert/strict` 导入尚不存在的 `buildDeviceFleetOverview`，固定 `now = new Date('2026-07-15T06:00:00.000Z')`，构造以下用例：

```ts
const terminals = [
  { id: 'internal-a', terminalCode: 'KSK-001', enabled: true, heartbeats: [{ status: 'online', agentVersion: '0.3.0', createdAt: new Date('2026-07-15T05:59:00Z') }] },
  { id: 'internal-b', terminalCode: 'KSK-002', enabled: true, heartbeats: [{ status: 'agent_degraded', agentVersion: '0.2.9', createdAt: new Date('2026-07-15T05:59:00Z') }] },
  { id: 'internal-c', terminalCode: 'KSK-003', enabled: false, heartbeats: [{ status: 'online', agentVersion: null, createdAt: new Date('2026-07-15T05:50:00Z') }] },
  { id: 'internal-d', terminalCode: 'KSK-004', enabled: true, heartbeats: [] },
]
```

分别断言 fresh/degraded/stale/never-reported 四态，并在质量审查后补齐 fresh `offline` / `error` / `null` / 未知状态的诚实映射；为 `KSK-001/internal-a` 同时放两条 toolbox 配置断言 `dual_reference_config`；构造 `Terminal.id === another Terminal.terminalCode` 断言跨终端碰撞；放一条未知引用断言 orphan count；递归扫描结果键名，断言禁止字段集合交集为空。

脚本再静态读取 controller/service，断言只存在 `@Get()`、`JwtAuthGuard`、`RolesGuard`、`@Roles('admin')`，并且 service 的 Prisma select 不含禁止字段。

- [x] **Step 2: Register and run RED**

在 API `package.json` 增加：

```json
"verify:device-fleet-overview": "node -r @swc-node/register scripts/verify-device-fleet-overview.ts"
```

Run:

```bash
pnpm --filter @ai-job-print/api verify:device-fleet-overview
```

Expected: FAIL，原因是 `../src/device-fleet/device-fleet.projection` 尚不存在（不是语法或环境错误）。

### Task 2: Backend GREEN — strict read-only projection and GET endpoint

**Files:**

- Create: `services/api/src/device-fleet/device-fleet.types.ts`
- Create: `services/api/src/device-fleet/device-fleet.projection.ts`
- Create: `services/api/src/device-fleet/device-fleet.service.ts`
- Create: `services/api/src/device-fleet/device-fleet.controller.ts`
- Create: `services/api/src/device-fleet/device-fleet.module.ts`
- Modify: `services/api/src/app.module.ts`

- [x] **Step 1: Define response and raw projection types**

按 Locked API contract 定义只读响应类型；raw 类型仅在后端内部包含 `id` 与配置 `terminalId`，不得从投影函数返回。

- [x] **Step 2: Implement pure projection**

导出：

```ts
export const DEVICE_FLEET_ONLINE_WINDOW_MS = 3 * 60 * 1000
export function buildDeviceFleetOverview(input: DeviceFleetProjectionInput, now: Date): DeviceFleetOverview
```

使用新 `Map`/`Set` 和不可变数组结果；JSON 计数使用 fail-closed helper：解析失败返回 `0`，不透传原 JSON。issue 按 `area/kind/affectedTerminalCodes.join(',')` 排序，终端按 `terminalCode` 排序，保证验证稳定。

- [x] **Step 3: Implement whitelist Prisma reads**

`DeviceFleetService.getOverview()` 通过一个 `Promise.all` 执行四类 `findMany`：

```ts
this.prisma.terminal.findMany({
  orderBy: { terminalCode: 'asc' },
  select: {
    id: true,
    terminalCode: true,
    displayName: true,
    locationLabel: true,
    enabled: true,
    org: { select: { name: true } },
    heartbeats: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, agentVersion: true, createdAt: true } },
  },
})
```

三类配置只 select `terminalId/enabled/updatedAt` 与各自计数字段：screensaver `playlistId`、smart campus `modulesJson`、toolbox `itemsJson`。不得 include playlist/items/URL 或任何打印/用户关系。

- [x] **Step 4: Add guarded GET controller/module**

```ts
@Controller('admin/device-fleet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class DeviceFleetController {
  constructor(private readonly service: DeviceFleetService) {}

  @Get('overview')
  async overview(): Promise<ApiResponse<DeviceFleetOverview>> {
    return ApiResponse.ok(await this.service.getOverview())
  }
}
```

Module 仅声明 controller/service；`PrismaModule` 已 `@Global`。在 `AppModule.imports` 注册 `DeviceFleetModule`。

- [x] **Step 5: Run GREEN and backend checks**

```bash
pnpm --filter @ai-job-print/api verify:device-fleet-overview
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
```

Expected: verify 输出所有断言 PASS；typecheck/lint exit 0。

### Task 3: Admin RED — static contract/UI guard

**Files:**

- Create: `apps/admin/scripts/verify-admin-device-fleet-overview-ui.mjs`
- Modify: `apps/admin/package.json`

- [x] **Step 1: Write static guard first**

用 `node:assert/strict` 读取目标文件并断言：

- `devices/index.tsx` 存在 `overview` / `设备总览` / `TerminalFleetOverview`。
- `devices.ts`、HTTP、mock 三处存在 `getDeviceFleetOverview`，HTTP 仅 `getData(...'/admin/device-fleet/overview')`。
- 组件含 `useRefreshable`、`30_000`、`failPolicy: 'keep-last'`、`caption`、`scope="col"`、`role="alert"`、`aria-busy`。
- 组件含 `/devices?tab=terminals&search=`、`/screensaver`、`/smart-campus`、`/toolbox` 深链。
- 组件/新 API 类型不存在 `macAddress|ipAddress|bindCode|agentToken|printerStatus|printTask|scanTask|endUser`。
- 组件不存在 `createTerminalBindCode|updateTerminalProfile|assignTerminalOrg|postData|putData|patchData|deleteData`。
- F1/F2 文案明确为 `CLOSED_MODE`，没有换机/发布操作按钮。

- [x] **Step 2: Register and run RED**

```json
"verify:admin-device-fleet-overview-ui": "node scripts/verify-admin-device-fleet-overview-ui.mjs"
```

Run:

```bash
pnpm --filter @ai-job-print/admin verify:admin-device-fleet-overview-ui
```

Expected: FAIL，因为组件和适配器出口尚不存在。

### Task 4: Admin GREEN — same-route read-only overview

**Files:**

- Create: `apps/admin/src/routes/devices/TerminalFleetOverview.tsx`
- Modify: `apps/admin/src/routes/devices/index.tsx`
- Modify: `apps/admin/src/services/api/types.ts`
- Modify: `apps/admin/src/services/api/devices.ts`
- Modify: `apps/admin/src/services/api/adminHttpAdapter.ts`
- Modify: `apps/admin/src/services/api/adminMockAdapter.ts`

- [x] **Step 1: Add frontend contract and adapters**

在 `types.ts` 镜像 Locked API contract；在 device service interface 暴露 `getDeviceFleetOverview()`；HTTP 使用：

```ts
getDeviceFleetOverview: () =>
  getData<DeviceFleetOverview>('/admin/device-fleet/overview')
```

mock 使用固定合成数据覆盖 healthy/degraded/offline/unknown、legacy reference、conflict 与 orphan summary；不得复用含 MAC/IP 的 `getTerminals()` mock。

- [x] **Step 2: Build accessible read-only component**

使用：

```ts
const { data, status, refresh } = useRefreshable(
  'admin-device-fleet-overview',
  getDeviceFleetOverview,
  { intervalMs: 30_000, failPolicy: 'keep-last' },
)
```

布局：6 个统计卡（总数/健康/需关注/离线/未知/停用）；存在冲突或孤儿配置时显示 `role="alert"` 文字告警；表格列为终端/健康/Agent 版本/机构与位置/屏保/智慧校园/百宝箱/原页面。状态必须同时有中文文字和颜色，不使用仅色彩表达。

每行深链：

```tsx
<Link to={`/devices?tab=terminals&search=${encodeURIComponent(row.terminalCode)}`}>查看终端</Link>
```

配置列分别链接 `/screensaver`、`/smart-campus`、`/toolbox`。表格包含 `<caption className="sr-only">终端设备只读总览</caption>` 和所有 `th scope="col"`；加载容器 `aria-busy`；错误提示 `role="alert"`；无写按钮。

- [x] **Step 3: Add same-page tab**

在现有 TABS 前部增加 `{ key: 'overview', label: '设备总览', icon: LayoutDashboardIcon }`，并渲染 `<TerminalFleetOverview />`；默认仍为 `terminals`，不改历史路由。

- [x] **Step 4: Run GREEN and Admin checks**

```bash
pnpm --filter @ai-job-print/admin verify:admin-device-fleet-overview-ui
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin build
```

Expected: verify PASS；typecheck/lint/build exit 0。

### Task 5: CI and truth documentation

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [x] **Step 1: Wire both focused verifies into the existing main verify block**

加入：

```yaml
pnpm --filter @ai-job-print/admin verify:admin-device-fleet-overview-ui
pnpm --filter @ai-job-print/api verify:device-fleet-overview
```

不修改 postgres-readiness 数据库步骤，因为专项 verify 为纯投影/静态门禁；`db:pg:sync:check` 由现有 job 继续证明无 schema 漂移。

- [x] **Step 2: Correct F0 documentation truth**

`current-progress.md` 新增 2026-07-15 本地候选记录，明确代码、verify、双模型门禁与未做边界。`next-tasks.md` 将 F0 条目中的“候选机状态”删除，改为健康/版本/三类配置摘要/冲突/深链；若实现与验证完成则标记本地代码级完成，但保留未合并/未部署事实。F1/F2 继续 CLOSED_MODE。

### Task 6: Full verification and review

**Files:**

- Modify after findings only within the file ownership above.
- Update: `.ccg/tasks/f0-terminal-fleet-overview/review.md`

- [x] **Step 1: Run full scoped verification fresh**

```bash
pnpm --filter @ai-job-print/api verify:device-fleet-overview
pnpm --filter @ai-job-print/admin verify:admin-device-fleet-overview-ui
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api lint
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin build
pnpm --filter @ai-job-print/api db:pg:sync:check
git diff --check
git status --short --branch
```

- [x] **Step 2: Scope/security inspection**

```bash
git diff --name-only f04522c8
git diff -- services/api/prisma apps/terminal-agent apps/kiosk
```

Expected: 第一条仅含本计划“Scope and file ownership”列出的代码、门禁与文档文件；第二条无输出。递归检查新 GET 示例响应不含禁止键，不存在写方法、审计写入或日志敏感数据。

- [x] **Step 3: Review**

派只读 code reviewer 与 security reviewer 检查正确性/脱敏/冲突/只读边界；并行运行 Claude 与 Antigravity reviewer。Critical/High 必须修复并重跑；Antigravity 若仍未登录，记录退出码和阻塞，禁止写成批准。

- [x] **Step 4: Browser smoke only if local mock startup is clean**

启动 Admin mock dev server，浏览 `/devices?tab=overview`，检查状态文字、冲突告警和原终端深链；实际点击首行后进入 `/devices?tab=terminals&search=KSK-001` 并正确过滤为 1 条，控制台 Errors 为 0。该证据仅是本地 mock UI，不代表 live API、生产、Windows、换机或真机验收。

## Plan self-review

- Spec coverage：覆盖严格 GET、Admin 同页标签、健康/版本/受限配置、冲突、深链、敏感字段排除和 F1/F2 CLOSED_MODE。
- Placeholder scan：没有未决占位内容。
- Type consistency：后端与 Admin 使用同一字段名；输出无内部 `id`，深链使用 `terminalCode + search`。
- Scope：未包含 Prisma/Agent/Kiosk/打印/生产/换机写操作；文件所有权无交叉。
- Review：内部规格/质量复审通过；Claude 与 Antigravity 最终均返回有效 `APPROVE`，Critical / Warning 为 0。
