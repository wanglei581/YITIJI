/**
 * AI 平台未开通时的「启动期降级登记」与影响面声明（F-11 / 步骤 3.6a）。
 *
 * 为什么单独成文件：判定本身在 config/ai-platform-config.ts（纯函数、部署预检也要用）；
 * 这里是它和 boot-readiness 登记表之间的那一层 —— 与 common/redis/redis-degradation.ts
 * 对 Redis 做的事同构：人读文案与结构化 impact 同源，门禁 verify:ai-platform-degradation
 * 按 impact 的每一个键实际发请求核对，声明了却无法证明的面直接判红。
 *
 * 语义（产品负责人 2026-09-29 批准的方案①）：
 *   - 生产缺 AI 类配置不再拒启动；启动日志打 BOOT_DEPENDENCY_DEGRADED 一行；
 *   - `/health` 如实为 degraded，并带 impact；
 *   - `/health/ready` 不因 AI 未开通变 503（blocksReadiness=false，理由见 health.controller.ts）。
 */
import {
  AI_PLATFORM_SUBSYSTEM,
  BOOT_DEGRADED_LOG_MARKER,
  bootReadiness,
  type BootImpactDeclaration,
} from './boot-readiness'
import { aiPlatformIssueCodes, type AiPlatformState } from '../../config/ai-platform-config'

export const AI_PLATFORM_DEGRADED_CODE = 'AI_PLATFORM_NOT_CONFIGURED'
export const AI_PLATFORM_CONFIGURED_CODE = 'AI_PLATFORM_CONFIGURED'

/**
 * AI 未开通时各对外可观察面的真实处境。键是稳定标识，门禁逐键实测：
 *   - ai-generation     调大模型的生成 / 对话 / 语音（缺大模型配置或缺内容制作方时不可用）
 *   - ai-file-export    把已有 AI 结果导出成文件（只取决于内容制作方）
 *   - ocr-recognition   图片 / 扫描版简历的文字识别（只取决于 OCR 配置）
 *   - print-scan        打印下单、打印前材料检查
 *   - payment           支付回调
 *   - internal-console  管理端 / 合作机构端（内部账号鉴权后的接口）
 */
export function aiPlatformImpact(state: AiPlatformState): BootImpactDeclaration {
  return {
    'ai-generation': state.generationAvailable ? 'unaffected' : 'unavailable',
    'ai-file-export': state.aigcConfigured ? 'unaffected' : 'unavailable',
    'ocr-recognition': state.ocrConfigured ? 'unaffected' : 'unavailable',
    'print-scan': 'unaffected',
    payment: 'unaffected',
    'internal-console': 'unaffected',
  }
}

/** 人读文案，与 aiPlatformImpact 同源。只写配置键名与问题码，不含任何取值。 */
export function aiPlatformDegradedSentence(state: AiPlatformState): string {
  const parts: string[] = []
  if (!state.generationAvailable) {
    parts.push('AI 生成、对话与语音暂不可用（AI 路由返回 503 AI_PROVIDER_NOT_CONFIGURED，不会用演示数据冒充结果）')
  }
  if (!state.aigcConfigured) parts.push('带 AI 内容的文件暂不能导出（缺内容制作方，写不出合规的隐式标识）')
  else if (!state.llmConfigured) parts.push('之前已生成的 AI 报告仍可导出、打印')
  if (!state.ocrConfigured) parts.push('图片和扫描版简历暂不能识别，文字版 PDF / DOCX 照常')
  parts.push('打印、扫描、支付、管理端与合作机构端不受影响')
  const fixes = state.issues.map((issue) => `${issue.code}（${issue.detail}）`).join('；')
  return `AI 服务未开通：${parts.join('；')}。需要补的配置：${fixes}。`
}

/**
 * 把启动闸门算出的 AI 开通状态登记进 boot-readiness。main.ts 在 NestFactory.create 之前调用。
 *   - 非生产（enforced=false）：什么都不登记，开发 / CI 的 /health 与今天一致；
 *   - 生产且全部开通：登记 ok（运维能在 /health/ready 的 subsystems 里看到它）；
 *   - 生产且有缺项：登记 degraded（不阻断 readiness）+ 打一行可搜索的降级日志。
 */
export function registerAiPlatformDegradation(
  state: AiPlatformState,
  log: Pick<Console, 'error'> = console,
): void {
  if (!state.enforced) return
  if (state.issues.length === 0) {
    bootReadiness.markOk(AI_PLATFORM_SUBSYSTEM, AI_PLATFORM_CONFIGURED_CODE, 'AI 服务配置齐全。')
    return
  }
  bootReadiness.markDegraded(
    AI_PLATFORM_SUBSYSTEM,
    AI_PLATFORM_DEGRADED_CODE,
    aiPlatformDegradedSentence(state),
    aiPlatformImpact(state),
    { blocksReadiness: false },
  )
  log.error(
    `${BOOT_DEGRADED_LOG_MARKER} subsystem=${AI_PLATFORM_SUBSYSTEM} code=${AI_PLATFORM_DEGRADED_CODE} `
      + `issues=${aiPlatformIssueCodes(state)} readiness=unaffected`,
  )
}
