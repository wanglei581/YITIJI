# AI 助手语音咨询恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/assistant` 恢复 4188 风格的完整语音咨询体验，并继续使用现有真实 TRTC 会话和严格环境门禁。

**Architecture:** `AssistantPage` 只负责显式门禁、模态层开关、底层页面 inert/滚动锁定和焦点返回；`AssistantCallPanel` 负责选择态、通话态、错误态与退出动作；`useAiAdvisorCallSession` 继续持有唯一 TRTC 状态机，仅补充可幂等结束并重置到选择态的 `endCall()`。所有退出操作先清理真实会话，再关闭或切换界面。

**Tech Stack:** React 18、TypeScript、Vite、原生 CSS、现有 `KIcon`、腾讯 `trtc-sdk-v5`、Node 静态 verify、Playwright 浏览器回归。

---

## 文件结构与责任

- Modify: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs` — 语音门禁、选择态、用户手势启动、诚实禁用、退出清理和响应式契约。
- Modify: `apps/kiosk/src/hooks/useAiAdvisorCallSession.ts:80-327` — 增加 `endCall()`，复用现有 `cleanup()` 并重置可见状态。
- Modify: `apps/kiosk/src/pages/assistant/AssistantCallPanel.tsx:1-116` — 4188 风格模态、选择态、真实通话态、错误态、焦点圈和退出语义。
- Modify: `apps/kiosk/src/pages/assistant/AssistantPage.tsx:162-490` — 弹层开关、底层 inert、滚动锁定、焦点返回与文字输入切换。
- Modify: `apps/kiosk/src/pages/assistant/assistant-lightflow-call.css` — 一体机和手机响应式语音弹层视觉。
- Modify: `docs/progress/current-progress.md` — 仅在实现和验证完成后记录已证明范围与未完成的真实 TRTC 验收。

### Task 1: 先建立会失败的语音体验门禁

**Files:**
- Modify: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`
- Test: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`

- [ ] **Step 1: 读取新增检查所需源码**

在现有读取区增加：

```js
const callPanel = read('src/pages/assistant/AssistantCallPanel.tsx')
const callHook = read('src/hooks/useAiAdvisorCallSession.ts')
const callStyles = read('src/pages/assistant/assistant-lightflow-call.css')
```

- [ ] **Step 2: 写入选择态、真实启动、诚实禁用和清理断言**

把以下断言追加在现有 `callActive` 门禁断言之后：

```js
expectIncludes(callPanel, 'role="dialog"', 'voice consultation uses dialog semantics')
expectIncludes(callPanel, 'aria-modal="true"', 'voice consultation is modal')
expectIncludes(callPanel, '和小青语音咨询', 'voice consultation keeps the 4188 dialog title')
expectMatches(
  callPanel,
  /onClick=\{\(\) => void call\.startCall\(\)\}[\s\S]*?直接语音通话/,
  'real TRTC starts only from the explicit direct-call action',
)
expectMatches(
  callPanel,
  /<button[^>]*disabled[\s\S]*?按住说话[\s\S]*?尚未开放/,
  'hold-to-talk remains honestly disabled',
)
expectIncludes(callPanel, 'call.endCall()', 'voice exits use the explicit idempotent end action')
expectIncludes(callHook, 'const endCall = useCallback', 'TRTC hook exposes an explicit end-and-reset action')
expectIncludes(callHook, 'startedRef.current = false', 'ending a call allows a deliberate retry')
expectIncludes(callStyles, '.assistant-voice-backdrop', 'voice dialog has an isolated overlay')
expectIncludes(callStyles, '@media (max-width: 600px)', 'voice dialog has phone layout rules')
expectIncludes(callStyles, '@media (max-height: 740px)', 'voice dialog has short-screen rules')
expectIncludes(callStyles, '@media (prefers-reduced-motion: reduce)', 'voice dialog respects reduced motion')
```

- [ ] **Step 3: 运行 verify 并确认 RED**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
```

Expected: FAIL，缺少 `role="dialog"`、选择态、`endCall` 和新响应式选择器；现有门禁检查仍通过。

- [ ] **Step 4: 提交测试门禁**

```bash
git add apps/kiosk/scripts/verify-assistant-trtc-guard.mjs
git commit -m "test(kiosk): define assistant voice consultation contract"
```

### Task 2: 为真实 TRTC 会话补充幂等结束和重置

**Files:**
- Modify: `apps/kiosk/src/hooks/useAiAdvisorCallSession.ts:273-327`
- Test: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`

- [ ] **Step 1: 在现有 `cleanup()` 后增加 `endCall()`**

实现必须复用现有资源清理，不能复制停止房间逻辑：

```ts
const endCall = useCallback(async () => {
  await cleanup()
  startedRef.current = false
  autoplayResumeRef.current = null
  setPhase('gate')
  setErrMsg('')
  setAiState('idle')
  setMuted(false)
  setSubtitle('')
  setElapsed(0)
  setNeedResume(false)
  setMicBlocked(false)
}, [cleanup])
```

- [ ] **Step 2: 从 hook 返回 `endCall`**

返回对象尾部保持 `cleanup` 供卸载兜底，同时增加：

```ts
return {
  phase,
  errMsg,
  aiState,
  muted,
  subtitle,
  elapsed,
  needResume,
  micBlocked,
  startCall,
  resumePlay,
  toggleMute,
  endCall,
  cleanup,
}
```

- [ ] **Step 3: 运行类型检查和门禁，确认 hook 变更自身正确**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
```

Expected: typecheck PASS；verify 仍 FAIL 于尚未实现的模态和样式断言，但 `endCall` 两项 PASS。

### Task 3: 把旧页内面板改为 4188 语音咨询模态

**Files:**
- Modify: `apps/kiosk/src/pages/assistant/AssistantCallPanel.tsx`
- Test: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`

- [ ] **Step 1: 定义明确的面板接口和退出锁**

```ts
interface AssistantCallPanelProps {
  onClose: () => void
  onSwitchToText: () => void
}

export function AssistantCallPanel({ onClose, onSwitchToText }: AssistantCallPanelProps) {
  const call = useAiAdvisorCallSession()
  const [ending, setEnding] = useState(false)
  const endingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const directCallRef = useRef<HTMLButtonElement>(null)
  const hangupRef = useRef<HTMLButtonElement>(null)
```

- [ ] **Step 2: 删除“挂载即 startCall”，改为用户明确点击启动**

选择态的真实入口必须是：

```tsx
<button
  ref={directCallRef}
  type="button"
  className="assistant-voice-choice assistant-voice-choice--primary"
  onClick={() => void call.startCall()}
>
  <span className="assistant-voice-choice-icon" aria-hidden="true"><KIcon name="phone" /></span>
  <span><strong>直接语音通话</strong><small>实时连接小青，支持字幕与静音</small></span>
  <KIcon name="arrow" />
</button>
<button type="button" className="assistant-voice-choice" disabled>
  <span className="assistant-voice-choice-icon" aria-hidden="true"><KIcon name="mic" /></span>
  <span><strong>按住说话</strong><small>尚未开放</small></span>
</button>
```

- [ ] **Step 3: 实现统一退出、返回选择态、重试和切换文字**

```ts
const runExit = useCallback(async (afterEnd: () => void) => {
  if (endingRef.current) return
  endingRef.current = true
  setEnding(true)
  try {
    await call.endCall()
    afterEnd()
  } finally {
    endingRef.current = false
    setEnding(false)
  }
}, [call])

const closeDialog = () => {
  if (call.phase === 'gate') onClose()
  else void runExit(onClose)
}

const returnToChoices = () => void runExit(() => {
  window.requestAnimationFrame(() => directCallRef.current?.focus())
})
const switchToText = () => void runExit(onSwitchToText)
const retryCall = () => void runExit(() => { void call.startCall() })
```

如果 lint 判断 `[call]` 依赖不稳定，应解构 `endCall/startCall/phase` 后使用具体依赖，不用 eslint 禁用注释掩盖问题。

- [ ] **Step 4: 实现模态语义、焦点圈和 Escape 行为**

```tsx
<div className="assistant-voice-backdrop">
  <section
    id="assistant-voice-dialog"
    ref={dialogRef}
    className="assistant-voice-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="assistant-voice-title"
    aria-busy={ending}
    onKeyDown={handleDialogKeyDown}
  >
    <header className="assistant-voice-header">
      <div><span>AI助手</span><h2 id="assistant-voice-title">和小青语音咨询</h2></div>
      <button type="button" className="assistant-voice-close" aria-label="关闭语音咨询" onClick={closeDialog}>
        <KIcon name="close" />
      </button>
    </header>
```

`handleDialogKeyDown` 必须把 Tab 限制在对话层内；选择态 `Escape` 关闭，通话态 `Escape` 只聚焦挂断按钮，不静默结束真实通话。

- [ ] **Step 5: 实现真实通话、错误和恢复状态**

通话区继续直接读取 `call.phase`、`call.elapsed`、`call.aiState`、`call.subtitle`、`call.needResume`、`call.micBlocked`；字幕为空时使用“通话字幕将在这里显示”，不能生成模拟对白。操作区必须包含静音、切换方式、改用文字咨询、挂断；错误态包含错误原因、重新连接和改用文字咨询。

- [ ] **Step 6: 运行 typecheck 和 verify**

Run:

```bash
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
```

Expected: typecheck PASS；verify 只剩 CSS 响应式断言未通过。

### Task 4: 接入页面模态生命周期并完成 LightFlow 视觉

**Files:**
- Modify: `apps/kiosk/src/pages/assistant/AssistantPage.tsx:162-490`
- Modify: `apps/kiosk/src/pages/assistant/assistant-lightflow-call.css`
- Test: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`

- [ ] **Step 1: 给页面增加触发器和底层容器引用**

```ts
const voiceTriggerRef = useRef<HTMLButtonElement>(null)
const workbenchRef = useRef<HTMLDivElement>(null)

const closeVoiceDialog = useCallback(() => {
  setCallActive(false)
  window.requestAnimationFrame(() => voiceTriggerRef.current?.focus({ preventScroll: true }))
}, [])

const switchVoiceToText = useCallback(() => {
  setCallActive(false)
  focusComposer()
}, [])
```

- [ ] **Step 2: 模态打开时锁定底层页面**

```ts
useEffect(() => {
  const workbench = workbenchRef.current
  if (!callActive || !workbench) return
  const previousOverflow = document.body.style.overflow
  workbench.setAttribute('inert', '')
  document.body.style.overflow = 'hidden'
  return () => {
    workbench.removeAttribute('inert')
    document.body.style.overflow = previousOverflow
  }
}, [callActive])
```

- [ ] **Step 3: 把通话模态移到 inert 容器之外**

```tsx
<div ref={workbenchRef} className="assistant-workbench">...</div>
{voiceAvailable && callActive && LazyCallPanel && (
  <Suspense fallback={<div className="assistant-voice-backdrop" role="status">通话模块加载中…</div>}>
    <LazyCallPanel onClose={closeVoiceDialog} onSwitchToText={switchVoiceToText} />
  </Suspense>
)}
```

触发按钮增加 `ref={voiceTriggerRef}`、`aria-haspopup="dialog"`、`aria-controls="assistant-voice-dialog"`、`aria-expanded={callActive}`，点击时关闭键盘并打开模态。

- [ ] **Step 4: 重写语音 CSS 为白色 4188 模态层**

CSS 必须包含以下可验证骨架，并延续现有 LightFlow 变量：

```css
.assistant-voice-backdrop {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 42px;
  background: rgba(11, 35, 74, 0.28);
  backdrop-filter: blur(10px);
}

.assistant-voice-dialog {
  display: flex;
  flex-direction: column;
  width: min(940px, 100%);
  max-height: min(1720px, calc(100dvh - 84px));
  overflow: hidden;
  border: 1px solid #cfe0f8;
  border-radius: 32px;
  color: #0b2859;
  background: #ffffff;
  box-shadow: 0 28px 80px rgba(41, 77, 129, 0.22);
}

@media (max-width: 600px) {
  .assistant-voice-backdrop { padding: 0; }
  .assistant-voice-dialog { width: 100%; height: 100dvh; max-height: none; border: 0; border-radius: 0; }
}

@media (max-height: 740px) {
  .assistant-voice-stage { overflow-y: auto; }
  .assistant-voice-controls { position: sticky; bottom: 0; padding-bottom: max(16px, env(safe-area-inset-bottom)); }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-voice-dialog, .assistant-voice-wave i, .assistant-voice-avatar::after { animation: none !important; }
}
```

其余选择卡、真人形象、字幕、错误卡和操作按钮样式必须使用真实 `ai-advisor.png` 与 `KIcon`，不能增加手绘 SVG 或占位资产。

- [ ] **Step 5: 运行门禁确认 GREEN**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
```

Expected: `ALL PASS assistant TRTC guard checks`。

- [ ] **Step 6: 提交功能实现**

```bash
git add apps/kiosk/src/pages/assistant/AssistantPage.tsx apps/kiosk/src/pages/assistant/AssistantCallPanel.tsx apps/kiosk/src/pages/assistant/assistant-lightflow-call.css apps/kiosk/src/hooks/useAiAdvisorCallSession.ts
git commit -m "feat(kiosk): restore assistant voice consultation"
```

### Task 5: 完整验证、浏览器对比和事实收口

**Files:**
- Modify: `docs/progress/current-progress.md`
- Test: `apps/kiosk/scripts/verify-assistant-trtc-guard.mjs`
- Test: `apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs`
- Test: `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`

- [ ] **Step 1: 运行静态质量门禁**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
pnpm --filter @ai-job-print/kiosk verify:lightflow-4188-layout-parity
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=local-lightflow-voice pnpm --filter @ai-job-print/kiosk build
```

Expected: 全部退出码 0；生产构建包含 TRTC 懒加载资产，普通门禁仍要求显式 `VITE_USE_TRTC_CALL=true`。

- [ ] **Step 2: 用显式 TRTC 开关重启本地 5174 候选**

先终止当前工作树的 `5174` Vite 进程，再运行：

```bash
VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk exec vite --host 127.0.0.1 --port 5174
```

Expected: `http://127.0.0.1:5174/assistant` 可访问并显示“语音咨询”。不触发“直接语音通话”就不会请求 TRTC 后端。

- [ ] **Step 3: 浏览器验证三个目标视口**

使用已获授权的 Playwright CLI，分别以 `1080×1920`、`390×844`、`390×700` 验证：

1. 进入 `/assistant`，打开语音咨询。
2. 对比 4188 参考截图和候选截图，确认白色模态、标题层级、顾问形象、选择卡和底部操作一致。
3. 确认“按住说话”禁用，打开选择层时无 `/trtc/session` 请求。
4. 不具备真实后端凭证时不点击“直接语音通话”；具备时单独记录连接结果。
5. 关闭后确认焦点返回触发器、页面恢复滚动、底部导航可操作。
6. 检查控制台无新增 error。

- [ ] **Step 4: 双模型并行审查变更**

按项目 CCG 规则并行调用 antigravity 与 Claude reviewer，审查 `git diff <实现前提交>..HEAD`，输出 Critical/Warning/Info。Critical 必须修复并重新双审；Warning 根据范围修复或记录理由。

- [ ] **Step 5: 更新项目进度事实**

在 `docs/progress/current-progress.md` 写入：

```markdown
- 2026-07-14：青序 LightFlow AI 助手恢复语音咨询入口和 4188 风格完整语音模态；真实通话继续复用 TRTC 显式门禁，选择层不创建会话，“按住说话”明确未开放，所有退出路径先清理会话。已通过相关 verify、typecheck、lint、生产 build 和三视口浏览器回归。若未完成真实后端/麦克风联调，TRTC 真实通话仍需单独验收，不得宣称线上完成。
```

- [ ] **Step 6: 提交验证与进度记录**

```bash
git add docs/progress/current-progress.md
git commit -m "docs: record assistant voice consultation verification"
```

- [ ] **Step 7: 归档 CCG 任务**

把 `.ccg/tasks/restore-assistant-voice-consultation` 移入 `.ccg/tasks/archive/2026-07/`，确保归档内容包含最终 `task.json`、`requirements.md` 和 `review.md`；只显式暂存本任务归档，不使用 `git add .`。
