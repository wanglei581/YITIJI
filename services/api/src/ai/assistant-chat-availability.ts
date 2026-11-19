import { aiPlatformBlockFor } from '../config/ai-platform-config'
import type { AiAccessService } from '../ai-access/ai-access.service'
import type { LlmConfigService } from './llm/llm-config.service'

/** 与对话接口拒绝时同一份错误体。探针只拿它判断能不能用，不回给一体机。 */
export interface AiRefusal {
  code: string
  message: string
  details?: string[]
}

/** 与顾问作业面已有的「没配」说法同一句，不新造错误码。 */
export const ASSISTANT_CHAT_NOT_CONFIGURED: AiRefusal = {
  code: 'AI_NOT_CONFIGURED',
  message: 'AI 顾问暂未启用，请联系管理员配置',
}

/**
 * 小青文字对话能不能用。
 *
 * 顺序与 POST /assistant/chat 进入处理函数之前一致：平台开通、全站暂停、当日预算，
 * 然后才是 assistant_chat 这个模型位本身（启用且有密钥）。登录和声明不在这里。
 * 顾问探针看的是 advisor_work，不能拿来代表这段对话。
 */
export async function assistantChatRefusal(
  access: Pick<AiAccessService, 'paidAiRefusal'>,
  llm: Pick<LlmConfigService, 'isReady'>,
): Promise<AiRefusal | null> {
  const platform = aiPlatformBlockFor('generate')
  if (platform) return platform
  const paid = await access.paidAiRefusal('generate')
  if (paid) return paid
  if (!llm.isReady('assistant_chat')) return ASSISTANT_CHAT_NOT_CONFIGURED
  return null
}
