# 上线前体检 · Codex 任务包（2026-09-05）

> 配套清单：[launch-audit-2026-09-05.md](launch-audit-2026-09-05.md)（所有 ID 的 file:line 与复现）。
> 用法：一个任务包 = 一个干净分支 = 一个 PR。把「通用约束」+ 对应任务包整段贴给 Codex。不要把两个包合进一个分支。

## 通用约束（每个任务包都要带上）

```text
你在 AI求职打印服务终端 仓库工作。开工前先读 CLAUDE.md、docs/progress/current-progress.md、
docs/progress/next-tasks.md、docs/product/feature-scope.md、docs/compliance/compliance-boundary.md。
问题清单在 docs/reviews/launch-audit-2026-09-05.md，按下面列出的 ID 逐条修，每条先复现再改。

硬规则：
1. 从干净 origin/main 新建分支，只做本任务包列出的 ID；发现清单外的问题只记进 PR 描述，不顺手修。
2. 每个准备改的文件先跑 `node scripts/project-graph-query.mjs file <路径>`，把它列出的门禁全部跑一遍。
3. 不改 apps/miniapp/**（用户本人维护）；不改 .github/workflows/**（除非任务包明确要求，改了必跑 pnpm verify:repository-integrity）。
4. 不新增页面、不新增入口、不新增数据模型；除非任务包写明。
5. 不伪造能力：没有真实数据/接口/保存结果的地方不得显示已完成、已保存、设备正常。
6. 合规：不出现一键投递/立即投递/平台投递/候选人管理；岗位招聘会只做来源入口。
7. 每修一条，写清「改了什么 / 怎么复现验证 / 跑了哪些门禁及结果」；门禁红了不得调阈值或加白名单绕过。
8. 完成后更新 docs/progress/current-progress.md（一段：分支名、修了哪些 ID、验证结果、未做什么）。
9. 全部改完跑：pnpm typecheck、pnpm --filter <改到的包> lint、以及任务包列出的 verify。
10. 最终回复给出：改动文件清单、每个 ID 的状态（fixed / skipped+原因）、门禁输出摘要。不要说「应该可以」，只报实际跑过的结果。
```

---

## 包 1 · 钱与纸（最高优先，Agent + API + Kiosk）

- **ID**：AGT-01、AGT-02、AGT-03、API-03、API-07、API-08、API-09、PRT-03、PRT-02、PRT-04、SES-03
- **目标**：付了钱一定出纸，出了纸绝不报失败；离线不收款。
- **先拍板再做**（问产品负责人，答案写进 PR）：AGT-01 是后端放开 `claimed→completed` 还是 Agent 未确认 printing 不出纸；SES-03 是忙碌期间顺延硬截止还是把 300s 调大并写进文档。
- **允许改**：`apps/terminal-agent/src/agent/task-runner.ts`、`offline-queue.ts`；`services/api/src/terminals/terminals-agent.service.ts`、`print-jobs/print-jobs.service.ts`、`print-jobs/order-quote.service.ts`、`payment/order-status.service.ts`、`payment/online-payment.service.ts`、`print-jobs/pickup-order.service.ts`、`member-print-orders/member-print-order-create.service.ts`；`apps/kiosk/src/pages/print/PrintProgressPage.tsx`、`PrintConfirmPage.tsx`、`services/print/printJobsApi.ts`、`auth/KioskPrivacyGuard.tsx`
- **禁改**：`apps/kiosk/src/pages/profile/me/printOrders/**`、`MyPrintOrdersPage.tsx`（触发批次范围守卫 `verify:profile-print-orders-inkpaper`，另立 PR）
- **验收**：`verify:payment-flow`、`verify:refund-idempotent`、`verify:reconciliation`、`verify:task-reliability`（terminal-agent）、`verify:print-monitor-truth`、`verify:kiosk-print-*` 相关；新增回归用例：printing 上报失败后 completed 不被拒；下载失败任务回到可重领；关单后 pickupStatus 不停在 claimed；`markPaidOnline` 对已取消单拒绝并记「待退」；打印机离线时 `POST /print/jobs` 与 `/orders/quote` 返回 `PRINTER_UNAVAILABLE`。
- **真机项**（Codex 做不了，留给现场）：AGT-02 的 30 页×2 份实测。

## 包 2 · 时间根因（API + 三端）

- **ID**：X-02（含 JOB-01 / PTR-01 / ADM-C2）、ADM-C13、ADM-M3、ADM-M7、ADM-A16、API-17、API-34 的时区项
- **目标**：所有时间按 Asia/Shanghai 显示，三端一个格式化函数，后端 `fmtSyncTime` 不再输出无时区串。
- **允许改**：`services/api/src/jobs/jobs-shared.ts`（`fmtSyncTime` 及 7 个 mapper）、`policies.service.ts` 的 syncTime、`member-auth.service.ts` 日桶；`packages/shared/src/` 新增一个 `formatDateTime` 纯函数；admin/partner/kiosk 各页把 `slice(0,16)`、`new Date(str)` 换成它。
- **验收**：新增门禁 `verify:datetime-honesty`（grep 三端 `toISOString().slice` / `.slice(0,16).replace('T'` 为 0，且 `fmtSyncTime` 输出带时区或为 ISO）；`verify:partner-edit`、`verify:kiosk-recruitment-wiring`；Kiosk 岗位详情「同步时间」在 Safari 与 Chrome 都解析成功（`sourceTrust.hasDate` 不再误判）。

## 包 3 · 错误统一（三端适配器）

- **ID**：SES-02、PRT-01、SES-12、AI-03、MSC-02、PTR-07、ADM-C3、ADM-C5、ADM-C10、ADM-M1、ADM-M13、ADM-A9、ADM-A24、OPS-03、SES-09
- **目标**：适配器统一抛 `ApiHttpError(code, 中文, status)`；页面统一 `userMessageOf(err, 兜底)`；Admin 加全局 unhandledrejection 提示；7 个 Kiosk 模块 401 触发会话重置。
- **允许改**：`apps/kiosk/src/services/**`、`apps/kiosk/src/lib/userErrorMessage.ts`、清单列出的页面；`apps/admin/src/services/api/**`、`apps/admin/src/main.tsx`（全局兜底）、清单列出的页面；`apps/partner/src/routes/sources/index.tsx`
- **验收**：新增门禁 `verify:no-raw-error-render`（三端 `instanceof Error ? *.message` 直接进 setError/渲染为 0）；故障注入：后端 400/500/断网三种情况下确认页、收银页、扫描设置页、来源页均为中文且含下一步。

## 包 4 · AI 链路（API + Kiosk）

- **ID**：AI-01（P0）、AI-02、AI-04、AI-05、AI-06、API-02、API-12、API-31、MSC-01
- **目标**：前端超时 ≥ 后端 LLM 超时（或改异步+轮询）；客户端 abort 回滚配额；助手会话按归属隔离；模拟面试 CAS；优化懒执行加锁；助手路由白名单去尾斜杠。
- **允许改**：`apps/kiosk/src/services/api/aiHttpAdapter.ts`、`pages/resume/*`、`pages/assistant/AssistantPage.tsx`；`services/api/src/ai/**`、`mock-interview/**`、`advisor/**`
- **验收**：`verify:ai-*` 全绿；新增用例：LLM 延迟 20s 时解析成功；重复提交 optimize 只扣一次；两个匿名 sessionId 互不可见；并发两次 `/end` 只生成一份报告。

## 包 5 · 审计与安全（API）

- **ID**：API-01、API-04、API-05、API-06、API-11、API-26、API-16、API-19、API-21、API-23、API-30
- **目标**：审计不再静默丢失；管理员看匿名敏感文件必审计；SSRF 守卫补齐；微信 openid 冲突有出路；法务文档走 DTO 并审计。
- **允许改**：`services/api/src/{audit,files,job-sync,member-auth,legal,print-sign,print-conversion,contract-review,common,auth,trtc,orgs}/**`
- **验收**：`verify:audit-*`、`verify:pii-redaction`、`verify:files-*`；新增用例：`actorId` 为 EndUser id 时审计仍落库（改为 actorId null + payload）；`::ffff:127.0.0.1` 被拒；同 openid 换手机号登录成功。

## 包 6 · Admin 静默失败与假保存

- **ID**：ADM-A1（P0）、OPS-01、OPS-02、ADM-C1、ADM-C4、ADM-C6、ADM-C7、ADM-M2、ADM-M4、ADM-M5、ADM-A2、ADM-A3、ADM-A4、ADM-A5、ADM-A6、ADM-A7、ADM-A8、ADM-A10
- **目标**：每个动作失败必有提示；保存后本地态用服务端返回值；枚举映射补全；筛选值与后端动作名一致。
- **允许改**：`apps/admin/src/routes/**` 清单列出的页面、`apps/admin/src/services/api/**`；后端仅 `terminals/dto/save-toolbox-config.dto.ts`（若选 DTO 加字段方案）
- **禁改**：jobs-admin/jobs-partner/companies service 的状态迁移逻辑（另一会话在改）。
- **验收**：`verify:admin-*`、`verify:source-publish-actions`；新增故障注入用例：发布 400 时页面显示原因；无方案时勾选启用屏保保存后勾选态回落；投放微应用后终端配置可保存。

## 包 7 · 一体机契约与登录不清场

- **ID**：JOB-02、JOB-03、JOB-04、JOB-05、JOB-06/API-14、JOB-07、JOB-08、JOB-09、JOB-10、MP-01（只做后端补 `GET /policies/:id`）、SES-01/AI-02（登录只清别人的会话）
- **允许改**：`apps/kiosk/src/services/api/httpAdapter.ts`、`offlineAgencies.ts`、`policies.ts`、`pages/job-fairs/**`、`pages/jobs/**`、`pages/offline-agencies/**`、`pages/renshi/**`、`auth/AuthContext.tsx`；`services/api/src/jobs/jobs-shared.ts`（managedMaterialCount）、`policies/policies.controller.ts`（新增只读端点，approved+published）
- **验收**：`verify:kiosk-recruitment-wiring`、`verify:kiosk-frontend-debt`、`verify:activity-logs`；用例：参展企业 >20 家全部可见；展区筛选 http 模式有结果；sourceUrl 为空时不写 ExternalJumpLog；游客中途登录后打印文件仍在。

## 包 8 · Partner

- **ID**：PTR-02（P1）、PTR-03、PTR-05、PTR-06、PTR-09、PTR-10、PTR-11、PTR-14、PTR-16、PTR-17、PTR-18（只做摘导航 + 接改密端点）、PTR-19
- **禁改**：`jobs-partner.service.ts` 的 reviewStatus/publishStatus 迁移逻辑（另一会话在改）；PTR-12/PTR-20 等待产品拍板不做。
- **验收**：`verify:partner-edit`、`verify:partner-*`；用例：编辑校招岗位后 category 仍为 campus；Excel「上一步」再预览不留孤儿批次；政策/企业被驳回显示原因。

## 包 9 · 截断口径 + 心跳清理（API + 三端）

- **ID**：X-03、ADM-M6、ADM-M15、OPS-04、PTR-22、JOB-14、API-24、API-35、API-13
- **目标**：列表端点要么分页返回 total，要么响应带 `truncated:true` 且前端显示「仅显示最近 N 条」；心跳表按保留期清理。
- **验收**：新增门禁 `verify:list-truncation-honesty`（服务里 `take:` 常量 ≥50 的端点必须返回 total 或 truncated）。

## 包 10 · 青序流光原型版式（只改 docs/design/kiosk-redesign-2026-08/**，纯 CSS/HTML）

- **来源**：原型体检页 https://claude.ai/code/artifact/56a843c3-1907-4c14-8ad9-34b81784c135
- **P0**：05 AI 顾问回答区叠压（7 态）；03 登录数字键盘在 1920 以下（14 态）；19 图片转 PDF 列表不可滚动（20 张只见 3 张）。
- **P1**：29 面试设置底部合规说明被裁（8 态）；42/43/44 列表第三条被切；12 文件来源卡叠压；01 首页 context-card 与三张横向磁贴文字撞；20 签章放大态越界；16/25/18/05/01 小于 16px 的文字提到 ≥17px。
- **约束**：不改页面结构与状态名（`STATES` 数组、`data-state`、`data-route` 都是接线契约）；不删接口名与字段标注；`?capture=1&flat=1` 夹具门保持。
- **验收**：把探针做成 `apps/kiosk/scripts/verify-qingxu-proto-geometry.mjs`（Playwright，1080×1920，遍历 `STATES` 带 `capture=1&flat=1`）：内容底 ≤1920、卡片越界 ≤6px、可点 ≥48px、正文 ≥16px，全部 0 违规才绿；接进 CI。

---

## 需要产品负责人先拍板的（Codex 不能替你决定）

AGT-01 修法、SES-03 硬截止策略、PTR-12 Excel 重复导入语义、ADM-M5 两个隐私页去留、MP-05 小程序取消入口、PTR-20 企业资料是否按机构类型限制、API-32 简历 AI 是否要 UserAiConsent、大屏一期范围。
