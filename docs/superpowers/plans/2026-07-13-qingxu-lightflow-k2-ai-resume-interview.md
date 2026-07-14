# 青序 LightFlow K2：AI、简历、模拟面试实施计划

> 状态：已批准继续；按冲突和门禁拆成 K2c → K2a → K2b 三批执行。

## 1. 目标与原则

把 Kiosk 的 17 个 AI 助手、职业方向、简历和模拟面试页面统一到 `http://127.0.0.1:4188/` 所代表的「青序 LightFlow」视觉与排版系统。不是换颜色，而是按任务目标、输入、处理中、结果、下一步重新组织信息层级；现有真实业务能力与状态机保持不变。

统一视觉合同：

- 冰蓝低饱和画布、白色服务面、深海军蓝正文、单一清蓝主操作。
- 页面首屏先回答“我现在要做什么”，过程页只突出当前动作，结果页先结论后证据。
- 触控目标不小于 48px，主操作不小于 56px；适配 1080×1920、390×844、390×700。
- 真实 loading、empty、error、expired、unauthorized、disabled 状态不得伪装成成功态。
- 精确路由白名单启用 LightFlow；禁止用 `/resume/*` 之类前缀误伤重定向或未迁移页面。

## 2. 明确不做

- 不修改模型、prompt、TRTC、ASR、上传、打印 URL、记录持久化、认证、API、DTO、Prisma、Worker 或 Terminal Agent。
- 不新增入口、路由、底部 Tab、假数据、演示成功态或招聘闭环。
- 不吸收主工作区的透明人物素材改动，不触碰 K4“我的页商用闭环”。
- 不把模板“选中”描述成已经应用；不把不存在的导出文件描述成真实文件；不承诺所有预览文字均可编辑。
- 不接受“保留旧 InkPaper 视觉”的建议：`/assistant` 也必须迁移为 LightFlow，但保留其真实文本会话和 TRTC 能力。

## 3. 执行顺序与门禁

### Batch 1 — K2c 模拟面试五页（当前执行）

路由：

- `/interview/setup`
- `/interview/session`
- `/interview/report`
- `/interview/tips`
- `/interview/reports`

这些页面位于顶层路由，不依赖尚未合并的 K1 `KioskRoot` 改动，可独立完成。

允许修改：

- `apps/kiosk/src/pages/interview/InterviewSetupPage.tsx`
- `apps/kiosk/src/pages/interview/InterviewSessionPage.tsx`
- `apps/kiosk/src/pages/interview/InterviewReportPage.tsx`
- `apps/kiosk/src/pages/interview/InterviewTipsPage.tsx`
- `apps/kiosk/src/pages/interview/InterviewReportsPage.tsx`
- `apps/kiosk/src/pages/interview/session/types.ts`（新增）
- `apps/kiosk/src/pages/interview/session/InterviewSessionPanels.tsx`（新增）
- `apps/kiosk/src/pages/interview/session/InterviewAnswerDock.tsx`（新增）
- `apps/kiosk/src/pages/interview/interview-service-desk.css`（新增聚合入口）
- `apps/kiosk/src/pages/interview/styles/interview-shell.css`（新增）
- `apps/kiosk/src/pages/interview/styles/interview-session.css`（新增）
- `apps/kiosk/src/pages/interview/styles/interview-report.css`（新增）
- `apps/kiosk/src/pages/interview/styles/interview-responsive.css`（新增）
- `apps/kiosk/scripts/verify-lightflow-k2c-interview.mjs`（新增）
- `apps/kiosk/package.json`
- `.github/workflows/ci.yml`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`

页面结构：

- Setup：合规说明 → 岗位/行业 → 面试官/难度 → 经历/时长 → 可选简历 → 配置摘要 → 单一开始按钮。
- Session：状态/计时/题号顶栏 → 顾问与隐私提示 → 当前问答区 → 底部回答 Dock；只突出当前可执行动作。
- Report：总评与关键结论 → 能力维度 → 风险/预测 → STAR 与行动清单 → 打印/再练一次。
- Tips：准备进度与清单优先，FAQ、STAR、自我介绍为二级内容，只保留一个开始面试主按钮。
- Reports：使用可扫描记录列表，不做卡片墙；登录、加载、错误、空、列表、删除确认状态明确。

会话页零行为拆分：

- 主页面保留路由、鉴权、effect、录音、ASR、TTS、提交、结束和清场逻辑。
- `InterviewSessionPanels` 只接收 props 展示题目、顾问、隐私、进度和结果提示。
- `InterviewAnswerDock` 只接收 props 展示文本/语音输入与操作按钮。
- `types.ts` 只承载页面内共享展示类型；不得复制 API DTO。
- 拆分后新增文件均小于 300 行，主会话页目标小于 500 行。

受保护合同：

- `createInterview`、`startInterview`、`answerInterview`、`endInterview` 调用和参数保持不变。
- `startWavRecorder`、`transcribeAnswer`、`fallbackToText`、`resetVoiceState` 及能力降级保持不变。
- `recorderRef`、timer、播放停止、组件卸载清场保持不变。
- 报告打印只使用后端返回的 `printFileUrl`，缺失时必须失败，不得拼 URL。
- 历史记录继续使用真实列表/删除接口与登录门禁。

TDD：先新增 `verify:lightflow-k2c-interview`，证明旧页面因缺少 LightFlow 根标记、样式入口和会话展示拆分而 RED；再实施到 GREEN。

### Batch 2 — K2a AI 助手与职业方向

在 K2c 通过后执行：`/assistant`、`/resume/job-fit`、`/resume/career-plan`。

- `/assistant`：任务引导 → 会话 → 快捷任务 → FAQ；“结果去哪儿”降级为说明，不做假按钮。
- `/resume/job-fit`：输入方式与主 CTA → 匹配摘要 → 证据/缺口/改写建议 → 打印、优化和岗位来源动作。
- `/resume/career-plan`：生成引导 → 路线结果 → 打印为主、重新生成为次。
- 将 1000+ 行 `assistant-inkpaper.css` 替换为职责明确且单文件小于 300 行的 LightFlow 样式集合。
- 保留 Assistant 文本会话、会话 ID、防竞态 token、路由白名单、TRTC 懒加载和清场；不修改 `AssistantCallPanel` 与其 hook。
- 更新 `verify:job-fit-m1-5-ui` 时只替换旧 InkPaper 视觉断言，保留业务、历史与打印合同。
- `/assistant` 进入 `KioskRoot` 精确 LightFlow 路由集合的时机，以 K1 合并结果为基线处理冲突。

### Batch 3 — K2b 简历九页

仅在 K1 的 `verify:resume-phone-upload-ui` 修复进入主线并恢复绿色后执行，避免把 K1 修复重复吸收到 K2。

- Source：渐进式来源选择与上传；Parse：单一处理状态中心；Report：诊断摘要与优先级。
- Generate：步骤式输入；Preview：只声明真实可编辑字段；Optimize：三段式优化工作台。
- Templates / Materials：主从结构，真实 selection 状态与能力边界清楚。
- Export：没有真实导出上下文时展示诚实无效状态，禁止伪造 `我的简历.pdf / 248KB`。
- 保护 access token、AI 包装器、最小会话、TTL、busy lock、undo、dirty、真实打印 URL 合同。
- 超阈值页面只拆纯展示区，不移动现有请求、副作用与会话逻辑。

## 4. 验证与审查

每批必须完成：

1. 静态合同 RED → GREEN。
2. `pnpm --filter @ai-job-print/kiosk typecheck`、lint、production build。
3. 相关既有 verify，确认 AI、上传、打印、会员和清场合同未回归。
4. Playwright 验收 1080×1920、390×844、390×700，覆盖正常与至少一种非成功状态。
5. 检查控制台错误、溢出、触控尺寸、焦点态与 reduced-motion。
6. 超过 30 行变更并行调用 Antigravity 与 Claude 审查；无效报告如实记录，不伪称双模型通过。
7. 同步正式进度文档；只提交本批允许文件，不 push、不 merge、不 deploy。

## 5. 完成定义

只有当 17 页分别完成真实状态验证、工程门禁、浏览器验收和审查，才能称 K2 完成。在此之前按 K2c / K2a / K2b 分批报告，不把局部完成表述为全局重构完成。
