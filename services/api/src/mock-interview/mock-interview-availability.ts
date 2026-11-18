import { aiPlatformBlockFor } from '../config/ai-platform-config'
import type { AiAccessService } from '../ai-access/ai-access.service'
import type { AiRefusal } from '../ai/assistant-chat-availability'
import type { LlmConfigService } from '../ai/llm/llm-config.service'

/** 与 callLlm 没配时抛出的是同一句，不新造错误码。 */
export const MOCK_INTERVIEW_NOT_CONFIGURED: AiRefusal = {
  code: 'AI_NOT_CONFIGURED',
  message: 'AI 模拟面试暂未启用，请联系管理员配置',
}

type InterviewLlm = Pick<LlmConfigService, 'getApiKey' | 'getConfig'>

/**
 * mock_interview 这个模型位本身能不能出题。
 * 条件与 MockInterviewLlmService.callLlm 进入请求之前一致：没密钥或被关掉。
 */
export function mockInterviewModelRefusal(llm: InterviewLlm): AiRefusal | null {
  const apiKey = llm.getApiKey('mock_interview')
  const cfg = llm.getConfig('mock_interview')
  if (!apiKey || !cfg.enabled) return MOCK_INTERVIEW_NOT_CONFIGURED
  return null
}

/**
 * 模拟面试开场能不能用。
 *
 * 顺序与 POST /mock-interviews/:id/start 进入出题之前一致：平台开通、全站暂停、当日预算，
 * 然后才是模型位本身。登录和声明不在这里。题目单不走这道。
 */
export async function mockInterviewStartRefusal(
  access: Pick<AiAccessService, 'paidAiRefusal'>,
  llm: InterviewLlm,
): Promise<AiRefusal | null> {
  const platform = aiPlatformBlockFor('generate')
  if (platform) return platform
  const paid = await access.paidAiRefusal('generate')
  if (paid) return paid
  return mockInterviewModelRefusal(llm)
}
