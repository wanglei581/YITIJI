# User Center Wave 1 Operations UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不新增用户中心首页入口的前提下，把数据导出、注销和请求状态接入现有 `/me/settings`，把 Admin `/users` 占位页升级为真实的“会员与隐私”运营台，并完成一体机、手机、桌面、弱网和无障碍验收。

**Architecture:** Kiosk 设置页只做编排，step-up、请求列表、下载二维码和危险确认拆成独立组件；设置页领取导出始终显示一次性二维码，不信任可伪造的前端 terminal 环境变量来决定是否本地下载，由用户自有手机的 `/member/export-download` 页面从 URL fragment 取 ticket 并以 header 下载。注销动作只有服务端 capability 明确开放时才渲染。Admin 复用既有 `/users` 路由，提供会员状态搜索和隐私请求队列，不新增并列入口。

**Tech Stack:** React + Vite + TypeScript + Tailwind + `@ai-job-print/ui` + lucide-react + qrcode.react；NestJS Admin API；现有 AuthContext；Node static verify；浏览器/真机验收。

---

## 0. 文件预算与视觉边界

**Kiosk Create:**

- `apps/kiosk/src/services/auth/memberStepUpApi.ts`
- `apps/kiosk/src/services/api/memberPrivacy.ts`
- `apps/kiosk/src/pages/profile/me/privacy/AccessibleSettingsDialog.tsx`
- `apps/kiosk/src/pages/profile/me/privacy/StepUpDialog.tsx`
- `apps/kiosk/src/pages/profile/me/privacy/DataRightsPanel.tsx`
- `apps/kiosk/src/pages/profile/me/privacy/DataRequestList.tsx`
- `apps/kiosk/src/pages/profile/me/privacy/ExportDownloadQrDialog.tsx`
- `apps/kiosk/src/pages/auth/MemberExportDownloadPage.tsx`
- `apps/kiosk/scripts/verify-user-center-data-rights-ui.mjs`

**Kiosk Modify:**

- `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`
- `apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css`
- `apps/kiosk/src/routes/index.tsx`
- `apps/kiosk/package.json`

**Admin Create:**

- `apps/admin/src/services/api/memberPrivacyAdmin.ts`
- `apps/admin/src/routes/users/MemberDirectoryPanel.tsx`
- `apps/admin/src/routes/users/PrivacyRequestPanel.tsx`
- `apps/admin/src/routes/users/PrivacyRequestDetail.tsx`
- `apps/admin/scripts/verify-member-privacy-ops-ui.mjs`

**Admin/API Modify:**

- `apps/admin/src/routes/users/index.tsx`
- `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- `apps/admin/package.json`
- `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- `services/api/src/member-privacy/member-data-request.service.ts`
- `services/api/scripts/verify-member-data-request-state-machine.ts`
- `.github/workflows/ci.yml`

**Forbidden:**

- 新增 Profile 卡片、底部导航或 `/me/privacy` 并列入口。
- 新主题/新色板；必须复用“青序 LightFlow”与现有 `me-detail-inkpaper.css`。
- 公共终端保存/本地下载导出包。
- browser storage/cookie 保存会员 token、step-up token、download ticket。
- 管理员直接完成 export/delete。
- Admin 展示明文手机号、验证码、导出内容或 ticket。
- 支付、换绑、账号合并、套餐、推送。

**UI Metrics:**

- 1080×1920 一体机主要触控目标不小于 48×48px，间距不小于 12px。
- 手机单列；桌面正文最大宽度沿用设置页现有容器。
- 危险操作与主操作至少隔一个完整分组，不用只靠红色表达。
- Dialog 必须有 aria modal/title/description、初始焦点、Tab 循环、Esc、焦点归还。
- 不依赖 hover；七种请求状态都有文字与图标。

## Task 1: 先写 Kiosk UI 守卫（RED）

**Files:**

- Create: `apps/kiosk/scripts/verify-user-center-data-rights-ui.mjs`
- Modify: `apps/kiosk/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 静态守卫要求：
  - `MySettingsPage` 引入 `DataRightsPanel`
  - 不新建 `/me/privacy` 路由
  - step-up dialog 有 focus trap/Esc/focus restore
  - 导出下载页只从 `location.hash` 取 ticket，并立即清 fragment
  - ticket 只进 `x-member-download-ticket` header
  - Kiosk QR dialog 不创建 Blob/object URL
  - 手机下载页才可创建 Blob 下载
  - 注销文案包含不可恢复、旧资产不会转给新账号、处理失败支持路径
  - 没有邮箱、账号合并、立即注销成功、数据已全部删除等误导文案

- [ ] 核心断言：

```js
assert.match(settings, /<DataRightsPanel/)
assert.doesNotMatch(routes, /path:\s*'me\/privacy'/)
assert.match(dialog, /aria-modal="true"/)
assert.match(dialog, /event\.key === 'Escape'/)
assert.match(downloadPage, /window\.location\.hash/)
assert.match(downloadPage, /history\.replaceState/)
assert.match(privacyApi, /x-member-download-ticket/)
assert.doesNotMatch(qrDialog, /createObjectURL|download=/)
assert.match(dataRights, /旧账号资产不会转移到以后重新注册的账号/)
```

- [ ] 注册：

```json
"verify:user-center-data-rights-ui": "node scripts/verify-user-center-data-rights-ui.mjs"
```

- [ ] CI 紧跟 Wave 0 Kiosk 守卫；运行确认 RED。
- [ ] Commit：`test: specify user center data rights ui`。

## Task 2: 实现 Kiosk step-up 与 privacy API adapters

**Files:**

- Create: `apps/kiosk/src/services/auth/memberStepUpApi.ts`
- Create: `apps/kiosk/src/services/api/memberPrivacy.ts`

- [ ] step-up adapter 契约：

```ts
export function sendMemberStepUpCode(
  token: string,
  input: { action: MemberStepUpAction; deviceId?: string },
): Promise<StepUpChallenge>

export function verifyMemberStepUp(
  token: string,
  input: { challengeId: string; code: string; deviceId?: string },
): Promise<StepUpGrant>
```

- [ ] privacy adapter 契约：

```ts
export function listMyDataRequests(token: string, cursor?: string): Promise<MemberDataRequestPage>
export function createMyDataRequest(
  token: string,
  input: CreateMemberDataRequestInput,
  security: { idempotencyKey: string; stepUpToken?: string; deviceId?: string },
): Promise<MemberDataRequestItem>
export function authorizeMemberExportDownload(
  token: string,
  requestId: string,
  security: { stepUpToken: string; deviceId?: string },
): Promise<MemberExportDownloadAuthorization>
export function consumeMemberExportDownload(requestId: string, ticket: string): Promise<Blob>
export function getAccountClosureReceipt(
  token: string,
  idempotencyKey: string,
): Promise<MemberAccountClosureReceipt>
```

- [ ] 所有会员调用显式传 token；adapter 不读写 browser storage。
- [ ] 下载 URL 只含 requestId；ticket 只放 header；`credentials:'omit'`；错误信息不得包含 ticket。
- [ ] Mock mode list 返回空，写操作 fail closed，不伪造成功。
- [ ] Run typecheck，Commit：`feat: add member privacy web adapters`。

## Task 3: 抽取可访问设置 Dialog

**Files:**

- Create: `apps/kiosk/src/pages/profile/me/privacy/AccessibleSettingsDialog.tsx`
- Modify: `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`

- [ ] 从设置页移出当前 `ConfirmOverlay`，新 props：

```ts
interface AccessibleSettingsDialogProps {
  open: boolean
  title: string
  description: string
  tone?: 'default' | 'danger'
  initialFocus?: 'cancel' | 'confirm'
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
  children?: ReactNode
}
```

- [ ] open 前记录 activeElement；open 后危险操作默认聚焦取消；Tab/Shift+Tab 循环；Esc 非 busy 时关闭；close/unmount 归还焦点。
- [ ] 按钮不小于 48px，busy 时 aria-busy，错误 role=alert。
- [ ] logout/switch 切到新组件，功能不变。
- [ ] Run existing settings/profile guards + typecheck；Commit。

## Task 4: 实现 step-up 触控 Dialog

**Files:**

- Create: `apps/kiosk/src/pages/profile/me/privacy/StepUpDialog.tsx`
- Modify: `apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css`

- [ ] 状态机含 idle/sending/code/verifying/error；父组件传 action 和 `onGranted`。
- [ ] grant token 只存在 React state/闭包，回调后立即清空。
- [ ] 复用登录页数字键盘原则，输入 6 位后仍需点击“确认验证”。
- [ ] 显示脱敏号码、5 分钟有效、60 秒重发；错误不区分账号状态。
- [ ] close/action change/unmount 清空 code/challenge/grant。
- [ ] 样式只扩展 `.me-inkdetail` 作用域，不引入新色板。
- [ ] Run UI guard + typecheck；Commit。

## Task 5: 实现请求列表与数据权利面板

**Files:**

- Create: `apps/kiosk/src/pages/profile/me/privacy/DataRequestList.tsx`
- Create: `apps/kiosk/src/pages/profile/me/privacy/DataRightsPanel.tsx`
- Modify: `apps/kiosk/src/pages/profile/me/MySettingsPage.tsx`

- [ ] 请求列表覆盖 pending/handling/ready/completed/expired/failed/rejected/cancelled；错误局部重试，空态诚实。
- [ ] 只在 pending/handling 时 5 秒轮询；页面 hidden 暂停；失败退避至 60 秒；按 id 合并，不清已加载数据。
- [ ] 面板仅登录态渲染。导出我的数据始终可见；底部注销账号仅在 list/capabilities 响应的 `accountClosureAvailable=true` 时渲染，前端环境变量不能覆盖。未签字、开关关闭或参数不完整时不展示入口，也不把它描述为“建设中”。
- [ ] 导出申请顺序：说明 dialog → export_data_request step-up → `crypto.randomUUID()` → create → 合并列表 → 清 token。
- [ ] 注销顺序：分类说明 → 理解 checkbox → close_account step-up → 最终确认 → 为本次尝试创建并保留单一 idempotency key → create。若响应成功，显示 request id；若网络错误/响应丢失，先用原 JWT + 同一 key 调 closure receipt，只读确认已受理后再显示 request id。只有明确未受理时才允许重试同一 create，绝不生成新 key。
- [ ] 一旦确认受理，立即清 step-up token；保留最小回执和支持路径，随后由用户确认退出并返回 Profile。回执查询失败时不伪造失败/成功，提示保留申请 key 的末 6 位联系工作人员，且不得把完整 key 写 DOM/日志/analytics/storage。
- [ ] 只说“注销请求已受理，系统处理中”，禁止“注销成功”。
- [ ] `MySettingsPage` 目标小于 300 行。
- [ ] Run guards + typecheck；Commit。

## Task 6: 实现导出手机领取二维码与下载页

**Files:**

- Create: `apps/kiosk/src/pages/profile/me/privacy/ExportDownloadQrDialog.tsx`
- Create: `apps/kiosk/src/pages/auth/MemberExportDownloadPage.tsx`
- Modify: `apps/kiosk/src/routes/index.tsx`
- Modify: `apps/kiosk/src/pages/profile/me/privacy/DataRightsPanel.tsx`

- [ ] ready 请求的领取流程：export_data_download step-up → authorize → 始终显示二维码交给用户自有设备；不得根据 `VITE_TERMINAL_ID`、UA、viewport 或 query 参数切换为本机下载。
- [ ] 设置页只显示 QR、10 分钟倒计时和“不在本机保存”；关闭 dialog 即从 state 清 URL。
- [ ] QR 使用现有 `QRCodeSVG`，页面不打印完整 ticket URL，只显示 request id 后 6 位。
- [ ] 新顶级路由放在 `KioskRoot` 外：

```tsx
{ path: '/member/export-download', element: <MemberExportDownloadPage /> }
```

- [ ] 下载页必须：
  1. 从 `window.location.hash` 解析 request/ticket；
  2. 立即 `history.replaceState(null, '', window.location.pathname)`；
  3. 校验 request id 与 ticket 长度；
  4. ticket 只放 `x-member-download-ticket` header；
  5. 成功后在用户自有设备创建 Blob URL 和临时 anchor；
  6. 下载触发后 revokeObjectURL；
  7. 展示已领取/已失效/已使用/网络失败；
  8. 不自动重试消费型请求；
  9. 不写 console、DOM、analytics、storage 或 cookie。

- [ ] 静态守卫必须证明 QR 组件无本地下载，只有下载页有 Blob。
- [ ] 手机 390×844、桌面 1440×900、一体机 1080×1920 做布局检查。
- [ ] Commit：`feat: add mobile handoff for member data export`。

## Task 7: 先写 Admin 运营守卫（RED）

**Files:**

- Create: `apps/admin/scripts/verify-member-privacy-ops-ui.mjs`
- Modify: `apps/admin/package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] 守卫断言：
  - `/users` 不再含“功能建设中”
  - nav label 为“会员与隐私”
  - 页面有“会员目录/隐私请求”两个 tab
  - adapter 有 list/detail/retry/reject/escalate/listUsers/updateUserStatus
  - UI 没有 completed 按钮
  - retry 只对 failed；reject 只对 export pending/failed；delete failed 只能 escalate
  - active/disabled 可切换；closing/anonymized 只读
  - 只显示 phoneMasked
  - loading/error/empty/detail 状态存在
  - 处理理由必填且限长
  - 无招聘闭环禁词

- [ ] 注册 `verify:member-privacy-ops-ui`，加入 CI，运行 RED。
- [ ] Commit：`test: specify member privacy operations ui`。

## Task 8: 增加 Admin 会员目录 API

**Files:**

- Modify: `services/api/src/member-privacy/admin-member-privacy.controller.ts`
- Modify: `services/api/src/member-privacy/member-data-request.service.ts`
- Modify: `services/api/scripts/verify-member-data-request-state-machine.ts`

- [ ] 增加：

```text
GET   /api/v1/admin/member-privacy/users?phone=&status=&cursor=&pageSize=
PATCH /api/v1/admin/member-privacy/users/:id/status
```

- [ ] list 只返回：

```ts
interface AdminMemberSummary {
  id: string
  phoneMasked: string
  nickname: string | null
  status: EndUserStatus
  enabled: boolean
  createdAt: string
  lastLoginAt: string | null
  activeRequestCount: number
}
```

- [ ] 输入完整手机号时服务端 normalize+hash 精确匹配；响应永不返回 hash/enc。
- [ ] status DTO 只允许 active/disabled，reason 2–200 字符。
- [ ] active→disabled 同事务写 `status=disabled,enabled=false`，随后撤销全部 session/grant，写审计。
- [ ] disabled→active 同事务写 `status=active,enabled=true`，不恢复旧 session。
- [ ] closing/anonymized 任何人工切换都 409。
- [ ] 并发用 `updateMany where current status` CAS。
- [ ] API verify 覆盖权限、脱敏、分页、状态转换和 session revoke。
- [ ] Commit：`feat: add member governance admin api`。

## Task 9: 实现 Admin adapter 与运营页面

**Files:**

- Create: `apps/admin/src/services/api/memberPrivacyAdmin.ts`
- Create: `apps/admin/src/routes/users/MemberDirectoryPanel.tsx`
- Create: `apps/admin/src/routes/users/PrivacyRequestPanel.tsx`
- Create: `apps/admin/src/routes/users/PrivacyRequestDetail.tsx`
- Modify: `apps/admin/src/routes/users/index.tsx`
- Modify: `apps/admin/src/layouts/AdminLayoutWrapper.tsx`

- [ ] Adapter 复用 `authHeader/redirectToLogin/ApiHttpError`；mock 只返回空列表并禁用写操作。
- [ ] `UsersPage` 变为薄容器：

```tsx
export default function UsersPage() {
  const [tab, setTab] = useState<'members' | 'privacy'>('privacy')
  return (
    <Page title="会员与隐私" subtitle="处理会员状态与数据权利请求；敏感操作全程审计">
      <TabBar value={tab} onChange={setTab} />
      {tab === 'members' ? <MemberDirectoryPanel /> : <PrivacyRequestPanel />}
    </Page>
  )
}
```

- [ ] 导航仍用 key/path `users -> /users`，只改 label，不新增菜单。
- [ ] Privacy list 提供 status/type 筛选、游标分页、刷新、SLA 警示和详情。
- [ ] ready/completed/expired 只读；failed 可 retry；仅 export pending/failed 可 reject；delete failed 只显示“升级人工处理”，理由必填并二次确认。delete 不出现拒绝、取消或恢复 active 的按钮。
- [ ] 不展示 export file id、内部 stack、ticket 或导出内容。
- [ ] Member directory 提供脱敏列表/精确搜索、状态、最后登录、disable/enable 理由。
- [ ] closing/anonymized 显示不可操作说明；不做资产明细、账号合并或删除按钮。
- [ ] 异步失败保留当前列表/详情，不全屏清空。
- [ ] 文件控制：index 小于 160 行，各 panel 小于 400 行。
- [ ] Run Admin typecheck/static guard；Commit。

## Task 10: 浏览器 E2E、双模型复审与文档收口

**Files:**

- Create: `docs/acceptance/user-center-wave1-acceptance.md`
- Modify: `docs/product/user-data-flow-matrix.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Modify: `.github/workflows/ci.yml`

- [ ] CI 加入：

```yaml
pnpm --filter @ai-job-print/kiosk verify:user-center-data-rights-ui
pnpm --filter @ai-job-print/admin verify:member-privacy-ops-ui
```

- [ ] Kiosk：

```bash
pnpm --filter @ai-job-print/kiosk verify:user-center-wave0
pnpm --filter @ai-job-print/kiosk verify:user-center-data-rights-ui
pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home
pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch
pnpm --filter @ai-job-print/kiosk verify:member-session-closure
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk build
```

- [ ] Admin：

```bash
pnpm --filter @ai-job-print/admin verify:member-privacy-ops-ui
pnpm --filter @ai-job-print/admin lint
pnpm --filter @ai-job-print/admin typecheck
pnpm --filter @ai-job-print/admin build
```

- [ ] API data rights、SQLite/PG readiness、Redis、local/COS storage 全套重跑。
- [ ] 浏览器 E2E：
  1. 登录→设置→export step-up→ready；
  2. 一体机 authorize→QR→手机单次下载；
  3. 第二次扫码/刷新→已使用；
  4. 过期→不可下载；
  5. 注销两次确认→accepted→清 session；
  6. 旧 token/QR claim/step-up 全失效；
  7. 原手机号新注册→无旧资产；
  8. Admin export 失败重试/拒绝、delete 失败重试/升级→审计可查；
  9. Admin disabled/active；closing/anonymized 不可恢复。

- [ ] 视口：1080×1920、390×844、1440×900、200% zoom、键盘、读屏。
- [ ] 弱网：列表保留旧数据；step-up 不自动重复；download 不自动重试；closure 用同一 idempotency key。
- [ ] 验收证据不得包含真实手机号、验证码、token、ticket、导出包、签名 URL或简历内容。
- [ ] Claude + Antigravity 并行复审 UI/安全/无障碍；Critical/High 修复后重跑。
- [ ] 只有全部门禁通过才写 Wave 1 完成，否则记录精确阻塞。
- [ ] Commit：`docs: record user center wave1 acceptance`。

## Wave 1 可见完成定义

- `/me/settings` 是唯一数据权利入口，用户能申请、看状态、领取导出和提交注销。
- 公共终端不保存导出包；手机一次性领取，ticket 不进日志/存储。
- 注销提交后不伪造成功，用户得到请求编号和支持路径。
- Admin `/users` 不再是建设中，能处理会员状态和隐私请求。
- 没有任何 UI 按钮可直接把 export/delete 标 completed。
- 三端所有状态、错误、弱网和会话失效有真实反馈。
- LightFlow/现有设计系统保持一致，没有新入口、新主题和重复组件体系。
