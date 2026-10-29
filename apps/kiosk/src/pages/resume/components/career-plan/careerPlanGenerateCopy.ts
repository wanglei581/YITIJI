// 求职方案页底栏「生成 / 重新生成」主键的字与原因（纯函数，组件渲染它，用例直接断言它）。
// 字照稿 career：AI 停时主键写「生成求职方案」（有方案时「重新生成」）并置灰，不写「重试」；「重试…」只给临时性错误之后的那一下。

/** 底栏小字（CtaNote）的 id；置灰的主键用 aria-describedby 连着它。 */
export const CAREER_AI_DOWN_WHY_ID = 'career-plan-ai-down-why'

/** AI 停用时写在主键旁边的原因。两句都是稿 career 的原句：有方案时「这份方案还在，重新生成先停着」，没有方案时「可以先打印求职参考单」。 */
export function careerAiDownWhy(hasPlan: boolean): string {
  return hasPlan
    ? 'AI 暂时不可用。这份方案还在，重新生成先停着。'
    : 'AI 暂时不可用。可以先打印求职参考单。'
}

export function careerGenerateLabel(input: { hasPlan: boolean; generating: boolean; retry: boolean }): string {
  if (input.generating) return '正在生成…'
  if (input.retry) return input.hasPlan ? '重试生成' : '重试生成求职方案'
  return input.hasPlan ? '重新生成' : '生成求职方案'
}
