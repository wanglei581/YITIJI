# AI 结果层 · 五家协同任务包（2026-09-06）

> 配套清单：[2026-09-06-result-layer-review.md](2026-09-06-result-layer-review.md)（现状、file:line、五家对账、§6 拍板记录）。
> 用法：一个任务包 = 一个从 `origin/main` 新建的 worktree + 分支 = 一个 PR。把「通用约束」+ 对应任务包整段贴给执行方。不要把两个包合进一个分支。
> 分工（产品负责人 2026-09-05 定）：Claude 出包、收货、合并、做原型与 UI 验收；codex / grok / hermes 实现；agy 只做纯推理复核。
> 目标：把评审文档 §5 的 P0 全部修完，并把所有「半实现」做完整，达到可交付商用标准。

## 通用约束（每个任务包都要带上）

```text
你在 AI求职打印服务终端 仓库的一个独立 worktree 里工作，分支已从干净 origin/main 新建。
开工前先读 CLAUDE.md、docs/progress/current-progress.md 顶部、docs/progress/next-tasks.md 顶部、
docs/product/feature-scope.md §2.2 / §2.2.1 / §2.3、docs/compliance/compliance-boundary.md，
以及 docs/reviews/2026-09-06-result-layer-review.md（现状与 file:line）和本文件里你的任务包。

硬规则：
1. 只做本任务包列出的条目；发现清单外的问题只记进 PR 描述，不顺手修。
2. 每个准备改的文件先跑 `node scripts/project-graph-query.mjs file <路径>`，把它列出的门禁全部跑一遍；
   图谱没列出的不等于不用跑，CI 全量门禁才是权威。
3. 不改 .github/workflows/**。apps/miniapp/** 只有「包 C」可以改；其他包不得碰。
   小程序是原生 JS、无类型检查：任何包改了 services/api 既有端点的路径 / 方法 / 响应形状，
   必须跑 `pnpm --dir apps/miniapp verify:api-contract`，报 BROKEN 就说明你拆了小程序，改回来。
4. 不新增页面、不新增首页入口、不新增数据模型；除非任务包写明「允许新增」。
5. 不伪造能力：没有真实数据 / 接口 / 保存结果 / 引擎能力的地方不得显示已完成、已保存、可转换、设备正常。
   AI 或引擎不可用时按 CLAUDE.md §9：按钮 aria-disabled + 写清原因与恢复条件，不整页瘫痪。
6. 合规：不出现一键投递 / 立即投递 / 平台投递 / 候选人管理；岗位招聘会只做来源入口；
   不出现录用概率百分比；诊断 / 优化不得新增用户未确认的事实。
7. 门禁红了不得调阈值、不得加白名单绕过；撞到「范围外变更 / 哈希不符」类批次守卫，只加行并写清是第几次、为什么。
8. 每条改动写清「改了什么 / 怎么复现验证 / 跑了哪些门禁及结果」。新增门禁必须做变异测试（临时改坏 src 让每条断言各红一次）。
9. 完成后在 docs/progress/current-progress.md 顶部追加一段（分支名、做了哪些条目、验证结果、未做什么、未部署）。
10. 全部改完跑：对应包的 typecheck 与 lint、任务包列出的 verify、`pnpm verify:repository-integrity`（若碰过 package.json）。
11. 最终回复给出：改动文件清单、每个条目的状态（done / skipped+原因）、门禁输出摘要（实跑结果，不写「应该可以」）。
12. 工具链：PATH 上的 pnpm 会用 Node 24 被 engines 拒；用 `npx -y pnpm@11.2.2 --filter <pkg> exec <cmd>`，
    或直接用仓库内的 tsc / eslint / node 脚本。verify:* 需要 services/api/.env 与 prisma/dev.db（worktree 已准备）。
13. 提交信息末尾带 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`；不要 push、不要开 PR，由主持人收货。
```

## 跨包契约（先定，再并行）

### 契约 1 · 诊断报告与修改清单导出（包 A 实现，包 C2 / E2 消费）

```text
POST /api/v1/resume/records/:taskId/export
  鉴权与 GET /resume/records/:taskId 完全一致（会员 token 或匿名 accessToken）
  body: { kind: 'diagnosis_report' | 'change_list' }
  200: { fileId, filename, mimeType: 'application/pdf', sizeBytes, pageCount, signedUrl, expiresAt,
         printFileUrl, savedToDocuments: boolean, aiGenerated: true }
  错误码：AI_TASK_NOT_FOUND（含过期 / 越权，统一 404）、AI_RESULT_NOT_READY、RESUME_PDF_FONT_NOT_FOUND（503）
  落库：FileObject(purpose='print_doc', assetCategory='derived', sourceFileId=原件, createdBy='ai_resume_diagnosis_export')
        会员绑定 endUserId → 出现在 /me/documents，savedToDocuments=true；匿名 → false，页面不得写「已存我的文档」
  文件名：AI诊断报告_<姓名或日期>.pdf / 修改清单_<姓名或日期>.pdf；页眉印「AI 生成，仅供参考，请自行核对」
  内容：diagnosis_report = 总分 + 6 维 + 先改这几处 + 问题清单（维度/严重度/原文引用/影响/改法）+ 风险 + 建议 + 截断/OCR 说明
        change_list = 问题清单 + before/after（若已有 optimize 结果）+ 「请回自己的 Word 里改」说明
```

### 契约 2 · 导出收费开关与价格契约（包 B 实现，包 C2 / E2 / F 消费）

```text
存储：复用 PriceConfig，新增 serviceKey='resume_export'（unit='item'）。三态：
  unitCents=0 且 active   → mode='free'      界面写「当前免费，不扣权益」
  unitCents>0 且 active   → mode='charged'   导出前必须展示价格 + 可用权益；无权益时按钮 aria-disabled 并说明
  active=false            → mode='unavailable' 导出不可用，界面写原因（fail-closed，不是免费）
开关位置：Admin 现有「计费管理 /billing」价目表里就是这一行（改价即时生效 + 审计），不新增页面。
GET /api/v1/resume/export/pricing → { mode, unitCents, unit, benefit: { available: number, serviceType } | null, label }
门禁：ai.service.ts 的 assertExportFormatAllowed 改为 assertExportAllowed(ctx)：
  free → 放行；charged → 必须核销一条权益（BenefitGrant，serviceType='resume_export'，幂等键 = taskId + 内容哈希，
  同一内容不重复扣）；核销只在文件成功生成后落账，生成失败不扣次；unavailable → 400 RESUME_EXPORT_UNAVAILABLE。
/resume/generate/export 与 /resume/records/:taskId/export 都必须过 requireActiveConsent(endUserId,'resume_ai')。
```

### 契约 3 · 文档转换（包 D 实现，包 C3 / E3 / 打印链路消费）

```text
GET  /api/v1/document-conversion/capabilities → { wordToPdf: boolean, engine: 'soffice'|'gotenberg'|'none', reason?: string, cjkFonts: boolean }
POST /api/v1/files/:id/convert  body { target: 'pdf' }
  归属校验同 files；输入 mime ∈ { application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document }
  200: { fileId, filename, mimeType:'application/pdf', sizeBytes, pageCount, signedUrl, expiresAt, printFileUrl, engine, warnings: string[] }
  落库：FileObject(purpose 与源文件相同, assetCategory='derived', sourceFileId=源, createdBy='document_conversion')
  错误码：CONVERSION_UNAVAILABLE（引擎未配置 / 探测失败，503）、CONVERSION_TIMEOUT、CONVERSION_FAILED、UNSUPPORTED_FILE_TYPE
引擎：CONVERSION_ENGINE=soffice|gotenberg|disabled（默认 disabled）；SOFFICE_PATH；每次转换独立临时目录 +
  `-env:UserInstallation=file://<tmp>`，参数 --headless --norestore --nologo --nolockcheck --convert-to pdf，禁网络禁宏；
  超时 60s；并发上限 2（可配）；输出上限 15MB；启动时探测引擎与 CJK 字体（fc-list 或已知路径），探测结果进 capabilities。
诚实：capabilities.wordToPdf=false 时，所有「转 PDF / Word 预览 / Word 打印」入口 aria-disabled 并显示 reason；
  UI 文案固定含「由转换引擎生成，复杂版式可能有偏差，请预览核对」。
```

## 第一波（并行，互不重叠）

### 包 A · 诊断报告与修改清单导出 —— codex

- **条目**：P0-2（后端）、P0-13、P0-6 的文件名与页眉部分
- **目标**：按契约 1 实现导出端点与两种 PDF；报告 PDF 的内容以服务端 `ResumeReport`（含 `issues` / `contentBlocks` / `priorities` / `riskNotes` / `truncatedInput`）为准；严重度按 `ai-provider.interface.ts:166-174` 注释的分档规则在服务端算好并进 PDF。
- **允许改 / 新增**：`services/api/src/ai/resume/diagnosis-report-pdf.service.ts`（新）、`services/api/src/ai/resume-report-export.controller.ts`（新，不要塞进 ai.controller.ts）、`services/api/src/ai/ai.module.ts`（注册）、`packages/shared/src/types/ai.ts`（只加类型）、`services/api/src/ai/resume/*.spec.ts` 或 `scripts/verify-*.ts`（新门禁 `verify:resume-report-export`）。
- **禁改**：`services/api/src/ai/ai.service.ts`（包 B 在改）、`apps/**`、`file-validation.ts` 的 purpose 白名单。
- **参考实现**：`services/api/src/ai/resume/job-fit-pdf.service.ts` + `job-fit.service.ts:223-267`（落库 + `printFileUrl`），字体解析照 `resume-pdf.service.ts:28-55`（可顺手抽成 `common/pdf/cjk-font.ts` 供本包复用，其他 5 处不动）。
- **验收**：新增门禁覆盖 会员 / 匿名 / 过期 / 越权 / 缺字体 五种路径与 `savedToDocuments` 真假；`verify:real-resume-diagnosis`、`verify:file-internal-auth`、`verify:audit-logs`、`verify:pii-redaction` 与图谱列出的门禁；API typecheck / lint。

### 包 B · 导出收费开关、模板双源、consent —— grok

- **条目**：P0-7、P0-8、契约 2
- **目标**：`resume_export` 价目行三态 + `/resume/export/pricing` + `assertExportAllowed` + 权益核销幂等 + 失败不扣次；`ai.service.ts:658-666` 模板校验改读数据库（`job-materials.service.ts` 的公开列表）；`/resume/generate/export` 补 `requireActiveConsent`；Admin `/billing` 价目表出现该行且 `SERVICE_LABELS` 有中文名，页头副标题写清「对应一体机 / 小程序简历优化页的导出按钮」。
- **允许改**：`services/api/src/ai/ai.service.ts`（仅导出与模板校验段）、`services/api/src/ai/ai.controller.ts`（仅 export 段）、`services/api/src/ai/dto/resume-generate.dto.ts`、`services/api/src/benefit-redemption/**`（只加）、`services/api/src/payment/**` 中价目读取处（只加 serviceKey）、`apps/admin/src/routes/billing/index.tsx`、`apps/admin/src/services/api/adminBilling.ts`、`packages/shared/src/types/*`（只加）、价目种子脚本、`verify-resume-export-formats` 门禁（它现在钉死「恒放行」，改为断言三态）。
- **禁改**：`apps/kiosk/**`、`apps/miniapp/**`、`services/api/src/ai/resume/**`。
- **验收**：`verify:resume-export-formats`（改后三态断言）、`verify:payment-flow`、`verify:refund-idempotent`（若碰价目）、`verify:audit-logs`、图谱列出的门禁；Admin typecheck / lint；变异测试证明「生成失败不扣次」「同内容不重复扣」两条断言真的会红。

### 包 C · 小程序结果层第一批 —— hermes

- **条目**：P0-1（小程序）、P0-4、P0-5（小程序部分）、诊断方向透传
- **目标**：诊断页渲染 `issues`（维度 / 严重度 / 原文引用 / 影响 / 改法）与 `contentBlocks`，首屏 3 条「先改这些」+ 每维一句人话 +「这不是录取分」，截断 / OCR 顶栏；`resume-parse` 传 `selectedDimensions` / `targetContext`（若小程序无方向表单，至少透传 URL 参数并允许跳过）；优化页接**现有** `POST /resume/generate/export`（四格式 + 打印用 PDF 副本 + 存我的文档提示），复用 `resume-build.js:383-457` 的流程；`resumes.js:47` 的 `format:'PDF'` 改为真实 mime，没有文件写「仅记录，未导出文件」；诊断失败补「打印原件 / 去打印 / 查看岗位」出口；导出后用 `wx.openDocument` 打开真实 PDF 并显示页数 / 大小 / 有效期；修正 `resume-optimize.js:26` 失真注释。
- **允许改**：`apps/miniapp/pages/resume-diagnose/**`、`resume-optimize/**`、`resume-parse/**`、`resumes/**`、`apps/miniapp/utils/normalize.js`、`utils/api.js`（只加）、小程序门禁脚本（只加）。
- **禁改**：`services/api/**`、`apps/kiosk/**`、`packages/**`。报告 PDF 导出与价格展示等契约 1 / 2 消费留到包 C2。
- **验收**：`pnpm --dir apps/miniapp verify:static`（含 `verify:api-contract`）；新增静态断言：诊断页 wxml 引用 `issues`、`resumes.js` 不再硬编码 `'PDF'`；按 `apps/miniapp/README.md` 的开发者工具自动化截图三页（诊断报告 / 优化导出 / 我的简历）。
- **告知**：改动只在本 worktree，用户开发者工具里的主 checkout 看不到；PR 描述里写明。

### 包 D · 文档转换引擎（Word → PDF，.doc 接收）—— codex

- **条目**：P0（转换进上线承诺）、P0-9（.doc 三端接收后服务端转换）、契约 3
- **目标**：新模块 `services/api/src/document-conversion/`（允许新增模块，不新增 Prisma 模型）：soffice 适配器 + gotenberg 适配器骨架 + 能力探测 + 转换端点；`resume-extraction.service.ts` 对 `.doc` 走「转换为 PDF → unpdf 抽文字」，引擎不可用时保持现有诚实失败文案并附「服务端未配置转换引擎」；打印链路：`print_doc` purpose 增加 doc/docx 但只在 capabilities 为真时接受，建单前服务端转成派生 PDF 并以派生文件建单（`print-page-count.service.ts` 保持只认 PDF / 图片）；`PhoneUploadPage` / `ResumeSourcePage` / `resume-upload.js` 的 `.doc` 口径统一为「接收」，但这三处前端不在本包改（记进 PR 描述，交包 E3 / C3）。部署：`docs/device/production-deployment-and-windows-host-checklist.md` 增加 LibreOffice / Gotenberg 安装、思源字体、env、探测命令；`.env.example` 增加 `CONVERSION_ENGINE` / `SOFFICE_PATH` / `CONVERSION_MAX_CONCURRENCY`。
- **允许改 / 新增**：`services/api/src/document-conversion/**`（新）、`services/api/src/app.module.ts`（注册）、`services/api/src/files/file-validation.ts`（仅 print_doc 的条件放行）、`services/api/src/print-jobs/print-jobs.service.ts`（建单前转换分支）、`services/api/src/ai/resume/resume-extraction.service.ts`（.doc 分支）、`services/api/.env.example`、`packages/shared/src/types/documentConversion.ts`（新）、`docs/device/production-deployment-and-windows-host-checklist.md`、新门禁 `verify:document-conversion`。
- **禁改**：`apps/**`、`apps/terminal-agent/**`（Agent 仍只打 PDF / 图片）、`services/worker/**`（本包不复活空壳，转换在 API 进程内受并发限制运行；队列化是 P1）。
- **本机现实**：开发 Mac 没有 LibreOffice。门禁用 fake 引擎覆盖契约、超时、并发、归属、能力为假时的 fail-closed；真实引擎的集成测试在 `SOFFICE_PATH` 存在时才跑、缺席时打印醒目 SKIPPED，并把「服务器安装后执行的验收命令」写进部署清单。PR 描述必须写明「真实转换未在本机验证」。
- **验收**：`verify:document-conversion`（含变异测试）、`verify:print-page-count` 或图谱列出的打印门禁、`verify:real-resume-diagnosis`、`verify:file-assets-trial-acceptance`、`verify:file-internal-auth`；API typecheck / lint；`pnpm --dir apps/miniapp verify:api-contract`。

### 包 E · 一体机诊断报告页（青序流光 22 页迁移）—— grok

- **条目**：P0-1（一体机）、P0-5 的诊断部分
- **目标**：按 `docs/design/kiosk-redesign-2026-08/22-resume-report.html` 把 `/resume/report` 迁进青序流光（`apps/kiosk/src/layouts/KioskRoot.tsx` 的 `QX_MIGRATED_ROUTES` 登记，复用 `styles/qingxu/` 令牌与 `components/qingxu/QxPageFrame.tsx`，样板见取件码页 `pickup-claim-qx.css`）；原型声明的 9 个 `?state=`（loading / report / report-empty / report-minimal / diagnose-failed / read-error / no-context / unavailable / illegal）全部有真实对应；渲染 `issues`（维度 / 严重度 / 原文引用 / 影响 / 改法）、`contentBlocks` 七块、「先改这几处」、每维一句人话、「这不是录取分」、截断 / OCR 顶栏，`report.sections` 为空不出总分；刷新后从服务端回填 `targetContext`；打印 / 导出 / 二维码三个动作本包只做**诚实置灰 + 原因「报告导出端点上线后开放」**（包 E2 接契约 1）。
- **允许改**：`apps/kiosk/src/pages/resume/ResumeReportPage.tsx` 及其拆分出的子组件（>300 行必须拆）、新建 `apps/kiosk/src/pages/resume/resume-report-qx.css`、`apps/kiosk/src/layouts/KioskRoot.tsx`（仅 `QX_MIGRATED_ROUTES` 加一项）、`packages/ui/src/charts/ResumeRadarChart.tsx`（若需）、kiosk 门禁脚本（只加）。
- **禁改**：`apps/kiosk/src/pages/profile/**`（批次守卫）、`services/api/**`、`apps/miniapp/**`。
- **验收**：单页验收六条（`docs/progress/next-tasks.md`「单页验收标准」）：1080×1920 截图与原型并排（`scripts/dev/shot-route.sh`）、每个 state 实测、`data-route` 目标可达、图谱门禁 + kiosk typecheck / lint、触控 ≥48px（用 `?capture=1` 夹具）、合规文案。`verify:kiosk-*` 中图谱列出的全部；`verify:compliance-copy`。

## 第二波（第一波合入后）

| 包 | 执行方 | 条目 | 依赖 |
|---|---|---|---|
| C2 小程序接契约 1 / 2 | hermes | 报告 PDF 导出 / 打印 / 二维码；价格 / 免费显示；权益不足置灰 | A、B |
| E2 一体机报告页接契约 1 / 2 | grok | 同上 + 二维码倒计时 | A、B、E |
| F 优化页 / 生成页同构（23 / 24 页迁移） | grok | P0-3、P0-5（优化 / 生成）、真实 PDF 预览、页数 / 压到一页、价格显示、修改清单入口 | A、B |
| G 公共终端与打印救济 | codex | P0-10：开始告知、掩码、60 秒清场、二维码倒计时、缺纸置灰不扣费、失败补打凭证、出纸提醒 | — |
| H 草稿 / 版本 / 事实核对墙 | codex | P0-12、P0-6 屏显与 DOCX 元数据、「回到原文」 | B |
| I 小青语音 | grok | 保留 TRTC 实时通话；长按语音转文字 / 语音发送接 `assistant/chat`（复用 `services/api/src/asr`）；advisor 三种产物接成「本次要点」可存可打印 | — |
| J 半实现补全 | hermes | 高敏结果保存不打印（签约风险报告可存我的文档、禁打印、原文仍短期删）；模拟面试进 AI 服务记录 + 报告含转写 + 小程序历史 / 降级题目单 / 语音；招聘会规划记录可回看；AI 记录入口文案 | — |
| K 字体包与三端 .doc 口径 | codex | P0-11 字体包 + 启动自检 + 缺字体出路；`PhoneUploadPage` / `ResumeSourcePage` / `resume-upload.js` `.doc` 改为接收（capabilities 为真时） | D |
| L 口径落笔 | Claude | P0-14 已在本轮完成（feature-scope §2.2 / §2.2.1 / §2.3 / §2.6） | — |

## 第三波（P1 补全，商用完整）

≥3 套真实模板 + 真实缩略图；DOCX 吃 layout / 模板；具名多版本与对比；跨端续办；PDF → 图片；gotenberg 适配器 + 队列化；Puppeteer 替换 pdfkit 评估；缩略图；助手会话要点；政策核对材料清单出纸。

## 收货标准（主持人）

1. PR 只含本包允许路径；`gh pr checks` 三条（build-and-verify / kiosk-browser-smoke / postgres-readiness）全绿，watcher 核对 workflow=CI 且 headSha 一致后 squash 合并。
2. 逐条目对照本文件核状态；「skipped」必须有原因。
3. 一体机页面由 Claude 用 1080×1920 截图对比原型验收；小程序由开发者工具自动化截图验收。
4. 合入后 `docs/progress/current-progress.md` 顶部已有该包记录；本文件对应包标「已合入 #n」。
