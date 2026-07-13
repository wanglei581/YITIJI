# 青序 LightFlow K2b：AI 简历九页实施计划

> 状态：用户已批准执行；本计划是 K2 的最后一个本地候选批次，不代表全项目迁移完成。
> 直接视觉参考：`http://127.0.0.1:4188/`；产品名称使用「青序 LightFlow」，工程主题名继续使用 `service-desk`。

## 1. 功能归位与边界

- **真实闭环**：让用户在公共一体机上完成上传/生成/诊断/优化/材料查看时，清楚知道当前任务、真实处理状态和下一步，不改变任何业务能力。
- **前端**：只修改 `apps/kiosk/src/pages/resume/` 的九个既有路由页面及三个局部样式文件，另由集成层修改 `KioskRoot` 精确主题白名单和静态 verify。
- **不涉及**：`services/`、`packages/shared`、`packages/ui`、`apps/admin`、`apps/partner`、`apps/terminal-agent`、认证、AI 模型/API wrapper、上传协议、打印协议、路由定义和 `/me/*`。
- **复用确认**：复用既有 `service-desk.css` token、`UploadSessionQrPanel` 手机扫码上传、`aiResumeSession`、`useBusyLock`、`makePrintParams` 和 API wrapper；不新建第二套状态或上传/导出机制。
- **合规**：不新增岗位投递、候选人流转或企业侧功能；不展示假文件、假导出成功、假 AI 结果或假打印状态。

## 2. 页面信息架构

| 路由 | 首屏任务与内容顺序 | 真实状态约束 |
| --- | --- | --- |
| `/resume/source` | 隐私说明 → 上传来源 → 已选文件/扫码区 → 诊断方向 → 单一开始诊断 | 保留手机扫码会话、上传 busy lock、文件/方向 state |
| `/resume/parse` | 单一处理中枢 → 当前步骤 → 已完成维度 → 明确失败与返回 | 保留 `fileId` 校验、最小时长、真实 parse 调用与失败跳转 |
| `/resume/report` | 结论摘要 → 报告说明 → 证据/优先级 → 单一下一步 | 保留 `accessToken`、最小会话、`targetContext`、真实报告与打印入口 |
| `/resume/generate` | 防编造说明 → 分步表单 → 当前步骤 → 上一步/继续生成 | 保留内存表单、语音确认、busy lock 与原有提交 |
| `/resume/generate/preview` | 真实可编辑内容 → 缺失提示 → 导出结果/打印下一步 | 不承诺所有字段可编辑；只用真实导出与 `printFileUrl` |
| `/resume/optimize` | 任务说明 → 表达对比/编辑 → 模板与版式 → 导出/打印 | 保留 `isDirty`、`confirmLeave`、undo、busy lock、真实 URL |
| `/resume/templates` | 素材分类 → 选择状态 → 详情/能力边界 → 去优化 | 选择只表示当前选择，不称“已应用” |
| `/resume/materials` | 材料分类 → 实际内容/填写 → 生成动作 | 保留既有草稿和真实能力边界 |
| `/resume/export` | 当前可用输出物 → 诚实无效态 → 正确下一步 | 无导出上下文时不可伪造文件名、体积或可打印状态 |

共同视觉：冰蓝画布、白色圆角工作卡、深海军蓝文字、亮蓝唯一主操作；普通控件不低于 48px、主操作不低于 56px。窄视口只重排，不省略隐私、错误、空态或下一步。

## 3. RED → GREEN 静态合同

### Step 1：先写 RED

新增 `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs` 并在 `apps/kiosk/package.json` 注册 `verify:lightflow-k2b-ai-resume`。首次执行必须因为缺少下列内容失败：

- 三个局部 CSS 入口及九个局部 LightFlow root class；所有 selector 受局部 root 限定、单文件小于 300 行、含 reduced-motion。
- `KioskRoot.tsx` 的精确 `SERVICE_DESK_EXACT_ROUTES` 白名单：既有 `/`、`/help`、`/assistant` 加九个 K2b 路由；禁止 `startsWith('/resume')` 或任何 `/me` 路由。
- 上传/解析/报告/生成/预览/优化/模板/材料/导出页仍各自保留关键业务合同。

记录该 RED 命令的预期失败输出后，才开始视觉实现。

### Step 2：并行 GREEN（文件所有权严格互斥）

**A. 诊断流**

- 只可修改：`ResumeSourcePage.tsx`、`ResumeParsePage.tsx`、`ResumeReportPage.tsx`、新增 `resume-diagnosis-lightflow.css`。
- 根 class 分别使用 `resume-source-lightflow`、`resume-parse-lightflow`、`resume-report-lightflow`，共同加 `resume-lightflow`。
- 不动 `DiagnosisDirectionForm.tsx`、上传组件、API、session 文件；用现有结构和 class 重新组织展示。
- 相关验证：`verify:resume-phone-upload-ui`、`verify:resume-diagnosis-flow-ui`、类型检查。

**B. 生成与优化流**

- 只可修改：`ResumeGeneratePage.tsx`、`ResumeGeneratePreviewPage.tsx`、`ResumeOptimizePage.tsx`、新增 `resume-authoring-lightflow.css`。
- 根 class 分别使用 `resume-generate-lightflow`、`resume-generate-preview-lightflow`、`resume-optimize-lightflow`，共同加 `resume-lightflow`。
- 不动语音、编辑器、layout hook、API 和 session 文件；保持所有副作用及函数调用原位置。
- 相关验证：`verify:resume-diagnosis-flow-ui`、`verify:ai-artifact-print-url-contract`、类型检查。

**C. 素材与导出流**

- 只可修改：`ResumeTemplateLibraryPage.tsx`、`JobMaterialLibraryPage.tsx`、`ResumeExportPage.tsx`、新增 `resume-library-lightflow.css`。
- 根 class 分别使用 `resume-templates-lightflow`、`resume-materials-lightflow`、`resume-export-lightflow`，共同加 `resume-lightflow`。
- 不修改 `jobMaterialDraft.ts` 或 API；`ResumeExportPage` 必须移除默认伪造的 `我的简历.pdf / 248 KB` 和以路由 state 模拟“保存到我的简历”的行为。无真实导出上下文时只展示诚实空态和正确回流入口；打印、保存均保持禁用，不能构造假的 `PrintTask` 或本人资产。
- 相关验证：`verify:job-material-library-ui`、类型检查。

每组提交前必须提供：作用域 diff、静态 verify、typecheck 结果，以及未触碰受保护合同的自查。

### Step 3：集成 GREEN

由主任务修改并只修改：

- `apps/kiosk/src/layouts/KioskRoot.tsx`
- `apps/kiosk/scripts/verify-lightflow-k2b-ai-resume.mjs`
- `apps/kiosk/package.json`

将精确路由表接入 `isServiceDeskRoute`，完成跨九页静态合同，并确保 package script 在 CI 可独立运行。不修改路由配置或任何页面业务逻辑。

## 4. 逐步执行与命令

1. 创建并运行 RED：

   ```bash
   pnpm --filter @ai-job-print/kiosk verify:lightflow-k2b-ai-resume
   ```

2. 三组页面并行实施，单个代理只写自己的文件清单；每组完成后运行其最小 verify 与：

   ```bash
   pnpm --filter @ai-job-print/kiosk typecheck
   git diff --check -- <owned files>
   ```

3. 集成后运行：

   ```bash
   pnpm --filter @ai-job-print/kiosk verify:lightflow-k2b-ai-resume
   pnpm --filter @ai-job-print/kiosk verify:resume-phone-upload-ui
   pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui
   pnpm --filter @ai-job-print/kiosk verify:job-material-library-ui
   pnpm --filter @ai-job-print/kiosk verify:ai-artifact-print-url-contract
   pnpm --filter @ai-job-print/kiosk typecheck
   pnpm --filter @ai-job-print/kiosk lint
   VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm build:kiosk:production
   ```

4. 浏览器验收：在 1080×1920、390×844、390×700 实看至少 Source、Parse 失败态、Report、Generate、Preview 空态、Optimize、Templates、Materials、Export 无上下文；检查无横向溢出、主次触控尺寸、焦点、reduced-motion、控制台错误。只把受控浏览器结果写为本地候选证据，不冒充真实上传、AI、打印或 Windows 验收。

5. 审查：先由独立子代理做规格符合性审查，再由另一子代理做 diff 质量审查；外部 Antigravity 和 Claude 并行审查。Claude 若超时或取消，按无效审查记录，不能写为通过。

6. 只在上述通过后更新 `docs/progress/current-progress.md`、`docs/progress/next-tasks.md` 和 K2 task 状态，提交本批文件；不 push、不 merge、不部署。K2b 完成后仍需单独开展分支整合，不能在本 worktree rebase。

## 5. 完成定义

- 九页都处于精确 LightFlow 页壳下，且每页有局部、可维护、无全局污染的样式作用域。
- 上传、匿名凭证、临时会话、AI 调用、busy lock、脏数据保护、模板选择与真实打印 URL 的静态合同仍为绿色。
- 全部验证、浏览器矩阵和审查结论都有明确证据等级；无上线、预生产、真实 AI/打印/Windows 真机结论时不使用“商用已验证”表述。
