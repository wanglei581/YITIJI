import { AI_OPERATION_LABELS, AI_USAGE_FEATURE_LABELS } from '@ai-job-print/shared'
import type { ScreenUsageAiValue, ScreenUsageServiceKey } from '@ai-job-print/shared'
import { screenCount } from '@ai-job-print/ui'

/**
 * 大屏用到的展示名映射。
 *
 * 都遵守同一条规则：**认不出来的键按出现顺序显示「其他 AI 服务（N）」，不隐藏该行**。
 * 保留该行与计数，既不把内部编码印到屏上，也不漏掉未知服务的调用。
 */

/** 与 `apps/admin/src/routes/ai-services/index.tsx` 的 OPERATION_LABELS 同源。 */


/**
 * 招聘内容托管关闭时，jobMatch 只剩手填岗位要求的「简历对照」（系统内岗位的匹配、推荐、解读都被服务端拒绝），
 * 与一体机上的叫法一致；托管开启时仍含系统内岗位的匹配，保持原名。
 */
export function aiOperationLabel(operation: string, hostingOff = false): string {
  if (hostingOff && operation === 'jobMatch') return '简历对照'
  // 共享映射里「语音转写 (ASR)」「语音播报 (TTS)」的括注是给日志页排障看的，英文缩写不上领导看的屏。
  const label = AI_OPERATION_LABELS[operation] ?? AI_USAGE_FEATURE_LABELS[operation] ?? '其他 AI 服务'
  return label.replace(/\s*\((?:ASR|TTS)\)$/, '')
}

/** 先按服务端出现顺序编号，再由调用方排序/截取；每行原计数（含 null）保留。 */
export function aiOperationRows(rows: ScreenUsageAiValue['byOperation'], hostingOff = false) {
  let unknown = 0
  return rows.map((row) => {
    const label = aiOperationLabel(row.operation, hostingOff)
    return { ...row, label: label === '其他 AI 服务' ? `其他 AI 服务（${++unknown}）` : label }
  })
}

/**
 * 服务调用里各项服务的中文名。3D 服务网络与轻量模式的条形图共用这一份，两边永远一样。
 *
 * 这里与功能调用分项不同：服务网络只画得出有版式的服务，
 * 认不出来的键两边都不画（返回 null），英文键不上领导看的屏。这里没有合计，不画不会让分项对不上总数。
 */
const USAGE_SERVICE_LABELS: Readonly<Record<ScreenUsageServiceKey, string>> = {
  jobs: '岗位信息',
  fairs: '招聘会',
  policy: '政策服务',
  company: '企业展示',
  aiResume: 'AI 简历',
  aiAdvisor: 'AI 顾问',
  interview: '模拟面试',
  careerPlan: '职业规划',
  jobAi: '岗位 AI',
  print: '打印',
  scan: '扫描',
}

/**
 * 「岗位 AI」节点计的是 jobRecommend / jobExplain / jobMatch / fairVisitPlan 四类成功调用。
 * 托管关闭时前两类与招聘会参观计划都被服务端拒绝，jobMatch 只剩手填岗位的简历对照，
 * 所以节点改叫「简历对照」—— 它在托管关闭时仍然是真实在用的 AI 功能，不隐藏。
 */
export function usageServiceLabel(key: string, hostingOff = false): string | null {
  if (hostingOff && key === 'jobAi') return '简历对照'
  return Object.prototype.hasOwnProperty.call(USAGE_SERVICE_LABELS, key) ? USAGE_SERVICE_LABELS[key as ScreenUsageServiceKey] : null
}

/** 按状态键累加任务数：服务端没下发的状态就是这段时间里一条都没有，不另补数。 */
export function sumStatuses(source: Record<string, number>, keys: readonly string[]): number {
  return Object.entries(source).reduce((sum, [key, value]) => (keys.includes(key) ? sum + value : sum), 0)
}

/** 小于 5 的计数写「少于 5」，与服务调用 / 信息使用的最小聚合口径一致；0 就是 0。 */
export function smallCountText(count: number): string {
  return count > 0 && count < 5 ? '少于 5' : screenCount(count)
}

/**
 * 打印完成率 = 已完成 ÷（已完成 + 失败），只看近 24 小时打印任务里已经结束的两种；
 * 排队、打印中、取消不进分母。分母少于 5 不给百分比（样本太小，一两单就能把比例拉满或拉空）。
 */
export function printCompletion(printByStatus: Record<string, number>): { completed: number; finished: number; rate: number | null } {
  const completed = sumStatuses(printByStatus, ['completed'])
  const finished = completed + sumStatuses(printByStatus, ['failed'])
  return { completed, finished, rate: finished >= 5 ? Math.round((completed / finished) * 1000) / 10 : null }
}

/** 打印 / 扫描任务状态。与管理端打印扫描运维页同一套中文。 */
const TASK_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: '排队中',
  claimed: '已领取',
  printing: '打印中',
  scanning: '扫描中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  canceled: '已取消',
  expired: '已过期',
}

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status] ?? status
}

/** 任务状态的语义色。失败朱、取消陶、在途石青、完成青玉。 */
export function taskStatusTone(status: string): 'primary' | 'info' | 'warn' | 'error' {
  if (status === 'failed') return 'error'
  if (status === 'cancelled' || status === 'canceled' || status === 'expired') return 'warn'
  if (status === 'completed') return 'primary'
  return 'info'
}
