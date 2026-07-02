# AI 简历诊断 + 优化 商用闭环 · Wave 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行。步骤用 `- [ ]` 复选框跟踪。
>
> **代码阶段门禁（用户明确要求）**：每个任务 diff 完成后必须过 typecheck + 对应 verify + `git diff --check`；跨模块或 >30 行改动收口时必须做 Claude + Antigravity 双模型审查，取得报告后再合并；无有效报告不得宣称通过。本 plan 文档本身不触发代码审查。

**Goal:** 在既有诊断→优化真实链路上补齐「结构化目标维度（专业/学历/目标岗位）贯穿到优化」和「优化版简历导出 docx/txt/md 并进入 FileObject / 我的文档」，保持防编造、防承诺录用与合规红线。

**Architecture:** 复用现有 `AiProvider` 优化链路与 `POST /resume/generate/export` 导出端点。目标维度作为 additive 可选字段扩展 `ResumeTargetContext`，随 parse 行落库并在 optimize 懒生成时读回传给 provider。导出增加 `format` 维度，新增 docx/txt/md 三个纯函数渲染器，统一经既有 `FilesService.upload` 落 FileObject（`assetCategory='optimized'`），进入「我的文档」与打印链路。

**Tech Stack:** NestJS(services/api) + Prisma、pdfkit（已用）、新增 `docx` npm 包做 Word、纯字符串做 txt/md；React(apps/kiosk)；`packages/shared` 跨端类型 SSOT；仓库既有 `verify:*`（`node -r @swc-node/register scripts/*.ts`）作为测试机制。

---

## 0. 六波总览（本 plan 只执行 Wave 1）

| Wave | 主题 | 目标功能 | 本轮 |
|---|---|---|---|
| **1** | 优化维度结构化 + docx/txt/md 导出 + 导出路径收口 | #2 #5 #10 | ✅ 本轮 |
| 2 | 在线排版参数编辑 + AI 一键排版 | #8 #9 | 后续 |
| 3 | 模板库→自动填充排版 | #6 | 后续 |
| 4 | 语音生成简历（需 ASR provider 决策） | #4 #5 | 后续 |
| 5 | 收费闭环（支付/计费/套餐/券/核销） | #12 #13 | 独立立项 |
| 6 | 岗位 URL 定向（白名单/手动 JD）+ 格式转换 + 真机验收 | #3 #11 #10 | 后续 |

收费方向（用户定，Wave 1 不实现）：诊断 / 基础优化免费；导出高级格式、模板、打印、套餐包后续收费；支付走 Wave 5。**Wave 1 在导出入口预留能力位（默认放行），供 Wave 5 挂计费门禁，不在本轮做任何扣费/文案。**

---

## 1. Wave 1 目标 / 非目标

### 目标（In Scope）
1. `ResumeTargetContext` 增加 `major?`（专业）、`degree?`（学历）additive 字段；`targetJob` 已存在（目标岗位）。
2. 诊断阶段采集的 `targetContext`（含新字段）随 parse 行落库，进入优化时可继续传递并影响优化建议重点。
3. 优化结果（结构化 `GeneratedResume` / 用户编辑后版本）支持导出 **docx / txt / md**（PDF 已有）。
4. 导出文件统一进 `FileObject`（`assetCategory='optimized'`、`endUserId` 绑定），出现在「我的文档」，可后续打印。
5. 保持防编造（事实串必须在原文）、防承诺录用（拦截词）、合规红线（不平台投递、不企业侧）。
6. 新增 `verify:resume-export-formats` 并接入 CI。

### 非目标（Out of Scope，用户明确排除）
- ❌ 支付 / 计费 / 扣费 / 套餐 / 优惠券（Wave 5）。
- ❌ 语音生成简历（Wave 4）。
- ❌ 岗位 URL 抓取解析（Wave 6；本轮不碰任何第三方页面抓取）。
- ❌ 模板选择自动填充排版（Wave 3）。
- ❌ 排版参数在线编辑 / AI 一键排版（Wave 2）。
- ❌ Windows 真机 / 奔图真实出纸验收。
- ❌ 不改 UI 视觉冻结口径：只加导出格式菜单与两个输入字段，不重设计页面。

---

## 2. 允许修改文件清单（allow-list）

**允许新增：**
- `services/api/src/ai/resume/resume-docx.service.ts`（Word 渲染器）
- `services/api/src/ai/resume/resume-text.service.ts`（txt/md 渲染器）
- `services/api/scripts/verify-resume-export-formats.ts`（新 verify）

**允许修改：**
- `packages/shared/src/types/ai.ts`（SSOT：`ResumeTargetContext` 加字段、导出请求/响应加 `format`）
- `services/api/src/ai/interfaces/ai-provider.interface.ts`（本地副本，同步 SSOT；`optimizeResume` 签名加 `targetContext?`）
- `services/api/src/ai/dto/resume-generate.dto.ts`（`ResumeGenerateExportDto`，第 120 行起，加 `format` 校验）
- `services/api/src/ai/dto/resume-parse.dto.ts`（`ResumeTargetContextDto`，第 26 行起，加 major/degree 的 `@IsOptional() @IsString() @MaxLength(...)` 校验）
- `services/api/src/ai/ai.service.ts`（optimize 读回 targetContext、export 按 format 分派、persist parse 的 targetContext）
- `services/api/src/ai/ai.controller.ts`（export 审计补 format 元数据）
- `services/api/src/ai/providers/mock.provider.ts` 与 `providers/llm.provider.ts`、`resume/llm-resume-optimize.service.ts`（optimize 接收并使用 targetContext）
- `services/api/src/ai/ai.module.ts`（注册两个新 service）
- `services/api/package.json`（注册 `verify:resume-export-formats`；新增依赖 `docx`）
- `.github/workflows/ci.yml`（串行 verify 加入新脚本）
- `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`（采集 major/degree 输入）
- `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`（透传 targetContext 到优化）
- `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`（导出格式选择菜单）
- `apps/kiosk/src/services/api/aiHttpAdapter.ts` 与 `aiMockAdapter.ts`（export 带 format）
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`（收口记录）

**禁止修改：**
- `apps/kiosk/src/pages/home/**`、`packages/ui/**`（避开工作树里那套非本任务的 v6 UI 改动）。
- 任何 `services/api/src/print-jobs/**` 计费字段（`amountCents` 保持 0，Wave 5 再动）。
- `services/api/prisma/schema.prisma` 的 schema 结构——**优先不加新表/新列**：targetContext 落在 parse 行既有 `payloadJson` 内，不新增迁移（见 Task 3 决策）。若评审认为必须新增列，则拆到独立子任务并出 SQLite+PostgreSQL 双 additive 迁移，不在本 plan 默认路径内。
- `.workbuddy/**`、`.ccg/**`、`legacy-miaoda/**`。

---

## 3. 文件结构与职责

| 文件 | 职责 | 边界 |
|---|---|---|
| `packages/shared/src/types/ai.ts` | 跨端类型 SSOT | 只加 additive 可选字段，不改已有必填 |
| `ai-provider.interface.ts` | API 本地副本 + provider 契约 | 与 SSOT 双写同步 |
| `resume-docx.service.ts` | `GeneratedResume` → docx Buffer | 纯渲染，无 I/O、无网络 |
| `resume-text.service.ts` | `GeneratedResume` → txt / md 字符串 | 纯函数 |
| `ai.service.ts` | optimize 传 targetContext；export 按 format 分派到 pdf/docx/txt/md + upload | 事实字段不改，只组织 |
| `verify-resume-export-formats.ts` | 静态 + 运行时断言导出四格式落 FileObject、防编造、合规 | 不连真实 COS |

---

## 4. 任务拆分（TDD / bite-sized）

> 约定：本仓库「测试」= `verify:*` 脚本（`node -r @swc-node/register`）。每个任务先扩断言（红），再实现（绿），再 `verify` + `typecheck`，最后 commit。

### Task 1：`ResumeTargetContext` 扩展 major / degree（SSOT + 本地副本）

**Files:**
- Modify: `packages/shared/src/types/ai.ts:86-97`（`ResumeTargetContext`）
- Modify: `services/api/src/ai/interfaces/ai-provider.interface.ts:55-61`（本地副本）
- Modify: `services/api/src/ai/dto/resume-parse.dto.ts:26-49`（`ResumeTargetContextDto` 校验类）

- [ ] **Step 1：改 SSOT，加两个可选字段**

```ts
// packages/shared/src/types/ai.ts  ResumeTargetContext 内追加：
  /** 专业方向（自由文本，可空；仅用于本人简历表达诊断/优化重点） */
  major?: string
  /** 学历层次（自由文本或枚举文案，如 大专/本科/硕士；可空） */
  degree?: string
```

- [ ] **Step 2：同步 API 本地副本**（`ai-provider.interface.ts` 的 `ResumeTargetContext` 同样加 `major?` / `degree?`，保持两处一致）

- [ ] **Step 3：`ResumeTargetContextDto` 加校验字段（与既有 industry/targetJob 同风格）**

```ts
// services/api/src/ai/dto/resume-parse.dto.ts  ResumeTargetContextDto 内追加：
  @IsOptional()
  @IsString()
  @MaxLength(40)
  major?: string

  @IsOptional()
  @IsString()
  @MaxLength(20)
  degree?: string
```

- [ ] **Step 4：typecheck**

Run: `pnpm --filter @ai-job-print/shared typecheck && pnpm --filter @ai-job-print/api typecheck`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add packages/shared/src/types/ai.ts services/api/src/ai/interfaces/ai-provider.interface.ts services/api/src/ai/dto/resume-parse.dto.ts
git commit -m "feat(resume): 目标上下文补专业/学历维度"
```

### Task 2：optimize 契约携带 targetContext

**Files:**
- Modify: `services/api/src/ai/interfaces/ai-provider.interface.ts:285`（`optimizeResume` 签名）
- Modify: `services/api/src/ai/providers/mock.provider.ts`、`providers/llm.provider.ts`
- Modify: `services/api/src/ai/resume/llm-resume-optimize.service.ts`

- [ ] **Step 1：改接口签名（additive 可选参数，向后兼容）**

```ts
// AiProvider.optimizeResume
optimizeResume(
  taskId: string,
  report: ResumeReport,
  extractedText?: string,
  targetContext?: ResumeTargetContext,
): Promise<OptimizeResumeOutput>
```

- [ ] **Step 2：mock provider 忽略 targetContext（保持演示可跑），llm provider 透传给 `llm-resume-optimize.service`**

- [ ] **Step 3：`llm-resume-optimize.service` 把 targetContext（专业/学历/目标岗位/经验/场景）拼进优化 prompt 的「优化方向」段，但严格保留既有防编造契约：事实串仍必须来自原文，targetContext 只影响措辞重点，不得据此新增经历/学历/证书。**

- [ ] **Step 4：typecheck + 现有 verify 不回归**

Run: `pnpm --filter @ai-job-print/api typecheck && pnpm --filter @ai-job-print/api verify:resume-optimize`
Expected: PASS（10 项含防编造/承诺拦截仍绿）

- [ ] **Step 5：commit**

```bash
git add services/api/src/ai/interfaces/ai-provider.interface.ts services/api/src/ai/providers/ services/api/src/ai/resume/llm-resume-optimize.service.ts
git commit -m "feat(resume): 优化链路携带目标维度且保持防编造"
```

### Task 3：parse 行落 targetContext 并在 optimize 懒生成时读回

**决策（避免新增迁移）：** `targetContext` 随 parse 结果存入既有 `AiResumeResult.payloadJson`（parse 行的 payload 即 `ParseResumeOutput` 序列化）。为此在 `ParseResumeOutput` 增加可选 `targetContext?`（仅服务端落库用，不含 PII），`getResumeOptimize` 读 parse 行 payload 取回后传给 `optimizeResume`。

**Files:**
- Modify: `services/api/src/ai/interfaces/ai-provider.interface.ts`（`ParseResumeOutput` 加 `targetContext?`）
- Modify: `packages/shared/src/types/ai.ts`（`ResumeParseResponse` 是否需要回传 targetContext——**不回传前端**，仅后端落库；故只改 API 本地类型，不改前端响应）
- Modify: `services/api/src/ai/ai.service.ts:170-244`（submitResumeParse：把入参 targetContext 写进 parse 结果 payload）、`ai.service.ts:303-354`（getResumeOptimize：从 parse 行读 targetContext 传入 optimizeResume）

- [ ] **Step 1：submitResumeParse 落库时把 `input.targetContext` 合并进将要持久化的 parse 结果对象**（注意：只落 targetContext 结构化字段，不落简历原文；保持原有「原文不落库」红线）

- [ ] **Step 2：getResumeOptimize 读 parse 行 payload 的 targetContext，传给 `this.provider.optimizeResume(taskId, report, extractedText, targetContext)`**

- [ ] **Step 3：typecheck + verify:resume-optimize**

Run: `pnpm --filter @ai-job-print/api typecheck && pnpm --filter @ai-job-print/api verify:resume-optimize`
Expected: PASS

- [ ] **Step 4：commit**

```bash
git add services/api/src/ai/ai.service.ts services/api/src/ai/interfaces/ai-provider.interface.ts
git commit -m "feat(resume): 目标维度随 parse 落库并注入优化"
```

### Task 4：新增 docx 渲染器

**Files:**
- Create: `services/api/src/ai/resume/resume-docx.service.ts`
- Modify: `services/api/package.json`（加依赖 `docx`）
- Modify: `services/api/src/ai/ai.module.ts`（provider 注册）

- [ ] **Step 1：装依赖**

Run: `cd services/api && pnpm add docx`
Expected: `docx` 进 dependencies

- [ ] **Step 2：实现 `ResumeDocxService.render(resume: GeneratedResume): Promise<{ buffer: Buffer }>`**，按 basic/intention/summary/education/experience/projects/skills/certificates 顺序输出段落（与 pdf 版信息结构一致；事实字段逐字输出，不新增内容）。

- [ ] **Step 3：注册进 `ai.module.ts` providers 并可被 `AiService` 注入**

- [ ] **Step 4：typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add services/api/src/ai/resume/resume-docx.service.ts services/api/src/ai/ai.module.ts services/api/package.json services/api/pnpm-lock.yaml ../../pnpm-lock.yaml
git commit -m "feat(resume): 新增 docx 简历渲染器"
```

### Task 5：新增 txt / md 渲染器

**Files:**
- Create: `services/api/src/ai/resume/resume-text.service.ts`
- Modify: `services/api/src/ai/ai.module.ts`

- [ ] **Step 1：实现 `ResumeTextService.renderTxt(resume): string` 与 `renderMarkdown(resume): string`**（纯字符串拼装；md 用 `#`/`##`/`-` 结构；txt 用缩进/分隔线；事实字段逐字）。

- [ ] **Step 2：注册进 module + typecheck**

Run: `pnpm --filter @ai-job-print/api typecheck`
Expected: PASS

- [ ] **Step 3：commit**

```bash
git add services/api/src/ai/resume/resume-text.service.ts services/api/src/ai/ai.module.ts
git commit -m "feat(resume): 新增 txt/md 简历渲染器"
```

### Task 6：导出端点支持 format（pdf/docx/txt/md）

**Files:**
- Modify: `packages/shared/src/types/ai.ts`（`ResumeGenerateExportResponse` 已含 fileId/signedUrl；请求侧加 `format?: 'pdf'|'docx'|'txt'|'md'`，缺省 pdf）
- Modify: `services/api/src/ai/dto/resume-generate.dto.ts`（`ResumeGenerateExportDto`，第 120 行起；`@IsOptional() @IsIn(['pdf','docx','txt','md'])` 可选 format）
- Modify: `services/api/src/ai/ai.service.ts:484-510`（`exportGeneratedResume` 增加 `format` 参数：按 format 选渲染器、mimeType、扩展名；统一走 `files.upload`）
- Modify: `services/api/src/ai/ai.controller.ts:235-260`（透传 format；审计 payload 加 `format`）

- [ ] **Step 1：扩 DTO 加可选 `format`，默认 `'pdf'`**

- [ ] **Step 2：`exportGeneratedResume(resume, endUserId, sourceFileId, format)`：**
  - `pdf` → 现有 `resumePdf.render`，mimeType `application/pdf`
  - `docx` → `resumeDocx.render`，mimeType `application/vnd.openxmlformats-officedocument.wordprocessingml.document`，扩展名 `.docx`
  - `txt` → `resumeText.renderTxt`，`text/plain; charset=utf-8`，`.txt`
  - `md` → `resumeText.renderMarkdown`，`text/markdown; charset=utf-8`，`.md`
  - 统一 `files.upload({... assetCategory:'optimized', createdBy:'ai_resume_generate', endUserId ...})`，文件名 `AI简历_${safeName}.<ext>`
  - 非 pdf 时 `pageCount` 返回 0 或省略（响应类型允许）

- [ ] **Step 3：预留计费能力位（不实现扣费）：** 在 export 入口加一处 `assertExportFormatAllowed(format)`（Wave 1 恒返回 true），Wave 5 在此挂计费门禁，避免后续改签名。

- [ ] **Step 4：typecheck + verify:resume-generate（现有）不回归**

Run: `pnpm --filter @ai-job-print/api typecheck && pnpm --filter @ai-job-print/api verify:resume-generate`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add packages/shared/src/types/ai.ts services/api/src/ai/dto/resume-generate-export.dto.ts services/api/src/ai/ai.service.ts services/api/src/ai/ai.controller.ts
git commit -m "feat(resume): 导出支持 pdf/docx/txt/md 且统一进 FileObject"
```

### Task 7：新增 `verify:resume-export-formats`

**Files:**
- Create: `services/api/scripts/verify-resume-export-formats.ts`
- Modify: `services/api/package.json`（注册 script）
- Modify: `.github/workflows/ci.yml`（串行 verify 加入）

- [ ] **Step 1：写断言脚本（静态 + 运行时）覆盖：**
  1. DTO `format` 白名单只含 `pdf/docx/txt/md`，缺省 pdf。
  2. 四格式各自渲染出非空 Buffer/字符串；docx 头 `PK`（zip 魔数）、md 含 `#`、txt 非空。
  3. 四格式导出都调用 `files.upload` 且 `assetCategory='optimized'`、绑定 `endUserId`、`createdBy='ai_resume_generate'`。
  4. 防编造回归：渲染内容不得出现输入里不存在的学校/公司/证书（用夹具 resume 断言逐字一致）。
  5. 合规：渲染与文件名不得含「录用/保offer/内推/平台投递」等承诺/越界词。
  6. `assertExportFormatAllowed` 存在且 Wave 1 恒放行（防止误加扣费）。

- [ ] **Step 2：注册 package.json**

```json
"verify:resume-export-formats": "node -r @swc-node/register scripts/verify-resume-export-formats.ts"
```

- [ ] **Step 3：跑通**

Run: `pnpm --filter @ai-job-print/api verify:resume-export-formats`
Expected: `ALL PASS`

- [ ] **Step 4：接入 CI**（`.github/workflows/ci.yml` 的 API 串行 verify 段追加一行 `pnpm --filter @ai-job-print/api verify:resume-export-formats`）

- [ ] **Step 5：commit**

```bash
git add services/api/scripts/verify-resume-export-formats.ts services/api/package.json .github/workflows/ci.yml
git commit -m "test(resume): 新增 verify:resume-export-formats 并接入 CI"
```

### Task 8：Kiosk 采集 major/degree + 透传 + 导出格式菜单

**Files:**
- Modify: `apps/kiosk/src/pages/resume/ResumeSourcePage.tsx`（targetContext 表单加 专业/学历 输入）
- Modify: `apps/kiosk/src/pages/resume/ResumeReportPage.tsx`（进入优化时透传 targetContext，如尚未透传）
- Modify: `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`（导出按钮改为格式选择：PDF/Word/TXT/Markdown）
- Modify: `apps/kiosk/src/services/api/aiHttpAdapter.ts:152-154` 与 `aiMockAdapter.ts`（export 带 `format`）

- [ ] **Step 1：ResumeSourcePage 加两个可选输入（专业、学历），并入现有 targetContext 提交对象**（不新设计页面，沿用现有输入组件与文案风格）

- [ ] **Step 2：ResumeOptimizePage 导出区加格式下拉/分段按钮，调用 `export({...optimizedResume, taskId, format})`；导出成功后提示「已存入我的文档」并保留跳打印入口**

- [ ] **Step 3：adapter 透传 format（http 真实、mock 演示都要支持）**

- [ ] **Step 4：Kiosk typecheck + lint + build**

Run: `pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint && VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true pnpm --filter @ai-job-print/kiosk build`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add apps/kiosk/src/pages/resume/ apps/kiosk/src/services/api/aiHttpAdapter.ts apps/kiosk/src/services/api/aiMockAdapter.ts
git commit -m "feat(kiosk): 目标维度输入与优化版多格式导出入口"
```

### Task 9：收口验证 + 文档 + 双模型审查

- [ ] **Step 1：全量相关 verify + typecheck**

Run:
```
pnpm --filter @ai-job-print/shared typecheck
pnpm --filter @ai-job-print/api typecheck
pnpm --filter @ai-job-print/api verify:resume-optimize
pnpm --filter @ai-job-print/api verify:resume-generate
pnpm --filter @ai-job-print/api verify:resume-export-formats
pnpm --filter @ai-job-print/kiosk typecheck
git diff --check
```
Expected: 全 PASS，无 whitespace 错误。

- [ ] **Step 2：同步 `docs/progress/current-progress.md` 与 `next-tasks.md`**（记录 Wave 1 完成边界：只到代码 + 本地 verify；真实模型 live、预生产、真机不在本轮）。

- [ ] **Step 3：双模型审查（用户要求的门禁）**：对本分支 diff 做 Claude + Antigravity 交叉审查，取得报告；有 Critical 先修。无有效报告不得宣称通过。

- [ ] **Step 4：开 PR 到 main（含 `.github/workflows` 改动，需 gh token `workflow` scope）**，CI 全绿后由用户合并。

---

## 5. 验证命令汇总

| 命令 | 覆盖 |
|---|---|
| `pnpm --filter @ai-job-print/shared typecheck` | SSOT 类型 |
| `pnpm --filter @ai-job-print/api typecheck` | 后端类型 |
| `pnpm --filter @ai-job-print/api verify:resume-optimize` | 优化链路 + 防编造 + 承诺拦截（回归） |
| `pnpm --filter @ai-job-print/api verify:resume-generate` | 生成/导出 PDF（回归） |
| `pnpm --filter @ai-job-print/api verify:resume-export-formats` | **新**：docx/txt/md 导出 + FileObject + 防编造 + 合规 |
| `pnpm --filter @ai-job-print/kiosk typecheck / lint / build` | 前端 |
| `git diff --check` | whitespace |

---

## 6. 回滚风险

| 风险 | 触发 | 回滚 / 缓解 |
|---|---|---|
| `targetContext` 落 `payloadJson` 撑大 parse 行 | 字段过多 | 只落结构化短字段，不落原文；如评审要求独立列，另起子任务出双 additive 迁移 |
| `docx` 依赖引入体积/漏洞 | 新 npm 包 | 锁版本；`pnpm audit` 复核；仅服务端用，不进前端包 |
| optimize prompt 加 targetContext 后偶发把目标当既有事实 | LLM 越界 | 保留既有事实串必须在原文的校验；`verify:resume-optimize` 承诺/编造断言必须仍绿；违反即拒绝输出 |
| 非 pdf 格式 `pageCount` 语义 | 响应字段 | docx/txt/md 返回 0 或省略，前端不显示页数 |
| 前端导出菜单误触发计费联想 | UI 文案 | Wave 1 不出现任何价格/付费文案；`assertExportFormatAllowed` 恒放行 |
| 改到工作树 v6 UI 文件 | 越界 | allow-list 明令禁止碰 `apps/kiosk/src/pages/home/**` 与 `packages/ui/**` |
| 单文件回滚 | 任一 Task | 每 Task 独立 commit，可 `git revert <task-commit>` 单独回退 |

**整体回滚**：本 Wave 全在独立分支 `worktree-resume-optimize-wave1`，未合入 main 前对生产/预生产零影响；放弃即删分支/worktree。

---

## 7. 合规红线（本轮必须保持）

- 简历诊断/优化/导出仅服务求职者本人；不推企业、不平台投递、不候选人筛选/邀约/Offer。
- 导出文件走 FileObject + 短时签名 URL（≤30min），不长期公开；沿用现有 TTL 与删除审计。
- 防编造：docx/txt/md 与 pdf 一致，事实字段逐字来自用户输入/原文，AI 不新增经历。
- 无「保录用/内推/一键投递」等承诺或越界文案。
- 简历原文不落库口径不变；targetContext 只落结构化字段。

---

## Self-Review 结论

- 目标 #2/#5/#10 各有对应 Task（1-3 维度贯穿、4-6 导出、6-8 落文档+前端、7 verify）。✅
- 无占位：类型改动、签名、渲染器职责、verify 断言项、验证命令均具体。✅
- 类型一致：`ResumeTargetContext`(major/degree)、`optimizeResume(...,targetContext?)`、`export(...,format)` 在各 Task 命名一致。✅
- 非目标显式排除支付/语音/URL抓取/模板填充/真机。✅
