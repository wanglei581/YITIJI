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

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 B · 导出收费开关、模板双源、consent**（分支 `claude/rl-b-export-pricing`，本地候选，未 push、未开 PR、未部署）。条目 P0-7 / P0-8 / 契约 2。① PriceConfig 新增 `serviceKey=resume_export`（unit=`item`）；缺行时 `ensureResumeExportPriceConfig` 插入且不覆盖运营改价（生产默认停用 fail-closed，开发/verify 默认免费启用）。三态：`unitCents=0 && active` → `free`（文案「当前免费，不扣权益」）；`unitCents>0 && active` → `charged`；`active=false` 或缺失 → `unavailable`（不是免费）。② `GET /api/v1/resume/export/pricing` 回 `{ mode, unitCents, unit, benefit, label }`；登录会员在 charged 时附带可用权益次数。③ `assertExportFormatAllowed` 改为 `assertExportAllowed`：free 放行；charged 须登录并核销 `BenefitGrant`（`serviceType=resume_export`，幂等键 = `endUserId:taskId:内容哈希`，同一内容不重复扣）；核销只在文件成功生成后落账；unavailable → 400 `RESUME_EXPORT_UNAVAILABLE`。④ `/resume/generate/export` 补 `requireActiveConsent(endUserId,'resume_ai')`。⑤ 模板校验改读数据库公开 published 列表（空库按 job-materials 同口径幂等补种，不覆盖运营改动）。⑥ Admin `/billing` 价目表 `SERVICE_LABELS.resume_export=简历导出（每次）`，页头副标题写明对应一体机 / 小程序简历优化页的导出按钮。打印公开价目视图只回 `print_bw_page` / `print_color_page`，避免简历导出行漏进收银。**未做**：Kiosk / 小程序价格展示与权益不足置灰（包 C2 / E2 / F）；`POST /resume/records/:taskId/export` 的 consent 与核销由包 A 接同一 `ResumeExportGateService`（本包已 export）。**验证（实跑）**：api/admin/shared `tsc --noEmit` 0；改动文件 eslint 0；`verify:resume-export-formats` ALL PASS（含三态 + 失败不扣次 + 同内容不重复扣）；变异 1 提前扣次 → 6e 红（剩余 1）；变异 2 幂等键加时间戳 → 6f 红（剩余 0）；恢复后全绿。`verify:resume-template-fill` / `resume-layout-export` / `resume-layout-adjust` / `resume-generate` / `resume-optimize` / `admin-billing`（18）/ `admin-billing-ui` / `payment-flow` / `refund-idempotent`（31）/ `pricing` / `print-rollout-config` / `benefit-redemption` / `redemption-audit`（23）/ `audit-logs` / `ai-contract-mirror` / `ai-cost-coverage`（170）/ `throttle-dimension` / `price-single-source` / miniapp `verify:api-contract` 全绿。未部署。
  > 2026-09-06 **AI 结果层包 A：诊断报告与修改清单导出（分支 `claude/rl-a-diagnosis-export`，未部署）**。完成 P0-2 后端、P0-13、P0-6 的文件名与页眉部分：新增 `POST /api/v1/resume/records/:taskId/export`，复用既有会员 / 匿名一次性令牌归属门禁，生成诊断报告或修改清单 PDF；严重度按所属维度得分在服务端机械分档，报告包含六维、优先项、问题原文证据、内容块、风险/建议、截断与 OCR 说明，修改清单只读取已有 optimize before/after；产物以 `print_doc` / `derived` / `sourceFileId` / `ai_resume_diagnosis_export` 落库，会员进入「我的文档」并回 `savedToDocuments=true`，匿名保持 false，统一返回预览签名 URL 与内部 `printFileUrl`；文件名为 `AI诊断报告_<姓名或日期>.pdf` / `修改清单_<姓名或日期>.pdf`，每页页眉印「AI 生成，仅供参考，请自行核对」。新增 `verify:resume-report-export`，会员 / 匿名 / 过期 / 越权 / 缺字体五条主断言均做过源码变异并真实打红，干净正向运行全绿；API/shared typecheck、API lint、`verify:file-internal-auth`、`verify:audit-logs`、`verify:pii-redaction`、AIGC metadata、合规门禁及图谱列出的其余可运行门禁通过。**受当前执行沙箱限制**：`verify-real-resume-diagnosis` 与 `verify:resume-diagnosis-context` 均在绑定本地 `127.0.0.1` stub 时 `listen EPERM`；`verify:file-assets-trial-acceptance` 按设计拒绝冻结 Gate 2 候选之外的运行时代码变化，需主持人刷新对应候选后复验；`graph:check` 因新增端点/门禁要求重生成 `docs/graph/**`，该目录不在本包允许路径。**未做**：前端打印/二维码、导出计费与 consent（包 B/C2/E2 消费契约）、图谱快照刷新、部署、push、PR。

### 包 B · 导出收费开关、模板双源、consent —— grok

- **条目**：P0-7、P0-8、契约 2
- **目标**：`resume_export` 价目行三态 + `/resume/export/pricing` + `assertExportAllowed` + 权益核销幂等 + 失败不扣次；`ai.service.ts:658-666` 模板校验改读数据库（`job-materials.service.ts` 的公开列表）；`/resume/generate/export` 补 `requireActiveConsent`；Admin `/billing` 价目表出现该行且 `SERVICE_LABELS` 有中文名，页头副标题写清「对应一体机 / 小程序简历优化页的导出按钮」。
- **允许改**：`services/api/src/ai/ai.service.ts`（仅导出与模板校验段）、`services/api/src/ai/ai.controller.ts`（仅 export 段）、`services/api/src/ai/dto/resume-generate.dto.ts`、`services/api/src/benefit-redemption/**`（只加）、`services/api/src/payment/**` 中价目读取处（只加 serviceKey）、`apps/admin/src/routes/billing/index.tsx`、`apps/admin/src/services/api/adminBilling.ts`、`packages/shared/src/types/*`（只加）、价目种子脚本、`verify-resume-export-formats` 门禁（它现在钉死「恒放行」，改为断言三态）。
- **禁改**：`apps/kiosk/**`、`apps/miniapp/**`、`services/api/src/ai/resume/**`。
- **验收**：`verify:resume-export-formats`（改后三态断言）、`verify:payment-flow`、`verify:refund-idempotent`（若碰价目）、`verify:audit-logs`、图谱列出的门禁；Admin typecheck / lint；变异测试证明「生成失败不扣次」「同内容不重复扣」两条断言真的会红。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 B · 导出收费开关、模板双源、consent**（分支 `claude/rl-b-export-pricing`，本地候选，未 push、未开 PR、未部署）。条目 P0-7 / P0-8 / 契约 2。① PriceConfig 新增 `serviceKey=resume_export`（unit=`item`）；缺行时 `ensureResumeExportPriceConfig` 插入且不覆盖运营改价（生产默认停用 fail-closed，开发/verify 默认免费启用）。三态：`unitCents=0 && active` → `free`（文案「当前免费，不扣权益」）；`unitCents>0 && active` → `charged`；`active=false` 或缺失 → `unavailable`（不是免费）。② `GET /api/v1/resume/export/pricing` 回 `{ mode, unitCents, unit, benefit, label }`；登录会员在 charged 时附带可用权益次数。③ `assertExportFormatAllowed` 改为 `assertExportAllowed`：free 放行；charged 须登录并核销 `BenefitGrant`（`serviceType=resume_export`，幂等键 = `endUserId:taskId:内容哈希`，同一内容不重复扣）；核销只在文件成功生成后落账；unavailable → 400 `RESUME_EXPORT_UNAVAILABLE`。④ `/resume/generate/export` 补 `requireActiveConsent(endUserId,'resume_ai')`。⑤ 模板校验改读数据库公开 published 列表（空库按 job-materials 同口径幂等补种，不覆盖运营改动）。⑥ Admin `/billing` 价目表 `SERVICE_LABELS.resume_export=简历导出（每次）`，页头副标题写明对应一体机 / 小程序简历优化页的导出按钮。打印公开价目视图只回 `print_bw_page` / `print_color_page`，避免简历导出行漏进收银。**未做**：Kiosk / 小程序价格展示与权益不足置灰（包 C2 / E2 / F）；`POST /resume/records/:taskId/export` 的 consent 与核销由包 A 接同一 `ResumeExportGateService`（本包已 export）。**验证（实跑）**：api/admin/shared `tsc --noEmit` 0；改动文件 eslint 0；`verify:resume-export-formats` ALL PASS（含三态 + 失败不扣次 + 同内容不重复扣）；变异 1 提前扣次 → 6e 红（剩余 1）；变异 2 幂等键加时间戳 → 6f 红（剩余 0）；恢复后全绿。`verify:resume-template-fill` / `resume-layout-export` / `resume-layout-adjust` / `resume-generate` / `resume-optimize` / `admin-billing`（18）/ `admin-billing-ui` / `payment-flow` / `refund-idempotent`（31）/ `pricing` / `print-rollout-config` / `benefit-redemption` / `redemption-audit`（23）/ `audit-logs` / `ai-contract-mirror` / `ai-cost-coverage`（170）/ `throttle-dimension` / `price-single-source` / miniapp `verify:api-contract` 全绿。未部署。

### 包 C · 小程序结果层第一批 —— hermes

- **条目**：P0-1（小程序）、P0-4、P0-5（小程序部分）、诊断方向透传
- **目标**：诊断页渲染 `issues`（维度 / 严重度 / 原文引用 / 影响 / 改法）与 `contentBlocks`，首屏 3 条「先改这些」+ 每维一句人话 +「这不是录取分」，截断 / OCR 顶栏；`resume-parse` 传 `selectedDimensions` / `targetContext`（若小程序无方向表单，至少透传 URL 参数并允许跳过）；优化页接**现有** `POST /resume/generate/export`（四格式 + 打印用 PDF 副本 + 存我的文档提示），复用 `resume-build.js:383-457` 的流程；`resumes.js:47` 的 `format:'PDF'` 改为真实 mime，没有文件写「仅记录，未导出文件」；诊断失败补「打印原件 / 去打印 / 查看岗位」出口；导出后用 `wx.openDocument` 打开真实 PDF 并显示页数 / 大小 / 有效期；修正 `resume-optimize.js:26` 失真注释。
- **允许改**：`apps/miniapp/pages/resume-diagnose/**`、`resume-optimize/**`、`resume-parse/**`、`resumes/**`、`apps/miniapp/utils/normalize.js`、`utils/api.js`（只加）、小程序门禁脚本（只加）。
- **禁改**：`services/api/**`、`apps/kiosk/**`、`packages/**`。报告 PDF 导出与价格展示等契约 1 / 2 消费留到包 C2。
- **验收**：`pnpm --dir apps/miniapp verify:static`（含 `verify:api-contract`）；新增静态断言：诊断页 wxml 引用 `issues`、`resumes.js` 不再硬编码 `'PDF'`；按 `apps/miniapp/README.md` 的开发者工具自动化截图三页（诊断报告 / 优化导出 / 我的简历）。
- **告知**：改动只在本 worktree，用户开发者工具里的主 checkout 看不到；PR 描述里写明。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-07 **包 C2 小程序接诊断报告导出 / 收费三态（分支 `claude/rl-c2-miniapp-contracts`，本地工作区，未部署）**：诊断页接入 `POST /resume/records/:taskId/export` 的诊断报告与修改清单两种 PDF，结果卡展示文件名、页数、大小、有效期及每秒倒计时；打开使用 `signedUrl`，打印透传服务端 `printFileUrl`；会员仅在 `savedToDocuments=true` 时显示「已存入我的文档」，匿名明确为本次临时打开。诊断页与优化页均接 `GET /resume/export/pricing` 三态：免费明示不扣权益，收费展示单价/可用次数并从本人真实权益列表选择 `benefitGrantId`，无权益或匿名收费时禁用，停用/价格加载失败均 fail-closed。新增静态断言覆盖双导出动作、匿名保存文案、三态计费禁用、有效期撤下；两条变异分别证明匿名分支出现「已存」与移除 unavailable 禁用时门禁会红。实跑：API 契约一致（118 个调用端点）、视觉刻度未新增偏离、二维码编码门禁绿、云打印 M2 专项全绿、仓库完整性及 4 条图谱 Profile 守卫全绿。`verify-miniapp-static` 本包新增断言均绿，但整体验证为 119 PASS / 2 FAIL：当前包 C 基线仍缺 `resume-parse` 的方向透传与 `resumes` 的真实格式修正，均不在 C2 允许文件内，本包未越权修改。未生成报告二维码（导出契约没有二维码字段，现有本地编码器只接受到机码）；未做微信开发者工具 / 真机、提交、push、部署或生产验证。

### 包 D · 文档转换引擎（Word → PDF，.doc 接收）—— codex

- **条目**：P0（转换进上线承诺）、P0-9（.doc 三端接收后服务端转换）、契约 3
- **目标**：新模块 `services/api/src/document-conversion/`（允许新增模块，不新增 Prisma 模型）：soffice 适配器 + gotenberg 适配器骨架 + 能力探测 + 转换端点；`resume-extraction.service.ts` 对 `.doc` 走「转换为 PDF → unpdf 抽文字」，引擎不可用时保持现有诚实失败文案并附「服务端未配置转换引擎」；打印链路：`print_doc` purpose 增加 doc/docx 但只在 capabilities 为真时接受，建单前服务端转成派生 PDF 并以派生文件建单（`print-page-count.service.ts` 保持只认 PDF / 图片）；`PhoneUploadPage` / `ResumeSourcePage` / `resume-upload.js` 的 `.doc` 口径统一为「接收」，但这三处前端不在本包改（记进 PR 描述，交包 E3 / C3）。部署：`docs/device/production-deployment-and-windows-host-checklist.md` 增加 LibreOffice / Gotenberg 安装、思源字体、env、探测命令；`.env.example` 增加 `CONVERSION_ENGINE` / `SOFFICE_PATH` / `CONVERSION_MAX_CONCURRENCY`。
- **允许改 / 新增**：`services/api/src/document-conversion/**`（新）、`services/api/src/app.module.ts`（注册）、`services/api/src/files/file-validation.ts`（仅 print_doc 的条件放行）、`services/api/src/print-jobs/print-jobs.service.ts`（建单前转换分支）、`services/api/src/ai/resume/resume-extraction.service.ts`（.doc 分支）、`services/api/.env.example`、`packages/shared/src/types/documentConversion.ts`（新）、`docs/device/production-deployment-and-windows-host-checklist.md`、新门禁 `verify:document-conversion`。
- **禁改**：`apps/**`、`apps/terminal-agent/**`（Agent 仍只打 PDF / 图片）、`services/worker/**`（本包不复活空壳，转换在 API 进程内受并发限制运行；队列化是 P1）。
- **本机现实**：开发 Mac 没有 LibreOffice。门禁用 fake 引擎覆盖契约、超时、并发、归属、能力为假时的 fail-closed；真实引擎的集成测试在 `SOFFICE_PATH` 存在时才跑、缺席时打印醒目 SKIPPED，并把「服务器安装后执行的验收命令」写进部署清单。PR 描述必须写明「真实转换未在本机验证」。
- **验收**：`verify:document-conversion`（含变异测试）、`verify:print-page-count` 或图谱列出的打印门禁、`verify:real-resume-diagnosis`、`verify:file-assets-trial-acceptance`、`verify:file-internal-auth`；API typecheck / lint；`pnpm --dir apps/miniapp verify:api-contract`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 D · 文档转换引擎（分支 `claude/rl-d-doc-conversion`，本地候选，未部署）**。新增 API 内 `document-conversion` 模块：`GET /api/v1/document-conversion/capabilities` 诚实返回 Word 转 PDF 引擎与 CJK 字体探测结果，`POST /api/v1/files/:id/convert` 复用文件归属校验并生成带来源链的派生 PDF；soffice 适配器使用独立临时目录、独立 LibreOffice profile、60 秒超时、并发上限与 15MB 输出上限，Gotenberg 本包只落 fail-closed 骨架。`.doc` 简历提取改为先转 PDF 再走既有 unpdf；`print_doc` 仅在能力探测为真时接收 doc/docx，建单前转换并始终让页数识别和终端任务消费派生 PDF。部署清单补 LibreOffice / Gotenberg、思源字体、环境变量、探测与服务器真转换验收命令。**实跑**：API / shared typecheck、API / shared eslint、`verify:document-conversion`（含 7 条静态断言逐条变异、fake 引擎契约/超时/失败/15MB/并发/归属/.doc 提取/打印派生 PDF）、`verify:resume-extraction`、隔离库 `verify:print-jobs`、`verify:file-internal-auth`、小程序 `verify:api-contract` 及图谱可在本沙箱运行的相关文件/会员/岗位门禁均通过；本机未安装 LibreOffice、未设置 `SOFFICE_PATH`，真实转换集成明确 SKIPPED，必须在服务器安装后按部署清单复验。`verify:real-resume-diagnosis` / `verify:ocr-baidu` 及需本机监听端口、Redis 的 HTTP 门禁受沙箱 `EPERM` / 网络限制未能运行；`verify:file-assets-trial-acceptance` 命中既有冻结候选批次守卫（包 D 新运行时文件属于首轮范围碰撞），未改阈值或白名单。未改 `apps/**`、worker、终端 Agent、Prisma 模型或工作流；未验证真实 Gotenberg/LibreOffice，未 push、未开 PR、未部署。

### 包 E · 一体机诊断报告页（青序流光 22 页迁移）—— grok

- **条目**：P0-1（一体机）、P0-5 的诊断部分
- **目标**：按 `docs/design/kiosk-redesign-2026-08/22-resume-report.html` 把 `/resume/report` 迁进青序流光（`apps/kiosk/src/layouts/KioskRoot.tsx` 的 `QX_MIGRATED_ROUTES` 登记，复用 `styles/qingxu/` 令牌与 `components/qingxu/QxPageFrame.tsx`，样板见取件码页 `pickup-claim-qx.css`）；原型声明的 9 个 `?state=`（loading / report / report-empty / report-minimal / diagnose-failed / read-error / no-context / unavailable / illegal）全部有真实对应；渲染 `issues`（维度 / 严重度 / 原文引用 / 影响 / 改法）、`contentBlocks` 七块、「先改这几处」、每维一句人话、「这不是录取分」、截断 / OCR 顶栏，`report.sections` 为空不出总分；刷新后从服务端回填 `targetContext`；打印 / 导出 / 二维码三个动作本包只做**诚实置灰 + 原因「报告导出端点上线后开放」**（包 E2 接契约 1）。
- **允许改**：`apps/kiosk/src/pages/resume/ResumeReportPage.tsx` 及其拆分出的子组件（>300 行必须拆）、新建 `apps/kiosk/src/pages/resume/resume-report-qx.css`、`apps/kiosk/src/layouts/KioskRoot.tsx`（仅 `QX_MIGRATED_ROUTES` 加一项）、`packages/ui/src/charts/ResumeRadarChart.tsx`（若需）、kiosk 门禁脚本（只加）。
- **禁改**：`apps/kiosk/src/pages/profile/**`（批次守卫）、`services/api/**`、`apps/miniapp/**`。
- **验收**：单页验收六条（`docs/progress/next-tasks.md`「单页验收标准」）：1080×1920 截图与原型并排（`scripts/dev/shot-route.sh`）、每个 state 实测、`data-route` 目标可达、图谱门禁 + kiosk typecheck / lint、触控 ≥48px（用 `?capture=1` 夹具）、合规文案。`verify:kiosk-*` 中图谱列出的全部；`verify:compliance-copy`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 E 一体机诊断报告页青序流光 22 页迁移（分支 `claude/rl-e-kiosk-report-qx`，本地候选，未 push、未部署）**。条目 P0-1（一体机）与 P0-5 诊断部分。`/resume/report` 退出旧 LightFlow 外壳，登记进 `QX_MIGRATED_ROUTES`，复用 `QxPageFrame` + `resume-report-qx.css`。原型 9 个 `?state=`（loading / report / report-empty / report-minimal / diagnose-failed / read-error / no-context / unavailable / illegal）均有真实对应：运行时由读取结果派生，`?capture=1` / `?debug=1` 才开放合成夹具。渲染 `issues`（维度 / 严重度机械分档 / 原文引用 / 影响 / 改法）、`contentBlocks` 七块、「先改这几处」、每维一句人话、「这不是录取分」、截断 / OCR 顶栏；`sections` 为空不出总分；刷新后 `GET /resume/records/:taskId` 回填 `targetContext`。打印 / 导出 / 二维码三键 `aria-disabled` + 常驻原因「报告导出端点上线后开放」（包 E2 接契约 1）。**未做**：导出端点接线、二维码倒计时、原件 `?src=` 预览层、雷达图、生产部署。**验证**：kiosk `tsc --noEmit` 0、eslint 0 error；`verify:resume-report-qx`（36 条变异各红后恢复绿）、`verify:resume-diagnosis-flow-ui`、`verify:fusion-w3`、`verify:lightflow-k2b-ai-resume`、`verify:ai-down-fallbacks`、`verify:kiosk-frontend-debt`、`verify:kiosk-visual-unity`、`verify:compliance-copy`、`verify:repository-integrity` 绿。1080×1920 Playwright 实拍 9 态，`data-state` 对齐、可点区 ≥48px；`scripts/dev/shot-route.sh` 本 worktree 不存在，改用 Playwright。

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

### 第二波详细规格（2026-09-06 补，事实已核 file:line）

#### 包 G · 公共终端与打印救济 —— codex（A / D 合入后起）

- **条目**：P0-10
- **事实**：清场链路已存在（`apps/kiosk/src/auth/KioskPrivacyGuard.tsx`、`useIdleLogout.ts:38` 默认 180s + 30s 预警、`kioskSensitiveSession.ts:31-37` 清敏感键）；前端无共享掩码工具，唯一实现是 `PrintMaterialCheckPage.tsx:157-169` 的私有 `maskSnippet`；`FilePreviewDialog.tsx:5-12` 无 `expiresAt`、无倒计时，登录域有三份私有 `useCountdown`；打印失败全部跳 `/print/done`，「补打」只有文案没有代码路径（`PrintDonePage.tsx:342`）；打印机就绪门禁 `PrintConfirmPage.tsx:169-170, 347-352`。
- **要做**：① 抽 `apps/kiosk/src/hooks/useCountdown.ts` 与 `apps/kiosk/src/utils/maskPii.ts`（从上面两处迁出，原处改为引用）；② `FilePreviewDialog` 增加 `expiresAt` 与 `onRegenerate`，二维码下方显示剩余时间，到期前 30 秒可「重新生成」，过期后二维码隐藏并提示；三个调用点（`ResumeOptimizePage`、`SelfAssessmentFlow`、后续报告页）传入；③ 简历上传页与打印上传页顶部一行「本机不保存你的原文，离开后自动清除」（复用现有清场事实，不新增承诺）；④ 结果页（报告 / 优化 / 我的文档）的空闲清场缩短为 `VITE_KIOSK_RESULT_IDLE_SEC`（默认 90s）+ 15s 可见倒计时预警，全局 180s 不动；⑤ 屏幕上的手机号 / 邮箱默认掩码，提供「显示完整联系方式」开关（不影响导出文件）；⑥ 打印失败救济：`PrintProgressPage` 终态 failed 时在 `/print/done` 显示「文件带走」二维码（凭本单归属重新签发 30 分钟 URL，新增只读端点 `POST /print-jobs/:id/takeaway-url`，归属校验同现有单据）、失败原因中文、订单号与「联系工作人员补打」；已付费失败单允许「重新提交打印」（新增 `POST /print-jobs/:id/retry`：仅 `status=failed` 且订单已付、同一文件、不再计费、幂等，写审计）；⑦ 缺纸 / 脱机：`PrintConfirmPage` 已置灰，补 `PAPER_EMPTY` 状态文案与「不会扣费」说明；⑧ `PrintDonePage` 出纸后「请取走纸张」提醒。
- **允许改**：上述 kiosk 文件与新建 hooks / utils；`services/api/src/print-jobs/print-jobs.controller.ts` / `print-jobs.service.ts`（仅新增两个端点）；`packages/shared/src/types/*`（只加）；`apps/kiosk/.env.example`。
- **禁改**：`apps/kiosk/src/pages/profile/**`、`apps/miniapp/**`、支付 / 退款模块。
- **验收**：`verify:payment-flow`、`verify:refund-idempotent`、图谱列出的打印门禁、`verify:kiosk-cashier-ui`（`VERIFICATION_DATABASE_TARGET=isolated`）、kiosk typecheck / lint；新增断言：retry 不产生新订单、不改金额；takeaway-url 越权 404。资金路径改动在 PR 描述单独列出。

#### 包 H · 草稿 / 版本 / 事实核对（服务端部分）—— codex（B 合入后起）

- **条目**：P0-12、P0-6 的服务端部分。**Kiosk 侧 UI 归包 F（23 页迁移时一并做），本包不改 kiosk。**
- **事实**：`AiResumeResult` 无版本列，`kind` 是自由字符串且 `@@unique([taskId, kind])`（`schema.prisma:1752-1782`）；`persistResult` 是整块覆盖的 upsert（`ai.service.ts:158-204`）；`listAiRecords` 白名单外的 kind 会被降级显示为 `parse`（`member-assets.service.ts:216-226`）。
- **要做（不改 Prisma 模型）**：① 新增 kind 约定：`optimize`（最新 AI 结果）、`optimize_draft`（用户编辑草稿，payload 含 `resume`、`layout`、`decisions`、`updatedAt`）、`optimize_confirmed`（导出时的快照，payload 含 `version` 递增、`confirmedAt`、`fileId`）；② 端点 `PUT /resume/records/:taskId/draft`（登录用户；匿名 404）、`GET /resume/records/:taskId/draft`、`GET /resume/records/:taskId/versions`；重新生成 optimize 不得覆盖 `optimize_confirmed`；③ `listAiRecords` 与 `listResumes` 对 `optimize_draft` / `optimize_confirmed` 的处理：不单独成行，合并进对应 `parse` 行的 `optimized` / `hasDraft` / `latestVersion` 字段（只加字段）；④ 事实核对：`POST /resume/records/:taskId/fact-check` 返回优化稿中的事实项（学校 / 公司 / 时间段 / 证书 / 电话 / 邮箱）及其是否能在原文中找到（复用 `llm-resume-optimize.service.ts:384-510` 的校验函数，抽成可复用的纯函数），导出端点增加 `factsConfirmedAt` 必填（登录用户）——未确认 400 `RESUME_FACTS_NOT_CONFIRMED`；匿名用户由前端弹窗确认后传时间戳；⑤ DOCX 导出补 AIGC 自定义属性（`resume-docx.service.ts` 的 `Document` 增加 `AIGenerated` 等 core properties）。
- **允许改**：`services/api/src/ai/ai.service.ts`（草稿 / 版本 / fact-check 段）、`ai.controller.ts`（新增端点）、`ai/resume/resume-docx.service.ts`、`member-assets/**`（只加字段）、`packages/shared/src/types/ai.ts`（只加）、新门禁 `verify:resume-draft-versions`。
- **验收**：新门禁覆盖 草稿读写归属 / 匿名 404 / 重新生成不覆盖 confirmed / 版本号递增 / fact-check 对编造项报假；`verify:resume-export-formats`、`verify:real-resume-diagnosis`、`verify:member-data-retention`（草稿进导出与注销级联）；`pnpm --dir apps/miniapp verify:api-contract`。

#### 包 I · 小青语音（保留通话 + 长按语音接大模型 + 本次要点）—— grok

- **条目**：拍板第 5 条
- **事实**：ASR 只有 `recognizeWav(buffer)`（`services/api/src/asr/asr.service.ts:78`，16k 单声道 WAV ≤4MB，`ASR_PROVIDER` disabled 时返回 `ASR_NOT_CONFIGURED`）；kiosk 已有 `utils/wavRecorder.ts` + `utils/micCapability.ts`（面试与语音简历在用）；小程序已有 `utils/voice-recorder.js`（语音简历在用）；`POST /assistant/chat`（`ai.controller.ts:415-455`，匿名可用、公共配额）；TRTC 通话面板 `AssistantCallPanel.tsx` 保留；advisor 后端 10 端点无前端（`advisor.controller.ts:92-167`），`advisor-artifact.service.ts:99-138` 已能把 `qa_pins` 渲染成 PDF 落我的文档。
- **要做**：① 新端点 `POST /assistant/voice`（multipart `audio` WAV，`@TerminalScopedThrottle(12)`，公共配额键 `assistant_chat` 共用，WAV 魔数校验同 `ai.controller.ts:85`，返回 `{ text, providerName }`；ASR 未配置返回 `ASR_NOT_CONFIGURED`，前端退回文字输入并说明）；② kiosk `AssistantPage` 文字对话增加「按住说话」按钮（≥56px，`aria-pressed`，松手后显示转写文本，用户可编辑后发送，或开启「语音直接发送」开关）；麦克风不可用 / ASR 未配置时按钮 aria-disabled + 原因，TRTC 通话入口不变；③ 小程序 `assistant` 页同样的长按说话（`voice-recorder.js` + `uploadFile('/assistant/voice')`），录音授权失败退回文字；④ 「本次要点」：`POST /assistant/sessions/:sessionId/summary`（登录用户）让模型把本次对话浓缩为 ≤8 条要点 + ≤5 条待办，落一条 `AdvisorSession`（`source='assistant'`）+ `AdvisorArtifact(kind='qa_pins')`，复用 `advisor-artifact.service.ts` 的 print 生成 PDF（`purpose='print_doc'`，进我的文档，可打印）；kiosk 与小程序在对话区底部提供「保存本次要点」，匿名用户置灰并提示登录；⑤ `/me/ai-records` 增加「问答」分区读取 `AdvisorArtifact`（只加字段），使 `profileEntries.ts:9` 的「问答」成立（**不改 `profileEntries.ts`**，它被 `verify-fusion-w5` 逐字节冻结）。
- **允许改**：`services/api/src/ai/ai.controller.ts`（新增 voice / summary 端点）、`services/api/src/ai/ai.service.ts`（仅 summary 段）、`services/api/src/advisor/**`（只加）、`services/api/src/member-assets/**`（只加）、`apps/kiosk/src/pages/assistant/**`、`apps/kiosk/src/services/api/ai.ts` + 两个 adapter、`apps/miniapp/pages/assistant/**`、`apps/miniapp/utils/api.js`（只加）、`packages/shared/src/types/*`（只加）、新门禁 `verify:assistant-voice`。
- **禁改**：`asr.service.ts`、`AssistantCallPanel.tsx`、`profileEntries.ts`、`apps/kiosk/src/pages/profile/**`。
- **验收**：新门禁（WAV 校验 / 配额 / ASR 未配置诚实 / summary 匿名 404 / 产物落库）；`verify:audit-logs`、`verify:pii-redaction`（语音转写文本不进日志）、`pnpm --dir apps/miniapp verify:static`、kiosk typecheck / lint；触控 ≥56px 实测截图。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 I 小青语音（分支 `claude/rl-i-assistant-voice`，本地候选，未部署、未 push）**。拍板第 5 条：保留 TRTC 通话；文字对话新增长按语音转写与「本次要点」。① `POST /assistant/voice` multipart `audio` WAV，`@TerminalScopedThrottle(12)`，与 chat 共用 `assistant_chat` 日配额，WAV 魔数校验，返回 `{ text, providerName }`；`ASR_NOT_CONFIGURED` 诚实 400，转写正文不进日志/审计。② 一体机 `AssistantPage` 增加「按住说话」（aria-pressed / aria-disabled，Playwright 1080×1920 测高 60px ≥56）与「语音直接发送」；麦克风/ASR 不可用写明原因与恢复条件；TRTC `AssistantCallPanel` 未改。③ 小程序 assistant 长按说话走 `voice-recorder.js` + `uploadFile('/assistant/voice')`，授权失败退回文字。④ 登录用户 `POST /assistant/sessions/:sessionId/summary` 浓缩 ≤8 要点 + ≤5 待办，落 `AdvisorSession`（slotsJson.source=assistant，不改 Prisma 模型）+ `AdvisorArtifact(kind=qa_pins)`，复用 advisor print 进我的文档；匿名 404，前端置灰并提示登录。⑤ `GET /me/ai-records` 只加 `qaRecords`（不改 `profileEntries.ts`）。**未做**：未接 live ASR/LLM、未真机麦克风、未部署、未改 `/me` 记录页 UI（禁改 profile）。**验证**：`verify:assistant-voice` ALL PASS；变异 WAV 校验 / 匿名 summary / qaRecords 各红一次后恢复全绿；`verify:resume-voice-generate`、`verify:ai-public-quota`、`verify:multipart-field-nesting`、`verify:ai-throttle-dimension`、`verify:ai-cost-coverage`、`verify:audit-logs`、`verify:pii-redaction`、`verify:member-assets`、kiosk `verify:assistant-trtc-guard` / `verify:advisor-provider-gate` / `verify:lightflow-k2a-ai-career` / `verify:fusion-w3`、miniapp `verify:static`、`verify:repository-integrity`、`verify:ci-gate-coverage`（新门禁挂在 `verify:resume-voice-generate` 后进 CI 闭包）全绿；api/kiosk/shared tsc 0，改动文件 eslint 0。

#### 包 J · 半实现补全 —— hermes（或 codex）

- **条目**：拍板第 7、8 条；评审 §3.5 的模拟面试 / 签约风险 / 招聘会规划 / AI 记录文案
- **事实**：模拟面试报告与 PDF 不含转写（`mock-interview.service.ts:636-647`、`interview-report-pdf.service.ts:94-129`），会员列表 `GET /me/mock-interviews` 已有（`:534-559`），小程序未封装（`utils/api.js:737-791`），降级题目单 `POST :id/practice-sheet` 小程序未接；`listAiRecords` 只读 `AiResumeResult`（`member-assets.service.ts:194-231`）；合同报告 2 小时 TTL（`contract-review-report-file.service.ts:18-20`）、`listDocuments` 排除 `contract_review_report`（`member-assets.service.ts:100`）、留存锁 `system_short`（`retention-policy.ts:97-100`）、服务端只拦 `contract_upload` 原件打印（`print-jobs.service.ts:227-234`）、报告打印开关只在前端（`contractReviewReportPrintFlow.ts:67-69`）；`fair_visit_plan` 的 `fairId` 只在 `payloadJson.basedOn`（`fair-visit-plan.service.ts:22-27`），`listAiRecords` 刻意不 select payload。
- **要做**：① 模拟面试：报告 DTO 与 PDF 增加「问答摘录」章节（每题问题 + 用户回答转写前 200 字，用户可在结束前勾选「不打印我的回答」）；`MyAiRecordsPage`（kiosk）与小程序 `ai-records` 增加「模拟面试」分区，数据来自 `GET /me/mock-interviews`（**不改 `profileEntries.ts`**）；小程序封装 `/me/mock-interviews`、`DELETE`、`/practice-sheet`（AI 挂时降级题目单）；② 签约风险「可保存、不打印」：结果页「保存到我的文档」（本人确认弹窗，写明保存期限与可删除）→ 服务端 `POST /contract-reviews/:id/report/keep`：把报告 `retentionPolicy` 设为 `months_3`、清除 `retentionLockedReason`、`expiresAt` 延长，`allowedPoliciesForFile` 对 `contract_review_report` 放开 `months_3`（仍不允许 `long_term`），`listDocuments` 对已 keep 的报告不再排除；**服务端打印硬拦**：`print-jobs.service.ts` 对 `purpose='contract_review_report'` 一律 400 `PRINT_CONTRACT_REPORT_FORBIDDEN`，删除前端 `VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT` 开关与打印按钮，我的文档对该类文件不显示「重新打印」；合同原件仍 `system_short`、仍在生成报告时删除；`docs/compliance/compliance-boundary.md` 增补一段引用 feature-scope §2.2 的 2026-09-06 裁定；③ 招聘会规划回看：`listAiRecords` 对 `kind='fair_visit_plan'` 只解析 payload 中的 `basedOn.fairId` / `fairName` 输出为 `ref: { type:'job_fair', id, name }`（窄字段，不放开 payload），kiosk / 小程序记录项可跳转到对应招聘会规划页；④ 小程序模拟面试语音：接 `POST :id/transcribe`（复用 `voice-recorder.js`），无麦克风权限退回文字。
- **允许改**：`services/api/src/mock-interview/**`、`services/api/src/contract-review/**`、`services/api/src/files/retention-policy.ts`（仅上述一行）、`services/api/src/print-jobs/print-jobs.service.ts`（仅新增拦截）、`services/api/src/member-assets/**`（只加）、`apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx`（及其拆分组件）、`apps/kiosk/src/pages/contract-review/**`、`apps/kiosk/src/pages/interview/**`、`apps/miniapp/pages/{ai-records,interview-*,contract-review}/**`、`apps/miniapp/utils/api.js`（只加）、`docs/compliance/compliance-boundary.md`（只加一段）、相关门禁。
- **禁改**：`profileEntries.ts`、`apps/kiosk/src/pages/profile/**` 其他文件（批次守卫）。
- **验收**：`verify:member-data-retention`、图谱列出的 contract-review 与 kiosk 门禁、`verify:audit-logs`、`verify:pii-redaction`、`pnpm --dir apps/miniapp verify:static`；新增断言：contract_review_report 建打印单必 400；keep 后进我的文档且 `allowedRetentionPolicies` 不含 long_term；面试记录分区数据来自 `/me/mock-interviews`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 J 半实现补全（分支 `claude/rl-j-half-done`，本地候选，未部署）**：拍板第 7、8 条与评审 §3.5。① 模拟面试报告 DTO / PDF 增加问答摘录（回答前 200 字），结束前可勾选「不打印我的回答」；一体机 `MyAiRecordsPage` 与小程序 `ai-records` 增加模拟面试分区，数据来自 `GET /me/mock-interviews`（未改 `profileEntries.ts`）；小程序封装列表 / 删除 / 降级题目单，并接 `POST :id/transcribe`（无麦权限退回文字）。② 签约风险「可保存、不打印」：`POST /contract-reviews/:id/report/keep` 把报告改为 `months_3` 并解锁；`listDocuments` 对已 keep 报告不再排除；`print-jobs` 对 `purpose=contract_review_report` 一律 400 `PRINT_CONTRACT_REPORT_FORBIDDEN`；删除一体机打印开关与打印按钮；合规边界增补 §4.8。③ `listAiRecords` 对 `fair_visit_plan` 只输出 `ref: { type:'job_fair', id, name }`，两端可跳转规划页。**验证（实跑）**：api/kiosk `tsc --noEmit` 0；改动 TS eslint `--max-warnings=0` 0；`verify:member-data-retention` ALL PASS（含 keep 后进文档、months_3 不含 long_term、建打印单必 400）；隔离库 `verify:print-jobs` ALL PASS（1b/1c FORBIDDEN）；`verify:mock-interview` 23 PASS；`verify:member-assets-c2d` 10 PASS（fair_visit_plan 只带 fairId/fairName）；contract-review units 33 + 其余 29 PASS / 1 SKIP（无 POSTGRES_URL）；`verify:audit-logs` / `verify:pii-redaction` / `verify:file-retention` / `verify:contract-review-http` / preprod-readiness ALL PASS；kiosk 静态门禁（report-print / session / visible-actions / k2c 105 / profile-entry / ai-records-inkpaper / inkpaper-home / documents-inkpaper / fusion-w5 / commercial-first-batch / print-url / ai-down 24 files / file-retention-ui / job-fit-m1-5 / job-ai-history-privacy）全绿；`verify-miniapp-static` 115/0、api-contract 一致（快照补 5 个新封装端点）、pickup-qrcode / visual-scale 绿。变异：改 FORBIDDEN 码名 → print-jobs 1b 红；去掉 `getMyInterviews` → ai-records 分区断言红；去掉 `months_3` → retention 门禁红；恢复后全绿。**未做**：未改 `MyDocumentsPage` / 小程序 `pages/documents/**`（批次守卫与允许路径禁改），「重新打印」按钮仍显示，点了会被服务端 400（`reprintable=false` 已回传，前台未接线）；未改 `profileEntries.ts` 文案；未做浏览器/开发者工具点选验收；未 push、未开 PR、未部署。

#### 包 K1 · 中文字体包与启动自检 —— codex

- **条目**：P0-11（三端 `.doc` UI 归 K2，待包 D 合入）
- **事实**：9 份各自漂移的字体解析实现（`resume-pdf.service.ts:28-55,120-147`、`advisor-pdf.service.ts:20-79`、`contract-review-report-pdf.service.ts:14-153`、`fair-visit-plan-pdf.service.ts:17-81`、`self-assessment-pdf.service.ts:17-72`、`job-fit-pdf.service.ts:12-78`、`interview-report-pdf.service.ts:15-58`、`career-plan-pdf.service.ts:15-83`、`job-material-pdf.service.ts:15-105`、`jobs/fair-company-print.service.ts:97-277`），env 名不一致（`RESUME_PDF_FONT_PATH` vs `JOB_MATERIAL_PDF_FONT_PATH`）；启动门禁 `config/production-runtime-gates.ts:97-101` 只在 production 生效且无字体项；部署清单 `docs/device/production-deployment-and-windows-host-checklist.md` 零字体内容；预生产曾因缺字体事故（`docs/acceptance/user-file-assets-preprod-execution-record.md:161`）。
- **要做**：① 新建 `services/api/src/common/pdf/cjk-font.ts`：统一候选路径（以 `resume-pdf.service.ts:33-52` 为最全版本）、`RESUME_PDF_FONT_PATH` / `_FAMILY` 优先、`JOB_MATERIAL_PDF_FONT_PATH` 兼容回退、`resolveCjkFont()` 带进程内缓存、`registerCjkFont(doc)`、`probeCjkFont(): { ok, path, family, tried[] }`；② 10 处改为调用公共模块，**保留各自现有错误码**；③ 启动自检：`production-runtime-gates.ts` 在 production 缺字体即 `PRODUCTION_CJK_FONT_MISSING` 拒绝启动；非 production 只打 warn（含 tried 路径）；新增管理员可读的探测端点（若已有 health 控制器则只加一个路由）返回探测结果；④ 部署清单 §3.2 增加字体环境变量、§3.1 增加 `fonts-noto-cjk` / 思源字体安装与 `fc-list :lang=zh` 核对命令、§3.6 增加 `verify:resume-generate` 与新门禁；`.env.example` 注释说明；⑤ 缺字体时导出接口返回的错误文案统一为「服务器缺少中文字体，已通知运维；你可以先打印原件或扫码保存」（各端已有错误码映射处只改文案表，不改错误码）。
- **允许改**：上述 10 个 PDF service、`common/pdf/cjk-font.ts`（新）、`config/production-runtime-gates.ts`、`main.ts`、health 控制器（若已有则只加）、`.env.example`、部署清单、新门禁 `verify:cjk-font`（变异测试：删候选路径必红）。
- **禁改**：`apps/**`、`packages/**`。
- **验收**：`verify:production-runtime-gates`、`verify:aigc-pdf-metadata`、`verify:resume-generate`、图谱列出的所有 PDF 相关门禁；API typecheck / lint；新门禁。

## 第三波（P1 补全，商用完整）

≥3 套真实模板 + 真实缩略图；DOCX 吃 layout / 模板；具名多版本与对比；跨端续办；PDF → 图片；gotenberg 适配器 + 队列化；Puppeteer 替换 pdfkit 评估；缩略图；助手会话要点；政策核对材料清单出纸。

## 收货标准（主持人）

1. PR 只含本包允许路径；`gh pr checks` 三条（build-and-verify / kiosk-browser-smoke / postgres-readiness）全绿，watcher 核对 workflow=CI 且 headSha 一致后 squash 合并。
2. 逐条目对照本文件核状态；「skipped」必须有原因。
3. 一体机页面由 Claude 用 1080×1920 截图对比原型验收；小程序由开发者工具自动化截图验收。
4. 合入后 `docs/progress/current-progress.md` 顶部已有该包记录；本文件对应包标「已合入 #n」。
