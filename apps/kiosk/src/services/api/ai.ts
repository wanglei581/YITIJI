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

export interface AiServiceInterface {
  submitResumeParse(req: ResumeParseRequest, token?: string | null): Promise<ResumeParseResponse>
  getResumeRecord(taskId: string): Promise<ResumeParseResponse>
  getResumeOptimize(taskId: string): Promise<ResumeOptimizeResponse>
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

/** 通过 taskId 查询解析结果（用于 http 模式刷新恢复） */
export const getResumeRecord = (taskId: string) =>
  adapter.getResumeRecord(taskId)

/** 通过 taskId 获取优化建议 */
export const getResumeOptimize = (taskId: string) =>
  adapter.getResumeOptimize(taskId)

/** 向 AI 助手发送消息（意图分类 + 引导跳转） */
export const chatWithAssistant = (req: AssistantChatRequest) =>
  adapter.chatWithAssistant(req)
