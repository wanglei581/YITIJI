# 青序 LightFlow 首页与真实登录弹窗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改动 4188 已确认业务卡片、分类导航、底部三 Tab 和真实功能入口的前提下，删除首页旧 Hero 与图形 Logo，把首屏调整为纯文字品牌、真实设备状态、服务价值卡和真实会员登录弹窗。

**Architecture:** 首页只负责展示与弹窗开关；手机号、验证码、倒计时、协议门控、deviceId 和真实登录请求从 K1 `LoginPage` 无行为抽取为共享控制器，独立登录页与首页弹窗共同消费同一实现。首页设备状态使用既有终端打印机状态端点和浏览器网络事件，未知或失败时诚实降级，不显示假在线。认证 API、路由、DTO、后端、数据库和 Terminal Agent 均不变。

**Tech Stack:** React 18、TypeScript、React Router、原生 `<dialog>`、现有青序 LightFlow CSS/token、Node 静态 verify、Vite。

---

## 0. 执行边界与停止条件

本计划只覆盖首页和可复用的真实手机号登录弹窗，不覆盖 `/assistant`、`/profile`、Admin、Partner 或其他业务页。

### 功能归位声明

- 真实闭环：游客在首页查看业务并可直接体验；点击“登录 / 注册”后在原页面完成真实手机号验证码登录；成功后身份卡切换为本人状态。
- 前端：`apps/kiosk/src/pages/home/`、`apps/kiosk/src/pages/auth/`、Kiosk verify 与 CI 接线。
- 后端：不涉及；继续使用现有会员认证和终端状态端点。
- Terminal Agent：不涉及；不新增本地协议或硬件调用。
- 共享类型 / 共享 UI：不涉及；不为单一首页弹窗扩张公共包。
- 文档：本计划、正式规格、当前进度和下一步任务。
- 不新增路由、业务入口、依赖、认证 API、持久化 token、假登录、假设备状态或演示数据。
- `ContinuePanel`、六类 `SERVICE_GROUPS`、百宝箱、智慧校园、合规说明和底部三 Tab 保持现有行为。

### 硬停止条件

- K1 最终分支 `codex/qingxu-lightflow-k1-20260713` 尚未被当前实现分支吸收时停止，不复制旧 `LoginPage`。
- 根工作区、透明顾问素材任务或“我的页商用闭环第一批”仍有未提交变更时，不进入对应文件。
- 真实登录抽取导致 `verify:member-session-closure` 或 `verify:qr-login-ui` 失败时，先恢复行为等价，不继续做首页视觉。
- 终端状态端点不可用时只能显示“状态暂不可用 / 未配置 / 网络异常”，不得退回硬编码“打印机在线”。

### 预计允许修改的文件

```text
apps/kiosk/src/pages/auth/LoginPage.tsx
apps/kiosk/src/pages/auth/login.css
apps/kiosk/src/pages/auth/components/MemberAgreement.tsx
apps/kiosk/src/pages/auth/components/MemberPhoneLoginPane.tsx
apps/kiosk/src/pages/auth/components/MemberLoginDialog.tsx
apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts
apps/kiosk/src/pages/auth/styles/login-dialog.css
apps/kiosk/src/pages/home/HomePage.tsx
apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts
apps/kiosk/src/pages/home/styles/home-shell.css
apps/kiosk/src/pages/home/styles/home-responsive.css
apps/kiosk/scripts/verify-home-service-desk.mjs
apps/kiosk/scripts/verify-member-login-dialog.mjs
apps/kiosk/scripts/verify-member-session-closure.mjs
apps/kiosk/package.json
.github/workflows/ci.yml
docs/progress/current-progress.md
docs/progress/next-tasks.md
.ccg/tasks/qingxu-lightflow-k2-implementation/plan.md
.ccg/tasks/qingxu-lightflow-k2-implementation/task.json
.ccg/tasks/qingxu-lightflow-k2-implementation/review.md
```

`apps/kiosk/src/pages/auth/components/` 和 `apps/kiosk/src/pages/auth/hooks/` 不存在时按上述路径新建；不在其他目录复制登录实现。

## Task 1：确认 K1 真实登录基线已进入当前分支

**Files:**

- Read: `apps/kiosk/src/pages/auth/LoginPage.tsx`
- Read: `apps/kiosk/src/services/auth/memberAuthApi.ts`
- Read: `apps/kiosk/src/auth/AuthContext.tsx`
- Read: `apps/kiosk/scripts/verify-member-session-closure.mjs`
- Read: `apps/kiosk/scripts/verify-qr-login-ui.mjs`

- [ ] **Step 1: 检查实现分支包含 K1 最终历史**

Run:

```bash
git merge-base --is-ancestor codex/qingxu-lightflow-k1-20260713 HEAD
```

Expected: exit code `0`。若为 `1`，停止；先让 K1 完成 rebase / 合并，再从包含 K1 最终提交的干净分支执行本计划。

- [ ] **Step 2: 证明现有真实认证门禁全绿**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: 三条命令均 exit code `0`；登录发送验证码和提交登录均携带稳定 `deviceId`，扫码登录仍可用，token 仍只保存在公共终端内存会话。

- [ ] **Step 3: 锁定基线文件规模**

Run:

```bash
wc -l apps/kiosk/src/pages/auth/LoginPage.tsx apps/kiosk/src/pages/home/HomePage.tsx
git status --short --branch
```

Expected: 工作区干净；记录当前行数。`LoginPage.tsx` 已超过 500 行时，本任务必须通过抽取减小文件，禁止继续内联弹窗逻辑。

## Task 2：先写首页与登录弹窗静态合同（RED）

**Files:**

- Modify: `apps/kiosk/scripts/verify-home-service-desk.mjs`
- Create: `apps/kiosk/scripts/verify-member-login-dialog.mjs`
- Modify: `apps/kiosk/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 扩展首页冻结合同**

在 `verify-home-service-desk.mjs` 中先把旧 Hero 断言改为新冻结项。核心断言至少包含：

```js
expect(!home.includes('先问清楚'), '首页不再出现旧咨询 Hero 标题')
expect(!home.includes('<HeroSection />'), '首页不再挂载旧 HeroSection')
expect(!topBar.includes('KIcon name="logo"'), '顶部栏不再显示图形 Logo')
expect(topBar.includes('AI求职打印一体机'), '顶部栏保留纯文字品牌')
expect(home.includes('一站式求职服务'), '服务价值卡使用已批准标签')
expect(home.includes('简历、打印、岗位信息一趟办完'), '服务价值卡使用已批准主标题')
expect(home.includes('当前可使用功能'), '业务区标题使用冻结文案')
expect(home.includes('<MemberLoginDialog'), '首页复用真实登录弹窗')
expect(!topBar.includes('打印机在线'), '顶部栏源码不硬编码打印机在线')
expect(!topBar.includes('网络正常'), '顶部栏不单列静态网络正常')
```

保留并继续执行现有六类业务、真实路由、禁用状态、百宝箱、智慧校园、合规文案、触控尺寸和旧主题禁入断言。

- [ ] **Step 2: 新增认证单一实现合同**

创建 `verify-member-login-dialog.mjs`，读取共享 hook、独立登录页、弹窗、首页和 `KioskRoot.tsx`，至少锁定：

```js
assert.match(memberHook, /sendSmsCode\(phone, deviceId\)/)
assert.match(memberHook, /memberLogin\(phone, code, deviceId\)/)
assert.doesNotMatch(loginPage, /sendSmsCode\(|memberLogin\(/)
assert.doesNotMatch(loginDialog, /sendSmsCode\(|memberLogin\(/)
assert.match(loginPage, /useMemberPhoneLogin/)
assert.match(loginDialog, /useMemberPhoneLogin/)
assert.match(loginDialog, /showModal\(\)/)
assert.match(loginDialog, /onCancel=/)
assert.match(loginDialog, /aria-labelledby=/)
assert.match(loginDialog, /cancelPending\(\)/)
assert.match(loginDialog, /继续游客体验/)
assert.match(loginDialog, /\/legal\/terms/)
assert.match(loginDialog, /\/legal\/privacy/)
assert.match(home, /<MemberLoginDialog/)
assert.match(kioskRoot, /useIdleLogout\(/)
```

脚本还要断言弹窗样式包含 `::backdrop`、390×844、390×700、1080×1920、背景滚动锁、48px 次操作和 56px 主操作。

- [ ] **Step 3: 注册新门禁并接入 CI**

在 `apps/kiosk/package.json` 增加：

```json
"verify:member-login-dialog": "node scripts/verify-member-login-dialog.mjs"
```

在 `.github/workflows/ci.yml` 的 Kiosk verify 区，紧跟 `verify:home-service-desk` 运行：

```yaml
- run: pnpm --filter @ai-job-print/kiosk verify:member-login-dialog
```

- [ ] **Step 4: 运行 RED**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk verify:member-login-dialog
```

Expected: 两条命令都因新组件、新文案和真实状态 hook 尚不存在而失败；旧六类业务与路由相关断言仍通过。

- [ ] **Step 5: 提交 RED 合同**

```bash
git add apps/kiosk/scripts/verify-home-service-desk.mjs apps/kiosk/scripts/verify-member-login-dialog.mjs apps/kiosk/package.json .github/workflows/ci.yml
git commit -m "test(kiosk): lock LightFlow home login contract"
```

## Task 3：无行为抽取真实手机号登录控制器

**Files:**

- Create: `apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts`
- Create: `apps/kiosk/src/pages/auth/components/MemberPhoneLoginPane.tsx`
- Create: `apps/kiosk/src/pages/auth/components/MemberAgreement.tsx`
- Modify: `apps/kiosk/src/pages/auth/LoginPage.tsx`
- Modify: `apps/kiosk/scripts/verify-member-session-closure.mjs`

- [ ] **Step 1: 抽取共享状态与真实请求，不改变参数或成功回调**

`useMemberPhoneLogin.ts` 接口固定为：

```ts
export interface UseMemberPhoneLoginOptions {
  agreed: boolean
  onAgreementRequired: () => void
  onAuthenticated: (result: LoginResult) => void
}

export function useMemberPhoneLogin(
  options: UseMemberPhoneLoginOptions,
): MemberPhoneLoginController
```

控制器拥有手机号、验证码、活动输入、倒计时、loading、notice、error、数字键盘处理和 `cancelPending()`；必须保留以下真实调用：

```ts
const deviceId = getMemberAuthDeviceId()
const result = await sendSmsCode(phone, deviceId)

const deviceId = getMemberAuthDeviceId()
const result = await memberLogin(phone, code, deviceId)
options.onAuthenticated(result)
```

禁止把 token 写入 `localStorage`、`sessionStorage`、cookie、URL 或全局调试对象。

每次发送验证码或登录提交都必须捕获当前 request generation；`cancelPending()` 增加 generation 并清理当前可见 loading / notice / error。异步结果返回后只有 generation 仍匹配才允许更新界面或调用 `onAuthenticated`，确保用户关闭弹窗后迟到的响应不会偷偷登录。

- [ ] **Step 2: 抽取展示组件**

将现有 `PhoneLoginPane` 原样移动到 `components/MemberPhoneLoginPane.tsx`。组件只渲染输入、验证码、错误、主按钮和数字键盘，不直接 import 认证 API。

将现有协议勾选区移动到 `components/MemberAgreement.tsx`，继续使用：

```tsx
<Link to="/legal/terms">《用户服务协议》</Link>
<Link to="/legal/privacy">《隐私政策》</Link>
```

触控尺寸、错误 `role="alert"`、成功提示 `aria-live="polite"` 和验证码按钮禁用条件保持不变。

- [ ] **Step 3: 让独立登录页消费共享控制器**

`LoginPage.tsx` 继续拥有：安全 `returnTo` 解析、手机号 / 扫码 / 邮箱 Tab、扫码成功处理、成功过场、空闲清场和导航；手机号字段与请求改为：

```tsx
const phoneLogin = useMemberPhoneLogin({
  agreed,
  onAgreementRequired: requireMemberAgreement,
  onAuthenticated: finishWithSuccess,
})

<MemberPhoneLoginPane {...phoneLogin.paneProps} />
```

不得改变 `ScanQrLoginPanel`、`isSafeInternalPath`、`resolveLoginIdleMs`、`clearKioskSensitiveSession` 或成功后回跳顺序。

- [ ] **Step 4: 更新会话门禁读取共享 hook**

把 `verify-member-session-closure.mjs` 中发送验证码 / 登录的源码读取目标由 `LoginPage.tsx` 改为 `hooks/useMemberPhoneLogin.ts`；安全回跳断言继续读取 `LoginPage.tsx`。这只是跟随无行为拆分，不放宽任何断言。

- [ ] **Step 5: 证明共享抽取 GREEN**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
```

Expected: 全部 exit code `0`；lint 可保留仓库已有 Fast Refresh warning，但不得新增 error。

- [ ] **Step 6: 提交行为等价抽取**

```bash
git add apps/kiosk/src/pages/auth/LoginPage.tsx apps/kiosk/src/pages/auth/hooks/useMemberPhoneLogin.ts apps/kiosk/src/pages/auth/components/MemberPhoneLoginPane.tsx apps/kiosk/src/pages/auth/components/MemberAgreement.tsx apps/kiosk/scripts/verify-member-session-closure.mjs
git commit -m "refactor(kiosk): share real member phone login"
```

## Task 4：实现可复用的真实登录弹窗

**Files:**

- Create: `apps/kiosk/src/pages/auth/components/MemberLoginDialog.tsx`
- Create: `apps/kiosk/src/pages/auth/styles/login-dialog.css`
- Modify: `apps/kiosk/src/pages/auth/login.css`

- [ ] **Step 1: 实现原生 dialog 生命周期与焦点恢复**

组件接口固定为：

```ts
export interface MemberLoginDialogProps {
  open: boolean
  onClose: () => void
  onContinueAsGuest: () => void
  onAuthenticated?: () => void
}
```

`open` 变为 `true` 时保存触发元素并调用 `dialog.showModal()`；关闭、Escape、游客体验或登录成功时调用 `dialog.close()` 和 `onClose()`；关闭前调用共享控制器的 `cancelPending()`，关闭后把焦点还给仍存在的触发元素。不得通过路由跳转模拟弹窗。

- [ ] **Step 2: 复用真实手机号控制器和 AuthContext**

登录成功处理固定为：

```ts
const { login } = useAuth()

const handleAuthenticated = (result: LoginResult) => {
  login({
    id: result.user.id,
    phoneMasked: result.user.phoneMasked,
    nickname: result.user.nickname,
    token: result.token,
    method: 'phone',
  })
  onAuthenticated?.()
  closeDialog()
}
```

弹窗展示 `MemberAgreement` 和 `MemberPhoneLoginPane`，不复制 `sendSmsCode`、`memberLogin`、倒计时或 deviceId 逻辑。

- [ ] **Step 3: 实现批准内容与可访问语义**

弹窗至少包含：

```tsx
<dialog aria-labelledby="member-login-dialog-title">
  <button type="button" aria-label="关闭登录窗口">关闭</button>
  <h2 id="member-login-dialog-title">手机号登录</h2>
  <p>登录后查看本人简历、文档、AI记录、打印订单和收藏</p>
  <MemberAgreement />
  <MemberPhoneLoginPane />
  <button type="button" onClick={onContinueAsGuest}>继续游客体验</button>
  <p>公共设备长时间无操作将自动退出并清理本次会话。</p>
</dialog>
```

右上角必须始终保留不小于 48px 的显式关闭按钮。背景点击是否关闭必须与 Escape 一致；登录请求进行中不允许背景误关导致用户误解，但显式关闭和 Escape 仍可用，并通过 `cancelPending()` 忽略迟到响应。

首页已经由 `KioskRoot.tsx` 的全局 `useIdleLogout` 执行公共终端空闲清场；弹窗复用该真实清场机制，只展示一致提示，不新增第二套倒计时。静态门禁要继续锁定 `KioskRoot` 仍调用 `useIdleLogout`。

- [ ] **Step 4: 新增三视口弹层样式**

`login.css` 最后一行导入：

```css
@import './styles/login-dialog.css';
```

`login-dialog.css` 必须使用 LightFlow token，并覆盖：

```css
.member-login-dialog::backdrop { /* 克制蓝黑遮罩 */ }
.member-login-dialog { /* 1080 居中、最大宽高、无浏览器默认边框 */ }
.member-login-dialog .member-dialog-surface { /* 解除页面版 100vh */ }
body:has(.member-login-dialog[open]) { overflow: hidden; }

@media (width: 390px) and (height: 844px) { /* 底部弹层 */ }
@media (width: 390px) and (max-height: 700px) { /* 安全全屏高度、内部滚动 */ }
@media (width: 1080px) and (height: 1920px) { /* 居中弹层 */ }
@media (prefers-reduced-motion: reduce) { /* 取消非必要过渡 */ }
```

主操作最小高度 56px，关闭和游客体验最小高度 48px；390px 不得横向溢出；短屏由弹层内部滚动，不能让验证码、错误或主按钮被键盘永久遮挡。

- [ ] **Step 5: 运行弹窗门禁**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:member-login-dialog
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
```

Expected: 认证共享、协议链接、dialog 语义和响应式合同全部 PASS。

- [ ] **Step 6: 提交真实登录弹窗**

```bash
git add apps/kiosk/src/pages/auth/components/MemberLoginDialog.tsx apps/kiosk/src/pages/auth/styles/login-dialog.css apps/kiosk/src/pages/auth/login.css
git commit -m "feat(kiosk): add real member login dialog"
```

## Task 5：实现真实首页设备状态

**Files:**

- Create: `apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts`
- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`

- [ ] **Step 1: 实现诚实的状态模型**

共享给顶栏的结果固定为：

```ts
export type HomeDeviceTone = 'positive' | 'warning' | 'negative' | 'neutral'

export interface HomeDeviceStatusView {
  label: string
  tone: HomeDeviceTone
  networkIssue: boolean
}
```

映射规则固定为：

| 条件 | 文案 | tone |
|---|---|---|
| `navigator.onLine === false` | 网络异常 | negative |
| 未配置 `VITE_TERMINAL_ID` | 设备状态未配置 | neutral |
| 请求中 | 设备状态检测中 | neutral |
| `printerStatus === ready` | 打印机在线 | positive |
| `printerStatus === offline` | 打印机离线 | negative |
| `printerStatus === error` | 打印机异常 | negative |
| `printerStatus === low_paper` | 纸张余量偏低 | warning |
| 其他值 | 打印机状态未知 | neutral |
| 请求失败且浏览器在线 | 设备状态暂不可用 | neutral |

只请求现有 `/api/v1/terminals/${terminalId}/printer-status`。首次挂载立即请求；每 30 秒刷新；浏览器 `online` 事件立即重试，`offline` 事件立即切换文案。每次新请求前先 abort 上一轮未完成请求并增加 request generation，只有最新一轮可更新状态；卸载时清理 interval、事件监听和 `AbortController`，避免慢网请求堆积或旧响应覆盖新状态。

- [ ] **Step 2: 顶栏只消费状态，不写死成功文案**

`KioskTopBar` 使用：

```tsx
const deviceStatus = useHomeDeviceStatus()

<div className="k-status" role="status" aria-live="polite">
  <span className="k-device-status" data-status={deviceStatus.tone}>
    <i aria-hidden="true" />
    {deviceStatus.label}
  </span>
</div>
```

删除第二个“网络正常”药丸。网络正常时不单列；只有异常才由统一状态文案呈现。

- [ ] **Step 3: 先跑针对性门禁**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk typecheck
```

Expected: 真实状态与无硬编码在线断言通过；首页布局断言仍处于 RED，直到 Task 6 完成。

## Task 6：按 4188 冻结结构校准首页首屏

**Files:**

- Modify: `apps/kiosk/src/pages/home/HomePage.tsx`
- Modify: `apps/kiosk/src/pages/home/styles/home-shell.css`
- Modify: `apps/kiosk/src/pages/home/styles/home-responsive.css`

- [ ] **Step 1: 删除旧 Hero 和图形 Logo**

删除 `HeroSection`、其 `useClock` 依赖、`KIcon name="logo"`、品牌副标题和 Hero 时钟。顶部只保留：

```tsx
<header className="k-top">
  <strong className="k-brand">AI求职打印一体机</strong>
  <div className="k-status" role="status" aria-live="polite">
    <span className="k-device-status" data-status={deviceStatus.tone}>
      <i aria-hidden="true" />
      {deviceStatus.label}
    </span>
  </div>
</header>
```

其中 `deviceStatus` 必须来自 Task 5 的 `useHomeDeviceStatus()`，不得在 JSX 内回填固定成功文案。

- [ ] **Step 2: 新增固定服务价值卡**

在顶部栏后、身份卡前渲染：

```tsx
<section className="service-value" aria-labelledby="home-service-value-title">
  <span className="service-value-tag">一站式求职服务</span>
  <h1 id="home-service-value-title">简历、打印、岗位信息一趟办完</h1>
  <p>提供 AI 简历服务、求职材料、岗位与招聘会信息入口，以及本机打印扫描服务。</p>
</section>
```

该卡无按钮，不出现“小青”“推荐方案”“先问清楚”“一键投递”或录用承诺。

- [ ] **Step 3: 把未登录身份卡接到真实弹窗**

`IdentityPanel` 增加本地 `open` 状态和触发按钮 ref：

```tsx
const [loginOpen, setLoginOpen] = useState(false)
const loginTriggerRef = useRef<HTMLButtonElement>(null)

<button ref={loginTriggerRef} onClick={() => setLoginOpen(true)}>
  登录 / 注册
</button>
<MemberLoginDialog
  open={loginOpen}
  onClose={() => setLoginOpen(false)}
  onContinueAsGuest={() => {
    continueAsGuest()
    setLoginOpen(false)
  }}
/>
```

删除未登录主按钮的 `navigate('/login')`；直接访问 `/login` 的路由仍保留。关闭弹窗或游客体验后停留首页、保持滚动位置；成功后由真实 `AuthContext` 触发已登录身份卡。

- [ ] **Step 4: 保留登录态与续办真实能力**

已登录态继续展示脱敏昵称、真实简历 / 文档 / AI记录 / 收藏统计、退出和“进入我的”；不删除 `useHomeStats`。`ContinuePanel` 继续位于身份卡后，无真实续办项时仍返回 `null`。

- [ ] **Step 5: 更新业务区标题但不动业务矩阵**

```tsx
<h2>当前可使用功能</h2>
<p>按服务类别查看本机当前可使用功能。</p>
```

不得修改 `SERVICE_GROUPS`、`ServiceGroupCard`、`ToolboxSection`、`SmartCampusHorizontalSection`、路由、禁用状态和合规说明。

- [ ] **Step 6: 重写首屏样式，不扩散到业务卡片**

在 `home-shell.css` 中：

- 删除 `.k-mark`、旧 `.hero`、`.hero-clock` 规则。
- 新增 `.service-value`、`.service-value-tag`、`.k-device-status[data-status=...]`。
- 身份卡改为服务价值卡下方正常文档流间距，不再用 `margin-top: -24px` 叠压 Hero。
- 保留 LightFlow token、白色表面、细边框、克制阴影和现有动画约束。

在 `home-responsive.css` 中：

- 390×844 和 390×700 仍显示服务价值、身份和登录入口，不隐藏主操作或隐私信息。
- 1080×1920 保持 984px 内容宽度和清楚留白。
- 删除旧 Hero 时钟、Logo 和负 margin 的响应式补丁。
- 保留业务卡片两列 / 单列规则、底部导航 112px 和 reduced motion。

- [ ] **Step 7: 首页合同转 GREEN**

Run:

```bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk verify:member-login-dialog
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
```

Expected: 全部 PASS；六类业务数量、路由、禁用状态和动态扩展服务无变化。

- [ ] **Step 8: 提交首页校准**

```bash
git add apps/kiosk/src/pages/home/HomePage.tsx apps/kiosk/src/pages/home/hooks/useHomeDeviceStatus.ts apps/kiosk/src/pages/home/styles/home-shell.css apps/kiosk/src/pages/home/styles/home-responsive.css
git commit -m "feat(kiosk): align LightFlow home with real login"
```

## Task 7：工程验证与三视口 UX 验收

**Files:**

- Verify only: all modified source and scripts

- [ ] **Step 1: 运行完整相关门禁**

```bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk verify:member-login-dialog
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
pnpm --filter @ai-job-print/kiosk verify:kiosk-shell-active-nav
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1 pnpm --filter @ai-job-print/kiosk build
git diff --check
```

Expected: 所有 verify、typecheck、build 和 diff check PASS；lint 无新增 error。

- [ ] **Step 2: 启动本地候选并验收 1080×1920**

检查：

- 顶栏只有文字品牌和真实 / 诚实降级状态。
- 不存在旧 Hero、小青人物、图形 Logo、“网络正常”假药丸。
- 价值卡 → 身份卡 → 可选续办 → 当前可使用功能顺序正确。
- 登录弹窗居中，背景不可滚动，焦点进入手机号入口，Escape / 关闭可恢复焦点。
- 主操作不小于 56px，普通交互不小于 48px。
- 业务卡片、百宝箱、智慧校园、合规说明和底部三 Tab 与变更前一致。

- [ ] **Step 3: 验收 390×844 与 390×700**

检查：

- 首页和弹窗 `scrollWidth === clientWidth`，无横向溢出。
- 390×844 为接近全宽底部弹层；390×700 可安全扩展全屏并内部滚动。
- 虚拟键盘出现后手机号、验证码、错误与“登录 / 注册”仍可滚动触达。
- 关闭、游客体验和协议链接可用；背景内容不会误触。
- reduced motion 下无强制大幅动效。

- [ ] **Step 4: 验证独立登录页未回归**

直接打开 `/login?from=/`，检查手机号、扫码、邮箱预留、协议、空闲清场和返回首页仍存在。仅在本地真实 API / 短信环境可用时执行一次真实验证码登录；不得用 token 注入、fixture、localStorage 或假成功替代。

- [ ] **Step 5: 记录验证边界**

浏览器验证只证明本地页面和可触达交互；若未接真实短信、生产 PostgreSQL、Windows Terminal Agent 和打印机，必须明确写“未做真实短信 / 真机 / 部署验收”，不得宣称商用上线完成。

## Task 8：双模型审查、文档收口与提交

**Files:**

- Modify: `.ccg/tasks/qingxu-lightflow-k2-implementation/review.md`
- Modify: `.ccg/tasks/qingxu-lightflow-k2-implementation/task.json`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

- [ ] **Step 1: 并行审查完整 diff**

按项目 CCG 规则并行调用 Antigravity 与 Claude reviewer，检查：

- 是否真的复用同一手机号认证实现。
- 是否保持 deviceId、协议、扫码、会话清场和安全回跳。
- 是否存在硬编码在线、假状态、假登录或敏感信息持久化。
- 是否只改首页批准项，未改变业务矩阵和其他页面。
- dialog 焦点、滚动锁、Escape、短屏和触控尺寸是否可靠。

任何模型因地区、超时或服务失败未返回有效报告时如实记录；Critical 修复后重新运行完整门禁和双模型审查。

- [ ] **Step 2: 更新正式进度**

`current-progress.md` 记录实际完成范围、验证证据和未部署 / 未真机边界；`next-tasks.md` 只把“首页 1–4 项”标记为本地候选，继续保留：

- AI助手左上角标题只在 K2a 收口。
- 我的左上角标题只在 K4 / 商用闭环完成后收口。
- 三端全页面迁移仍按既定波次推进。

- [ ] **Step 3: 更新 CCG 状态**

`task.json` 只在所有本计划门禁通过后更新 `currentPhase` 与 `nextAction`；K2a / K2b 仍未完成时任务保持 `in_progress`，不得归档整个 K2 任务。

- [ ] **Step 4: 提交文档收口**

```bash
git add docs/progress/current-progress.md docs/progress/next-tasks.md .ccg/tasks/qingxu-lightflow-k2-implementation/task.json .ccg/tasks/qingxu-lightflow-k2-implementation/review.md
git commit -m "docs: record LightFlow home login candidate"
```

- [ ] **Step 5: 最终范围检查**

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git log --oneline --decorate origin/main..HEAD
```

Expected: 只有本计划允许文件和此前已知 K2 提交；无 `/assistant`、`/profile`、Admin、Partner、API、Prisma、Terminal Agent 或透明顾问素材变更。

## 最终验收口径

只有同时满足下列条件，才能称“首页 + 真实登录弹窗本地候选完成”：

- 首页六项批准改动中的第 1–4 项落地，其余 4188 UI 未越界变化。
- 登录弹窗和独立登录页共同复用真实手机号认证实现。
- 所有相关 verify、typecheck、lint、production build、三视口浏览器检查通过。
- 双模型审查无未解决 Critical；无效报告已如实记录。
- 未真实短信、未部署、未预生产或未 Windows 真机时，交付说明明确保留这些边界。

AI助手第 5 项和我的第 6 项不属于本计划的完成条件，也不得在本计划中提前修改。
