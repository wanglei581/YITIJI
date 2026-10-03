import { AI_USAGE_VENDOR_LABELS } from '@ai-job-print/shared'
import { aiProviderName } from '../ai-services/aiLogDisplay'

/** 服务端 provider / label 字段只作分类；未知编码不印到领导看的大屏。 */
export function screenAiProvider(provider: string): string {
  if (provider === 'mock' || provider === 'stub') return '未就绪兜底模型'
  if (provider.startsWith('llm:')) {
    const parts = provider.split(':')
    if (!AI_USAGE_VENDOR_LABELS[parts[1]]) return '其他 AI 模型'
    return parts.length >= 3 ? aiProviderName(provider) : AI_USAGE_VENDOR_LABELS[parts[1]]
  }
  return AI_USAGE_VENDOR_LABELS[provider] ?? '其他 AI 模型'
}
