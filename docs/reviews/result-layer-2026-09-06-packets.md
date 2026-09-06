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

- **已合入 main**：#866（squash `d09478b14`，2026-09-07）。
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

- **已合入 main**：#851（squash `e98a20cf4`，2026-09-07）。
- **条目**：P0-7、P0-8、契约 2
- **目标**：`resume_export` 价目行三态 + `/resume/export/pricing` + `assertExportAllowed` + 权益核销幂等 + 失败不扣次；`ai.service.ts:658-666` 模板校验改读数据库（`job-materials.service.ts` 的公开列表）；`/resume/generate/export` 补 `requireActiveConsent`；Admin `/billing` 价目表出现该行且 `SERVICE_LABELS` 有中文名，页头副标题写清「对应一体机 / 小程序简历优化页的导出按钮」。
- **允许改**：`services/api/src/ai/ai.service.ts`（仅导出与模板校验段）、`services/api/src/ai/ai.controller.ts`（仅 export 段）、`services/api/src/ai/dto/resume-generate.dto.ts`、`services/api/src/benefit-redemption/**`（只加）、`services/api/src/payment/**` 中价目读取处（只加 serviceKey）、`apps/admin/src/routes/billing/index.tsx`、`apps/admin/src/services/api/adminBilling.ts`、`packages/shared/src/types/*`（只加）、价目种子脚本、`verify-resume-export-formats` 门禁（它现在钉死「恒放行」，改为断言三态）。
- **禁改**：`apps/kiosk/**`、`apps/miniapp/**`、`services/api/src/ai/resume/**`。
- **验收**：`verify:resume-export-formats`（改后三态断言）、`verify:payment-flow`、`verify:refund-idempotent`（若碰价目）、`verify:audit-logs`、图谱列出的门禁；Admin typecheck / lint；变异测试证明「生成失败不扣次」「同内容不重复扣」两条断言真的会红。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 B · 导出收费开关、模板双源、consent**（分支 `claude/rl-b-export-pricing`，本地候选，未 push、未开 PR、未部署）。条目 P0-7 / P0-8 / 契约 2。① PriceConfig 新增 `serviceKey=resume_export`（unit=`item`）；缺行时 `ensureResumeExportPriceConfig` 插入且不覆盖运营改价（生产默认停用 fail-closed，开发/verify 默认免费启用）。三态：`unitCents=0 && active` → `free`（文案「当前免费，不扣权益」）；`unitCents>0 && active` → `charged`；`active=false` 或缺失 → `unavailable`（不是免费）。② `GET /api/v1/resume/export/pricing` 回 `{ mode, unitCents, unit, benefit, label }`；登录会员在 charged 时附带可用权益次数。③ `assertExportFormatAllowed` 改为 `assertExportAllowed`：free 放行；charged 须登录并核销 `BenefitGrant`（`serviceType=resume_export`，幂等键 = `endUserId:taskId:内容哈希`，同一内容不重复扣）；核销只在文件成功生成后落账；unavailable → 400 `RESUME_EXPORT_UNAVAILABLE`。④ `/resume/generate/export` 补 `requireActiveConsent(endUserId,'resume_ai')`。⑤ 模板校验改读数据库公开 published 列表（空库按 job-materials 同口径幂等补种，不覆盖运营改动）。⑥ Admin `/billing` 价目表 `SERVICE_LABELS.resume_export=简历导出（每次）`，页头副标题写明对应一体机 / 小程序简历优化页的导出按钮。打印公开价目视图只回 `print_bw_page` / `print_color_page`，避免简历导出行漏进收银。**未做**：Kiosk / 小程序价格展示与权益不足置灰（包 C2 / E2 / F）；`POST /resume/records/:taskId/export` 的 consent 与核销由包 A 接同一 `ResumeExportGateService`（本包已 export）。**验证（实跑）**：api/admin/shared `tsc --noEmit` 0；改动文件 eslint 0；`verify:resume-export-formats` ALL PASS（含三态 + 失败不扣次 + 同内容不重复扣）；变异 1 提前扣次 → 6e 红（剩余 1）；变异 2 幂等键加时间戳 → 6f 红（剩余 0）；恢复后全绿。`verify:resume-template-fill` / `resume-layout-export` / `resume-layout-adjust` / `resume-generate` / `resume-optimize` / `admin-billing`（18）/ `admin-billing-ui` / `payment-flow` / `refund-idempotent`（31）/ `pricing` / `print-rollout-config` / `benefit-redemption` / `redemption-audit`（23）/ `audit-logs` / `ai-contract-mirror` / `ai-cost-coverage`（170）/ `throttle-dimension` / `price-single-source` / miniapp `verify:api-contract` 全绿。未部署。

### 包 C · 小程序结果层第一批 —— hermes

- **已合入 main**：#861（squash `174a6561e`，2026-09-07）。
- **C2（小程序接契约 1 / 2）已合入 main**：#875（squash `588fbaf6b`，2026-09-07）；执行记录见下方。
- **条目**：P0-1（小程序）、P0-4、P0-5（小程序部分）、诊断方向透传
- **目标**：诊断页渲染 `issues`（维度 / 严重度 / 原文引用 / 影响 / 改法）与 `contentBlocks`，首屏 3 条「先改这些」+ 每维一句人话 +「这不是录取分」，截断 / OCR 顶栏；`resume-parse` 传 `selectedDimensions` / `targetContext`（若小程序无方向表单，至少透传 URL 参数并允许跳过）；优化页接**现有** `POST /resume/generate/export`（四格式 + 打印用 PDF 副本 + 存我的文档提示），复用 `resume-build.js:383-457` 的流程；`resumes.js:47` 的 `format:'PDF'` 改为真实 mime，没有文件写「仅记录，未导出文件」；诊断失败补「打印原件 / 去打印 / 查看岗位」出口；导出后用 `wx.openDocument` 打开真实 PDF 并显示页数 / 大小 / 有效期；修正 `resume-optimize.js:26` 失真注释。
- **允许改**：`apps/miniapp/pages/resume-diagnose/**`、`resume-optimize/**`、`resume-parse/**`、`resumes/**`、`apps/miniapp/utils/normalize.js`、`utils/api.js`（只加）、小程序门禁脚本（只加）。
- **禁改**：`services/api/**`、`apps/kiosk/**`、`packages/**`。报告 PDF 导出与价格展示等契约 1 / 2 消费留到包 C2。
- **验收**：`pnpm --dir apps/miniapp verify:static`（含 `verify:api-contract`）；新增静态断言：诊断页 wxml 引用 `issues`、`resumes.js` 不再硬编码 `'PDF'`；按 `apps/miniapp/README.md` 的开发者工具自动化截图三页（诊断报告 / 优化导出 / 我的简历）。
- **告知**：改动只在本 worktree，用户开发者工具里的主 checkout 看不到；PR 描述里写明。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-07 **包 C2 小程序接诊断报告导出 / 收费三态（分支 `claude/rl-c2-miniapp-contracts`，本地工作区，未部署）**：诊断页接入 `POST /resume/records/:taskId/export` 的诊断报告与修改清单两种 PDF，结果卡展示文件名、页数、大小、有效期及每秒倒计时；打开使用 `signedUrl`，打印透传服务端 `printFileUrl`；会员仅在 `savedToDocuments=true` 时显示「已存入我的文档」，匿名明确为本次临时打开。诊断页与优化页均接 `GET /resume/export/pricing` 三态：免费明示不扣权益，收费展示单价/可用次数并从本人真实权益列表选择 `benefitGrantId`，无权益或匿名收费时禁用，停用/价格加载失败均 fail-closed。新增静态断言覆盖双导出动作、匿名保存文案、三态计费禁用、有效期撤下；两条变异分别证明匿名分支出现「已存」与移除 unavailable 禁用时门禁会红。实跑：API 契约一致（118 个调用端点）、视觉刻度未新增偏离、二维码编码门禁绿、云打印 M2 专项全绿、仓库完整性及 4 条图谱 Profile 守卫全绿。`verify-miniapp-static` 本包新增断言均绿，但整体验证为 119 PASS / 2 FAIL：当前包 C 基线仍缺 `resume-parse` 的方向透传与 `resumes` 的真实格式修正，均不在 C2 允许文件内，本包未越权修改。未生成报告二维码（导出契约没有二维码字段，现有本地编码器只接受到机码）；未做微信开发者工具 / 真机、提交、push、部署或生产验证。

### 包 D · 文档转换引擎（Word → PDF，.doc 接收）—— codex

- **已合入 main**：#853（squash `ae33b4fa7`，2026-09-07）。
- **条目**：P0（转换进上线承诺）、P0-9（.doc 三端接收后服务端转换）、契约 3
- **目标**：新模块 `services/api/src/document-conversion/`（允许新增模块，不新增 Prisma 模型）：soffice 适配器 + gotenberg 适配器骨架 + 能力探测 + 转换端点；`resume-extraction.service.ts` 对 `.doc` 走「转换为 PDF → unpdf 抽文字」，引擎不可用时保持现有诚实失败文案并附「服务端未配置转换引擎」；打印链路：`print_doc` purpose 增加 doc/docx 但只在 capabilities 为真时接受，建单前服务端转成派生 PDF 并以派生文件建单（`print-page-count.service.ts` 保持只认 PDF / 图片）；`PhoneUploadPage` / `ResumeSourcePage` / `resume-upload.js` 的 `.doc` 口径统一为「接收」，但这三处前端不在本包改（记进 PR 描述，交包 E3 / C3）。部署：`docs/device/production-deployment-and-windows-host-checklist.md` 增加 LibreOffice / Gotenberg 安装、思源字体、env、探测命令；`.env.example` 增加 `CONVERSION_ENGINE` / `SOFFICE_PATH` / `CONVERSION_MAX_CONCURRENCY`。
- **允许改 / 新增**：`services/api/src/document-conversion/**`（新）、`services/api/src/app.module.ts`（注册）、`services/api/src/files/file-validation.ts`（仅 print_doc 的条件放行）、`services/api/src/print-jobs/print-jobs.service.ts`（建单前转换分支）、`services/api/src/ai/resume/resume-extraction.service.ts`（.doc 分支）、`services/api/.env.example`、`packages/shared/src/types/documentConversion.ts`（新）、`docs/device/production-deployment-and-windows-host-checklist.md`、新门禁 `verify:document-conversion`。
- **禁改**：`apps/**`、`apps/terminal-agent/**`（Agent 仍只打 PDF / 图片）、`services/worker/**`（本包不复活空壳，转换在 API 进程内受并发限制运行；队列化是 P1）。
- **本机现实**：开发 Mac 没有 LibreOffice。门禁用 fake 引擎覆盖契约、超时、并发、归属、能力为假时的 fail-closed；真实引擎的集成测试在 `SOFFICE_PATH` 存在时才跑、缺席时打印醒目 SKIPPED，并把「服务器安装后执行的验收命令」写进部署清单。PR 描述必须写明「真实转换未在本机验证」。
- **验收**：`verify:document-conversion`（含变异测试）、`verify:print-page-count` 或图谱列出的打印门禁、`verify:real-resume-diagnosis`、`verify:file-assets-trial-acceptance`、`verify:file-internal-auth`；API typecheck / lint；`pnpm --dir apps/miniapp verify:api-contract`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：

### 包 E · 一体机诊断报告页（青序流光 22 页迁移）—— grok

- **已合入 main**：#855（squash `d63289219`，2026-09-07）。
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

- **已合入 main**：#870（squash `64fd6c78e`，2026-09-07）。
- **条目**：P0-10
- **事实**：清场链路已存在（`apps/kiosk/src/auth/KioskPrivacyGuard.tsx`、`useIdleLogout.ts:38` 默认 180s + 30s 预警、`kioskSensitiveSession.ts:31-37` 清敏感键）；前端无共享掩码工具，唯一实现是 `PrintMaterialCheckPage.tsx:157-169` 的私有 `maskSnippet`；`FilePreviewDialog.tsx:5-12` 无 `expiresAt`、无倒计时，登录域有三份私有 `useCountdown`；打印失败全部跳 `/print/done`，「补打」只有文案没有代码路径（`PrintDonePage.tsx:342`）；打印机就绪门禁 `PrintConfirmPage.tsx:169-170, 347-352`。
- **要做**：① 抽 `apps/kiosk/src/hooks/useCountdown.ts` 与 `apps/kiosk/src/utils/maskPii.ts`（从上面两处迁出，原处改为引用）；② `FilePreviewDialog` 增加 `expiresAt` 与 `onRegenerate`，二维码下方显示剩余时间，到期前 30 秒可「重新生成」，过期后二维码隐藏并提示；三个调用点（`ResumeOptimizePage`、`SelfAssessmentFlow`、后续报告页）传入；③ 简历上传页与打印上传页顶部一行「本机不保存你的原文，离开后自动清除」（复用现有清场事实，不新增承诺）；④ 结果页（报告 / 优化 / 我的文档）的空闲清场缩短为 `VITE_KIOSK_RESULT_IDLE_SEC`（默认 90s）+ 15s 可见倒计时预警，全局 180s 不动；⑤ 屏幕上的手机号 / 邮箱默认掩码，提供「显示完整联系方式」开关（不影响导出文件）；⑥ 打印失败救济：`PrintProgressPage` 终态 failed 时在 `/print/done` 显示「文件带走」二维码（凭本单归属重新签发 30 分钟 URL，新增只读端点 `POST /print-jobs/:id/takeaway-url`，归属校验同现有单据）、失败原因中文、订单号与「联系工作人员补打」；已付费失败单允许「重新提交打印」（新增 `POST /print-jobs/:id/retry`：仅 `status=failed` 且订单已付、同一文件、不再计费、幂等，写审计）；⑦ 缺纸 / 脱机：`PrintConfirmPage` 已置灰，补 `PAPER_EMPTY` 状态文案与「不会扣费」说明；⑧ `PrintDonePage` 出纸后「请取走纸张」提醒。
- **允许改**：上述 kiosk 文件与新建 hooks / utils；`services/api/src/print-jobs/print-jobs.controller.ts` / `print-jobs.service.ts`（仅新增两个端点）；`packages/shared/src/types/*`（只加）；`apps/kiosk/.env.example`。
- **禁改**：`apps/kiosk/src/pages/profile/**`、`apps/miniapp/**`、支付 / 退款模块。
- **验收**：`verify:payment-flow`、`verify:refund-idempotent`、图谱列出的打印门禁、`verify:kiosk-cashier-ui`（`VERIFICATION_DATABASE_TARGET=isolated`）、kiosk typecheck / lint；新增断言：retry 不产生新订单、不改金额；takeaway-url 越权 404。资金路径改动在 PR 描述单独列出。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 G · 公共终端与打印救济（分支 `claude/rl-g-terminal-rescue`，基于包 D，本地候选，未部署）**。P0-10：抽出 kiosk `useCountdown` / `maskPii`，`FilePreviewDialog` 增加 `expiresAt` 倒计时与到期前「重新生成」；简历/打印上传页顶部写清「本机不保存你的原文，离开后自动清除」；结果页空闲清场改为 `VITE_KIOSK_RESULT_IDLE_SEC`（默认 90s + 15s 预警），全局 180s 不动；屏幕联系方式默认掩码并提供「显示完整联系方式」。打印失败在 `/print/done` 给出「文件带走」二维码、中文原因、订单号和「联系工作人员补打」；已付费失败单可 `POST /print/jobs/:id/retry`（同一订单同一金额、不再计费、幂等）；`POST /print/jobs/:id/takeaway-url` 越权 404。确认页缺纸/脱机补「不会扣费」；完成页出纸后提醒「请取走纸张」。**实跑**：kiosk/shared/api typecheck 0；改动文件 eslint 0；隔离库 `verify:print-jobs`（含 8a–8h 带走越权 404、retry 不改金额/不新开订单、幂等、UNCONFIRMED 禁重提）/ `verify:payment-flow` / `verify:refund-idempotent`（31）/ `verify:kiosk-cashier-ui`（34）/ `verify:print-scan-first-release` 全绿；kiosk `verify:print-done-truth` / `verify:print-confirm-honest` / `verify:resume-phone-upload-ui` / `verify:kiosk-feedback-entry` / fusion-w2/w3 / lightflow-k2b / 其它图谱相关静态门禁全绿。变异：retry 回包金额 +1 → 8d 红；takeaway 去掉归属校验 → 8a 红；恢复后全绿。**未改** `apps/kiosk/src/pages/profile/**`、`apps/miniapp/**`、支付/退款模块、包 D 已提交内容。**未部署、未 push、未开 PR**。资金路径：retry 只把已付费 `failed` 任务重新入队，不新建订单、不改 `amountCents`、不调支付或退款。

#### 包 H · 草稿 / 版本 / 事实核对（服务端部分）—— codex（B 合入后起）

- **已合入 main**：#873（squash `fb734fca7`，2026-09-07）。
- **条目**：P0-12、P0-6 的服务端部分。**Kiosk 侧 UI 归包 F（23 页迁移时一并做），本包不改 kiosk。**
- **事实**：`AiResumeResult` 无版本列，`kind` 是自由字符串且 `@@unique([taskId, kind])`（`schema.prisma:1752-1782`）；`persistResult` 是整块覆盖的 upsert（`ai.service.ts:158-204`）；`listAiRecords` 白名单外的 kind 会被降级显示为 `parse`（`member-assets.service.ts:216-226`）。
- **要做（不改 Prisma 模型）**：① 新增 kind 约定：`optimize`（最新 AI 结果）、`optimize_draft`（用户编辑草稿，payload 含 `resume`、`layout`、`decisions`、`updatedAt`）、`optimize_confirmed`（导出时的快照，payload 含 `version` 递增、`confirmedAt`、`fileId`）；② 端点 `PUT /resume/records/:taskId/draft`（登录用户；匿名 404）、`GET /resume/records/:taskId/draft`、`GET /resume/records/:taskId/versions`；重新生成 optimize 不得覆盖 `optimize_confirmed`；③ `listAiRecords` 与 `listResumes` 对 `optimize_draft` / `optimize_confirmed` 的处理：不单独成行，合并进对应 `parse` 行的 `optimized` / `hasDraft` / `latestVersion` 字段（只加字段）；④ 事实核对：`POST /resume/records/:taskId/fact-check` 返回优化稿中的事实项（学校 / 公司 / 时间段 / 证书 / 电话 / 邮箱）及其是否能在原文中找到（复用 `llm-resume-optimize.service.ts:384-510` 的校验函数，抽成可复用的纯函数），导出端点增加 `factsConfirmedAt` 必填（登录用户）——未确认 400 `RESUME_FACTS_NOT_CONFIRMED`；匿名用户由前端弹窗确认后传时间戳；⑤ DOCX 导出补 AIGC 自定义属性（`resume-docx.service.ts` 的 `Document` 增加 `AIGenerated` 等 core properties）。
- **允许改**：`services/api/src/ai/ai.service.ts`（草稿 / 版本 / fact-check 段）、`ai.controller.ts`（新增端点）、`ai/resume/resume-docx.service.ts`、`member-assets/**`（只加字段）、`packages/shared/src/types/ai.ts`（只加）、新门禁 `verify:resume-draft-versions`。
- **验收**：新门禁覆盖 草稿读写归属 / 匿名 404 / 重新生成不覆盖 confirmed / 版本号递增 / fact-check 对编造项报假；`verify:resume-export-formats`、`verify:real-resume-diagnosis`、`verify:member-data-retention`（草稿进导出与注销级联）；`pnpm --dir apps/miniapp verify:api-contract`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-07 **包 H · 草稿 / 版本 / 事实核对（服务端）**（分支 `claude/rl-h-draft-versions`，基于包 B `claude/rl-b-export-pricing`，本地候选，未 push、未开 PR、未部署）。条目 P0-12 服务端 + P0-6 服务端（Kiosk UI 归包 F，本包未改 kiosk / miniapp）。不改 Prisma 模型。① `AiResumeResult.kind` 约定 `optimize` / `optimize_draft` / `optimize_confirmed`；`persistResult` 仍只写 parse|optimize|generate，草稿与确认快照走独立 kind，重新生成 optimize 不覆盖 confirmed。② `PUT/GET /resume/records/:taskId/draft`、`GET /resume/records/:taskId/versions`：仅登录用户，匿名与越权统一 404 `AI_TASK_NOT_FOUND`。③ `listResumes` / `listAiRecords` 不把 draft/confirmed 单独成行，合并进对应 parse 行的 `optimized` / `hasDraft` / `latestVersion`。④ `POST /resume/records/:taskId/fact-check` 抽出 `resume-fact-match.ts` 纯函数（学校/公司/时间段/证书/电话/邮箱是否能在原文找到）；登录用户导出优化稿必填 `factsConfirmedAt`，未确认 400 `RESUME_FACTS_NOT_CONFIRMED`；成功导出递增 `optimize_confirmed.version`。⑤ DOCX `Document` 写 `AIGenerated` 等 core/custom 属性。删除 parse 仍按 taskId 级联草稿与确认快照（同一 24h TTL）。**未做**：Kiosk 草稿自动保存 / 事实核对墙 UI（包 F）；小程序接线（包 C2）；具名多版本对比（P1）；账号注销仍未开放，草稿随既有 AiResumeResult 清理。**验证（实跑）**：api/shared/kiosk `tsc --noEmit` 0；改动文件 eslint 0；`verify:resume-draft-versions` ALL PASS；变异：编造项恒 true→5a 红、列表不排除 hidden kind→0c 红、DOCX AIGenerated=false→7b 红、跳过 factsConfirmedAt→4a 红、版本不递增→4b 红，恢复后全绿。`verify:resume-export-formats` / `verify-real-resume-diagnosis` / `verify:member-data-retention` / `verify:member-assets` / `verify:ai-result-ownership` / `verify:ai-contract-mirror` / `verify:resume-optimize` / `verify:resume-layout-export` / `verify:resume-layout-adjust` / miniapp `verify:api-contract` / `verify:repository-integrity` / `verify:ci-gate-coverage` 全绿。`verify:resume-template-fill` 本 worktree 报 `AI_RESUME_TEMPLATE_UNSUPPORTED`（缺 `resume-template-clean` 已发布模板行，与草稿改动无关：该用例无 taskId、未走事实核对）。未部署。

#### 包 I · 小青语音（保留通话 + 长按语音接大模型 + 本次要点）—— grok

- **已合入 main**：#857（squash `17d95271a`，2026-09-07）。
- **条目**：拍板第 5 条
- **事实**：ASR 只有 `recognizeWav(buffer)`（`services/api/src/asr/asr.service.ts:78`，16k 单声道 WAV ≤4MB，`ASR_PROVIDER` disabled 时返回 `ASR_NOT_CONFIGURED`）；kiosk 已有 `utils/wavRecorder.ts` + `utils/micCapability.ts`（面试与语音简历在用）；小程序已有 `utils/voice-recorder.js`（语音简历在用）；`POST /assistant/chat`（`ai.controller.ts:415-455`，匿名可用、公共配额）；TRTC 通话面板 `AssistantCallPanel.tsx` 保留；advisor 后端 10 端点无前端（`advisor.controller.ts:92-167`），`advisor-artifact.service.ts:99-138` 已能把 `qa_pins` 渲染成 PDF 落我的文档。
- **要做**：① 新端点 `POST /assistant/voice`（multipart `audio` WAV，`@TerminalScopedThrottle(12)`，公共配额键 `assistant_chat` 共用，WAV 魔数校验同 `ai.controller.ts:85`，返回 `{ text, providerName }`；ASR 未配置返回 `ASR_NOT_CONFIGURED`，前端退回文字输入并说明）；② kiosk `AssistantPage` 文字对话增加「按住说话」按钮（≥56px，`aria-pressed`，松手后显示转写文本，用户可编辑后发送，或开启「语音直接发送」开关）；麦克风不可用 / ASR 未配置时按钮 aria-disabled + 原因，TRTC 通话入口不变；③ 小程序 `assistant` 页同样的长按说话（`voice-recorder.js` + `uploadFile('/assistant/voice')`），录音授权失败退回文字；④ 「本次要点」：`POST /assistant/sessions/:sessionId/summary`（登录用户）让模型把本次对话浓缩为 ≤8 条要点 + ≤5 条待办，落一条 `AdvisorSession`（`source='assistant'`）+ `AdvisorArtifact(kind='qa_pins')`，复用 `advisor-artifact.service.ts` 的 print 生成 PDF（`purpose='print_doc'`，进我的文档，可打印）；kiosk 与小程序在对话区底部提供「保存本次要点」，匿名用户置灰并提示登录；⑤ `/me/ai-records` 增加「问答」分区读取 `AdvisorArtifact`（只加字段），使 `profileEntries.ts:9` 的「问答」成立（**不改 `profileEntries.ts`**，它被 `verify-fusion-w5` 逐字节冻结）。
- **允许改**：`services/api/src/ai/ai.controller.ts`（新增 voice / summary 端点）、`services/api/src/ai/ai.service.ts`（仅 summary 段）、`services/api/src/advisor/**`（只加）、`services/api/src/member-assets/**`（只加）、`apps/kiosk/src/pages/assistant/**`、`apps/kiosk/src/services/api/ai.ts` + 两个 adapter、`apps/miniapp/pages/assistant/**`、`apps/miniapp/utils/api.js`（只加）、`packages/shared/src/types/*`（只加）、新门禁 `verify:assistant-voice`。
- **禁改**：`asr.service.ts`、`AssistantCallPanel.tsx`、`profileEntries.ts`、`apps/kiosk/src/pages/profile/**`。
- **验收**：新门禁（WAV 校验 / 配额 / ASR 未配置诚实 / summary 匿名 404 / 产物落库）；`verify:audit-logs`、`verify:pii-redaction`（语音转写文本不进日志）、`pnpm --dir apps/miniapp verify:static`、kiosk typecheck / lint；触控 ≥56px 实测截图。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 I 小青语音（分支 `claude/rl-i-assistant-voice`，本地候选，未部署、未 push）**。拍板第 5 条：保留 TRTC 通话；文字对话新增长按语音转写与「本次要点」。① `POST /assistant/voice` multipart `audio` WAV，`@TerminalScopedThrottle(12)`，与 chat 共用 `assistant_chat` 日配额，WAV 魔数校验，返回 `{ text, providerName }`；`ASR_NOT_CONFIGURED` 诚实 400，转写正文不进日志/审计。② 一体机 `AssistantPage` 增加「按住说话」（aria-pressed / aria-disabled，Playwright 1080×1920 测高 60px ≥56）与「语音直接发送」；麦克风/ASR 不可用写明原因与恢复条件；TRTC `AssistantCallPanel` 未改。③ 小程序 assistant 长按说话走 `voice-recorder.js` + `uploadFile('/assistant/voice')`，授权失败退回文字。④ 登录用户 `POST /assistant/sessions/:sessionId/summary` 浓缩 ≤8 要点 + ≤5 待办，落 `AdvisorSession`（slotsJson.source=assistant，不改 Prisma 模型）+ `AdvisorArtifact(kind=qa_pins)`，复用 advisor print 进我的文档；匿名 404，前端置灰并提示登录。⑤ `GET /me/ai-records` 只加 `qaRecords`（不改 `profileEntries.ts`）。**未做**：未接 live ASR/LLM、未真机麦克风、未部署、未改 `/me` 记录页 UI（禁改 profile）。**验证**：`verify:assistant-voice` ALL PASS；变异 WAV 校验 / 匿名 summary / qaRecords 各红一次后恢复全绿；`verify:resume-voice-generate`、`verify:ai-public-quota`、`verify:multipart-field-nesting`、`verify:ai-throttle-dimension`、`verify:ai-cost-coverage`、`verify:audit-logs`、`verify:pii-redaction`、`verify:member-assets`、kiosk `verify:assistant-trtc-guard` / `verify:advisor-provider-gate` / `verify:lightflow-k2a-ai-career` / `verify:fusion-w3`、miniapp `verify:static`、`verify:repository-integrity`、`verify:ci-gate-coverage`（新门禁挂在 `verify:resume-voice-generate` 后进 CI 闭包）全绿；api/kiosk/shared tsc 0，改动文件 eslint 0。

#### 包 J · 半实现补全 —— hermes（或 codex）

- **已合入 main**：#868（squash `db2117a72`，2026-09-07）。
- **条目**：拍板第 7、8 条；评审 §3.5 的模拟面试 / 签约风险 / 招聘会规划 / AI 记录文案
- **事实**：模拟面试报告与 PDF 不含转写（`mock-interview.service.ts:636-647`、`interview-report-pdf.service.ts:94-129`），会员列表 `GET /me/mock-interviews` 已有（`:534-559`），小程序未封装（`utils/api.js:737-791`），降级题目单 `POST :id/practice-sheet` 小程序未接；`listAiRecords` 只读 `AiResumeResult`（`member-assets.service.ts:194-231`）；合同报告 2 小时 TTL（`contract-review-report-file.service.ts:18-20`）、`listDocuments` 排除 `contract_review_report`（`member-assets.service.ts:100`）、留存锁 `system_short`（`retention-policy.ts:97-100`）、服务端只拦 `contract_upload` 原件打印（`print-jobs.service.ts:227-234`）、报告打印开关只在前端（`contractReviewReportPrintFlow.ts:67-69`）；`fair_visit_plan` 的 `fairId` 只在 `payloadJson.basedOn`（`fair-visit-plan.service.ts:22-27`），`listAiRecords` 刻意不 select payload。
- **要做**：① 模拟面试：报告 DTO 与 PDF 增加「问答摘录」章节（每题问题 + 用户回答转写前 200 字，用户可在结束前勾选「不打印我的回答」）；`MyAiRecordsPage`（kiosk）与小程序 `ai-records` 增加「模拟面试」分区，数据来自 `GET /me/mock-interviews`（**不改 `profileEntries.ts`**）；小程序封装 `/me/mock-interviews`、`DELETE`、`/practice-sheet`（AI 挂时降级题目单）；② 签约风险「可保存、不打印」：结果页「保存到我的文档」（本人确认弹窗，写明保存期限与可删除）→ 服务端 `POST /contract-reviews/:id/report/keep`：把报告 `retentionPolicy` 设为 `months_3`、清除 `retentionLockedReason`、`expiresAt` 延长，`allowedPoliciesForFile` 对 `contract_review_report` 放开 `months_3`（仍不允许 `long_term`），`listDocuments` 对已 keep 的报告不再排除；**服务端打印硬拦**：`print-jobs.service.ts` 对 `purpose='contract_review_report'` 一律 400 `PRINT_CONTRACT_REPORT_FORBIDDEN`，删除前端 `VITE_ENABLE_CONTRACT_REVIEW_REPORT_PRINT` 开关与打印按钮，我的文档对该类文件不显示「重新打印」；合同原件仍 `system_short`、仍在生成报告时删除；`docs/compliance/compliance-boundary.md` 增补一段引用 feature-scope §2.2 的 2026-09-06 裁定；③ 招聘会规划回看：`listAiRecords` 对 `kind='fair_visit_plan'` 只解析 payload 中的 `basedOn.fairId` / `fairName` 输出为 `ref: { type:'job_fair', id, name }`（窄字段，不放开 payload），kiosk / 小程序记录项可跳转到对应招聘会规划页；④ 小程序模拟面试语音：接 `POST :id/transcribe`（复用 `voice-recorder.js`），无麦克风权限退回文字。
- **允许改**：`services/api/src/mock-interview/**`、`services/api/src/contract-review/**`、`services/api/src/files/retention-policy.ts`（仅上述一行）、`services/api/src/print-jobs/print-jobs.service.ts`（仅新增拦截）、`services/api/src/member-assets/**`（只加）、`apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx`（及其拆分组件）、`apps/kiosk/src/pages/contract-review/**`、`apps/kiosk/src/pages/interview/**`、`apps/miniapp/pages/{ai-records,interview-*,contract-review}/**`、`apps/miniapp/utils/api.js`（只加）、`docs/compliance/compliance-boundary.md`（只加一段）、相关门禁。
- **禁改**：`profileEntries.ts`、`apps/kiosk/src/pages/profile/**` 其他文件（批次守卫）。
- **验收**：`verify:member-data-retention`、图谱列出的 contract-review 与 kiosk 门禁、`verify:audit-logs`、`verify:pii-redaction`、`pnpm --dir apps/miniapp verify:static`；新增断言：contract_review_report 建打印单必 400；keep 后进我的文档且 `allowedRetentionPolicies` 不含 long_term；面试记录分区数据来自 `/me/mock-interviews`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-06 **包 J 半实现补全（分支 `claude/rl-j-half-done`，本地候选，未部署）**：拍板第 7、8 条与评审 §3.5。① 模拟面试报告 DTO / PDF 增加问答摘录（回答前 200 字），结束前可勾选「不打印我的回答」；一体机 `MyAiRecordsPage` 与小程序 `ai-records` 增加模拟面试分区，数据来自 `GET /me/mock-interviews`（未改 `profileEntries.ts`）；小程序封装列表 / 删除 / 降级题目单，并接 `POST :id/transcribe`（无麦权限退回文字）。② 签约风险「可保存、不打印」：`POST /contract-reviews/:id/report/keep` 把报告改为 `months_3` 并解锁；`listDocuments` 对已 keep 报告不再排除；`print-jobs` 对 `purpose=contract_review_report` 一律 400 `PRINT_CONTRACT_REPORT_FORBIDDEN`；删除一体机打印开关与打印按钮；合规边界增补 §4.8。③ `listAiRecords` 对 `fair_visit_plan` 只输出 `ref: { type:'job_fair', id, name }`，两端可跳转规划页。**验证（实跑）**：api/kiosk `tsc --noEmit` 0；改动 TS eslint `--max-warnings=0` 0；`verify:member-data-retention` ALL PASS（含 keep 后进文档、months_3 不含 long_term、建打印单必 400）；隔离库 `verify:print-jobs` ALL PASS（1b/1c FORBIDDEN）；`verify:mock-interview` 23 PASS；`verify:member-assets-c2d` 10 PASS（fair_visit_plan 只带 fairId/fairName）；contract-review units 33 + 其余 29 PASS / 1 SKIP（无 POSTGRES_URL）；`verify:audit-logs` / `verify:pii-redaction` / `verify:file-retention` / `verify:contract-review-http` / preprod-readiness ALL PASS；kiosk 静态门禁（report-print / session / visible-actions / k2c 105 / profile-entry / ai-records-inkpaper / inkpaper-home / documents-inkpaper / fusion-w5 / commercial-first-batch / print-url / ai-down 24 files / file-retention-ui / job-fit-m1-5 / job-ai-history-privacy）全绿；`verify-miniapp-static` 115/0、api-contract 一致（快照补 5 个新封装端点）、pickup-qrcode / visual-scale 绿。变异：改 FORBIDDEN 码名 → print-jobs 1b 红；去掉 `getMyInterviews` → ai-records 分区断言红；去掉 `months_3` → retention 门禁红；恢复后全绿。**未做**：未改 `MyDocumentsPage` / 小程序 `pages/documents/**`（批次守卫与允许路径禁改），「重新打印」按钮仍显示，点了会被服务端 400（`reprintable=false` 已回传，前台未接线）；未改 `profileEntries.ts` 文案；未做浏览器/开发者工具点选验收；未 push、未开 PR、未部署。

#### 包 K1 · 中文字体包与启动自检 —— codex

- **已合入 main**：#860（squash `9364bb6c2`，2026-09-07）。
- **执行记录**：#860 按上述范围收口 —— `common/pdf/cjk-font.ts` 单一解析源、生产启动自检缺字体即拒绝启动、部署清单加字体项；未碰 `apps/**`。
- **条目**：P0-11（三端 `.doc` UI 归 K2，待包 D 合入）
- **事实**：9 份各自漂移的字体解析实现（`resume-pdf.service.ts:28-55,120-147`、`advisor-pdf.service.ts:20-79`、`contract-review-report-pdf.service.ts:14-153`、`fair-visit-plan-pdf.service.ts:17-81`、`self-assessment-pdf.service.ts:17-72`、`job-fit-pdf.service.ts:12-78`、`interview-report-pdf.service.ts:15-58`、`career-plan-pdf.service.ts:15-83`、`job-material-pdf.service.ts:15-105`、`jobs/fair-company-print.service.ts:97-277`），env 名不一致（`RESUME_PDF_FONT_PATH` vs `JOB_MATERIAL_PDF_FONT_PATH`）；启动门禁 `config/production-runtime-gates.ts:97-101` 只在 production 生效且无字体项；部署清单 `docs/device/production-deployment-and-windows-host-checklist.md` 零字体内容；预生产曾因缺字体事故（`docs/acceptance/user-file-assets-preprod-execution-record.md:161`）。
- **要做**：① 新建 `services/api/src/common/pdf/cjk-font.ts`：统一候选路径（以 `resume-pdf.service.ts:33-52` 为最全版本）、`RESUME_PDF_FONT_PATH` / `_FAMILY` 优先、`JOB_MATERIAL_PDF_FONT_PATH` 兼容回退、`resolveCjkFont()` 带进程内缓存、`registerCjkFont(doc)`、`probeCjkFont(): { ok, path, family, tried[] }`；② 10 处改为调用公共模块，**保留各自现有错误码**；③ 启动自检：`production-runtime-gates.ts` 在 production 缺字体即 `PRODUCTION_CJK_FONT_MISSING` 拒绝启动；非 production 只打 warn（含 tried 路径）；新增管理员可读的探测端点（若已有 health 控制器则只加一个路由）返回探测结果；④ 部署清单 §3.2 增加字体环境变量、§3.1 增加 `fonts-noto-cjk` / 思源字体安装与 `fc-list :lang=zh` 核对命令、§3.6 增加 `verify:resume-generate` 与新门禁；`.env.example` 注释说明；⑤ 缺字体时导出接口返回的错误文案统一为「服务器缺少中文字体，已通知运维；你可以先打印原件或扫码保存」（各端已有错误码映射处只改文案表，不改错误码）。
- **允许改**：上述 10 个 PDF service、`common/pdf/cjk-font.ts`（新）、`config/production-runtime-gates.ts`、`main.ts`、health 控制器（若已有则只加）、`.env.example`、部署清单、新门禁 `verify:cjk-font`（变异测试：删候选路径必红）。
- **禁改**：`apps/**`、`packages/**`。
- **验收**：`verify:production-runtime-gates`、`verify:aigc-pdf-metadata`、`verify:resume-generate`、图谱列出的所有 PDF 相关门禁；API typecheck / lint；新门禁。

#### 包 F · 一体机优化页 / 生成页迁入青序流光（23 / 24 页）并接契约 1 / 2 —— grok

- **已合入 main**：#871（squash `f098e0e61`，2026-09-07）。
- **条目**：P0-3、P0-5（优化 / 生成部分）、P0-13 入口、P0-6 屏显部分、P0-10 的二维码倒计时（本页范围内）
- **事实**：`/resume/optimize`（`apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`，633 行）与 `/resume/generate/preview`（`ResumeGeneratePreviewPage.tsx`）仍是旧壳；原型 `docs/design/kiosk-redesign-2026-08/23-resume-optimize.html`（状态 loading / ready / example / empty / no-context / read-error / optimize-failed / unavailable / illegal）与 `24-resume-generate.html`；青序样板：`apps/kiosk/src/layouts/KioskRoot.tsx` 的 `QX_MIGRATED_ROUTES`、`components/qingxu/QxPageFrame.tsx`、`styles/qingxu/`、已迁的 `/resume/report`（`resume-report-qx.css`、`components/resume-report/*`）与 `/print/pickup-claim`。本分支已含契约 1（`POST /resume/records/:taskId/export`，kind=diagnosis_report|change_list）与契约 2（`GET /resume/export/pricing`，导出 body 可带 `benefitGrantId`）。
- **要做**：① 两页登记进 `QX_MIGRATED_ROUTES`，按原型实现并拆到 ≤300 行/文件；原型声明的每个 `?state=` 有真实对应，`?capture=1` 才开合成夹具并明标「合成演示」；② 优化页与生成预览页共用同一套「结果交付」组件：模板选择（读 `/job-materials/templates`）、排版控件、四格式导出、导出前显示 `GET /resume/export/pricing` 的价格 / 「当前免费，不扣权益」/ 不可用原因，charged 且无权益时按钮 aria-disabled 并说明；③ 导出后自动打开真实 PDF 预览（`FileContentPreview` 的 iframe，同一 signedUrl），页面写「打印的就是这一份」，显示页数 / 大小 / 有效期 / 版本号（版本号暂用导出次数）；HTML 示意预览标「示意，非打印稿」；导出前显示「共 N 页」并提供「压到一页」（fontScale/lineSpacing 一档收紧）微调；④ 二维码带剩余有效时间倒计时（本页内实现 `useCountdown`，`FilePreviewDialog` 增加可选 `expiresAt`），过期后隐藏二维码并提示重新导出；⑤ 「修改清单」入口：调 `POST /resume/records/:taskId/export` kind=change_list，结果同样进真实 PDF 预览 / 二维码 / 打印；⑥ 事实核对墙：导出前弹窗列出优化稿里的学校 / 公司 / 时间段 / 证书 / 电话，逐项勾「已核对」，未全勾不出文件；导出请求附 `factsConfirmedAt`（ISO 时间，后端暂未校验，包 H 会加）；AI 新增的数字 / 职责段落（不在 `modules[].before` 中出现的 after 文本）标「待本人确认」；⑦ 屏幕上「AI 优化稿，请自行核对」常驻标识；⑧ 生成流预览页与优化页同构（模板 / 排版 / 四格式 / 预览 / 二维码 / 打印），语音生成录完的结果同样能带走。
- **允许改**：`apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`、`ResumeGeneratePreviewPage.tsx`、`ResumeOptimizeComparePage.tsx`（仅接线）、`apps/kiosk/src/pages/resume/components/**`（新建 resume-deliver/* 共用组件）、新建 `resume-optimize-qx.css` / `resume-generate-qx.css`、`apps/kiosk/src/components/FilePreviewDialog.tsx`（只加 `expiresAt`）、`apps/kiosk/src/hooks/useCountdown.ts`（新）、`apps/kiosk/src/services/api/ai.ts` + `aiHttpAdapter.ts` + `aiMockAdapter.ts`（只加：pricing / report export / benefitGrantId / factsConfirmedAt）、`apps/kiosk/src/layouts/KioskRoot.tsx`（仅 `QX_MIGRATED_ROUTES`）、kiosk 门禁脚本（只加或按新壳更新断言）。
- **禁改**：`services/api/**`、`apps/miniapp/**`、`apps/kiosk/src/pages/profile/**`。
- **验收**：单页验收六条；`verify:resume-diagnosis-flow-ui`、`verify:fusion-w3`、`verify:lightflow-k2b-ai-resume`、`verify:ai-down-fallbacks`、`verify:kiosk-visual-unity`、`verify:kiosk-frontend-debt`、`verify:compliance-copy` 与图谱列出的全部；kiosk tsc / lint；1080×1920 用 Playwright（`apps/kiosk/node_modules/@playwright/test`，dev server `node node_modules/vite/bin/vite.js --port 5199`，`VITE_API_MODE=mock`）对每个 state 截图并量可点区 ≥48px、主按钮 ≥56px，截图放 `/private/tmp/f-shots/`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-07 **包 F · 一体机优化页 / 生成预览页迁入青序流光并接契约 1/2**（分支 `claude/rl-f-optimize-qx`，叠在包 A `claude/rl-a-diagnosis-export` 上，本地候选，未 push、未开 PR、未部署）。条目 P0-3、P0-5（优化/生成）、P0-13 入口、P0-6 屏显、P0-10 本页二维码倒计时。① `/resume/optimize` 与 `/resume/generate/preview` 登记进 `QX_MIGRATED_ROUTES`，按 23/24 原型用 `QxPageFrame` 重做，拆到 ≤300 行/文件；原型 `?state=` 均有对应，合成夹具必须 `?capture=1` 并标「合成演示」。② 两页共用 `resume-deliver/*`：模板（`/job-materials/templates`）、排版、四格式、`GET /resume/export/pricing` 三态（免费写「当前免费，不扣权益」；charged 无权益 `aria-disabled`；unavailable fail-closed）。③ 导出后打开真实 PDF iframe，文案「打印的就是这一份」，显示页数/大小/有效期/版本（导出次数）；HTML 示意标「示意，非打印稿」；导出前给「压到一页」。④ `useCountdown` + `FilePreviewDialog.expiresAt`：过期隐藏二维码并提示重新导出。⑤ 优化页「修改清单」走 `POST /resume/records/:taskId/export` kind=`change_list`。⑥ 导出前事实核对墙，请求带 `factsConfirmedAt`（generate/export DTO 尚未收该字段，包 H 落地前不放进该 body，避免 forbidNonWhitelisted 400；修改清单 untyped body 会带上）。AI 新增数字/职责标「待本人确认」。⑦ 屏显常驻「AI 优化稿，请自行核对」。⑧ 生成预览与优化同构，语音生成结果可带走。**未做**：对照页青序迁移（仅保留既有 taskId 回传）、小程序、后端 DTO 收 `factsConfirmedAt`、部署。**验证（实跑）**：kiosk `tsc --noEmit` 0；改动文件 eslint 0；`verify:resume-diagnosis-flow-ui` / `fusion-w3`（静态）/ `lightflow-k2b-ai-resume` / `ai-down-fallbacks` / `kiosk-visual-unity` / `kiosk-frontend-debt` / `compliance-copy` 及图谱列出的 runtime-error-boundary、phone-upload-ui、print-url-contract、profile-documents、profile-commercial-first-batch、fusion-shell、member-session-closure 等全绿。新断言变异：去掉 QX 路由 → fusion-w3 红；`合成演示` 改字 → diagnosis-flow-ui 红；恢复后全绿。Playwright 1080×1920 mock 对 22 个 state 截图在 `/private/tmp/f-shots/`，可点区 ≥48px、主按钮 ≥56px。`5199` 已被包 E worktree 占用，本包 dev server 用 `5198`。未部署。

#### 包 E2 · 一体机诊断报告页接契约 1 / 2 —— grok

- **已合入 main**：#876（squash `b593aabf3`，2026-09-07）。
- **条目**：P0-2（一体机侧）、P0-13 入口、P0-7 价格显示、P0-5 报告部分、二维码倒计时
- **事实**：包 E 已把 `/resume/report` 迁进青序流光，三个动作「打印这份报告 / 导出 PDF / 生成二维码带走」在 `components/resume-report/ResumeReportActions.tsx` 的 `ResumeReportTakeaway` 里是 aria-disabled 占位（原因「报告导出端点上线后开放」）。服务端已有 `POST /resume/records/:taskId/export`（body `{kind:'diagnosis_report'|'change_list', benefitGrantId?}` → `{fileId, filename, mimeType, sizeBytes, pageCount, signedUrl, expiresAt, printFileUrl, savedToDocuments, aiGenerated}`；鉴权与 `getResumeRecord` 相同：会员 token 或匿名 accessToken）与 `GET /resume/export/pricing`。包 F 已在 `apps/kiosk/src/services/api/ai.ts`（+ http/mock adapter）加了 `exportResumeRecord` / `getResumeExportPricing` 一类封装，并有 `components/resume-deliver/*`、`hooks/useCountdown.ts`、`FilePreviewDialog` 的 `expiresAt`。
- **要做**：① `ResumeReportTakeaway` 三键接真：「导出 PDF」调 kind=diagnosis_report，「打印这份报告」在导出成功且 `printFileUrl` 存在后跳 `/print/confirm`（沿用优化页的 state 形状），「生成二维码带走」打开 `FilePreviewDialog`（真实 PDF iframe + 二维码 + `expiresAt` 倒计时）；再加「导出修改清单」（kind=change_list）；② 三键上方显示 pricing 三态（免费 / 收费 + 权益 / 不可用置灰 + 原因），charged 且无权益时按钮 aria-disabled 并说明；③ 导出结果卡：文件名 / 页数 / 大小 / 有效期；会员 `savedToDocuments=true` 写「已存入我的文档」，匿名不得写「已存」，改写「登录后可存我的文档，本次可扫码带走」；④ 导出失败 / AI_RESULT_NOT_READY / RESUME_PDF_FONT_NOT_FOUND / RESUME_EXPORT_UNAVAILABLE 各有中文原因，按钮不假装成功；⑤ `?capture=1` 夹具里增加 `export-ready` / `export-failed` / `pricing-charged` / `pricing-unavailable` 四个 state 供截图；⑥ 更新 `apps/kiosk/scripts/verify-resume-report-qx.mjs` 断言（占位置灰断言改为「未导出前置灰、导出后可点」；savedToDocuments=false 不出现「已存」）。
- **允许改**：`apps/kiosk/src/pages/resume/components/resume-report/**`、`ResumeReportPage.tsx`、`resume-report-model.ts`、`resume-report-fixture.ts`、`resume-report-qx.css`、`apps/kiosk/src/services/api/ai.ts` + adapters（只加）、`apps/kiosk/scripts/verify-resume-report-qx.mjs`。
- **禁改**：`services/api/**`、`apps/miniapp/**`、`apps/kiosk/src/pages/profile/**`、包 F 的 `resume-deliver/*`（只复用）。
- **验收**：kiosk tsc / lint；`verify:resume-report-qx`（变异）、`verify:resume-diagnosis-flow-ui`、`verify:fusion-w3`、`verify:lightflow-k2b-ai-resume`、`verify:ai-down-fallbacks`、`verify:kiosk-visual-unity`、`verify:compliance-copy`；Playwright 1080×1920（dev server 用 5197 端口，`VITE_API_MODE=mock`）对新增 4 个 state 截图到 `/private/tmp/e2-shots/`，量可点区 ≥48px。

- **执行记录**：
  > 2026-09-07 **包 E2 · 一体机诊断报告页接契约 1 / 2**（分支 `claude/rl-e2-report-contracts`，叠在包 F 上并 cherry-pick 包 E 两个提交，本地候选，未 push、未开 PR、未部署）。条目 P0-2（一体机侧）、P0-13 入口、P0-7 价格显示、P0-5 报告部分、二维码倒计时。① `ResumeReportTakeaway` 拆到独立文件并接真：`导出 PDF` → `exportResumeRecord` kind=`diagnosis_report`；打印在 `printFileUrl` 就绪后跳 `/print/confirm`（与优化页同一 state 形状）；`生成二维码带走` 打开 `FilePreviewDialog`（PDF iframe + 二维码 + `expiresAt` 倒计时）；新增 `导出修改清单` kind=`change_list`。未导出前打印/二维码 `aria-disabled` 并写「请先导出」；导出后有链接才可点。② 复用 `useResumeExportPricing` + `ResumePricingBar`：免费写「当前免费，不扣权益」；charged 无权益置灰并说明；unavailable fail-closed 写「价目已停用，不是免费」。③ 结果卡展示文件名 / 页数 / 大小 / 有效期；`savedToDocuments && 登录` 才写「已存入我的文档」，匿名写「登录后可存我的文档，本次可扫码带走」。④ `AI_RESULT_NOT_READY` / `RESUME_PDF_FONT_NOT_FOUND` / `RESUME_EXPORT_UNAVAILABLE` / `AI_TASK_NOT_FOUND` 映射中文，失败不清成成功。⑤ `?capture=1` 增加 `export-ready` / `export-failed` / `pricing-charged` / `pricing-unavailable`。⑥ `verify-resume-report-qx` 占位「报告导出端点上线后开放」改为未导出前置灰、导出后可点、匿名不得写「已存」。**未改**：`services/api/**`、`apps/miniapp/**`、`resume-deliver/*`（只复用）、`docs/progress/current-progress.md`。**验证（实跑）**：kiosk `tsc --noEmit` 0；改动文件 eslint 0；`verify:resume-report-qx` 全绿，新增 24 条断言变异各红后恢复绿；`verify:resume-diagnosis-flow-ui` / `fusion-w3`（静态）/ `lightflow-k2b-ai-resume` / `ai-down-fallbacks` / `kiosk-visual-unity` / `kiosk-frontend-debt` / `compliance-copy` 全绿。Playwright 1080×1920 mock（dev `127.0.0.1:5197`）对 4 个 capture state 截图在 `/private/tmp/e2-shots/`，`data-state` 对齐，可点区 ≥48px（导出键 495×76）。未部署。

#### 包 K2 · 三端 .doc/.docx 口径与 Word 预览 / 转 PDF 入口（消费契约 3）—— codex

- **已合入 main**：#874（squash `e2219ceb8`，2026-09-07）。

- **条目**：P0-9（三端统一「接收」）、Word 页内预览、我的文档「转 PDF」、打印上传接 Word；全部以 `GET /api/v1/document-conversion/capabilities` 为真时才开放，为假时 aria-disabled + reason（「由转换引擎生成，复杂版式可能有偏差，请预览核对」固定出现在开放态文案中）。
- **事实**：kiosk 简历上传 accept 刻意剔除 .doc（`apps/kiosk/src/pages/resume/ResumeSourcePage.tsx:115-126`）；手机中转页 `PhoneUploadPage.tsx:16-18` 与小程序 `resume-upload.js:6` 放行 .doc；打印上传 `PrintUploadPage.tsx:545` 只收 pdf/jpg/png；`FileContentPreview.tsx:15-31` 只认 pdf/图片，DOCX 归 unsupported；`PrintPreviewPage.tsx:226` 写「Word 文档需后续接入转换服务后才能页内预览」；我的文档 `MyDocumentsPage.tsx:204-229`「重新打印」不按格式过滤（该文件受批次守卫禁改，本包不碰）。服务端（包 D）：`POST /files/:id/convert {target:'pdf'}` 返回派生 PDF 的 signedUrl / printFileUrl；`print_doc` 上传在能力为真时接受 doc/docx，建单前服务端自动转派生 PDF。
- **要做**：① kiosk 新增 `services/api/documentConversion.ts`（capabilities 缓存 + convert）；② 简历上传 / 手机中转 / 打印上传三处 accept：能力为真时含 .doc/.docx，为假时不含且文案说明「Word 转换暂未开放，请另存为 PDF 上传」；③ `FileContentPreview` 对 Word：能力为真 → 先调 convert 再 iframe 派生 PDF（显示「由转换引擎生成…」提示），为假 → 保留诚实不支持态；④ 打印预览页 Word：同 ③，`PrintPreviewPage.tsx:226` 文案按能力真假二选一；⑤ 小程序 `resume-upload` 的 .doc/.docx 选择与文案同口径（读 capabilities，新增 `utils/api.js` 封装，只加）；⑥ 新增 kiosk 静态门禁 `verify:word-conversion-ui`（能力为假时三处 accept 不含 doc/docx、提示文案存在、convert 只在能力为真时调用）；⑦ miniapp `verify:api-contract` 快照补新端点。
- **允许改**：上述 kiosk 文件（`MyDocumentsPage.tsx` 除外）、`apps/kiosk/src/services/api/documentConversion.ts`（新）、`apps/kiosk/scripts/verify-word-conversion-ui.mjs`（新）+ `apps/kiosk/package.json`、`apps/miniapp/pages/resume-upload/**`、`apps/miniapp/utils/api.js`（只加）、`apps/miniapp/scripts/api-contract.json`。
- **禁改**：`services/api/**`、`apps/kiosk/src/pages/profile/**`、`.github/workflows/**`。
- **验收**：kiosk tsc / lint；`verify:word-conversion-ui`（变异测试）、`verify:file-display-truth`、`verify:kiosk-visual-unity`、`verify:ai-down-fallbacks`、`verify:compliance-copy`、图谱列出的门禁；`pnpm --dir apps/miniapp verify:static`。

- **执行记录（原写在 current-progress.md，为避免多会话顶部冲突改记于此）**：
  > 2026-09-07 **包 K2（分支 `claude/rl-k2-doc-ui`，基于包 D `32ee331f0`）完成三端 Word 接收口径与页内转换预览接线，未部署**：新增 kiosk `documentConversion.ts`，以 `GET /document-conversion/capabilities` 的 `wordToPdf=true` 为唯一开放条件并缓存能力；简历上传、手机中转、打印上传仅在能力为真时把 DOC/DOCX 加入选择器，能力关闭或探测失败时保留 PDF/图片并用 `aria-disabled` + 常驻原因说明「Word 转换暂未开放，请另存为 PDF 上传」。`FileContentPreview` 与打印预览对 Word 调 `POST /files/:id/convert`，成功后只用派生 PDF 的短时 `signedUrl` 页内预览，开放态固定提示「由转换引擎生成，复杂版式可能有偏差，请预览核对」；鉴权、转换或链接失败均保留诚实错误态，打印建单仍沿用包 D 的服务端自动转换分支。小程序 `resume-upload` 同样 fail-closed 读取 capabilities，并把新端点写入 API 契约快照。新增 `verify:word-conversion-ui`，正常门禁通过，8 项变异测试逐项转红且恢复源文件。实跑通过：kiosk `tsc --noEmit`、eslint（0 error，9 条既有 Fast Refresh warning）、任务包指定的 `verify:file-display-truth` / `verify:kiosk-visual-unity` / `verify:ai-down-fallbacks` / `verify:compliance-copy`、全部目标文件图谱门禁、服务端交叉 `verify-file-display-truth` / `verify-print-color-duplex-capability`、小程序 API contract 与 `verify:static` 的四段等价 Node 脚本、`verify:repository-integrity`。**未做**：`MyDocumentsPage.tsx` 的「转 PDF」按钮，因包 K2 明确禁改该批次守卫文件，且现有预览调用未传转换所需 `fileId`；匿名 Word 页内转换仍受包 D 当前 `AUTH_REQUIRED` 契约限制，前端不伪装成功；未运行浏览器真点、微信开发者工具、生产部署或 Windows/打印机真机验证。

## 第三波（P1 补全，商用完整）

≥3 套真实模板 + 真实缩略图；DOCX 吃 layout / 模板；具名多版本与对比；跨端续办；PDF → 图片；gotenberg 适配器 + 队列化；Puppeteer 替换 pdfkit 评估；缩略图；助手会话要点；政策核对材料清单出纸。

## 收货标准（主持人）

1. PR 只含本包允许路径；`gh pr checks` 三条（build-and-verify / kiosk-browser-smoke / postgres-readiness）全绿，watcher 核对 workflow=CI 且 headSha 一致后 squash 合并。
2. 逐条目对照本文件核状态；「skipped」必须有原因。
3. 一体机页面由 Claude 用 1080×1920 截图对比原型验收；小程序由开发者工具自动化截图验收。
4. 合入后 `docs/progress/current-progress.md` 顶部已有该包记录；本文件对应包标「已合入 #n」。
