// GET /api/v1/kiosk/ai/capabilities 的夹具。字段形状同 packages/shared 的 KioskAiCapabilitiesResponse，
// 键名取自服务端 AI_MODEL_FEATURES（services/api/src/ai/llm/llm-config.service.ts）。
//
// 练面试服务台、设置页、作答页挂载时各读一次，按各 AI 能力分别决定入口停用与顶栏说法。
// 默认全部可用，让既有用例不因这条新请求中断；要测「能力关闭」「降级」「读不到」的用例自行 respond 覆盖。

export const KIOSK_AI_CAPABILITIES_PATH = '/api/v1/kiosk/ai/capabilities'

export const KIOSK_AI_CAPABILITY_KEYS = [
  'assistant_chat',
  'resume_diagnosis',
  'resume_generate',
  'resume_optimize',
  'job_fit',
  'career_plan',
  'fair_visit_plan',
  'self_assessment',
  'job_recommend',
  'job_explain',
  'advisor_work',
  'print_param_prefill',
  'mock_interview',
  'digital_human',
  'poster_generation',
] as const

export type KioskAiCapabilityKey = (typeof KIOSK_AI_CAPABILITY_KEYS)[number]
export type KioskAiCapabilityOverride = { status: 'available' | 'degraded' | 'off'; reason?: string }

/** 在默认「全部可用」的基础上按键覆盖；不在覆盖表里的键一律 available。 */
export function kioskAiCapabilitiesResponse(
  overrides: Partial<Record<KioskAiCapabilityKey, KioskAiCapabilityOverride>> = {},
): { success: true; data: { items: Array<{ key: KioskAiCapabilityKey } & KioskAiCapabilityOverride> } } {
  return {
    success: true,
    data: {
      items: KIOSK_AI_CAPABILITY_KEYS.map((key) => ({ key, status: 'available' as const, ...overrides[key] })),
    },
  }
}
