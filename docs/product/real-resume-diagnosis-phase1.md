# 真实 AI 简历诊断 Phase 1 技术方案

> 状态：**方案文档（待 review，未编码）**
> 创建：2026-06-09 · 基线 main `cb98a96`（PR #41 上传页真实化 + mock 标记演示、PR #42 删除简历服务中心中间页之后）
> 关联：[CLAUDE.md](../../CLAUDE.md) §3/§11/§18 · [compliance-boundary.md](../compliance/compliance-boundary.md) · [next-tasks.md](../progress/next-tasks.md) §AI 简历诊断真实化后续 · [current-progress.md](../progress/current-progress.md)
> 目标：让 AI 简历诊断报告**真正基于上传文件内容生成**，而不是 mock。本文只定方案与验收口径，不写业务代码。

---

## 0. TL;DR（一句话结论）

地基已经齐了：Kiosk 上传产出**真实 `fileId`**，后端 `FilesService.readContent(fileId)` 已能读出文件 buffer，`AiResumeResult` 留存/过期/归属/匿名令牌全部就绪，前端 `providerName==='mock'` 已驱动演示横幅。**Phase 1 缺的只有中间三块**：①服务端「buffer → 文本」提取层（PDF/DOCX，**图片/扫描件 OCR 列二期**）；②一个**真实 LLM provider**（复用现有 `LlmConfigService` 加密凭证 + OpenAI 兼容协议，不引 SDK）；③提取/未配置失败时**返回明确 `failReason` 而非假报告**。报告结构 **Phase 1 沿用 `sections + suggestions`**，strengths/issues/nextSteps 留 Phase 1.1。

---

## 一、当前真实状态审计

### 1.1 AI_PROVIDER：哪些真实、哪些 stub/mock

`AiService` 构造时按 `process.env['AI_PROVIDER']`（默认 `mock`，见 [ai.service.ts:102](../../services/api/src/ai/ai.service.ts#L102)）从固定 map 选一个 provider，未知值**启动即抛 `AI_PROVIDER_INVALID`，不静默回退**（[ai.service.ts:103-110](../../services/api/src/ai/ai.service.ts#L103-L110)）。

| provider | 简历 parse / optimize 真实性 | 说明 |
|----------|------------------------------|------|
| `mock` | **假数据**（默认） | [mock.provider.ts](../../services/api/src/ai/providers/mock.provider.ts) 返回写死的 5 个分项 + 4 条建议，**完全忽略 `fileId` / 文件内容** |
| `openai` | **stub** | [openai.provider.stub.ts](../../services/api/src/ai/providers/openai.provider.stub.ts) 每个方法 `throw new NotImplementedException` |
| `claude` | **stub** | 同上 |
| `qwen` | **stub** | 同上 |
| `zhipu` | **stub** | 同上 |
| `local` | **stub** | 同上 |

**关键审计点 ——「简历」和「AI 助手对话」是两套互不相通的配置系统：**

- **简历 parse/optimize** 走 `AI_PROVIDER` → provider map（除 `mock` 外全是 stub）。**当前没有任何真实路径**，`providerName` 来自 `this.provider.name`。
- **AI 助手 chat** 走 [`LlmConfigService.isReady()`](../../services/api/src/ai/llm/llm-config.service.ts#L153)：若管理员配置了 LLM（默认 DeepSeek，OpenAI 兼容），`chatWithAssistant` 实际调用 [`LlmChatService.chat()`](../../services/api/src/ai/ai.service.ts#L359-L363) 走真实大模型，否则降级到 provider。

> 即「**助手对话早已能跑真实 LLM，简历诊断却还停在 mock/stub**」。Phase 1 的最佳路径就是把简历诊断接到 chat 已在用的那套加密凭证上（见 §1.2、§2.5）。

### 1.2 `LlmConfigService` / `LlmChatService` 能否复用为简历诊断 provider

**能复用（这是 Phase 1 的核心杠杆），但要分清各自职责：**

- [`LlmConfigService`](../../services/api/src/ai/llm/llm-config.service.ts)：**直接复用**。它已经做了我们需要的全部凭证治理：
  - `vendor / model / baseURL / temperature / systemPrompt / forbiddenWords / enabled`，默认 DeepSeek，首启可读 `AI_LLM_API_KEY` 或 `TRTC_LLM_API_KEY`（[llm-config.service.ts:112-127](../../services/api/src/ai/llm/llm-config.service.ts#L112-L127)）。
  - `apiKey` **AES-256-GCM 加密落盘**，前端只读 `apiKeyConfigured: boolean`；`getApiKey()` 仅服务端解密。
  - `isReady()` = `enabled && 有加密 key`，可直接作为「是否走真实诊断」的门控。
- [`LlmChatService`](../../services/api/src/ai/llm/llm-chat.service.ts)：**复用其 OpenAI 兼容调用范式，但不直接复用类本身**。它内置了「多轮会话记忆 + 站内白名单跳转注入」，这些是**对话专属**的，简历诊断不需要。真正可借鉴的是私有方法 `callLlm()`（`POST {baseURL}/chat/completions`，`Authorization: Bearer`，`stream:false`，用全局 `fetch`，[llm-chat.service.ts:121-159](../../services/api/src/ai/llm/llm-chat.service.ts#L121-L159)）。

**结论：** 新建一个轻量 `LlmResumeService`（单轮、结构化 JSON 输出），构造注入 `LlmConfigService` 复用凭证/vendor，内部复刻 `callLlm` 的请求形态。**不引入任何 OpenAI SDK，沿用全局 `fetch`。** 不要往 `LlmChatService` 里塞简历逻辑，避免把对话会话态和诊断混在一起。

### 1.3 `FileObject` / `StorageService` / `FilesService` 能否让服务端读出 buffer

**完全可以，且无需新增存储能力。** 现成调用链：

- [`FilesService.readContent(fileId)`](../../services/api/src/files/files.service.ts#L371-L375) → `requireAlive` 校验未删 → `StorageService.getObject(storageKey, bucket)` → 返回 `{ buffer, mimeType, filename }`。
- `StorageService` 已抽象 local/COS 双后端并按 `bucket` 路由读取（[storage.service.ts](../../services/api/src/storage/storage.service.ts)），简历诊断**不感知** local 还是 COS。
- [`FilesModule` 已 `exports: [FilesService]`](../../services/api/src/files/files.module.ts#L34)，`AiModule` 只需 `imports: [FilesModule]` 即可注入。

**注意点（写进实现约束）：**
1. `readContent` 当前**不做归属鉴权**（它服务于已签名的 `/content` 代理）。简历诊断里 `fileId` 来自同一次会话的上传响应，但 service 层仍应在读取前确认 `purpose ∈ {resume_upload, resume_scan}`，避免被传入任意 fileId 读非简历文件。
2. `resume_upload` 是 `highly_sensitive`，TTL=**1 小时**（[file.types.ts:45-49](../../services/api/src/files/file.types.ts#L45) + [file-validation.ts `DEFAULT_SENSITIVE_BY_PURPOSE`](../../services/api/src/files/file-validation.ts)）。**提取必须在 parse 当次（上传后立即）完成**，不能指望几小时后还能回读 buffer。
3. 若 `fileId` 不存在/已清理（含前端兜底的 `local-${Date.now()}` 假 id，见 [ResumeParsePage.tsx:61](../../apps/kiosk/src/pages/resume/ResumeParsePage.tsx#L61)），`readContent` 抛 `FILE_NOT_FOUND` → Phase 1 须捕获并转成**明确 `failReason`**，不得继续生成假报告。

### 1.4 Kiosk 上传 `resume_upload` 的归属 / TTL / 签名 URL / 匿名安全边界

- **真实 fileId 链路已通**：[ResumeSourcePage](../../apps/kiosk/src/pages/resume/ResumeSourcePage.tsx#L116) `kioskUploadFile(file, 'resume_upload', token)` → 真实落 `FileObject` → 拿 `fileId` → 经 `location.state.fileId` 传到 [ResumeParsePage](../../apps/kiosk/src/pages/resume/ResumeParsePage.tsx#L61) → `submitResumeParse({ fileId, ... })`。**所以服务端拿得到能读出 buffer 的真实 fileId。**
- **归属**：登录会员上传带 endUserId（owner=`user`）；匿名上传 owner 由 `deriveOwner` 落 `system`。文件访问受 `canAccessFile` 归属校验（[files.service.ts:503-524](../../services/api/src/files/files.service.ts#L503)）。
- **TTL / 签名 URL**：`highly_sensitive` 文件 1h 物理清理；所有访问走 ≤30min 签名 URL（合规硬上限 `MAX_SIGN_TTL_SECONDS`，[storage.service.ts:28](../../services/api/src/storage/storage.service.ts#L28)）。
- **匿名 / 会员结果安全（Phase C-2A 已落地，Phase 1 不动）**：匿名 `POST /resume/parse` 铸 192-bit 一次性 token，DB 只存 `accessTokenHash`（SHA-256），明文只回一次；读取走 `x-resume-access-token` header（不进 query），`timingSafeEqual` 校验；会员按 `endUserId` 本人校验；历史 null-hash 行 fail-closed（[ai.service.ts:166-244](../../services/api/src/ai/ai.service.ts#L166-L244)）。

### 1.5 `ResumeReport` 当前只能表达什么

`ResumeReport` 是两处保持同步的 SSOT（前端 [shared/ai.ts:42-45](../../packages/shared/src/types/ai.ts#L42) + 后端 [interfaces/ai-provider.interface.ts:26-29](../../services/api/src/ai/interfaces/ai-provider.interface.ts#L26)）：

```ts
interface ResumeReport {
  sections: ResumeSection[]   // { key, label, score, maxScore }
  suggestions: string[]
}
```

即当前**只能表达**：①若干「分项 + 0~满分」评分（驱动雷达图、总分、优先修改项）；②一组纯文本可执行建议。**无法**表达「优势亮点 / 问题风险点 / 下一步建议 / 提取事实摘要」等结构化块——这些要扩类型（见 §五）。

### 1.6 报告页 `providerName` 演示标记如何工作

[ResumeReportPage.tsx:163-167](../../apps/kiosk/src/pages/resume/ResumeReportPage.tsx#L163)：

```tsx
{(API_MODE !== 'http' || providerName === 'mock') && (
  <ComplianceBanner tone="info">{COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}</ComplianceBanner>
)}
```

即横幅在「mock 适配器模式」**或**「http 模式但后端 `providerName === 'mock'`」时显示。`providerName` 来自 `submitResumeParse` 响应里 `AiService` 注入的 `this.provider.name`（[ai.service.ts:172](../../services/api/src/ai/ai.service.ts#L172)），刷新后由 `getResumeRecord` 重新带回。

> **推论（Phase 1 验收关键）：只要真实 provider 返回的 `providerName !== 'mock'`，演示横幅自动消失。** 不需要改前端横幅逻辑，只需让真实 provider 有一个非 `mock` 的诚实标识。

---

## 二、Phase 1 推荐最小闭环

> 目标：上传 PDF/DOCX → 服务端读 buffer → 提取文本 → 真实 LLM 输出结构化 `ResumeReport` → 前端按真实报告渲染、演示横幅消失。失败一律明确报错，绝不伪造。

### 总体数据流（改造后）

```
ResumeSourcePage(真实上传, fileId)
   → ResumeParsePage → POST /resume/parse { fileId, fileFormat, source }
      → AiController.submitResumeParse
         → AiService.submitResumeParse(input, endUserId)
            ① FilesService.readContent(fileId) → buffer (校验 purpose ∈ resume_*)
            ② ResumeExtractionService.extract(buffer, mimeType, fileFormat) → { ok, text, pageCount, failReason }
            ③ ok=false → 返回 { status:'failed', failReason, providerName } （不调 LLM、不落假报告）
            ④ ok=true  → provider.parseResume({ ...input, extractedText, extractedPageCount })
                 - mock provider：忽略 text，仍返回演示报告 → providerName='mock' → 前端横幅显示
                 - llm  provider：调 LlmResumeService.diagnose(text) → 结构化 ResumeReport → providerName='llm'
            ⑤ persistResult（payloadJson 只存 report，绝不含原文）+ expiresAt(24h) + 匿名令牌沿用
```

### 2.1 服务端读取 fileId → buffer

- `AiModule` `imports: [FilesModule]`，`AiService` 注入 `FilesService`。
- `submitResumeParse` 开头：`const { buffer, mimeType } = await this.files.readContent(input.fileId)`，包 try/catch；`FILE_NOT_FOUND` / 任意读失败 → 走「失败返回」（§2.7）。
- service 层先查 `FileObject.purpose`（经 `FilesService` 暴露一个轻量 `getMeta(fileId)` 或在 `readContent` 增加 purpose 返回）确认 ∈ `{resume_upload, resume_scan}`，否则拒绝。

### 2.2 PDF 文本层基础提取

- 用 **`unpdf`**（纯 JS、pdf.js serverless 版，详见 §三）解析文本层：`extractText(buffer)` → 拼接各页文本。
- 仅取**文本层**；无文本层（扫描版 PDF，提取结果为空/接近空）→ 判定为「需 OCR」→ Phase 1 返回明确失败（§2.4、§2.7），**不 OCR、不编造**。
- 设一个「最小有效文本长度」阈值（如去空白后 < 30 字符视为提取失败/扫描件）。

### 2.3 DOCX 基础文本提取

- 用 **`mammoth`**（纯 JS）`extractRawText({ buffer })` → 正文纯文本。
- `mammoth` 只支持 **OOXML `.docx`**，**不支持**老式二进制 `.doc`（Word 97-2003）。`.doc` → 明确失败：「暂不支持 .doc，请另存为 PDF 或 DOCX 后重试」（kiosk `accept` 含 `.doc`，必须优雅处理而非崩）。

### 2.4 图片 OCR 是否一期做 —— **明确建议：列二期，Phase 1 不做**

**结论：与你的倾向一致，OCR 进二期。** 理由：

1. **跨平台 + Node 26 风险**：本机 Node 已是 **v26**。原生 `tesseract` 需系统二进制，Windows 一体机/Agent 部署不友好；`tesseract.js` 是 WASM、运行时还要下载 ~10–15MB 语言包、单张图秒级耗时，且要确认 Node 26 下 WASM 加载稳定。两条路都不符合「轻量、稳定、生产可用」。
2. **合规与质量**：OCR 出错率高，错字会污染诊断质量；公共一体机上更应「读不出就老实说读不出」，而不是猜。
3. **闭环价值**：PDF/DOCX 已覆盖绝大多数主动上传简历的场景，足以让 Phase 1「真实诊断」成立。

**Phase 1 对图片/扫描件的处理**：`id_scan`/图片格式 / 无文本层 PDF → `status:'failed'`，`failReason='图片 / 扫描件简历暂不支持自动文字识别（二期开放），请上传带文字层的 PDF 或 DOCX'`。**绝不假装识别**（对应验收 §六-7）。

> 二期 OCR 若做，优先评估 `tesseract.js`（WASM，纯前/后端可跑）的 Node 26 兼容性 + 模型包随包内置（不联网下载），或「扫描到 PC/U盘后由 Agent 侧 OCR」的硬件路径；与本方案解耦。

### 2.5 调用真实 LLM Provider 输出结构化 `ResumeReport`

- 新增 provider 名 **`llm`**（见下「union 改动」），DI 注入 `LlmConfigService` + 新建 `LlmResumeService`。
- `LlmResumeService.diagnose(extractedText)`：
  - 取 `LlmConfigService.getApiKey() / getConfig()`；`isReady()===false` → 抛/返回失败（不伪装）。
  - 构造**单轮**消息：`system`=诊断专用提示词（固定 5 个分项维度、要求**严格 JSON 输出**、不得编造经历、不得给录用/投递结论）；`user`=提取文本（可截断到合理上限，如 ~12k 字符防超长）。
  - `POST {baseURL}/chat/completions`，`temperature` 低（如 0.2，诊断要稳定），`stream:false`，全局 `fetch`。
  - 解析返回 JSON → 映射成 `ResumeReport`；**强校验 sections/suggestions 形状**，非法 → 失败（不塞半成品）。
- `LlmResumeProvider.parseResume()` 调用上面的 service，`name='llm'`，`optimizeResume()` Phase 1 可先沿用「基于已生成 report 的表达优化」单轮调用（或暂返回失败提示，二选一，见 §七 Phase 1E）。

**union 改动（additive，两处 SSOT 同步，参照仓库既有约定）**：
- [shared/ai.ts `AiProviderName`](../../packages/shared/src/types/ai.ts#L20) 增 `'llm'`
- [interfaces/ai-provider.interface.ts `AiProviderName`](../../services/api/src/ai/interfaces/ai-provider.interface.ts#L14) 增 `'llm'`
- `KNOWN_PROVIDERS` + provider map + `AiModule.providers` 各加一项

> 备选方案：不加 union，改为「把某个 stub（如 `qwen`）实现成真调用 + 自带 env key」。**不推荐**：会另起一套未加密的凭证管理，且 `qwen` 标识与「实际用 DeepSeek」不诚实。`llm` 通用标识 + 复用 `LlmConfigService` 加密凭证更干净、更合规。

### 2.6 providerName 非 mock 才不显示演示横幅

无需改前端。真实路径返回 `providerName='llm'` → `providerName === 'mock'` 为 false → 横幅自动隐藏（§1.6）。`AI_PROVIDER=mock`（默认/未配置）→ 仍 `'mock'` → 横幅显示。**这天然满足验收 §六-1/2。**

### 2.7 提取失败返回明确 failReason，不生成假报告

统一失败出口（`status:'failed'` + 具体 `failReason` + `providerName`，**无 `report`**）覆盖：

| 失败场景 | failReason（示例） |
|----------|--------------------|
| fileId 不存在 / 已清理 / 非简历用途 | 文件已失效或无法读取，请重新上传 |
| PDF 无文本层（扫描件） | 检测到扫描件/图片简历，暂不支持自动识别（二期开放），请上传带文字层的 PDF 或 DOCX |
| `.doc` 旧格式 / 图片 | 暂不支持该格式，请另存为 PDF 或 DOCX 后重试 |
| 提取文本过短/为空 | 未能从文件中提取到有效简历文字，请确认文件内容 |
| `AI_PROVIDER=llm` 但未配置/未启用 | AI 诊断服务尚未配置，请联系管理员（当前不可生成真实报告） |
| LLM 返回非法 JSON / 超时 | AI 诊断服务暂时不可用，请稍后重试 |

前端 [ResumeParsePage](../../apps/kiosk/src/pages/resume/ResumeParsePage.tsx#L69) 已处理 `result.status === 'failed'` → 跳失败页展示 `failReason`，无需改动。

---

## 三、依赖选择

`services/api/package.json` 现状：**无任何 PDF/DOCX/OCR 依赖**（全仓库 grep 0 命中）；LLM 调用用全局 `fetch`（无需 SDK）。Phase 1 仅需 2 个**纯 JS、零原生绑定**依赖：

| 依赖 | 用途 | 跨平台/Node26 | 安全风险 | 安装体积/速度 | 生产可用 | 结论 |
|------|------|---------------|----------|----------------|----------|------|
| **`unpdf`** | PDF 文本层提取（pdf.js serverless 封装） | 纯 JS，无原生绑定，Win/Mac/Node 26 安全 | 低：只读解析，不执行 PDF JS；建议设页数/大小上限防 zip-bomb 式超大文件 | 中（内含 pdf.js，数 MB），无编译步骤，安装快 | 是（专为 serverless/Node 设计） | **采用** |
| **`mammoth`** | DOCX→纯文本 | 纯 JS，无原生绑定，Win/Mac/Node 26 安全 | 低：解析 OOXML；仅取 rawText | 小，安装快 | 是（社区广泛、成熟） | **采用** |
| ~~`tesseract.js`~~ | 图片/扫描件 OCR | WASM，需确认 Node 26；运行时下载语言包 | 中：联网拉模型/体积大 | 大（模型 ~10–15MB） | 慎用 | **二期再评估** |
| ~~`pdf-parse`~~ | PDF 提取（备选） | 纯 JS 但较老、CJS、历史上有 import 副作用 | — | — | — | 不选，`unpdf` 更现代 |
| ~~`word-extractor` / antiword~~ | 旧 `.doc` 提取 | 偏原生/外部依赖 | — | — | — | 不选，`.doc` 一期直接失败提示 |

**LLM 调用不新增依赖**：复用全局 `fetch` + `LlmConfigService` 凭证（OpenAI 兼容协议），与 `LlmChatService` 同源。

> 安装前在 `services/api` 实跑一次确认 Node 26 下 `pnpm add unpdf mammoth` 无原生编译告警、`typecheck/build` 通过，再进入编码。

---

## 四、安全与合规

| # | 要求 | Phase 1 处理 |
|---|------|--------------|
| 1 | 简历原文**原则上不落库** | ✅ 提取文本只在内存中从 `readContent` → 提取 → 传 LLM → 丢弃；**不写任何表**。`AiResumeResult.payloadJson` 只存 `report`（分项评分 + 建议），不存原文。原始文件仍是 `highly_sensitive`、1h TTL、cron 物理清理，沿用现有机制。 |
| 2 | AI prompt **不得写入原文日志** | ✅ `AiLogService.record` 现状只记 `taskId/provider/operation/latencyMs/status`（元数据），**Phase 1 严禁把 prompt/提取文本/LLM 请求体写日志**。注意：`LlmChatService` 出错时会 `logger.error(body.slice(0,300))`——`LlmResumeService` **不得**照搬此行为，出错只记 `status`/错误码，不记请求/响应正文。 |
| 3 | `payloadJson` **不得存完整原文** | ✅ `persistResult` 落库的是 `report`；real provider 的 sections/suggestions 是**派生结论**，提示词须要求「建议中不得整段回贴简历原文」。验收用断言校验（§六-4）。 |
| 4 | AI 结果 TTL 沿用现有 `AiResumeResult.expiresAt` | ✅ 不改留存逻辑：`persistResult` 已写 `expiresAt = now + AI_RESUME_RESULT_TTL_HOURS`（默认 24h），`loadAuthorizedResult` 过期视为不存在，`AiResultCleanupTask` 每小时清。接真 provider 后**无需改动**（[ai.service.ts:38-42](../../services/api/src/ai/ai.service.ts#L38) 注释已预告此场景）。 |
| 5 | 会员 endUserId / 匿名 accessToken 读取规则保持 | ✅ Phase 1 **完全不碰** Phase C-2A 归属/令牌门禁；`submitResumeParse(input, endUserId)` 签名不变，匿名铸 token、会员按本人校验、optimize 继承 hash 全部沿用。 |
| 6 | API Key 只在服务端 env/配置 | ✅ 复用 `LlmConfigService` 的 AES-256-GCM 加密落盘；前端只读 `apiKeyConfigured`；`unpdf`/`mammoth` 不涉密钥。 |
| 7 | 不向企业发简历、不做候选人推荐/投递 | ✅ 诊断结果只回求职者本人（沿用归属门禁）；提示词显式禁止输出录用/投递/企业匹配结论；不新增任何对外发送路径。沿用 [compliance §二/§四](../compliance/compliance-boundary.md)。 |

补充约束：
- 提取文本传 LLM 前**按字符上限截断**（防超长 + 控成本），截断只影响本次分析，不落库。
- `readContent` 在简历诊断入口须校验 `purpose ∈ resume_*`，避免被借道读任意文件。

---

## 五、报告结构建议

**采纳你的倾向：Phase 1 先沿用 `sections + suggestions`，不扩结构。**

理由：扩 `strengths / issues / nextSteps / extractedFactsSummary` 会同时牵动 ① `shared/ai.ts` + 后端 interface 两处类型；② `LlmResumeService` 提示词与 JSON schema；③ [ResumeReportPage](../../apps/kiosk/src/pages/resume/ResumeReportPage.tsx) 渲染（雷达图/总分/优先项现全由 `sections` 派生）。一次改太多会放大「真实化」这步的回归面。Phase 1 的目标是**让现有结构的内容变真**，而不是同时换结构。

- **Phase 1（本方案）**：`sections`(5 固定维度) + `suggestions`，由真实 LLM 基于提取文本生成。前端零改动即可渲染真实数据、隐藏演示横幅。
- **Phase 1.1（后续小步）**：扩 `ResumeReport` 增 `strengths[] / issues[] / nextSteps[]`（对应参考图「优势亮点 / 问题风险点 / 下一步建议」），同步前端卡片与提示词 JSON schema。
- **Phase 2（更后）**：`extractedFactsSummary`（非 PII 的高层摘要，如「识别到 3 段经历 / 本科 / 2 个项目」用于取信），**须确保摘要不含可定位个人的原文片段**，且评估是否落 `payloadJson`（默认不落或只落统计量）。

---

## 六、验收标准（verify 脚本设计）

新增脚本 `scripts/verify-resume-diagnosis.ts`（`pnpm --filter @ai-job-print/api verify:resume-diagnosis`），离线、零外部费用 —— 参照 [`verify:job-sync`](../../services/api/package.json#L15) 用**本地 stub HTTP LLM 端点**（返回固定结构化 JSON），覆盖 7 条断言：

| # | 验收点 | 断言设计 |
|---|--------|----------|
| 1 | mock provider 被标记为演示 | `AI_PROVIDER=mock` 跑 parse → 响应 `providerName === 'mock'`（前端据此显横幅） |
| 2 | 未配置真实 provider 时不伪装成功 | `AI_PROVIDER=llm` 且 `LlmConfig` 未就绪 → `status==='failed'` + 明确 `failReason`，**无 `report`**，绝不返回 mock 内容 |
| 3 | 文件内容提取失败返回明确原因 | 喂「无文本层 PDF」「`.doc`」「损坏/空 buffer」→ 各自 `status:'failed'` + 对应 `failReason`，`report===undefined` |
| 4 | `payloadJson` 不含简历原文全文 | 提取文本中埋唯一哨兵串（如 `ZZ_SECRET_RESUME_TOKEN_42`）→ 跑真实(stub)诊断 → 读 `AiResumeResult.payloadJson`，断言**不包含**该哨兵串 |
| 5 | 匿名/会员归属读取规则未被破坏 | 直接复跑现有 [`verify:ai-result-ownership`](../../services/api/package.json#L21)（12 类断言）保持 ALL PASS |
| 6 | PDF/DOCX 样例生成**非 mock** 报告 | 用最小真实 PDF/DOCX 样例 → 经提取 → stub LLM 返回固定 JSON → 响应 `providerName==='llm'` 且 `report.sections.length>0`、`suggestions.length>0` |
| 7 | 图片/OCR 不假装识别 | 喂图片 buffer → `status:'failed'` + `failReason` 含「暂不支持/二期」，**不返回任何 report**（绝不出现假分数） |

额外保证：`api typecheck / lint / build` 三绿；合规禁词扫描 0 命中（不得出现「投递/录用/必然提分」类文案）。

---

## 七、推荐实施顺序

> 独立 feature 分支开发（禁止 main 直接提交）。每步可单独验证、单独回退。

- **Phase 1A —— 文件内容提取 service（不接 LLM，先把「读得出文字」做实）**
  - 新增 `ResumeExtractionService`：注入 `FilesService`；`extract(fileId)` → `readContent` → 按 mime/format 分派 `unpdf`(PDF) / `mammoth`(DOCX) → `{ ok, text, pageCount, format, failReason }`。
  - `AiModule imports: [FilesModule]`；purpose 白名单校验；`.doc`/图片/扫描件/空文本 → 失败分支。
  - 装依赖（`unpdf`、`mammoth`）并确认 Node 26 下 install/build 通过。
  - 单元验证：各格式样例提取文字、失败样例返回正确 failReason。

- **Phase 1B —— 真实 LLM resume provider**
  - 新增 `LlmResumeService`（注入 `LlmConfigService`，单轮结构化 JSON 调用，低 temperature，截断上限，出错不记正文）。
  - 新增 `llm` provider（`name='llm'`，`parseResume` 串「提取文本 → diagnose → ResumeReport」）；union/`KNOWN_PROVIDERS`/map/module 四处 additive 改动。
  - `AiService.submitResumeParse` 接入：先提取 → 失败直接返回 → 成功传 `extractedText` 给 provider（mock 忽略、llm 使用）。
  - 提示词：固定 5 维度、严格 JSON、禁编造经历、禁录用/投递结论、建议不回贴原文。

- **Phase 1C —— verify 脚本 + 安全断言**
  - 实现 `scripts/verify-resume-diagnosis.ts`（§六 7 条 + 本地 stub LLM 端点）。
  - 复跑 `verify:ai-result-ownership` 确认归属未回归。
  - 断言 `payloadJson` 无原文、日志无 prompt、failReason 覆盖完整。

- **Phase 1D —— Kiosk 运行期手验**
  - 真实 API（`FILE_STORAGE_DRIVER=local` 或测试 COS 桶）+ `AI_PROVIDER=llm` + 管理员配好 LLM 凭证。
  - 浏览器手验：上传 PDF/DOCX → 诊断报告**无演示横幅**、内容随简历变化；上传图片/`.doc` → 明确失败提示；`AI_PROVIDER=mock` → 横幅回来。
  - 匿名拿 token 刷新仍可读、屏保后下一位读不到（沿用 C-2A 手验口径）。

- **Phase 1E —— 后续报告结构扩展（Phase 1.1，本批不做）**
  - 扩 `strengths / issues / nextSteps`（参考图三块）+ 前端卡片 + 提示词 schema。
  - optimize 真实化（若 1B 暂未接 optimize，在此补「基于真实 report 的表达优化」单轮调用）。
  - 评估 `extractedFactsSummary`（非 PII，谨慎落库）。

---

## 八、未决问题 / 需 review 决策

1. **provider 命名**：采用新增 union 成员 `'llm'`（推荐）还是复用某 stub 名（如 `qwen`）？本方案推荐 `'llm'` + 复用 `LlmConfigService`。
2. **optimize 是否进 Phase 1**：建议 1B 先只做 parse 真实化，optimize 放 1E；或 1B 一并做（成本略增）。需你定。
3. **文本截断上限**：建议 ~12k 字符；视所选 vendor 上下文与成本微调。
4. **`AI_PROVIDER` 未进 `.env.example`**：实现时补充 `AI_PROVIDER`（含 `llm`）与提示词相关说明到 `.env.example`，避免上线漏配静默走 mock。
5. **扫描件提示文案**：「二期开放 OCR」措辞需与产品/合规对齐，确保不暗示「以后一定支持」承诺。
