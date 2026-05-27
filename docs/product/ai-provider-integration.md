# AI 服务提供商接入指南

> 版本：Phase 7 AI Service Layer  
> 日期：2026-05-26  
> 适用范围：`apps/kiosk/src/services/api/ai.ts` + 后端 AI 模块

---

## 1. 架构概述

```
Kiosk 前台
  │  submitResumeParse / getResumeOptimize / chatWithAssistant
  ▼
ai.ts（适配器选择层）
  │  API_MODE=mock → aiMockAdapter（开发用）
  │  API_MODE=http → aiHttpAdapter（后端代理）
  ▼
后端 AI 模块（NestJS）
  │  /api/v1/resume/parse
  │  /api/v1/resume/records/:id
  │  /api/v1/resume/records/:id/optimize
  │  /api/v1/assistant/chat
  ▼
AI Provider（可切换）
  ├── OpenAI GPT-4o
  ├── Claude claude-sonnet-4-6
  ├── 通义千问 qwen-long
  ├── 智谱 GLM-4
  └── 本地部署（Ollama / vLLM）
```

**核心原则：前端永远只和后端 AI 模块通信，不直接接触任何 AI 提供商 API。**

---

## 2. 安全约束（强制，不可绕过）

### 2.1 API Key 必须在服务端

| 禁止行为 | 允许行为 |
|---------|---------|
| 前端代码包含任何 AI 提供商 API Key | 服务端环境变量 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 等 |
| 前端通过 CORS 直接调用 `api.openai.com` | 前端调用 `/api/v1/resume/parse`（后端代理） |
| `.env.local` 暴露 `VITE_OPENAI_API_KEY` | 后端 `.env` 保存，不注入 Vite 构建 |
| 浏览器开发者工具中可见 API Key | 只可见 `/api/v1` 的响应 |

> **违反上述规则会导致 API Key 泄漏，产生非预期费用和数据安全风险。**

### 2.2 用户数据隔离

- AI 处理结果（诊断报告、优化建议）**只返回给提交该简历的用户本人**
- 服务端不将简历内容、AI 分析结果推送给企业或任何第三方
- 处理完成后，原始简历文件按数据清理策略自动删除（见 [file-security.md](../compliance/file-security.md)）
- AI 日志脱敏：日志系统只记录 taskId、provider、耗时、状态，不记录简历内容

---

## 3. 前端类型定义

前端共享类型位于 `packages/shared/src/types/ai.ts`，前端只消费这些类型，不关心底层 AI 提供商。

```typescript
// 前端可见类型（不含 API Key 或 Prompt 内容）
interface ResumeParseRequest  { fileId, fileName, fileFormat, source }
interface ResumeParseResponse { taskId, status, report?, failReason? }
interface ResumeOptimizeResponse { taskId, status, modules?, failReason? }
interface AssistantChatRequest  { message, sessionId?, context? }
interface AssistantChatResponse { sessionId, reply, intent?, actions? }
```

---

## 4. 后端 AI 模块设计（NestJS）

### 4.1 目录结构

```
services/api-server/src/
  ai/
    ai.module.ts
    resume/
      resume.controller.ts    ← POST /resume/parse, GET /resume/records/:id
      resume.service.ts       ← 调度 provider，存储结果到 DB
      optimize.service.ts     ← GET /resume/records/:id/optimize
      dto/
        resume-parse.dto.ts
        resume-record.dto.ts
        optimize.dto.ts
    assistant/
      assistant.controller.ts ← POST /assistant/chat
      assistant.service.ts    ← intent 分类 + 回复生成
      dto/
        chat.dto.ts
    providers/
      provider.interface.ts   ← AiProvider 接口（统一抽象）
      openai.provider.ts
      claude.provider.ts
      qwen.provider.ts
      zhipu.provider.ts
      local.provider.ts
      provider.factory.ts     ← 按配置选 provider
```

### 4.2 Provider 统一接口

```typescript
// providers/provider.interface.ts
export interface AiProvider {
  readonly name: AiProviderName

  /** 简历解析：OCR + 结构化提取 + 评分诊断 */
  parseResume(fileContent: Buffer, fileName: string): Promise<ResumeReport>

  /** 简历优化：基于报告生成优化建议（不生成虚假内容） */
  optimizeResume(report: ResumeReport, rawText: string): Promise<ResumeOptimizeModule[]>

  /** AI 助手：意图分类 + 引导回复 */
  chat(message: string, context?: Record<string, unknown>): Promise<AssistantChatReply>
}
```

### 4.3 切换提供商

通过服务端环境变量配置，前端无需改动：

```bash
# services/api-server/.env
AI_PROVIDER=openai          # openai / claude / qwen / zhipu / local
OPENAI_API_KEY=sk-...       # 仅在 AI_PROVIDER=openai 时使用
ANTHROPIC_API_KEY=sk-ant-...# 仅在 AI_PROVIDER=claude 时使用
QWEN_API_KEY=...            # 仅在 AI_PROVIDER=qwen 时使用
ZHIPU_API_KEY=...           # 仅在 AI_PROVIDER=zhipu 时使用
LOCAL_MODEL_URL=http://localhost:11434  # 仅在 AI_PROVIDER=local 时使用
```

---

## 5. 各提供商接入要点

### 5.1 OpenAI GPT-4o

| 项目 | 说明 |
|------|------|
| SDK | `openai` npm 包 |
| 模型 | `gpt-4o`（视觉能力，可解析 PDF 图像） |
| 简历解析 | `vision` + system prompt 要求 JSON 输出 |
| 优化建议 | `gpt-4o-mini`（成本更低）|
| 费用参考 | 约 0.02 USD / 份简历（视页数） |
| 注意 | 数据可能用于训练，如需隐私需申请 `zero data retention` |

### 5.2 Anthropic Claude

| 项目 | 说明 |
|------|------|
| SDK | `@anthropic-ai/sdk` npm 包 |
| 模型 | `claude-sonnet-4-6`（长上下文，适合完整简历） |
| 简历解析 | `messages` API + `tool_use` 强制 JSON 输出 |
| 优化建议 | 同模型，在 system prompt 中约束"不生成虚假经历" |
| 隐私 | Claude 默认不训练用户数据，适合处理求职者敏感信息 |
| 注意 | 使用 prompt caching 降低重复 prompt 费用 |

### 5.3 通义千问（阿里云）

| 项目 | 说明 |
|------|------|
| SDK | `dashscope` npm 包 或直接 HTTP |
| 模型 | `qwen-long`（长文本）/ `qwen-vl-plus`（图文） |
| 优势 | 国内节点，延迟低；中文简历理解更准确 |
| 注意 | 需开通阿里云账号，可绑定企业资质合规存储 |

### 5.4 智谱 GLM-4

| 项目 | 说明 |
|------|------|
| SDK | `zhipuai` npm 包 |
| 模型 | `glm-4`（对话）/ `glm-4v`（图文） |
| 优势 | 国内合规，支持私有化部署 |
| 文档 | `open.bigmodel.cn` |

### 5.5 本地部署（Ollama / vLLM）

| 项目 | 说明 |
|------|------|
| 服务 | Ollama `localhost:11434`，兼容 OpenAI API 格式 |
| 推荐模型 | `qwen2.5:14b`（中文简历）、`mistral:7b`（英文）|
| 优势 | 零 API 费用；数据完全不出机房；适合政务/公共就业场景 |
| 要求 | GPU 服务器（至少 8GB VRAM 运行 7B 模型） |

---

## 6. AI 数字人插件接入

AI 数字人引导员（Phase 9.1+）通过扩展 `AssistantChatResponse.actions` 实现语音+动作指令，无需新增 API 端点。

```typescript
// 扩展 actions 携带数字人指令（Phase 9 启动后补充）
interface DigitalHumanAction extends AssistantAction {
  avatarEmotion?: 'neutral' | 'happy' | 'pointing'
  avatarGesture?: 'wave' | 'nod' | 'point_left' | 'point_right'
  ttsText?: string  // 优先于 reply 字段的 TTS 文本（可裁剪）
}
```

数字人 SDK（Three.js / VRM）在前端消费 `actions` 中的指令，后端 AI 只生成文本+意图，不依赖具体渲染库。

---

## 7. 合规边界（所有 AI 功能必须遵守）

| 功能 | 允许 | 禁止 |
|------|------|------|
| 简历诊断 | 评分 + 改进建议 + "仅供参考"声明 | 保证录用率、预测 HR 决策 |
| 简历优化 | 优化表达方式、结构、关键词 | 生成虚假工作经历或学历 |
| AI 助手 | 引导使用本系统功能、政策问答 | 推荐投递至特定企业、面试邀约 |
| 数字人 | 就业引导、打印帮助、招聘会导览 | 企业端 HR 助理、候选人筛选 |
| 数据存储 | 匿名化服务行为日志（taskId/耗时/状态） | 简历全文、AI 分析内容长期留存 |
| 数据流向 | 求职者本人查看 AI 结果 | 推送给企业 / 第三方机构 |

> 以上约束与 `CLAUDE.md §2`（不能做的功能）完全一致，任何 AI 功能扩展前必须对照此表。

---

*文档编写：Claude Code | 2026-05-26*
