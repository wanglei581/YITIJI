# 青序 LightFlow K2a：AI 助手、岗位匹配与职业规划实施计划

> **状态：** 已完成只读审计；实施前置条件未满足，暂不改运行时代码。
>
> **上位计划：** `docs/superpowers/plans/2026-07-13-qingxu-lightflow-k2-ai-resume-interview.md`。
>
> **目标：** 把 `/assistant`、`/resume/job-fit`、`/resume/career-plan` 迁移到青序 LightFlow，同时保持真实会话、授权、AI、打印与合规链路不变。

## 1. 已确认的范围与边界

### 1.1 允许修改的运行时代码

- `apps/kiosk/src/layouts/KioskRoot.tsx`：只将精确路由 `/assistant` 加入 `service-desk`，不改导航、设备、待机和身份逻辑。
- `apps/kiosk/src/pages/assistant/AssistantPage.tsx`：无行为拆分后接入 LightFlow 壳层、语义标题和局部样式；不触碰 `AssistantCallPanel.tsx` 或语音 hook。
- `apps/kiosk/src/pages/assistant/assistant-inkpaper.css`：替换为多个职责单一、每个少于 300 行的 LightFlow 样式分片和一个聚合入口；删除旧文件只能在所有引用、verify 与文档清零后进行。
- `apps/kiosk/src/pages/resume/JobFitPage.tsx`、`apps/kiosk/src/pages/resume/jobFit/*.tsx`、岗位匹配局部样式：先恢复已验证的匿名/会员授权流程，再只做页面结构与 LightFlow 样式改造。
- `apps/kiosk/src/pages/resume/CareerPlanPage.tsx` 和新增的职业规划局部 LightFlow 样式：只做真实状态的页面编排与样式。
- `apps/kiosk/scripts/verify-*.mjs`、`apps/kiosk/package.json`、`.github/workflows/ci.yml`：接入本批门禁；进度文档只记录实际完成的验证。

### 1.2 严格禁止

- 不改路由、API、DTO、Prisma、认证、AI 模型或 prompt、TRTC、上传、打印 URL、数据保留或 Terminal Agent。
- 不改 `/profile`、`/me/*`、`AssistantCallPanel.tsx`、`useAiAdvisorCallSession`，不新增首页/底部 Tab/同义入口。
- 不恢复 `JobMaster`、`/jobs/master`、站内投递、假 AI 成功、假打印或假设备状态。
- 不使用暖米纸、墨绿主色、纸纹、宋体标题或第三套局部视觉语言。

## 2. 当前实施前置条件（必须先清零）

1. **透明顾问素材归属：** 主工作树尚有未提交的 `ai-advisor-transparent.png`、`AssistantPage.tsx`、`AssistantCallPanel.tsx`、`InterviewSessionPage.tsx` 与 TRTC guard 修改。该任务必须由原 owner 提交并接受审查，或由 owner 明确放弃；K2a 不得覆盖或手工复制未提交改动。
2. **K2 基线同步：** 当前分支相对 `origin/main` 为 `ahead 22, behind 40`。先在本 worktree 对最新 `origin/main` 做一次受控 rebase / 冲突审查，保留 K1、K2c、首页登录候选的已验证提交；不得把同步与 K2a 页面改造混成一个提交。
3. **岗位匹配授权恢复：** 当前前端缺少匿名 `JOB_FIT_ANONYMOUS_CONSENT_REQUIRED` 的授权、重试与撤回界面，和后端已强制的 consent API 不一致。先从已验证候选 `2618b6c9` 进行最小、可审查的择取或等价重建，先得到独立的 RED→GREEN 业务合同；不得在 CSS 改造时顺带重写授权状态机。

前置条件中的每一项结束后均需 `git diff --check`、精确 verify 和单独提交。若同步触及不在本批范围的功能，以冲突报告停止，不强行吸收。

## 3. TDD 实施顺序

### Task 0：基线同步与授权合同（先行、独立）

**文件预算：** 仅限同步冲突的必要文件；授权修复仅 `JobFitPage.tsx`、`services/api/jobFit.ts`、已有或新增 consent 展示组件、`verify-job-fit-m1-5-ui.mjs`、必要 CI/进度文档。

1. 记录同步前后共同祖先和精确 diff；确认不覆盖透明顾问的未提交改动。
2. 将匿名用户的 `403 / JOB_FIT_ANONYMOUS_CONSENT_REQUIRED → 授权 → 原请求重试 → 结果页撤回` 以及会员 `USER_AI_CONSENT_REQUIRED` 引导先写进现有岗位匹配 verify，运行得到 RED。
3. 以候选 `2618b6c9` 为行为基线恢复最小前端合同，运行相关 verify 到 GREEN。
4. 运行 `pnpm --filter @ai-job-print/kiosk typecheck`、`lint`、`build` 和岗位匹配、AI 打印 URL 合同。

### Task 1：K2a 静态视觉合同（RED）

**新增：** `apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs`。

该脚本在代码迁移前必须失败，并锁定：

- 三个目标页面拥有 `data-visual-theme="service-desk"` 与 `data-ux-density="touch"`；`KioskRoot` 只精确 opt-in `/assistant`，不使用 `/resume/*` 前缀。
- 样式聚合入口和分片存在、分片均少于 300 行、作用域仅在目标页面根节点、使用 `--sd-*` token；不再导入或使用 InkPaper、纸纹、墨绿、暖米和衬线标题值。
- 助手没有重复可见“AI助手”页头，但保留可访问页面名；聊天区 `role="log" aria-live="polite"`、加载 `role="status"`、错误 `role="alert"`；输入拥有标签或 `aria-label`。
- 岗位匹配的切换控件具有选中语义，错误不只依赖颜色；常规触控目标绑定 48px、主操作绑定 56px。
- 三页均声明 1080×1920、390×844、390×700 和 `prefers-reduced-motion` 响应式合同。
- 真实业务锚点仍存在：Assistant 的 session / busy lock / 白名单 / TRTC 延迟加载，Job Fit 和 Career 的 token / accessToken / get / generate / print `printFileUrl` fail-closed 合同。
- 不出现“一键投递”“立即投递”“平台投递”“保证录用”“录用概率”。

同时只替换 `verify-job-fit-m1-5-ui.mjs` 中的旧视觉断言，保留打印、历史、匿名/会员凭证、旧缓存兼容、无 `JobMaster` 与无直接外跳的既有业务断言。新增脚本注册到 Kiosk package 与 CI 的 LightFlow 静态合同步骤。

### Task 2：职业规划 LightFlow（GREEN 的第一段）

**文件预算：** `CareerPlanPage.tsx`、职业规划样式聚合与至多四个小于 300 行的 CSS 分片。

1. 为无简历、加载、生成引导、生成失败、结果和打印失败六种真实状态增加同一个路由根作用域，不删除任何 `getLatestCareerPlan`、`generateCareerPlan`、`printCareerPlan`、`useBusyLock`、`makePrintParams` 或导航调用。
2. 将页面重排为“当前任务 / 真实依据 / 行动清单 / 下一步”层级；结果仍先显示合规说明，打印为主操作、重新生成为次操作。
3. 使用浅冰蓝画布、白色服务面、深海军蓝文字和亮蓝主操作；所有面板、sticky 操作栏、长内容、390 宽与 700 高视口都保持可达且不横向溢出。
4. 跑 K2a 静态合同的对应子集到 GREEN，再做页面浏览器矩阵。

### Task 3：岗位匹配 LightFlow（GREEN 的第二段）

**文件预算：** `JobFitPage.tsx`、四个展示组件、岗位匹配局部 CSS 聚合与至多四个样式分片。

1. 复用 Task 0 已恢复的 consent 状态机，不在视觉组件复制授权请求。
2. 以“选择或手填 → 分析状态 → 结论摘要 → 原始依据 / 差距 / 改写建议 → 真实后续操作”组织页面；“查看岗位”仍只去既有详情，来源说明仍然明确去来源平台完成投递。
3. 加强输入、岗位选择、error 与操作栏的语义和触控尺寸，不改变 taskId / state / query / session 的优先级，以及 token / accessToken 的授权方式。
4. 保留 `printFileUrl` 缺失时停在当前页报错，禁止 `signedUrl`、拼 URL 与 `window.print`。

### Task 4：AI 助手 LightFlow（透明素材任务已收口后）

**文件预算：** `KioskRoot.tsx`、`AssistantPage.tsx`、透明素材 owner 已提交的最小资产引用，以及助手 CSS 聚合和至多四个样式分片。

1. 只让 `/assistant` 使用 `KioskLayout` 的 service-desk 外壳；底部 Tab “AI助手”及其选中态保持不变。
2. 为页面增加视觉隐藏的语义标题，不能增加可见重复“AI助手”文字；小青只留在 AI 顾问内容区，且“在线”不可伪装为真实 TRTC 已接通状态。
3. 无行为拆分：若 `AssistantPage.tsx` 继续超过 500 行，只抽取纯展示区；会话 ID、防竞态 token、`chatWithAssistant`、busy lock、键盘、路由白名单、intent 切换清场、TRTC 条件 lazy import 与卸载清场必须留在原有逻辑边界。
4. 用 LightFlow 卡片、输入 Dock、FAQ、快捷任务和合规说明完成重排；“结果去哪儿”保持说明，不能变成未接线按钮。

## 4. 验证与验收

### 工程门禁

```bash
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
pnpm --filter @ai-job-print/kiosk verify:kiosk-shell-active-nav
pnpm --filter @ai-job-print/kiosk verify:job-fit-m1-5-ui
pnpm --filter @ai-job-print/kiosk verify:ai-artifact-print-url-contract
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
pnpm --filter @ai-job-print/kiosk build
git diff --check
```

### 浏览器矩阵（受控回归）

| 视口 | `/assistant` | `/resume/job-fit` | `/resume/career-plan` |
| --- | --- | --- | --- |
| 1080×1920 | 文字会话、FAQ、快捷任务、文字降级与错误恢复 | 选岗/手填、结果、来源说明、三项真实后续操作 | 生成引导、结果、打印与重新生成 |
| 390×844 | 输入与发送不遮挡、无横滚 | 加载/空态/校验错误、操作栏可达 | 引导/失败/长结果可滚动 |
| 390×700 | 键盘下发送、隐私说明和焦点可达 | 切换、错误和分析 CTA 同时可达 | 无简历、生成中、打印失败仍可恢复 |

每格确认：无横向溢出、常规控件至少 48px、主操作至少 56px、焦点可见、reduced-motion 生效、无新增控制台错误。网络拦截或 mock 仅记为受控 UI 证据，不能代替真实 AI、授权写入、TRTC、打印队列或 Windows 出纸验收。

## 5. 提交与收口

1. 基线同步 / consent 修复、静态合同、职业规划、岗位匹配、AI 助手各自独立提交，精确暂存，不使用 `git add .`。
2. 代码变更超过 30 行后，由 Antigravity 与 Claude 并行审查；Critical 必须修复并复审。
3. 最后更新 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`，真实区分本地验证、CI、未 push/部署、真实 API、预生产与 Windows 真机证据。
4. 本批不 push、不合并、不部署；仅在全部门禁和受控浏览器矩阵通过后交付本地候选。
