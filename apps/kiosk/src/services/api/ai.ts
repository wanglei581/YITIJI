// ============================================================
// AI Service — Phase 7 AI Service Layer
//
// 根据 API_MODE 选择适配器：
//   API_MODE=mock → aiMockAdapter（本地 mock，无需后端）
//   API_MODE=http → aiHttpAdapter（真实 /api/v1/resume 与 /api/v1/assistant 接口）
//
// 切换模式只需修改环境变量，页面层代码不变。
//
// 合规约束：
// - AI 结果仅服务求职者本人，不推送给企业
// - 不做候选人推荐、简历推送、面试邀约
// - 所有结果标注"仅供参考"由页面层负责
// ============================================================

import type {
  ResumeParseRequest,
  ResumeParseResponse,
  ResumeOptimizeResponse,
  AssistantChatRequest,
  AssistantChatResponse,
} from '@ai-job-print/shared'
import { API_MODE } from './client'
import { aiMockAdapter } from './aiMockAdapter'
import { aiHttpAdapter } from './aiHttpAdapter'

// ──────────────────────────────────────────────────────────────
// 服务接口类型（供两种 adapter 共同实现）
// ──────────────────────────────────────────────────────────────

/**
 * AI 结果读取凭证（Phase C-2A）。
 *
 * - token：登录会员 JWT → 走 `Authorization: Bearer`，会员结果按 endUserId 本人校验。
 * - accessToken：匿名 parse 时下发的一次性令牌 → 走 `x-resume-access-token` header，
 *   不拼任何 URL query。两者择一即可：登录用户传 token，匿名用户传 accessToken。
 */
export interface ResumeReadAccess {
  token?: string | null
  accessToken?: string | null
}

export interface AiServiceInterface {
  submitResumeParse(req: ResumeParseRequest, token?: string | null): Promise<ResumeParseResponse>
  getResumeRecord(taskId: string, access?: ResumeReadAccess): Promise<ResumeParseResponse>
  getResumeOptimize(taskId: string, access?: ResumeReadAccess): Promise<ResumeOptimizeResponse>
  chatWithAssistant(req: AssistantChatRequest): Promise<AssistantChatResponse>
}

// ──────────────────────────────────────────────────────────────
// 适配器选择（构建时确定，支持 tree-shaking）
// ──────────────────────────────────────────────────────────────

const adapter: AiServiceInterface =
  API_MODE === 'http' ? aiHttpAdapter : aiMockAdapter

// ──────────────────────────────────────────────────────────────
// 导出服务函数（页面层不感知 adapter 切换）
// ──────────────────────────────────────────────────────────────

/** 提交简历解析任务，返回 taskId 和（mock 模式下的）即时报告 */
export const submitResumeParse = (req: ResumeParseRequest, token?: string | null) =>
  adapter.submitResumeParse(req, token)

/**
 * 通过 taskId 查询解析结果（用于 http 模式刷新恢复）。
 * 归属 / 令牌门禁（Phase C-1 + C-2A）：登录会员传 token；匿名用户传 parse 时下发的
 * accessToken。无凭证 / 错凭证后端一律 AI_TASK_NOT_FOUND。
 */
export const getResumeRecord = (taskId: string, access?: ResumeReadAccess) =>
  adapter.getResumeRecord(taskId, access)

/** 通过 taskId 获取优化建议（登录会员传 token，匿名传 accessToken，见上） */
export const getResumeOptimize = (taskId: string, access?: ResumeReadAccess) =>
  adapter.getResumeOptimize(taskId, access)

/** 向 AI 助手发送消息（意图分类 + 引导跳转） */
export const chatWithAssistant = (req: AssistantChatRequest) =>
  adapter.chatWithAssistant(req)
