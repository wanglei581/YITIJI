# 岗位匹配匿名授权 Kiosk 闭环设计

## 目标

让带有效匿名简历访问令牌的用户在 `/resume/job-fit` 被后端拒绝 `JOB_FIT_ANONYMOUS_CONSENT_REQUIRED` 后，能够看见明确用途、留存与撤回说明，自主授权，并仅重试其刚才选择的一次岗位匹配分析。

## 已确认事实

- 后端已提供 `POST /resume/job-fit/consent`、`GET /resume/job-fit/consent/:taskId`、`DELETE /resume/job-fit/consent/:taskId`；三者只接受 `x-resume-access-token`。
- 匿名分析在 consent、配额、会话和 LLM 之前 fail-closed；会员分析仍使用既有 `job_ai` consent。
- 当前 Kiosk 页面把匿名和会员 consent 的 403 当成普通错误，匿名用户无法继续。
- 既有候选提交 `9d38e18d` 是可借鉴素材，但页面会增至 512 行，且未基于最新 `origin/main` 重新验证，不能直接合并。

## 方案比较

1. 收到匿名 403 后自动调用授权接口再重试：实现最短，但没有明确同意，不可采用。
2. 每次点击分析前预授权：增加无必要请求，且会把隐私选择与实际分析意图分离，不推荐。
3. 后端拒绝后展示显式授权弹窗，确认后只重试原始输入一次；独立读取授权状态并在页面提供撤回：保留后端 fail-closed 语义，避免无意授权，且授权与撤回同等可达。采用此方案。

## 交互与数据流

1. 会员继续调用原分析接口；若收到 `USER_AI_CONSENT_REQUIRED`，页面说明原因并引导至既有 `/jobs` 授权入口，不写匿名 consent。
2. 匿名用户先调用原分析接口。仅当响应是 `403 + JOB_FIT_ANONYMOUS_CONSENT_REQUIRED` 且当前没有会员 token、存在访问令牌时，保存这一次 `JobFitRequest` 到内存并打开弹窗。
3. 点击“暂不授权”只清除内存待重试请求，不调用 API。点击“同意并继续”才以 `x-resume-access-token` 调用授权接口；成功后关闭弹窗并对该内存请求重试一次。不会自动循环重试。
4. 匿名页面独立读取授权状态，不能把会员 Bearer 透传到 consent 接口。授权激活时，在选择态和结果态都显示至少 48px 的撤回入口。
5. 撤回只调用既有 DELETE 接口，阻止后续分析；界面明确说明已有报告仍按简历诊断到期策略保存，不能暗示撤回会删除数据。
6. 令牌始终沿用既有 `sessionStorage` 最小会话态；不写入 localStorage、日志、路由 query 或错误提示。

## 文件边界

- 修改：`apps/kiosk/src/services/api/jobFit.ts`、`apps/kiosk/src/pages/resume/JobFitPage.tsx`、`apps/kiosk/scripts/verify-job-fit-m1-5-ui.mjs`、`.github/workflows/ci.yml`、`docs/progress/current-progress.md`、`docs/progress/next-tasks.md`。
- 新建：`apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentDialog.tsx`、`apps/kiosk/src/pages/resume/jobFit/AnonymousJobFitConsentCard.tsx`。
- 不涉及：后端路由/数据库/schema/migration、共享 API 契约、终端 Agent、支付/订单/打印行为、外部投递、Admin/Partner、新路由或新依赖。

## 验收

- RED：现有 M1.5 前端 verify 新增匿名 consent 约束后必须在当前 `origin/main` 失败。
- GREEN：verify 锁定 consent API 只发送匿名令牌、403 分流、显式同意后仅一次重试、取消不授权、授权状态读取、撤回入口及合规文案；API 打印守卫加入既有 CI job。
- 回归：Kiosk typecheck、lint、production build、M1.5 前端 verify、AI 产物 URL verify、API job-fit print/governed-job-fit verify，以及 1080x1920 本地浏览器无脚本错误。
- 非验收范围：预生产部署、真实 LLM、确认页、支付、物理出纸与 Windows/Pantum 真机。
