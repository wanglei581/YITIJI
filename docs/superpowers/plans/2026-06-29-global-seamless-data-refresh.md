# 全局无感数据刷新机制 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Kiosk / Admin / Partner 三端建立可复用的无感数据刷新机制，保证数据及时更新，同时不覆盖表单、不跳动列表、不关闭弹窗、不强制跳转。

**Architecture:** 新增内部包 `@ai-job-print/refresh`，以 `RefreshProvider` 提供单 App 调度器和 15 秒用户空闲门禁，以 `useRefreshable` 声明资源，以 `useInteractionLock` 保护用户交互，以 `mergeById` 稳定列表引用。先接三端 Provider 和静态/单元测试，再只接 Admin 终端、打印机、订单三个高价值试点页。

**Tech Stack:** React 18 + Vite + TypeScript + pnpm workspace + Vitest 或 Node 级静态 verify 脚本。

---

## 文件结构预算

首批实现只允许修改下列运行时代码和验证文件：

- Create: `packages/refresh/package.json`
- Create: `packages/refresh/src/index.ts`
- Create: `packages/refresh/src/store.ts`
- Create: `packages/refresh/src/RefreshProvider.tsx`
- Create: `packages/refresh/src/useRefreshable.ts`
- Create: `packages/refresh/src/useInteractionLock.ts`
- Create: `packages/refresh/src/merge.ts`
- Create: `packages/refresh/tsconfig.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `apps/kiosk/src/main.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/partner/src/App.tsx`
- Modify: `apps/admin/src/routes/terminals/index.tsx`
- Modify: `apps/admin/src/routes/printers/index.tsx`
- Modify: `apps/admin/src/routes/orders/index.tsx`
- Create: `apps/admin/scripts/verify-refresh-safe.mjs`
- Modify: `apps/admin/package.json`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

本计划禁止：

- 不改智慧校园业务实现。
- 不接 Kiosk 屏保 playlist。
- 不改 `PrintProgressPage` 和 `ScanQrLoginPanel` 的 2 秒流程轮询。
- 不引入 React Query / SWR / WebSocket / SSE。
- 不新增 UI 入口、Tab、卡片或业务页面。
- 不使用 `git add .`。

## Task 1：创建刷新包骨架和 workspace 接线

**Files:**
- Create: `packages/refresh/package.json`
- Create: `packages/refresh/tsconfig.json`
- Create: `packages/refresh/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1：创建独立分支**

Run:

```bash
git switch main
git pull --ff-only
git switch -c codex/global-refresh-foundation
```

Expected:

- 当前分支为 `codex/global-refresh-foundation`。
- `git status --short --branch` 显示工作区干净。

- [ ] **Step 2：写 package 配置**

Create `packages/refresh/package.json`:

```json
{
  "name": "@ai-job-print/refresh",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "typescript": "^5.7.0"
  }
}
```

Create `packages/refresh/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["react"]
  },
  "include": ["src"]
}
```

Create `packages/refresh/src/index.ts`:

```ts
export { RefreshProvider, useRefreshContext, type RefreshProviderProps } from './RefreshProvider'
export { useRefreshable, type UseRefreshableOptions, type UseRefreshableResult } from './useRefreshable'
export { useInteractionLock } from './useInteractionLock'
export { mergeById, replaceIfChanged } from './merge'
export type {
  RefreshFailPolicy,
  RefreshMergeFn,
  RefreshResourceKey,
  RefreshStatus,
} from './store'
```

- [ ] **Step 3：确认 workspace 已包含 packages/**

Run:

```bash
sed -n '1,80p' pnpm-workspace.yaml
```

Expected:

- 文件包含 `packages/*`。
- 如果已经包含，不修改 `pnpm-workspace.yaml`。
- 如果未包含，只添加 `packages/*`，不改其他 workspace pattern。

- [ ] **Step 4：给根 package 增加可选验证脚本**

Modify root `package.json` scripts by adding:

```json
"typecheck:refresh": "pnpm --filter @ai-job-print/refresh typecheck"
```

Keep existing scripts unchanged.

- [ ] **Step 5：验证包骨架**

Run:

```bash
pnpm --filter @ai-job-print/refresh typecheck
```

Expected:

- 当前如果只创建了空导出文件且后续文件尚未创建，会失败并提示缺少模块。
- 记录失败，这是 Task 2 的 red state。

## Task 2：实现 merge 工具和 store 类型

**Files:**
- Create: `packages/refresh/src/merge.ts`
- Create: `packages/refresh/src/store.ts`
- Test: `packages/refresh/src/merge.ts` through TypeScript usage and static verify in Task 6.

- [ ] **Step 1：实现稳定列表合并**

Create `packages/refresh/src/merge.ts`:

```ts
export function replaceIfChanged<T>(current: T | undefined, incoming: T): T {
  if (current === incoming) return current
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(incoming)) return current
  return incoming
}

export function mergeById<T>(
  getId: (item: T) => string,
): (current: T[] | undefined, incoming: T[]) => T[] {
  return (current, incoming) => {
    if (!current || current.length === 0) return incoming
    const previous = new Map(current.map((item) => [getId(item), item]))
    let changed = current.length !== incoming.length
    const merged = incoming.map((next) => {
      const id = getId(next)
      const prev = previous.get(id)
      if (!prev) {
        changed = true
        return next
      }
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev
      changed = true
      return next
    })
    return changed ? merged : current
  }
}
```

- [ ] **Step 2：实现 store 类型和状态容器**

Create `packages/refresh/src/store.ts`:

```ts
export type RefreshResourceKey = string
export type RefreshStatus = 'idle' | 'loading' | 'ready' | 'error'
export type RefreshFailPolicy = 'keep-last' | 'reset'
export type RefreshMergeFn<T> = (current: T | undefined, incoming: T) => T

export interface RefreshEntry<T> {
  key: RefreshResourceKey
  status: RefreshStatus
  data: T | undefined
  pending: T | undefined
  error: unknown
  lastFetchedAt: number
  nextFetchAt: number
  inFlight: Promise<void> | null
  subscribers: Set<() => void>
}

export interface RefreshResourceOptions<T> {
  key: RefreshResourceKey
  fetcher: () => Promise<T>
  intervalMs: number
  merge: RefreshMergeFn<T>
  failPolicy: RefreshFailPolicy
  resetValue?: T
  refetchOnFocus?: boolean
}

export class RefreshStore {
  private readonly entries = new Map<RefreshResourceKey, RefreshEntry<unknown>>()
  private readonly resources = new Map<RefreshResourceKey, RefreshResourceOptions<unknown>>()
  private readonly locks = new Map<RefreshResourceKey, number>()
  private lastUserActivityAt = Date.now()
  private idleMs = 15_000
  private paused = false

  setIdleMs(idleMs: number): void {
    this.idleMs = idleMs
  }

  markUserActivity(now = Date.now()): void {
    this.lastUserActivityAt = now
  }

  isIdle(now = Date.now()): boolean {
    return now - this.lastUserActivityAt >= this.idleMs
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  isPaused(): boolean {
    return this.paused
  }

  lock(key: RefreshResourceKey): () => void {
    this.locks.set(key, (this.locks.get(key) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const next = Math.max(0, (this.locks.get(key) ?? 0) - 1)
      if (next === 0) this.locks.delete(key)
      else this.locks.set(key, next)
      const entry = this.entries.get(key)
      if (entry?.pending !== undefined) {
        entry.data = entry.pending
        entry.pending = undefined
        this.emit(key)
      }
    }
  }

  getSnapshot<T>(key: RefreshResourceKey): RefreshEntry<T> | undefined {
    return this.entries.get(key) as RefreshEntry<T> | undefined
  }

  subscribe(key: RefreshResourceKey, callback: () => void): () => void {
    const entry = this.ensureEntry<unknown>(key)
    entry.subscribers.add(callback)
    return () => {
      entry.subscribers.delete(callback)
    }
  }

  register<T>(options: RefreshResourceOptions<T>): () => void {
    this.resources.set(options.key, options as RefreshResourceOptions<unknown>)
    this.ensureEntry<T>(options.key)
    return () => {
      this.resources.delete(options.key)
    }
  }

  async refresh<T>(key: RefreshResourceKey): Promise<void> {
    const options = this.resources.get(key) as RefreshResourceOptions<T> | undefined
    if (!options) return
    const entry = this.ensureEntry<T>(key)
    if (entry.inFlight) return entry.inFlight
    entry.status = entry.data === undefined ? 'loading' : entry.status
    this.emit(key)
    entry.inFlight = this.runRefresh(entry, options)
    return entry.inFlight
  }

  tick(now: number): void {
    if (this.paused || !this.isIdle(now)) return
    this.resources.forEach((options, key) => {
      const entry = this.ensureEntry<unknown>(key)
      if (entry.inFlight === null && now >= entry.nextFetchAt) void this.refresh(key)
    })
  }

  refreshOnFocus(): void {
    if (this.paused || !this.isIdle()) return
    Array.from(this.resources.entries()).forEach(([key, options], index) => {
      if (options.refetchOnFocus === false) return
      window.setTimeout(() => void this.refresh(key), index * 150)
    })
  }

  private async runRefresh<T>(entry: RefreshEntry<T>, options: RefreshResourceOptions<T>): Promise<void> {
    try {
      const incoming = await options.fetcher()
      const now = Date.now()
      entry.lastFetchedAt = now
      entry.nextFetchAt = now + options.intervalMs
      entry.error = null
      entry.status = 'ready'
      const merged = options.merge(entry.data, incoming)
      if (this.locks.has(options.key)) entry.pending = merged
      else entry.data = merged
    } catch (error) {
      entry.error = error
      if (entry.data === undefined && options.failPolicy === 'reset') entry.data = options.resetValue
      entry.status = entry.data === undefined ? 'error' : 'ready'
      entry.nextFetchAt = Date.now() + Math.max(5000, Math.min(options.intervalMs, 30000))
    } finally {
      entry.inFlight = null
      this.emit(options.key)
    }
  }

  private ensureEntry<T>(key: RefreshResourceKey): RefreshEntry<T> {
    const existing = this.entries.get(key)
    if (existing) return existing as RefreshEntry<T>
    const created: RefreshEntry<T> = {
      key,
      status: 'idle',
      data: undefined,
      pending: undefined,
      error: null,
      lastFetchedAt: 0,
      nextFetchAt: 0,
      inFlight: null,
      subscribers: new Set(),
    }
    this.entries.set(key, created as RefreshEntry<unknown>)
    return created
  }

  private emit(key: RefreshResourceKey): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.subscribers.forEach((callback) => callback())
  }
}
```

- [ ] **Step 3：运行类型检查**

Run:

```bash
pnpm --filter @ai-job-print/refresh typecheck
```

Expected:

- 仍可能失败，因为 `RefreshProvider`、`useRefreshable`、`useInteractionLock` 尚未创建。
- 缺失模块错误属于预期 red state，进入 Task 3。

## Task 3：实现 Provider 和 hooks

**Files:**
- Create: `packages/refresh/src/RefreshProvider.tsx`
- Create: `packages/refresh/src/useRefreshable.ts`
- Create: `packages/refresh/src/useInteractionLock.ts`

- [ ] **Step 1：实现 Provider**

Create `packages/refresh/src/RefreshProvider.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { RefreshStore } from './store'

interface RefreshContextValue {
  store: RefreshStore
}

const RefreshContext = createContext<RefreshContextValue | null>(null)

export interface RefreshProviderProps {
  children: ReactNode
  paused?: boolean
  idleMs?: number
}

export function RefreshProvider({ children, paused = false, idleMs = 15_000 }: RefreshProviderProps) {
  const value = useMemo<RefreshContextValue>(() => ({ store: new RefreshStore() }), [])

  useEffect(() => {
    value.store.setPaused(paused)
    value.store.setIdleMs(idleMs)
  }, [idleMs, paused, value.store])

  useEffect(() => {
    const resume = () => {
      const hidden = document.visibilityState === 'hidden'
      value.store.setPaused(hidden || paused)
      if (!hidden && !paused) value.store.refreshOnFocus()
    }
    window.addEventListener('focus', resume)
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    resume()
    return () => {
      window.removeEventListener('focus', resume)
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [paused, value.store])

  useEffect(() => {
    const markActivity = () => value.store.markUserActivity()
    const windowEvents = ['click', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'] as const
    const documentEvents = ['input', 'focusin'] as const
    windowEvents.forEach((event) => window.addEventListener(event, markActivity, { passive: true }))
    documentEvents.forEach((event) => document.addEventListener(event, markActivity, { passive: true }))
    return () => {
      windowEvents.forEach((event) => window.removeEventListener(event, markActivity))
      documentEvents.forEach((event) => document.removeEventListener(event, markActivity))
    }
  }, [value.store])

  useEffect(() => {
    const timer = window.setInterval(() => value.store.tick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [value.store])

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}

export function useRefreshContext(): RefreshContextValue {
  const context = useContext(RefreshContext)
  if (!context) throw new Error('useRefreshContext must be used within RefreshProvider')
  return context
}
```

- [ ] **Step 2：实现资源 hook**

Create `packages/refresh/src/useRefreshable.ts`:

```ts
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useRefreshContext } from './RefreshProvider'
import type {
  RefreshFailPolicy,
  RefreshMergeFn,
  RefreshResourceKey,
  RefreshStatus,
} from './store'

export interface UseRefreshableOptions<T> {
  intervalMs: number
  merge: RefreshMergeFn<T>
  failPolicy?: RefreshFailPolicy
  resetValue?: T
  refetchOnFocus?: boolean
}

export interface UseRefreshableResult<T> {
  data: T | undefined
  status: RefreshStatus
  error: unknown
  hasPending: boolean
  refresh: () => Promise<void>
}

export function useRefreshable<T>(
  key: RefreshResourceKey,
  fetcher: () => Promise<T>,
  options: UseRefreshableOptions<T>,
): UseRefreshableResult<T> {
  const { store } = useRefreshContext()
  const snapshot = useSyncExternalStore(
    (callback) => store.subscribe(key, callback),
    () => store.getSnapshot<T>(key),
    () => store.getSnapshot<T>(key),
  )

  const refresh = useCallback(() => {
    return store.refresh<T>(key)
  }, [key, store])

  useEffect(() => {
    const unregister = store.register<T>({
      key,
      fetcher,
      intervalMs: options.intervalMs,
      merge: options.merge,
      failPolicy: options.failPolicy ?? 'keep-last',
      resetValue: options.resetValue,
      refetchOnFocus: options.refetchOnFocus ?? true,
    })
    void refresh()
    return unregister
  }, [fetcher, key, options.failPolicy, options.intervalMs, options.merge, options.refetchOnFocus, options.resetValue, refresh, store])

  return {
    data: snapshot?.data,
    status: snapshot?.status ?? 'idle',
    error: snapshot?.error ?? null,
    hasPending: snapshot?.pending !== undefined,
    refresh,
  }
}
```

- [ ] **Step 3：实现交互锁 hook**

Create `packages/refresh/src/useInteractionLock.ts`:

```ts
import { useEffect } from 'react'
import { useRefreshContext } from './RefreshProvider'
import type { RefreshResourceKey } from './store'

export function useInteractionLock(active: boolean, keys: RefreshResourceKey[]): void {
  const { store } = useRefreshContext()
  useEffect(() => {
    if (!active) return
    const releases = keys.map((key) => store.lock(key))
    return () => {
      releases.forEach((release) => release())
    }
  }, [active, keys, store])
}
```

- [ ] **Step 4：验证 Provider 和 hooks**

Run:

```bash
pnpm --filter @ai-job-print/refresh typecheck
```

Expected:

- `@ai-job-print/refresh` typecheck 通过。
- 自动刷新必须在 `RefreshProvider` 检测到连续 15 秒无用户操作后才触发；首拉和用户手动刷新不受空闲门禁限制。

## Task 4：三端挂载 Provider

**Files:**
- Modify: `apps/kiosk/src/main.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/partner/src/App.tsx`
- Modify: `apps/kiosk/package.json`
- Modify: `apps/admin/package.json`
- Modify: `apps/partner/package.json`

- [ ] **Step 1：给三端 package 加内部依赖**

Add to each app `dependencies`:

```json
"@ai-job-print/refresh": "workspace:*"
```

Do not remove existing dependencies.

- [ ] **Step 2：Kiosk 挂 Provider**

Modify `apps/kiosk/src/main.tsx` to wrap RouterProvider:

```tsx
import { RefreshProvider } from '@ai-job-print/refresh'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RefreshProvider>
        <RouterProvider router={kioskRouter} />
      </RefreshProvider>
    </AuthProvider>
  </StrictMode>,
)
```

- [ ] **Step 3：Admin 挂 Provider**

Modify `apps/admin/src/App.tsx`:

```tsx
import { RefreshProvider } from '@ai-job-print/refresh'
import { RouterProvider } from 'react-router-dom'
import { adminRouter } from './routes'

export default function App() {
  return (
    <RefreshProvider>
      <RouterProvider router={adminRouter} />
    </RefreshProvider>
  )
}
```

- [ ] **Step 4：Partner 挂 Provider**

Modify `apps/partner/src/App.tsx`:

```tsx
import { RefreshProvider } from '@ai-job-print/refresh'
import { RouterProvider } from 'react-router-dom'
import { partnerRouter } from './routes'

export default function App() {
  return (
    <RefreshProvider>
      <RouterProvider router={partnerRouter} />
    </RefreshProvider>
  )
}
```

- [ ] **Step 5：验证三端类型**

Run:

```bash
pnpm --filter @ai-job-print/refresh typecheck
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/partner typecheck
```

Expected:

- 四个 typecheck 均通过。

## Task 5：接入 Admin 终端、打印机、订单试点页

**Files:**
- Modify: `apps/admin/src/routes/terminals/index.tsx`
- Modify: `apps/admin/src/routes/printers/index.tsx`
- Modify: `apps/admin/src/routes/orders/index.tsx`

- [ ] **Step 1：终端页替换首次加载**

Modify `apps/admin/src/routes/terminals/index.tsx`:

```tsx
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'

const TERMINALS_REFRESH_KEY = 'admin:terminals'

const {
  data: terminalData,
  status,
  refresh,
} = useRefreshable(
  TERMINALS_REFRESH_KEY,
  getTerminals,
  {
    intervalMs: 30_000,
    merge: (current, incoming) => ({
      terminals: mergeById<AdminTerminalRecord>((item) => item.id)(
        current?.terminals,
        incoming.terminals,
      ),
    }),
    failPolicy: 'keep-last',
  },
)

useInteractionLock(editingId !== null || saving, [TERMINALS_REFRESH_KEY])
```

Then derive:

```tsx
const terminals = terminalData?.terminals ?? []
const loading = status === 'loading' && terminals.length === 0
const error = status === 'error'
```

Keep existing filter, search, pagination and save logic. Change the refresh button to:

```tsx
<button onClick={() => void refresh()} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
  <RefreshCwIcon className="h-3.5 w-3.5" />刷新
</button>
```

- [ ] **Step 2：打印机页替换首次加载**

Modify `apps/admin/src/routes/printers/index.tsx`:

```tsx
import { mergeById, useRefreshable } from '@ai-job-print/refresh'

const PRINTERS_REFRESH_KEY = 'admin:printers'

const {
  data: printerData,
  status,
  error,
  refresh,
} = useRefreshable(
  PRINTERS_REFRESH_KEY,
  getPrinters,
  {
    intervalMs: 30_000,
    merge: (current, incoming) => ({
      printers: mergeById<AdminPrinterRecord>((item) => item.id)(
        current?.printers,
        incoming.printers,
      ),
    }),
    failPolicy: 'keep-last',
  },
)

const printers = printerData?.printers ?? []
const loading = status === 'loading' && printers.length === 0
```

Change manual refresh buttons and retry buttons to call `refresh`.

- [ ] **Step 3：订单页接入但保护详情**

Modify `apps/admin/src/routes/orders/index.tsx`:

```tsx
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'

const ordersKey = `admin:orders:${statusFilter}:${payStatus}:${search}:${page}`

const {
  data: orderPage,
  status,
  refresh,
} = useRefreshable(
  ordersKey,
  () => adminOrdersReadonlyService.list({
    taskStatus: statusFilter || undefined,
    payStatus: payStatus || undefined,
    search: search || undefined,
    page,
    pageSize,
  }),
  {
    intervalMs: 30_000,
    merge: (current, incoming) => ({
      ...incoming,
      items: mergeById<AdminOrderReadonlyItem>((item) => item.id)(
        current?.items,
        incoming.items,
      ),
    }),
    failPolicy: 'keep-last',
  },
)

useInteractionLock(detailState === 'loading' || detailState === 'ready', [ordersKey])
```

Then derive:

```tsx
const items = orderPage?.items ?? []
const total = orderPage?.pagination.total ?? 0
const totalPages = orderPage?.pagination.totalPages ?? 1
```

Keep `openDetail` as an explicit detail fetch. Do not auto-replace `detail` from list refresh.

- [ ] **Step 4：验证 Admin 试点**

Run:

```bash
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
```

Expected:

- Admin typecheck / lint 通过。
- 终端、打印机、订单页面仍保留现有手动刷新按钮。

## Task 6：增加静态安全 verify

**Files:**
- Create: `apps/admin/scripts/verify-refresh-safe.mjs`
- Modify: `apps/admin/package.json`

- [ ] **Step 1：写静态安全脚本**

Create `apps/admin/scripts/verify-refresh-safe.mjs`:

```js
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('../../../packages/refresh/src', import.meta.url).pathname
const forbidden = [
  'useNavigate',
  'navigate(',
  'RouterProvider',
  'createBrowserRouter',
  'Drawer',
  'modal',
  'Modal',
]

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const stat = statSync(path)
    return stat.isDirectory() ? files(path) : [path]
  })
}

let failed = false
for (const file of files(root)) {
  const text = readFileSync(file, 'utf8')
  for (const token of forbidden) {
    if (text.includes(token)) {
      console.error(`refresh package must not reference ${token}: ${file}`)
      failed = true
    }
  }
}

if (failed) process.exit(1)
console.log('verify:refresh-safe passed')
```

- [ ] **Step 2：接入 Admin package script**

Add to `apps/admin/package.json` scripts:

```json
"verify:refresh-safe": "node scripts/verify-refresh-safe.mjs"
```

- [ ] **Step 3：运行 verify**

Run:

```bash
pnpm --filter @ai-job-print/admin verify:refresh-safe
```

Expected:

- 输出 `verify:refresh-safe passed`。

## Task 7：文档同步和最终验证

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1：同步 current-progress**

Add one short entry under the current progress table:

```md
| 2026-06-29 | `codex/global-refresh-foundation` / 本分支 | 完成三端全局无感数据刷新机制首期底座：新增 `packages/refresh`，三端挂载 `RefreshProvider`，Admin 终端 / 打印机 / 订单只读页试点接入；刷新协调器仅更新数据，不触发路由跳转、不关闭弹窗、不覆盖编辑表单。 |
```

- [ ] **Step 2：同步 next-tasks**

Add a P1 engineering quality item:

```md
- [ ] **全局无感数据刷新机制继续推广**：首期底座和 Admin 终端 / 打印机 / 订单试点通过后，再按独立分支接入 Partner 岗位 / 政策、Kiosk `/me/*` 资产页；智慧校园和屏保必须在保留各自失败语义后再接入。
```

- [ ] **Step 3：运行总验证**

Run:

```bash
pnpm --filter @ai-job-print/refresh typecheck
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin verify:refresh-safe
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/partner typecheck
git diff --check
```

Expected:

- 所有命令 exit 0。
- `git diff --check` 无 whitespace error。

- [ ] **Step 4：双模型审查**

Because this task is cross-app and changes shared runtime behavior, run Claude + Antigravity review on `git diff`.

Expected:

- 无 Critical。
- Warning 必须逐条处理或写明延期理由。

- [ ] **Step 5：显式暂存和提交**

Run:

```bash
git add packages/refresh/package.json packages/refresh/tsconfig.json packages/refresh/src/index.ts packages/refresh/src/store.ts packages/refresh/src/RefreshProvider.tsx packages/refresh/src/useRefreshable.ts packages/refresh/src/useInteractionLock.ts packages/refresh/src/merge.ts pnpm-workspace.yaml package.json apps/kiosk/src/main.tsx apps/admin/src/App.tsx apps/partner/src/App.tsx apps/admin/src/routes/terminals/index.tsx apps/admin/src/routes/printers/index.tsx apps/admin/src/routes/orders/index.tsx apps/admin/scripts/verify-refresh-safe.mjs apps/admin/package.json docs/progress/current-progress.md docs/progress/next-tasks.md
git commit -m "feat: add global seamless refresh foundation"
```

Expected:

- Commit succeeds.
- No unrelated files are staged.

## Self-review checklist

- [ ] Plan does not touch smart-campus business implementation.
- [ ] Plan does not change print progress or QR login flow polling.
- [ ] Plan keeps `packages/shared` free of React runtime dependency.
- [ ] Plan blocks automatic refresh while the user is operating and only allows it after 15 seconds of inactivity.
- [ ] Plan includes dirty state protection for form and detail interactions.
- [ ] Plan includes static guard preventing route/modal coupling inside refresh package.
- [ ] Plan includes explicit verification commands.
