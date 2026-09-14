/**
 * 大屏用到的两张展示名映射。
 *
 * 都遵守同一条规则：**认不出来的键照原样显示编码，不隐藏该行**。
 * 隐藏会让分项之和对不上总数，看屏的人会以为统计错了；显示编码至少是真的。
 */

/** 与 `apps/admin/src/routes/ai-services/index.tsx` 的 OPERATION_LABELS 同源。 */
const AI_OPERATION_LABELS: Readonly<Record<string, string>> = {
  parseResume: '简历解析',
  optimizeResume: '简历优化',
  adjustResumeLayout: '排版调整',
  generateResume: 'AI 简历生成',
  chatAssistant: 'AI 对话',
  classifyIntent: '意图分类',
  jobRecommend: '岗位 AI 推荐',
  jobExplain: 'AI 岗位解读',
  jobMatch: '岗位匹配参考',
  careerPlan: '职业规划',
  fairVisitPlan: '招聘会参观计划',
  interviewQuestion: '模拟面试出题',
  interviewReport: '面试报告生成',
  voiceTranscribe: '语音转写',
  voiceSynthesize: '语音播报',
  selfAssessment: '自我探索 · 倾向参考',
  contractReview: '合同审查',
}

export function aiOperationLabel(operation: string): string {
  return AI_OPERATION_LABELS[operation] ?? operation
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
