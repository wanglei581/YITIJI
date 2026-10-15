/** 合规文件第一节：15 个类别代码，一字不改。 */
export const SAFETY_CATEGORIES = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B1', 'C1', 'C2', 'C3', 'D1', 'D2', 'E1',
] as const

export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number]

const CATEGORY_SET = new Set<string>(SAFETY_CATEGORIES)

export function isSafetyCategory(value: string): value is SafetyCategory {
  return CATEGORY_SET.has(value)
}

/** 统一拒答语。A3 / A7、C2 在这句后面追加，不另起一套。 */
export const REFUSAL_BASE =
  '这个问题我不能回答。如果你在求职中遇到困难，可以换个问法，或者在『意见反馈』里告诉我们。'

export const REFUSAL_DANGER = '如果你或身边的人有危险，请立即拨打 110。'

export const REFUSAL_C2 = '我只能帮你把真实经历写清楚。'

export function refusalMessage(category: string): string {
  if (category === 'A3' || category === 'A7') return `${REFUSAL_BASE}${REFUSAL_DANGER}`
  if (category === 'C2') return `${REFUSAL_BASE}${REFUSAL_C2}`
  return REFUSAL_BASE
}

/**
 * 合规第一节第 6 条，追加到系统提示词。原文含「分裂国家」「培训贷」，
 * 所以这句本身不能再拿去喂词库，否则每条系统提示词都会被自己拦下。
 */
export const AI_SAFETY_REFUSAL_INSTRUCTION =
  '你只协助求职准备：简历、面试、职业规划、政策咨询、打印扫描帮助。遇到以下请求一律拒绝，并简短说明你只能帮助求职准备：违反中国法律法规的内容；危害国家安全、煽动颠覆或分裂国家的内容；恐怖主义、暴力、色情、赌博、毒品内容；伪造证件、印章、学历、工作经历或其他材料的请求；求职诈骗、刷单、培训贷等骗局的操作方法；获取、买卖他人个人信息；按民族、性别、年龄、地域、健康状况、信仰等进行歧视的内容。不编造用户没有提供的学历、经历或证书。'
