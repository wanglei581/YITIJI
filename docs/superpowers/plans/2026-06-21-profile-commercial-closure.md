# 我的页商用闭环收口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan. Do not start runtime implementation from this planning branch; each implementation task must use its own clean branch/worktree and complete dual-model review before merge.

**Goal:** 将「我的页商用闭环」从泛化目标收口为三个可独立验收的工程任务：先拆分超阈值 Profile 页面，再补齐 AI 服务记录明细页，最后打通打印订单到意见反馈的关联入口。

**Architecture:** 保留现有 monorepo 与 `/profile` 信息架构。「我的」页继续只做入口和概览，明细归位到 `/me/*` 页面；后端 `/api/v1/me/*`、Admin 管理面、Prisma 模型和 verify 脚本保持复用，不新建后端模型或支付/招聘闭环能力。

**Tech Stack:** React + Vite + TypeScript + Tailwind CSS + shadcn/ui + lucide-react；NestJS API + Prisma；现有 `pnpm` workspace 和服务级 verify 脚本。

---

## Current-State Audit

- 已完成且不得重复开发：我的权益、消息通知、意见反馈、权益活动、打印订单只读页、我的文档、我的收藏、浏览/外部跳转记录、AI 记录后端和删除级联。
- 真实缺口 1：`apps/kiosk/src/pages/profile/ProfilePage.tsx` 当前 595 行，超过 `.ccg/spec/guides/index.md` 的 500 行评估阈值，后续不能继续堆新逻辑。
- 真实缺口 2：「AI服务记录」入口当前指向 `/assistant`，但真实记录 API 是 `GET /api/v1/me/ai-records`，Kiosk 只有 `getMyAiRecords` client 和概览统计，没有 `/me/ai-records` 页面。
- 真实缺口 3：反馈后端和 client 已支持 `relatedPrintTaskId`，并由后端校验本人打印订单归属；但 `MyPrintOrdersPage` 没有反馈入口，`MyFeedbackPage` 没有从 URL 参数预填和提交 `relatedPrintTaskId`。

## Branch 1: `codex/profile-page-split`

**Objective:** 纯结构拆分 `ProfilePage`，为后续小功能改动取得准入条件。

**Allowed Files:**

- Modify `apps/kiosk/src/pages/profile/ProfilePage.tsx`
- Add `apps/kiosk/src/pages/profile/profileEntries.ts`
- Add `apps/kiosk/src/pages/profile/profileTypes.ts`
- Add `apps/kiosk/src/pages/profile/components/ProfileHeader.tsx`
- Add `apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx`
- Add `apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx`

**Non-Goals:**

- 不改变视觉、布局、文案、入口分组、路由和统计逻辑。
- 不接入新 API，不新增入口，不恢复 `AccountAssetsPanel` 或「账号资产/资产中心」。
- 不触碰 `services/`、`packages/`、Admin、Partner。

**Tasks:**

- [ ] 抽出 `Entry`、`EntrySectionData`、`EntryTag`、会话记录类型到 `profileTypes.ts`。
- [ ] 抽出 `ASSETS`、`SERVICES`、`FAIRS`、`BENEFITS`、`ACCOUNT`、`SECTIONS` 到 `profileEntries.ts`。
- [ ] 抽出展示组件，保持 props 与现有行为等价。
- [ ] `ProfilePage.tsx` 只保留页面状态、导航事件和布局编排，目标降到 300-400 行区间。
- [ ] 跑类型、构建和浏览器回归，证明拆分零行为变化。

**Verification:**

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/kiosk build`
- 浏览器验收：游客态 `/profile`、登录态 `/profile`、消息/设置按钮、所有入口跳转保持不变。

## Branch 2: `codex/profile-me-ai-records-page`

**Objective:** 补齐 `/me/ai-records` 明细页，修正「AI服务记录」误跳到 `/assistant` 的入口。

**Dependency:** 必须在 Branch 1 合入后开始。若因排期必须提前执行，只允许在 `ProfilePage.tsx` 做一行入口路由改动，并先补一次显式审查。

**Allowed Files:**

- Add `apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx`
- Modify `apps/kiosk/src/routes/index.tsx`
- Modify Branch 1 后的 `apps/kiosk/src/pages/profile/profileEntries.ts`
- If Branch 1 has not merged, only allow one-line route change in `ProfilePage.tsx` after explicit review.

**Non-Goals:**

- 不修改后端 API、Prisma、AI 服务生成/优化流程。
- 不修改 `apps/kiosk/src/services/api/memberAssets.ts` 或 `packages/shared` 类型；只 import 既有 client 与类型。
- 不展示 `payloadJson`、简历原文、诊断详情正文或文件内容，只展示后端已返回的安全元数据。
- 不改 AI 助手页，不新增首页入口，不新增 AI 助手会话落库。

**Tasks:**

- [ ] 新建 `MyAiRecordsPage`，复用 `MeListShell`、`getMyAiRecords` 和 `deleteMyAiRecord`。
- [ ] 对 `parse`、`optimize`、`generate`、`job_fit`、`career_plan` 做中性中文标签；不得承诺面试、录用或求职结果。
- [ ] 删除操作沿用现有两步确认模式；删除后本地移除或重新拉取列表。
- [ ] 注册 `me/ai-records` 路由。
- [ ] 将「AI服务记录」入口从 `/assistant` 改为 `/me/ai-records`。

**Verification:**

- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/kiosk build`
- 浏览器验收：登录会员从 `/profile` 点击「AI服务记录」进入 `/me/ai-records`；空态、列表、删除、游客登录引导均正常；若存在 `job_fit` / `career_plan` 记录，一并检查中性标签渲染。

## Branch 3: `codex/profile-print-feedback-link`

**Objective:** 打通「打印订单 -> 意见反馈」的已具备后端能力，提交反馈时带上 `relatedPrintTaskId`。

**Allowed Files:**

- Modify `apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx`
- Modify `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx`
- Optional minimal type-only adjustment in `apps/kiosk/src/services/api/memberFeedback.ts` only if existing exported type不足；默认不改。

**Non-Goals:**

- 不修改后端 `member-feedback`，不新增反馈分类。
- 不支持匿名反馈、附件、富文本、截图上传。
- 不记录投递结果、预约结果、招聘会凭证、套餐购买或支付核销。

**Tasks:**

- [ ] 在打印订单卡片加入触控友好的「反馈」入口，最小点击热区不低于 44px。
- [ ] 跳转到 `/me/feedback?category=print&relatedPrintTaskId=<encoded-id>`。
- [ ] `MyFeedbackPage` 读取 `category` 和 `relatedPrintTaskId`，默认分类为 `print`，并在表单内展示只读关联订单提示。
- [ ] `submit()` 调用 `createMyFeedback` 时传入 `relatedPrintTaskId`。
- [ ] 捕获后端 `FEEDBACK_PRINT_TASK_INVALID` 等错误，展示诚实错误提示，不暴露他人订单是否存在。

**Verification:**

- `pnpm --filter @ai-job-print/api verify:member-print-orders`
- `pnpm --filter @ai-job-print/api verify:feedback-notifications`
- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `pnpm --filter @ai-job-print/kiosk build`
- 浏览器验收：登录会员从 `/me/print-orders` 点击反馈进入预填表单；提交后 `/me/feedback` 可见记录；Admin 反馈列表可处理并触发通知；伪造非本人订单 ID 时前端优雅提示。

## Review Gate

- 每个分支开始前必须写本分支的目标、非目标、允许修改文件和验证方式。
- diff 超过 30 行或跨模块变更必须 Claude + Antigravity 双模型审查。
- 每个分支完成后只显式暂存本分支文件，禁止 `git add .`。
- 删除旧实现必须另起分支，并证明无路由、无 import、无测试/verify、无当前文档声明、不会被生产部署或硬件链路使用。
