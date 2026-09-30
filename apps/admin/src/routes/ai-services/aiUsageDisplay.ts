// ============================================================
// 「AI 用量与额度」面板（#1088）的显示名映射与金额格式化
//
// 只服务 AiUsagePanel / AiUsageBreakdownTable：
//   - 功能 key / 供应商 key → 中文名，null key → 「无已验签终端 / 无机构」。
//   - AI 服务日志旧表的 operation 常量在 aiOperationLabels.ts，别混进来。
//
// 功能与厂商的未知 key 保留原值；终端与机构只有数据库 ID 时显示尾号（末 6 位，短 ID 原样），ID 由调用方悬停保留。
// 功能 key 取值与服务端 llm-config.service.ts 的功能位 key 同源
//（assistant_chat / resume_optimize / …），另有两个不在功能位表里的
//（assistant_summary、unknown）。
// 供应商 key：后端 VENDOR_BY_HOST 只会给出 deepseek / qwen / 主机名 / unknown。
// ============================================================

/** 功能 key → 中文名。来源：services/api/src/ai/llm/llm-config.service.ts 的功能位 label。 */
export const AI_USAGE_FEATURE_LABELS: Readonly<Record<string, string>> = {
  assistant_chat: 'AI助手对话',
  resume_diagnosis: 'AI简历诊断',
  resume_generate: 'AI简历生成',
  resume_optimize: 'AI简历优化',
  job_fit: 'AI岗位匹配参考',
  career_plan: 'AI职业规划建议',
  fair_visit_plan: 'AI招聘会拜访计划',
  self_assessment: 'AI自我探索解读',
  job_recommend: 'AI岗位推荐排序',
  job_explain: 'AI岗位解读',
  advisor_work: 'AI顾问作业面',
  print_param_prefill: '打印参数预填',
  mock_interview: 'AI模拟面试',
  digital_human: 'AI数字人引导',
  poster_generation: 'AI海报生成',
  // 下面两个不在功能位表里：advisor/assistant-summary.service.ts（对话要点小结）
  // 与计量器的 fallback（拿不到功能名时记 unknown）。
  assistant_summary: '顾问对话小结',
  unknown: '未知功能',
}

/** 供应商 key → 中文名。来源：ai-usage-meter.ts VENDOR_BY_HOST + aiConfig 预设叫法。 */
export const AI_USAGE_VENDOR_LABELS: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  unknown: '未知厂商',
}

/** 终端维度下 key 为 null = 无已验签终端（服务端 ai-usage-summary.ts 注释口径）。 */
export const UNASSIGNED_TERMINAL_LABEL = '无已验签终端'
/** 机构维度下 key 为 null = 无所属机构。 */
export const UNASSIGNED_ORG_LABEL = '无机构'

export type AiUsageDimension = 'feature' | 'vendor' | 'terminal' | 'org'

/** 维度显示名：功能/厂商用已有映射；终端/机构无名称时显示 ID 尾号，null 是未关联。 */
export function aiUsageKeyName(dimension: AiUsageDimension, key: string | null): string {
  if (dimension === 'terminal') return key === null ? UNASSIGNED_TERMINAL_LABEL : `终端（尾号 ${key.slice(-6)}）`
  if (dimension === 'org') return key === null ? UNASSIGNED_ORG_LABEL : `机构（尾号 ${key.slice(-6)}）`
  const labels = dimension === 'feature' ? AI_USAGE_FEATURE_LABELS : AI_USAGE_VENDOR_LABELS
  if (key === null) return '—'
  return labels[key] ?? key
}

/** 金额保留两位小数带「元」（面板展示口径；服务端内部保留 4 位，展示层两位）。 */
export function formatCny(value: number): string {
  return `${value.toFixed(2)} 元`
}

/**
 * 旧调用日志「近 24 小时概览」的成功率。
 * 调用次数为 0 时没有分母，显示「—」，不要显示 0%。有调用且全部失败时 0% 是真实结果。
 */
export function logOverviewRate(totalCalls: number, successRate: number): string {
  return totalCalls > 0 ? `${successRate}%` : '—'
}

/**
 * 旧调用日志「近 24 小时概览」的平均响应时间。
 * 调用次数为 0 时没有成功样本，显示「—」，不要显示 0 ms。
 */
export function logOverviewLatency(totalCalls: number, avgLatencyMs: number): string {
  return totalCalls > 0 ? `${avgLatencyMs} ms` : '—'
}
