# AI 文件体检真实化 设计文档

> 分支：`feature/material-check-real`
> 背景：`打印扫描首期全功能商用版`路线图轨道 C 的第一部分。轨道 C 原计划包含"AI 文件体检"和"材料包"两部分；经评估两者是独立子系统，本轮只做前者。材料包（多文件组合打印）留作独立立项。

## 1. 现状与问题

Kiosk 已有完整的单文件体检 UI 与后端流程：`apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx` 驱动 `inspection → normalize_a4 → pii_scan → pii_redact` 四步，后端由 `services/api/src/materials/materials.service.ts`（840 行）承载。

- `inspection`（页数/尺寸/DPI 估算/`canPrint` 判定）：**已经是真实实现**——对 PDF 用 `countPdfPages` 轻量字节扫描，对图片用手写二进制解析拿真实像素尺寸，估算 A4 打印 DPI 是否达标。不需要大改。
- `pii_scan`（隐私片段检查）：**当前是模拟实现**。`buildSimulatedPiiFindings({filename, textSample})` 只对"文件名 + 可选的调用方自带 textSample"跑正则，**从不读取文件真实内容**。Kiosk 页面已诚实地在结果卡片上标注"流程演示" badge（`isDemoTask` 判定 `mode` 是否为 `mock/skeleton/simulated`）。
- **空白页检测：完全不存在**，roadmap 里列为"AI 文件体检"应有能力之一。
- `normalize_a4`、`pii_redact`：评估态 stub（只返回"是否可以做"的判断，不产出真实文件）。本轮不碰，留作独立子问题。

## 2. 本轮目标

把 `pii_scan` 从"模拟"改为"真实"，新增空白页检测，让 `PrintMaterialCheckPage` 摘掉"流程演示"标签，成为一个对用户诚实、真正有用的文件体检环节。

**不做的事**（明确边界，供实现和审查对照）：
- 不碰材料包/多文件选择（独立子问题）
- 不碰 `normalize_a4`/`pii_redact` 的"评估态 stub → 真实生成文件"（独立子问题）
- 不改动 `services/api/src/ai/resume/ocr/pdf-page-renderer.ts`、`services/api/src/ai/resume/resume-extraction.service.ts` 本体（只新增调用方，不动现有简历 OCR 诊断链路的行为）
- 不新增 Prisma schema 字段（`InspectionSummary`/PII finding 的结构扩展都是运行时 JSON，落在 `DocumentProcessTask.resultJson`/`PiiFinding` 表既有字段里）
- 不扩大"哪些打印流程会经过体检页"的范围（例如不把扫描来源的打印路径接入 `/print/material-check`——那是现有设计就没做的事，扩大范围是另一个决策）

## 3. 架构：复用现有 OCR/渲染能力

`services/api/src/ai/resume/ocr/` 下已有生产级基础设施（简历 OCR 诊断在用，非本轮新建）：

- `OcrService.recognize({buffer, mimeType}): Promise<OcrResult>`——统一 OCR 入口，按 `OCR_PROVIDER` env 选择 `disabled|tencent|baidu` 实现。`DisabledOcrProvider` 遵循"读不出就如实报错，绝不返回假识别文本"的既定契约。
- `openPdfForRender(buffer): Promise<RenderedPdf>`（`pdf-page-renderer.ts`）——用 `@napi-rs/canvas` + pdfjs 把 PDF 逐页渲染成 PNG buffer，`renderPage(pageNumber, scale)` 可控制渲染分辨率。

**模块接线**：`OcrService` 目前只在 `AiModule` 内部使用，未导出。本轮在 `AiModule.exports` 追加 `OcrService`，`MaterialsModule.imports` 追加 `AiModule`。不做更大范围的模块拆分（例如把 OCR 独立成 `OcrModule`）——收益是解耦，代价是要挪动现有 provider 注册代码，风险与本轮目标不成比例，故不做。

`materials.service.ts` 新增一个纯函数式的内容提取步骤（不复用/不改动 `resume-extraction.service.ts`，避免给现有简历诊断链路增加意外依赖）：

```
async function extractTextForPiiScan(
  buffer: Buffer,
  mimeType: string,
  ocr: OcrService,
): Promise<{ text: string; perPage: Array<{ pageNumber: number; text: string }> | null; degraded: boolean; degradedReason?: string }>
```

- `mimeType === 'application/pdf'`：先用 `unpdf` 抽取内嵌文字层（born-digital PDF 通常已有文字，零 OCR 成本）。若抽出的文字为空/仅空白（说明是扫描件/图片型 PDF），改用 `openPdfForRender` 逐页渲染 + `OcrService.recognize` 逐页识别，拼接 `perPage`。
- 图片 MIME（`isSinglePageImage` 已有的判定）：直接 `OcrService.recognize({buffer, mimeType})`。
- OCR 被禁用（`OCR_NOT_CONFIGURED`）或识别失败（`OCR_FAILED`）：返回 `degraded: true`，不静默回退到文件名匹配冒充真结果。

## 4. 真实 PII 扫描

新函数 `buildPiiFindingsFromText(text: string, perPage: Array<{pageNumber, text}> | null)` 复用 `materials.service.ts` 现有的 `collectMatches` + 手机号/邮箱/地址正则 + `maskPiiSnippet` 逻辑（原样搬迁，只是输入源从"文件名+textSample"换成"真实提取文本"；有 `perPage` 时按页分别跑一遍以填充真实 `pageNumber`，没有时——即 unpdf 整体抽取、无法切页——`pageNumber` 仍为 `null`，与现状一致，不是回退）。

**范围控制（按用途区分，控制 OCR 成本）——设计过程中发现一个现有信号缺口，一并修正**：

原计划"按 `sourceFile.purpose` 区分文档/照片"在核实代码后发现不成立：`PrintScanHomePage` 的"照片打印"卡片确实想传递 `state: { category: 'photo' }`，但 `PrintUploadPage` 从未读取这个 state，两种入口最终都以 `purpose="print_doc"` 落库——`purpose` 本身**无法**区分文档和照片。同时 `id_scan`/`resume_scan` 这类天然高风险的图片类文件必须始终真实扫描，所以"图片一律跳过"也是错的（会跳过最该扫的那批）。

修正方案（把这个被丢弃的信号补上，而不是绕开它）：
1. `sourceFile.purpose` ∈ `{resume_upload, resume_scan, id_scan, cover_letter}`（天然高风险，与"照片/文档"入口无关）——**永远真实扫描**，不接受任何跳过提示。
2. `sourceFile.purpose === 'print_doc'`（文档打印与照片打印当前共用的入口）——是否跳过看创建 `pii_scan` 任务时客户端传入的 `contentCategory` 参数（新增到 `CreateMaterialTaskDto.params` 的已识别 key，走既有 `sanitizeParams`/`assertSupportedTaskParams` 机制）：`contentCategory==='photo'` → 跳过，返回 `{mode:'skipped_non_document', findingCount:0}`；缺省或其它值 → 真实扫描（宁可多扫，不可少扫）。
3. 其余 purpose（`fair_material`/`partner_*`/`screensaver_material`/`admin_upload`/`temp`）不会经过这个 Kiosk 打印体检页，不需要特别处理。

**顺带修复信号断链**：`apps/kiosk/src/pages/print/PrintUploadPage.tsx` 需要实际读取 `location.state?.category`，通过 `printMaterialSession.ts` 的会话状态带到 `PrintMaterialCheckPage`，创建 `pii_scan` 任务时作为 `contentCategory` 参数传给后端。这是让"照片打印跳过扫描"这个已经批准的产品决定真正生效的必要前提，不是范围扩大——没有这一步，"按用途区分"这个决定在代码里根本落不了地。

**结果三态**（体现在 `DocumentProcessTask.resultJson.mode`，Kiosk 据此渲染不同文案）：
1. `mode: 'real'`——真实跑完，`findingCount` 是真实数字。
2. `mode: 'skipped_non_document'`——按用途跳过，非文档类文件不需要隐私扫描，UI 显示"该文件类型无需隐私扫描"而非"演示"。
3. `mode: 'degraded'`——需要扫但 OCR 不可用/失败，UI 诚实提示"内容扫描暂不可用，请人工确认文件不含敏感信息"，不显示"流程演示"（那意味着"这本来就是假的"，与"这本该是真的但暂时用不了"是两种不同的诚实表达，不能混为一谈）。

## 5. 空白页检测（新增）

新增私有方法 `detectBlankPages(buffer, mimeType): Promise<number[]>`（返回可能空白的页码列表，1-based；单页图片场景下最多是 `[1]` 或 `[]`）。挂在 `inspection` 任务里调用（`inspectSourceFile` 内部），与 `pii_scan` 任务（第 4 节）是两次独立的 `createTask` 调用、各自独立的 `DocumentProcessTask` 记录——**不做跨任务的渲染结果共享**：两者即使都需要把同一份 PDF 渲成图，也各自独立渲染。理由：`inspection` 和 `pii_scan` 是 Kiosk 分两步分别触发的任务，要共享渲染结果需要引入跨任务缓存（按 fileId 加 TTL），带来的复杂度/失效风险与省下的这点渲染成本不成比例，本轮不做这个优化。

- PDF：用 `openPdfForRender` 逐页渲染，低分辨率（`scale` 取 `0.3` 左右，只为判断"是否空白"不是给人看，越小越省）。
- 图片：直接对上传的图片本身做同样判定，不需要渲染这一步。
- 判定逻辑：把 PNG buffer 解码为像素数据（`@napi-rs/canvas` 的 `loadImage` + 绘制到临时 canvas + `getImageData()`），统计"接近纯白（RGB 均 > 250）像素占比"，超过阈值（初定 99%，实现时可调）判定为疑似空白页。

**结果呈现**：新增 `InspectionSummary.blankPageNumbers?: number[]` 字段（运行时类型，不落 schema）。命中时在 `messages` 追加 `{code: 'BLANK_PAGE_SUSPECTED', severity: 'warning', text: '第 N 页可能为空白页'}`（多页合并为一条或每页一条，实现时按现有 `messages` 数组的既有粒度决定），**不设置 `canPrint: false`**——按之前的决定，这是提示不是阻断。

## 6. Kiosk 前端改动

`apps/kiosk/src/pages/print/PrintUploadPage.tsx`：
- 读取 `location.state?.category`（目前完全没读，是本次发现的信号断链），通过 `printMaterialSession.ts` 的会话状态带到 `PrintMaterialCheckPage`。

`PrintMaterialCheckPage.tsx`：
- 创建 `pii_scan` 任务时，若会话里 `category==='photo'`，在 `createMaterialTask` 的 `params` 里带上 `contentCategory: 'photo'`。
- `isDemoTask` 判定的"流程演示" badge：只在 `mode === 'skeleton'`（`bundle_render` 等尚未实现的任务类型，本页面目前不会触发）时才显示；`pii_scan` 的 `mode: 'real'/'skipped_non_document'/'degraded'` 都不再算"演示"，分别渲染各自的诚实文案（见第 4 节结果三态）。
- 空白页警告：在现有"文件体检摘要"卡片里追加一行展示（复用 `messages` 渲染逻辑，`InspectionMessage.severity==='warning'` 已有橙色样式，不需要新组件）。
- `findings` 列表：`pageNumber` 不再总是 `null`，UI 若已有"第几页"展示位就直接生效；若没有需要新增（实现时确认现状）。

## 7. 测试策略

扩展现有 `services/api/scripts/verify-materials-processing.ts`：
- 真实 PII 扫描：mock `OcrService.recognize` 返回含手机号/邮箱的文本，断言 `findings` 命中且 `mode: 'real'`。
- born-digital PDF 走 `unpdf` 路径不触发 OCR 调用（断言 mock OcrService 未被调用）。
- `purpose==='print_doc'` 且 `contentCategory==='photo'` 直接 `skipped_non_document`，不触发 OCR；`purpose==='id_scan'` 即便带了 `contentCategory==='photo'` 也必须真实扫描（高风险 purpose 不接受跳过提示，断言这条不会被参数绕过）。
- OCR 返回 `OCR_NOT_CONFIGURED`/抛错 → `mode: 'degraded'`，不静默回退模拟结果（这是本轮最容易被后续改动破坏的诚实性保证，需要 mutation-testing 验证：故意让降级分支退回旧的 `buildSimulatedPiiFindings`，确认测试会因为断言 `mode !== 'degraded'` 或断言"OCR mock 未被调用但 findings 非空"而失败）。
- 空白页检测：构造一个"几乎全白" PNG buffer 和一个"有实际内容"的 PNG buffer，断言判定结果符合预期；阈值边界用 mutation-testing 验证（改动阈值判断的比较符号，确认测试会红）。

Kiosk 侧：`apps/kiosk` 目前没有该页面专属的 verify 脚本（复核确认），本轮视情况新增静态断言脚本或依赖 typecheck/lint + 浏览器走查（走查覆盖：真实命中 PII 的文件、无 PII 的正常文件、非文档类文件跳过、模拟 OCR 不可用的降级态四条路径）。

## 8. 已知限制（写入进度文档，不在本轮解决）

- OCR 调用为文档类用途文件增加真实延迟（百度 OCR 单次识别通常秒级，多页文档会串行叠加），本轮不做超时/异步化设计，复用 `OcrService` 已有的超时/并发闸配置。
- 空白页检测阈值（99% 纯白像素）是启发式初始值，未经真实用户数据验证，上线后可能需要根据实际误报率调整。
- 本轮不改变"哪些打印路径会经过体检页"——扫描来源打印（`ScanResultPage.handlePrint`）目前绕过 `/print/material-check` 直接进 `/print/confirm`，本轮不改变这一点；如果未来要求扫描件也走隐私扫描，是独立决策。
