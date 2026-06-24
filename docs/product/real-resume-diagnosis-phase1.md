# 真实 AI 简历诊断 Phase 1 落地记录

> 状态：已落地（代码侧）
> 更新：2026-06-24
> 基线：`origin/main`
> 范围：记录当前 `main` 中真实简历诊断的实现、边界和验证方式；不改变运行时代码。

## 结论

旧分支 `origin/docs/real-resume-diagnosis-phase1` 中的方案文档创建于 2026-06-09，当时判断为“待 review，未编码”。当前 `main` 已经完成该链路的主要实现，因此本文不迁回旧文档原文，而是把仍有价值的设计目标改写为当前实现记录。

当前代码侧已经具备：

- 文件上传后的 `fileId` 进入服务端提取链路。
- `ResumeExtractionService` 按文件归属和用途读取简历文件，并提取 DOCX / 文本型 PDF。
- `OCR_PROVIDER=baidu` 时，图片和扫描版 PDF 可走百度 OCR；默认 `disabled` 时诚实失败，不伪造识别结果。
- `AI_PROVIDER=llm` 时，真实 LLM 简历诊断复用后台 AI 模型配置，输出结构化 `ResumeReport`。
- 提取失败、OCR 未配置、LLM 未配置或 LLM 输出非法时，返回明确 `failReason`，不 fallback mock、不生成假报告。
- 简历原文和 OCR 图片 buffer 不落库、不写日志；`AiResumeResult.payloadJson` 只保存报告结果和必要元数据。
- 会员按 `endUserId` 读取本人结果；匿名结果依赖一次性 `accessToken`，DB 只保存 token hash。

当前代码侧完成不等于生产验收完成。百度 OCR、AI、TRTC、ASR、TTS 的生产 Key、权限和 live 冒烟仍以 `docs/progress/next-tasks.md` 的上线前 P0 验收项为准。

## 当前实现链路

### 1. 简历文件读取与归属边界

入口在 `services/api/src/ai/ai.service.ts` 的 `submitResumeParse`：

1. 仅当当前 provider 为 `llm` 时，先调用 `ResumeExtractionService.extractResumeText`。
2. 提取输入带 `fileId` 和当前会员 `endUserId`。
3. 提取失败时直接生成 `status: failed` 和明确 `failReason`，不调用 LLM。
4. 提取成功后，把 `extractedText` 与页数元数据传给 provider。

提取层在 `services/api/src/ai/resume/resume-extraction.service.ts` 内执行：

- 通过 `FilesService.readContentForEndUser(fileId, endUserId)` 读取文件，继承会员 / 匿名文件归属边界。
- 仅允许 `resume_upload` 和 `resume_scan` 两类用途，避免借简历诊断入口读取非简历文件。
- 文件为空、超过 20MB、损坏、格式不支持、文字过短、扫描件无 OCR 时，都返回明确错误码和用户可理解文案。
- 原始 buffer 与简历文本只在内存中流转，不落库、不写日志。

### 2. 文本提取与 OCR

支持路径：

- DOCX：使用 `mammoth` 提取正文纯文本。
- 文本型 PDF：使用 `unpdf` 提取文字层。
- 图片 / 扫描版 PDF：走 `OcrService` 选择的 provider。

OCR provider 策略：

- 默认 `OCR_PROVIDER=disabled`：图片和扫描件明确返回 `OCR_NOT_CONFIGURED` 或 `PDF_TEXT_EMPTY`，不假装识别。
- `OCR_PROVIDER=baidu`：使用百度智能云通用文字识别高精度版；支持图片 OCR、扫描版 PDF 渲染后逐页 OCR、低置信度提示、超页数提示、限流 / 超时 / 凭证缺失诚实失败。
- `OCR_PROVIDER=tencent` 当前是预留占位，不作为已接真实 OCR 的验收依据。

联网冒烟脚本 `verify:ocr-baidu-live` 需要真实百度密钥，会消耗真实调用额度，不进入 CI。离线脚本 `verify:ocr-baidu` 使用本地 stub 百度服务，可进入本地和 CI 验证。

### 3. LLM 诊断 provider

真实诊断 provider 位于 `services/api/src/ai/providers/llm.provider.ts`，provider 名为 `llm`。

`LlmResumeProvider.parseResume` 的规则：

- 必须拿到提取后的简历文本才调用 LLM。
- 调用 `LlmResumeService.diagnose` 生成结构化报告。
- 任何异常都返回 `status: failed` 和明确 `failReason`。
- 不伪造报告，不 fallback 到 `mock` provider。

`LlmResumeService` 位于 `services/api/src/ai/resume/llm-resume.service.ts`：

- 复用 `LlmConfigService` 的 `resume_diagnosis` 功能级配置和加密凭证。
- 不引入 SDK，使用 OpenAI 兼容 `chat/completions` 协议和全局 `fetch`。
- 固定 6 个评分维度：基础信息完整度、求职目标清晰度、经历表达清晰度、成果量化程度、岗位关键词覆盖、版式与可读性。
- 输出 `sections`、`suggestions`、`riskNotes`、`priorities`，并强校验 JSON 结构。
- 非法 JSON 或维度漂移重试一次；仍失败则报 `AI_DIAGNOSIS_INVALID_OUTPUT`。
- 合规拦截招聘结果、匹配程度、代投、推荐给企业、候选人筛选等表达。
- 日志只记录状态和错误类别，不记录 prompt、提取文本、请求正文或响应正文。

### 4. 前端展示边界

`packages/shared/src/types/ai.ts` 中 `ResumeParseResponse` 包含：

- `providerName`：后端实际 provider。`mock` 表示演示报告；`llm` 表示真实诊断 provider。
- `failReason`：失败原因，供 Kiosk 失败页展示。
- `extractionNotice`：OCR 来源、置信度和 warnings。该字段只包含元数据，不含简历原文。
- `accessToken`：仅匿名 parse 返回一次；会员 parse 不返回。

Kiosk 报告页的演示横幅仍以 `providerName === 'mock'` 为核心信号。真实 LLM provider 返回 `llm` 时，报告不应再被标记为演示结果。

## 隐私与合规边界

- 简历诊断只服务求职者本人修改简历，不代表真实招聘结果、企业评价、录用概率或岗位匹配结论。
- 系统不向企业推送简历、诊断报告或优化报告。
- 不新增投递、预约、候选人筛选、企业端收简历或面试邀约闭环。
- 简历原文不写 `AiResumeResult.payloadJson`，不写日志。
- AI 结果默认保留 24 小时；会员文件保存期限遵循用户文件保存策略（默认 90 天、可延长 180 天、成果物可长期保存）。
- OCR / LLM 外部服务启用前必须完成生产密钥、最小权限、失败兜底和 live 冒烟。

## 验证脚本

代码侧验证入口：

| 脚本 | 覆盖内容 |
| --- | --- |
| `pnpm --filter @ai-job-print/api verify:resume-extraction` | DOCX / 文本型 PDF 提取、格式失败、默认 OCR disabled、日志不泄漏简历原文 |
| `pnpm --filter @ai-job-print/api verify-real-resume-diagnosis` | `AI_PROVIDER=llm` 下提取 -> LLM -> 结构化报告、非法 JSON 重试、未配置诚实失败、payload/log 不泄漏原文、会员/匿名门禁不破坏 |
| `pnpm --filter @ai-job-print/api verify:ocr-baidu` | 百度 OCR 离线 stub：图片、扫描版 PDF、低置信度、限流、超时、token 失效、超大图片、日志脱敏、凭证缺失 |
| `pnpm --filter @ai-job-print/api verify:ocr-baidu-live` | 百度 OCR 真实联网冒烟；需要 `.env` 真实密钥，不进 CI |
| `pnpm --filter @ai-job-print/api verify:ai-result-ownership` | 会员本人读取、跨会员隔离、匿名一次性 token、过期和历史匿名行 fail-closed |

本文档分支只改文档，不重复跑 live 脚本，也不宣称生产 Key 或真实联网服务已经通过。

## 旧分支处置结论

`origin/docs/real-resume-diagnosis-phase1` 里的三个独有提交不应整包合入：

- 旧 job fair / smart campus 运行时代码已被当前 `main` 的后续实现取代，且范围远超真实简历诊断文档。
- 旧方案文档的“待编码、OCR 二期、LLM 未接”判断已经过期。
- 旧 `docs/progress/next-tasks.md` 变更不应回写；当前 `next-tasks.md` 已以 P0 live 验收和 P1 资产闭环为准。

因此，本分支只保留并刷新真实 AI 简历诊断 Phase 1 的产品 / 技术参考记录。该文档合入后，旧远程分支可作为冗余历史分支清理候选。
