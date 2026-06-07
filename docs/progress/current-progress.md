# 当前开发进度

> 最后更新：2026-06-07
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [feature-scope.md](../product/feature-scope.md)

---

## Kiosk 登录页样式改造 + 扫码登录入口预留（2026-06-07，Codex）

**目标：** 将 Kiosk 当前深蓝小卡片登录页调整为参考图的浅灰全屏登录体验：顶部返回、居中 AI 品牌、横向分段 Tab、宽表单、底部回首页与协议区；同时预留邮箱、微信扫码、支付宝扫码登录入口。当前真实可用登录方式仍为手机号验证码，扫码/邮箱只做入口与状态占位，不伪造登录成功。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/pages/auth/LoginPage.tsx` | 重写登录页视觉与交互：`手机号 / 邮箱 / 扫码` 三段 Tab；手机号页使用宽输入框 + 获取验证码 + 立即登录，继续调用现有 `sendSmsCode` / `memberLogin`；邮箱页展示待接入说明；扫码页新增 `微信扫码 / 支付宝扫码` 切换、二维码展示与刷新按钮，并明确提示真实登录需后续接入微信/支付宝开放平台授权回调 |

**当前边界：**

- ✅ 手机号验证码登录仍为真实链路，token 仍只写入 `AuthContext` 内存态，不写浏览器持久化存储。
- ✅ 扫码二维码为 UI / 协议占位，不接真实 OAuth，不会伪造“扫码成功”。
- ⏳ 后续若要真实微信/支付宝扫码登录，需要申请对应开放平台能力，补后端二维码会话、轮询/回调、账号绑定与风控。

---

## C 端会员短信 Provider 预留（2026-06-07，Codex）

**目标：** 当前尚未申请腾讯云短信服务，先把短信发送 Provider 选择层、腾讯云配置位和安全失败策略预留好；保持开发环境现有日志验证码行为不变。后续腾讯云短信签名 / 模板 / SDKAppID / CAM 密钥拿到后，只需补 `TencentSmsSender.sendCode()` 的真实 SendSms API 调用，不需要重写会员登录流程。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/member-auth/sms/sms-sender.ts` | 新增 `SMS_PROVIDER` 选择：`log`（开发日志验证码）/ `tencent`（腾讯云短信预留）。生产环境未显式配置 provider 或配置 `log` 时启动即失败；`tencent` 会校验 `TENCENT_SMS_SECRET_ID/SECRET_KEY/SDK_APP_ID/SIGN_NAME/TEMPLATE_ID`，真实发送暂未接入，调用时 fail-closed，不打印验证码 |
| `services/api/src/member-auth/member-auth.module.ts` | `SMS_SENDER` 从固定 `LogSmsSender` 改为 `createSmsSender` 工厂注入 |
| `services/api/src/member-auth/member-auth.service.ts` | 短信发送失败时立即删除本次 Redis 验证码和冷却键，避免「短信未发出但验证码仍可用」的残留状态 |
| `services/api/.env.example` | 新增 C 端会员短信验证码配置段：`SMS_PROVIDER` 与腾讯云短信 6 个 env 占位 |
| `services/api/scripts/verify-sms-provider.ts` + `package.json` | 新增 `pnpm verify:sms-provider`，无网络验证 Provider 选择、生产保护和腾讯云配置校验 |

**当前边界：**

- ✅ 开发环境默认仍可用日志验证码（`SMS_PROVIDER` 未配时自动 `log`）。
- ✅ 生产环境不会误用日志验证码：`NODE_ENV=production` 时必须显式 `SMS_PROVIDER=tencent`。
- ✅ 腾讯云短信配置项已固定，真实值后续只进服务端 `.env` / secrets manager，不进仓库。
- ⏳ 真实腾讯云 `SendSms` 调用未实现，等短信服务审核通过、签名和模板 ID 下发后补齐。

---

## 阶段开发与 UI/UX 节奏原则（2026-06-07，Codex）

后续功能开发采用「功能可用 + 基础 UX 合格 + 合规文案正确」作为单功能交付标准；不要先把所有功能堆完再补体验，也不要在核心链路未跑通前投入大规模视觉精修。

具体执行口径：

- 每个功能开发时同步保证基础体验：流程入口/下一步清晰，触控按钮尺寸足够，加载/失败/空状态可理解，关键返回/重试/继续操作完整。
- 每个功能完成后先做功能测试、流程测试和必要的真实 API / 浏览器 / 一体机手验；确认功能、流程、数据和合规文案都正常后，再进入该功能的小范围 UX 修正。
- 阶段内不追求最终视觉精修；多个核心功能稳定后，再集中做 UI/UX 设计收口，包括视觉层级、组件一致性、触控屏布局、动效、AI 数字人引导员和三端体验统一。
- 招聘相关入口始终优先校验合规文案：只能使用「去来源平台投递 / 扫码投递 / 去来源平台预约 / 扫码预约」等表述，禁止出现「一键投递 / 立即投递 / 平台投递」等闭环暗示。

---

## Phase C-1：会员登录安全收口 + 首页登录状态栏（2026-06-07，Claude）

**目标：** 不做完整「用户资产中心」，只做登录相关安全收口 + 首页登录状态栏，为后续「我的简历 / 我的文档 / AI记录 / 收藏」打基础。范围限定 Kiosk 登录态安全 + AI 结果读取归属 + 首页/我的页诚实文案，不新增底部 Tab，不动招聘闭环边界。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/auth/useIdleLogout.ts`（新增） | 空闲自动登出守卫：登录态且非忙碌时启 idle 计时，超时调 `logout()` 清内存会话；忙碌信号优先沿用 `KioskBusyContext`（打印/扫描/AI/上传 各流程 `useBusyLock` 注册的引用计数锁），同时沿用 `AuthContext.busy` 预留位，任一为真即暂停；阈值默认 180s，可经 `VITE_KIOSK_LOGOUT_IDLE_SEC` 覆盖；不读写任何浏览器存储 |
| `apps/kiosk/src/layouts/KioskRoot.tsx` | KioskShell 挂载 `useIdleLogout()`（与屏保控制器并列，二者均受忙碌态豁免） |
| `apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx` | 进入待机宣传屏即 `logout()` 兜底清理会员登录态（屏保为顶级路由、KioskShell 已卸载，与 idle 计时互不冲突；logout 幂等） |
| `apps/kiosk/src/auth/context.ts`、`AuthContext.tsx` | 新增内存态 `guestMode` + `continueAsGuest()`，用于首页状态栏区分「未登录（初始）」与「匿名使用（已选择先使用）」；`login`/`logout` 复位 `guestMode`；仍只存 React state，不写任何浏览器存储 |
| `apps/kiosk/src/pages/home/HomePage.tsx` | 新增 `LoginStatusBar`（Hero 与主功能卡之间的独立过渡层，非功能导航、不改底部 Tab）：未登录「登录后可查看历史简历与服务记录」+「手机号登录」/「先使用」；匿名「当前记录仅用于本次服务，登录后可保存记录」+「手机号登录」；已登录展示脱敏手机号 +「可查看我的简历、文档、收藏与 AI 记录」+「进入我的」；主操作按钮点击区 ≥56px；登录动作跳现有 `/login`，不在首页内嵌手机号输入 |
| `apps/kiosk/src/pages/profile/ProfilePage.tsx` | 登录态诚实化：移除「登录后可跨设备查看」超前文案；未登录→游客诚实提示 +「手机号登录」引导；已登录→「{脱敏手机号} · 会员资料已绑定 / 资产中心建设中，当前仅展示本次服务记录」+「退出登录」；底部说明改为「以上为本次服务产生的记录，仅保存在当前会话；账号资产中心（跨会话保存）建设中」；不伪造简历/文档/AI 记录数量（列表仍只来自本次会话 location.state） |
| `services/api/src/ai/ai.service.ts` | `loadResult` → `loadOwnedResult(taskId, kind, requesterEndUserId)`：会员（`endUserId` 非空）所有的结果**只能本人读取**，不同会员/匿名请求按「不存在」返回 null → 上层 `AI_TASK_NOT_FOUND`（既阻断越权、又不泄露存在性）；匿名结果（`endUserId` 为 null）保持可读（短 TTL 兜底）；过期/无 expiresAt 历史行仍视为不存在；`getResumeRecord`/`getResumeOptimize` 增加 `requesterEndUserId` 参数 |
| `services/api/src/ai/ai.controller.ts` | `GET /resume/records/:taskId` 与 `.../optimize` 新增 `resolveOptionalEndUser`，把会员 `endUserId` 透传给 service；optimize 审计补 `hasEndUser` |
| `apps/kiosk/src/services/api/{ai.ts,aiHttpAdapter.ts,aiMockAdapter.ts}` | `getResumeRecord`/`getResumeOptimize` 增加可选 `token`；http GET 带 `Authorization: Bearer`；mock 忽略 token |
| `apps/kiosk/src/pages/resume/{ResumeReportPage,ResumeOptimizePage}.tsx` | 读取解析/优化结果时带 `getToken()`，保证登录会员能读回本人结果（匿名继续可用） |
| `services/api/scripts/verify-ai-result-ownership.ts`（新增）+ `package.json` | 新增 `pnpm verify:ai-result-ownership`，运行期断言「用户不能读取他人 AI 结果」 |
| `apps/kiosk/.env.example` | 记录 `VITE_KIOSK_LOGOUT_IDLE_SEC`（默认 180s） |

**完成的安全收口：**

1. **公共终端登录态生命周期**：会员 token/user 只在内存（沿用既有 `AuthContext`，不写 localStorage/sessionStorage/IndexedDB/cookie）；新增「空闲超时自动登出」+「进入待机宣传屏自动登出」，忙碌态（打印/扫描/AI/上传）全程豁免，不会打断业务。
2. **AI 简历结果读取归属**：修复「拿到 taskId 即可读他人结果」的越权风险——会员结果只能本人凭 token 读取，越权与匿名请求一律 `AI_TASK_NOT_FOUND`；匿名结果维持短 TTL（默认 24h，已有留存治理 + 每小时 cron 清理），未长期保存简历原文。
3. **诚实化文案**：首页状态栏 + 我的页不再宣称「已保存 / 跨设备查看」等资产中心未完成能力，明确「仅本次会话 / 资产中心建设中」。

**仍属 Phase C-2（本阶段未做，已记 next-tasks）：**

- 匿名 AI 结果的一次性 `accessToken`（等价 materials 任务的 `accessTokenHash` 机制），把匿名读取从「短 TTL 兜底」收紧为「持有令牌才可读」；需 `AiResumeResult` 加列 + parse 响应回传令牌 + 各读取点透传。
- 完整「用户资产中心」：跨会话的我的简历/文档/AI记录/收藏列表 API + 落库归属展示。
- 登录态浏览器交互手验（需 API + 会员短信验证码）与 idle/屏保运行期登出手验。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；仅既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条（未触碰） |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ 通过；仅既有 chunk-size warning |
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api verify:ai-result-ownership` | ✅ ALL PASS：本人可读、他会员/匿名读会员结果均 `AI_TASK_NOT_FOUND`、匿名结果保持可读、过期视为不存在（parse + optimize 双覆盖） |
| `pnpm --filter @ai-job-print/api verify:end-user-assets`（回归） | ✅ ALL PASS（AiResumeResult 归属底座未受影响） |
| 合规禁词扫描（一键投递/立即投递/平台投递/投递简历/企业收简历/候选人管理/候选人推荐/面试邀约/Offer 管理） | ✅ 改动文件 0 命中；token 仅内存（localStorage/sessionStorage 仅出现在安全约束注释中） |
| 浏览器手验（Playwright + Chromium，`VITE_API_MODE=mock`，5188） | ✅ 13/13：首页未登录状态栏文案/按钮、点「先使用」→匿名状态栏、我的页游客诚实文案、无「跨设备查看」、底部「资产中心建设中」、登录跳 `/login`、底部 Tab 仍 首页/AI助手/我的；唯一 console error 为 `/favicon.ico` 404（Vite dev 默认，与本阶段无关）。截图：`/tmp/c1-home-guest.png`、`/tmp/c1-home-anon.png`、`/tmp/c1-profile-guest.png`、`/tmp/c1-login.png` |

**未解决风险：** 匿名 AI 结果在短 TTL 窗口内仍可凭 taskId（mock 形如 `mock-ai-<ts>-<n>`，可猜测）读取——本阶段已把**会员**结果收紧到本人，匿名收紧（一次性 token）留待 Phase C-2。登录态/idle/屏保登出的真实浏览器交互手验需 API + 短信验证码环境。

---

## Phase C-2A：匿名 AI 简历结果一次性 accessToken 安全收口（2026-06-07，Claude，feature/ai-anon-access-token）

**目标：** 把匿名 AI 简历结果读取从「taskId + 短 TTL 即可读」收紧为「taskId + 一次性 accessToken 才可读」，对齐 materials 任务 `accessTokenHash` 机制。**纯安全收口**，不做完整用户资产中心，不做我的简历/文档/AI记录列表 API，不碰活动/套餐/支付，不改岗位/招聘会，不做匿名转会员认领，不涉任何招聘闭环。会员路径不变（仍按 endUserId 本人校验）。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/prisma/schema.prisma` + 迁移 `20260607120000_add_ai_resume_result_access_token_hash` | `AiResumeResult` 新增可空 `accessTokenHash String?`（仅匿名 parse 铸造的令牌 SHA-256 hash）。additive / nullable / 非破坏性：不加索引、不建表、不动其它模型；沿用 `prisma db execute` 落 dev.db drift（同 §COS / §external-url 先例），未跑破坏性 reset。**PostgreSQL 迁移时随 dev.db drift 统一重整。** |
| `services/api/src/ai/ai.service.ts` | ①匿名 parse（`endUserId` 为 null）铸造 192-bit 随机 token（`randomBytes(24).toString('hex')`），DB 只存 `accessTokenHash=SHA-256(token)`，明文 token 只随 `submitResumeParse` 响应返回一次；②`loadOwnedResult`→`loadAuthorizedResult` + `isAuthorized`：会员行只放行本人；新匿名行须 `x-resume-access-token` 与 hash `timingSafeEqual` 匹配；历史 null-hash 匿名行 **fail-closed**；过期/无 expiresAt 仍按留存治理视为不存在；③optimize 懒生成继承 parse 行 `endUserId` + `accessTokenHash`，不铸新 token；④`persistResult` 落库前防御性剥除 payload 内 accessToken（确保 `payloadJson` 不含明文）。新增 `AiResultRequester { endUserId; accessToken }` 类型 + `hashAccessToken`/`verifyAccessToken` 工具 |
| `services/api/src/ai/ai.controller.ts` | 新增 `resolveAiResultRequester(req)`：有效会员 Authorization → 会员请求；否则匿名请求，**只从 `x-resume-access-token` header 读取令牌（不读 URL query）**。两个 GET 读取端点改用该 requester；parse 审计补 `accessTokenIssued`（布尔，绝不记录明文 token） |
| `services/api/src/ai/interfaces/ai-provider.interface.ts` + `packages/shared/src/types/ai.ts` | `ParseResumeOutput` / `ResumeParseResponse` 增加 `accessToken?: string`（仅匿名 parse 返回，会员 parse 不返回） |
| `apps/kiosk/src/services/api/ai.ts` | `getResumeRecord` / `getResumeOptimize` 第二参从 `token?` 改为 `ResumeReadAccess { token?; accessToken? }`（token→会员，accessToken→匿名） |
| `apps/kiosk/src/services/api/aiHttpAdapter.ts` | `accessHeaders()`：`token`→`Authorization: Bearer`，`accessToken`→`x-resume-access-token`，**不拼任何 URL query** |
| `apps/kiosk/src/services/api/aiMockAdapter.ts` | 签名对齐 `ResumeReadAccess`（mock 忽略 accessToken） |
| `apps/kiosk/src/pages/resume/aiResumeSession.ts`（新增） | 最小匿名会话：**只存 `taskId` + `accessToken`**，绝不存 report/modules/payload/PII/原文；仅 `sessionStorage`，受限模式 try/catch 静默降级 |
| `apps/kiosk/src/pages/resume/{ResumeParsePage,ResumeReportPage,ResumeOptimizePage}.tsx` | parse 后接收 `res.accessToken` 并 `saveAiResumeSession` + 经 `location.state` 透传；Report/Optimize 读取时 `{ token: getToken(), accessToken }`，刷新后 taskId/accessToken 回退到最小会话 |
| `apps/kiosk/src/auth/useIdleLogout.ts`、`apps/kiosk/src/hooks/useScreensaverController.ts`、`apps/kiosk/src/pages/screensaver/ScreensaverPage.tsx` | idle 自动登出 / 进入待机宣传屏时 `clearAiResumeSession()`（与既有 `clearPrintMaterialSession()` 并列），避免下一位用户继承匿名令牌 |
| `services/api/scripts/verify-ai-result-ownership.ts` | 扩展为 C-1 + C-2A 共 12 类断言（见下） |

**读取规则（最终）：**

- 会员行（`endUserId != null`）：仅本人会员 token 可读；其它会员、匿名一律 `AI_TASK_NOT_FOUND`。
- 新匿名行（`endUserId == null` 且 `accessTokenHash != null`）：带正确 `x-resume-access-token` 可读；无 token / 错 token / 仅会员 token 一律 `AI_TASK_NOT_FOUND`。
- 历史匿名行（`endUserId == null` 且 `accessTokenHash == null`）：**fail-closed**，任何请求都 `AI_TASK_NOT_FOUND`。
- 已过期 / `expiresAt` 为空：继续按留存治理视为不存在。
- 统一返回 `AI_TASK_NOT_FOUND`，不泄露任务是否存在。token 在 TTL 内可重复用于同一 taskId 的 parse/optimize 读取（不做 burn-after-read）。

**安全约束落地：** 明文 token 只在 `POST /resume/parse` 响应返回一次；DB 只存 SHA-256 hash；token 只走 `x-resume-access-token` header，**不进 URL query**；校验用 `timingSafeEqual`；最小 session 只存 taskId/accessToken，不存任何 AI payload / 原文 / PII。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 0 error / 0 warning |
| `pnpm --filter @ai-job-print/api verify:ai-result-ownership` | ✅ ALL PASS：12 类断言（匿名铸 token 正确 token 可读 parse / 懒生成读 optimize；无 token、错 token、仅会员 token 读匿名均 NOT_FOUND；会员本人可读、跨会员、匿名读会员均按规则；accessTokenHash 为 64 hex 且 == SHA-256(token)；DB 全列含 payloadJson 不含明文 token；optimize 继承 parse hash；历史 null-hash 行 fail-closed；过期匿名行即使 token 正确仍 NOT_FOUND） |
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；仅既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条（未触碰） |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ 通过；仅既有 chunk-size warning |
| `git diff --check` | ✅ 无空白错误 |
| 合规禁词扫描（改动文件） | ✅ 0 新增命中（仅既有 `ai.ts`/`shared/ai.ts` 头部合规约束注释中的「候选人推荐/面试邀约/Offer 管理」否定式声明，非新增） |

**未解决风险 / 边界：**

- 运行期手验（真实 API + 浏览器/一体机）未做：需 API + 会员短信验证码环境验证「匿名 parse 拿 token → 刷新/返回仍能读回；无 token/错 token 被拒；进屏保/idle 后下一位用户读不到上一位结果」。本轮为静态 + verify 脚本断言 + 三端 typecheck/lint/build。
- 历史匿名行 fail-closed 是**刻意安全取舍**：C-2A 部署后，部署前已生成、持有 taskId 但无 token 的在途匿名会话将无法再读回结果（须重新解析）；此类历史行在 TTL（默认 24h）内自然清理。
- `accessTokenHash` 列随 dev.db drift 经 `db execute` 落地；**PostgreSQL 迁移时需与既有 drift 条目统一重生成规范化**。
- 未做：完整用户资产中心 / 我的简历·文档·AI记录列表 API / 匿名转会员认领（均属 Phase C-2B 及以后）。

**2026-06-07 补充：匿名 session idle 清理缺口修复（PR #30 合入前）**

**缺口：** `clearAiResumeSession()` 虽已接入 `useIdleLogout` 与 `ScreensaverPage`，但 `useIdleLogout` 原 `enabled` 含 `isLoggedIn`，`useScreensaverController` 仅在屏保已配置且有素材时计时。因此**匿名用户**在屏保未配置 / 未触发时，`aiResumeSession`（sessionStorage 内 taskId + 一次性 accessToken）可能 idle 后不被清理 → 下一位用户刷新即可读回上一位匿名 AI 结果。

**修复：** 把 `useIdleLogout` 从「会员登录态空闲登出」扩为**公共终端空闲重置**，覆盖登录 + 匿名；与待机宣传屏按 `screensaverActive` 互斥，单一 idle 周期内只有一个计时器触发，不破坏现有屏保行为。

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/auth/useIdleLogout.ts` | `enabled` 去掉 `isLoggedIn`、新增 `screensaverActive` 入参 → `!busy && !onScreensaverRoute && !screensaverActive`（覆盖匿名；屏保接管时本守卫关闭）。idle 动作不变：清 `clearPrintMaterialSession()` + `clearAiResumeSession()` + `logout()`（幂等，匿名 no-op）+ replace 回首页。忙碌态（KioskBusyContext 引用计数锁 / AuthContext.busy）任一为真即暂停 |
| `apps/kiosk/src/hooks/useScreensaverController.ts` | 返回 `{ active }`（屏保是否已配置且有素材）；屏保 idle 逻辑本身**未改**（active 时仍优先 `/screensaver`） |
| `apps/kiosk/src/layouts/KioskRoot.tsx` | `const { active } = useScreensaverController(); useIdleLogout(active)`，二者按 active 互斥 |

**行为矩阵（修复后）：**

| 场景 | busy | 屏保 active | idle 结果 |
|------|------|------------|-----------|
| 匿名 / 会员，屏保未配置 | 否 | 否 | **useIdleLogout 接管**：清 print+AI session + 登出 + 回首页（**修复点：匿名也清**） |
| 匿名 / 会员，屏保已配置 | 否 | 是 | useScreensaverController 接管：清 session + 进 `/screensaver`（行为不变） |
| 打印/扫描/AI/上传中 | 是 | 任意 | 两个计时器都暂停，不清理、不打断业务（不变） |

**约束：** 仅清内存态 + sessionStorage；**未新增 localStorage / cookie / IndexedDB**。

**待手验（浏览器 / 一体机，真实 API + `VITE_API_MODE=http`，`VITE_KIOSK_LOGOUT_IDLE_SEC` 可调小如 5s 便于复现）：**

1. 匿名（未登录）走 `AI 简历服务 → 上传/选择简历 → 解析`，到诊断报告页；DevTools → Application → Session Storage 确认存在 `ai-job-print:current-ai-resume`，含 `taskId` + `accessToken`，**不含** report/payload/PII。
2. **屏保未配置**终端：静置超过 idle 阈值不触碰屏幕 → 自动回首页；确认 Session Storage 中 `ai-job-print:current-ai-resume` 已被清除；手动跳回 `/resume/report`（无 route state）→ 无法恢复上一位结果（报告为空 / `AI_TASK_NOT_FOUND`）。
3. **屏保已配置**终端：静置 → 进入 `/screensaver`（行为不变）；触摸唤醒回首页后同样确认 session 已清。
4. 忙碌态验证：在「AI 解析中 / 打印中」静置不应触发清理或跳转（busy 豁免）。

---

## Phase C-2B：会员个人资产中心 MVP — 后端只读资产列表 API + Kiosk 最小接入（2026-06-07，Claude，feature/member-assets-mvp）

**目标：** 把「我的」从会话态升级为登录会员可读的真实资产。本轮先做**后端只读资产列表 API**（不做活动/套餐/支付），并在 ProfilePage 保持现有入口风格的前提下，把对应入口最小接入真实列表/空态。无 schema 变更。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/member-assets/`（新增 module/controller/service/types） | 新增 `@Controller('me')` 三个只读端点 `GET /me/resumes` `/me/documents` `/me/ai-records`，全部 `@UseGuards(EndUserAuthGuard)`。模块自带 enduser 专用 `JwtModule`（同 JWT_SECRET + audience='enduser'）并本地 provide `EndUserAuthGuard`，使 guard 的 `JwtService` 可解析 |
| `services/api/src/app.module.ts` | 注册 `MemberAssetsModule` |
| `services/api/src/member-assets/member-assets.service.ts` | 查询只按**校验后的 endUserId**（来自 `req.endUser`，不接受任何外部传入 id）→ 跨用户越权天然不可能。resumes/ai-records 取 `AiResumeResult`（resumes=parse 行 + 是否已生成优化版；ai-records=parse+optimize 元数据）；documents 取 `FileObject`（active/未软删/未过期）。留存治理对齐 C-2A：`expiresAt > now`（自动排除 null 历史行 / 过期行）、文件排除软删/过期 |
| `packages/shared/src/types/memberAssets.ts`（新增）+ `index.ts` | `MemberResumeItem` / `MemberDocumentItem` / `MemberAiRecordItem`（**只元数据**，无 payloadJson/report/accessTokenHash/storageKey/sha256；文件给 `downloadUrlPath`/`previewUrlPath` 端点路径，不在列表直接签发 URL） |
| `apps/kiosk/src/services/api/memberAssets.ts`（新增） | `getMyResumes/getMyDocuments/getMyAiRecords(token)` + `fetchAccessUrl(path, token)`；envelope 解包；token 仅内存态传入；mock / 未登录返回 [] |
| `apps/kiosk/src/pages/profile/ProfilePage.tsx` | 保持九宫格入口风格不变；**仅登录会员**新增「账号资产」白卡：我的简历（查看报告→`/resume/report` 凭本人 token）/ 我的文档（下载，凭本人 token 换 TTL 签名 URL）/ AI 服务记录，含加载/空态/错误重试；游客不展示。footer 按登录态诚实化 |
| `services/api/scripts/verify-member-assets.ts`（新增）+ `package.json` | `pnpm verify:member-assets`，10 类断言 |

**安全/合规落地：**

- **必须会员登录**：三端点受 `EndUserAuthGuard`；匿名 / 缺 token / 错 token / 失效会话 / 内部运营 token 一律 **401**（`MEMBER_MISSING_TOKEN` / `MEMBER_TOKEN_INVALID` / `MEMBER_SESSION_EXPIRED`）。
- **只返回本人数据**：service 仅以校验后的 endUserId 查询，不接受外部 id → 跨用户隔离由构造保证。
- **不返回简历原文 / AI payload / PII**：select 显式列出安全列；文件不回内容/storageKey/sha256，只给换取 TTL 签名 URL 的端点路径。
- **空列表返回 []**；**不伪造数量**。
- 不做活动 / 套餐 / 支付；无 schema 变更（纯读）。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` / `lint` | ✅ |
| `pnpm --filter @ai-job-print/api verify:member-assets` | ✅ ALL PASS：本人可读简历/文档/AI记录、跨用户双向隔离、只回元数据无 payload/PII/storageKey、空列表 []、过期/软删排除、匿名/错 token/无会话 401、有效会员通过并注入本人 endUserId（共 10 类） |
| `pnpm --filter @ai-job-print/shared typecheck` | ✅ |
| `pnpm --filter @ai-job-print/kiosk typecheck` / `lint` / `build` | ✅（lint 仅既有 `KioskBusyContext` 2 warning） |
| HTTP 真机冒烟（`pnpm dev` 源码起 API:3013 + local 存储） | ✅ `/me/resumes` `/me/documents` `/me/ai-records` 路由 Mapped；匿名 → 401 `MEMBER_MISSING_TOKEN`；错 token → 401 `MEMBER_TOKEN_INVALID`。**关键修正**：初版 module 误以为 import `MemberAuthModule` 即可复用 guard，真机启动报 `Nest can't resolve EndUserAuthGuard(JwtService)`；改为模块自带 `JwtModule` + 本地 provide guard 后路由正常（单元 verify 直接 new guard 未覆盖此装配问题，靠 HTTP 冒烟兜住） |
| 浏览器手验（mock，5199） | ✅ 游客态：九宫格入口不变、无「账号资产」区、footer「登录后可查看本人账号资产」；登录态（临时强制+还原）：新增「账号资产」白卡，我的简历/我的文档/AI服务记录三组诚实空态，footer「留存到期自动清理，敏感文件不长期保存」 |
| 合规禁词扫描（改动文件） | ✅ 0 命中 |

**未解决 / 边界：**

- 真实登录态端到端手验需 API + 会员短信验证码环境（自 C-1 起延后）：本轮已用 HTTP 冒烟覆盖路由/鉴权 401，登录后真实列表渲染靠 typecheck + 临时强制登录截图覆盖。
- 文件临时访问目前回 `downloadUrlPath`/`previewUrlPath` 端点路径，前端操作时再换 TTL 签名 URL（复用既有 `/files/:id/download-url` 会员鉴权端点），未在列表里 eager 签发。
- 收藏 / 权益（`Favorite` / `BenefitGrant`）、打印订单聚合属 C-2C；活动/套餐/支付属 C-3+，本轮不做。

---

## Phase C-2C：会员收藏 + 权益底座（2026-06-07，Claude，feature/member-favorites-benefits-c2c）

**目标：** 建立 C-2C **最小底座**——`Favorite`（收藏服务端化）+ `BenefitGrant`（权益只读底座）的后端模型 / API / verify，并把 ProfilePage 的「我的收藏 / 我的权益」从「建设中」最小接入真实只读列表。**不做**活动页、套餐购买、支付、退款、核销真实逻辑；不迁移 Jobs 页 localStorage 收藏（留后续）。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/prisma/schema.prisma` + 迁移 `20260607130000_add_favorite_benefit_grant` | 新增 `Favorite`（`@@unique([endUserId,targetType,targetId])`，targetType=job/job_fair/policy，含展示标题快照 `title?`）+ `BenefitGrant`（benefitType=coupon/free_quota/package_entitlement/subsidy_eligibility_hint，status/sourceType/额度/有效期）两表，均 `endUserId` FK + `onDelete: Cascade`；EndUser 加 `favorites` / `benefitGrants` 反向关系。Additive 建表，沿用 `prisma db execute` 落 dev.db drift（同 C-2A 先例），未跑破坏性 reset。**PostgreSQL 迁移时随 dev.db drift 统一重整。** |
| `services/api/src/prisma/prisma.service.ts` | 新增 `favorite` / `benefitGrant` 两个 model delegate getter（本项目 PrismaService 走组合而非继承） |
| `services/api/src/member-favorites/`（新增 module/controller/service/dto/types） | `@Controller('me/favorites')`，全部 `@UseGuards(EndUserAuthGuard)`：`GET`（本人列表，可选 `?type=` 过滤）/ `POST`（幂等 upsert 新增）/ `DELETE /:targetType/:targetId`（幂等取消）。模块自带 enduser 专用 `JwtModule` + 本地 provide guard（同 C-2B 装配）。service 只按校验后的 `endUserId` 读写 → 跨用户越权天然不可能；非法 targetType → 400 `FAVORITE_INVALID_TARGET_TYPE` |
| `services/api/src/member-benefits/`（新增 module/controller/service/types） | `@Controller('me/benefits')` `GET`（本人权益只读列表，active 优先排序，只回元数据，无支付凭证）。**只读**，本阶段不接发放 / 核销 / 支付 |
| `services/api/src/app.module.ts` | 注册 `MemberFavoritesModule` + `MemberBenefitsModule` |
| `packages/shared/src/types/{memberFavorites,memberBenefits}.ts`（新增）+ `index.ts` | 前端契约 SSOT：`FavoriteTargetType` / `MemberFavoriteItem` / `AddFavoriteInput`；`BenefitType` / `BenefitStatus` / `BenefitSourceType` / `MemberBenefitItem`。API 侧按既有约定（见 `files/file.types.ts`）用**本地类型副本**（`member-*/*.types.ts`），不直接 import shared（ESM/CJS 互操作） |
| `apps/kiosk/src/services/api/memberFavorites.ts`（新增） | `getMyFavorites` / `addFavorite` / `removeFavorite` / `getMyBenefits`；envelope 解包；token 仅内存态传入；mock / 未登录返回 [] / no-op |
| `apps/kiosk/src/pages/profile/ProfilePage.tsx` | 「账号资产」白卡（仅登录会员）新增「我的收藏」（按 job/job_fair/policy 给图标，job/job_fair 可「查看」跳既有详情，行内「取消收藏」幂等调后端）+「我的权益」（类型图标 + 状态/额度/有效期副文本，补贴资格提示 info-only）两组，含加载/空态/错误重试；九宫格「我的收藏 / 我的权益」去掉误导性「建设中」标签，点按按登录态提示「见下方账号资产 / 登录后可查看」 |
| `services/api/scripts/verify-member-favorites-benefits.ts`（新增）+ `package.json` | `pnpm verify:member-favorites-benefits`，14 类断言 |

**安全 / 合规落地：**

- **必须会员登录**：4 个端点全部受 `EndUserAuthGuard`；匿名 / 缺 token / 错 token / 失效会话 / 内部运营 token 一律 **401**。
- **只操作本人数据**：service 仅以校验后的 endUserId 读写，不接受任何外部传入 id；`DELETE` 用 `deleteMany({ endUserId, ... })` → 绝不可能删到他人收藏（已用「A 删同 targetId、B 不受影响」断言覆盖）。
- **收藏合规（CLAUDE.md §10）**：只记录「对外部来源岗位 / 招聘会 / 政策的兴趣标记」，绝不记录投递结果 / 投递状态 / 面试 / Offer / 候选人数据；ValidationPipe(whitelist) 自动剥除未知字段，杜绝注入任何投递 / 候选人字段。
- **权益合规（next-tasks §五）**：`subsidy_eligibility_hint` 仅 info-only 资格提示，**绝不**出现「到账 / 已发放金额」承诺词（verify 断言扫描）；券 / 套餐额度只代表平台内服务 / 打印额度，不代表录用结果；表中不含任何支付凭证 / 密钥。
- **空列表返回 []**，**不伪造数量**；本阶段不接活动 / 套餐 / 支付。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` / `lint` | ✅ |
| `pnpm --filter @ai-job-print/api verify:member-favorites-benefits` | ✅ ALL PASS（14 类）：收藏新增/列表/幂等/type 过滤/取消幂等/跨用户删隔离；权益本人可读+active 优先+额度正确/跨用户隔离/空列表 []/补贴提示 info-only 无承诺词；Guard 匿名·错 token·无会话 401 + 有效会员注入本人 endUserId |
| `pnpm --filter @ai-job-print/api verify:member-assets` / `verify:ai-result-ownership` / `verify:end-user-assets`（回归） | ✅ ALL PASS（PrismaService / schema EndUser 关系 / app.module 改动未影响既有归属底座） |
| HTTP 真机冒烟（`PORT=3099` 源码起 API + local 存储） | ✅ 4 路由 Mapped（`GET/POST /me/favorites`、`DELETE /me/favorites/:targetType/:targetId`、`GET /me/benefits`）；无 DI 报错（沿用 C-2B 自带 JwtModule 装配，避开 `EndUserAuthGuard(JwtService)` 解析问题）；匿名 GET/POST → 401 `MEMBER_MISSING_TOKEN` |
| `pnpm --filter @ai-job-print/shared typecheck` | ✅ |
| `pnpm --filter @ai-job-print/kiosk typecheck` / `lint` / `build` | ✅（lint 仅既有 `KioskBusyContext` 2 warning；build 仅既有 chunk-size warning） |
| 合规禁词扫描（改动文件） | ✅ 0 实际命中：所有「到账 / 一键投递」字样均为否定式约束注释或 verify 禁词清单，无用户可见违规文案 |
| `git diff --check` | ✅ |

**未解决 / 边界（已记 next-tasks）：**

- **登录态真实列表端到端手验**未做：需 API + 会员短信验证码环境（自 C-1 起延后）——本轮用 HTTP 401 冒烟覆盖路由/鉴权、service+guard verify 覆盖读写/隔离/合规、typecheck/build 覆盖渲染编译。
- **Jobs 页 localStorage 收藏未迁移**：`apps/kiosk/src/lib/useJobFavorites.ts` 仍是本机 localStorage（匿名浏览可用）。本轮按「先做后端模型/API/verify + ProfilePage 最小接入」范围，未把 Jobs/JobDetail/Campus/Home 的收藏切到服务端（需登录态门控 UX，留后续增量）。ProfilePage 已展示服务端收藏（登录会员）。
- **打印订单聚合视图**（`PrintTask` 聚合）本轮未做，留 C-2C 后续 / C-5。
- 权益数据当前无写入入口（发放属活动 C-3 / 套餐 C-4，核销 / 支付属 C-5）；底座已就绪，verify 直接落库构造数据验证读取路径。

---

## Phase C-2C follow-up：岗位收藏服务端化 + 登录态门控（2026-06-07，Claude，feature/kiosk-job-favorites-server-sync）

**目标：** 把岗位列表 / 详情的本机 localStorage 收藏迁到服务端 `/me/favorites`（登录会员），并保留未登录 / 匿名的本机收藏体验，不破坏匿名浏览。**只做岗位**（招聘会 / 政策收藏入口作为下一小步）；不做投递 / 预约结果 / 企业端 / 候选人管理 / 活动 / 套餐 / 支付 / 权益发放。

**梳理结论：** 现有 `useJobFavorites` / `toggleFavorite` 实际调用点只有 `JobsPage` 与 `JobDetailPage`（HomePage / CampusPage 仅在文案里出现「收藏」字样，无收藏逻辑）。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/favorites/localFavorites.ts`（新增） | 匿名态本机收藏原语：`readLocalJobFavorites` / `toggleLocalJobFavorite`，沿用既有 `STORAGE_KEY='kiosk:jobFavorites:v1'`（历史本机收藏不丢失） |
| `apps/kiosk/src/favorites/context.ts` / `useFavorites.ts`（新增） | `FavoritesContextValue`（`ids:Set<string>` / `isFavorite` / `toggle` / `loading` / `source`）+ hook，拆分以满足 react-refresh/only-export-components |
| `apps/kiosk/src/favorites/FavoritesProvider.tsx`（新增） | 登录态门控：登录会员以服务端 `/me/favorites?type=job` 为 SSOT（登录后拉一次，toggle 走 `addFavorite`/`removeFavorite` 乐观更新、失败回滚 + 提示）；未登录 / 匿名沿用本机 localStorage，**新增收藏时提示「已收藏到本机，登录后可同步到账号」**（引导不强制）。并发去抖（pending Set）；服务端不可达时登录态保持空集（不把本机收藏误当本人资产） |
| `apps/kiosk/src/layouts/KioskRoot.tsx` | `KioskLayout` 内、`Outlet` 外挂 `FavoritesProvider`（处于 AuthProvider 树内，覆盖岗位列表/详情；屏保为顶级路由不受影响） |
| `apps/kiosk/src/pages/jobs/JobsPage.tsx` / `JobDetailPage.tsx` | 由 `useJobFavorites()`/`toggleFavorite(id)` 改为 `useFavorites()`：`ids`(Set) 驱动星标 + 「只看收藏」过滤与计数；`toggle({ id, title: job.title })` 写收藏（登录→后端带标题快照，匿名→本机） |
| `apps/kiosk/src/lib/useJobFavorites.ts`（删除） | 旧的纯 localStorage 模块 store hook，已被 `favorites/` 取代 |
| `services/api/scripts/verify-job-favorites-http.ts`（新增）+ `package.json` | `pnpm verify:job-favorites-http`：进程内起真实 AppModule，按 member-auth 同方案铸会员 JWT + Redis 会话，复刻 Kiosk 实际请求做 11 类 HTTP 端到端断言 |

**登录态门控行为矩阵：**

| 场景 | 收藏来源(SSOT) | 点星标 | 提示 |
|------|---------------|--------|------|
| 登录会员 | 服务端 `/me/favorites?type=job` | `addFavorite`/`removeFavorite`（乐观，失败回滚） | 失败时「收藏同步失败，请稍后重试」 |
| 未登录 / 匿名 | 本机 localStorage | `toggleLocalJobFavorite` | 新增时「已收藏到本机，登录后可同步到账号」 |

**合规：** 收藏只记浏览 / 收藏标记，绝不记投递结果 / 候选人数据（沿用 CLAUDE.md §10）；岗位详情按钮文案仍为「去来源平台投递 / 扫码投递」（未改）。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api verify:job-favorites-http` | ✅ ALL PASS（11 类，复刻 Kiosk 请求 + 真实 JWT/Redis/Guard）：登录入库 POST→201、`?type=job` 读回、幂等新增不重复、type 过滤不返 job_fair、DELETE 幂等 removed:true→false、取消后列表移除、匿名 401 `MEMBER_MISSING_TOKEN`、注入 `applicationStatus`/`candidateId` 等未知字段 → 400、非法 targetType → 400 |
| 匿名本机收藏运行期校验（shipped `localFavorites.ts` + localStorage 垫片，6 断言） | ✅ 空态 []、新增/持久化、多项、再次 toggle 取消、损坏 JSON 容错返回 [] |
| `pnpm --filter @ai-job-print/api verify:member-favorites-benefits`（回归） | ✅ ALL PASS |
| `pnpm --filter @ai-job-print/{api,shared}` typecheck · api lint | ✅ |
| `pnpm --filter @ai-job-print/kiosk` typecheck / lint / build | ✅（lint 仅既有 `KioskBusyContext` 2 warning；build 仅既有 chunk-size warning） |
| 合规禁词扫描（改动文件） | ✅ 0 新增命中（仅既有 JobDetailPage「去来源平台投递」合规文案，未改动） |
| `git diff --check` | ✅ |

**未解决 / 边界（下一小步）：**

- **浏览器交互手验未跑**（本环境无 Playwright JS 包）：建议在浏览器手验 —— 匿名：`/jobs` 点星标 → 填充 + 顶部提示「登录后可同步到账号」+ DevTools localStorage `kiosk:jobFavorites:v1` 含该 id；「只看收藏」过滤与计数正确；刷新后保留。登录态真实同步手验仍需 API + 短信验证码环境（自 C-1 起延后）；本轮以 HTTP e2e + 匿名本机运行期校验 + typecheck/lint/build 覆盖契约与编译。
- **招聘会 / 政策收藏入口未接服务端**：当前仅岗位（job）。`Favorite` 模型已支持 `job_fair`/`policy`，招聘会列表/详情收藏入口作为下一小步。
- **跨视图一致性**：FavoritesProvider 在登录切换时拉一次服务端收藏；若用户在 ProfilePage 取消某收藏后未重新登录直接返回岗位页，Provider 状态可能短暂滞后（岗位页内 toggle 即时一致）。正向链路（岗位页收藏 → ProfilePage 挂载时 `getMyFavorites` 拉到）已由 HTTP e2e 的入库→读取覆盖。
- **本机→账号迁移未做**：匿名收藏不自动推送到账号（登录后以服务端为准）；自动迁移涉及去重 / 标题快照，留后续按需评估。

---

## Phase B-1：Kiosk 打印前材料检查最小接线（2026-06-06，Codex）

**目标：** 在 Kiosk 打印上传后插入最小材料检查闭环：文件体检 `inspection` → 隐私片段检查 `pii_scan` → 用户逐项选择保留/遮挡 → 进入现有打印参数与确认流程。仅做前端接线，不改 `services/api` 后端骨架，不改变核心打印提交逻辑。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/services/api/materials.ts` | 新增 materials API service：`createMaterialTask` / `getMaterialTask` / `decidePiiFindings`；http 模式走真实 `/api/v1/materials/*` + ApiResponse envelope 解析；会员带 Authorization；匿名任务后续请求带 `accessToken` query + `x-material-task-token`；mock 模式仅返回无命中流程演示 |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | 新增当前打印材料检查会话态：只保存文件必要字段、材料任务 `id/status/accessToken`、隐私检查摘要和打印参数；不保存原文、`params/result`、`piiFindings[].snippet` |
| `apps/kiosk/src/pages/print/PrintUploadPage.tsx` | 上传成功后保留 `fileId`，写入当前会话，下一步跳转 `/print/material-check`，不再直接进 `/print/preview`；新文件/删除文件时清理旧会话 |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | 新增触控屏材料检查页：大按钮、loading/error/retry；使用 `useBusyLock(true)`；顺序创建 `inspection` 与 `pii_scan`；PII 仅展示类型、遮罩片段、建议；默认 pending 不允许继续；全部选择后提交 decisions；提示“仅用于本次打印前确认，不向第三方发送”；后端返回 `mock` / `skeleton` / `simulated` 时显示为流程演示 |
| `apps/kiosk/src/pages/print/PrintPreviewPage.tsx` | 透传 `materialCheck` state 到确认页，不改变打印参数逻辑；刷新/返回时从会话恢复文件、隐私检查摘要和打印参数 |
| `apps/kiosk/src/pages/print/PrintConfirmPage.tsx` | 展示简短“隐私检查摘要”（已检查/流程演示、遮挡 N 项、保留 N 项），不展示 PII 明细表；提交进入打印进度后清理当前材料检查会话 |
| `apps/kiosk/src/hooks/useScreensaverController.ts` | 待机进入宣传屏前清理已放弃的材料检查会话，避免公共终端残留 |
| `apps/kiosk/src/routes/index.tsx`、`apps/kiosk/src/services/api/index.ts` | 注册 `/print/material-check` 路由并导出 service |

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| 浏览器点检：`/print/material-check` 直达空态 | ✅ 显示“未找到文件信息 / 重新上传文件”；无招聘闭环禁词 |
| 浏览器点检：临时 `API:3011(FILE_STORAGE_DRIVER=local)` + `Kiosk:5176` | ✅ 上传测试图片 → 材料检查完成 → 显示“流程演示 / 不展示完整原文 / 不向第三方发送” → 继续进入 `/print/preview`；无招聘闭环禁词 |

**遗留：** 后端 Phase A-2 当前仍是骨架/模拟处理，`pii_scan` 仅基于文件名或后端允许的样例参数产生少量手机号/邮箱命中；真实 OCR、文档页数识别、A4 归一化、实际遮挡产物仍属 Phase B-2。

**Codex 审查纠偏：** 初版前端在 http 模式下只把 `mock` 标为流程演示，可能把后端当前 `skeleton` / `simulated` 结果误展示成完整检查。已修正为三类模式均展示“流程演示”，确认页同步使用诚实文案。

**2026-06-07 补充收口：**

- VS Code Claude 只读复核确认 Kiosk session 恢复主链路已达成：上传后写会话、`material-check` 无 route state 可恢复、刷新后用已存 `taskId/accessToken` 查询既有任务、`preview/confirm` 可恢复摘要和打印参数。
- Codex 按复核风险完成隐私收紧：`sessionStorage` 不再持久化完整 `DocumentProcessTaskView`，只保存任务元数据；`piiFindings[].snippet` 仅在当前页面内存展示，刷新后从后端重新查询。
- 公共终端残留收口：提交打印进入 `/print/progress` 前清理当前会话；无操作进入待机宣传屏前也清理已放弃会话。
- 最新静态验证：`pnpm --filter @ai-job-print/kiosk typecheck` ✅；`pnpm --filter @ai-job-print/kiosk lint` ✅（仅既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条）；`pnpm --filter @ai-job-print/kiosk build` ✅（仅既有 chunk-size warning）；`pnpm --filter @ai-job-print/api verify:materials-processing` ✅；`git diff --check` ✅。
- 最新 HTTP 验证：本地 API 3010 只读可达 `/api/v1/jobs` → 200；`POST /api/v1/materials/tasks` 使用不存在 `sourceFileId` 返回受控 `SOURCE_FILE_NOT_FOUND`。另用 `FILE_STORAGE_DRIVER=local PORT=3012` 临时启动 API，上传仓库测试图片 `apps/kiosk/public/assets/ai-advisor.png` → `POST /files/kiosk-upload` 成功；基于返回 `fileId` 创建 `inspection` / `pii_scan` 成功；匿名任务无 token 返回 `MATERIAL_TASK_TOKEN_REQUIRED`；携带 `accessToken` 可查询；`pii-findings/decisions` 可更新 `redact/keep`。
- 最新浏览器手验：`FILE_STORAGE_DRIVER=local PORT=3010` API + 既有 Kiosk dev server `5173`；Chrome 打开 `/print/upload`，选择 `/private/tmp/ai-advisor-kiosk-test.png` 上传成功；进入 `/print/material-check` 自动完成 `inspection` / `pii_scan` 并显示“流程演示 / 不向第三方发送 / 不展示完整原文”；刷新材料检查页后仍恢复文件和检查结果；进入 `/print/preview` 后显示材料检查摘要，刷新后仍恢复；进入 `/print/confirm` 后显示隐私检查摘要且不展示 PII 明细；点击“按以上设置打印”进入 `/print/progress` 并获得真实 `taskId`；提交后直达 `/print/confirm` 显示“未找到文件信息 / 重新上传文件”，确认当前材料会话已清理。
- 注意：当前默认本地 API `.env` 仍可能为 `StorageService driver=cos`；完整浏览器/一体机手验下一步需用 local storage 或明确测试 COS 环境执行，避免把本地验证文件写入生产 COS。

## Phase B-2：材料体检基础页数识别最小增量（2026-06-07，Codex）

**目标：** 在不引入完整 OCR / PDF 渲染链的前提下，让 `inspection` 返回可用于打印设置的基础页数信息，先解决上传图片在 Kiosk 预览/确认页显示“未知页数”的问题。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/materials/materials.service.ts` | `inspection` 接入 `StorageService`：图片 MIME（png/jpeg/webp）直接返回 `pageCount=1`；PDF 走轻量字节扫描统计 `/Type /Page`；无法读取或暂不支持的 MIME 返回明确 `warnings`；新增 `canPrint` 与 `messages` 供前端展示可解释体检摘要，可读图片/PDF 继续放行，不可读源文件引导重传 |
| `services/api/src/materials/materials.module.ts` | 显式引入 `StorageModule`，确保 materials 模块独立装配时也能解析 `StorageService` |
| `services/api/scripts/verify-materials-processing.ts` | 构造 `MaterialsService` 时注入 `StorageService`；新增匿名图片文件体检断言，确认 `pageCount=1` / `pageCountSource=image_single_page` / `canPrint=true`，并验证返回用户可读状态消息；新增本地对象存储 PDF 字节链路断言，确认轻量页数扫描返回 `pageCount=2`；新增不可读 PDF 负向断言，确认 `SOURCE_FILE_BYTES_UNAVAILABLE` 会标记 `canPrint=false` |
| `apps/kiosk/src/services/api/materials.ts` | mock 模式下的 `inspection` 也返回安全的 `checks` 摘要，便于离线/演示环境展示文件体检摘要 |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | 读取 `inspection.result.checks.pageCount`，仅接受 1–2000 的整数，并写回当前 `printMaterialSession.file.pages`；同一 `fileId` 下让 session 中的新页数覆盖 route state 旧值；材料检查页展示文件体检摘要（页数、可继续状态、安全提示），`canPrint=false` 时禁用继续并引导重新上传；轮询窗口从约 4 秒放宽到约 30 秒；后续 `/print/preview`、`/print/confirm` 均可显示基础页数 |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | sessionStorage 保存文件名时遮挡手机号、邮箱、身份证样式片段，降低公共终端会话态残留文件名 PII 风险 |

**边界：** 本轮仍不是完整材料处理引擎；真实 OCR、清晰度检查、A4 归一化、PII 实际遮挡文件、材料包合并仍属后续 B-2 子任务。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ 通过，新增图片体检 `pageCount=1` / `canPrint=true` / `messages` 断言、本地 PDF 字节页数断言、不可读 PDF `canPrint=false` 断言 |
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ 通过；保留既有 chunk-size warning |
| `git diff --check` | ✅ 通过 |

**2026-06-07 补充：A4 规范化评估最小契约（Codex）**

**目标：** 在不接入真实 PDF 渲染 / 图片转 PDF / 文件合并链路的前提下，先把 `normalize_a4` 任务从 skeleton 收敛为诚实可验证的 A4 评估契约，并让 Kiosk 在材料检查页展示对应摘要。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/materials/materials.service.ts` | `normalize_a4` 复用现有图片/PDF 页数识别能力：图片和页数明确识别的 PDF 返回 `targetPaperSize=A4`、`canNormalize=true`、`normalizedFileId=null`、页数来源与用户提示；非 A4 参数受控拒绝；不可读、不支持 MIME、PDF 页数未识别均返回 `canNormalize=false` 与明确 warnings/messages，不伪造产物文件 |
| `services/api/scripts/verify-materials-processing.ts` | 新增图片 `normalize_a4` 成功、本地对象存储 PDF `normalize_a4` 成功、不可读源文件 `normalize_a4` 失败、PDF 字节可读但页数未识别失败、非 A4 参数拒绝等断言 |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | 当前打印材料检查 session 新增 `normalizeTask` 元数据字段与 `materialCheck.normalizeTaskId`，仍只持久化任务必要字段，不保存完整 result / PII snippet / 原文 |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | 材料检查流程调整为 `inspection → normalize_a4 → pii_scan`；刷新/返回后优先查询已存在的 `normalizeTask`，避免重复创建；页面新增“A4 规范化摘要”，提示当前版本仍使用原文件打印，`canNormalize=false` 或未知状态仅提示版式风险/信息不完整，不额外阻断已可打印文件 |
| `apps/kiosk/src/services/api/materials.ts` | mock 模式同步返回 `normalize_a4` 的 A4 摘要，离线演示不再只显示泛化 skeleton |

**边界：** 本轮只做 A4 评估契约和 UI 反馈；真实 A4 输出文件、图片转 PDF、PDF 重新排版、PII 遮挡后产物、多文件材料包合并仍未实现。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ 通过，新增 `normalize_a4` 图片/PDF/不可读源文件断言 |
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ 通过；保留既有 chunk-size warning |

**2026-06-07 补充：PII 遮挡产物评估最小契约（Codex）**

**目标：** 在不实现真实 PDF/DOCX 遮挡渲染的前提下，把 `pii_redact` 从空骨架推进为可验证的“遮挡产物评估”任务，并修正 Kiosk 文案，避免用户误以为已经生成遮挡后文件。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/materials/materials.service.ts` | `pii_redact` 读取 `decisionTaskId` 对应的 `pii_scan` 决策任务，并复用原任务访问校验：会员必须本人，匿名必须携带原 `pii_scan` accessToken；只统计 `keep/redact/pending` 数量，不读取或输出 snippet；返回 `canRedact`、`redactedFileId=null`、`resultFileCreated=false`、counts、warnings/messages；决策任务缺失、跨文件、仍有 pending 时返回不可生成评估，不伪造遮挡后文件 |
| `services/api/scripts/verify-materials-processing.ts` | 新增 PII 决策全部完成后 `pii_redact` 摘要断言、仍有 pending finding 时 `canRedact=false` / `PII_DECISIONS_PENDING` 断言，以及匿名 `pii_redact` 无 token / 错 token 拒绝、正确原任务 token 才可读取摘要的回归断言 |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | 用户保存保留/遮挡选择后携带原 `pii_scan` accessToken 创建 `pii_redact` 评估任务，并把 `piiRedactTask` 元数据与安全摘要写入当前打印材料 session；遮挡评估每次基于最新选择新建，避免复用旧决策结果；若 `canRedact=false` 会停留在 review 页提示，不继续进入预览 |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | `MaterialCheckSummary` 增加 `piiRedactTaskId` 与 `redaction` 安全摘要；session 仍只保存任务元数据和 counts/message，不保存完整 result 或 PII snippet |
| `apps/kiosk/src/pages/print/PrintPreviewPage.tsx`、`PrintConfirmPage.tsx` | 当用户选择遮挡但未生成遮挡后文件时，用 amber 提示“当前版本尚未生成遮挡后文件，打印仍使用原文件；请确认是否继续”，不再暗示已真实遮挡 |
| `apps/kiosk/src/services/api/materials.ts` | mock `pii_redact` 返回同样的“未生成新文件”摘要，保持演示模式文案诚实 |

**边界：** 本轮只完成遮挡评估契约和 Kiosk 诚实反馈；真实遮挡 PDF/DOCX/图片产物、遮挡后文件预览、遮挡后文件进入打印任务仍未实现。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ 通过，新增 `pii_redact` settled/pending 两类断言 |
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ 通过；保留既有 chunk-size warning |
| `git diff --check` | ✅ 通过 |
| Safari mock 浏览器手验：`VITE_API_MODE=mock` Kiosk 5173 | ✅ `/print/upload` 上传本地 PDF → `/print/material-check` 完成 `inspection → normalize_a4 → pii_scan → pii_redact` → 展示“文件体检摘要 / A4 规范化摘要 / 当前版本仍使用原文件打印” → `/print/preview` 显示“材料检查流程演示完成 · 遮挡 0 项”；mock 环境打印机离线，进入确认按钮按预期禁用 |

**2026-06-07 补充：图片清晰度预检最小增量（Codex）**

**目标：** 不引入 OCR / 图像处理重依赖，先让图片类材料体检读取真实对象字节中的文件头，返回像素尺寸与按 A4 打印的 DPI 估算，低于建议阈值时给出可解释 warning。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/materials/materials.service.ts` | `inspection` 对 png/jpeg 图片尝试读取对象存储字节并解析图片宽高；按 A4 纵向/横向最佳适配估算 DPI，低于 150 DPI 返回 `IMAGE_RESOLUTION_LOW_FOR_A4`、`imageQuality.widthPx/heightPx/estimatedDpiForA4/minRecommendedDpi/quality` 和用户提示；图片字节不可读或尺寸不可识别时只给 warning，不阻断继续打印 |
| `services/api/scripts/verify-materials-processing.ts` | 新增本地对象存储低分辨率 PNG 断言，确认 `pageCount=1`、`imageQuality=800×600 / low`、`IMAGE_RESOLUTION_LOW_FOR_A4` 生效；继续覆盖匿名 token、A4 评估和 PII 遮挡评估回归 |

**边界：** 本轮只做图片头部维度解析和 A4 DPI 估算；不做 OCR、图片内容质量模型、PDF 页面渲染清晰度、自动增强或重采样。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ 通过，新增图片清晰度预检断言 |

**2026-06-07 补充：PII 扫描规则增强（Codex）**

**目标：** 在真实 OCR 接入前，先扩展当前 `pii_scan` 可处理的文本样本/文件名规则，覆盖简历和打印材料中更常见的高风险隐私类型。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/materials/materials.service.ts` | `pii_scan` 模拟规则从手机号/邮箱扩展到身份证号（`id_card`）和常见中文地址片段（`address`）；snippet 继续受 32 字符上限约束，原始 `textSample` 仍不落库 |
| `services/api/scripts/verify-materials-processing.ts` | 验证样本加入身份证号和地址，断言 `phone/email/id_card/address` 四类 finding 均可命中，并继续覆盖“完整 textSample 不进入 paramsJson” |

**边界：** 本轮仍不是 OCR；只处理任务参数中传入的文本样本和文件名。后续真实 OCR / 文档解析 provider 接入后，应把 OCR 结果以短文本片段进入扫描规则，仍不得持久化完整原文。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api lint` | ✅ 通过 |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ 通过，新增 `phone/email/id_card/address` 四类 PII finding 断言 |

**2026-06-07 补充：打印设置页预览与说明区 UI/UX 修复（Codex）**

**目标：** 参考秒哒打印服务页，把 Kiosk `/print/preview` 从单纯参数页补成更完整的打印确认前页面，并解释“左侧为什么看不到简历预览”的真实原因。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | `PrintFileState` 增加 `mimeType`，当前会话可记录上传文件类型，便于预览页判断 PDF / 图片 / 暂不支持类型 |
| `apps/kiosk/src/pages/print/PrintUploadPage.tsx` | 上传成功后把后端返回的 `mimeType` 写入打印文件状态 |
| `apps/kiosk/src/pages/print/PrintPreviewPage.tsx` | 左侧文件区改为真实预览面板：PDF 用 iframe、图片用 img；无可嵌入 URL、mock 演示、签名链接过期或 Word/其他类型时显示原因说明；新增“费用明细”“价格说明”“打印须知”区块，参考秒哒结构但保留本项目现有黑白/彩色计费和合规提示 |

**边界：** 通用打印 `print_doc` 当前后端只支持 PDF/JPG/PNG；Word 页内预览与转换服务未接入，因此页面明确写“后续接入”，不把 Word 伪装成已可预览。

**验证：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ 通过 |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ 通过；保留既有 chunk-size warning |
| `git diff --check` | ✅ 通过 |
| Safari 本地页手验：`/print/preview` | ✅ 左侧显示无法预览原因与使用说明；页面下方出现费用明细、价格说明、打印须知；mock 打印机离线时继续禁用打印按钮 |

**2026-06-07 二次修复：打印设置页内容不全 / 说明点击不可见（Codex）**

- 根因：`/print/preview` 右侧参数区此前存在内嵌滚动，同时价格说明是折叠交互；在 Kiosk 根布局已有 `main` 滚动容器和底部导航的情况下，说明内容容易出现在不可见滚动层里，用户点击后误以为没有展开。
- 修复：移除右侧内嵌滚动，改为单一 `main` 页面滚动；“价格说明”“打印须知”不再折叠，默认直接展示完整内容；底部“返回 / 确认参数”操作区恢复为页面正常内容，避免 fixed/sticky 按钮覆盖打印参数或说明文字。
- 验证：`pnpm --filter @ai-job-print/kiosk typecheck` ✅；`pnpm --filter @ai-job-print/kiosk lint` ✅（仅既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条）；`pnpm --filter @ai-job-print/kiosk build` ✅（仅既有 chunk-size warning）；`git diff --check` ✅。
- Playwright 本地手验：`VITE_API_MODE=mock` Kiosk 5176，注入测试打印会话后访问 `/print/preview`；1220×768 视口下可滚动到“价格说明”“打印须知”和底部按钮；说明文字全部命中；底部操作区不再 fixed/sticky 覆盖内容。

**2026-06-07 真实 API 链路验证：上传到打印完成页（Codex）**

- 环境：API 3010 使用 `FILE_STORAGE_DRIVER=local` 强制本地文件存储；Kiosk 5177 使用 `VITE_API_MODE=http`、`VITE_API_BASE_URL=/api/v1`、`VITE_API_PROXY_TARGET=http://localhost:3010`、`VITE_TERMINAL_ID=KSK-001`；测试文件为仓库内 `apps/kiosk/public/assets/ai-advisor.png`。
- 浏览器真实流程：Playwright 操作 `/print/upload` 文件选择 → `POST /files/kiosk-upload` 成功 → `/print/material-check` 自动完成 `inspection → normalize_a4 → pii_scan → pii_redact` → `/print/preview` 左侧显示图片预览，材料检查摘要显示“遮挡 0 项” → `/print/confirm` → 点击“按以上设置打印”创建真实打印任务 → `/print/progress`。
- Agent 状态链路：通过本地 dev.db 的 `KSK-001` 测试终端 token 调用 Terminal Agent API，claim 待打印任务并按合法状态流 `claimed → printing → completed` 回写；Kiosk 进度页轮询后跳转 `/print/done`，成功页显示“打印完成”。
- 验证结果：真实用户打印任务 `ptask_kiosk_63b38641b41fc5aa` 最终状态 `completed`；浏览器 console error 0；截图保存在 `/private/tmp/real-flow-upload.png`、`/private/tmp/real-flow-material-check.png`、`/private/tmp/real-flow-preview.png`、`/private/tmp/real-flow-confirm.png`、`/private/tmp/real-flow-done.png`。
- 边界：本次验证覆盖真实 API、真实文件上传、材料任务、打印任务创建、Terminal Agent claim/status API 与 Kiosk 进度轮询；未连接 Windows Terminal Agent 和奔图真机，因此不等同于真实出纸验证。真机出纸仍按 Phase 8 待办执行。

---

## 阶段收口基线核查（2026-06-06，Claude）

**结论：当前 `main`（`6ac1ac4`）已是「可开新功能」的干净基线。** 本次为只读核查（未改业务代码），结果如下：

| 维度 | 结果 |
|------|------|
| Git 基线 | `local main == origin/main == 6ac1ac4`；`git branch --merged main` 仅 `main`；origin/main 无已合并旧 head 残留。当前工作树停在活跃 WIP 分支 `feature/screensaver-external-video-v2`（+1 additive commit `99c3711`，对应下一步候选 B），工作树干净、与远端同步 |
| 服务可运行 | API 启动正常（`driver=cos` + 真实 COS 凭证下 `StorageService` 构造通过、DB 连接 `file:./prisma/dev.db`、全路由 mapped）；Kiosk(5173)/Admin(5174) dev server 正常返回应用壳；Redis(6379) 在线。注：本地 DB 为 SQLite dev.db，无需 Postgres(5432) |
| 接口冒烟 | `GET /api/v1/jobs`、`/job-fairs` → 200 真实数据（含 `sourceOrgId/externalId/sourceName/sourceUrl/syncTime` 第三方来源字段）；`GET /terminals/:id/screensaver` → 200（未配置终端返回 `enabled:false`，符合预期） |
| 核心冒烟 | Admin 登录 `admin/admin` → 201 + JWT（登录路由有 `@Throttle 5/60s` 防爆破）；带令牌访问 `admin/ad-assets`、`admin/ad-playlists`、`admin/screensaver/terminals`、`admin/terminals`、`admin/printers` 全部 200 |
| 存储配置一致 | 根 `.env.example` / `services/api/.env.example` / `docs/api/cos-object-storage.md` 三处 `FILE_STORAGE_DRIVER` + `TENCENT_COS_*` 变量名完全一致；bucket/region 填值处均为 `yitiji-prod-private-1257025684` / `ap-guangzhou`；local fallback 明确；`.env` 未入库、追踪文件无真实密钥 |
| 合规边界 | 代码内无「一键投递 / 平台投递 / 企业收简历 / 候选人管理 / 面试邀约 / Offer 管理」等违规功能（仅出现在禁词清单 / 禁用枚举 / 注释 / 合规横幅）；岗位/招聘会仍为第三方来源入口，按钮用「去来源平台投递 / 扫码投递」+ 外部 `sourceUrl` |

**待人工手验（自动化已覆盖字节链路，浏览器点检需运行栈）：** Admin 浏览器上传宣传屏图/视频、Kiosk `/screensaver` 真机播放。下一步候选见 [next-tasks.md](./next-tasks.md) §下一步候选（A/B/C）。

> ⚠️ 上线前仍需：生产显式 `FILE_STORAGE_DRIVER=cos` + 4 项 COS 变量；**轮换 CAM 子用户密钥**（配置时曾在终端回显）；PostgreSQL 迁移（dev.db 现有 drift）。详见 next-tasks.md 生产部署清单。

---

## 宣传屏支持外部视频直链素材（2026-06-06，Claude）

**背景：** 待机宣传屏一期素材库只支持本地上传图/视频。新增小功能：允许管理员登记「外部视频直链」（如 CDN / 官方公开 mp4），Kiosk 直连播放，避免大视频反复上传占用存储。属线下一体机运营广告位，不触及招聘闭环、TRTC / AI 助手、文件上传敏感流程。

**实现路径：** 早先分支 `feature/screensaver-external-video`（commit `584596f`）已做过一版完整实现，但基于旧 main（COS 合入前）+ 旧存储 API（`this.storage.delete/read`），无法直接合入当前 main。本次**以当前 main 为准**，参考 `584596f` 的功能意图与实现，仅移植「外部视频 URL 素材」能力，并将存储相关代码适配当前 `StorageService`（`putObject/getObject/deleteObject`），保留 Codex 未提交的宣传屏预览修复（CORP 跨 origin + Admin 预览弹窗）。分支 `feature/screensaver-external-video-v2`（基于当前 main `6ac1ac4` + Codex 工作树改动）。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/prisma/schema.prisma` + 迁移 `20260606200000_add_ad_asset_external_url` | `AdAsset` 增加可空 `externalUrl`；`source` 取值新增 `'external_url'`；外链素材无物理文件，`storageKey` 用合成键 `external:<id>` 满足 NOT NULL + UNIQUE（`externalUrl` 列已在本地 dev.db 存在，迁移为非破坏性 additive） |
| `services/api/src/content/external-video-url.ts`（新增） | 外链 URL 安全校验:仅 https；阻断 localhost / 回环 / `10.* / 172.16-31.* / 192.168.* / 169.254.*` / CGNAT / IPv6 私网 / 单标签内网短名 / `.local/.internal` 等；仅放行 `.mp4/.webm` 直链;可选 `ALLOWED_EXTERNAL_VIDEO_HOSTS` 白名单;拒绝内嵌账号密码；不做服务端探测（无 SSRF） |
| `services/api/src/content/content.service.ts` | 新增 `createExternalAsset`;`getKioskPlaylist` 对外链素材直接返回 `externalUrl`(不签名)并剔除缺链脏数据;`deleteAsset` 对外链跳过 `deleteObject`;`readAssetContent` 对外链返回 404;`toAssetView` 增 `externalUrl` + 预览回退;新增 `normalizeExternalDuration`——外链 `durationSec` 上限放宽到 **1800s**(默认 15s),**仅对 `external_url` 生效，不改变上传视频的 `normalizeDuration`/`AD_ASSET_MAX_VIDEO_SEC` 限制**。**所有存储调用沿用当前 `StorageService`（`putObject/getObject/deleteObject`），未恢复旧的 `delete/read`** |
| `services/api/src/content/dto/create-external-video.dto.ts`（新增）+ `content.controller.ts` | `POST /admin/ad-assets/external-video`(admin + 审计 `ad_asset.create_external`)。Codex 的 CORP 跨 origin 头保持不动 |
| `services/api/src/content/content.types.ts` + `packages/shared/src/types/screensaver.ts` | `AdAssetSource` 加 `external_url`;`AdAssetView` 加 `externalUrl: string \| null`(两处契约同步) |
| `apps/admin/src/routes/screensaver/index.tsx` + `services/api/screensaver.ts` | 素材库新增「添加外部视频链接」表单 + `createExternalVideo` http/mock 双 adapter;素材卡显示「外链」标签与链接；**预览弹窗(Codex 版)扩展为外链感知**：外链用 `<video controls src={externalUrl}>` 预览，`onError` 提示「外部视频源不允许当前浏览器预览，请在终端或原始链接验证」 |
| `apps/kiosk/src/services/screensaverCache.ts` | 绝对 http(s) URL 判定为外链:跳过预缓存/Cache Storage,`<video>` 直连拉流(不受 CORS 限制);上传素材仍走相对签名路径 + 缓存 |
| `services/api/.env.example` | 新增 `ALLOWED_EXTERNAL_VIDEO_HOSTS` 说明(留空=放行通过私网检查的公网直链) |

**合规边界：** 仅支持 HTTPS mp4/webm 直链；明确不支持 iframe、B站 / 抖音 / YouTube 页面链接；只保存视频 URL，不保存任何第三方账号 / cookie / token；链接过期由管理员重新配置。沿用「待机宣传屏属运营广告位」定位，不改动招聘 / 投递 / 候选人相关能力。

**验证：**

| 检查 | 结果 |
|------|------|
| api / admin / kiosk `typecheck` | ✅ 全部通过 |
| api / admin / kiosk `lint` | ✅（kiosk 2 条 warning 为既有 `KioskBusyContext.tsx` fast-refresh，无新增；未触碰该文件） |
| `pnpm verify:external-video`（URL 校验纯函数单测） | ✅ 合法直链通过；非 https / 私网内网 / iframe 站点 / 无扩展名 / .mov / 内嵌账号密码 / 超长 全部拒绝;白名单生效与解除均符合预期 |
| `pnpm verify:external-video:e2e`（service 层打 dev.db，自清理） | ✅ 外链落库 `source=external_url`;私网 host → HTTP 400;`getKioskPlaylist` 对外链返回裸 `externalUrl`(非签名路径);删除软删 `driver=local` 无 putObject/deleteObject 触发 |

**外链时长上限（按需求调整）：** 外链 `durationSec` 上限放宽到 **1800s**（默认 15s，最小 3s）——外链不占 COS 存储、不走上传校验，`durationSec` 在 Kiosk 仅作兜底切换时长，避免较长外部视频被提前切走。**仅对 `source=external_url` 生效**，上传视频仍按 `AD_ASSET_MAX_VIDEO_SEC`（默认 120s）/ 大小上限不变。

**未做（保持小 PR 边界）：** 未做服务端探测对端真实 Content-Type / 可达性(本期由 Kiosk 播放 `onError` 兜底跳过);外链素材不进 Cache Storage,断网时无法离线播放(预期行为)。

---

## Admin 宣传屏素材预览修复（2026-06-06，Codex）

**背景：** Admin「宣传屏」上传图片后素材卡片显示破图，且缺少点击查看素材效果的入口。

**原因：** 后端返回的 `previewUrl` 是 `/api/v1/ad-assets/:id/content?...` 相对签名地址。Admin dev server 运行在 `localhost:5174`，API 运行在 `localhost:3010`，前端直接把相对地址放进 `<img>` 会请求到错误 origin；修正后又被 Helmet 默认 `Cross-Origin-Resource-Policy: same-origin` 拦截跨端口图片嵌入。

**改动：**

- `apps/admin/src/routes/screensaver/index.tsx`：将素材 `previewUrl` 按 `API_BASE_URL` 转成可访问的绝对地址；素材卡片媒体区域改为可点击按钮；新增图片/视频预览弹窗。
- `services/api/src/content/content.controller.ts`：仅在签名素材内容接口 `/api/v1/ad-assets/:id/content` 覆盖 `Cross-Origin-Resource-Policy: cross-origin`，允许 Admin/Kiosk dev server 通过签名 URL 嵌入图片/视频。

**验证：**

| 检查 | 结果 |
|---|---|
| `pnpm --filter ./apps/admin typecheck` / `lint` | ✅ |
| `pnpm --filter ./services/api typecheck` / `lint` | ✅ |
| Admin `/screensaver` 浏览器验证 | ✅ 缩略图加载到真实尺寸；点击素材打开预览弹窗；图片在弹窗内正常显示 |
| API 重启状态 | ✅ `StorageService driver=cos bucket=yitiji-prod-private-1257025684 region=ap-guangzhou cosAvailable=true` |

---

## 腾讯云 COS 对象存储接入（2026-06-06，Claude）

**背景：** 把云端文件存储从本地 FS 升级为可切换腾讯云 COS（私有桶 `yitiji-prod-private-1257025684` / `ap-guangzhou`），用于上传、下载、预览、持久化。统一私有桶（不按端拆桶），靠 objectKey 前缀 + `FileObject` 记录分类授权。分支 `feature/cos-storage-integration`（基于 main `f807b75`）。详见 [docs/api/cos-object-storage.md](../api/cos-object-storage.md)。

**核心设计：** COS 作为「可插拔存储后端」接到新增的 `StorageService` 抽象后面，本地 FS 为 dev 默认后端，`FILE_STORAGE_DRIVER=local|cos` 切换。切 COS **不改任何业务代码**——现有 Kiosk 上传 / 打印 / Admin 文件管理 / Partner 上传 / 宣传屏素材全部透明落 COS。COS 签名为**手写预签名 URL**（严格复刻官方算法，零新依赖，匹配本仓 HMAC/AES-GCM/MD5 手写惯例,独立重算单测交叉校验）。

**改动范围：**

| 层 | 改动 | 文件 |
|----|------|------|
| 存储抽象（新增） | `ObjectStorageBackend` 接口 + `LocalStorageBackend` / `CosStorageBackend` + `StorageService`（按 driver 选默认后端、按文件 bucket 路由读删、TTL clamp ≤1800）+ `@Global StorageModule` + objectKey 生成 + COS 签名 | `src/storage/{storage.interface,local-storage.backend,cos-storage.backend,storage.service,storage.module,object-key,cos-signing}.ts` |
| Prisma | `FileObject` 扩为统一文件资产表:新增 `bucket/region/ownerType/ownerId/visibility/status/createdBy` + 索引;migration `20260606190000_add_file_asset_cos_fields`（additive,`db execute` 非破坏性,回填既有行 bucket=local-fs/status=active）| `prisma/schema.prisma` + `prisma/migrations/` |
| Files 服务 | `FilesService` 改走 `StorageService`(不再直接 new LocalFileStorage);新增 `createUploadIntent` / `completeUpload` / `writeRawUpload` / `getAccessUrl`(下载预览) / `ownerDelete`;`canAccessFile`(user/partner/member 隔离) + `deriveOwner`;`upload` 落 owner/bucket/objectKey 全字段 | `src/files/files.service.ts` |
| Files 校验(新增) | 纯函数 `validateUpload`:per-purpose MIME 白名单 + 扩展名一致 + 大小上限(proxy 15MB / intent 按 purpose,视频 500MB);`DEFAULT_SENSITIVE_BY_PURPOSE` 全量 | `src/files/file-validation.ts` |
| Files 控制器 | 新增 5 端点 `POST /files/upload-intent`、`PUT /files/:id/raw`、`POST /files/:id/complete`、`GET /files/:id/download-url`、`GET /files/:id/preview-url`;`DELETE /files/:id` 放宽到 owner/会员本人/admin;下载预览同时支持 User JWT 与 member token,管理员访问用户文件写 `file.admin_access` 审计;`/content` 代理改走 StorageService(兼容 COS) | `src/files/files.controller.ts` + `dto/create-upload-intent.dto.ts` + `dto/upload-options.dto.ts`(扩 purpose) |
| 签名 | `signing.ts` 增 `signRawUploadUrl`/`verifyRawUploadSignature`(本地直传命名空间隔离) | `src/files/signing.ts` |
| 宣传屏 | `ContentService` 物理读写改走 `StorageService`(objectKey `screensaver/materials/`),素材随之落 COS | `src/content/content.service.ts` |
| 契约同步 | `packages/shared/src/types/file.ts`(SSOT)+ `src/files/file.types.ts` 同步扩 FilePurpose(+7) / FileMetadata 新字段 / UploadIntent·CompleteUpload·FileAccessUrl 类型 | 两处 |
| 前端 | kiosk `filesMockAdapter` TTL 表补全 13 purpose;admin 文件页 `AdminFilePurpose`/`PURPOSE_META` 扩 7 项 + 未知 purpose 兜底防崩 | `apps/kiosk/...filesMockAdapter.ts`、`apps/admin/.../files/{index.tsx,services/api/files.ts}` |
| 配置 | `.env.example` 新增 `FILE_STORAGE_DRIVER` + `TENCENT_COS_*`(占位,无真实密钥) | `services/api/.env.example` |

**合规边界：** SecretId/SecretKey 仅服务端,前端只拿短期签名 URL(≤30min,无永久公开链接);会员只能访问本人文件,合作机构不能访问用户简历,管理员访问用户文件写审计;未新增任何投递/收简历/候选人能力。

**验证：**

| 检查 | 结果 |
|------|------|
| api typecheck / lint / build | ✅ |
| shared / kiosk / admin typecheck / lint / build | ✅(kiosk 2 条既有 KioskBusyContext fast-refresh warning,非本次) |
| `verify:cos`(objectKey / COS 签名独立重算 / 校验,纯函数) | ✅ 37 checks |
| `verify:cos:files`(本地后端打 dev.db E2E,自清理) | ✅ 30 checks:上传落 owner/bucket/objectKey、round-trip、跨用户/跨机构/机构访问用户文件全拒、管理员访问→needsAdminAudit、intent→raw→complete、软删物理回收 |
| `verify:cos:live`(真实 COS) | ⏳ 无凭证 SKIPPED(用户在 .env 配 TENCENT_COS_* 后可一键跑 put→head→get→签名下载→delete) |
| 启动 + DI + 路由 | ✅ `StorageService driver=local cosAvailable=false`、12 条 /files 路由(含 5 新端点)全 mapped |

**未做 / 后续：** 真实 COS 端到端需用户凭证(`verify:cos:live`);打印 / 宣传屏内容当前仍走 `/content` 代理签名 URL(短 TTL,合规),未来可改 Kiosk/Agent 直连 COS 预签名 URL 省一跳;`AdAsset` 未加 bucket 列(单 driver 部署足够,混合环境历史素材按默认后端读)。

---

## QA P0 真机联调修复（2026-06-06，Codex）

**背景：** 基于 `/tmp/qa-report-final.md` 复核结论，修复真机联调前应处理的 3 个 P0：Kiosk 用业务码 `KSK-001` 拉取打印机状态 404、Admin 打印机页纯本地 mock、seed 缺少 `KSK-001` 终端。同时顺手修复同类 DTO 校验文案空列表问题。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `services/api/src/terminals/terminals.service.ts`、`admin-printers.controller.ts`、`terminals.module.ts` | `GET /terminals/:terminalId/printer-status` 支持按内部 `id` 或业务 `terminalCode` 查询；新增 admin-only `GET /admin/printers`，基于终端最新 heartbeat 聚合打印机状态，不编造型号/SN/耗材/纸盒余量 |
| `services/api/src/content/content.service.ts` | 待机屏终端配置对 Admin/Kiosk 暴露和保存统一使用 `terminalCode`；读取时兼容历史内部 `id` 配置 |
| `services/api/prisma/seed.ts` | seed 一条 `KSK-001` 终端和一条 `printerStatus='ok'` heartbeat，供本地/真机联调默认业务码链路使用；不硬编码任何打印机型号 |
| `apps/admin/src/services/api/{types,adminHttpAdapter,adminMockAdapter,devices,index}.ts` | 新增 Admin 打印机契约与 http/mock 双 adapter，http 调 `GET /admin/printers` |
| `apps/admin/src/routes/printers/index.tsx` | 移除 `MOCK_PRINTERS` 和硬编码 Pantum/SN/碳粉/纸张数据，改为加载真实接口；未上报字段明确显示「未上报」；保留 loading/error/empty/refresh/search/filter/pagination |
| `services/api/src/files/dto/{kiosk-upload-options,upload-options}.dto.ts`、`services/api/src/content/dto/{save-playlist,update-ad-asset}.dto.ts` | `@IsEnum([...])` 改 `@IsIn([...])`，修复非法值报错可选值列表为空的问题 |

**验证：**

| 检查 | 结果 |
|------|------|
| api `typecheck` / `lint` / `build` | ✅ |
| admin `typecheck` / `lint` / `build` | ✅ |
| 旧 mock/禁用写法扫描 | ✅ `MOCK_PRINTERS`、Admin 硬编码 Pantum 型号、`IsEnum([...])` 均 0 命中 |
| `pnpm --filter @ai-job-print/api db:seed` | ✅ 已写入/刷新 `KSK-001` 终端与 heartbeat（`dev.db` 为 ignored 文件，未产生 Git 跟踪改动） |
| 临时 API:3011 HTTP 复验 | ✅ `GET /terminals/KSK-001/printer-status` → 200 `{ printerStatus:"ok", isOnline:true }`；`GET /terminals/KSK-001/screensaver` → 200 disabled 默认配置；admin 登录后 `GET /admin/printers` → 200，列表含 `KSK-001` 聚合记录 |

**注意：** HTTP 复验使用临时 `PORT=3011` API 进程，复验后已停止。用户此前后台服务仍在运行（api 3010、admin 5174 等），本轮代码变更需要重启后端与 Admin dev server 后才会反映到当前页面/端点。

---

## AI求职材料中心开发方向与项目状态审计（2026-06-06，Codex）

**背景：** 用户提供 `docs/product/操作手册功能借鉴分析与落地方案.docx` 及阿里百炼「求职招聘专区」截图，要求提炼可增强一体机体验的功能，并审查项目当前状态、分支是否收干净、未完成内容和后续推进方向。Codex 已读取正式入口文档、合规文档、功能范围文档、当前进度，并调用产品策略、Kiosk UI/UX、技术架构、合规现实校验 4 路专家评审。

**新增 / 更新文档：**

- [operation-manual-feature-landing-plan.md](../product/operation-manual-feature-landing-plan.md)：已扩展为 `AI求职材料中心开发方向与落地方案`，覆盖截图能力矩阵。
- [project-state-audit-2026-06-06.md](project-state-audit-2026-06-06.md)：记录 Git / 分支 / 未提交 / 当前未完善内容 / 后续处理建议。

**核心结论：**

- 项目方向收敛为 `AI求职材料中心`：简历体检、结构化解析、字段修正、优化建议、模板打印、材料包、PII 检查。
- 第一批 MVP 聚焦 4 件事：Kiosk 打印前 PII 检查、上传体检 + 统一 A4 + 打印材料包、简历字段人工修正 + 原文对照、Admin 异常事件时间线。
- “按岗位方向优化简历 + 模板库”有价值，但暂不进入第一批 MVP；必须先完成话术、字段、数据流三层合规改造，定位为求职者本人材料优化工具，不能形成投递闭环。
- 截图中的 AI 自动招聘机器人、问答式生成职位、企业侧 JD 生成、企业 ATS / 候选人筛选能力不进入本项目。
- 截图中的 HR 知识问答、ATS 智能优化、人岗匹配、简历合规虚假审查等必须改名改流程，只能服务求职者本人。
- 手册和截图中的 KPI 看板、完整识别结果、大表格多维筛选不得照搬到 Kiosk 首页；运营指标统一下沉 Admin，且延续“不编造指标”口径。
- 技术前置风险是求职者资产归属层尚未完整打通；历史材料复用、我的材料、订单支付、校园卡/学生免费等能力需先补 `EndUser` 与文件/AI/打印/订单域的关系。
- Git 状态：`main` 与 `origin/main` 对齐；当前文档分支 `docs/operation-manual-benchmark-plan` 已推送到远端，但本轮新增文档和进度更新尚未提交；多个本地分支未合入 `main`，其中 `fix/expert-audit-stage-b` 远端已删除，需人工确认后再清理。

**专家评审摘要：**

| 评审方向 | 结论 |
|---|---|
| 产品策略 | 优先做简历分析 / 结构化抽取 / 优化 / 初稿生成；面试训练、职业规划、证件照后置 |
| UI/UX | 一体机应是“服务中心式 Kiosk”，首页只放入口和轻状态，不做信息大盘 |
| 技术架构 | 建议增量扩展 `materials/document-processing` 与 `resume-workspace` 域；短期沿用 `api + BullMQ`，不急于迁到空壳 `services/worker` |
| 合规现实校验 | 禁止站内投递、代投、收简历给企业、候选人管理、面试邀约、Offer 管理；岗位/招聘会只保留来源平台跳转 |

**下一步建议：** 先做 Phase A 基础补洞（`EndUser` 资产归属、材料处理任务骨架），再做 Phase B Kiosk 可用闭环（上传体检 → PII 检查 → 打印），详见 [next-tasks.md](next-tasks.md) 新增条目。

---

## Phase A-1：EndUser 资产归属底座（2026-06-06，Codex）

**目标：** 为 `AI求职材料中心` 打底，让登录求职者的文件、AI 简历结果、打印任务能够归属到本人账号；匿名 Kiosk 流程继续可用。

**改动范围：**

| 文件 / 模块 | 改动 |
|---|---|
| `services/api/prisma/schema.prisma`、`20260606170000_add_end_user_asset_ownership` | `FileObject` / `AiResumeResult` / `PrintTask` 新增可空 `endUserId` + `EndUser` 反向关系 + 索引 |
| `services/api/src/common/auth/optional-end-user.ts` | 新增可选 C 端会员 token 解析工具；公共 Kiosk 端点无 token 时继续匿名 |
| `services/api/src/files/*` | `kiosk-upload` 支持有效会员 token 时绑定 `endUserId`；文件元数据契约同步新增 `endUserId` |
| `services/api/src/ai/*` | 简历解析提交可绑定 `endUserId`；优化结果继承解析任务 owner |
| `services/api/src/print-jobs/*` | 打印任务创建可绑定 `endUserId`；匿名打印保持不变 |
| `apps/kiosk/src/services/*`、`PrintUploadPage`、`ResumeSourcePage`、`ResumeParsePage`、`PrintConfirmPage` | 从纯内存登录态读取 token 并随上传、AI 解析、打印任务请求发送 |
| `services/api/scripts/verify-end-user-asset-ownership.ts` | 新增运行期验证脚本 `pnpm verify:end-user-assets` |

**验证：**

| 检查 | 结果 |
|---|---|
| `pnpm --filter @ai-job-print/api typecheck` / `lint` / `build` | ✅ |
| `pnpm --filter @ai-job-print/kiosk typecheck` / `build` | ✅ |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| `pnpm --filter @ai-job-print/admin typecheck` / `lint` / `build` | ✅ |
| `pnpm --filter @ai-job-print/api verify:end-user-assets` | ✅ EndUser 可拥有 FileObject / AiResumeResult / PrintTask；匿名 FileObject 仍支持 |
| `pnpm --filter @ai-job-print/shared build` | ℹ️ shared 包无 `build` script，非代码失败 |

**注意：** 本地 `dev.db` 已通过 `prisma db execute --file prisma/migrations/20260606170000_add_end_user_asset_ownership/migration.sql` 非破坏性执行新增列。PostgreSQL 上线前仍需统一处理既有 migration drift。

---

## Phase A-2：materials/document-processing 任务骨架 + 安全收口（2026-06-06，Codex）

**目标：** 为 `AI求职材料中心` 的上传体检、A4 归一化、PII 检查、遮挡、材料包渲染建立最小后端任务底座；本期只做数据/API 骨架，不做 Kiosk UI、不做真实 OCR/遮挡/合并。

**改动范围：**

| 文件 / 模块 | 改动 |
|---|---|
| `services/api/prisma/schema.prisma`、`20260606210000_add_materials_processing_tasks` | 新增 `DocumentProcessTask` / `PiiFinding`；`sourceFileId/resultFileId` 指向 `FileObject`；`endUserId` 指向 `EndUser`；任务删除级联删除 findings；新增 kind/status/action/requester/accessTokenHash 索引 |
| `services/api/src/materials/*` | 新增 `MaterialsModule` / controller / service / DTO / types / cleanup task；提供 `POST /materials/tasks`、`GET /materials/tasks/:id`、`POST /materials/tasks/:id/pii-findings/decisions` |
| `services/api/src/app.module.ts` | 接入 `MaterialsModule` |
| `services/api/scripts/verify-materials-processing.ts`、`package.json` | 新增运行期验证脚本 `pnpm verify:materials-processing` |

**行为：**

- `inspection` / `normalize_a4` 任务本期同步完成，`resultJson` 写入最小骨架元数据。
- `pii_scan` 任务本期基于文件名和 `params.textSample` 做固定规则模拟扫描，生成手机号 / 邮箱 findings；`snippet` 最多 32 字。
- `paramsJson` 按任务类型白名单落库；`params.textSample` 只参与模拟扫描，落库前替换为长度 + SHA-256 摘要，不保存完整原文；手机号、邮箱、地址、身份证等非白名单敏感参数不落库。
- EndUser 文件只能由本人 member token 创建 / 查询 / 决策；匿名文件允许匿名创建，但创建后返回一次性 `accessToken`，后续查询 / PII 决策必须携带正确 token；后台 User / Partner 文件本期暂不接入材料处理。
- PII 决策仅允许 `keep` / `redact`，跨用户查询和决策均拒绝。
- `expiresAt` 已在读取路径生效，过期任务返回 `MATERIAL_TASK_EXPIRED`；新增 `cleanupExpired()` 和每小时 cron 删除过期任务并级联清理 findings。

**专家复审后的安全收口：**

- A-2 初版经技术架构复核后要求返工：匿名任务不能只靠 `taskId` 访问，`expiresAt` 不能只落库不生效，`paramsJson` 不能保存开放 blob。
- 已完成返工：匿名访问 token 只返回一次，服务端只保存 SHA-256 hash；token 校验使用定长安全比较；过期读取拒绝 + cleanup + 每小时 cron；params 按 kind 白名单和原文摘要化处理。
- 仍需明确：A-2 是后端任务骨架，不是完整材料处理闭环；真实 OCR、A4 归一化、PII 遮挡、材料包合并、worker 队列接线仍在 Phase B/C 实现。

**验证：**

| 检查 | 结果 |
|---|---|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ |
| `pnpm --filter @ai-job-print/api lint` | ✅ |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ EndUser 归属、PII findings、原文不落库、非白名单敏感参数不落库、跨用户拒绝、findings 级联删除、匿名 token 访问控制、过期拒绝和 cleanup 均通过 |

**注意：** 本地 `dev.db` 已通过 `pnpm --filter @ai-job-print/api exec prisma db execute --file prisma/migrations/20260606210000_add_materials_processing_tasks/migration.sql` 非破坏性执行新表，并为安全收口追加执行 `requesterMode` / `accessTokenHash` additive ALTER。PostgreSQL 上线前仍需随既有 migration drift 统一重整。

---

## Phase B-1：Kiosk 打印前材料检查最小闭环（2026-06-07，Codex + Worker）

**目标：** 在现有打印链路中插入“上传体检 -> PII 检查 -> 用户确认 -> 打印设置”，不新增底部 Tab，不做应用广场，不改现有打印任务提交核心逻辑。

**改动范围：**

| 文件 / 模块 | 改动 |
|---|---|
| `apps/kiosk/src/services/api/materials.ts`、`services/api/index.ts` | 新增 Kiosk materials API service：`createMaterialTask` / `getMaterialTask` / `decidePiiFindings`；http 模式调用真实 `/materials/*`；mock 模式明确为“流程演示” |
| `apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` | 新增打印前材料检查页；顺序执行 `inspection` -> `pii_scan`；有文件检查时持有 busy lock 防止待机屏打断；PII 命中项只显示掩码片段和建议动作 |
| `apps/kiosk/src/pages/print/printMaterialSession.ts` | 新增当前打印材料检查 sessionStorage 辅助：仅保存当前会话必要字段、任务视图、匿名 `accessToken`、隐私摘要和打印参数，不保存文件原文 |
| `apps/kiosk/src/pages/print/PrintUploadPage.tsx` | 上传成功后保留 `fileId`，下一步跳转 `/print/material-check` |
| `apps/kiosk/src/pages/print/PrintPreviewPage.tsx` | 透传 `materialCheck` 摘要到确认页 |
| `apps/kiosk/src/pages/print/PrintConfirmPage.tsx` | 新增隐私检查摘要卡：只展示已检查、遮挡/保留数量和“不向第三方发送”提示，不展示 PII 表格 |
| `apps/kiosk/src/routes/index.tsx` | 注册 `/print/material-check` |

**行为：**

- 打印上传成功后不再直接进入打印设置，而是先进入材料检查页。
- 上传页禁用未接入的扫码 / U 盘死入口，避免公共终端出现“点进去只有开发中”的空页面。
- 上传成功后页数显示为“页数待识别”，不再写死 1 页污染费用预估和双面建议。
- 材料检查页在 http 模式会基于上传返回的 `fileId` 创建后端 `inspection` 与 `pii_scan` 任务。
- 匿名任务后续查询 / 决策携带后端返回的 `accessToken`；会员流程携带当前 member token。
- 上传成功后把 `fileId`、文件名、大小、短期签名 URL、SHA-256 和页数状态写入当前 session；刷新或从 preview / confirm 返回时可恢复当前文件、已创建任务、匿名 `accessToken`、隐私摘要和打印参数。
- `/print/material-check` 在缺少 `location.state` 时优先从 session 恢复；如果 session 内已有 `inspection` / `pii_scan` 任务，则查询已有任务，不重复创建；遇到 403 / 404 / 410 会清理失效 session 并要求重新上传。
- 材料检查页新增全局步骤条：上传文件 -> 材料检查 -> 打印设置 -> 确认打印。
- PII 命中项按风险等级展示；支持 `按建议处理` / `全部保留` 批量决策，再逐项微调；必须全部选择 `保留` / `遮挡` 后才能继续；没有命中项时允许继续。
- 页面只展示掩码后的手机号 / 邮箱 / 片段，不展示完整原文。
- 打印设置页和确认页贯穿隐私检查摘要，确认页提升为强提示区，明确“本次打印将按你的选择处理”。
- A-2 后端仍是 skeleton / simulated，因此确认页在演示模式下标注“流程演示”；真实 OCR、真实遮挡产物和材料包合并仍是 Phase B-2。

**验证：**

| 检查 | 结果 |
|---|---|
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ 0 error；保留既有 `KioskBusyContext.tsx` Fast Refresh warning 2 条 |
| `pnpm --filter @ai-job-print/kiosk build` | ✅；Vite chunk size warning 为既有大包体积提示 |
| `pnpm --filter @ai-job-print/api typecheck` | ✅ |
| `pnpm --filter @ai-job-print/api lint` | ✅ |
| `pnpm --filter @ai-job-print/api verify:materials-processing` | ✅ 18 项材料处理任务安全 / 权限 / 过期清理验证全 PASS |

**秒哒 UI/UX 参考审查：** 已调用 UI/UX 设计师只读评审。可迁移“上传方式卡 + 步骤说明 + 固定主 CTA、当前会话文件列表、设备状态横幅、模板卡片模式”；禁止迁移企业端 / 候选人 / 投递闭环、公共终端个人资产常驻面板、A3/B5 等高密打印参数。P0 已修：禁用死入口、页数不写死、全局 stepper、批量决策、风险分级、隐私摘要贯穿。

**待验证 / 待补：** 浏览器 HTTP 模式走 `上传 -> material-check -> preview -> confirm` 的完整点击流、一体机真机触控 / 屏保不中断检查页、真实 API 模式下刷新恢复同一匿名任务仍需手验；真实 OCR / 遮挡 / A4 归一化属于 Phase B-2。

---

## PR-E：Admin 工作台真实 KPI 接入（2026-06-05，`feature/admin-dashboard-real-kpi-clean`）

**目标：** 从 `feature/kiosk-honesty-admin-dashboard` 的 `501e5ac` 救回「工作台不编造指标」的产品意图，但不 cherry-pick 旧实现；基于当前 main service shape 重写 Admin dashboard，只展示已有真实后端来源的数据。

**改动范围：**

| 文件 | 改动 |
|------|------|
| `apps/admin/src/routes/dashboard/index.tsx` | 移除写死 mock KPI / 待办 / 假告警；改为并发读取 `getTerminals`、`getJobSources`、`getFairSources`、`listFiles`、`getAiUsage`、`getAuditLogs`；新增 loading / error / retry 三态；最近操作改用真实审计流 |
| `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` | 记录 PR-E 当前实况 |

**真实指标口径：**

- 在线终端：`getTerminals().terminals`，按 `online` 统计。
- 待审核数据：岗位源 + 招聘会源 `reviewStatus in pending/reviewing`。
- 待清理文件：`listFiles({ limit: 100 })` 返回页内，`deletedAt === null && expiresAt <= now`；文案明确「近 100 条内」，不冒充全量。
- AI 调用：`getAiUsage().totalCalls` + `successRate`；不写「今日」。
- 最近操作：`getAuditLogs({ limit: 8 })` 的真实审计记录。

**明确不展示 / 不编造：** 今日订单、今日收入、待处理告警、打印任务实时数等暂无真实统计端点的指标；待对应后端能力完成后再接入。

**范围外：** 未改后端、未改 schema/migration、未碰 terminals/files 页面、未碰 TRTC/LLM guard、未整体合并 `feature/kiosk-honesty-admin-dashboard`。

---

## Admin 文件管理页切真（2026-06-05，`codex/admin-files-real-api`，基于 main `dcc0b27`）

**背景：** 接口联通性审计（见 [api-connectivity-audit-2026-06-05.md](api-connectivity-audit-2026-06-05.md)）确认 admin 文件管理页 100% 前端 mock，而后端 `/files` 系列端点已就绪并实测通过。本轮把该页从 mock 切到真实后端，**未新增任何后端能力**。

**改动文件（3 个，全部限定在 apps/admin）：**

| 文件 | 改动 |
|------|------|
| `apps/admin/src/services/api/files.ts`（新增） | 镜像后端 `FileMetadata` 的 `AdminFileRecord` 等类型；http/mock 双 adapter + 选择器（与 sources.ts/aiUsage.ts 同模式）。4 方法：`listFiles`(GET /files)、`deleteFile`(DELETE /files/:id?reason=，`encodeURIComponent`)、`cleanupExpiredFiles`(POST /files/cleanup-expired)、`getFileSignedUrl`(GET /files/:id/url)；http adapter 拆 `ApiResponse.data` + 401 跳登录 |
| `apps/admin/src/services/api/index.ts` | `export * from './files'` |
| `apps/admin/src/routes/files/index.tsx`（重写） | 移除本地 MOCK_FILES，改 `useEffect`+`listFiles` 加载；后端字段→展示映射（purpose→类型/来源、normal/sensitive/highly_sensitive→低/中/高敏感、deletedAt/expiresAt→清理状态）；loading 骨架 / error 重试 / empty 三态；「手动删除」走真 DELETE、「清理过期文件」走真 cleanup-expired（均含二次确认，后端写审计）；「查看文件」走 GET /files/:id/url 临时签名 URL（后端写访问审计）；删除演示数据声明 |

**验证（全绿 + 真后端实测）：**

| 检查 | 结果 |
|------|------|
| shared + admin `typecheck` | ✅ |
| admin `lint` | ✅ 0 警告 |
| admin `build` | ✅（457KB / 130KB gzip，2314 模块） |
| 真后端实测 4 端点 | ✅ GET /files `{data:[]}` 字段与 AdminFileRecord 完全一致；DELETE 200（ASCII/编码中文/无 reason 均 200，正确写 deletedAt/deletedBy/deleteReason）；cleanup-expired 201；/files/:id/url 返回签名 URL。**0×5xx、无连接错误** |
| 禁词扫描 | ✅ 0 命中（合规说明含"不做企业招聘闭环传递"为允许文案） |

**合规：** 「查看文件」走后端临时签名 URL（短 TTL）；删除/清理物理删除并由后端写日志审计；文件不长期保存、不做招聘闭环传递。

**本轮范围外（未触碰）：** 未改 .env / 后端 / 其他 admin 页 / kiosk / partner / shared；其余 admin mock 页（dashboard/orders/printers/users/alerts/permissions/peripherals/fairs/partners）需先补后端域，属功能开发，单独排期。

**隔离说明：** 本任务在独立 git worktree（`/Users/wanglei/ai-job-admin-files-wt`，分支 `codex/admin-files-real-api`，基于干净 main）完成，与并发窗口（`codex/cleanup-repo-hygiene`）改动完全隔离。

---

## 仓库卫生清理（2026-06-05，`codex/cleanup-repo-hygiene`）

**目标：** 仅做仓库卫生与状态标注，不改任何业务功能、不裁剪功能、不重构业务代码。

**改动内容：**

1. **`outputs/`（生成产物）：** 检查发现已在 `.gitignore`（第 15 行），且未被 Git 跟踪（`git ls-files outputs/` 为空）——**无需改动**，本地文件保留。
2. **`legacy-miaoda/`（秒哒旧项目参考截图）：**
   - 引用核查：代码中仅 [packages/shared/src/types/complianceCopy.ts](../../packages/shared/src/types/complianceCopy.ts) 有 3 处**注释引用**（指向截图作为合规文案参考），**无任何 import / 代码依赖**。
   - 移除前打归档 tag `archive/legacy-miaoda-20260605`，52 个文件（22M）可随时从该 tag 恢复。
   - `git rm -r legacy-miaoda/` 移除 52 个跟踪文件，并清理残留 `.DS_Store`，目录已完全移出主开发分支。
   - 注：complianceCopy.ts 中 3 处注释仍指向 `legacy-miaoda/screenshots/...`，截图已归档至上述 tag；未改动这些注释（不重构业务代码）。
3. **空壳页登记：** Admin 3 个（peripherals / permissions / users）+ Partner 4 个（account / policy / stats / terminals）共 7 个空壳页，统一登记到 [next-tasks.md](next-tasks.md#空壳页清单phase-9-待做--规划中) 标为 Phase 9+ 待做 / 规划中。**未改动任何页面逻辑。**

**未纳入本次提交（保留原状）：** 工作树中存在一处与本次无关的未提交改动 `apps/kiosk/src/components/AiAdvisorCall.tsx`（TRTC 相关，TRTC 当前冻结），按要求不触碰、不提交。

**未改动：** QingdaoPage / RenshiPage / CampusPage 三个地方化页面按要求保留，等 owner 拍板。

---

## L2-4B：Kiosk /login 顶级全屏登录页（2026-06-04，`claude/l2-4b-kiosk-login-page`）

**目标：** /login 路由全屏独立，不嵌套 KioskRoot；KioskNumPad 驱动输入，接 memberAuthApi 真实验证码流程。

**新增文件（2 个）：**

- `apps/kiosk/src/components/KioskNumPad.tsx`：触控数字键盘，每键 ≥ 72px，配套 readOnly input，不触发系统软键盘。第 12 格可选「确认」键（蓝色）。
- `apps/kiosk/src/pages/auth/LoginPage.tsx`：两步全屏登录——Step 1 输入11位手机号 → 发送验证码；Step 2 输入6位验证码 → 调 memberLogin → useAuth().login() 写入内存会话 → 跳 /。含倒计时重发、错误展示、「暂不登录」跳过入口。

**修改文件（1 个）：**

- `apps/kiosk/src/routes/index.tsx`：在最顶层添加 `{ path: '/login', element: <LoginPage /> }`，置于 KioskRoot 路由之前，确保全屏无 header/footer/nav。

**合规验证：**

- 不触发系统软键盘（readOnly + inputMode="none"，不使用 type="tel"/"number"）。
- 不写任何浏览器存储（login 调用 useAuth().login()，token 只存 React state）。
- 无全局路由守卫：未登录访问 / 不跳 /login（L2-4B 边界，L2-4C 做守卫）。
- tsc --noEmit 零错误，lint 零错误。

**下一步（L2-4C，待排）：** KioskRoot IdentityBlock 接 useAuth + ProfilePage 登录态改造 + IdleLogoutGuard。

---

## L2-4A：Kiosk 前端纯内存会话层 + memberAuthApi（2026-06-04，`claude/l2-4a-kiosk-auth-session`，未提交）

**目标：** 建立 Kiosk 前端会话底座。不改任何页面/路由/UI 组件。

**新增文件（4 个）：**

- `apps/kiosk/src/auth/context.ts`：`AuthUser` / `AuthContextValue` 类型；`deriveDisplayName` 脱敏辅助；`AuthContext` 对象。
- `apps/kiosk/src/auth/AuthContext.tsx`：`<AuthProvider>`——纯内存 useState 管理 user + token，ready 挂载即 true，logout 先清本地再 fire-and-forget 后端。
- `apps/kiosk/src/auth/useAuth.ts`：`useAuth()` hook（单独文件，满足 react-refresh 规则）。
- `apps/kiosk/src/services/auth/memberAuthApi.ts`：`sendSmsCode / memberLogin / fetchMemberMe / memberLogout`——接真实后端 `/api/v1/member/*`，token 全部由参数显式传入，不引入 memberSession，不读任何存储。

**修改文件（1 个）：**

- `apps/kiosk/src/main.tsx`：仅包一层 `<AuthProvider>`。

**合规验证：**

- token 不写 localStorage / sessionStorage / IndexedDB / cookie（已 grep 确认）。
- `memberSession.ts` 未引入（已确认）。
- typecheck / lint / build 全部零错误通过。

**下一步（L2-4B）：** /login 顶级路由 + LoginPage UI（KioskNumPad + 真实 API 调用）+ KioskRoot IdentityBlock + IdleLogoutGuard + ProfilePage 登录态改造。

---

## 〇·Q1、复核：Excel 字段映射 HTTP E2E + dev.db 迁移漂移（2026-06-04，仅复核 + 验证脚本，未改产品代码）

> 本节为 T1（已合入 main `fa99803`）的 HTTP 端到端复核，补齐 T1 遗留的「真实 partner JWT 全链路 HTTP 联调」待办。**未改任何产品代码**；新增内容仅 `services/api/scripts/q1-http-e2e-field-mapping.ts`（自清理验证脚本）+ `package.json` 两个 verify 别名。

**1. HTTP E2E（真实 API:3010 + 真实 partner JWT，`pnpm verify:field-mapping:http`）→ ALL PASS：**
登录 partner1/partner2 → GET mapping-rule(空) → parse → preview(validRows=2) → confirm(imported=2) → GET mapping-rule **读回本次映射**（title/externalId/sourceUrl 一致、updatedAt 非空）→ 跨机构 partner2 GET 该源 **404 DATA_SOURCE_NOT_FOUND** → 非法 dataType **400 INVALID_DATA_TYPE**。脚本跑完自动清理（Q1-* 岗位 / excel 批次记录 / 同步日志 / 本源映射规则），dev.db 回到运行前状态。

服务层断言（`pnpm verify:field-mapping`，原 T1 脚本）同样 ALL PASS（空→落地→二次 upsert unique→job/fair 互不覆盖→越权拒绝）。

**复核中发现的两点（均为护栏生效，非 bug）：** ① 列名「投递链接」被 `SENSITIVE_COLUMN_DETECTED` 拦截（命中敏感词「投递」）——合规护栏按预期工作；② multipart 字段名必须是 `fieldMapping`（非 `mapping`），与前端 `partnerHttpAdapter.previewExcel` 一致，传错则 batch.mappingJson=`{}` 致全行 invalid。二者都是测试脚本初版写错触发，修正后通过，**证明后端校验有效**。

**2. Prisma migration / dev.db 漂移风险评估（`prisma migrate status`）：**

```
last common migration: 20260603155010_ai_result_persistence
未应用(磁盘有、_prisma_migrations 无): 20260604120000_add_ai_resume_result_expires_at, 20260604130000_add_field_mapping_rule
仅在库中(磁盘无): 20260603090745_sync_jobfair_source_id, 20260603090824_add_session_baseline
```

- **对本功能运行期：无风险。** `FieldMappingRule` 表已物理存在于 dev.db，schema 与表结构（列/`@@unique(sourceId,dataType)`/2 索引/FK→JobSource RESTRICT）完全一致，Prisma Client 查询正常（两套验证脚本均过）。`_prisma_migrations` 记账不一致**不影响查询执行**。
- **对 dev.db 重放 `migrate deploy`：会冲突**——T1 迁移用裸 `CREATE TABLE`（无 IF NOT EXISTS），表已存在会报错；加上 2 条「库有盘无」迁移，属**既有、已记录的漂移**（团队按设计用 `db execute` 非破坏性建表，破坏性 reset 推迟到 PostgreSQL 迁移）。**T1 未引入新漂移。**
- **对全新空库（生产 PostgreSQL）：T1 迁移本身合法**，按序可建表；但全仓「`sync_jobfair_source_id`/`add_session_baseline` 迁移文件夹未提交」是**项目级既有问题**，须在 PostgreSQL 迁移统一重生成（next-tasks 已记录），与 T1 无关。

**3. Partner 向导复用 FieldMappingRule（前端代码核对 + HTTP 读回验证）：** `ExcelImportModal.handleUpload` 并行 `parseExcel` + `getMappingRule`（失败不阻断）；用已保存映射覆盖模糊匹配（仅当列仍存在且字段属当前 dataType）；映射步显示「已套用该数据源上次保存的字段映射」提示；confirm 成功后端 upsert 更新规则供下次回填。`partnerHttpAdapter.getMappingRule` → `GET /partner/excel/mapping-rule` 契约与后端一致。**链路完整可用。**

**结论：T1 Excel 字段映射在真实 HTTP 链路下可用，迁移漂移对该功能无实际风险，Partner 向导能从后端读取并复用映射。Q1 范围内未发现需修复的 bug。**

---

## 〇、最新进展：T1 Excel 字段映射规则持久化与复用（2026-06-04，`claude/t1-excel-field-mapping`，基于 main `fc0018a`）

**背景：** 勘察发现 CLAUDE.md §16 把 T1 写成「把 Excel 4 步向导 mock 切到 service + 后端落 ImportBatch」，但该主体在 **W4（`fix/w4-excel-import-integrity`）已完成**：前端 [ExcelImportModal](../../apps/partner/src/routes/sources/ExcelImportModal.tsx) 已走 service（http/mock 双 adapter），后端 [jobs.service.ts](../../services/api/src/jobs/jobs.service.ts) `previewExcelImport`/`confirmExcelImport` 已落 `ImportBatch`/`ImportRecord`。**唯一真正未做的增量**是 `FieldMappingRule`——它只存在于类型/Prisma generated client，schema 无对应 model，字段映射每次导入需手工重做。本轮只补这一增量，**不重写已完成的 ImportBatch/ImportRecord/SyncLog 链路**。

**已完成：**

| 改动 | 文件 |
|------|------|
| 新增 `model FieldMappingRule`（`@@unique([sourceId, dataType])` + FK→JobSource + orgId/sourceId 索引），按「数据源 × dataType」存一份可复用映射；JobSource 加反向关系 `fieldMappingRules` | [schema.prisma](../../services/api/prisma/schema.prisma) |
| 手写 migration `20260604130000_add_field_mapping_rule`（CREATE TABLE + unique/index）。**因 dev.db 存在历史 drift（本地迁移与 `_prisma_migrations` 表不一致），沿用 AiResumeResult 先例用 `prisma db execute` 非破坏性建表，未跑破坏性 `migrate dev` reset** | `prisma/migrations/20260604130000_add_field_mapping_rule/` |
| `getMappingRule(sourceId, dataType, user)`：按机构校验后读回上次保存的映射（无则空映射）；`saveMappingRule`（私有）在 `confirmExcelImport` 成功后 upsert 落地本批次映射，**空映射不落库、失败只 warn 不阻断已成功的导入**；`PrismaService` 加 `fieldMappingRule` 委托 | [jobs.service.ts](../../services/api/src/jobs/jobs.service.ts)、[prisma.service.ts](../../services/api/src/prisma/prisma.service.ts) |
| `GET /partner/excel/mapping-rule?sourceId=&dataType=`（partner JWT+RolesGuard） | [jobs.controller.ts](../../services/api/src/jobs/jobs.controller.ts) |
| 前端 service 层加 `getMappingRule`：http adapter 调真端点；mock adapter 用模块级 store **镜像「confirm 才落地」语义**（preview 暂存→confirm 保存）；向导 `handleUpload` 并行拉取已保存规则、在列仍存在时覆盖模糊匹配，映射步显示「已套用上次保存映射」提示 | [ExcelImportModal.tsx](../../apps/partner/src/routes/sources/ExcelImportModal.tsx)、`apps/partner/src/services/api/{partnerHttpAdapter,partnerMockAdapter,partnerContent,types}.ts` |

**验证（三绿 + 运行期断言）：** shared/api/partner `typecheck` ✅；api/partner `lint` ✅（0 warning）；api/partner `build` ✅（partner 350KB/106KB gzip）。运行期断言脚本 [verify-field-mapping-rule.ts](../../services/api/scripts/verify-field-mapping-rule.ts) 直连 dev.db 5 项全过：① 无规则返回空映射；② confirm 落地后可读回；③ 二次 upsert 取最新值且 `(sourceId,job)` 仍 1 行（unique 生效）；④ job/fair 各一行互不覆盖；⑤ 跨机构读取被拒。

**合规：** 仅存「标准字段→Excel 列名」映射结构，不存任何行数据/PII；敏感列在 W4 preview 阶段已拦截（本轮未改该逻辑）；partner 改动文件禁词扫描 0 命中。

**本轮范围外：** 未改 `packages/shared`（沿用 partner 端 `FieldMappingRuleResult` 局部类型，前后端契约简单无需对齐 shared）；未触碰 Kiosk/admin/worker/terminal-agent/legacy/合规边界文档；CLAUDE.md §16 的过时描述本窗口无权改（不在允许目录），仅在此与 next-tasks 标注 T1 主体已由 W4 完成。
## 〇、最新进展：T2 BullMQ API 拉取 worker 验证（2026-06-04，`claude/t2-api-pull-worker`，基于干净 main `fc0018a`）

**背景：** next-tasks / CLAUDE.md §16 P0 列「BullMQ API 拉取 worker 验证：`pnpm verify:job-sync` 通过后 FF merge」。W8（`feat/w8-bullmq-api-worker` + `feat/w8-redis-e2e-verification`）已实现并曾跑通该 worker；本轮以干净 main 为基线**复验**，确认在真实 Redis + BullMQ 路径下行为正确。本任务为**验证优先**，未改任何运行代码。

**验证环境：** 本地 Redis `redis://localhost:6379`（`redis-cli ping → PONG`）；`DATABASE_URL=file:./prisma/dev.db`（SQLite dev）；`.env` 已含 REDIS_URL / DATABASE_URL / JWT_SECRET / SECRET_ENCRYPTION_KEY / FILE_SIGNING_SECRET。

**结果（三绿 + E2E ALL PASS）：**

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ |
| `pnpm --filter @ai-job-print/api lint` | ✅（0 warning） |
| `pnpm --filter @ai-job-print/api build` | ✅ |
| `pnpm verify:job-sync`（[verify-job-sync.ts](../../services/api/scripts/verify-job-sync.ts)） | ✅ **ALL PASS** |

**E2E 关键断言（真实 BullMQ，非 inline fallback）：**

- **走真实 worker 路径确认**：`enqueue()` 返回 `jobId=<sourceId>_manual`（BullMQ 队列 jobId），而非 inline fallback 的 `jobId=inline` —— 证明 `JobSyncProcessor` 从 Redis 队列 claim 任务并执行 `pullApiSource`。
- **成功路径**：mock HTTP 源（返回 2 条岗位 JSON）→ worker 拉取 → `Job` 表落 2 条 → `SyncLog.result=success`、`addedCount=2` → **`reviewStatus=pending` / `publishStatus=draft`**（合规：审核前不展示）。
- **失败路径**：HTTP 503 源 → `SyncLog.result=failed`、`errorDetail=HTTP_503: Service Unavailable`、**0 条 Job 落库**（失败不写脏数据）。
- 测试数据（临时 Org / JobSource / Job / SyncLog）跑完自动清理，dev.db 无残留。

**合规：** 拉取数据默认 `reviewStatus: pending` + `publishStatus: draft`，管理员审核后才展示；只同步岗位/招聘会公开信息，不接收简历/候选人；凭证仅服务端解密（`decryptSecret`），失败归类 `CREDENTIAL_DECRYPT_FAILED`。

**本轮范围外（未触碰，与 T1 隔离）：** 未改 `services/api/src/jobs/`、`services/api/prisma/`、`prisma.service.ts`、`schema.prisma`、任何 migration；未碰 Kiosk/admin/partner/terminal-agent/worker/legacy/合规边界文档。生产 `REDIS_URL` 必配、responseConfig 可视化配置、真源 API 联调仍为 next-tasks 待办（W8 已记录，非本验证范围）。

## 〇·B、T3B 文档校正：AI 数字人现状（2026-06-04，仅改 docs）

> 本节为 T3A 现状复核（只读）后的文档校正，**未改任何代码**。用于纠正下文若干"AI数字人仍为下一步/SVG 引导员为主方案"的过期描述。

**结论：AI 数字人语音通话 + 文字对话均已完成并接入 AI 助手页。**

| 项 | 现状 |
|----|------|
| 入口 | Kiosk 底部导航「AI助手」Tab → 路由 `/assistant`（`apps/kiosk/src/pages/assistant/AssistantPage.tsx`）；首页亦有卡片入口 |
| 语音通话 | `apps/kiosk/src/components/AiAdvisorCall.tsx`：腾讯 TRTC（`trtc-sdk-v5`）对话式 AI（ASR+LLM+TTS），由 `VITE_USE_TRTC_CALL` 控制懒加载 |
| 文字对话 | `AssistantPage.tsx` 内 `TextChat`，走 `chatWithAssistant()` → `POST /assistant/chat`；含路由白名单、会话隔离、"内容仅供参考"免责 |
| **实际形象方案** | **TRTC 真人照片顾问形象「小青」（`/assets/ai-advisor.png`），不再是 SVG 数字人引导员主方案** |

**待清理死代码（本任务不删除，仅标注）：**
- `apps/kiosk/src/components/DigitalHuman.tsx`（Phase 9.2 的 2D SVG 数字人引导员）—— 全仓已无任何引用，被「小青」真人照片方案取代后未清理。
- 配套 `SpeechBubble`（Phase 9.2）同样已无引用。
- 处置建议：后续单独起一个清理任务删除或归档，**不在 T3B 范围内**。

**Phase 9.5 编号冲突（待后续重命名/重新编号）：**
- 本文档下方「✅ Phase 9.5：AI 数字人语音通话修复（2026-06-02）」= 已完成的 TRTC 语音通话修复。
- `next-tasks.md` 旧规划表中「Phase 9.5 = AI模拟面试官」= 尚未开发的面试训练功能。
- 两者共用「Phase 9.5」编号，含义冲突；后续需把其中之一重命名或重新编号，**本任务不改编号，仅记录**。

---

## 一、已确认的项目决策

| 决策项 | 结论 | 确认时间 |
|--------|------|---------|
| 项目定位 | AI求职打印服务终端（非招聘平台） | 2026-05 |
| 底部导航 | 仅保留：首页、AI助手、我的 | 2026-05 |
| AI工具箱入口 | 不作为一级导航 | 2026-05 |
| 企业招聘端 | 删除，不开发 | 2026-05 |
| 合作机构后台 | 保留，只做数据与运营后台 | 2026-05 |
| 管理员后台 | 保留，管理整个终端运营体系 | 2026-05 |
| 打印机型号 | 奔图 CM2800/CM2820 系列（Windows 识别名：`Pantum CM2800ADN Series`） | 2026-05（Windows 真机确认 2026-05-27） |
| 岗位/招聘会数据 | 只做第三方/官方来源信息入口 | 2026-05 |
| 旧秒哒项目 | 仅作参考库，不作为正式工程 | 2026-05 |
| 技术栈 | React + Vite + TypeScript + Tailwind + shadcn/ui | 2026-05 |
| AI数字人 | **已实现（2026-06，见 §〇·B）**：AI 助手页 `/assistant` 语音通话（TRTC 真人照片顾问「小青」）+ 文字对话均已完成；早期"轻量 3D/SVG 引导员"非当前主方案（SVG `DigitalHuman.tsx` 已成待清理死代码）；始终不做招聘官/候选人筛选官 | 2026-05 规划 / 2026-06 落地校正 |

---

## 二、当前开发阶段

**当前阶段：P0 Bug 修复 + 后端接线（2026-06-04，`fix/p0-bugs-and-backend-wiring`，基于 `feat/kiosk-campus-zone-on-main`）**

---

### ✅ AI 助手角色范围与禁用词治理（2026-06-03，Codex）

本次在已接入大模型的 AI 助手链路增加“角色范围 + 禁用词”双层治理：

- 后端新增 `llm-guard`：构造带角色范围的 system prompt，并在模型回复后做确定性禁用词拦截；命中后直接替换为范围内兜底回复，不把原回复下发前端。
- `LlmConfigService` 配置新增 `roleScope` / `forbiddenWords`，默认范围限定在简历优化、求职指导、就业政策、打印扫描、第三方岗位/招聘会来源入口；支持 `AI_ASSISTANT_ROLE_SCOPE` / `AI_ASSISTANT_FORBIDDEN_WORDS` 环境变量初始化。
- Admin「AI 大模型配置」页面新增角色范围与禁用词配置项；API Key 仍只加密保存在服务端，不回显。
- TRTC 语音助手默认提示词改为复用同一套 guard 构造逻辑；可用 `TRTC_ROLE_SCOPE` / `TRTC_FORBIDDEN_WORDS` 单独覆盖，否则复用通用环境变量或默认值。
- 新增 `pnpm --filter @ai-job-print/api verify:llm-guard` 验证脚本，覆盖默认禁用词命中、角色范围注入、禁用词回复兜底替换。

验证结果：`api typecheck` ✅ / `admin typecheck` ✅ / `api lint` ✅ / `admin lint` ✅ / `verify:llm-guard` ✅ / 相关 AI 源码与 admin 页面禁用词扫描 0 命中 ✅。

---

### 🟢 待机宣传屏（广告位）一期（2026-06-04，`feature/kiosk-screensaver-ads`，基于 `main`）

一体机闲时变"待机宣传屏"：管理员后台上传图片/视频 → 配置播放方案 → 绑定终端 + 无操作时长 → Kiosk 无操作自动进入全屏轮播 → 触摸唤醒回首页。**仅管理员后台管理素材；AI 文生图为二期，一期 stub（默认 disabled，接口明确返回未启用，不产生外部费用）。** 合规：待机宣传屏属线下一体机运营广告位，非招聘闭环；素材文案禁用"一键投递"等违规词。

| 层 | 改动 | 文件 |
|----|------|------|
| Prisma | 新增 4 表 `AdAsset` / `AdPlaylist` / `AdPlaylistItem` / `TerminalScreensaverConfig` + migration `20260604150000_add_screensaver_ads`（additive，未 reset dev.db；时间戳由 `20260604130000` 重编号至 `20260604150000` 以避免与 `add_field_mapping_rule` 冲突）；PrismaService 加 4 个 delegate | `prisma/schema.prisma` + `prisma/migrations/` + `src/prisma/prisma.service.ts` |
| 后端 | `ContentModule`：素材上传（MIME 白名单 + 魔数校验 + 图片/视频大小上限 + 时长上限）/列表/启停/删除；播放方案 CRUD（排序、整体覆盖、删除解绑终端）；终端配置（未绑定方案强制 `enabled=false`）；Kiosk 拉取 `GET /terminals/:id/screensaver`（无可播素材→`enabled=false` 防黑屏）；素材 HMAC 签名内容流 `GET /ad-assets/:id/content`（1h TTL，缓存 key 用 id/sha256）；管理员写操作全程审计 | `src/content/*` |
| 后端 | AI 文生图 Provider 抽象 + `DisabledAiPosterProvider`；`AI_IMAGE_PROVIDER=disabled` 时 `POST /admin/ai-posters/generations` 等返回 `400 AI_POSTER_NOT_ENABLED` | `src/content/ai-poster.*` + `.env.example`（`AD_ASSET_MAX_*` / `AI_IMAGE_*`） |
| shared | `screensaver.ts` 契约类型（后端 `content.types.ts` 为本地副本，SSOT 同步两处） | `packages/shared/src/types/screensaver.ts` |
| Kiosk | `useIdleTimer` + `KioskBusyContext`（忙碌态豁免：打印/扫描/AI 通话/上传中持锁，idle 暂停）+ `/screensaver` 全屏顶级路由（视频 `muted+playsInline+autoPlay`，播放失败/解码异常自动跳下一个，任意触摸退出回首页，Cache Storage 缓存 + 只预加载下一个）+ adapter（http/mock） | `apps/kiosk/src/hooks/`、`contexts/`、`pages/screensaver/`、`services/`、`layouts/KioskRoot.tsx`、`routes/index.tsx` |
| Admin | 「宣传屏」模块：素材库（上传/启停/删）/ 播放方案（上移下移排序，非拖拽）/ 终端配置（开关+时长+绑定方案）；AI 文生图入口展示"二期能力，暂未启用"；nav + 路由 | `apps/admin/src/routes/screensaver/`、`services/api/screensaver.ts`、`layouts/AdminLayoutWrapper.tsx`、`routes/index.tsx` |

**验证：** api typecheck/lint 绿；kiosk typecheck/lint/build 绿（2 个 react-refresh fast-refresh 警告，非阻塞）；admin typecheck/lint/build 绿。dev.db 已 additive 建表，未触碰既有表。**二期待办：** 接真实文生图 provider（通义万相/CogView）+ 内容安全 + 草稿确认入库；曝光/唤醒埋点报表；机构端上传 + 审核流。

---

### ✅ AiResumeResult 留存治理（2026-06-04，`fix/ai-resume-result-retention`，基于 `feat/kiosk-campus-zone-on-main`）

落实 CLAUDE.md §11「不长期保存简历」：给简历派生结果（解析/优化）加留存窗口，到期自动清理。接真实 AI provider（before/after 可能含简历摘录）前的合规硬前提，MockProvider 阶段先行落地，风险最低。

| 改动 | 文件 |
|------|------|
| `AiResumeResult` 加 `expiresAt DateTime?` + `@@index([expiresAt])`；migration `20260604120000_add_ai_resume_result_expires_at`（手写 ALTER，绕开 dev.db 既有 drift 不做破坏性 reset） | `prisma/schema.prisma` + `prisma/migrations/` |
| `persistResult` 每次写入（含 update）刷新 `expiresAt = now + AI_RESUME_RESULT_TTL_HOURS`（默认 24h，env 可调）；`loadResult` 把已过期行视为不存在（读取路径在到期后也不返回简历派生内容，不等 cron）；新增 `cleanupExpiredResults('manual'\|'cron')` 硬删过期行 + 写 `ai_resume_result.cleanup_expired` system 审计（仅数量/按 kind 摘要，无 taskId/payload） | `src/ai/ai.service.ts` |
| `AiResultCleanupTask` 每小时 cron（镜像 `FilesCleanupTask`，复用顶层 `ScheduleModule.forRoot()`） | `src/ai/ai-result.cleanup.task.ts`（新建）+ `src/ai/ai.module.ts` |
| `AI_RESUME_RESULT_TTL_HOURS` 文档化 | `services/api/.env.example` |

**验证：** typecheck / lint / build 三绿；dev.db 运行期三项断言通过 —— ① 过期行被 loadResult guard 视为不存在；② cleanup 只选中过期行（不误删未到期）；③ 删除后过期行消失、未到期行保留。审计/Prisma 模式镜像已验证的 `files.cleanupExpired`。

**本轮范围外：** 未改前端；未触碰真实 provider 接通（仍 stub，需凭证）；dev.db 全量 drift 不在本轮处理（PostgreSQL 迁移单独排期）。

---

### ✅ P0 Bug 修复 + 后端接线（2026-06-04，`fix/p0-bugs-and-backend-wiring`）

基于全项目专家评审（多 Agent：各模块进度 + 构建健康 + 合规扫描 + 真假数据审计 + 集成 Bug 猎手），按优先级修复 P0/MEDIUM/LOW 问题；改动后经 6 路对抗式审查复核，typecheck/lint/build 全量三绿。

**已修复（HIGH）：**

| # | 问题 | 修复 |
|---|------|------|
| HIGH-1 | 图片打印 100% 失败：Agent `extFromUrl` 对无后缀签名 URL 永远回退 `.pdf`，JPEG/PNG 被当 PDF 喂给 SumatraPDF | claim 响应新增 `fileName`/`mimeType`（从 `PrintTask.paramsJson` 取原始文件名），Agent `inferTaskExt` 按 mimeType→fileName→URL→.pdf 推断，PNG/JPG 正确走 pdfkit 图片分支 |
| HIGH-2 | 打印参数被静默丢弃：7 处生产端传扁平 `{copies,duplex:'single',color:'bw'}`，PrintConfirmPage 只读 `PrintJobParams`，份数/双面/彩色全回落黑白单面 | `packages/shared` 新增 `makePrintParams()` 归一化 helper（旧字段名/非法值映射，`pageRange:'all'`→undefined 对齐后端 DTO），7 处统一接入 |
| HIGH-3 | 打印创建端点无鉴权/无审计/SSRF：`fileUrl` 不验签，任意外部 URL 落库给 Agent 下载 | `parseAndVerifySignedFileUrl` 强校验本系统签名 URL（HMAC+有效期），非法 400 `PRINT_INVALID_FILE_URL`；落库重签 30min；创建写 `print_job.create` 审计（payload 无 sig/正文/密钥）；保匿名 Kiosk 流（签名校验+限流+审计，不加 JWT） |
| HIGH-4 | Admin 设备页 100% 本地 mock，后端心跳能力被浪费 | 后端新增 `GET /admin/terminals`（admin JWT+RolesGuard，列终端+最近心跳+online<3min）；Admin 设备页接真 HttpAdapter |
| HIGH-5 | Admin 日志审计页空骨架，后端 `/admin/audit-logs` 已就绪却 0 消费 | Admin 审计页接真后端：动作/时间筛选、分页、空/加载/错误态 |
| HIGH-6 | AI 解析/优化结果存进程内 Map，重启/多实例即 404 | 新增 Prisma 模型 `AiResumeResult`（taskId+kind 唯一）+ 迁移，读写改走 DB（仍用 MockAiProvider 产生内容） |

**已修复（MEDIUM/LOW）：** 招聘会 `companies/zones/map` 子端点接真 Prisma（materials/stats/booths 无模型→诚实空）；上传签名 URL TTL 5min→30min（覆盖触控操作窗口，避免打印时撞过期 400）；`print_doc` 上传 MIME 收口为 pdf/jpeg/png + 文件选择器 `accept` 同步收窄；文件清理 cron 补写审计；sync-sources 统一 Bearer 鉴权；首页设备状态去造假；Qingdao/Renshi 死按钮接「即将上线」/真跳转；删除孤儿页 `ResumeUploadPage`（路由重定向 `/resume/source`）；login 渲染期副作用入 useEffect；filesApi 重复 `kioskUploadFile` 收口。

**集成修复（主程，审查后）：** 招聘会 companies/zones **wire→DTO 字段对齐**（后端精简 Prisma 形状 `name/industry:null` vs Kiosk 富 DTO `companyName/positions/checkinStatus`，httpAdapter 早期空 stub 掩盖、接真数据后 `c.industry.toLowerCase()` 会崩页）——在 Kiosk httpAdapter 新增 `mapWireCompany`/`mapWireZone`，模型缺字段安全占位不硬造。

**删除记录（CLAUDE.md §7）：** `apps/kiosk/src/pages/resume/ResumeUploadPage.tsx`（'Phase 3 开发中' 占位页，真实流程走 `/resume/source`，路由改 `<Navigate>` 重定向）。

**合规复核：** 6 路审查 complianceOk 全 true；无禁词违规（命中均为合规护栏/白名单文案）；前端/shared 无密钥泄露；审计 payload 无敏感正文。

**本轮范围外（需硬件/凭证/基础设施，已记 next-tasks）：** 真实 AI provider（需凭证）、`AiResumeResult` TTL/清理（接真 provider 后必加，§11）、扫描真机链路（TWAIN/SMB，需硬件）、PostgreSQL 迁移、奔图开放打印 API 彩色 mode。

---

### ✅ 校园招聘专区 P0（2026-06-03，feat/kiosk-campus-zone-on-main，cherry-pick 自 `42ebd9c`，基于干净 main `603be2a`）

在「招聘会页太空」的反馈下，按已确认方案 A（详见 [campus-recruitment-design.md](../product/campus-recruitment-design.md)）落地 Kiosk 校园招聘专区 **P0：纯前端聚合页**。**未改 Prisma schema / migration，未新增任何后端闭环能力**，全部复用 main 已有的 `/jobs`（category=campus）与 `/job-fairs` 能力。
**当前阶段：Kiosk 岗位信息板块完整收口（2026-06-03，feat/kiosk-jobs-complete）**

---

### ✅ Kiosk 岗位信息板块完整收口（2026-06-03，feat/kiosk-jobs-complete，分支自 main `603be2a`）

把一体机前台 `/jobs` 与 `/jobs/:id` 从"能展示"收口为"功能完整、数据真实、前后端可互通"。
**独立 git worktree 开发（`/Users/wanglei/ai-job-kiosk-jobs-wt`），未触碰打印 / 扫描 / AI 数字人 / Terminal Agent / legacy-miaoda，未改 Prisma schema/migration**
（行业能力用既有 `tagsJson` 列承载，避免与 `feat/data-session-baseline` 的未提交 schema 改动纠缠）。

**已完成项：**

| 模块 | 内容 |
|------|------|
| `/campus` 聚合页（新建 `pages/campus/CampusPage.tsx`） | ① **季节横幅卡**（`getCampusSeason` 按当前月份给秋招/春招/实习季阶段提示，纯展示、不外发）；② 校园招聘会（复用 `getJobFairs()` + 前端关键词过滤识别校招会，DTO 暂无 theme；「查看招聘会」跳 `/job-fairs/:id`）；③ 校招岗位（复用 `getJobs({category:'campus'})`，「查看岗位」跳 `/jobs/:id`）；④ 求职材料服务（AI 简历→`/resume`、打印→`/print-scan`）|
| 合规护栏 | 顶部 `ComplianceBanner`（warning）+ 底部来源说明；投递/预约文案保持「去来源平台投递/扫码投递/去来源平台预约/扫码预约」（实际投递/预约按钮在 `/jobs/:id`、`/job-fairs/:id` 详情页，本页不出现禁词）；不接收/保存/转发简历给企业，无候选人/面试/Offer/推荐 |
| 首页入口 | `HomePage` 新增「校园招聘专区」单行业务入口带（`CampusEntryBar` → `/campus`）；**底部 Tab 保持固定：首页 / AI助手 / 我的，未新增** |
| **招聘会页做厚**（`JobFairsPage`）| 顶部新增「校园招聘专区」引导卡 → `/campus`；列表卡片用**真实字段**做厚：主办方 `organizer`、参展/已录入企业数（`boothCount` 或 `managedCompanyCount`+`managedMaterialCount`）、`dataSourceNote`、来源+同步；按钮统一「查看招聘会」。**岗位数 `jobCount`/届别 `audienceType` DTO 暂无 → 留 P1，不硬造 mock** |
| 路由 | `routes/index.tsx` 注册 `{ path: 'campus' }` |
| 加载/空/错误态 | 各数据块复用 `LoadingState/ErrorState(可重试)`；无数据时降级为「查看全部岗位/招聘会」入口卡，不留空洞 |

**验证（2026-06-03）：** kiosk typecheck / lint / build 全过；合规禁词扫描无真实违规（命中均为允许文案「去来源平台投递」且非本轮改动文件）。运行期未跑（纯前端聚合，依赖既有 `/jobs`、`/job-fairs` 接口，先前已实测）。

**P0 未做（留 P1/P2，需加 DTO/schema 字段，禁止硬造 mock）：** 岗位数 `jobCount` 与届别 `audienceType`（应届/实习/社招）字段（待 P1 加可选 DTO 字段，合作机构后台标注）、校招时间线② 横向交互组件、AI 求职路线规划、校招季订阅提醒。

> **依赖说明（本分支基于干净 main 603be2a，不含 jobs board）：** 校招岗位 P0 用 `getJobs()` + 前端关键词过滤（`isCampusJob`）实现；**server-side `getJobs({ category, pageSize })` 筛选属 jobs board(1fdefa4) 能力，本分支不依赖**，待 jobs board 合入 main 后于 P1 切回 server-side 精确筛选。
| 后端 `GET /api/v1/jobs` | 真实 Prisma 查询，**只返回** `reviewStatus=approved` + `publishStatus=published`；新增 query 参数 `keyword`（title/company/description OR contains）、`city`、`industry`、`category`(=workType 别名归一)、`sourceOrgId`、`tag`、`page`、`pageSize`，全部落 DB 层，分页 `total` 准确 |
| 后端 `GET /api/v1/jobs/:id` | 只返回已审核已发布岗位，未审核/未发布返回 `data:null`（不暴露） |
| 返回字段 | title / company / city / salaryDisplay / tags / industry / category / description / requirements / sourceOrgId / sourceName / sourceUrl / externalId / syncTime / dataSourceNote 齐备 |
| 行业(industry) | 无独立 DB 列：约定以 `行业:` 前缀 tag 存于 `tagsJson`，后端 `prismaJobToListItem` 抽取为 `industry` 字段并从展示 `tags` 剔除；筛选用 `tagsJson contains "行业:<x>"`（带引号边界=精确） |
| 前端 `/jobs` | 新增关键词搜索框（去抖 300ms）；城市/行业下拉项由真实返回数据聚合；岗位类型 chip 映射 `category`；来源机构卡片→`sourceOrgId`；筛选条件与后端 query 对齐，http 模式走真实接口（无筛选时复用 facet 全量，任一筛选→真实带参请求） |
| 前端 `/jobs/:id` | "去来源平台投递" / "扫码投递" 均渲染**真实 `sourceUrl` 二维码**（`qrcode.react` `QRCodeSVG`，内容即 sourceUrl，非占位图）；sourceUrl 经 http/https 校验，无效则禁用按钮并提示 |
| 收藏 | 纯本地 `localStorage`（`useJobFavorites` + `useSyncExternalStore`，列表/详情实时同步），星标切换 + "只看收藏"；**不上传简历、不形成招聘闭环** |
| 错误态 | 后端不可达显示可操作提示「后端服务未连接，请检查 API 服务」+ 重试 |
| 合规 | 文案仅"去来源平台投递 / 扫码投递"；页面持续声明"仅展示第三方/官方来源、不接收简历、不参与招聘流程"；未新增 `/jobs/:id/apply`、未做一键投递/收简历 |

**新增 / 删除文件：**

- 新增依赖：`apps/kiosk` → `qrcode.react@^4.2.0`
- 新增：`apps/kiosk/src/components/SourceUrlQr.tsx`、`apps/kiosk/src/lib/url.ts`、`apps/kiosk/src/lib/useJobFavorites.ts`
- **删除**：`apps/kiosk/src/data/jobsMeta.ts`（旧 mock-id 耦合的地区树/JOB_META，已被真实数据聚合取代；两个岗位页均已改用 `ExternalJobDTO`）
- 共享类型：`packages/shared/src/types/job.ts` `ExternalJobDTO` 新增可选 `category`

**验证结果（2026-06-03）：**

- `pnpm --filter ./services/api typecheck`：通过
- `pnpm --filter ./apps/kiosk typecheck` / `lint` / `build`：全部通过（lint 0 error/0 warning）
- 真实 Prisma seed 扩充为 13 条（11 approved+published、1 pending、1 approved+draft）后实测：
  - 列表 `total=11`，仅返回已发布；pending(`job-uni-0044`)、approved-draft(`job-hr-1002`) 均不出现 ✓
  - `keyword=工程师`(标题)、`keyword=海尔`(公司)、`keyword=党建`(描述) 命中正确 ✓
  - `city=杭州市` / `industry=金融`(抽取+剥离前缀) / `category=campus` / `workType=internship`(别名归一) / `sourceOrgId=org-hr-002` / 组合(青岛市+parttime) 均生效 ✓
  - 详情：已发布返回全字段 + 合法 https `sourceUrl`；pending/draft 返回 `null` ✓
  - 全链路 http：kiosk dev(`VITE_API_MODE=http`)→vite proxy→API→真实数据，列表/行业筛选/详情 sourceUrl 均通 ✓
- ⚠️ 协作记录：本任务初次在共享工作区的 feature 分支开发，期间另一会话在同一工作区执行 `git reset`/`checkout`/`clean`，清空了本任务尚未提交的改动；已改用**独立 git worktree** `/Users/wanglei/ai-job-kiosk-jobs-wt`（branch `feat/kiosk-jobs-complete`）重建并提交，彻底隔离并发会话。后续多会话并行务必各用独立 worktree。

---

### ✅ 真实打印能力收口版（2026-06-02，feat/kiosk-print-real-capability-hardening，分支自 main `5e612b3`）

把打印链路从"能跑"收口为"可稳定承诺"，跨 Kiosk / 后端 API / Terminal Agent 三端。方案②：保留 wire 字段名 `fileMd5`，但全链路注释澄清其当前承载 **SHA-256**；不做 Prisma 改名 migration。

**关键修复：**

| # | 问题 | 修复 |
|---|------|------|
| 1（致命） | hash 校验不一致：后端 files 算 **SHA-256**（以 `sha256` 返回）→ Kiosk 当作 `fileMd5` 上送 → Agent 却用 **MD5** 重算比对 → 真实上传文件 100% `DOWNLOAD_HASH_MISMATCH` 打印失败（此前仅 seed 任务用 MD5 常量掩盖） | Agent 改用 **SHA-256** 重算比对（`computeFileSha256`）；后端 seed 任务 `fileMd5` 改存 `SAMPLE_VISIBLE_PDF_SHA256`；前端/后端/Agent 全链路注释澄清字段实为 sha256 |
| 2 | 前端暴露 `quality`/`pagesPerSheet`，但 Agent `mapParams()` 完全忽略 → 过度承诺 | `PrintPreviewPage` 隐藏这两项控件（固定安全默认值随参数上送，后端仍枚举校验）；`PrintConfirmPage` 摘要去掉两行 |
| 3 | 彩色打印未真机验证 | 保留彩色选项 + 诚实提示「彩色效果以设备支持和当前耗材状态为准」（Preview + Confirm） |
| 4 | 后端 create print job `params` 仅 `@IsObject()` 松校验 | 新增强类型 `PrintJobParamsDto`（嵌套 `@ValidateNested`）；非法枚举/越界 copies/非法 pageRange/未知字段 → 400 VALIDATION_FAILED（已运行时验证） |
| 5 | Agent 打印前不预检打印机 | 新增 `getPrinterPreflight`（WMI 区分 not_found/offline/paper_empty/error）；task-runner 打印前预检 → 明确 `PRINTER_NOT_FOUND`/`PRINTER_OFFLINE`/`PAPER_EMPTY`/`PRINTER_ERROR`，避免 5min 超时；非 Windows/查询失败返回 unknown 不阻塞 |
| 6 | 失败提示不清晰 | `PrintProgressPage` 增 `ERROR_CODE_MESSAGES`：DOWNLOAD_HASH_MISMATCH/PRINTER_NOT_FOUND/PRINTER_OFFLINE/PAPER_EMPTY 等 → 可操作中文提示 |
| 7 | fileName 不落库 | PrintTask 无独立 fileName 列（本阶段不 migration）；折中：fileName 存入 `paramsJson`，任务详情/日志/DB 可见（Agent 忽略未知键，无副作用） |

**修改文件（仅本阶段，12 代码 + 2 文档）：** `apps/terminal-agent/src/{agent/{task-runner,types,wmi},printer/types}.ts`、`services/api/src/{print-jobs/{dto/create-print-job.dto,print-jobs.service},terminals/terminals.service}.ts`、`apps/kiosk/src/{services/{files/filesApi,print/printJobsApi},pages/print/{PrintPreviewPage,PrintConfirmPage,PrintProgressPage}}` + 本文件 + next-tasks.md。

**明确不做：** 真实扫描 Agent / 格式转换 / 证件照 / 签名盖章 / 支付 / BMP/TIFF / Prisma 改名 migration / 改 AI 简历·岗位·招聘会·后台。

**验证：** 三端 typecheck/build 全过；kiosk+api lint 过（terminal-agent 无 lint script）；后端真机运行时验证 DTO：非法值/未知字段/非法 pageRange/越界 copies → 400（精确字段错误），合法 → 201；sample PDF SHA-256(64hex) 与 seed 一致。**Windows 真机验证已全部完成（2026-06-03）**，详见 checklist。

**Windows 真机验证结果（2026-06-03，Pantum CM2800ADN Series，Windows 11 Pro x64）：**

| # | 项 | 结果 |
|---|---|---|
| P1–P10 | 正向打印链路（copies/duplex/orientation/scale/pageRange/black_white/color）| ✅ 全部通过，真实出纸 |
| P10 彩色 | colorMode=color 真彩验证 | ✅ 真彩可用（SumatraPDF 未设 monochrome 时驱动默认彩色） |
| N4 原始 | DOWNLOAD_HASH_MISMATCH — Agent 正确检测，API 状态机 Bug（claimed→failed 被拒） | ⚠️ 发现 Bug |
| N1 原始 | PRINTER_NOT_FOUND — WMI 秒级检测正确，API 状态机 Bug 同 N4 | ⚠️ 发现 Bug |
| N2 原始 | PRINTER_OFFLINE — WorkOffline 未检查，假阳性 completed | ❌ 发现设计缺口 |
| N3 | PAPER_EMPTY — Pantum WMI 驱动不上报 DetectedErrorState=4 | ❌ 已知硬件/驱动限制 |
| N5 | Agent 重启幂等，已完成任务不重打 | ✅ 通过 |

**修复（commit `7221d1e`，2026-06-03）：**

| 修复 | 文件 | 改动 |
|---|---|---|
| 状态机修复（N1/N4）| `services/api/src/terminals/terminals.service.ts` | `claimed: ['printing']` → `claimed: ['printing', 'failed']` |
| WorkOffline 检测（N2）| `apps/terminal-agent/src/agent/wmi.ts` | preflight/status 脚本增加 `$p.WorkOffline` 第三字段；`workOfflineStr === 'True'` → return `'offline'` |

**修复后复测（2026-06-03）：**

| # | taskId | API 最终状态 | 结果 |
|---|---|---|---|
| N4 | ptask_kiosk_25c585344567c22a | status=failed, errorCode=DOWNLOAD_HASH_MISMATCH | ✅ 通过 |
| N1 | ptask_kiosk_efaa1205fe5fd897 | status=failed, errorCode=PRINTER_NOT_FOUND | ✅ 通过 |
| N2 | ptask_kiosk_3dd4a8e5b5ae7046 | status=failed, errorCode=PRINTER_OFFLINE | ✅ 通过 |

**N3 已知限制（不修复，等待后续方案）：**
PAPER_EMPTY 无法通过 WMI preflight 预检实现。Pantum CM2800ADN Series Windows 驱动打印前后 `DetectedErrorState` 均为 0，不上报缺纸状态。后续需改用 Windows 打印后台 job result 监控（`Get-PrintJob` 状态）或 SNMP 查询网络打印机状态。

**当前状态：** 已 FF 合入 main（`3f35caa`，2026-06-01）。

---

### ✅ 打印作业监控 + 缺纸/卡纸/设备异常处理（2026-06-03，feat/terminal-agent-print-job-monitor，分支自 main）

在 Phase 8 基础上补充打印队列监控，对缺纸/卡纸/设备故障/驱动不确定状态统一处理。核心原则：不重复出纸 (N5)、设备异常必须 failed、不伪造 completed。

**新增错误码：**

| errorCode | 含义 | 触发场景 |
|---|---|---|
| `PRINT_JOB_UNCONFIRMED` | 作业提交到打印队列但未确认完成 | Pantum `Printing, Retained` 监控超时；Agent 在监控期间崩溃重启 |

**`getPrintJobStatus` 映射修正（wmi.ts）：**

| JobStatus (flags) | 旧映射 | 新映射 | 原因 |
|---|---|---|---|
| `Printing, Retained` | `completed` ❌ | `retained` | Pantum 驱动对已打印和等待纸张均返回此状态，不可区分 |
| `PaperOut` | `paper_empty` | `paper_empty` | 不变（Pantum 不上报此标志，其他驱动保留） |
| `Jammed / Error / UserIntervention / Deleting` | `error` | `error` | 不变 |

**监控逻辑修正（task-runner.ts `monitorPrintJob`）：**

- `retained`：继续轮询（等待可能出现的明确错误），设 `seenRetainedOnce = true`
- 超时 + `seenRetainedOnce=true` → `{ failed: true, errorCode: 'PRINT_JOB_UNCONFIRMED' }` （不声称 completed）
- 超时 + `seenRetainedOnce=false`（job 以 `printing` 状态出现但超时）→ 保守 completed（非 Pantum 慢速打印）
- 超时 + job 从未出现（快速任务）→ 保守 completed（不变）

**Step 0 spooled 重启补偿修正（task-runner.ts）：**

- 旧：spooled → PATCH completed（错误：不知道是否真出纸）
- 新：spooled → PATCH failed + PRINT_JOB_UNCONFIRMED + 结构化 warn 日志，运营人员人工确认

**错误消息规范化（全链路统一）：**

| errorCode | Agent errorMessage（PATCH body）| Kiosk 展示（ERROR_CODE_MESSAGES） |
|---|---|---|
| `PAPER_EMPTY` | `打印机缺纸，当前无法打印，请联系工作人员补纸后重试` | 同左 |
| `PRINTER_ERROR` | `打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理（队列状态: ...）` | `打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理` |
| `PRINT_JOB_UNCONFIRMED` | `打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态` | 同左（fallback: errorMessage）|

**后台/运维追踪（已有机制复用）：**

- 心跳（heartbeat.ts）每 30s 上报 `printerStatus`（WMI `getPrinterStatus`）→ 管理员后台可见
- 所有 `PATCH failed` 均带 `errorCode` + `errorMessage` → 后端 print task 记录可查
- Agent 对异常场景输出结构化 `err()` / `warn()` 日志（含 taskId + rawStatus + 原因）
- ⚠️ **待补**：设备告警中心前端展示 + 终端自动禁用/锁定机制（admin 后台当前无自动告警 UI），记录为 P1 待做事项

**修改文件（共 4 文件）：**

| 文件 | 改动 |
|---|---|
| `apps/terminal-agent/src/printer/types.ts` | 新增 `PRINT_JOB_UNCONFIRMED` 到 `PrintErrorCode` 联合类型 |
| `apps/terminal-agent/src/agent/wmi.ts` | `PrintJobMonitorStatus` 新增 `'retained'`；`Retained → retained`（不再 → completed）；补充详细注释 |
| `apps/terminal-agent/src/agent/task-runner.ts` | Step 0 spooled → failed+PRINT_JOB_UNCONFIRMED；`monitorPrintJob` 新增 `seenRetainedOnce`/retained case/timeout 分支；warn 日志移到 failed/completed 判断之前；错误消息规范化 |
| `apps/kiosk/src/pages/print/PrintProgressPage.tsx` | `ERROR_CODE_MESSAGES`: PAPER_EMPTY/PRINTER_ERROR 文案更新，新增 PRINT_JOB_UNCONFIRMED |

**明确不做（本分支范围）：** 不改 API schema、不做扫描/格式转换/证件照/签名盖章、不合 main、不 push main。

**typecheck/build：** terminal-agent `tsc --noEmit` ✅ / kiosk `tsc --noEmit` ✅

**真机验证结果（2026-06-03，全部通过）：**

| # | 场景 | taskId | API 终态 | errorCode | 结果 |
|---|---|---|---|---|---|
| P1 | 正常单页打印（回归） | ptask_kiosk_5c6bf741c868400f | completed | — | ✅ |
| P4 | copies=2（回归） | ptask_kiosk_4560ee70d68ab763 | completed | — | ✅ |
| P5 | duplex_long_edge（回归） | ptask_kiosk_6d2a4da9eece1714 | completed | — | ✅ |
| N1 | PRINTER_NOT_FOUND（回归） | ptask_kiosk_a0ef494d5417bb2e | failed | PRINTER_NOT_FOUND | ✅ |
| N2 | PRINTER_OFFLINE（回归） | ptask_kiosk_567e9da95b34da0e | failed | PRINTER_OFFLINE | ✅ |
| N3-new | 缺纸 Retained 超时 → UNCONFIRMED | ptask_kiosk_46d128fe180a304c | failed | PRINT_JOB_UNCONFIRMED | ✅ |
| N4 | DOWNLOAD_HASH_MISMATCH（回归） | ptask_kiosk_298aa103ee1b2a04 | failed | DOWNLOAD_HASH_MISMATCH | ✅ |
| spooled restart | 崩溃重启补偿 → UNCONFIRMED | ptask_kiosk_7554237ac0becd2c | failed | PRINT_JOB_UNCONFIRMED | ✅ |

**N3 结论：** 不再声称自动识别 PAPER_EMPTY；Pantum Retained 场景不误报 completed，30s 超时后转 PRINT_JOB_UNCONFIRMED。  
**N5 幂等：** 无重复出纸，spooled 重启补偿不重打，API failed 终态稳定。

---

### ✅ 打印扫描服务中心 第一阶段（2026-06-02，feat/kiosk-print-scan-service-center，分支自 main `c7f6191`）

首页第二个大模块「打印扫描服务中心」。本阶段不做真实文件转换、不做真实电子签、不做真实扫描 Agent 大改，只做服务中心入口、真实打印链路接入、MVP 说明页、合规与诚实声明。

**页面 / 路由：**

| 路由 | 页面 | 说明 |
|------|------|------|
| `/print-scan` | `PrintScanHomePage` | 服务中心首页，6 能力九宫格 + 敏感文件提示 + 非 CA 电子签声明 |
| `/print-scan/feature/:key` | `PrintScanFeatureInfoPage` | 证件照 / 格式转换 / 签名盖章 的「即将上线」说明页（`key` 未知有容错，不白屏） |

**入口跳转：**

| 能力 | 跳转 | 类型 |
|------|------|------|
| 文档打印 | `/print/upload` | 真实打印链路（W7 上传→建任务→Terminal Agent 出纸） |
| 照片打印 | `/print/upload`（`state.category='photo'`） | 真实打印链路 |
| 材料扫描 | `/scan/start` | 现有流程，已加「流程演示」诚实说明（真机需 Agent，Phase 8.2） |
| 证件照 | `/print-scan/feature/id-photo` → 备选「先用照片打印」 | MVP 说明 |
| 格式转换 | `/print-scan/feature/convert` → 备选「先去文档打印」 | MVP 说明 |
| 签名盖章 | `/print-scan/feature/sign` → 备选「先去文档打印」 | MVP 说明 |
| 首页「打印扫描」主卡 | `/print-scan` | 入口已指向新服务中心 |

**修改文件（严格限定计划范围）：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx` | 服务中心首页（6 能力卡 + 合规声明）；材料扫描卡加「流程演示」诚实提示 |
| `apps/kiosk/src/pages/print-scan/PrintScanFeatureInfoPage.tsx` | 三项 MVP 说明页（计划支持 + 合规声明 + 备选路径 + 未知 key 容错） |
| `apps/kiosk/src/pages/scan/ScanStartPage.tsx` | 顶部加「流程演示」ComplianceBanner（`KIOSK_SCAN_DEMO_NOTICE`） |
| `apps/kiosk/src/pages/home/HomePage.tsx` | 「打印扫描」主卡跳转确认指向 `/print-scan` |
| `apps/kiosk/src/routes/index.tsx` | 注册 `/print-scan`、`/print-scan/feature/:key` |
| `packages/shared/src/types/complianceCopy.ts` | 强化 `KIOSK_PRINT_SCAN_ESIGN_NOTICE`（非 CA 电子签补强版）；新增 `KIOSK_SCAN_DEMO_NOTICE` |

**合规与诚实声明：**
- 签名盖章：仅用于个人材料整理与打印辅助，不提供 CA 电子签 / 电子认证 / 合同签署服务；仅图片合成预览，不具备法律认证效力
- 敏感文件（证件照/身份证）：完成后按隐私策略自动清理，不长期留存、不转发第三方
- 材料扫描：明确「当前为流程演示，真机扫描需一体机连接 Terminal Agent」
- 证件照 / 格式转换 / 签名盖章：均标「即将上线」，不出现「已完成/成功」假能力文案；不伪造后端转换/签章成功
- 禁用词扫描通过（一键投递/立即投递/平台投递 等 0 命中）

**明确不做：** 真实格式转换、真实证件照排版、真实签章合成、真实扫描 Agent、CA 电子签 / 电子认证 / 电子合同签署、企业端；不改 AI 简历服务 / 岗位 UI / 招聘会 / 后台。

**验证：** `typecheck` ✅ / `lint` ✅ / `build` ✅ / 合规禁词扫描 ✅ / 路由与跳转 + 未知 key 容错 + 诚实文案 核查通过。

---

### ✅ Kiosk 岗位信息页 UI 改造（2026-06-02，codex/kiosk-jobs-ui-redesign，分支自 main `0f41dd1`）

将一体机 `/jobs` 页面从「单列岗位列表」升级为「地区筛选 + 来源机构卡片区 + 推荐岗位卡片流 + 岗位详情」。

**修改范围（严格限定在 apps/kiosk，未触碰 legacy-miaoda / admin / partner / terminal-agent / services/api 业务能力）：**

| 文件 | 改动 |
|------|------|
| `apps/kiosk/src/data/jobsMeta.ts`（新增） | Kiosk 本地展示元数据：省/市/区县三级 `REGION_TREE`、来源机构分类（官方机构/第三方平台/合作来源）`SOURCE_ORGS`、按岗位 id 的学历/经验/地区 `JOB_META`、`enrichJob()` 叠加、`buildSourceCards()` 来源聚合。不改 packages/shared 类型，仅以 id/sourceOrgId 关联接口 DTO，http 模式缺元数据时优雅降级 |
| `apps/kiosk/src/data/externalSources.ts` | `MOCK_JOBS` 扩充至 12 条（新增青岛官方/合作/第三方来源岗位），城市与 `REGION_TREE` 对齐；`MOCK_FAIRS` 不变 |
| `apps/kiosk/src/pages/jobs/JobsPage.tsx`（重写） | 顶部标题+来源说明+合规提示+返回首页；地区三级联动 select + 确定按钮；岗位类型 pill 筛选；「本地信息来源」卡片区（机构名/覆盖区域/岗位数量/来源类型/最近更新，点击筛选该来源）；「推荐岗位」响应式卡片流（岗位名/企业/薪资/地点/学历·经验/来源/更新时间/查看详情）；当前筛选 chips + 重置 |
| `apps/kiosk/src/pages/jobs/JobDetailPage.tsx`（增强） | 新增学历/经验、企业信息卡；合规说明改为「本岗位来自第三方/官方来源，本系统不接收简历、不参与招聘流程。」；底部仅「去来源平台投递 / 扫码投递」+ 跳转说明；保留二维码弹层 |

**设计要点：**
- 用户选完地区即可直接看推荐岗位，来源机构卡片是可选筛选入口，不强制先进入人力公司才能看岗位
- 21.5 寸触控优先：select 高 56px、主按钮/pill 触控区 ≥48px；响应式来源卡片 2/3/4 列、岗位卡片 1/2/3 列；移动端单列堆叠无横向溢出
- 沿用现有设计系统（Button/Card/PageHeader/EmptyState/Loading/ErrorState + tokens），未引入新 UI 框架
- 数据：继续走 `getJobs()/getJobById()` service（保留真实 API 接入结构），mock 模式用本地数据；未新增后端接口

**合规检查结果：**
- 禁用文案扫描（一键投递/立即投递/平台投递/投递简历/企业收简历/候选人管理/面试邀约/Offer管理/简历筛选）→ ✅ 0 命中（"去来源平台投递"为允许文案，其中"平台投递"为子串误报已排除）
- 仅展示第三方/官方来源岗位入口，无平台内投递/收简历/候选人筛选/招聘闭环能力
- 详情页明确提示不接收简历、不参与招聘流程；投递仅二维码跳转来源平台

**验证结果：**
- `pnpm --filter @ai-job-print/kiosk typecheck` → ✅ 0 错误
- `pnpm --filter @ai-job-print/kiosk lint` → ✅ 0 警告
- `pnpm --filter @ai-job-print/kiosk build` → ✅ 通过（index 919KB/271KB gzip；chunk 体积告警为既有 trtc 包，非本次引入）
- 浏览器视觉验证（mock 模式）：一体机 1920×1080 / 移动 390×844 / 详情页 三视口截图均正常，移动端 `scrollWidth===clientWidth` 无横向溢出

---

### ✅ AI 简历服务中心（2026-06-02，feat/kiosk-ai-resume-service-center，分支自 main `0f41dd1`）

将原线性简历流程升级为"AI 简历服务中心"，完整链路：
`AI简历服务首页 → 选择来源 → 选择目标方向 → AI诊断 → 优化前后对比 → 生成优化版 → 导出/打印`

**新增页面（3）：**
- `ResumeHomePage`（`/resume`）：4 大入口（AI简历诊断 / AI简历优化 / 简历素材库 / 面试准备「即将上线」占位）+ 四步流程说明 + 最近记录（仅承接 location.state，无记录时空状态，不硬编码假数据）+ 隐私合规提示
- `ResumeTargetPage`（`/resume/target`）：行业/目标岗位/经验级别/求职场景选择，支持"暂不指定，通用诊断"；写入 `location.state.targetContext`
- `ResumeTemplateLibraryPage`（`/resume/templates`）：素材库 MVP（简历模板/求职信/感谢信/作品集封面 + 标签筛选 + 查看/用于优化/打印；本地占位，无收费、无投递、无企业端）

**新增路由：** `/resume`、`/resume/target`、`/resume/templates`（保留 `/resume/source|parse|report|optimize|export`）

**改动页面：**
- `HomePage`：首页"AI 简历服务"入口 `/resume/source` → `/resume`（按钮文案"进入简历服务"）
- `AssistantPage`：快捷入口"简历诊断"→"简历服务"，路由 `/resume/report` → `/resume`（避免直达失效报告页丢 state）；`/resume` 加入 `ALLOWED_ROUTE_PREFIXES` 白名单；`KEYWORD_ROUTES`/`SHORTCUT_ICON_MAP` 同步对齐 `/resume`
- `ResumeSourcePage`：上传/我的文档下一步 `/resume/parse` → `/resume/target`（scan 仍走 `/scan/start`）；返回按钮 → `/resume`
- `ResumeReportPage`：原"页面数据丢失"死路 → 友好恢复页（"还没有诊断报告" + 开始简历诊断/返回AI简历服务）；新增目标方向摘要 + "优先修改项"section（由真实报告最低分项派生，不编造）；合规声明用 `KIOSK_RESUME_REPORT_DISCLAIMER` + `KIOSK_RESUME_NO_SEND_ENTERPRISE`
- `ResumeOptimizePage`：新增主按钮"采纳建议生成优化版"→ `/resume/export`（`optimizedGenerated` 标记，不伪造后端成功）；目标方向摘要；disclaimer 用 `KIOSK_RESUME_OPTIMIZE_DISCLAIMER`，移除"通过率"措辞
- `ResumeExportPage`：区分三种输出（原简历/优化版简历「已生成时」/诊断报告「有 taskId 时」），每项可保存到我的简历/打印；底部"返回 AI 简历服务" + 不发送企业声明

**shared 类型：**
- `packages/shared/src/types/ai.ts`：新增 `ResumeTargetContext`（行业/岗位/经验/场景/skipped；仅前端 state 传递，暂不随 `ResumeParseRequest` 发后端，避免破坏 DTO 校验）
- `packages/shared/src/types/complianceCopy.ts`：新增 `KIOSK_RESUME_REPORT_DISCLAIMER` / `KIOSK_RESUME_OPTIMIZE_DISCLAIMER` / `KIOSK_RESUME_NO_SEND_ENTERPRISE`

**状态流完整性（子代理审查通过）：** source→target→parse→report 全程透传 source/file/fileId + targetContext，不丢字段；`handleRetry` 只剥 CONTROL_FIELDS，保留 targetContext。所有 resume 路由直达（无 state）均不白屏/不死路。

**合规：** 无招聘闭环禁词（仅 2 处代码注释命中，非渲染）；不接企业端、不收费、不投递；素材库/优化版均为安全占位，不伪造后端。未触碰打印/扫描模块重构、企业端查看报告。

**验收（2026-06-02）：**
| 检查 | 结果 |
|------|------|
| `pnpm --filter ./packages/shared typecheck` | ✅ |
| `pnpm --filter ./apps/kiosk typecheck` | ✅ |
| `pnpm --filter ./apps/kiosk lint` | ✅ 0 warnings |
| `pnpm --filter ./apps/kiosk build` | ✅（主包 919KB，未增长；trtc/AiAdvisorCall 为 flag 死代码分块） |
| `pnpm typecheck`（全 8 项目） | ✅ |
| 合规禁词扫描（resume/home/assistant） | ✅ 仅注释命中 |

---

### ✅ P0 安全改进 Round 4（2026-06-02，feat/phase9-assistant-actions）

专家团队全面审查（8 agent 并发，7 个文件维度）后修复全部 High + Medium + Low 问题：

| 问题 | 文件 | 修复 |
|------|------|------|
| H1: TRTC 无鉴权 | `trtc/trtc.controller.ts` | 要求 `X-Terminal-Id` header；无 Terminal ID 的外部请求返回 401 |
| H2: tag 过滤 total 错误 | `jobs/jobs.service.ts` | DB 层加 `tagsJson contains` 预过滤；count 和 findMany 使用相同 where 条件 |
| M1: 分页 NaN 注入 | `jobs/jobs.controller.ts` | `safeInt()` 替换裸 `Number()`；非数字字符串 fallback 到默认值 |
| M2: 未心跳终端误判 404 | `terminals/terminals.service.ts` + controller | 增加 `found: boolean`；终端存在但无心跳 → 200 `isOnline=false`，而非 404 |
| M3: AI HTTP 请求无超时 | `aiHttpAdapter.ts` | `get()/post()` 加 `AbortController + 15s 超时`；超时抛 `REQUEST_TIMEOUT` |
| M4: Waveform style 泄漏 | `AiAdvisorCall.tsx` | `<style>` 移至 AiAdvisorCall 根元素（渲染一次），不再随 300ms 音量事件重复注入 |
| M4+: TRTC fetch 补 header | `AiAdvisorCall.tsx` | `startCall` 和 `cleanup` 的 fetch 均附加 `X-Terminal-Id` header |
| M5: 会话上下文跨用户泄漏 | `AssistantPage.tsx` | 移除 `localStorage` 持久化；每次挂载生成新 `sessionId`，防止共享终端用户间上下文泄漏 |
| M6: PrintTaskStatus 缺 claimed | `shared/types/print.ts` | 增加 `'claimed'` 状态；补充各状态注释 |
| L1: PrintPreviewPage fetch 泄漏 | `PrintPreviewPage.tsx` | 打印机状态 fetch 增加 `AbortController`；组件卸载时中止请求 |
| L2: PrintProgressPage deps 压制 | `PrintProgressPage.tsx` | 移除两处 `// eslint-disable-next-line react-hooks/exhaustive-deps`；补全 `navigateFail/navigateSuccess/shouldFail/failReason` deps |
| L3: ProfilePage printFile 路由错误 | `ProfilePage.tsx` | 跳转改为 `/print/preview`（经过参数设置页），不再跳 `/print/confirm` 绕过参数校验 |
| L4: TRTC userId 无校验 | `trtc/trtc.controller.ts` | `userId` 正则校验 `^[\w-]{1,64}$`，拦截特殊字符注入 HMAC payload |
| Audit: 传递依赖漏洞 | `pnpm-workspace.yaml` | 新增 overrides：`@hono/node-server >=1.19.13`、`uuid >=11.1.1`；`pnpm audit` → No known vulnerabilities |

#### 🔍 Round 4 合入前复核（2026-06-02）

| 检查 | 结果 |
|------|------|
| `pnpm --filter @ai-job-print/api typecheck` | ✅ pass |
| `pnpm --filter @ai-job-print/api lint` | ✅ pass（1 warning：`llm-config.service.ts` `_omit` 未用，非阻塞） |
| `pnpm --filter @ai-job-print/api build` | ✅ pass |
| `pnpm --filter @ai-job-print/kiosk typecheck` | ✅ pass |
| `pnpm --filter @ai-job-print/kiosk lint` | ✅ pass |
| `pnpm --filter @ai-job-print/kiosk build` | ✅ pass |
| `pnpm --filter @ai-job-print/shared typecheck` | ✅ pass |
| `pnpm audit --audit-level=moderate` | ✅ No known vulnerabilities |

---

### ✅ P0 安全改进 Round 3（2026-06-02，feat/phase9-assistant-actions）

#### H-11: AiAdvisorCall 静态打包

- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`：改用 `lazy(() => import(...))` + `<Suspense>` 按需加载 `AiAdvisorCall`
- `AiAdvisorCall` 拆为独立 11.7KB chunk
- Kiosk 主包减少约 11KB
- `trtc-sdk-v5` 仅在用户发起语音通话时才加载，默认浏览 AI 助手页不拉取 TRTC SDK

#### H-9: TRTC 连接无超时

- `POST /api/v1/trtc/session` 前端调用增加 `AbortController` + `setTimeout(30s)`
- 超时后显示："连接超时（30s），请检查网络后重试"
- 避免后端或网络挂起时 Kiosk 一直停留在连接等待状态

#### H-5: ProfilePage 硬编码假数据

- `MOCK_RESUMES` / `MOCK_ORDERS` / `MOCK_AI` 改为空数组
- 从其他页面流程跳入时携带的 `location.state` 数据仍正常传入和展示
- 真实 API 接入降级为后续 P1，不再用硬编码记录伪装用户历史

#### H-6/H-7: JobFair 子资源端点缺失

- 新增 6 个 stub GET 端点（`services/api/src/jobs/jobs.controller.ts`）：
  `/companies`、`/companies/:companyId`、`/zones`、`/map`、`/materials`、`/stats`
- Fair 数据模型尚未落 Prisma，统一返回 `200 + 空数据`（`{data:[]}` / `{data:null}`），比 404 更友好
- 前端（`FairCompaniesPage` / `FairMapPage` / `FairMaterialsPage` / `FairStatsPage` / `FairCompanyDetailPage`）已有 `LoadingState / ErrorState / EmptyState` 三态兜底；http 模式下空响应正常落到 EmptyState，company 详情 null 落到 ErrorState
- 合规说明：这些端点为公开 Kiosk 端点（与 `/jobs`、`/job-fairs` 同级，无需鉴权），当前返回空集，**不暴露任何未发布数据**。后续 Fair 模型落库时必须补 `publishStatus` 过滤与来源合规字段（source_org_id/external_id/source_url/sync_time）后才能返回真实数据 → 见 next-tasks P1

**剩余 P1/P2（不阻塞 main 合入）：**
- H-5 ProfilePage 真实 API 接入
- M-5 `chatWithAssistant` 增加 `AbortController`
- M-6 LLM 会话 Redis 持久化

#### 🔍 合入前复核（2026-06-02，Claude）

全部门禁通过：

| 检查 | 结果 |
|------|------|
| `pnpm --filter ./apps/kiosk typecheck` | ✅ pass |
| `pnpm --filter ./apps/kiosk lint` | ✅ pass |
| `pnpm --filter ./apps/kiosk build` | ✅ pass（`trtc-sdk-v5` 独立 chunk，不在主包 `index-*.js`；`VITE_USE_TRTC_CALL=false` 时死代码消除，trtc/AiAdvisorCall chunk 完全不产出） |
| `pnpm --filter ./services/api typecheck` | ✅ pass |
| `pnpm --filter ./services/api lint` | ✅ pass（1 warning：`llm/llm-config.service.ts` `_omit` 未用，非阻塞，属未提交的 LLM 新代码） |
| `pnpm --filter ./services/api build` | ✅ pass |
| `pnpm audit` | ⚠️ 2 moderate（均为传递依赖，非运行时直连）：`exceljs > uuid <11.1.1`、`prisma(dev) > @hono/node-server <1.19.13` → P2 跟踪 |

合规扫描：
- ✅ 无"一键投递/立即投递/平台投递"违规按钮（命中项均为合规说明/禁词清单/合规按钮"去来源平台投递"/LLM 系统提示红线）
- ✅ 无新增硬编码打印机型号（terminal-agent 用可覆盖的 `DEFAULT_PRINTER` 默认常量；admin mock 展示数据 + 类型注释为既有内容，非本轮引入）
- ✅ `xlsx` 依赖已彻底移除，无回归（exceljs 替代）
- ✅ `AliAvatar` 组件已删除（commit cf945c8），全仓无引用，不请求任何后端
- ✅ env 文件（`.env.local` / `services/api/.env`）未被 git 跟踪，`.gitignore` 已覆盖；TRTC SecretKey 全程留服务端

**合入注意（重要）：** 工作区存在 Round 3 之外的**未提交新功能** —— TRTC 后端（`services/api/src/trtc/*` 未跟踪）+ LLM 对接（`services/api/src/ai/llm/*` 未跟踪 + `ai.module/ai.service/ai-log.service` 已改）+ admin AI 配置页（`apps/admin/src/routes/ai-config/*` 未跟踪）。`app.module.ts` 已 import `TrtcModule`，但 `trtc/` 源文件未提交 —— **二者必须同批提交**，否则 main 上构建缺文件。建议：要么连同 TRTC/LLM 一起作为独立 feature commit 提交后再合入，要么本轮只合 Round 3 安全提交（cbc45b0）并回退 app.module/ai 改动。

---

### ✅ P0 安全改进 Round 2（2026-06-02，feat/phase9-assistant-actions）

#### H-12: xlsx@0.18.5 → exceljs（CVE-2023-30533，CRITICAL RCE）

- `services/api/package.json`：移除 `xlsx`，新增 `exceljs`
- `services/api/src/jobs/jobs.service.ts`：
  - 新增私有方法 `loadExcelRows(buffer)` 封装 exceljs 读取（替换 `XLSX.read` + `XLSX.utils.sheet_to_json`）
  - `parseExcelColumns` 改为 `async`（exceljs 为异步 API）
  - `previewExcelImport` 改用 `loadExcelRows`，移除 `rawRow as unknown[]` 强转
  - `wb.xlsx.load(buffer as unknown as ArrayBuffer)` 处理 TypeScript Buffer 泛型兼容问题
- 保持不变：敏感列检测、intra-batch 去重、DB 事务回滚语义

#### C-3 + H-1: AliAvatar 隔离 + 闭包修复

- `apps/kiosk/src/components/AliAvatar.tsx`：
  - 新增模块级常量 `USE_ALI_AVATAR = import.meta.env['VITE_USE_ALI_AVATAR'] === 'true'`
  - `useEffect` 首行 `if (!USE_ALI_AVATAR) return` — 未启用时零网络请求
  - 新增 `stateRef = useRef<ReadyState>('idle')` 与 `setState(s)` 同步更新（H-1 修复）
  - `useImperativeHandle` 用 `stateRef.current` 替代 `state`，消除闭包过期问题
  - 所有 hook 调用完毕后 `if (!USE_ALI_AVATAR) return null`（符合 React Hooks 规则）
- `apps/kiosk/.env.example`：新增 `VITE_USE_ALI_AVATAR=false`（带启用前置条件说明）
- `apps/kiosk/src/vite-env.d.ts`：新增 `VITE_USE_ALI_AVATAR: string` 类型声明

#### H-4: PrintPreviewPage 移除硬编码打印机名

- `services/api/src/terminals/terminals.service.ts`：新增 `getTerminalPrinterStatus(terminalId)` — 查最新心跳的 printerStatus + isOnline（5min 窗口）
- `services/api/src/terminals/terminals.controller.ts`：新增 `GET /api/v1/terminals/:terminalId/printer-status`（无需 auth，Kiosk 读自身设备状态）
- `apps/kiosk/src/pages/print/PrintPreviewPage.tsx`：
  - 删除 `const PRINTER_NAME = 'Pantum CM2800ADN Series'`（CLAUDE.md §3 违规）
  - 删除 `MOCK_PRINTER_STATUS`（Phase 8.1 遗留 mock）
  - 新增 `mapPrinterStatus(raw)` 将 heartbeat 状态字符串映射到 `PrinterStatus`
  - 新增 `usePrinterStatus()` hook：读 `VITE_TERMINAL_ID` 调 API，失败降级 `PRINTER_OFFLINE`
  - 打印机状态栏使用 hook 返回的 `printerName` 和 `printer`
  - 确认按钮：`printerLoading` 时显示"设备检测中…"并禁用
- `apps/kiosk/.env.example`：新增 `VITE_TERMINAL_ID=` 和 `VITE_PRINTER_NAME=`（均注释掉，含说明）
- `apps/kiosk/src/vite-env.d.ts`：新增 `VITE_TERMINAL_ID` 和 `VITE_PRINTER_NAME` 类型声明

**验收（2026-06-02）：**
- `pnpm --filter @ai-job-print/api typecheck` ✅
- `pnpm --filter @ai-job-print/api lint` ✅（0 errors，1 pre-existing warning in llm-config.service.ts）
- `pnpm --filter @ai-job-print/api build` ✅
- `pnpm --filter ./apps/kiosk typecheck` ✅
- `pnpm --filter ./apps/kiosk lint` ✅
- `pnpm --filter ./apps/kiosk build` ✅（898KB main bundle，trtc 分块独立）
- `pnpm audit`：xlsx CVE-2023-30533 已清除；剩余 2 moderate（@hono/node-server 在 @prisma/dev 深层传递、uuid 在 exceljs 内部且使用模式无触发条件）

---

### ✅ W8 并行三任务（2026-06-02，feat/phase9-assistant-actions cherry-pick 合入）

**方式：** 3 个子代理 × 独立 worktree，并行实现，主控 code review 后 cherry-pick 按序合入

#### A. feat(admin): responseConfig 可视化配置（bf8b4c0 + eb07549）

- 后端：`services/api/src/job-sync/job-sync.controller.ts` 新增两个端点
  - `GET /admin/job-sync/sources/:sourceId` — 返回单个 API 数据源含 responseConfig（解析 JSON）
  - `PUT /admin/job-sync/sources/:sourceId/response-config` — 保存 dataType/rootPath/fields
  - 均受 `@JwtAuthGuard + @RolesGuard + @Roles('admin')` 保护
- 前端：`apps/admin/src/routes/sync-sources/index.tsx` 新增 440px 侧滑配置抽屉
  - "mappings" 按钮触发，显示 dataType select + rootPath input + 动态字段映射 rows
  - 抽屉面板 `onClick={stopPropagation}` 防止点击内部关闭（review fixup 修复）
  - 操作列两按钮用 `flex gap-1.5` 包裹（review fixup 修复）

#### B. fix(api): JobFair sourceId 精确追踪（d1671b3）

- `services/api/prisma/schema.prisma`：
  - JobFair 模型新增 `sourceId String?` + `source JobSource? @relation("FairSource", ...)`
  - JobFair 模型新增 `@@index([sourceId])`
  - JobSource 模型新增 `fairs JobFair[] @relation("FairSource")` 反向关联
- `services/api/src/jobs/jobs.service.ts` `confirmExcelImport`：
  - fair 分支的 `tx.jobFair.upsert` create 块补充 `sourceId: batch.sourceId`
  - update 块不设 sourceId（与 Job 一致，防"刷字段绕审核"）
- `npx prisma db push && npx prisma generate` 已在 worktree 内验证通过

#### C. feat(kiosk): 助手快捷入口 Polish（c402945，Phase 9.4）

- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`
  - 新增 5 个图标导入：FileTextIcon/PrinterIcon/BriefcaseIcon/CalendarDaysIcon/LandmarkIcon
  - 新增 `SHORTCUT_ICON_MAP` 路由 → 图标映射（无需改 SHORTCUTS 类型）
  - 快捷按钮内嵌图标（`flex items-center gap-1.5`）
  - ZapIcon 旁新增 "快捷入口" 文字标签
  - 触控目标已为 `min-h-[48px]`（Phase 9.5 已满足，C 补充图标）
  - 合规：5 个路由完全合规，无招聘闭环词

**验收（cherry-pick 后）：**
- `cd services/api && npx tsc --noEmit` ✅
- `pnpm --filter admin exec tsc --noEmit` ✅
- `pnpm --filter kiosk exec tsc --noEmit` ✅

---

### ✅ Phase 9.5：AI 数字人语音通话修复（2026-06-02）

> ⚠️ 编号冲突：此处「Phase 9.5」指**已完成**的 TRTC 语音通话修复；`next-tasks.md` 旧规划中「Phase 9.5 = AI模拟面试官」指**未开发**的功能。后续需重命名/重新编号其一（见 §〇·B）。

**目标：** 修复 TRTC 对话式 AI 数字人“字幕正常显示但无声音”的问题。

**问题判断：**
- 前端已能收到 AI 字幕/状态消息，但未在 `REMOTE_AUDIO_AVAILABLE` 后主动恢复远端音频订阅与播放。
- 后端默认 TTS 配置把 TRTC `SDKAppID` 作为 TTS `AppId` fallback，但腾讯 AI 对话文档中的 `tencent` TTS 要求单独配置 TTS `AppId`，容易导致 TTS 配置不正确但前端仍可看到字幕。

**修复内容：**
- `apps/kiosk/src/components/AiAdvisorCall.tsx`
  - 监听 `REMOTE_AUDIO_AVAILABLE` 后记录远端用户并调用 `muteRemoteAudio(userId, false)`、`setRemoteAudioVolume(userId, 100)`、`resumePlay()`。
  - `enterRoom` 显式开启 `autoReceiveAudio: true`，关闭 SDK 默认弹窗，由页面内“点击播放顾问语音”承接自动播放恢复。
  - 按 TRTC SDK v5 官方方式使用 `AUTOPLAY_FAILED` 事件的 `event.resume()` 恢复播放。
  - 修复 `resumePlay` 逻辑，自动对已记录的远端音频用户逐个恢复播放。
  - 增加本地朗读兜底：字幕已到但远端音量持续为 0 时，用浏览器 `speechSynthesis` 朗读字幕，避免现场继续无声。
  - 兜底朗读只处理数字人 `subtitle`，明确跳过用户语音转写 `transcription/asr/stt/user`，避免把对话人的声音再朗读出来。
- `services/api/src/trtc/trtc.service.ts`
  - `tencent` TTS 要求显式配置 `TRTC_TTS_APP_ID` 或 `TENCENT_APP_ID`，不再用 TRTC `SDKAppID` 兜底。
  - 保留 `TRTC_TTS_CONFIG_JSON` 原始 JSON 覆盖入口，方便后续接其他 TTS 服务商。
- `services/api/.env.example`
  - 补全 `tencent` TTS 环境变量示例，明确 TTS `AppId` 与 TRTC `SDKAppID` 不是同一个配置项。
- `apps/kiosk/vite.config.ts` / `apps/kiosk/.env.example`
  - Kiosk dev proxy 从写死 `localhost:3000` 改为可配置 `VITE_API_PROXY_TARGET`，默认对齐 API 示例端口 `http://localhost:3010`，确保 `/api/v1/trtc/session` 命中正确后端。
  - 本地 `.env.local` 调整为局域网友好模式：`VITE_API_BASE_URL=/api/v1` + `VITE_API_PROXY_TARGET=http://localhost:3010`，手机访问 `http://<Mac局域网IP>:5173` 时由 Vite 代理 API 请求。
- `services/api/src/main.ts`
  - API 默认端口从 `3000` 改为 `3010`，避免 `.env` 漏配 `PORT` 时与旧服务冲突，并与 Kiosk 代理默认值保持一致。

**验收：**
- `pnpm --filter ./apps/kiosk typecheck` ✅
- `pnpm --filter ./apps/kiosk lint` ✅
- `pnpm --filter ./apps/kiosk build` ✅
- `pnpm --filter ./services/api typecheck` ✅
- `pnpm --filter ./services/api lint` ✅
- `pnpm --filter ./services/api build` ✅

---

### ✅ Phase 9.3：AI 助手快捷操作增强（2026-06-01，feat/phase9-assistant-actions）

**目标：** 在已有数字人基础上，增强 AI 助手的快捷入口引导能力，常驻 7 个服务入口 + 关键词实时高亮。

**合规约束（本阶段必须遵守）：**
- 不新增语音/TTS/摄像头
- 不引入 3D/VRM
- actions 路由仍经过 `isAllowedRoute` 白名单过滤
- 不出现招聘闭环词；快捷按钮文案符合合规要求

**实现说明：**
- 7 个常驻快捷入口（始终可见，位于对话历史下方）：简历诊断 / 打印文件 / 扫描材料 / 查看岗位 / 查看招聘会 / AI 在青岛 / 人社专区
- `KEYWORD_ROUTES` 关键词映射表：输入文本实时匹配，高亮相关快捷按钮（`border-blue-400 bg-blue-50 scale-[1.03]`），无需发送 AI 请求
- AI 上下文建议（AI 返回 actions 时）：显示在常驻快捷入口上方，带 `ZapIcon` 标签 "AI 建议"，蓝色填充样式区分
- `/qingdao` 加入 `ALLOWED_ROUTE_PREFIXES` 白名单
- 布局调整：AI 上下文操作移至底部操作区（对话历史下方），不再夹在数字人和对话历史之间

**修改文件：**
- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`（commit `04d99d7`）

**bundle 体积：** 915KB raw / 272KB gzip（+22KB，引入 ZapIcon + KEYWORD_ROUTES 关键词表）

**验收（2026-06-01）：**
- `pnpm --filter ./apps/kiosk typecheck` ✅
- `pnpm --filter ./apps/kiosk lint` ✅
- `pnpm --filter ./apps/kiosk build` ✅
- 合规禁词扫描：仅 line 12 注释（合规约束说明，非渲染内容）✅
- `isAllowedRoute` 白名单：保留（line 152）✅
- 合规声明："内容仅供参考"/"不构成正式建议"：保留 ✅
- 快捷按钮文案合规：无"一键投递/立即投递/平台投递"✅

---

### ✅ Phase 9.2：轻量 SVG 数字人引导员（2026-06-01，feat/phase9-digital-human）

**目标：** 在 AI 助手页集成轻量 2D 数字人引导员，增强一体机引导体验。不做 3D/VRM，不新增语音/摄像头。

**合规约束（本阶段必须遵守）：**
- 数字人角色：求职服务引导员，不做招聘官、不做候选人筛选
- 不新增语音输入/摄像头/生物特征采集
- 不新增 WebGL / VRM / three.js 等重型依赖
- actions 路由仍经过 `isAllowedRoute` 白名单过滤

**实现说明：**
- 实现方式：纯 SVG + CSS `@keyframes` 动画，无第三方依赖（仅 react）
- 当前为纯 2D 轻量实现，不是 3D/VRM
- 状态机：`idle`（待机，呼吸动画）/ `talking`（说话嘴型 + 脉冲光晕）/ `greeting`（挥手点头，3 秒后归 idle）

**新增文件：**
- `apps/kiosk/src/components/DigitalHuman.tsx`（276 行，commit `ed7fdf3`）

**修改文件：**
- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`（commit `5ea16a7`）
  - 上半区：数字人 SVG + SpeechBubble 显示最新 AI 回复（截断 80 字）
  - 中部：最新 AI 消息的快捷操作按钮（`isAllowedRoute` 过滤不变）
  - 下半区：对话历史（移除逐条 BotAvatar，简化 ChatBubble）
  - 状态联动：发送→talking；收到→idle；首次进入→greeting

**bundle 体积：** 889KB（与 Phase 9.1 完全一致，SVG 内联，无额外网络请求）

**验收（2026-06-01）：**
- `pnpm --filter ./apps/kiosk typecheck` ✅
- `pnpm --filter ./apps/kiosk lint` ✅
- `pnpm --filter ./apps/kiosk build` ✅
- 合规禁词扫描：仅 line 11 注释（合规约束说明，非渲染内容）✅
- `isAllowedRoute` 白名单：保留（line 122）✅
- 合规声明："内容仅供参考"/"不构成正式建议"：保留（两处）✅
- 新依赖：无（`DigitalHuman.tsx` 仅 import react）✅

---

### ✅ Phase 9.1：Kiosk UI Polish（2026-06-01，feat/phase9-kiosk-ui-polish）

**目标：** 优化 Kiosk 前台 UI 一致性、视觉层级和触控友好度。不改业务逻辑，不改合规边界。

**改动清单：**

1. **`packages/ui/src/layouts/KioskLayout.tsx`**
   - 底部 Tab 激活状态：从纯颜色变更为 `bg-primary-50/70 text-primary-600`（背景高亮），触控屏更易识别

2. **`apps/kiosk/src/pages/home/HomePage.tsx`**
   - section 标题：`text-xs uppercase tracking-widest` → `text-sm font-medium`，更易在触控屏阅读
   - 三个次级服务卡片：添加 `iconBg`/`iconColor` props，差异化图标颜色（岗位=蓝、招聘会=绿、AI在青岛=青绿）
   - AI助手入口：从小文字链改为 `min-h-[56px]` 触控友好按钮卡片（含图标+双行说明+箭头）

3. **`apps/kiosk/src/pages/jobs/JobsPage.tsx`**
   - 使用 `LoadingState`/`ErrorState`/`EmptyState` 共享组件（统一风格）
   - 添加 retry 机制（`retryKey` state）
   - filter pill：`py-2` → `min-h-[48px]`，满足触控最小高度

4. **`apps/kiosk/src/pages/job-fairs/JobFairsPage.tsx`**
   - 同 JobsPage，使用共享状态组件 + retry + filter pill 高度修复

5. **`apps/kiosk/src/pages/jobs/JobDetailPage.tsx`**
   - loading/error 替换为 `LoadingState`/`ErrorState`

6. **`apps/kiosk/src/pages/job-fairs/JobFairDetailPage.tsx`、`FairCompaniesPage.tsx`、`FairMapPage.tsx`、`FairMaterialsPage.tsx`、`FairStatsPage.tsx`**
   - 全部内联 `加载中...` 文字替换为 `LoadingState`/`ErrorState`/`EmptyState`

**验收（2026-06-01）：**
- `pnpm --filter ./apps/kiosk typecheck` ✅
- `pnpm --filter ./apps/kiosk lint` ✅
- `pnpm --filter ./apps/kiosk build` ✅
- 合规禁词扫描：无违规（"去来源平台投递"/"不参与招聘闭环"均为合规正向文案）

---

### ✅ W8-P1：Redis E2E 验证（2026-06-01，feat/w8-redis-e2e-verification → main）

**目标：** 验证 W8 BullMQ API pull worker 在有 REDIS_URL 的真实队列模式下完整可运行。

**真实 Redis 验证结果（2026-06-01 通过）：**
```
Redis: redis://localhost:6379
── Test A: success path
  ✅ SyncLog.result = success
  ✅ addedCount = 2
  ✅ Job records in DB = 2
  ✅ reviewStatus=pending / publishStatus=draft
── Test B: failure path (HTTP 503 source)
  ✅ SyncLog.result = failed
  ✅ errorDetail set: HTTP_503: Service Unavailable
  ✅ No Job records written for failed sync
✅ ALL PASS
```

**Bug 修复（本次 E2E 发现）：**
1. `services/api/.env.example` 缺少 `REDIS_URL`（已补全）
2. `JobSyncModule` 未 import `AuthModule`，导致 `JwtAuthGuard`/`RolesGuard` 无法解析（已修复）
3. BullMQ job ID 不允许包含 `:`，`${sourceId}:manual` → `${sourceId}_manual`（已修复）
4. ts-node 安装损坏（pnpm store 条目缺 dist/）→ 改用 `@swc-node/register` + `node -r` 方式运行脚本（更快，支持 `emitDecoratorMetadata`）
5. pnpm-workspace.yaml `@swc/core: set this to true or false` → 改为 `true`

**脚本运行方式（从 `services/api/` 目录）：**
```bash
# 确认 Redis 运行中（本机 brew 已装）：
brew services start redis
# 确认 .env 有 REDIS_URL=redis://localhost:6379
pnpm verify:job-sync
```

**验收（2026-06-01）：**
- 真实 Redis `pnpm verify:job-sync` ✅ ALL PASS
- 全 monorepo `pnpm typecheck` ✅ 无错误

---

### ✅ W8：BullMQ API 拉取 worker（2026-06-01，feat/w8-bullmq-api-worker）

**目标：** 让 Partner 配置的 API 类型 JobSource 能按 syncFreq 周期性拉取外部岗位/招聘会数据，复用现有审核/发布/SyncLog 语义。

**基础设施：**
- `@nestjs/bullmq` + `bullmq` + `ioredis` 安装至 `services/api`
- `REDIS_URL` 已在 `.env.example` 存在；无 Redis 时 API 仍正常启动（fallback inline 模式）
- Prisma `JobSource` 新增 `responseConfig String?` 字段（migration `20260601110728`）
- `pnpm-workspace.yaml` 追加 `msgpackr-extract: true`

**新模块 `src/job-sync/`（5 个文件）：**
- `job-sync.types.ts`：`JOB_SYNC_QUEUE`、`ApiSyncJobData`、`JobSourceResponseConfig`、`SyncStats`、`SYNC_FREQ_THRESHOLD_MS`
- `job-sync.service.ts`：HTTP fetch + 凭证解密 + 响应解析 + 批内 externalId 去重 + Prisma.$transaction upsert + SyncLog + lastSyncAt 更新；支持 Job/JobFair 双类型
- `job-sync.processor.ts`：BullMQ Processor（有 Redis 时激活）
- `job-sync.scheduler.ts`：@Cron('0 */30 * * * *') 每 30 分钟调度 due sources
- `job-sync.controller.ts`：Admin only — `POST /admin/job-sync/sources/:id/trigger`（202+限流）、`GET /admin/job-sync/sources`
- `job-sync.module.ts`：条件注册 BullMQ（有 REDIS_URL）；无 Redis 时 service.enqueue() 走 setImmediate 直接执行

**AppModule 变更：**
- 导入 `BullModule.forRoot(parseRedisConnection(REDIS_URL))` + `JobSyncModule`（均条件注册）

**Admin 前端新页面 `/sync-sources`：**
- 列出所有 accessMode=api 的数据源：syncFreq、lastSyncAt、lastSyncStatus、配置完整性（URL/凭证/映射）
- "立即同步"按钮调用 `POST /admin/job-sync/sources/:id/trigger`
- mock 模式下模拟触发；http 模式下真实调用

**安全与可靠性：**
- 同一 sourceId：有 Redis 时 BullMQ jobId 去重（非 manual 用 sourceId 为 jobId）；无 Redis 时 inProgress Set 防重入
- 敏感字段：源 API 响应中出现敏感列名只记 warn 日志不 reject（因 API pull 走白名单字段映射，非敏感列自动忽略）
- 凭证只在服务端解密，`decryptSecret()` 失败立即 failed SyncLog
- HTTP 4xx/5xx/timeout 区分错误码写入 SyncLog.errorDetail
- 整批 $transaction：任一 upsert 失败 → 回滚 + failed SyncLog
- retry: 非 manual 最多 3 次，exponential backoff 1min/4min
- `reviewStatus / publishStatus` 更新时不覆写，防绕过审核

**responseConfig 格式：**
```json
{ "dataType": "job", "rootPath": "data.jobs", "fields": { "externalId": "id", "title": "position" } }
```
- `rootPath` 为空时 auto-detect（jobs/items/data/results/list/records）
- `fields` 为空时字段名与标准字段名一致（externalId/title/company/city/sourceUrl/salary/description/requirements/tags）

**验收（2026-06-01）：**
- API `tsc --noEmit` ✅ / `lint` ✅ / `build` ✅
- Admin `tsc --noEmit` ✅ / `lint` ✅ / `build` ✅（419KB）
- Partner `tsc --noEmit` ✅ / `lint` ✅ / `build` ✅（349KB）
- 合规禁词扫描 ✅（0 violations）
- API 启动时无 REDIS_URL 不 crash（inline fallback）

---

### 🔧 fix/w4-excel-import-integrity：Excel 导入闭环安全修复（2026-06-01）

**背景：** W4 Excel 导入闭环上线后，发现 5 项 P0/P1 安全风险，本次集中修复。

**Fix 1 — rawDataJson 隐私风险（P0）**
- `previewExcelImport`：不再持久化整行 rawData，`rawDataJson` 固定存 `'{}'`
- `ImportRecord` 只存已映射的 `mappedJson`，原始列（含未映射字段）不落库
- 一次性清理脚本：`services/api/scripts/clear-import-rawdata.ts`（已修正为 libsql adapter 方式，与 PrismaService 一致）
  - 运行方式：`DATABASE_URL=file:./prisma/dev.db ts-node scripts/clear-import-rawdata.ts`
  - dev DB 执行结果：已清理 0 条（dev 无历史记录，生产合入后执行清理）

**Fix 2 — 敏感列后端强校验（P0）**
- `excel-import.dto.ts`：新增 `SENSITIVE_COLUMN_PATTERNS`（手机号/邮箱/简历/候选人/姓名/面试/Offer 等）+ `isSensitiveColumn()` 工具函数
- `parseExcelColumns`：扫描 Excel 表头，命中敏感词 → 400（不落 rawDataJson）
- `previewExcelImport`：双层检测（原始表头 + fieldMapping 中选中的列名），命中 → 400

**Fix 3 — confirmExcelImport 状态可信（P0）**
- 走 Option A：整批 `prisma.$transaction()`，任一 upsert 失败 → 事务回滚
- catch 分支：`batch.status = 'failed'`（不写 SyncLog），抛 500
- 成功分支：写 SyncLog → `batch.status = 'confirmed'`（顺序有保证）

**Fix 4 — 同批 externalId 去重（P1）**
- `previewExcelImport`：新增 `seenInBatch = new Set<string>()`，逐行检测批内重复
- 批内出现第二次相同 externalId → status='dup'，不标记为 ok
- counts（added/updated/dup/error）已真实反映

**Fix 5 — Admin 批次审核上下文（P1）**
- `getPartnerSyncLogs`：添加 `include: { source: { select: { name: true } } }`，同步日志显示数据源名称（不再显示 UUID）
- `AdminJobDto`：新增 `sourceId?: string`，`prismaJobToAdminDto` 透传 Job.sourceId
- `AdminJobSourceRecord`：新增 `sourceId?: string`
- `import-batches/index.tsx`：查看按钮改为 `/job-sources?sourceId={b.sourceId}` 和 `/fair-sources?sourceOrgId={b.orgId}&batchLabel={b.fileName}`
- `job-sources/index.tsx`：读 `?sourceId=` URL 参数，按 `s.sourceId` 过滤 + amber banner
- `fair-sources/index.tsx`：读 `?sourceOrgId=` URL 参数，按 `s.sourceOrgId` 过滤 + amber banner

**验收（2026-06-01）：**
- API `tsc --noEmit` ✅（0 errors）
- Admin `tsc --noEmit` ✅（0 errors）
- Partner `tsc --noEmit` ✅（0 errors）
- API `lint` ✅（0 warnings）
- Admin `lint` ✅（0 warnings）
- Partner `lint` ✅（0 warnings）
- Admin `build` ✅（412KB，1.03s）
- Partner `build` ✅（349KB，924ms）
- API `build` ✅
- 合规禁词扫描 ✅（0 violations）

---

### 🔄 W7：Kiosk 真实文件上传 + 打印链路打通（2026-06-01，feat/w7-kiosk-file-upload）

**目标：** 打通「用户选文件 → /files/kiosk-upload → /print/jobs → Terminal Agent 打印 → Kiosk 轮询完成」完整链路。

**文件选择决策（A2 桌面验证模式）：**
- 当前 `PrintUploadPage` 使用 `<input type="file">` 仅在桌面 Chrome/Edge 下验证 E2E 链路
- 生产 Kiosk 切换 A1：Terminal Agent 监听本地/U 盘目录 → 推送文件列表 → Kiosk 轮询选取（后续分支）
- 页面已明确标注"桌面浏览器验证模式"提示 banner（`API_MODE=http` 时显示）

**signedUrl 策略（B1 过渡方案）：**
- Upload 返回 5-min 短 TTL signedUrl
- `POST /print/jobs` 创建时后端重新签发 30-min TTL，存入 PrintTask.fileUrl
- 避免 Terminal Agent claim 延迟导致下载时 URL 失效

**改动清单：**

**Terminal Agent `apps/terminal-agent/`：**
- `print-with-pdf-to-printer.ts`：新增 `mapParams()` — 把 `PrintJobParams` 映射到 `pdf-to-printer` `PrintOptions`
  - `colorMode=black_white` → `monochrome: true`
  - `duplex` → `side: simplex/duplexlong/duplexshort`
  - `orientation` → `portrait/landscape`（auto = 省略）
  - `scale=fit/actual` → `fit/noscale`
  - `copies`, `pageRange` → 直接传
  - 超时改为 `Promise.race` + `setTimeout` 真实 guard（之前 `timeout` 字段不在 `PrintOptions` 中无效）
- `print.ts`：移除 `eslint-disable @typescript-eslint/no-unused-vars`，`params` 真实传给 `printWithPdfToPrinter`

**后端 `services/api/`：**
- `print-jobs.service.ts`：新增 `extractFileIdFromSignedUrl()` + B1 re-sign 逻辑（30-min TTL）
- `print-jobs.controller.ts`：`POST /print/jobs` 新增 `@Throttle(10/min per IP)`

**Kiosk `apps/kiosk/`：**
- `src/services/files/filesApi.ts`（新建）：`kioskUploadFile(file)` → `POST /api/v1/files/kiosk-upload` → `KioskUploadResult`
- `PrintUploadPage.tsx`：A2 模式真实 `<input type="file">` 上传，上传 loading/error 显示，A2 模式 banner
- `PrintPreviewPage.tsx`：`PrintFile` 加 `fileMd5?`；缺 state 时（直接访问 URL）在所有 hooks 之后显示"重新上传"引导
- `PrintConfirmPage.tsx`：`PrintFile` 加 `fileMd5?`；`createPrintJob` 携带 `fileMd5`；API 失败改为显示 error banner（不再静默降级 sim 模式）
- `PrintProgressPage.tsx`：real 模式新增 5 分钟超时保护，超时显示"处理超时"页 + 任务编号 + 返回首页按钮

**验收（2026-06-01）：**
- Terminal Agent `tsc --noEmit` ✅（0 errors）
- API `tsc --noEmit` ✅（0 errors）
- Kiosk `tsc --noEmit` ✅（0 errors）
- 全局 `lint` ✅（0 warnings）
- Kiosk `build` ✅
- API `build` ✅
- 合规禁词扫描 ✅（0 violations）

---

### ✅ Excel 导入 → Admin 审核 完整闭环（2026-06-01）

**闭环链路：Partner 上传 Excel → ImportBatch 落库 → Admin 查看批次记录 → 跳转审核**

**后端新增：**
- `jobs.service.ts`：新增 `AdminImportBatchDto` 类型 + `getAdminImportBatches()` 方法（join JobSource.name + Organization.name）
- `jobs.controller.ts`：新增 `GET /admin/import-batches`（`@Roles('admin')`）

**Admin 前端新增：**
- `apps/admin/src/services/api/types.ts`：新增 `AdminImportBatch` 接口
- `apps/admin/src/services/api/adminMockAdapter.ts`：5 条 mock 批次（pending/confirmed/cancelled）
- `apps/admin/src/services/api/adminHttpAdapter.ts`：`getImportBatches()` → `GET /admin/import-batches`
- `apps/admin/src/services/api/sources.ts`：`AdminImportBatch` 导出 + `getImportBatches()` 服务函数
- `apps/admin/src/routes/import-batches/index.tsx`：新页面（状态/类型双维度筛选 + 搜索 + 分页 + "查看岗位/招聘会"跳转）
- `apps/admin/src/routes/index.tsx`：注册 `/import-batches` 路由
- `apps/admin/src/layouts/AdminLayoutWrapper.tsx`：侧栏"数据内容"分组新增"Excel 导入记录"菜单项

**Partner ExcelImportModal 状态说明：**
- UI 和 service layer 已完整（W4 已实现，HTTP adapter 已有真实 fetch 调用）
- `API_MODE='http'` 时直接对接后端 4 个端点（parse/preview/confirm/cancel），无需改动

**验收（2026-06-01）：**
- 后端 `tsc --noEmit` ✅（0 errors）
- Admin `tsc --noEmit` ✅（0 errors）
- Admin `lint` ✅（0 warnings，DataTable useTableState eslint-disable 注释修复）
- Admin `build` ✅（411KB，1.02s）

---

---

### ✅ W6：Kiosk 打印流程接入真实后端打印任务 API（2026-06-01）

**Commit：** `6703e7b` feat(w6): connect kiosk print flow to real backend print job API

**改动范围：**

**后端 `services/api/`：**
- 新增 `src/print-jobs/` 模块（DTO + service + controller + module）
- `POST /api/v1/print/jobs` — Kiosk 无鉴权提交打印任务，返回 `{ taskId, status, createdAt }`
- `GET  /api/v1/print/jobs/:taskId` — Kiosk 轮询任务状态，返回 `{ taskId, status, errorCode?, errorMessage?, completedAt? }`
- `fileMd5` 缺省时存 `''`（Terminal Agent 已实现：fileMd5 为空字符串则跳过文件完整性校验）
- `app.module.ts` 注册 `PrintJobsModule`

**Kiosk 前端 `apps/kiosk/`：**
- 新增 `src/services/print/printJobsApi.ts`：`createPrintJob()` / `getPrintJobStatus()` fetch 封装
- 所有 5 个打印页面的 `PrintFile` 接口新增可选 `fileUrl?: string` 字段
- `PrintUploadPage`：mock 文件加入 `fileUrl: '/api/v1/test/sample-visible.pdf'`
- `PrintConfirmPage`：`API_MODE=http` 且 `file.fileUrl` 存在时，先 `POST /api/v1/print/jobs` 获取 `taskId`，再 navigate 到 `/print/progress`；API 失败则降级为前端模拟；loading 状态 + 按钮禁用
- `PrintProgressPage`：完整双模式
  - **real 模式**（`API_MODE=http && taskId` 存在）：每 2s 轮询 `GET /api/v1/print/jobs/:taskId`；`pending/claimed` → 排队等待，`printing` → 打印中，`completed` → navigate done(success)，`failed` → navigate done(failure + errorMessage)；提交任务步骤在到达页面时已标记完成
  - **sim 模式**（无 taskId 或 mock 模式）：保留原 setTimeout 动画；dev 按钮"[DEV] 模拟失败"仅在 sim 模式出现

**合规验证（2026-06-01）：**
- 新增文件禁词扫描 ✅（0 violations）
- 无一键投递 / 一键打印 / 企业收简历等违规文案

**验收（2026-06-01）：**
- API `tsc --noEmit` ✅（0 errors）
- API `eslint` ✅（0 warnings）
- API `build` ✅
- Kiosk `tsc --noEmit` ✅（0 errors）
- Kiosk `eslint` ✅（0 warnings）
- Kiosk `build` ✅

> **W6 范围限定说明：**
> - 前端 PrintUploadPage 仍为 mock（无真实文件选择器），real 模式使用 `/api/v1/test/sample-visible.pdf` 作为演示文件
> - FairCompanyDetailPage（W5 企业详情）打印按钮生成虚拟 PrintFile（无 fileUrl），进入 sim 模式 — 真实企业资料 PDF 生成为未来任务
> - 奔图开放打印 API 对接（云打印彩色 mode）仍在 TODO 等厂家确认

---

### ✅ W5 第二阶段：打印企业资料 / 打印岗位清单按钮接入 Kiosk 打印 UI 流程（2026-06-01）

**Commit：** `ff84d4a` feat(w5): wire print profile/positions buttons to kiosk print flow

**改动文件：**
- `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`
- `apps/kiosk/src/pages/print/PrintDonePage.tsx`

**实现方式：**
- `FairCompanyDetailPage` 中 `ActionBar` 新增 `onPrintProfile` / `onPrintPositions` prop
- 点击"打印企业资料"：构造虚拟 `PrintFile`（名称=`企业名_企业资料.pdf`，页数=`1 + ceil(岗位数/8)`），携带 `returnUrl`/`returnLabel` state，navigate 到 `/print/preview`
- 点击"打印岗位清单"：构造虚拟 `PrintFile`（名称=`企业名_岗位清单.pdf`，页数=`ceil(岗位数/4)`），携带 `returnUrl`/`returnLabel` state，navigate 到 `/print/preview`
- 点击后进入完整打印 UI 链路：`/print/preview` → `/print/confirm` → `/print/progress` → `/print/done`
- `PrintDonePage` 新增 `returnUrl`/`returnLabel` 字段支持：打印成功后显示"返回{企业名}"按钮，替代默认"继续打印"；无 returnUrl 时行为不变

> **注意：** `PrintProgressPage` 当前仍为前端模拟进度（submitting → queuing → printing 动画），**尚未接入真实后端打印任务 API**（`/api/v1/print/jobs`）或 Terminal Agent print task。接入真实 API 为后续独立任务。

**合规验证（2026-06-01）：**
- 禁词扫描 ✅（0 violations）
- 按钮文案合规：打印企业资料 / 打印岗位清单

**验收（2026-06-01）：**
- Kiosk `tsc --noEmit` ✅（0 errors）
- Kiosk `eslint` ✅（0 warnings）
- Kiosk `build` ✅（1.36s）
- 合规禁词扫描 ✅（0 violations）

---

### 🔧 开发服务连接修复（2026-06-01）

- `apps/kiosk` / `apps/admin` / `apps/partner` 的 Vite dev server 统一监听 `0.0.0.0`
- 三端 Vite 配置开启 `strictPort`，避免端口占用时静默漂移导致浏览器 HMR 反复 `Reconnecting`
- 影响范围：仅开发服务连接稳定性，不改业务代码和页面 UI

---

### ✅ W5 第一阶段：招聘会企业详情页增强（2026-06-01）

**路由：** `/job-fairs/:id/companies/:companyId`（未变）  
**页面：** `apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx`（重写）  
**分支：** `feat/w5-enterprise-showcase`

**新增能力：**
- 顶部彩色渐变 Cover 区域：企业名 / 行业 / 展位号 / 荣誉标签（AwardIcon） / 岗位数+招聘人数
- 企业信息卡：成立年份 / 总部城市 / 注册资本 / 简介可展开（超 100 字折叠）/ 来源说明
- 四个操作按钮：**扫码投递 / 去来源平台投递 / 打印企业资料 / 打印岗位清单**（全部合规）
- 岗位筛选器：城市 / 学历 / 经验 / 岗位类型（全职/兼职/实习）+ 清除筛选
- 视图切换：列表模式（Card + 详情） ↔ 海报模式（2 列彩色卡片）
- 合规底部：applyNote + 不接收简历声明

**类型扩展（最小改动）：**
- `packages/shared/src/types/fairDto.ts`：`FairCompanyPositionDTO` 新增 `education / experience / location / positionType / department`；`FairCompanyDTO` 新增 `honorTags / coverImageUrl / founded / headquarters / registeredCapital`
- `apps/kiosk/src/types/fair.ts`：本地 `FairCompanyPosition` / `FairCompany` 同步扩展

**Mock 数据扩展：**
- `apps/kiosk/src/data/fairData.ts`：f1 全部 7 家企业补全新字段；c1-1（高新技术企业/专精特新）/ c1-2（中国500强/世界500强）荣誉标签
- `apps/kiosk/src/services/api/mockAdapter.ts`：`toCompanyDTO` 传递全部新字段

**合规验证（2026-06-01）：**
- 禁词扫描（一键投递 / 立即投递 / 企业收简历 / 候选人管理 / 面试邀约 / Offer 管理）✅ 全部通过
- 允许文案全部正确：扫码投递 / 去来源平台投递 / 打印企业资料 / 打印岗位清单
- 合规底部说明展示 ✅

**验收（2026-06-01）：**
- Kiosk `tsc --noEmit` ✅（0 errors）
- Kiosk `eslint` ✅（0 warnings）
- Kiosk `build` ✅（1.35s）
- 合规禁词扫描 ✅（0 violations）

**Commit：** `4880fa8` feat(w5): enhance fair company detail page with filters and poster view

**遗留 TODO（W5 第二阶段）：**
- 打印企业资料 / 打印岗位清单接入真实打印流程（当前为 `console.log` placeholder）
- 企业宣传视频播放支持（当前为行业渐变色封面占位）
- FairStatsPage 接真实展会统计数据
- 展位导览图点击弹出企业预览

---

**当前阶段：W4 数据源真实导入闭环 ✅（2026-06-01）— Phase 8 全部封板基线之上**

---

### ✅ W4 数据源真实导入闭环（2026-06-01）

**Gap 1 — GET /files/:id/url 安全加固：**
- `files.controller.ts`：加 `@CurrentUser()` + `@Req()`；每次调用写 `file.get_signed_url` 审计日志
- `files.service.ts`：`getSignedUrl` 加归属校验（admin 可访问任意文件；partner/kiosk 只能访问自己上传的文件）；返回值补 `purpose` 字段
- `file.types.ts`：`SignedUrlResponse` 补 `purpose: FilePurpose`

**Gap 2 — /partner/sync-logs 路由（后端）：**
- `schema.prisma`：新增 `SyncLog`、`ImportBatch`、`ImportRecord` 三个 Prisma 模型
- `prisma.service.ts`：暴露 `syncLog`、`importBatch`、`importRecord` getter
- `jobs.service.ts`：`getPartnerSyncLogs`、`writeSyncLog`（私有，import 后自动调用）
- `jobs.controller.ts`：`GET /partner/sync-logs`（@Roles('partner')）

**Gap 3 — Partner HTTP 导入契约修正：**
- `partnerHttpAdapter.ts`：`importPartnerJobs` / `importPartnerFairs` 去掉 `sourceOrgId`/`sourceName` 参数，body 只传 `{ items }`
- `partnerContent.ts`：接口签名同步更新
- `partnerMockAdapter.ts`：mock 函数同步更新

**Excel 字段映射 service 层接入：**
- 安装 `xlsx` 包（pnpm add）
- `dto/excel-import.dto.ts`：标准字段白名单（JOB / FAIR）、必填字段、ParsedRow 类型
- `jobs.service.ts`：`parseExcelColumns`（无 DB，仅返回列名+样例）、`previewExcelImport`（创建 ImportBatch + ImportRecord + 重复检测 + 白名单校验）、`confirmExcelImport`（upsert valid rows + 写 SyncLog）、`cancelExcelImport`
- `jobs.controller.ts`：`POST /partner/excel/parse`、`POST /partner/excel/preview`、`POST /partner/excel/:batchId/confirm`、`DELETE /partner/excel/:batchId`
- `types.ts`（partner）：新增 `ExcelPreviewResult`、`ExcelConfirmResult`、`ExcelPreviewRow`
- `partnerContent.ts`：新增 `parseExcel`/`previewExcel`/`confirmExcelImport`/`cancelExcelImport`
- `ExcelImportModal.tsx`：4 步向导（上传文件 → 字段映射 → 预览统计 → 确认导入）
- `sources/index.tsx`：字段映射按钮接入 ExcelImportModal

**验收（2026-06-01）：**
- `prisma db push` ✅ → SQLite dev.db 同步 3 个新表
- `prisma generate` ✅ → client 重新生成
- 后端 `tsc --noEmit` ✅（0 errors）
- Partner / Kiosk / Admin `tsc --noEmit` ✅（0 errors）
- 后端 `npm run lint` ✅（0 errors）
- Partner `npm run lint` ✅（0 errors）
- Admin lint 保持既有 1 warning（非本次引入）
- Partner `npm run build` ✅
- 后端 `npm run build` ✅

---

### ✅ AI在青岛专区（2026-06-01）

**新增文件：**
- `apps/kiosk/src/pages/qingdao/QingdaoPage.tsx`：5 tab 面板（青岛就业 / 青岛政策 / 青岛高校 / 青岛园区 / 青岛资讯）
- `apps/kiosk/src/routes/index.tsx`：注册 `/qingdao` 路由
- `apps/kiosk/src/pages/home/HomePage.tsx`：更多服务区由 2 列扩展为 3 列，新增 AI在青岛卡片

**页面内容（静态 mock 数据）：**
- 青岛就业：近期招聘会（3条）+ 重点企业岗位（5家）+ 应届生专属通道入口
- 青岛政策：就业补贴 / 人才政策 / 社保档案（可展开手风琴）
- 青岛高校：6所高校就业服务入口（中国海洋大学 / 青岛大学 / 中国石油大学 等）
- 青岛园区：4个产业园区（高新区 / 崂山软件 / 西海岸新区 / 蓝谷高新区）
- 青岛资讯：官方就业新闻 + 政策公告（6条带摘要）

**合规要求（全部满足）：**
- 所有岗位/招聘会按钮只用：查看岗位 / 查看招聘会 / 去来源平台投递 / 扫码预约 / 查看详情
- 禁止词（一键投递 / 平台投递 / 企业收简历）均未出现
- 页面顶部展示信息来源声明；页面底部展示合规免责说明
- 本系统不参与招聘/不接收简历/不代理办理政务

**验收（2026-06-01）：**
- Kiosk `tsc --noEmit` ✅（0 errors）
- Kiosk `npm run lint` ✅（0 errors）
- Kiosk `npm run build` ✅（built in 1.35s）

---

**V8.1C-4/5 + Mac 真实后端验证结果（保留历史基线）：**

| 验收项 | 结果 | 说明 |
|--------|:----:|------|
| V8.1C-3 断网重试（offline queue 注入→重试→清空） | ✅ | Prisma 本地后端验证 |
| V8.1C-4 单实例双进程（DUPLICATE_INSTANCE） | ✅ | 发现并修复 Windows EPERM Bug |
| V8.1C-5 服务安装/启动/卸载 | ✅ | 发现并修复 node-windows scriptOptions Bug |
| V8.1C-5 reboot 自启动（STATE:4 RUNNING 开机自动拉起） | ✅ | 真机重启验证 |
| V8.2B WMI（printerStatus=ready, diskFreeGB=158.98） | ✅ | 真实 Win32_Printer WMI 查询 |
| Prisma E2E（注册→心跳→claim→下载→MD5→打印→PATCH） | ✅ | 本机 Prisma SQLite 后端 |
| Mac 真实后端注册（terminalId=t_f77d716786118f78，DPAPI 加密） | ✅ | Windows→Mac 192.168.1.164:3000 跨机验证 |
| Mac API 重启后心跳持续 200（注册不丢失） | ✅ | Prisma 持久化确认，terminalId 跨重启有效 |
| Mac 离线期间 task-claim 自动重试（retry 1→2→3→恢复） | ✅ | 离线重试机制跨机验证 |

**发现 Bug（已修复并提交）：**
- `instance-lock.ts`：EPERM 分支用 mtime 5分钟阈值 → 长运行 Agent 被误判为过期锁，允许双实例。修复：改用 `tasklist /FO CSV` 精确判断进程存活。
- `index.ts`：`args:['agent']` 设置 node.exe flags 而非脚本参数 → 服务启动时显示 help 退出。修复：改为 `scriptOptions:'agent'`。

---

### ✅ Phase 8.1D E2E 打印链路封板（2026-05-28）

> Phase 8.1C 新增能力（DPAPI/SQLite/PID锁/断网重试/服务安装）代码完成，macOS 冒烟通过。  
> **Phase 8.1D E2E 验证：register→claim→download→MD5→print→PATCH→出纸完整链路通过；DPAPI 加密和 SQLite 幂等在正常流程中得到确认。**  
> 断网重试专项测试、单实例双进程测试、Windows 服务专项测试（安装/重启自启/卸载）→ Phase 8.2C。

**Phase 8.1D E2E 打印链路验证结果（terminalId=t_d41f29b91ee78467）：**

| 验收项 | 结果 |
|--------|------|
| 注册成功（DPAPI 加密 agentToken，config.json 无明文 token） | ✅ |
| 心跳成功（30s 间隔，持续确认） | ✅ |
| Claim ptask_seed_001（5 min 过期自动重置，Agent 重新 claim） | ✅ |
| 文件下载（proxy:false，8ms，0.9 KB） | ✅ |
| MD5 校验通过 | ✅ |
| PATCH status=printing | ✅ |
| PDF Method B 打印，耗时 783ms | ✅ |
| PATCH status=completed | ✅ |
| 临时文件删除 | ✅ |
| SQLite 写入 completed，无 pending_patches | ✅ |
| **Pantum CM2800ADN Series 真实出纸（用户确认）** | ✅ |
| 断网重试专项验证 | ⏳ Phase 8.2C |
| 单实例双进程专项验证 | ⏳ Phase 8.2C |
| Windows 服务安装/重启/卸载专项验证 | ⏳ Phase 8.2C |

**新增能力（`apps/terminal-agent/src/agent/`）：**

| 能力 | 文件 | 状态 |
|------|------|------|
| DPAPI 加密 agentToken（LocalMachine scope，stdin 传参，macOS 明文降级） | `src/agent/dpapi.ts` | ✅ |
| SQLite 任务状态持久化（restart 幂等，重启不重复打印） | `src/agent/db.ts` | ✅ |
| 单实例 PID 文件锁（ESRCH 僵尸锁检测，DUPLICATE_INSTANCE exit 1） | `src/agent/instance-lock.ts` | ✅ |
| 断网 PATCH 重试队列（60s 轮询，指数退避，max 10 次，4xx 放弃） | `src/agent/offline-queue.ts` | ✅ |
| Windows 服务安装/卸载（`node install-service` / `uninstall-service`） | `src/index.ts` | ✅ |
| adminSecret 注册后从 config.json 清除 | `src/agent/config-manager.ts` | ✅ |
| Phase 8.1B plaintext agentToken 自动迁移到 DPAPI 加密文件 | `src/agent/config-manager.ts` | ✅ |
| patchStatus() 返回 boolean（失败时入离线队列） | `src/agent/task-runner.ts` | ✅ |
| 重启幂等检查（isTaskDone + markTaskDone before PATCH） | `src/agent/task-runner.ts` | ✅ |
| version 0.2.0 → 0.3.0；依赖新增 better-sqlite3 + node-windows | `package.json` | ✅ |

**macOS 冒烟测试结果：**
- `instance-lock: acquired` ✓  
- `db: opened $TMPDIR/AIJobPrintAgent/agent.db` ✓  
- `dpapi: 非 Windows 环境，agentToken 以明文存储（仅用于开发）` ✓  
- DUPLICATE_INSTANCE exit(1) 正确触发 ✓  
- SQLite 幂等检查 isTaskDone/markTaskDone 往返 ✓  
- 离线队列 enqueuePatch/getPendingPatches/markPatchAttempt 往返 ✓  

---

### ✅ Phase 8.1B 已完成（2026-05-27）

> Agent 侧 + 后端接口全部实现，**Windows 真机端到端联调全部通过**。  
> 链路：register → heartbeat → claim → download → MD5 → print → PATCH completed ✅  
> 真机验证：terminalId=t_42eb7ea04e09e3b3，打印耗时 670ms，Pantum CM2800ADN Series 真实出纸。

**Agent 侧（`apps/terminal-agent/src/agent/`）：**

| 能力 | 文件 | 状态 |
|------|------|------|
| Agent 配置加载 | `src/agent/config-manager.ts` | ✅ |
| 类型定义（AgentConfig/ClaimTask/HeartbeatPayload 等） | `src/agent/types.ts` | ✅ |
| HTTP 客户端（axios + 5xx 重试 + 脱敏日志） | `src/agent/api-client.ts` | ✅ |
| 终端注册（POST /auth/terminal/register） | `src/agent/registration.ts` | ✅ |
| 心跳上报（PUT /terminals/:id/heartbeat，每 30s） | `src/agent/heartbeat.ts` | ✅ |
| Claim 循环（POST /terminals/:id/tasks/claim，每 5s） | `src/agent/task-runner.ts` | ✅ |
| 文件下载 + MD5 校验 | `src/agent/task-runner.ts` | ✅ |
| 调用统一 print()（Phase 8.1A） | `src/agent/task-runner.ts` | ✅ |
| PATCH /print-tasks/:id/status（printing/completed/failed） | `src/agent/task-runner.ts` | ✅ |
| 临时文件 try/finally 清理 | `src/agent/task-runner.ts` | ✅ |
| `agent` CLI 命令（src/index.ts） | `src/index.ts` | ✅ |
| config/agent-config.json 排除 git | `.gitignore` | ✅ |
| typecheck 0 errors / build 通过 | — | ✅ |

**后端（`services/api/src/terminals/`）：**

| 能力 | 文件 | 状态 |
|------|------|------|
| POST /auth/terminal/register（in-memory + agentToken） | `terminals.service.ts` | ✅ |
| PUT /terminals/:id/heartbeat（Bearer 鉴权） | `terminals.service.ts` | ✅ |
| POST /terminals/:id/tasks/claim（原子 claim，5 min expire） | `terminals.service.ts` | ✅ |
| PATCH /print-tasks/:id/status（状态机 + 幂等） | `terminals.service.ts` | ✅ |
| GET /test/sample.png（1×1 PNG mock 文件端点）+ GET /test/sample-visible.pdf（可见 PDF 样本） | `terminals.controller.ts` | ✅ |
| 种子任务 ptask_seed_001（fileUrl→`/api/v1/test/sample-visible.pdf`，fileMd5 匹配） | `terminals.service.ts` | ✅ |
| Claim 过期自动重置（setInterval 30s + unref） | `terminals.service.ts` | ✅ |
| DTOs（register/heartbeat/claim/patchStatus） | `dto/` | ✅ |
| TerminalsModule 注册 + AppModule 接入 | `terminals.module.ts` | ✅ |
| typecheck 0 errors | — | ✅ |

**Phase 8.2 补完状态（从 Phase 8.1C/D 延续）：**
- Prisma 持久化（服务端任务状态落库）→ Phase 8.2A 已完成
- printerStatus / diskFreeGB 真实 WMI 查询 → Phase 8.2B 已完成；`diskFreeGB` 已落库到 `TerminalHeartbeat.diskFreeGb`
- actionToken HMAC 签发 → 已在 claim 响应实现；local-api-server 消费校验后续补齐
- lease 续租（`PATCH /terminal-tasks/:id/lease`）→ 未实现，长任务/扫描任务前补齐
- 断网重试/单实例/服务安装专项真机验证 → Windows 已推进，通过结果以 `next-tasks.md` 最新记录为准

---

**Phase 8.1A 收口确认（2026-05-27）：**

| 验收项 | 状态 |
|--------|------|
| JPG → pdfkit → Method B → 真实出纸（882ms） | ✅ |
| PNG → pdfkit → Method B → 真实出纸（553ms） | ✅ |
| 临时 PDF 打印后自动删除 | ✅ |
| DOCX / BMP 正确拒绝（UNSUPPORTED_FILE_TYPE） | ✅ |
| TypeScript typecheck 0 错误 | ✅ |

**Phase 4 加固封板确认（2026-05-25，无剩余 M1/M2 阻塞项）：**

| 加固项 | 状态 |
|--------|------|
| mock 数据抽离至 data/externalSources.ts | ✅ |
| 详情页刷新/直达容错（state 缺失时 mock 查找） | ✅ |
| QR overlay 增强（来源机构/外部编号/手机引导） | ✅ |
| 合规词修正："录用率" → "招聘结果" | ✅ |
| 禁用招聘闭环功能检查（无候选人/投递/HR 等） | ✅ |

---

## 三、优先级任务列表

### P0（MVP 核心）

- [x] 新建正式项目（monorepo 结构）
- [x] 建立设计系统（颜色/字体/按钮/卡片/状态标签规范）
- [x] 完成一体机首页
- [x] 完成打印扫描核心流程（打印 5 页 + 扫描 4 页，含失败路径和重试）
- [x] 完成管理员后台基础框架
- [x] 完成岗位/招聘会外部来源展示逻辑（合规展示）

### P1（重要功能，第二批）

- [x] AI简历服务（上传、解析、诊断、优化、打印）
- [ ] 文件自动清理机制
- [ ] 打印任务状态实时追踪
- [ ] 合作机构后台（岗位/招聘会数据管理）
- [ ] 数据源同步功能

### P2（扩展功能，有时间再做）

- [ ] Windows Terminal Agent 开发
- [ ] 奔图打印机接口对接
- [ ] 扫描目录监听
- [ ] 告警中心
- [ ] 数据统计报表

---

## 四、各阶段完成情况

| 阶段 | 名称 | 状态 |
|------|------|------|
| 第 0 阶段 | 项目初始化 | ✅ 完成封板 |
| 第 1 阶段 | 设计系统 | ✅ 完成 |
| 第 2 阶段 | 公共组件 | ✅ 完成 |
| 第 3 阶段 | 一体机前台 | ✅ 完成封板 |
| 第 4 阶段 | 岗位和招聘会信息 | ✅ 完成 |
| 第 5 阶段 | 管理员后台 | P0/P1 全部完成（9页），P2/P3 页面待填充 |
| 第 6 阶段 | 合作机构后台 | P0 完成（6页）+ Excel 导入向导 MVP，P1 待填充 |
| 第 7 阶段 | 后端 API | Phase 7.6–7.10 ✅（Provider 骨架/AI Chat UI/Admin AI 管理页/接口闭环/岗位招聘会真实 API）；真实 Provider / Prisma 持久化待开发；`pnpm audit` ✅ 已完成，0 vulnerabilities |
| 第 8 阶段 | Windows Terminal Agent | ✅ **Phase 8 全部封板（2026-05-29）**：Phase 8.0 Spike / 8.1A–D 出纸 / 8.2A Prisma 跨机 / 8.2B WMI / 8.2C 安全加固 + 全部 Windows 真机验收通过；actionToken local 校验/lease 续租长任务前补齐 |
| 第 9 阶段 | UI Polish / Kiosk 视觉升级 + AI数字人 | 🚧 **进行中**：AI 数字人语音通话 + 文字对话已完成（`/assistant`，TRTC「小青」，见 §〇·B）；Kiosk/Admin/Partner 视觉收口仍在推进 |

---

## 五、Phase 3 封板记录（2026-05-25）

### 完成内容

| 模块 | 页面数 | 路由 |
|------|--------|------|
| 打印流程 | 5 | /print/upload → preview → confirm → progress → done |
| 扫描流程 | 4 | /scan/start → settings → progress → result |
| AI简历服务 | 5 | /resume/source → parse → report → optimize → export |
| 我的记录 | 1 | /profile |

### 数据状态

- 全部为 mock 数据 + `location.state` 传递，本阶段不接后端
- DEV 模拟失败按钮均通过 `import.meta.env.DEV` 隔离，生产 build 不包含

### 验收结果

- pnpm lint：✅ 0 warnings
- pnpm typecheck：✅ 0 errors
- pnpm build：✅ 三端均通过
- P1 白屏修复：`ResumeReportPage if (!report) return null` 改为错误引导页 ✅
- 合规词全文审查：一键投递/立即投递/HR查看/候选人/录用率等均未出现 ✅

---

## 六、Phase 4 完成记录（2026-05-25）

### 完成内容

| 模块 | 页面 | 路由 |
|------|------|------|
| 岗位列表 | JobsPage | /jobs |
| 岗位详情 | JobDetailPage | /jobs/:id |
| 招聘会列表 | JobFairsPage | /job-fairs |
| 招聘会详情 | JobFairDetailPage | /job-fairs/:id |

### 类型扩展

- `packages/shared/src/types/job.ts` 新增 `ExternalJob`、`ExternalJobFair`、`JobFairStatus`
- 所有外部数据类型继承 `ExternalJobSource`，强制包含：`sourceOrgId`、`externalId`、`sourceName`、`sourceUrl`、`syncTime`、`reviewStatus`、`publishStatus`

### 合规边界执行情况

| 检查项 | 结果 |
|--------|------|
| 按钮文案：查看详情 / 去来源平台投递 / 扫码投递 | ✅ |
| 按钮文案：去来源平台预约 / 扫码预约 | ✅ |
| 无"一键投递"/"立即投递"/"投递简历" | ✅ |
| 无"候选人"/"HR 查看"/"推荐给企业" | ✅ |
| 每个岗位/招聘会展示来源机构、同步时间、外部ID | ✅ |
| 页面内合规说明文案（不参与招聘流程） | ✅ |
| "去来源平台投递"以扫码形式模拟（Kiosk 不支持直接跳转外链） | ✅ |

### 验收结果

- pnpm lint：✅ 0 warnings
- pnpm typecheck：✅ 0 errors
- pnpm build：✅ 三端均通过

---

## 七、Phase 7 前端已知结构性风险（Phase 6.5 复查记录）

以下差异在前端 mock 阶段可接受，**Phase 7 后端 API 设计时必须解决**，不建议在前端写 adapter 临时掩盖。

| # | 涉及位置 | 差异描述 | Phase 7 解决方向 |
|---|---------|---------|-----------------|
| R1 | admin/job-sources + admin/fair-sources 本地接口 | 缺少 `sourceUrl`、`sourceOrgId`、`description`、`tags`、`requirements` 字段 | ✅ **Phase 7.10 已解决**：AdminJobSourceRecord/AdminFairSourceRecord 补全所有字段；adminMockAdapter 数据对齐 |
| R2 | partner/jobs + partner/fairs 本地接口 | 缺少 `sourceName` 字段 | ✅ **Phase 7.10 已解决**：PartnerJobRecord/PartnerFairRecord 新增 `sourceName`；mock 数据已补全 |
| R3 | partner/sync-logs 本地 `SyncLog` 接口字段命名不一致 | 字段命名不同：`successCount`/`addedCount`、`failCount`/`errorCount`、`result`/`status` | ✅ **Phase 7.10 已解决**：PartnerSyncLog 字段已重命名为 `addedCount`/`errorCount`/`status`；sync-logs 页面已对齐 |
| R4 | partner/sources `DisplaySource` 接口与 `DataSourceConfig` 不对齐 | 完全自定义视图模型，不对应任何 shared 类型 | 📋 **延至 Phase 7.11**：不在本期 jobs/fairs 主链路内，单独处理 |

---

## 八、正确开发节奏

```
干净架构 → 设计系统 → 核心页面 → 后端 API → 打印机对接 → 上线测试
```

不要跳过设计系统直接写页面。  
不要在旧秒哒项目里继续堆功能。  
不要一次性想完成所有功能。

---

## 九、更新记录

| 日期 | 更新内容 | 操作人 |
|------|---------|--------|
| 2026-05-23 | 建立项目文档体系（CLAUDE.md + 4 个文档） | Claude Code |
| 2026-05-23 | 整理目录结构，新增 AGENTS.md、README.md、ai-collaboration-rules.md、next-tasks.md，compliance 文档移至独立目录 | Claude Code |
| 2026-05-23 | 补充跨平台运行要求：CLAUDE.md 新增第 17 节、README.md 新增平台说明、新建 terminal-agent-windows.md | Claude Code |
| 2026-05-23 | 第 0 阶段完成：pnpm monorepo 初始化，三端 app 可运行，packages/ui 和 packages/shared 已创建，lint/typecheck/dev 全部通过 | Claude Code |
| 2026-05-23 | Phase 0 修复：Button 触控尺寸修正、forwardRef、.env.example、三端引用 ui/shared、tsconfig.node.json 修复、构建产物清理、pnpm build 通过 | Claude Code |
| 2026-05-23 | Codex Phase 0 复审收尾：补 .gitattributes、路径别名、StatusBadge 无障碍语义、Vite/Esbuild 安全升级，lint/typecheck/build/audit 均通过 | Codex |
| 2026-05-23 | 提交前清理：移除 .DS_Store 和 zip 出 git 索引，补 *.zip gitignore 规则，全部检查通过，Phase 0 正式封板 | Claude Code |
| 2026-05-23 | Phase 1 设计系统基建：tokens.css(@theme)、cn()工具、cva重构Button/Card/StatusBadge、Spinner/EmptyState/LoadingState/ErrorState、KioskLayout/AdminLayout/PartnerLayout，lint/typecheck/build全通过 | Claude Code |
| 2026-05-24 | Phase 1 视觉验证修复：三端 index.css 补 `@source "../../../packages/ui/src"` 指令，修复 Tailwind v4 不扫描 workspace 包导致样式全部缺失的问题，截图确认三端布局/颜色/组件均正常 | Claude Code |
| 2026-05-24 | Phase 2 完成：Admin 14路由、Partner 10路由、Kiosk /policy 路由及首页按钮接线；路由结构统一（router→routes/index.tsx，布局→layouts/），App.tsx 薄包装；Fast Refresh warning 修复；废弃 settings 路由删除；Playwright 截图验收全部通过 | Claude Code |
| 2026-05-24 | Phase 3 打印流程完成：PrintUploadPage→PreviewPage→ConfirmPage→ProgressPage→DonePage，含成功/失败/重试路径；DEV 模拟失败按钮；CONTROL_FIELDS 黑名单重试；Mavis 视觉修复；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 扫描流程完成：ScanStartPage→SettingsPage→ProgressPage→ResultPage，4 页扫描流程，含类型选择/参数配置/进度/结果；DEV 模拟失败；黑名单重试；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-24 | Phase 3 AI简历服务完成：ResumeSourcePage→ParsePage→ReportPage→OptimizePage→ExportPage，5 页流程；合规说明；DEV 模拟失败；ProfilePage 整合承接；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 3 封板：P1白屏修复（ResumeReportPage return null → ErrorState），lint/typecheck/build 全通过，合规词审查通过，推送 GitHub main | Claude Code |
| 2026-05-25 | Phase 4 完成：JobsPage+JobDetailPage+JobFairsPage+JobFairDetailPage，ExternalJob/ExternalJobFair 类型扩展，合规边界执行，lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 4 加固：mock 数据抽离至 data/externalSources.ts；详情页刷新/直接访问 fallback 到 mock 查找；QR overlay 增加来源机构/外部编号/"请使用手机前往来源平台办理"；ResumeReportPage "录用率"→"招聘结果"合规修正；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 5 Admin P0/P1 全部完成（9页）：Dashboard/Terminals/Orders/Printers/JobSources/FairSources/Partners/Alerts/Files；Alerts 双维度筛选（级别×状态）+标记处理中/已解决；Files 三维度筛选+高敏感风险提示+手动删除/立即清理+合规说明；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6 Partner P0 完成（6页）：Dashboard（8指标卡+最近同步记录）、Profile（机构资料+绑定终端+权限范围）、Jobs（岗位管理+类型/审核双筛选+二维码/下架操作）、Fairs（招聘会管理+预约二维码/打印/下架）、Sources（数据源管理+连接状态+启用停用）、SyncLogs（同步日志+异常字段+重试）；合规说明全覆盖；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | 外部数据源类型体系收口：packages/shared 统一 ReviewStatus/PublishStatus/SourceKind/AccessMode/AuthType；DataSourceType 拆分为 sourceKind×accessMode 双维度；DataSourceAccess 移除 apiKey，加 credentialConfigured；新增 ImportBatch/ImportRecord/FieldMappingRule/MappingValidationError；更新 external-data-source-design.md 和 CLAUDE.md §18；externalSources.ts 修正 reviewStatus 值；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6 Excel 导入向导 MVP：Sources 页新增 ExcelImportWizard 4 步向导（基本信息→模拟上传→字段映射→导入预览），使用 FieldMappingRule/ImportBatch/ImportRecord 共享类型，AUTO_SUGGEST 自动预填映射，5 个必填字段校验，7 条 mock 记录（5 ok/1 invalid/1 dup）；合规说明全覆盖；Fast Refresh 安全（命名组件模块级定义）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6.5 数据链路一致性复查（第一轮）：①4 个文件本地 ReviewStatus 补全 'reviewing'；②4 个文件本地 PublishStatus 补全 'draft'/'expired'；③更新对应 REVIEW_MAP/PUBLISH_MAP/REVIEW_FILTERS/counts；④admin job-sources/fair-sources handleApprove 修正为 →draft（正确流程：pending→reviewing→approved/draft→published），新增 handlePublish 操作；⑤admin 两个文件 sourceOrg 字段重命名为 sourceName（与 ExternalJobSource.sourceName 一致）；⑥mock 数据增加 reviewing/draft/expired 状态样本；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | Phase 6.5 数据链路一致性复查（第二轮）：①partner/fairs reserveUrl → sourceUrl（与 ExternalJobSource.sourceUrl 一致，招聘会预约链接即 sourceUrl）；②partner/fairs + admin/fair-sources fairStatus → status（与 ExternalJobFair.status 一致，FairStatus 类型名保留）；记录4项 Phase 7 结构性风险（见下节）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | 统一合作机构类型系统（Phase 6.5+）：新增 packages/shared/src/types/partner.ts，定义 PartnerType(5)/SceneTemplate(3)/EnabledModule(9)/PROHIBITED_MODULES(5)/PartnerCoopStatus/PublicServiceLevel/PartnerSceneConfig/PartnerProfile/SCENE_DEFAULT_MODULES/全部展示标签常量；admin/partners 页面重写使用共享类型（双维度筛选+场景模板+启用模块列）；partner/profile 页面重写为 public_employment_service mock，展示"场景与模块配置"卡片（启用模块 chips + 永久禁用模块合规说明）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-25 | 招聘会服务数字化模块：新增 packages/shared/src/types/fair.ts（FairCompany/FairZone/FairBooth/FairMaterial/FairLiveStats 等类型及标签常量）；kiosk 5个新页面（FairCompaniesPage+FairCompanyDetailPage+FairMapPage+FairMaterialsPage+FairStatsPage）+5个新路由；JobFairDetailPage 新增"现场服务"子导航（参会企业/展馆导览/活动资料/现场数据）；admin 新增"招聘会管理"页面（fair-sources 旁独立入口，5 tab：企业/展位/资料/统计，含 Excel 导入入口）；fairData.ts mock 数据含 f1/f2 两场完整数据；合规：系统仅记录浏览/扫码/打印/签到，不接收简历，不做候选人管理；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | 新增 AI数字人引导员需求规划：docs/product/ai-avatar-guide.md，明确 Phase 9 执行轻量 3D 就业服务引导员路线（Three.js/VRM/GLB、TTS、嘴型、intent router、AI助手融合、面试训练后置）；同步 next-tasks.md Phase 9 规划；合规约束：不做人脸识别、不保存音视频、不向企业推送简历/面试结果、不做招聘闭环 | Codex |
| 2026-05-26 | Phase 7.4 Admin Service Layer：job-sources/fair-sources 从内联 mock 改为 service/adapter 模式；新建 adminMockAdapter.ts + adminHttpAdapter.ts + sources.ts；6 个 service 文件全部 ✅；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.5 Partner Service Layer：partner jobs/fairs/sync-logs 页面内联 mock 清除；新建/扩展 partnerMockAdapter.ts + partnerHttpAdapter.ts + partnerContent.ts；7 个 service 文件全部 ✅；4 个页面全部走 service 层；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.4+7.5 Service Layer 复查：输出 docs/reviews/phase7-service-layer-review.md；合规词 8 项全部 CLEAN；文档补全（api-client-adapter.md、current-progress.md、next-tasks.md）；记录 R1–R4 结构性风险（Phase 7.6 API 设计时解决）；lint 0 warnings / typecheck 0 errors / build ✅（admin 369KB / partner 337KB / kiosk 409KB） | Claude Code |
| 2026-05-26 | Phase 7 AI Service Layer（前端）完成：新增 packages/shared/src/types/ai.ts（8 种类型）；新增 aiMockAdapter + aiHttpAdapter + ai.ts（4 个服务函数）；改造 ResumeParsePage/ResumeReportPage/ResumeOptimizePage（mock 数据移出页面层，通过 submitResumeParse/getResumeRecord/getResumeOptimize 获取）；新增 docs/product/ai-provider-integration.md；API Key 只在服务端，前端类型不含凭证；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7 AI Service Layer 文档收口：api-v1-design.md 补充 §8 AI 助手（POST /assistant/chat + 会话历史）、§9 AI 服务用量统计（GET /admin/ai/usage + logs）、AI 错误码（AI_TASK_NOT_FOUND/AI_QUOTA_EXCEEDED/AI_RATE_LIMITED）；current-progress.md + next-tasks.md 更新；合规检查：所有"候选人/面试邀约"等词均在禁止/声明语境中，无功能入口 | Claude Code |
| 2026-05-26 | Phase 7.6 后端 AI Provider 骨架：services/api NestJS 结构初始化；AiProvider 接口；MockAiProvider（完整实现）；OpenAI/Claude/Local/Qwen/Zhipu stub（NotImplementedException）；4 个 AI 接口（/resume/parse /resume/records/:id /resume/records/:id/optimize /assistant/chat）；AiLogService（只记元数据，禁止记简历内容）；未知 AI_PROVIDER 启动抛异常、task 不存在返回 AI_TASK_NOT_FOUND、DTO @IsNotEmpty+@MaxLength 补强；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.7 AI 助手页面接 service：AssistantPage 完整重写为 chat UI（消息列表/加载动画/输入框/发送/错误气泡）；接入 chatWithAssistant() mock/http adapter；sessionId localStorage 持久化（kiosk restricted mode 容错）；actions 路由白名单过滤（/resume/ /print/ /scan/ /jobs /job-fairs /policy）；http 失败显示错误气泡不 fallback；底部免责"不构成正式建议"；cancelledRef 防 unmount setState；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.8 Admin AI 服务管理页：admin/ai-services 页面完成；8 指标卡（调用量/成功率/平均延迟/三类操作量/失败数/估算费用）；失败原因统计；操作类型+状态双维度筛选日志表；mock 数据只含元数据（无简历内容/聊天原文）；底部合规说明"AI 日志仅记录元数据"；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 7.9 Admin AI 接口闭环：后端新增 GET /admin/ai/usage（聚合统计：总量/成功率/平均延迟/按操作分布/错误码分布）和 GET /admin/ai/logs（元数据列表，limit 参数，上限 500）；AiLogService 新增 getUsage()/getLogs()，record() 自动写入 createdAt；前端新建 adminAiMockAdapter/adminAiHttpAdapter/aiUsage service layer；Admin AI 服务页从内联 mock 改为 useEffect + service layer（含 LoadingState/ErrorState）；API 文档 sk-... 改为 <server-only-secret>；pnpm lint/typecheck/build 全通过（0 errors 0 warnings） | Claude Code |
| 2026-05-26 | Phase 7.10 后端岗位/招聘会真实 API：后端 JobsModule（DTOs/Service/Controller）14 个接口（Kiosk 4/Admin 6/Partner 6）；审核流 pending→reviewing→approved+draft，发布流 draft→published→unpublished，PUBLISH_REQUIRES_APPROVAL 保护；Kiosk 只展示 approved+published；Partner 导入默认 pending+draft；Admin R1 字段补全（sourceUrl/sourceOrgId/tags/description/requirements）；Partner R2 sourceName 补全、R3 字段重命名（addedCount/errorCount/status）；admin wrapper 方法保持兼容（approveJobSource→reviewJobSource）；R4 延至 Phase 7.11；pnpm lint/typecheck/build 全通过 | Claude Code |
| 2026-05-26 | Phase 8 Windows Terminal Agent 设计文档 v1.0：docs/device/windows-terminal-agent-design.md（10 节完整设计：定位/核心能力/模块划分/7 API/打印流程/扫描流程/安全/Windows 兼容性/MVP/10 项风险；MVP Phase 8.1 = 注册+心跳+打印+扫描+文件上传+Windows服务；技术选型：Node.js 20 + DPAPI） | Claude Code |
| 2026-05-26 | Phase 8 设计文档 v1.1：补充双进程架构（Service + User Session Helper，Named Pipe + ACL）；local-api-server 安全重设计（删除无鉴权、localAuthToken 查询类、actionToken 动作类、HMAC+nonce+expiresAt 防重放、403 返回规范）；GET /tasks → POST /api/v1/terminals/:terminalId/tasks/claim（原子 lease，claimedBy+claimExpiresAt，崩溃后超时重新领取）；临时文件路径全文统一为 %ProgramData%\AIJobPrintAgent\temp\（ACL 仅 Agent 服务账号/管理员）；单实例 Windows Mutex；Phase 8.0 技术验证清单 15 项（含 Named Pipe/TWAIN/actionToken/claim lease/打包方案对比/DPAPI/断网幂等/单实例 Mutex）；风险清单扩展至 R12；打包方案对比（pkg/nexe/electron-builder/.NET wrapper）| Claude Code |
| 2026-05-26 | Phase 8 设计文档 v1.2（审计补充）：新增 §4.8 actionToken 签发接口（POST /api/v1/terminals/:id/action-tokens，body: action/taskId，response: actionToken/expiresAt/nonce）；新增 §4.9 claim lease 续租接口（PATCH /api/v1/terminal-tasks/:id/lease，body: claimedBy/extendSeconds，response: ok/newExpiresAt 或 LEASE_RENEW_FAILED）；Named Pipe ACL 细化（明确禁止 Everyone/Users/Authenticated Users，仅允许 Service SID + Helper SID + BUILTIN\Administrators）；§2.4 claim 补充续租机制（最多 3 次，总 lease 20 分钟，超限 LEASE_RENEW_FAILED） | Mavis |
| 2026-05-26 | Phase 7.10 收口复查：6 项检查全部通过——① Kiosk 双重过滤（approved+published）✅；② 状态机（approve→approved+draft，PUBLISH_REQUIRES_APPROVAL，publish≠approve）✅；③ Partner 导入硬编码 pending+draft，4 个必填字段均有 @IsNotEmpty 校验✅；④ 所有 DTO 无 apiSecret/accessToken/clientSecret/password✅；⑤ 违规功能词全文扫描 CLEAN（仅出现于合规注释/说明文案）✅；⑥ lint 0 warnings / typecheck 0 errors / build ✅（admin 387KB / partner 338KB / kiosk 418KB）；1 个次要观察：approve 对已发布记录重复调用会将 publishStatus 重置为 draft（边缘场景，正常流程不可达）| Claude Code |
| 2026-05-27 | Phase 8.0.1/8.0.2 图片打印补充验证完成：QA-1 PDF Method B 真实出纸✅；QA-2/QA-3 Method A JPG/PNG 假成功（exitCode=0 但未出纸，Windows 11 Photos app PrintTo verb 问题）；mspaint /pt 排除（mspaint.exe 不存在）；Phase 8.1 图片路径确定为 pdfkit→临时 PDF→Method B；可进入 Phase 8.1 MVP | Claude Code |
| 2026-05-27 | Phase 8.0 V01–V15 验证清单执行完成（Windows 11 + Node.js v24 + pnpm 10 + Pantum CM2800ADN Series USB）：V01–V11 全部 PASS；Method A/B 均可用（PDF/JPG/PNG）；错误码 FILE_NOT_FOUND/PRINTER_NOT_FOUND/UNSUPPORTED_FILE_TYPE 均正确；WMI 正常/Unknown 状态可读；V12 PARTIAL（小文件 spooler 过快）；V13 PARTIAL（WorkOffline=True→PrinterStatus=2）；V14 待物理缺纸测试；V15 PASS；config.ts DEFAULT_PRINTER 修正为 `Pantum CM2800ADN Series`；**Phase 8.1 可启动** | Claude Code |
| 2026-05-27 | Phase 8 打印链路 API/文档对齐：① PrintJobParams.pageRange 从 `'all'\|string` 改为 `pageRange?: string`（缺省=全部，4 处对齐：shared/types/print.ts / PrintPreviewPage / PrintConfirmPage / terminal-agent/types）；② api-v1-design.md 新增 §5.3（POST /api/v1/print-tasks PrintTaskCreateDto + GET /api/v1/print-tasks/:taskId）、§4.3 /tasks/claim 响应完整 params: PrintJobParams（9 字段，替代旧 4 字段 options）、标注旧 POST /print/orders 字段 colorMode:"bw\|color"/duplexMode 为过时命名；③ windows-terminal-agent-design.md §4.3 claim 响应 options→params（9 字段）、新增 §5.1 打印机状态检测（Phase 8.0 WMI Spike 目标表 + Phase 8.1 打印任务状态机）；④ local-print-spike.md 新增 V12–V15（Get-PrintJob/Win32_Printer 离线缺纸/UNKNOWN_PRINTER_STATUS）、Phase 8.1 状态机说明 | Claude Code |
| 2026-05-27 | Phase 8.1B Windows 真机端到端联调全部通过：terminalId=t_42eb7ea04e09e3b3，register→heartbeat→claim→download(0.9KB)→MD5✓→PATCH printing→PDF Method B 打印→PATCH completed，耗时 670ms，Pantum CM2800ADN Series 真实出纸；temp file 自动删除；Phase 8.1B 正式封板 | Claude Code |
| 2026-05-27 | Phase 8.1B 后端联调全部完成：新建 TerminalsModule（terminals.service.ts + terminals.controller.ts + terminals.module.ts + 4 个 DTO），实现 POST /auth/terminal/register、PUT /terminals/:id/heartbeat、POST /terminals/:id/tasks/claim（原子 claim + 5min 过期自动重置）、PATCH /print-tasks/:id/status（状态机 + 幂等），GET /test/sample.png（1×1 PNG 种子文件）；种子任务 ptask_seed_001 在服务启动时写入；app.module.ts 接入 TerminalsModule；冒烟测试全部通过（register→heartbeat→claim→PATCH printing/completed 幂等 PATCH 均返回 200）；typecheck 0 errors；修复 import type 导致 whitelist: true 剥离 DTO 字段的 bug（改为 value import） | Claude Code |
| 2026-05-27 | Phase 8 设备名称/Provider分层修正：① CLAUDE.md §3 打印机型号更新为奔图 CM2800/CM2820 系列（Windows 识别名 `Pantum CM2800ADN Series`），新增硬件能力 vs 开放 API 能力对比表、Pantum 签名算法（MD5）、云打印架构说明；② PrintJobParams 新增可选字段 collate/paperType/feeder（共享类型+Agent类型同步），colorMode cloud TODO 注释；③ windows-terminal-agent-design.md 全文 CM2820ADN→CM2800ADN/CM2820ADN系列，新增 §12 Provider/Executor 分层（LocalAgentDispatchProvider/PantumCloudDispatchProvider/LocalPrintExecutor/三种 Executor）；④ 新建 docs/device/pantum-api-design.md（签名算法/PrintJobParams映射/预留接口/7项未解决问题）；⑤ current-progress.md 打印机型号记录更新 | Claude Code |
| 2026-05-27 | Phase 8.1B 真机联调前置修正：新增 `GET /api/v1/test/sample-visible.pdf` 可见 PDF 样本，`ptask_seed_001` 改指向该样本并重新以同一 Buffer 计算 `fileMd5`；Agent 下载相对 `fileUrl` 时按 `apiBaseUrl` 补全服务端 origin，避免 Windows 访问本机 localhost；claim 过期清理定时器增加 `unref()`；`@ai-job-print/api` 与 `terminal-agent` typecheck 通过，服务层 register→heartbeat→claim→PATCH completed 冒烟通过；Windows 真机出纸待沙箱外执行 | Codex |
| 2026-05-28 | Phase 8.1C/D Windows 真机 E2E 全部通过封板（含物理出纸确认）：① `api-client.ts` + `task-runner.ts` 新增 `proxy: false`（根因：Windows `http_proxy` 环境变量 Clash/v2ray 劫持所有 axios 请求，导致注册超时 30s×3 + 下载卡住）；② `task-runner.ts` 新增 `resolveFileUrl()`（处理 backend 返回相对 fileUrl）；③ Windows 真机完整链路：terminalId=t_d41f29b91ee78467，claim→download(8ms,0.9KB)→MD5✓→PATCH printing✓→PDF Method B→783ms→PATCH completed✓→temp file deleted；④ 本地 SQLite `print_tasks` 写入 completed，无 pending_patches（PATCH 成功）；⑤ DPAPI token 持久化跨重启复用，无需重新注册；**⑥ Pantum CM2800ADN Series 真实出纸（用户确认）✅** | Claude Code |
| 2026-05-28 | Phase 8.2C 安全加固：修复 10 个 bug（P0: 3 个，P1: 4 个，P2: 3 个）— wmi.ts PowerShell 注入、claim 竞态、TOCTOU、权限校验、printing 超时、spawnSync 阻塞、EPERM 僵尸锁、seed 任务重置、timeout 注释、markTaskDone 异常 | Mavis |
| 2026-05-29 | Phase 8 封板 — Mac 真实后端跨机 E2E 验证全部通过：① Windows Agent 向 Mac 192.168.1.164:3000 注册成功（terminalId=t_f77d716786118f78），DPAPI 加密 agentToken，adminSecret 自动清除；② Prisma 持久化确认：Mac API 重启后心跳持续 200，terminalId 不丢失；③ 离线期间 task-claim 自动重试（retry 1→2→3→恢复），ptask_seed_001 幂等跳过（restart-idempotency）；④ 全部 Phase 8 Windows 真机验收项完成（V8.1C-3 断网重试 / V8.1C-4 单实例 EPERM Bug 修复 / V8.1C-5 服务安装 scriptOptions Bug 修复 / reboot 自启动 / WMI printerStatus=ready,diskFreeGB=158.98）；Phase 8 正式封板，下一步 Phase 9 | Claude Code |

| 2026-05-29 | Admin 后台 UI Polish：新增 DataTable.tsx 组件（Pagination/useTableState/FilterPills）；7 个 Admin 页面（Terminals/Orders/JobSources/FairSources/Partners/Alerts/Files）全部添加分页器+全局搜索+EmptyState；URL params 支持（?page=1&pageSize=20）；lint/typecheck/build 全通过 | Claude Code |
| 2026-05-29 | Design System 补充修复：packages/ui 内 gray-* 残留（Button.tsx/PageHeader.tsx/KioskLayout.tsx/Spinner.tsx/StatusBadge.tsx/Card.tsx/AdminLayout.tsx）全部替换为 neutral-*，保留 tokens.css 中已有 neutral-* 映射；lint/typecheck/build 全通过 | Mavis |
| 2026-05-29 | UI/UX 设计审查 P0 — Kiosk HomePage 大瘦身（622→209 行，删 DynamicServicePanel/RenshiZoneBanner/SERVICE_PATH 胶囊/我的记录卡/PrimaryServiceCard subActions）；Admin Dashboard 去彩色卡背景，砍 6 张今日指标小卡改为 3 列待办行动面板；Partner jobs 删导入按钮、徽章降级；删占位 /policy 路由；commit cb58bd5 | Claude Code |
| 2026-05-29 | UI/UX B0+A+F — Partner 类型层 sourceType → SourceKind × AccessMode 双维度对齐（types/Mock/adapter 全部迁移）；Admin 合并 terminals + printers + peripherals 为 /devices Tab；users/permissions/audit 占位升级为表格骨架；commit bdf7c5e | Claude Code |
| 2026-05-29 | 后端 0a 鉴权骨架 — JwtAuthGuard + RolesGuard + @Roles 装饰器 + @CurrentUser；POST /auth/login 硬编码 3 dev 账号；RequestId 中间件（X-Request-Id 透传）；统一错误体 {code, message, requestId, details?}；shared UserRole 对齐为 admin\|partner\|kiosk；commit c17e264 | Claude Code |
| 2026-05-29 | 后端 0b Prisma schema + seed + DB-backed auth — 一次 migration 落 4 model（Organization/User/JobSource/Job），合规硬约束（externalId/sourceOrgId/sourceUrl/sourceName 必填；@@unique(sourceOrgId, externalId)；reviewStatus 默认 pending；publishStatus 默认 draft）；seed.ts 2 orgs + 3 bcrypt users + 6 jobs 覆盖审核状态组合；AuthService DEV_USERS 替换为 prisma.user.findUnique + bcryptjs.compare；commit 1916bbe | Claude Code |
| 2026-05-29 | 后端 #5 Partner importJobs 落 Job 表 + 全局 forbidNonWhitelisted — @Roles('partner') + sourceOrgId 强制 from JWT + sourceName 反查 Organization；prisma.job.upsert(@@unique) 幂等，重导只刷展示字段不改审核/发布状态；main.ts ValidationPipe forbidNonWhitelisted: true 全局拒绝 body 注入（候选人/邮箱/电话/简历等合规边界外字段从静默剥离 → 400 拒绝）；9 条烟测全过；commit c9a3113 | Claude Code |
| 2026-05-29 | 后端 #4+#2 端到端链路打通 — Job 加 reviewedBy/reviewedAt/rejectReason 审计字段；packages/shared 下沉 ReviewAction/PublishAction 契约；ValidationPipe 错误体改 code=VALIDATION_FAILED + details 字段路径；#2 getPublishedJobs 切 prisma.job（where approved+published）；#4 reviewJobSource/publishJobSource 切 prisma + 状态机（终态不可回退/reject 必填 reason/publish 前必 approved/reject 强制 draft）；admin 端点全 @Roles('admin')，partner 端点全 @Roles('partner') 且 sourceOrgId 强制 from JWT；内存数组 SEED_JOBS/SEED_FAIRS/this.jobs/this.fairs 全砍；fair 路径暂返空 + FAIR_NOT_IMPLEMENTED（留 Phase #3）；17 条烟测全过；commit 86db1f5 | Claude Code |
| 2026-05-29 | Phase #4+#2 端到端 demo 验证通过 — A：CLI trace 9 步链路（partner1 上传 → admin approve → admin publish → Kiosk 看到）+ 4 条合规红线复测（partner 用 admin 接口 403、未审直接发布 400、candidate 字段注入 400、reject 无 reason 400）；B：API 加 CORS（dev 任意 origin），Kiosk dev server 设 VITE_API_MODE=http VITE_API_BASE_URL=http://localhost:3010/api/v1，浏览器访问 http://localhost:5173 → 一体机首页 → 岗位信息列表 → 5 条真后端数据正常渲染（含 demo 注入的 DEMO-2026-001 "AI 算法工程师 @ 某 AI 实验室"），详情页字段映射全部正常 | Claude Code |
| 2026-06-01 | W3 Partner 数据源管理页三轨入口收口（API / Webhook / Excel）：SourceConnectPanel 走统一服务层 createDataSource()，三种接入方式落同一数据模型；client.ts 新增 API_ORIGIN（基于 VITE_API_BASE_URL 推导），webhookUrl 拼接改为 resolveWebhookUrl() helper，移除 `window.location.origin.replace(':5175', ':3000')` 字符串硬编码；合规边界：只接岗位/招聘会展示字段，Webhook secret 仅一次性显示，credential type=password，导入默认 pending+draft；pnpm --filter partner lint/typecheck/build 全通过（337.16 kB） | Claude Code |
| 2026-06-01 | W3 端到端 demo 验证（Partner→Webhook→Admin→Kiosk）：12 步链路全过 — partner1 登录 → POST /partner/data-sources(accessMode=webhook, credentialConfigured=true, webhookSecretOnce 一次性返回) → HMAC 签名推送 → admin 登录 → GET /admin/job-sources 见 pending/draft → PATCH review approve(→approved/draft) → PATCH publish(→published) → Kiosk GET /jobs 看到岗位；防重放 401 / 错签名 401 / 候选人字段注入 400 / 后续 GET 不再回显 webhookSecret(credentialConfigured=true 持久标志保留) 全部通过 | Claude Code |
| 2026-06-01 | W8 BullMQ API pull worker 完成（feat/w8-bullmq-api-worker）：@nestjs/bullmq + bullmq + ioredis 安装；Prisma JobSource 新增 responseConfig String?（migration 20260601110728）；src/job-sync/ 模块 5 文件（types/service/processor/scheduler/controller/module）；Cron 每 30min 调度 due sources（hourly/daily/weekly）；POST /admin/job-sync/sources/:id/trigger（202，JWT+Admin，Throttle 10/min）+ GET 列表；Admin /sync-sources 页面（配置完整性徽章 + 立即同步）；无 REDIS_URL 时 inline setImmediate fallback；BullMQ jobId 去重+inProgress Set 并发保护；$transaction 整批原子；凭证只服务端解密；reviewStatus/publishStatus 更新不覆写；SyncLog 成功/失败记录（api syncMode）；API/Admin/Partner tsc+lint+build ✅，合规禁词 ✅（0 violations） | Claude Code |
| 2026-06-01 | Phase 7.11 R4 — Partner Sources 类型对齐 packages/shared：①shared/types/job.ts SyncFrequency 加 'weekly'(原 realtime/hourly/daily/manual 不够覆盖 UI 已有 weekly 选项)、新增 ConnStatus / PartnerDataSourceView(DataSourceConfig 的 UI 投影,扁平、只读、不含敏感字段、保留 credentialConfigured + webhookSecretOnce 语义)；②apps/partner types 改为别名 PartnerDataSource = PartnerDataSourceView, CreateDataSourcePayload.authType 用 shared AuthType, 同时把 FieldMappingRule/MappingValidationError/ImportBatch/ImportRecord/DataSourceConfig re-export 出来供 Excel 映射 UI 后续使用；SyncFreq 保留为 @deprecated 别名;③services/api jobs.service.ts PartnerDataSourceDto 对齐 PartnerDataSourceView 字面量(sourceKind/accessMode/syncFreq/connStatus 不再裸 string)，SSOT 注释指向 shared；UI 行为零变化(只是 FREQ_LABELS 增加 realtime 文案兜底)；端到端 demo 复跑通过、forbidden 字段 GET 不回显校验通过；pnpm -r typecheck/lint/build 全通过 | Claude Code |
| 2026-06-03 | Dev server HMR `Reconnecting` 修复：三端 Vite 配置显式设置 HMR WebSocket 为 `ws://127.0.0.1:{5173,5174,5175}`，避免浏览器推断到 `0.0.0.0` 或错误端口后反复重连；补齐 admin/partner `ImportMeta.env` 类型声明。验证：kiosk/admin/partner typecheck 全通过；kiosk 本地浏览器打开 `http://127.0.0.1:5173`，控制台显示 `[vite] connected.`，无 Reconnecting。 | Codex |
| 2026-06-07 | 记录阶段开发与 UI/UX 节奏原则：后续功能先做到功能可用、流程跑通、测试通过、合规文案正确；功能稳定后做基础 UX 修正；多个核心功能稳定后再集中做 UI/UX 设计、视觉体验、触控屏布局和 AI 数字人引导收口。同步更新 next-tasks.md。 | Codex |

---

## 十二、Design System 修复记录（2026-05-29）

### gray-* → neutral-* 补充替换

**问题**：packages/ui 内部分组件残留 gray-* 未替换，违反 tokens.css 中 neutral-* 统一色板规范。

**替换文件（共 7 个文件，14 处）：**

| 文件 | 替换内容 | 替换值 |
|------|---------|--------|
| `Button.tsx` | secondary / ghost / outline variants | gray-* → neutral-* |
| `PageHeader.tsx` | border / title / subtitle | gray-* → neutral-* |
| `KioskLayout.tsx` | header border / nav border / icon color | gray-* → neutral-* |
| `Spinner.tsx` | border color | gray-200 → neutral-200 |
| `StatusBadge.tsx` | default status | gray-100 / gray-600 → neutral-* |
| `Card.tsx` | border | gray-200 → neutral-200 |
| `AdminLayout.tsx` | icon color / hover states | gray-* → neutral-* |

**验证结果**：pnpm lint 0 errors / typecheck 0 errors / build 全通过

> 每次完成开发任务后，请更新本文档的任务清单和更新记录。

---

## 十一、Phase 8.0 本地打印 Spike（2026-05-26）

### 目标

在 Windows 主机上验证 Terminal Agent 能否稳定把本地文件打印到奔图 CM2800ADN/CM2820ADN 系列（Windows 识别名：`Pantum CM2800ADN Series`），不接云端、不接 Kiosk。

### 创建内容

| 文件 | 说明 |
|------|------|
| `apps/terminal-agent/package.json` | Node.js 项目，commander + pdf-to-printer |
| `apps/terminal-agent/tsconfig.json` | TypeScript strict 配置 |
| `apps/terminal-agent/src/index.ts` | CLI 入口：`print` / `list-printers` 命令 |
| `apps/terminal-agent/src/config.ts` | 默认打印机名称、支持格式、超时配置 |
| `apps/terminal-agent/src/logger.ts` | 带时间戳的控制台日志 |
| `apps/terminal-agent/src/printer/types.ts` | PrintResult / PrintErrorCode / PrinterInfo 类型 |
| `apps/terminal-agent/src/printer/printer-status.ts` | PowerShell Get-Printer 列举和检查打印机 |
| `apps/terminal-agent/src/printer/print-with-powershell.ts` | Method A：Start-Process -Verb PrintTo |
| `apps/terminal-agent/src/printer/print-with-pdf-to-printer.ts` | Method B：pdf-to-printer（SumatraPDF）|
| `apps/terminal-agent/samples/README.md` | 测试文件说明和命令示例 |
| `apps/terminal-agent/.gitignore` | 保护测试文件不被提交 |
| `docs/device/local-print-spike.md` | 完整验证清单（V01–V11）和方法对比 |

### 错误码

`PRINTER_NOT_FOUND` / `FILE_NOT_FOUND` / `UNSUPPORTED_FILE_TYPE` / `PRINT_COMMAND_FAILED` / `PRINT_TIMEOUT` / `UNKNOWN_PRINT_ERROR`

### 两种方法

| | Method A | Method B |
|---|---|---|
| 机制 | PowerShell Start-Process -Verb PrintTo | pdf-to-printer / SumatraPDF |
| PDF | 待确认（Windows 11 未物理测试）| ✅ 真实出纸（QA-1 确认）|
| 图片 | ❌ 假成功（exitCode=0 但不打印）| N/A（不支持；用 pdfkit 转 PDF 后再 Method B）|

### Phase 8.0.1/8.0.2 实机验证收口（2026-05-27）✅

- **QA-1 Method B PDF 真实出纸 ✅**（557ms，`Pantum CM2800ADN Series`）
- **QA-2/3 Method A JPG/PNG 假成功 ❌**（exitCode=0 但纸未出，根因：Windows 11 Photos app PrintTo verb 不触发打印）
- **mspaint /pt 方案排除 ❌**（Windows 11 无 mspaint.exe）
- **图片打印路径已确定**：pdfkit 生成临时 PDF → Method B → 打印完成删除临时文件

V01–V11 全部 PASS（11/11）；V05 真实出纸 ✅；V03/V04 假成功 ❌；V12 PARTIAL；V13 PARTIAL；V14 待测；V15 PASS。

### Phase 8.1A Local Print MVP 已完成（2026-05-27）✅

- 目标：统一 `print(file, printerName, params)` 函数
- PDF → Method B 直接打印
- 图片（.jpg/.png）→ pdfkit 临时 PDF → Method B → 删除临时文件
- BMP/TIFF → Phase 8.1B（需 sharp 预处理）
- printerName 从 `DEFAULT_PRINTER` 配置读取，不硬编码

### PR-D 诚实化/合规 UI（2026-06-05，`feature/honesty-compliance-ui-clean`，基于干净 main `e354108`）

从 `feature/kiosk-honesty-admin-dashboard` 救回「诚实化/合规 UI」，**不整体合并旧分支**，只精取 2 个 commit：

- ✅ cherry-pick `9a82957`：Kiosk 简历「优化版」导出改为诚实文案（1 文件，零冲突）。
- ✅ 手术提取 `b7896c3`（`cherry-pick -n` 后剔除）：把无后端写入端点的「假写」按钮统一改为 `disabled + tooltip`，新增 Admin/Partner mock 模式全局横幅（`VITE_API_MODE!=http` 时显示）+ 两份 `.env.example`。共保留 11 个 UI/env 文件：
  - Admin：`Page.tsx`（mock 横幅）、`orders`（退款）、`partners`（停用/启用·配置场景）、`alerts`（处理）、`dashboard`（处理）、`.env.example`
  - Partner：`Page.tsx`（mock 横幅）、`fairs`（导入/新增）、`jobs`（新增/编辑）、`dashboard`（立即同步）、`.env.example`
- 🚫 **丢弃 terminals 改动**：`apps/admin/src/routes/terminals/index.tsx` 在 main 已重写为接真后端（`AdminTerminalRecord` + load/重试），旧 mock 假写版会回退真接线，已恢复 main 版本。
- 🚫 丢弃 `b7896c3` 内 `current-progress.md` / `next-tasks.md` 旧文档 hunk，仅保留本段新记录。
- 范围护栏：本次 diff 不含 files 接真 / W0 schema / 工作台 KPI 接真 / LLM guard / TRTC controller；这些另走 PR-E 等后续单独 PR。
