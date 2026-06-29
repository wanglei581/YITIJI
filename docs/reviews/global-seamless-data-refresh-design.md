# 全局无感数据刷新机制设计审查

> 日期：2026-06-29
> 分支：`codex/global-refresh-mechanism`
> 范围：只做 Kiosk / Admin / Partner 三端通用刷新机制设计与后续实现准入，不修改运行时代码。

## 结论

可以推进，但必须先做底层刷新协调器，再逐页试点接入，不能把每个页面散落写 `setInterval`。推荐方案是新增一个轻量内部包 `packages/refresh`，提供三端共享的 `RefreshProvider`、`useRefreshable`、`useInteractionLock` 和列表合并工具。

本方案不新增入口、不改 UI 风格、不触碰智慧校园业务实现、不改变打印 / 扫码登录这类短生命周期流程轮询。它只解决数据刷新调度、脏状态保护、pending buffer 和版本/时间契约。

## 已确认事实

- 三端 `package.json` 当前没有 React Query 或 SWR；上线前不建议引入大范围数据层依赖。
- `apps/kiosk/src/hooks/useSmartCampusConfig.ts` 已有 5 分钟轮询，默认 OFF，不持久化，失败时保留同会话缓存或 OFF。
- `apps/kiosk/src/hooks/useScreensaverController.ts` 已有 5 分钟轮询，但失败语义是保留上一次有效配置，并带素材预缓存和缓存清理副作用。
- `apps/kiosk/src/pages/print/PrintProgressPage.tsx` 真实模式每 2 秒轮询打印任务，完成或失败会跳转 `/print/done`。
- `apps/kiosk/src/pages/auth/ScanQrLoginPanel.tsx` 每 2 秒轮询二维码登录 ticket，确认后必须立刻 claim 并进入登录态。
- Admin / Partner 多数页面仍是 `useEffect` 首次加载 + 手动刷新，例如终端、打印机、订单、智慧校园、工作台、岗位、政策等页面。
- 统一 API 成功 envelope 目前只有 `success` / `data`，没有统一 `serverTime`、`version` 或 `meta`；部分 DTO 有 `updatedAt`。
- Kiosk 已有 `KioskBusyContext`，可作为全局刷新暂停信号；Admin / Partner 目前只有 `RouterProvider`，需要在 App 层挂 Provider。

## 非目标

- 不新增页面、入口、Tab、业务卡片或重复功能。
- 不重写三端数据请求层，不一次性迁移所有列表页。
- 不改变智慧校园的业务开关规则、机构隔离和合规冻结规则。
- 不改变打印进度、扫码登录、扫描/上传进度等流程型轮询。
- 不在前端引入后台推送、WebSocket 或 SSE。本阶段先用可控 HTTP polling。

## 推荐架构

### 1. 新建内部包

新增 `packages/refresh`，原因是 `packages/shared` 当前职责是共享类型、协议、常量和工具，不应引入 React 运行时依赖。`packages/refresh` 专门承载三端 React 数据刷新机制，React 作为 peer 依赖。

建议文件：

- `packages/refresh/src/store.ts`：资源 store、单飞去重、调度器、用户空闲门禁、退避和 pending buffer。
- `packages/refresh/src/RefreshProvider.tsx`：Context、visibility/focus/online 监听、用户活动监听、全局暂停。
- `packages/refresh/src/useRefreshable.ts`：资源注册和订阅 hook。
- `packages/refresh/src/useInteractionLock.ts`：hard / soft dirty lock。
- `packages/refresh/src/merge.ts`：`mergeById`、`replaceIfChanged`。
- `packages/refresh/src/index.ts`：包导出。

### 2. 调度模型

每个 App 只挂一个 `RefreshProvider`。Provider 内部维护一个资源表，不允许页面自行创建长期 `setInterval`。

自动刷新必须先通过全局用户空闲门禁。默认规则：

- 连续 15 秒没有点击、触摸、滚动、键盘输入、表单输入或焦点切换，才允许自动刷新。
- 用户正在操作时，到期资源保持待刷新状态，不发起自动请求，也不应用后台数据。
- 页面恢复可见、浏览器重新 focus、网络恢复 online 时，也必须满足 15 秒空闲门禁后才能补刷。
- 用户主动点击现有“刷新”按钮属于显式操作，可以立即调用 `refresh()`；但 hard lock 仍然不能被绕过。
- 即使超过 15 秒，只要页面声明了表单 dirty、详情弹窗、编辑抽屉或保存中 hard lock，新数据仍只能进入 pending buffer。

资源注册项包含：

```ts
interface RefreshResourceConfig<T> {
  key: string
  fetcher: () => Promise<T>
  intervalMs: number
  merge: (current: T | undefined, incoming: T) => T
  failPolicy: 'keep-last' | 'reset'
  resetValue?: T
  refetchOnFocus?: boolean
  newItemPolicy?: 'apply' | 'buffer'
}
```

调度触发源：

- 页面挂载时首拉。
- 到达 `intervalMs` 时刷新。
- `visibilitychange` 回到 visible 时错峰刷新。
- `focus` 或 `online` 时错峰刷新。
- 用户点击现有“刷新”按钮时调用 `refresh()`。
- 写操作成功后调用 `invalidate(key)`。

上述自动触发源除首拉和手动刷新外，都必须经过空闲门禁。首拉只用于页面初次进入时拿到基础数据；后续任何自动补刷都不得打断操作。

### 3. Dirty State 和 Pending Buffer

刷新协调器不能覆盖用户当前操作。页面通过 `useInteractionLock(active, keys, mode)` 声明当前状态。

Hard lock：

- 表单已编辑但未保存。
- Drawer / modal 内正在编辑。
- 内联选择框正在编辑。
- 保存请求进行中。

Soft lock：

- 用户正在看详情内容。
- 列表滚动位置不在顶部。
- 当前焦点在搜索框、输入框、textarea 或 select。

处理规则：

- 无锁：直接合并。
- hard lock：新数据进入 pending buffer，不触发 UI 状态替换。
- soft lock：新数据进入 pending buffer，页面可展示“有新内容”提示。
- 锁释放：如果资源 key 仍匹配当前页面语境，再应用 pending；否则保留 pending 并等待用户手动刷新。

### 4. 合并策略

`replaceIfChanged`：用于单值配置、工作台指标和详情摘要。

`mergeById`：用于列表。目标是保留未变化行对象引用，避免整表替换导致滚动跳动。新增项默认进入 pending，不自动插入当前视口。

`reset`：用于智慧校园这类合规敏感配置。后端明确返回 OFF 时必须应用 OFF；网络失败不能把 OFF 升级为 ON。

`keep-last`：用于屏保、列表、工作台、终端状态。后台刷新失败时保留上一次成功数据，不把页面翻成错误态。

## 数据刷新矩阵

| 数据类型 | 端 | 频率 | 策略 | 说明 |
| --- | --- | --- | --- | --- |
| 终端在线状态 | Admin | 30 秒 | `mergeById` + `keep-last` | 适合首批试点，业务价值高。 |
| 打印机状态 | Admin | 30 秒 | `mergeById` + `keep-last` | 来自 Terminal Agent 心跳，刷新失败保留旧值。 |
| Admin 订单只读列表 | Admin | 30-60 秒 | `mergeById` + `newItemPolicy=buffer` | 新订单不自动插入当前视口，避免点击错位。 |
| Admin / Partner 工作台 | Admin / Partner | 60 秒 | `replaceIfChanged` | 指标变化可直接更新，但页面隐藏时暂停。 |
| Partner 岗位 / 招聘会 / 政策列表 | Partner | 60 秒 | `mergeById` + hard lock | 编辑抽屉打开时只进 pending。 |
| Kiosk `/me/*` 用户资产 | Kiosk | 可见时 60 秒 | `mergeById` + `keep-last` | 只刷新本人元数据，不刷新签名 URL 内容。 |
| Kiosk 岗位 / 招聘会 / 政策公开内容 | Kiosk | 5 分钟或 focus | `mergeById` + soft lock | 慢变数据，不高频刷。 |
| Kiosk 智慧校园开关 | Kiosk | 5 分钟 | `replaceIfChanged` + `reset` | 可二期接入协调器，必须保留默认 OFF 语义。 |
| Kiosk 屏保 playlist | Kiosk | 5 分钟 | 暂保留现状 | 有素材预缓存和缓存清理副作用，首期不强行收编。 |

## 明确排除的轮询

- `PrintProgressPage`：打印任务是短生命周期流程状态机，完成/失败必须跳转，保留独立 2 秒轮询。
- `ScanQrLoginPanel`：二维码 ticket 是登录流程控制，确认后必须立即 claim，保留独立 2 秒轮询。
- 扫描、上传、AI 通话、模拟面试倒计时：属于流程进度或 UI 计时，不进入全局刷新协调器。
- 屏保 playlist：首期不收编，除非协调器已经支持副作用钩子和 `keep-last` 失败语义。

## API 契约建议

短期不破坏旧接口。前端先根据 `updatedAt`、列表长度、id 集合和浅比较判断是否需要合并。

中期建议在成功响应中兼容新增：

```ts
interface ApiResponseMeta {
  serverTime: string
  version?: string
}
```

后端可以逐步返回：

```json
{
  "success": true,
  "data": {},
  "meta": {
    "serverTime": "2026-06-29T00:00:00.000Z",
    "version": "resource-hash-or-max-updated-at"
  }
}
```

旧客户端忽略 `meta`，新刷新协调器可利用它减少不必要合并。涉及写操作的资源后续再引入 `If-Match` / 版本冲突提示，本阶段不强制。

## 分阶段建议

### Phase 0：文档和计划

只落设计文档和实现计划，不改运行时代码。

### Phase 1：刷新协调器 MVP

新增 `packages/refresh`，接入三端 Provider，完成单元测试和静态 verify。首期不接任何业务页。

### Phase 2：高价值试点

接 Admin 终端、打印机、订单只读列表三类页面，验证终端在线和列表不跳动。

### Phase 3：Partner 表单页试点

接 Partner 岗位或政策页，验证编辑抽屉 hard lock 和 pending buffer。

### Phase 4：Kiosk 低风险列表

接 Kiosk `/me/print-orders` 或 `/me/resumes` 这类只读资产页。智慧校园和屏保等特殊语义最后再收编。

## 验收门禁

- 静态 verify：刷新包不得引用 `useNavigate`、`navigate`、`RouterProvider`、`Drawer`、`modal` 等路由/弹窗 API。
- 单元测试：`mergeById` 保持未变化行对象引用；hard lock 时只写 pending，不触发 subscriber；unlock 后才 apply。
- 浏览器 E2E：用户连续操作期间不触发自动刷新；停止操作满 15 秒后才允许补刷；列表滚动中刷新不改变 `scrollTop`；编辑表单中刷新不覆盖输入；页面隐藏时停止普通刷新，返回可见时只补刷一次。
- Kiosk 回归：打印进度和扫码登录轮询不受影响。
- 类型和 lint：涉及端必须跑对应 `typecheck` / `lint`，新增包必须有类型检查。

## 双模型审查结论摘要

Claude 与 Antigravity 均建议采用“集中调度 + 资源注册 + dirty lock + pending buffer + 按 id 合并”。主要分歧是落点：一个建议放 `packages/shared`，另一个建议单独建 `packages/refresh`。结合 `docs/project-structure.md` 对 `packages/shared` 的职责定义，本设计推荐单独建 `packages/refresh`，避免让 shared 依赖 React。
