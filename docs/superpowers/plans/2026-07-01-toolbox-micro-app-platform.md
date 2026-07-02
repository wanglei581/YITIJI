# 百宝箱微应用平台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `writing-plans` to update this plan and `security-review` before implementing runtime or third-party integration changes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把百宝箱从终端级应用入口升级为商用级微应用中心，支持官方内置微应用、H5 / 二维码 / 小程序码入口、首方 AI 技能包，并为后续合作方应用上架留出审核和治理模型。

**Architecture:** 百宝箱是受控启动器和服务入口编排层，不是第三方代码运行时。Kiosk 只渲染后端发布的公开配置；后端负责审核、白名单、合规、熔断、发布投影和匿名统计；AI 只能调用已审核 appKey 或首方 intent，不能自由生成 URL 或向第三方发送用户数据。

**Tech Stack:** React + Vite + TypeScript + Tailwind + lucide-react；NestJS + Prisma + PostgreSQL / SQLite；现有 `TerminalToolboxConfig`、`ToolboxLaunchEvent`、Admin `/toolbox`、Kiosk 首页百宝箱。

---

## Final Product Effect

Kiosk 百宝箱展示一组可运营的微应用卡片。用户可打开官方站内工具、扫码使用合作方小程序、进入白名单 H5 或启动首方 AI 技能。管理端可维护应用目录、审核版本、白名单 host、终端投放、使用统计和紧急熔断。

首批微应用：

- 试卷打印
- 英语模拟练习
- 合同审查
- Offer 对比
- 法律风险审查
- 薪资谈判话术
- HR 知识问答

---

## Non-Goals And Red Lines

- [ ] 不开放第三方 JS / WASM / 插件包上传。
- [ ] 不给第三方 H5 注入会员 token、文件签名 URL、简历正文或本地 Agent bridge。
- [ ] 不允许平台内一键投递、企业收简历、候选人筛选、面试邀约、Offer 管理或候选人推荐。
- [ ] 不让 AI 自由生成第三方 URL。
- [ ] 不把匿名 launch events 当作用户同意证据。

---

## Phase 0: 文档、共享类型和静态门禁

**Outcome:** 微应用平台的产品边界、首批清单、权限模型和防回退门禁进入仓库；不改 Kiosk 入口，不开放真实第三方。

**Files:**

- Create: `docs/product/toolbox-micro-app-platform.md`
- Create: `docs/superpowers/plans/2026-07-01-toolbox-micro-app-platform.md`
- Create: `packages/shared/src/types/toolboxMicroApp.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `services/api/scripts/verify-toolbox-micro-app-platform.ts`
- Modify: `services/api/package.json`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`

**Tasks:**

- [x] 定义 `internal_route`、`web_app`、`qr_code`、`mini_program_qr`、`ai_skill` 五种入口。
- [x] 定义权限、风险等级、数据策略、免责声明、上线门槛。
- [x] 收录首批 7 个候选微应用。
- [x] 静态验证禁止能力、法律免责声明、第三方代码禁用和 H5 白名单前置。
- [ ] 运行 shared typecheck、API verify、targeted diff check。
- [ ] 双模型复审本次 diff。

**Acceptance:**

- `pnpm --filter @ai-job-print/shared typecheck`
- `pnpm --filter @ai-job-print/api verify:toolbox-micro-app-platform`
- `git diff --check -- docs/product/toolbox-micro-app-platform.md docs/superpowers/plans/2026-07-01-toolbox-micro-app-platform.md packages/shared/src/types/toolboxMicroApp.ts packages/shared/src/index.ts services/api/scripts/verify-toolbox-micro-app-platform.ts services/api/package.json docs/progress/current-progress.md docs/progress/next-tasks.md`

---

## Phase 1: 现有百宝箱安全补强

**Outcome:** 在接入任何真实第三方前，把现有配置通道的生产风险先降下来。

**Backend Tasks:**

- [ ] 增加 `TOOLBOX_ALLOW_EXTERNAL_URL`，默认 `false`；关闭时 `external_url` 读取侧 fail-closed。
- [ ] 增加 `toolbox-policy.ts`，拦截招聘平台红线词和禁用类目。
- [ ] `qr_code` 模式要求 `qrTargetUrl` 必填。
- [ ] 长期改为服务端根据 `qrTargetUrl` 生成二维码，避免图片编码内容和声明目标不一致。
- [ ] Admin 视图显示 blocked reason，避免运营以为在线但 Kiosk 已隐藏。
- [ ] launch-event 限流 key 纳入 `terminalId`，避免 NAT 下多终端互相挤占。

**Acceptance:**

- `verify:terminal-device-config`
- `verify:toolbox-launch-events`
- `verify:toolbox-micro-app-platform`
- API typecheck
- Kiosk `verify:home-toolbox-ui`

---

## Phase 2: 最小治理模型和审核发布

**Outcome:** 百宝箱应用从“管理员直接改终端 items”升级为“应用目录 + 审核版本 + host 白名单 + 终端发布投影”。当前已落地纯规则底座与 Phase 2B 后端审核发布工作流，Admin 可视化 UI 和预生产 / 真机验收仍后续执行。

**Data Model:**

- [x] `ToolboxApp` 真实数据库表
- [x] `ToolboxAppVersion` 共享契约与真实数据库表
- [x] `ToolboxAllowedHost` 共享契约与真实数据库表
- [x] `ToolboxDeployment` 延后，短期继续投影到 `TerminalToolboxConfig.itemsJson`

**State Machine:**

- `draft -> submitted -> approved -> published`
- `rejected`
- `suspended`
- `archived`

**Rules:**

- [x] 提交人与审核人不能相同。
- [x] host 过期、应用熔断、版本未审核、命中禁用词时不得发布。
- [x] 所有审核、发布、下架、熔断写 AuditLog 摘要。
- [x] 发布投影只允许 approved 版本通过 gate 后进入终端配置，熔断时移除 `app:${appKey}` 投影项。
- [x] 本机 / 私网 IP host 不得发布。
- [x] 高风险 / 受限应用缺免责声明不得发布。

**Implemented Rule Files:**

- `packages/shared/src/types/toolboxMicroApp.ts`
- `services/api/src/terminals/toolbox-governance.ts`
- `services/api/src/terminals/toolbox-governance.service.ts`
- `services/api/src/terminals/toolbox-projection.ts`
- `services/api/scripts/verify-toolbox-micro-app-platform.ts`
- `services/api/scripts/verify-toolbox-review-workflow.ts`

**Acceptance:**

- `pnpm --filter @ai-job-print/shared typecheck`
- `pnpm --filter @ai-job-print/api typecheck`
- `pnpm --filter @ai-job-print/api verify:toolbox-micro-app-platform`
- `pnpm --filter @ai-job-print/api verify:toolbox-review-workflow`

---

## Phase 3: Kiosk 微应用启动体验

**Outcome:** 用户能清楚区分站内能力、第三方离场和手机扫码办理。

**Tasks:**

- [ ] `internal_route`：站内导航。
- [ ] `web_app`：显示离场提示、第三方责任提示、返回首页能力。
- [ ] `qr_code` / `mini_program_qr`：展示二维码、服务方、用途、目标说明和返回按钮。
- [ ] 外部服务无操作超时后强制回首页，并清理外部上下文。
- [ ] 匿名事件只记录 `show_qr`、`open_external_notice`、`open_external_confirmed`、`cancel_external` 等动作。

---

## Phase 4: 首方 AI 技能包

**Outcome:** 微应用可通过 `/assistant?intent=...` 或首方 AI 工作流启动，但 AI 只能走受控工具。

**First Skills:**

- `offer_compare`
- `salary_negotiation`
- `hr_qa`
- `legal_risk_check`
- `contract_review`

**Rules:**

- [ ] AI 工具出参必须是已发布 `appKey` 或受控 intent。
- [ ] 法律类只输出风险提示，不输出正式法律结论。
- [ ] 合同原文会话后即弃，不进 AuditLog，不进第三方百宝箱应用。
- [ ] 禁止向第三方发送简历、合同、文件 URL、手机号和 token。

---

## Phase 5: 首批微应用逐个上线

推荐顺序：

1. 薪资谈判话术
2. HR 知识问答
3. Offer 对比
4. 法律风险审查
5. 合同审查
6. 试卷打印
7. 英语模拟练习

原因：

- 前三项文件风险低、闭环简单、商业展示价值高。
- 法律和合同类需要法务评审和文件留存策略。
- 试卷打印要处理版权、支付和真机出纸。
- 英语模拟练习涉及商标、题库和长时占用一体机，适合先做手机扫码合作入口。

---

## Phase 6: 第三方声明式 Skill 网关

冻结到后续独立立项。启动前必须完成：

- [ ] SSRF / 私网访问威胁模型。
- [ ] 出站 host 白名单和私网 IP 拒绝。
- [ ] JSON schema 强校验。
- [ ] terminal + user + tool key 限流。
- [ ] 费用上限和熔断。
- [ ] 数据脱敏和 token 剥离。
- [ ] 安全审查和预生产演练。

## 备选方案否决记录

不采用一次性新增 Vendor / Review / Deployment / LaunchLog / KillSwitch 等多表模型，也不在当前阶段新增独立 `ai-tools` 注册表与外部 Skill 网关；正式基线以本计划的最小治理模型、现有终端投影和受控 AI intent 接线为准。
