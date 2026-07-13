# 青序 LightFlow K1 公共入口、身份与独立全屏页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变既有路由、会话、上传、待机或合规语义的前提下，将 Kiosk K1 的公共入口与独立全屏页迁移至青序 LightFlow `service-desk` 视觉体系。

**Architecture:** K1 只在六条精确路由启用 `service-desk`：顶层全屏页各自以根元素 class 获得主题，嵌套的 `/help` 仅由 `KioskRoot` 按 pathname opt-in。`LoginPage` 保留其现有会话编排，避免把 `useAuth`、安全 return path、idle logout、二维码 local-agent claim 的 props 跨文件重接；只拆 1,222 行登录 CSS 为职责单一的样式文件。先以 K1 静态合同得到 RED，再按页面域实现 GREEN。

**Tech Stack:** React、React Router、TypeScript、Tailwind CSS、`@ai-job-print/ui`、已有 Kiosk auth/upload/screensaver service、Node 静态 verify、Vite、真实 HTTP API、Codex in-app Browser。

---

## 0. 已核对的范围与硬边界

**唯一允许迁移的正式路由：**

- `/login` → `LoginPage`
- `/member/qr-login` → `MobileQrLoginPage`
- `/upload/phone` → `PhoneUploadPage`
- `/legal/:doc` → `LegalDocPage`
- `/screensaver` → `ScreensaverPage`
- `/help` → `HelpCenterPage`

**受保护，不得修改：** `ProfilePage`、所有 `/me/*` 页面、`services/api/**`、Prisma、DTO、认证接口与会话语义、支付、打印/扫描、AI、TRTC、Terminal Agent、招聘投递和招聘会合规语义。

**文件预算与拆分决定：**

| 文件 | 当前行数 | 决定 |
| --- | ---: | --- |
| `apps/kiosk/src/pages/auth/LoginPage.tsx` | 697 | 保持 TSX 编排文件；`PhoneLoginPane` 已独立为本文件子组件、二维码已是 `ScanQrLoginPanel.tsx`，再拆会重接 `useAuth`、`clearKioskSensitiveSession`、安全 return 与 idle callback，违反本波次“无行为拆分”边界。仅可改 JSX 语义 class、可访问性属性和 CSS import。 |
| `apps/kiosk/src/pages/auth/login.css` | 1,222 | 必须替换为少于 20 行的聚合入口，并拆为 `styles/login-shell.css`、`login-form.css`、`login-keypad.css`、`login-responsive.css`；每个职责文件少于 300 行。 |
| `MobileQrLoginPage.tsx` | 208 | 保留 `memberQrLoginApi`、短信、票据状态、重试与禁用逻辑；新增页级样式文件。 |
| `ScanQrLoginPanel.tsx` | 248 | 保留 local-agent claim、刷新、超时、降级提示与一次 claim guard；只改视觉 class。 |
| `PhoneUploadPage.tsx` | 150 | 保留 hash `sessionId`/`token`、服务端 accept 边界、10MB 限制、上传失败与重新选择；新增页级样式文件。 |
| `LegalDocPage.tsx` | 154 | 保留真实现有条款、`navigate(-1)` 和 fullscreen 路由；新增页级样式文件。 |
| `ScreensaverPage.tsx` | 173 | 保留进入时清会话、真实 playlist、缓存、任意输入退出和无素材退出；新增页级样式文件。 |
| `HelpCenterPage.tsx` | 255 | 保留既有诚实 FAQ、合规文案、内部跳转和 `/help` 壳层；新增页级样式文件。 |

**执行状态（2026-07-13，本地候选）**：基线已安全快进 `origin/main=08c7588e`。K1 静态合同先 RED 后 GREEN；手机上传动态 `aria-label`、CSS 根作用域与 Help FAQ 无空格 a11y ID 另有 RED→GREEN 修复。三个 K1 verify、Kiosk typecheck、lint（0 error；仅既有且未触及的 `KioskBusyContext` 两条 Fast Refresh warning）、production build 与 `git diff --check` 已本地通过；CI 仅增加三条 K1 Kiosk 命令，并保留主线 #211 CI 修复。Vite preview 已覆盖 1080×1920、390×844、390×700 下未勾协议禁用、缺 QR ticket、缺 upload hash、法律返回、Help FAQ/来源 state、无屏保素材返回首页。preview 未接 API，屏保/config 请求为 500、favicon 为 404，故不记录为 UX-2 真实 HTTP 成功闭环，也不代表预生产、Windows 真机或生产验收。内部规格复审和质量复审 APPROVE；Claude 终审 APPROVE，其 Help a11y Warning 已 TDD 修复并获 Claude 复审 APPROVE；Antigravity 两次因地区不可用未产生有效报告，因此未形成有效外部双批准。候选仅限本地分支，未 push、合并或部署。

**UX 审查整改（2026-07-13）**：Ardot 审查发现的嵌套交互、重复 `alert`、扫码/上传失效态和 `idle` 内部词已纳入同一 K1 静态合同并完成 RED→GREEN。Playwright 语义树确认协议、手机号与发送验证码均为并列控件，扫码未勾协议只有一个 `alert`；390×844 与 390×700 确认扫码/上传失效时不再展示表单或文件选择器外观；1080×1920 确认 Help 状态为“服务正常”。待机屏有素材态通过浏览器会话测试列表验证媒体、提示与 Enter 唤醒，未改生产播放逻辑或注入假数据。证据仍为本地 UX-1，不代表真实 API、预生产或真机验收。

## 1. 静态合同（先 RED）

### Task 1: 写 K1 verify，并确认当前 main 为 RED

**Files:**

- Create: `apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs`
- Modify: `apps/kiosk/package.json`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: 写失败的 K1 合同脚本**

脚本必须读取 router、`KioskRoot`、六个 K1 页面、`LoginPage`、`ScanQrLoginPanel`、现有 QR / 手机上传 verify 和新增 CSS。使用以下精确输入集合，防止波次扩大：

```js
const K1_TOP_LEVEL = ['/login', '/member/qr-login', '/upload/phone', '/legal/:doc', '/screensaver']
const K1_NESTED = ['/help']
const REQUIRED_PAGE_FILES = [
  'src/pages/auth/LoginPage.tsx',
  'src/pages/auth/MobileQrLoginPage.tsx',
  'src/pages/auth/ScanQrLoginPanel.tsx',
  'src/pages/upload/PhoneUploadPage.tsx',
  'src/pages/legal/LegalDocPage.tsx',
  'src/pages/screensaver/ScreensaverPage.tsx',
  'src/pages/help/HelpCenterPage.tsx',
]
```

合同断言必须至少包含：

```js
assert.match(kioskRoot, /pathname === '\/' \|\| pathname === '\/help'/)
assert.match(loginPage, /memberLogin\(/)
assert.match(loginPage, /clearKioskSensitiveSession\(/)
assert.match(loginPage, /isSafeInternalPath/)
assert.match(scanQrLoginPanel, /claimingRef\.current = true/)
assert.match(mobileQrPage, /fetchQrLoginStatus\(/)
assert.match(mobileQrPage, /confirmQrLogin\(/)
assert.match(phoneUploadPage, /uploadPhoneSessionFile\(/)
assert.match(phoneUploadPage, /sessionId/)
assert.match(screensaverPage, /clearKioskSensitiveSession\(/)
assert.match(screensaverPage, /getScreensaverPlaylist\(/)
assert.match(legalPage, /navigate\(-1\)/)
assert.doesNotMatch(helpPage, /一键投递|立即投递|平台投递/)
```

同时断言六条路由精确存在、`/help` 仍嵌套在 `KioskRoot`、其他路由没有被 `service-desk` 扩大覆盖、所有新增 CSS 有 `prefers-reduced-motion` 与目标视口规则、`login.css` 仅聚合四个职责 CSS、每个新增 CSS 少于 300 行。当前 main 未具备这些新 class/CSS，因此脚本必须以 `K1_PUBLIC_ENTRY_VERIFY_FAILED` 退出。

- [x] **Step 2: 注册并证明 RED**

在 `apps/kiosk/package.json` 增加：

```json
"verify:lightflow-k1-public-entry": "node scripts/verify-lightflow-k1-public-entry.mjs"
```

运行：

```bash
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
```

预期：非零退出；失败只报告缺少 K1 `service-desk` class、聚合 CSS 或响应式合同，不能因现有 auth/upload 行为失败。

- [x] **Step 3: 将 K1 合同和现有相关回归接入 CI**

在 CI 的 LightFlow 静态合同步骤中，以精确命令加入：

```bash
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
```

不要移动、删除或宽松化既有 guard；此步只在新 verify 已获得 GREEN 后提交。

### Task 2: 建立精确主题边界与 CSS 入口

**Files:**

- Modify: `apps/kiosk/src/layouts/KioskRoot.tsx`
- Modify: `apps/kiosk/src/pages/auth/LoginPage.tsx`
- Modify: `apps/kiosk/src/pages/auth/login.css`
- Create: `apps/kiosk/src/pages/auth/styles/login-shell.css`
- Create: `apps/kiosk/src/pages/auth/styles/login-form.css`
- Create: `apps/kiosk/src/pages/auth/styles/login-keypad.css`
- Create: `apps/kiosk/src/pages/auth/styles/login-responsive.css`
- Modify: `apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx`
- Create: `apps/kiosk/src/pages/auth/mobile-qr-service-desk.css`
- Modify: `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- Create: `apps/kiosk/src/pages/upload/phone-upload-service-desk.css`
- Modify: `apps/kiosk/src/pages/legal/LegalDocPage.tsx`
- Create: `apps/kiosk/src/pages/legal/legal-service-desk.css`
- Modify: `apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx`
- Create: `apps/kiosk/src/pages/screensaver/screensaver-service-desk.css`
- Modify: `apps/kiosk/src/pages/help/HelpCenterPage.tsx`
- Create: `apps/kiosk/src/pages/help/help-service-desk.css`

- [x] **Step 1: 只扩展 K1 主题作用域**

将 `KioskRoot` 的 `visualTheme` 判定改为显式集合，不改变 Tab、header、bottom nav、idle 或 FavoritesProvider：

```ts
const isServiceDeskRoute = pathname === '/' || pathname === '/help'
// KioskLayout 的其余 props 保持原值
visualTheme={isServiceDeskRoute ? 'service-desk' : 'legacy'}
```

每个顶层 K1 页的最外层元素必须带 `service-desk` 与专属根 class，例如：

```tsx
<main className="service-desk k1-mobile-qr min-h-screen">
```

不得把 KioskRoot 的 `service-desk` 条件改为前缀、通配符或所有 top-level route；不得改变 `createBrowserRouter` 的路径或层级。

- [x] **Step 2: 拆分登录样式，不拆会话编排**

把 `login.css` 改为仅顺序导入：

```css
@import './styles/login-shell.css';
@import './styles/login-form.css';
@import './styles/login-keypad.css';
@import './styles/login-responsive.css';
```

职责：`login-shell.css` 仅桌面/竖屏布局与 token surface；`login-form.css` 仅手机验证码、协议与错误/成功状态；`login-keypad.css` 仅数字键盘/触控反馈；`login-responsive.css` 仅 1080×1920、390×844、390×700 与 `prefers-reduced-motion`。所有颜色必须引用 `--sd-*` 或现有语义 token；不得保留 InkPaper 色、纸纹、衬线字体或渐变营销背景。

- [x] **Step 3: 写各页职责 CSS**

每个新 CSS 必须将布局限定到其根 class（如 `.k1-phone-upload`），并满足：Kiosk 触控主操作最小 56px、普通操作最小 48px、长文本可滚动、不以颜色作为唯一错误/禁用提示、动画在 reduced motion 下关闭 transition/animation。`ScreensaverPage` 仍保持黑色沉浸式媒体背景与 `z-[9999]`，只改提示层的 LightFlow 排版与 motion，不改媒体生命周期。

- [x] **Step 4: 取得基础 GREEN**

运行：

```bash
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
```

预期：三项通过，且 K1 verify 明确显示只有六条目标路由获得主题。

## 2. 分域视觉迁移（所有业务调用原样保留）

### Task 3: 登录、二维码与手机确认

**Files:**

- Modify: `apps/kiosk/src/pages/auth/LoginPage.tsx`
- Modify: `apps/kiosk/src/pages/auth/ScanQrLoginPanel.tsx`
- Modify: `apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx`
- Modify: `apps/kiosk/src/pages/auth/login.css`
- Modify: `apps/kiosk/src/pages/auth/styles/login-shell.css`
- Modify: `apps/kiosk/src/pages/auth/styles/login-form.css`
- Modify: `apps/kiosk/src/pages/auth/styles/login-keypad.css`
- Modify: `apps/kiosk/src/pages/auth/styles/login-responsive.css`
- Modify: `apps/kiosk/src/pages/auth/mobile-qr-service-desk.css`

- [x] **Step 1: 保留真实登录状态机，只替换视觉语义**

不可修改 `handleSendCode`、`handleLogin`、`handleQrLoginSuccess`、`finishWithSuccess`、`useIdleTimer`、`isSafeInternalPath`、`clearKioskSensitiveSession`、`memberLogin`、`sendSmsCode`、`getMemberAuthDeviceId` 或 `ScanQrLoginPanel` 的 `claimingRef`。允许将无语义容器改为 `k1-login-*` class，将状态按钮保留真实 `loading` / `agreed` / `confirmed` disabled 条件并补齐 `aria-live="polite"` 的现有 notice/error 容器。

- [ ] **Step 2: 逐状态保持可见且可恢复（部分完成；完整动态矩阵待 UX-2）**

静态合同和浏览器断言需覆盖：未同意协议不能登录、短信冷却、发送/登录 loading、SMS/登录失败重试、二维码刷新/本机 Agent 未连接/过期、手机票据缺失、手机验证码发送与确认禁用、成功后“回到一体机”。不得使用固定成功态、演示手机号或本地伪 ticket。

静态合同和既有 QR 回归已通过；Vite preview 仅实际走查未勾协议禁用与缺 QR ticket。完整短信/登录失败、二维码刷新/过期/本机 Agent 降级和票据确认的真实 HTTP 动态矩阵仍待 UX-2。

- [x] **Step 3: 纳入 K1 合并精确提交**

```bash
git add apps/kiosk/src/pages/auth/LoginPage.tsx \
  apps/kiosk/src/pages/auth/ScanQrLoginPanel.tsx \
  apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx \
  apps/kiosk/src/pages/auth/login.css \
  apps/kiosk/src/pages/auth/styles \
  apps/kiosk/src/pages/auth/mobile-qr-service-desk.css
git commit -m "feat(kiosk): migrate K1 auth entry to lightflow"
```

### Task 4: 手机上传链接

**Files:**

- Modify: `apps/kiosk/src/pages/upload/PhoneUploadPage.tsx`
- Create: `apps/kiosk/src/pages/upload/phone-upload-service-desk.css`
- Read-only dependency: `apps/kiosk/src/pages/upload/components/UploadSessionQrPanel.tsx`

- [x] **Step 1: 保留 upload session 契约**

不可更改 URL hash 的 `sessionId` / `token` / `purpose` 解析，`RESUME_ACCEPT`、`PRINT_DOC_ACCEPT`、`MAX_BYTES`、`uploadPhoneSessionFile` 参数、服务端错误文本、重新选择文件和 disabled 条件。页级样式只替换卡片层级、拖放/选择区、上传中状态、文件名、错误与成功说明的视觉表现。

- [ ] **Step 2: 保留真实失败与中断恢复（部分完成；完整动态矩阵待 UX-2）**

必须让无 token、超 10MB、服务端拒绝、上传中和上传成功仍走现有 `state` 分支；“重新选择文件”只调用现有 `setState('idle')`，不创建新 retry API。

静态合同及既有手机上传回归已通过；Vite preview 仅实际走查缺 upload hash。超 10MB、服务端拒绝、上传中、成功和重新选择的真实 HTTP 动态矩阵仍待 UX-2。

- [x] **Step 3: 纳入 K1 合并精确提交**

```bash
git add apps/kiosk/src/pages/upload/PhoneUploadPage.tsx \
  apps/kiosk/src/pages/upload/phone-upload-service-desk.css
git commit -m "feat(kiosk): migrate K1 phone upload to lightflow"
```

### Task 5: 法律文档与待机宣传屏

**Files:**

- Modify: `apps/kiosk/src/pages/legal/LegalDocPage.tsx`
- Create: `apps/kiosk/src/pages/legal/legal-service-desk.css`
- Modify: `apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx`
- Create: `apps/kiosk/src/pages/screensaver/screensaver-service-desk.css`

- [x] **Step 1: 保留法律文本和安全返回**

只调整 `LegalDocPage` 的阅读层级、可滚动内容、标题、更新日期和返回按钮样式。不得编辑 `TERMS_SECTIONS`、`PRIVACY_SECTIONS`、`DOCS` 内容、`doc` 默认回退或 `navigate(-1)`；文案仍须保持“不是网络招聘平台”、来源平台办理和隐私留存边界。

- [x] **Step 2: 保留待机清场和媒体恢复**

只为 `ScreensaverPage` 增加根 class 与样式 import。不得改动进入时 `clearKioskSensitiveSession()` + `logout()`、`getScreensaverPlaylist`、缓存解析、任意输入退出、媒体 error/ended 前进、黑屏 fallback 或 `navigate('/', { replace: true })`。

- [x] **Step 3: 纳入 K1 合并精确提交**

```bash
git add apps/kiosk/src/pages/legal/LegalDocPage.tsx \
  apps/kiosk/src/pages/legal/legal-service-desk.css \
  apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx \
  apps/kiosk/src/pages/screensaver/screensaver-service-desk.css
git commit -m "feat(kiosk): migrate K1 legal and screensaver to lightflow"
```

### Task 6: 帮助中心

**Files:**

- Modify: `apps/kiosk/src/pages/help/HelpCenterPage.tsx`
- Create: `apps/kiosk/src/pages/help/help-service-desk.css`
- Read-only dependency: `apps/kiosk/src/layouts/KioskRoot.tsx`

- [x] **Step 1: 仅迁移帮助页视觉和可访问性**

保留 `SECTIONS` 的真实已上线能力描述、`handleNavigate('/login')` 的 `state: { from: '/help' }`、所有内部 route、FAQ 展开状态、`aria-expanded`、返回 `/profile` 和合规脚注。允许为 FAQ button 增加 `aria-controls`/稳定 id，并使用 LightFlow 信息块、触控高度和可见焦点样式；不新增客服、预约、投递、支付或虚构功能入口。

- [x] **Step 2: 确认壳层不泄漏**

`KioskRoot` 只对 `/help` 获得 `service-desk`，首页 `/` 行为保持，`/profile`、`/me/*` 与所有非 K1 页面继续 `legacy`。

- [x] **Step 3: 纳入 K1 合并精确提交**

```bash
git add apps/kiosk/src/pages/help/HelpCenterPage.tsx \
  apps/kiosk/src/pages/help/help-service-desk.css \
  apps/kiosk/src/layouts/KioskRoot.tsx
git commit -m "feat(kiosk): migrate K1 help to lightflow"
```

## 3. 完整验证、浏览器证据与文档收口

### Task 7: 只在 GREEN 后接入 CI，并完成本地验收

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Read-only: `docs/compliance/compliance-boundary.md`

- [x] **Step 1: 静态与工程门禁**

```bash
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
pnpm --filter @ai-job-print/kiosk verify:qr-login-ui
pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm --filter @ai-job-print/kiosk build
git diff --check
```

预期：所有命令零 error；若保留既有 Kiosk Fast Refresh warning，记录为既有 warning，不能新增 warning。

- [ ] **Step 2: 真实浏览器矩阵（部分完成；UX-2 真实 HTTP pending）**

在 1080×1920、390×844、390×700 分别验证：

| 路由 | 真实状态与操作 |
| --- | --- |
| `/login` | 未同意协议禁用、真实登录失败提示、QR 刷新/过期/本机 Agent 降级、返回来源保留；不发送真实短信或提交真实手机号。 |
| `/member/qr-login` | 缺失/过期 ticket 的真实错误与“重新检查二维码”；若本地受控环境有真实 ticket，仅验证状态读取和禁用，不使用生产手机号。 |
| `/upload/phone` | 缺少 hash 的真实无效态；仅用无个人信息夹具 + 后端真实创建的一次性会话验证上传中、成功、服务端拒绝和重新选择。 |
| `/legal/privacy` 与 `/legal/terms` | 长文本滚动、返回路径、键盘焦点、缩放和 reduced motion。 |
| `/screensaver` | 真实终端配置下任意输入退出且会话已清；未配置/无素材时真实返回首页而非黑屏。 |
| `/help` | FAQ 展开、真实内部路由、`/login` 来源 state、返回我的、长答案与 reduced motion。 |

记录为 UX-1（静态/构建）或 UX-2（本地真实 HTTP + 浏览器），不得宣称 UX-3、UX-4 或预生产/真机完成。

已在 Vite preview 的三种目标视口走查未勾协议禁用、缺 QR ticket、缺 upload hash、法律返回、Help FAQ/来源 state、无屏保素材返回首页；preview 未接 API，屏保/config 为 500、favicon 为 404。故上述仅为本地 preview 可达状态，不可视为本步骤要求的 UX-2 真实 HTTP 成功闭环。

- [x] **Step 3: CCG 审查与精确提交**

变更超过 30 行时，以 `git diff origin/main...HEAD` 同时调用 Antigravity 和 Claude reviewer。Critical 必须修复并重审；Warning 写入 PR。然后精确 stage：

```bash
git add .github/workflows/ci.yml \
  apps/kiosk/package.json \
  apps/kiosk/scripts/verify-lightflow-k1-public-entry.mjs \
  apps/kiosk/scripts/verify-qr-login-ui.mjs \
  apps/kiosk/scripts/verify-resume-phone-upload-ui.mjs \
  apps/kiosk/src/layouts/KioskRoot.tsx \
  apps/kiosk/src/pages/auth/LoginPage.tsx \
  apps/kiosk/src/pages/auth/MobileQrLoginPage.tsx \
  apps/kiosk/src/pages/auth/ScanQrLoginPanel.tsx \
  apps/kiosk/src/pages/auth/login.css \
  apps/kiosk/src/pages/auth/mobile-qr-service-desk.css \
  apps/kiosk/src/pages/auth/styles/login-shell.css \
  apps/kiosk/src/pages/auth/styles/login-form.css \
  apps/kiosk/src/pages/auth/styles/login-keypad.css \
  apps/kiosk/src/pages/auth/styles/login-responsive.css \
  apps/kiosk/src/pages/upload/PhoneUploadPage.tsx \
  apps/kiosk/src/pages/upload/phone-upload-service-desk.css \
  apps/kiosk/src/pages/legal/LegalDocPage.tsx \
  apps/kiosk/src/pages/legal/legal-service-desk.css \
  apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx \
  apps/kiosk/src/pages/screensaver/screensaver-service-desk.css \
  apps/kiosk/src/pages/help/HelpCenterPage.tsx \
  apps/kiosk/src/pages/help/help-service-desk.css \
  docs/progress/current-progress.md \
  docs/progress/next-tasks.md \
  docs/superpowers/plans/2026-07-13-qingxu-lightflow-k1-public-entry.md
git commit -m "feat(kiosk): migrate K1 public entry to lightflow"
```

禁止 `git add .`；不得 stage `.ccg/tasks` 之外的任何 AI 工具状态或浏览器产物。

内部规格复审、质量复审与 Claude 终审均为 APPROVE；Claude 指出的 Help FAQ a11y Warning 已 TDD 修复并获复审 APPROVE。Antigravity 两次因地区不可用未产生有效报告，尚未形成有效外部双批准。候选仅限本地分支，未 push、未合并、未部署。

## 4. 计划自审

- [x] 范围只含六条 K1 路由、Kiosk shell opt-in、K1 verify/CI 和进度事实；没有 `/profile`、`/me/*` 或 API/DTO/Prisma 变更。
- [x] 每个目标页保留了真实数据或真实状态分支、失败/重试、禁用与返回路径；没有演示登录、固定 success、假上传或假屏保素材。
- [x] `LoginPage.tsx` 的不拆分理由和 `login.css` 的强制拆分均明确；所有新增 CSS 都有 300 行上限与 reduced motion 责任。
- [x] 静态 verify 已先 RED，CI 仅在 GREEN 后接入；浏览器证据已按本地 preview 与 UX-2 真实 HTTP 边界区分。
- [x] 搜索本计划中没有未决占位标记或“稍后实现”措辞。
