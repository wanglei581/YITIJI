# P0-1B Kiosk Session Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在公共终端 ordinary idle 与屏保 idle 清场前提供 30 秒任务感知预警，同时保持 P0-1 硬隐私截止直接 fail-closed，并把扫描 busy 锁限制在真实活动任务。

**Architecture:** `KioskPrivacyGuard` 保存仅存内存的 warning 恢复 ref，并通过小型 Context 向 `/session-timeout` 暴露非敏感 descriptor 与安全动作。ordinary idle 和屏保控制器只发出带绝对截止的预警请求；硬隐私 timer、BFCache 和 visibility 清场保持独立。预警 history entry 不复制 route state，继续使用只返回 Guard 验证过的原 history entry。

**Tech Stack:** React 18、React Router 7、TypeScript、Vite、Playwright、现有 Kiosk privacy boundary 与 busy context。

---

## 文件结构与预算

- Create `apps/kiosk/src/auth/KioskSessionControlContext.tsx`：非敏感 warning descriptor 和安全动作接口。
- Create `apps/kiosk/playwright.privacy-warning.config.ts`：独立短时预警 E2E 环境。
- Create `apps/kiosk/tests/visual/kiosk-session-warning.spec.ts`：ordinary、屏保、文案、触控、fail-closed 用例。
- Modify `apps/kiosk/src/hooks/useIdleTimer.ts`：向回调提供计划触发时间。
- Modify `apps/kiosk/src/auth/useIdleLogout.ts`：在总 ordinary idle 到期前触发 warning。
- Modify `apps/kiosk/src/hooks/useScreensaverController.ts`：只上报屏保 warning 请求，不自行清场。
- Modify `apps/kiosk/src/auth/KioskPrivacyGuard.tsx`：warning 内存恢复、单一 clearing claim、屏保原子交接。
- Modify `apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx`：绝对倒计时、任务文案、Context 安全动作。
- Modify `apps/kiosk/src/pages/scan/ScanProgressPage.tsx`：活动/终态驱动 busy。
- Modify `apps/kiosk/package.json` 与 `.github/workflows/ci.yml`：warning E2E 进入常规 CI。
- Modify `docs/progress/current-progress.md` 与 `docs/progress/next-tasks.md`：只记录实际验证事实。

源码、测试、CI、进度文档合计 13 个文件；设计/计划与 `.ccg` 任务记录不计业务文件预算。

### Task 1: 先建立预警浏览器门禁（RED）

**Files:**
- Create: `apps/kiosk/playwright.privacy-warning.config.ts`
- Create: `apps/kiosk/tests/visual/kiosk-session-warning.spec.ts`
- Modify: `apps/kiosk/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 新增独立 Playwright 配置**

使用独立端口 4188，ordinary idle 总时长 4 秒、warning 2 秒、硬隐私 20 秒；不能改既有 privacy 配置的 3 秒硬截止。

```ts
import { defineConfig } from '@playwright/test'

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

export default defineConfig({
  testDir: './tests',
  testMatch: /kiosk-session-warning\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-session-warning',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4188',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1080, height: 1920 },
  },
  webServer: {
    command: 'VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_TERMINAL_ID=KSK-001 VITE_KIOSK_LOGOUT_IDLE_SEC=4 VITE_KIOSK_SESSION_WARNING_SEC=2 VITE_KIOSK_PRIVACY_IDLE_SEC=20 pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4188 --strictPort',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
```

- [ ] **Step 2: 新增最小失败用例**

测试文件复用 `fixtures/kiosk-test` 与 `ApiRouter`，用以下完整 helper 注册 screensaver/printer/config 三个 shell 响应：

```ts
interface ShellOptions {
  screensaverEnabled: boolean
  idleTimeoutSec?: number
}

function registerKioskShell(api: ApiRouter, options: ShellOptions): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: {
      enabled: options.screensaverEnabled,
      idleTimeoutSec: options.idleTimeoutSec ?? 4,
      items: options.screensaverEnabled ? [{
        id: 'warning-screensaver',
        type: 'image',
        url: 'https://warning.invalid/screen.png',
        mimeType: 'image/png',
        durationSec: 30,
        sha256: 'warning-screen-fixture',
      }] : [],
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'warning-browser-fixture',
      refreshIntervalMs: 300_000,
      serverTime: '2026-07-29T00:00:00.000Z',
    },
  })
}
```

首批用例必须包含：

```ts
test('ordinary idle opens the routed warning and continue restores the original entry', async ({ page, api }) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/interview/tips')
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 3_000 })
  await expect(page.getByRole('heading', { name: '还在使用吗？' })).toBeVisible()
  await page.getByRole('button', { name: '继续使用', exact: true }).click()
  await expect(page).toHaveURL(/\/interview\/tips$/)
})

test('warning expiry performs the guarded hard clear', async ({ page, api }) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/interview/tips')
  await page.evaluate(() => sessionStorage.setItem('ai-job-print:current-ai-resume', 'sensitive'))
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 3_000 })
  await page.waitForURL((url) => url.pathname === '/', { timeout: 3_500 })
  expect(await page.evaluate(() => sessionStorage.getItem('ai-job-print:current-ai-resume'))).toBeNull()
})

test('screensaver idle warns before clearing to screensaver', async ({ page, api }) => {
  registerKioskShell(api, { screensaverEnabled: true, idleTimeoutSec: 4 })
  await page.goto('/interview/tips')
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 3_000 })
  await page.waitForURL((url) => url.pathname === '/screensaver', { timeout: 3_500 })
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/$/)
})

test('warning controls meet kiosk touch size', async ({ page, api }) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/interview/tips')
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 3_000 })
  for (const name of ['继续使用', '立即退出并清除本机会话']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(72)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
```

- [ ] **Step 3: 接入脚本与 CI**

在 `apps/kiosk/package.json` 增加：

```json
"test:browser:warning": "playwright test --config=playwright.privacy-warning.config.ts"
```

在 `.github/workflows/ci.yml` 的 Kiosk browser smoke 中紧跟 privacy 套件增加：

```yaml
pnpm --filter @ai-job-print/kiosk test:browser:warning
```

并在失败产物上传列表增加：

```yaml
test-results/kiosk-session-warning/**
```

- [ ] **Step 4: 运行 RED**

Run: `pnpm --filter @ai-job-print/kiosk test:browser:warning`

Expected: FAIL；ordinary idle 仍直接回首页或屏保，不会进入 `/session-timeout`。

- [ ] **Step 5: 提交测试骨架**

```bash
git add apps/kiosk/playwright.privacy-warning.config.ts apps/kiosk/tests/visual/kiosk-session-warning.spec.ts apps/kiosk/package.json .github/workflows/ci.yml
git commit -m "test: add kiosk session warning coverage"
```

### Task 2: 让 idle hooks 产生绝对预警截止（GREEN 基础层）

**Files:**
- Modify: `apps/kiosk/src/hooks/useIdleTimer.ts`
- Modify: `apps/kiosk/src/auth/useIdleLogout.ts`
- Modify: `apps/kiosk/src/hooks/useScreensaverController.ts`

- [ ] **Step 1: 扩展通用 idle 回调但保持旧消费者兼容**

```ts
export type IdleCallback = (scheduledAt: number) => void

const reset = (): void => {
  if (timer !== undefined) window.clearTimeout(timer)
  const scheduledAt = Date.now() + timeoutMs
  timer = window.setTimeout(() => onIdleRef.current(scheduledAt), timeoutMs)
}
```

保持 effect 入口的 `timeoutMs <= 0` 防御不变；上层保证 trigger 至少为 1ms，避免 0ms callback 与 Guard mount 竞态。零参数回调在 TypeScript 中仍可赋给该签名；不得让 timer 回调用实际触发时的 `Date.now()` 冒充 planned time。

- [ ] **Step 2: ordinary idle 计算有效 warning window**

在 `useIdleLogout.ts` 导出纯函数和请求类型：

```ts
export interface KioskIdleWarningRequest {
  deadlineAt: number
  warningMs: number
}

export function resolveWarningWindow(totalMs: number): { triggerMs: number; warningMs: number } {
  const raw = Number(import.meta.env.VITE_KIOSK_SESSION_WARNING_SEC)
  const configuredMs = (Number.isFinite(raw) && raw > 0 ? raw : 30) * 1000
  const desiredWarningMs = Math.min(configuredMs, totalMs)
  const triggerMs = Math.max(1, totalMs - desiredWarningMs)
  return { triggerMs, warningMs: Math.max(0, totalMs - triggerMs) }
}
```

`useIdleLogout` 使用 `triggerMs`，在回调里发出 `{ deadlineAt: scheduledAt + warningMs, warningMs }`，并在 `/session-timeout`、`/screensaver`、busy 或 screensaverActive 时禁用。

- [ ] **Step 3: 屏保控制器改为只上报 warning**

```ts
export interface ScreensaverWarningRequest extends KioskIdleWarningRequest {
  playlist: KioskScreensaverPlaylist
}

export function useScreensaverController(
  onWarning: (request: ScreensaverWarningRequest) => void,
): { active: boolean } {
  // load/cache 保持不变
  const { triggerMs, warningMs } = resolveWarningWindow(timeoutMs)
  const handleIdle = useCallback((scheduledAt: number) => {
    const current = playlistRef.current
    if (!current?.enabled || current.items.length === 0) return
    onWarning({ playlist: current, deadlineAt: scheduledAt + warningMs, warningMs })
  }, [onWarning, warningMs])
  useIdleTimer({
    timeoutMs: triggerMs,
    enabled: active && !busy && pathname !== '/screensaver' && pathname !== '/session-timeout',
    onIdle: handleIdle,
  })
  return { active }
}
```

删除控制器中的 `clearKioskSensitiveSession`、`navigate` 和 `onSessionBoundary` 职责。

- [ ] **Step 4: 运行类型检查**

Run: `pnpm --filter @ai-job-print/kiosk typecheck`

Expected: FAIL 仅允许发生在 Guard 尚未适配的新回调签名；不得出现其他路由错误。

- [ ] **Step 5: 提交基础层**

```bash
git add apps/kiosk/src/hooks/useIdleTimer.ts apps/kiosk/src/auth/useIdleLogout.ts apps/kiosk/src/hooks/useScreensaverController.ts
git commit -m "refactor: expose kiosk idle warning deadlines"
```

### Task 3: Guard Context 与原子清场（GREEN 安全层）

**Files:**
- Create: `apps/kiosk/src/auth/KioskSessionControlContext.tsx`
- Modify: `apps/kiosk/src/auth/KioskPrivacyGuard.tsx`

- [ ] **Step 1: 定义只暴露非敏感 descriptor 的 Context**

```tsx
export type KioskWarningExitTo = 'home' | 'screensaver'

export interface KioskWarningDescriptor {
  sourcePath: string
  exitTo: KioskWarningExitTo
  deadlineAt: number
  canContinue: boolean
}

export interface KioskSessionControlValue {
  warning: KioskWarningDescriptor | null
  continueSession: () => void
  hardClear: () => void
  clearToScreensaver: () => void
}
```

`useKioskSessionControl()` 缺 Provider 时返回 fail-closed 动作：`window.location.replace('/')`；不得 throw 后交给错误页，也不得普通 `navigate`。

- [ ] **Step 2: Guard 保存私有 pending ref**

```ts
interface PendingWarning {
  sourceHistoryIndex: number | null
  sourcePath: string
  exitTo: 'home' | 'screensaver'
  deadlineAt: number
  playlist: KioskScreensaverPlaylist | null
}

const pendingWarningRef = useRef<PendingWarning | null>(null)
const clearingModeRef = useRef<null | 'hard' | 'screensaver'>(null)
```

发起 warning 时必须：

1. 如果 `Date.now() >= deadlineAt`，直接 `hardClear()`。
2. 从 `window.history.state.idx` 读取原 index；只有 `typeof idx === 'number'` 才令 `canContinue=true`，否则 warning 可显示但继续操作必须 hardClear。
3. 只把完整 pending 保存到 ref；Context state 只保存不敏感 descriptor。
4. `navigate('/session-timeout')` 不传 location state。
5. Context 的 `canContinue` 只表示发起时存在数值 source index；实际继续时必须再次验证当前 index 恰好为 source index + 1。

- [ ] **Step 3: 实现 continue 与单一 clearing claim**

```ts
const continueSession = useCallback(() => {
  const pending = pendingWarningRef.current
  const currentIdx = readHistoryState().idx
  if (
    !pending
    || typeof pending.sourceHistoryIndex !== 'number'
    || typeof currentIdx !== 'number'
    || currentIdx !== pending.sourceHistoryIndex + 1
  ) {
    hardClear()
    return
  }
  pendingWarningRef.current = null
  setWarning(null)
  navigate(-1)
}, [hardClear, navigate])
```

`hardClear` 与 `clearToScreensaver` 必须共用以下 check-then-set claim，不得各写一套 boolean：

```ts
const claimClearing = useCallback((mode: 'hard' | 'screensaver'): boolean => {
  if (clearingModeRef.current !== null) return false
  clearingModeRef.current = mode
  return true
}, [])
```

屏保交接必须按以下骨架实现：

```ts
const clearToScreensaver = useCallback(() => {
  const pending = pendingWarningRef.current
  const playlist = pending?.exitTo === 'screensaver' ? pending.playlist : null
  if (!playlist?.enabled || playlist.items.length === 0) {
    hardClear()
    return
  }
  if (!claimClearing('screensaver')) return
  setClearing(true)
  clearKioskSensitiveSession()
  logout()
  const privacyBoundary = establishPrivacyBoundary()
  pendingWarningRef.current = null
  setWarning(null)
  navigate('/screensaver', { state: { playlist, privacyBoundary } })
}, [claimClearing, establishPrivacyBoundary, hardClear, logout, navigate])

useEffect(() => {
  if (pathname !== '/screensaver' || clearingModeRef.current !== 'screensaver') return
  const state = readHistoryState()
  const nested = state.usr && typeof state.usr === 'object' && 'privacyBoundary' in state.usr
    ? (state.usr as { privacyBoundary?: Partial<PrivacyBoundary> }).privacyBoundary
    : null
  if (nested?.token !== boundaryRef.current?.token) {
    clearingModeRef.current = null
    setClearing(false)
    hardClear()
    return
  }
  clearingModeRef.current = null
  setClearing(false)
}, [hardClear, pathname])
```

`hardClear` 首行 `if (!claimClearing('hard')) return`；所有旧 `clearingRef` 读取点都迁移到唯一的 `clearingModeRef`。

- [ ] **Step 4: Provider 包住 children/overlay**

`KioskPrivacyGuard` 将 warning descriptor 与三个动作提供给 `KioskSessionControlContext.Provider`；硬清场仍返回最高层 `PrivacyClearingOverlay`。硬隐私 timer 的活动事件、visibility、BFCache 逻辑不改变。

- [ ] **Step 5: 运行 typecheck 与 privacy 基线**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk test:browser:privacy
```

Expected: typecheck PASS；既有 privacy 18/18 PASS。

- [ ] **Step 6: 增加 warning history 不复制敏感 state 的浏览器断言**

```ts
test('warning history does not copy sensitive route state and continue returns the original entry', async ({ page, api }) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/interview/tips')
  await page.evaluate(() => {
    const current = window.history.state ?? {}
    window.history.replaceState(
      { ...current, usr: { accessToken: 'must-stay-on-original-entry' } },
      '',
      window.location.href,
    )
  })
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 3_000 })
  expect(await page.evaluate(() => window.history.state?.usr ?? null)).toBeNull()
  await page.getByRole('button', { name: '继续使用', exact: true }).click()
  expect(await page.evaluate(() => window.history.state?.usr?.accessToken ?? null))
    .toBe('must-stay-on-original-entry')
})
```

- [ ] **Step 7: 提交安全层**

```bash
git add apps/kiosk/src/auth/KioskSessionControlContext.tsx apps/kiosk/src/auth/KioskPrivacyGuard.tsx
git commit -m "feat: route kiosk idle warnings through privacy guard"
```

### Task 4: 把 SessionTimeoutPage 接到真实安全动作并补文案（GREEN UI）

**Files:**
- Modify: `apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx`
- Test: `apps/kiosk/tests/visual/kiosk-session-warning.spec.ts`

- [ ] **Step 1: 先补任务文案与直接访问失败用例**

新增用例断言：

```ts
test('task-aware copy stays honest for hardware, AI and anonymous sessions', async ({ page, api }) => {
  registerKioskShell(api, { screensaverEnabled: false })
  await page.goto('/scan/start')
  await page.waitForURL((url) => url.pathname === '/session-timeout', { timeout: 3_000 })
  await expect(page.getByText('后台任务继续，终端页面将清除', { exact: true })).toBeVisible()
  await expect(page.getByText('匿名任务退出后无法恢复', { exact: true })).toBeVisible()
  await expect(page.getByText(/已保存到.*我的|可恢复/)).toHaveCount(0)
})
```

再增加 AI/面试来源断言“未保存的填写内容或练习内容会清除”，以及刷新 `/session-timeout` 后继续按钮不可恢复旧任务、最终安全回首页。

- [ ] **Step 2: 页面只消费 Context**

```tsx
const { warning, continueSession, hardClear, clearToScreensaver } = useKioskSessionControl()
const deadlineAt = warning?.deadlineAt ?? Date.now() + 30_000
const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000)))

const exitSession = useCallback(() => {
  if (warning?.exitTo === 'screensaver') clearToScreensaver()
  else hardClear()
}, [clearToScreensaver, hardClear, warning?.exitTo])
```

每秒按绝对 `deadlineAt` 重算；到 0 调 `exitSession`。继续按钮仅在 `warning?.canContinue` 时调用 `continueSession`，否则显示“返回首页并清除本机会话”并调用 `hardClear`。

- [ ] **Step 3: 动态文案分类**

```ts
const isHardware = sourcePath.startsWith('/print/') || sourcePath.startsWith('/scan/')
const isAiWork = sourcePath === '/assistant' || sourcePath.startsWith('/resume/') || sourcePath.startsWith('/interview/')
```

硬件、AI、通用与匿名文案必须组合显示；删除页面对 `logout` 的解构/调用和普通首页 navigate。现有 CSS 的按钮 `min-height: 118px` 已满足 72px，不改 CSS。

- [ ] **Step 4: 运行 warning 套件**

Run: `pnpm --filter @ai-job-print/kiosk test:browser:warning`

Expected: ordinary、屏保、退出、文案、按钮尺寸用例全部 PASS。

- [ ] **Step 5: 提交 UI**

```bash
git add apps/kiosk/src/pages/placeholders/SessionTimeoutPage.tsx apps/kiosk/tests/visual/kiosk-session-warning.spec.ts
git commit -m "feat: show task-aware kiosk session warnings"
```

### Task 5: ScanProgress 条件 busy（RED → GREEN）

**Files:**
- Modify: `apps/kiosk/src/pages/scan/ScanProgressPage.tsx`
- Test: `apps/kiosk/tests/visual/kiosk-session-warning.spec.ts`

- [ ] **Step 1: 新增 busy 状态用例**

增加三个场景：缺 task identity 时在 3 秒内出现 ordinary warning；waiting/网络重试时 6 秒内不出现 ordinary warning；completed/expired/failed/cancelled 返回后 busy 释放。保留既有 privacy 用例对 hard clear 停止轮询且 DELETE=0 的验证。

- [ ] **Step 2: 运行聚焦 RED**

Run: `pnpm --filter @ai-job-print/kiosk test:browser:warning --grep "scan busy"`

Expected: 缺 identity 场景 FAIL，因为当前 `useBusyLock(true)` 无条件持锁。

- [ ] **Step 3: 最小状态机实现**

```ts
type ScanBusyPhase = 'active' | 'terminal'
const hasTaskIdentity = Boolean(scanTaskId && controlToken)
const [busyPhase, setBusyPhase] = useState<ScanBusyPhase>('active')
useBusyLock(hasTaskIdentity && busyPhase === 'active')
```

每个 completed/expired/failed/cancelled 分支和明确取消分支在 navigate 前调用 `setBusyPhase('terminal')`。网络错误保持 active；effect cleanup 不调用 cancel。

- [ ] **Step 4: 运行扫描与真实性回归**

Run:

```bash
pnpm --filter @ai-job-print/kiosk test:browser:warning --grep "scan busy"
pnpm --filter @ai-job-print/kiosk test:browser:truth
pnpm --filter @ai-job-print/kiosk test:browser:w2
pnpm --filter @ai-job-print/kiosk test:browser:privacy
```

Expected: warning scan 用例 PASS；truth 23/23、W2 29/29、privacy 18/18 PASS。

- [ ] **Step 5: 提交 busy 修复**

```bash
git add apps/kiosk/src/pages/scan/ScanProgressPage.tsx apps/kiosk/tests/visual/kiosk-session-warning.spec.ts
git commit -m "fix: bound scan progress busy state"
```

### Task 6: 全量验证、文档与交付

**Files:**
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify/archive: `.ccg/tasks/p0-1b-kiosk-session-warning-20260729/*`

- [ ] **Step 1: 执行静态与构建门禁**

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
pnpm --filter @ai-job-print/kiosk verify:fusion-w2
pnpm --filter @ai-job-print/kiosk verify:fusion-w5
pnpm --filter @ai-job-print/kiosk verify:fusion-w6
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
```

Expected: typecheck/build/verify 全绿；lint 只能保留既有 Fast Refresh warning，不能新增 error。

- [ ] **Step 2: 执行浏览器门禁**

```bash
pnpm --filter @ai-job-print/kiosk test:browser:warning
pnpm --filter @ai-job-print/kiosk test:browser:privacy
pnpm --filter @ai-job-print/kiosk test:browser:truth
pnpm --filter @ai-job-print/kiosk test:browser:w2
pnpm --filter @ai-job-print/kiosk test:browser:w5
pnpm --filter @ai-job-print/kiosk test:browser:w6
```

Expected: warning 全绿、privacy 18/18、truth 23/23、W2 29/29、W5 18/18、W6 87/87。

- [ ] **Step 3: 安全与差异检查**

```bash
pnpm audit --audit-level high
git diff --check
git diff --stat origin/main...HEAD
git status --short
```

记录既有依赖告警，不用本任务顺手升级依赖；确认无密钥、无后端/硬件/部署改动。

- [ ] **Step 4: 双模型终审**

Claude Opus 4.6 与 Antigravity 并行审查 `origin/main...HEAD`，重点检查：hard deadline 未被预警延长、warning history 无敏感 state、屏保 boundary 原子交接、SessionTimeout 不自行 logout、ScanProgress 卸载不 cancel。Critical 必须修复并重审。

- [ ] **Step 5: 同步正式进度文档**

只在所有验证真实完成后勾选 P0-1B，记录精确测试数字、审查结果、未部署事实和剩余 P0-2～P0-6；不得宣称 Windows 真机、法务、签名或试运营完成。

- [ ] **Step 6: 归档 CCG 任务并提交**

把 task.json 更新为 completed，写 `review.md`，移动到 `.ccg/tasks/archive/2026-07/p0-1b-kiosk-session-warning-20260729/` 后强制纳入 Git。

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md .ccg/tasks/archive/2026-07/p0-1b-kiosk-session-warning-20260729
git commit -m "docs: close kiosk session warning task"
```

- [ ] **Step 7: 推送并创建 PR，不部署**

```bash
git push -u origin codex/p0-1b-kiosk-session-warning-20260729
gh pr create --base main --head codex/p0-1b-kiosk-session-warning-20260729 --title "feat: add task-aware kiosk session warning" --body "## Summary
- route ordinary idle and screensaver idle through the existing 30-second warning page
- keep the hard privacy deadline fail-closed and task-aware
- bound ScanProgress busy state to a real active task

## Verification
- local Kiosk typecheck/lint/build and W2/W5/W6 gates
- warning/privacy/truth browser suites
- Claude Opus 4.6 and Antigravity review

No production deployment is included."
```

等待 GitHub `build-and-verify`、`kiosk-browser-smoke`、`postgres-readiness` 全绿；只报告 PR 候选，不自动部署。
