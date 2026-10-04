import { AI_OPERATION_LABELS } from '../../../packages/shared/src/aiDisplayLabels'

type Assert = (source: string, pattern: string | RegExp, label: string) => void
export function verifyAiCostUiCoverage({ read, readApps, assertContains, assertNotContains, logSvc, NEW_OPS }: {
  read: (path: string) => string; readApps: (path: string) => string
  assertContains: Assert; assertNotContains: Assert; logSvc: string; NEW_OPS: string[]
}) {
// ─── 2. NON_TOKEN_BILLED_OPERATIONS ──────────────────────────────────────────

assertContains(logSvc, 'NON_TOKEN_BILLED_OPERATIONS', 'NON_TOKEN_BILLED_OPERATIONS 已声明')
assertContains(logSvc, "'voiceTranscribe'", 'voiceTranscribe 在 NON_TOKEN_BILLED_OPERATIONS')
assertContains(logSvc, "'voiceSynthesize'", 'voiceSynthesize 在 NON_TOKEN_BILLED_OPERATIONS')

// ─── 3. careerPlan 日志覆盖（service 层）────────────────────────────────────

const careerSvc = read('src/ai/resume/career-plan.service.ts')
assertContains(careerSvc, 'AiUsageAccumulator', 'career-plan: 使用 AiUsageAccumulator')
assertContains(careerSvc, 'recordAiLog', 'career-plan: 存在 recordAiLog 方法')
assertContains(careerSvc, "operation: 'careerPlan'", "career-plan: operation='careerPlan'")
assertContains(careerSvc, 'callCount === 0', 'career-plan: callCount === 0 guard 存在')

// ─── 4. fairVisitPlan 日志覆盖（service 层）─────────────────────────────────

const fairVisitSvc = read('src/ai/resume/fair-visit-plan.service.ts')
assertContains(fairVisitSvc, 'AiUsageAccumulator', 'fair-visit-plan: 使用 AiUsageAccumulator')
assertContains(fairVisitSvc, 'recordAiLog', 'fair-visit-plan: 存在 recordAiLog 方法')
assertContains(fairVisitSvc, "operation: 'fairVisitPlan'", "fair-visit-plan: operation='fairVisitPlan'")
assertContains(fairVisitSvc, 'callCount === 0', 'fair-visit-plan: callCount === 0 guard 存在')

// ─── 5. interviewQuestion / interviewReport 日志覆盖（service 层）───────────

const interviewSvc = read('src/mock-interview/mock-interview.service.ts')
assertContains(interviewSvc, 'AiUsageAccumulator', 'mock-interview service: 使用 AiUsageAccumulator')
assertContains(interviewSvc, 'recordAiLog', 'mock-interview service: 存在 recordAiLog 方法')
assertContains(interviewSvc, "'interviewQuestion'", "mock-interview service: operation='interviewQuestion'")
assertContains(interviewSvc, "'interviewReport'", "mock-interview service: operation='interviewReport'")
assertContains(interviewSvc, 'callCount === 0', 'mock-interview service: callCount === 0 guard 存在')

// ─── 6. voiceTranscribe 日志覆盖（controller 层）────────────────────────────

const mockInterviewCtrl = read('src/mock-interview/mock-interview.controller.ts')
assertContains(mockInterviewCtrl, "'voiceTranscribe'", 'mock-interview ctrl: voiceTranscribe 日志')
assertContains(mockInterviewCtrl, 'asrStartedAt', 'mock-interview ctrl: asrStartedAt 计时')
assertContains(mockInterviewCtrl, 'tokenUsage: undefined', 'mock-interview ctrl: ASR tokenUsage 明确为 undefined')

// voiceTranscribe 也在 ai.controller.ts（简历语音转写入口）
const aiCtrl = read('src/ai/ai.controller.ts')
assertContains(aiCtrl, "'voiceTranscribe'", 'ai.controller: voiceTranscribe 日志')
assertContains(aiCtrl, 'asrStartedAt', 'ai.controller: asrStartedAt 计时')

// ─── 7. voiceSynthesize 日志覆盖（controller 层）────────────────────────────

assertContains(mockInterviewCtrl, "'voiceSynthesize'", 'mock-interview ctrl: voiceSynthesize 日志')
assertContains(mockInterviewCtrl, 'ttsStartedAt', 'mock-interview ctrl: ttsStartedAt 计时')
assertContains(mockInterviewCtrl, 'tts:tencent', 'mock-interview ctrl: TTS provider label 存在')

// ─── 8. 前端 Admin AiOperation 同步 ──────────────────────────────────────────

const adminTypes = readApps('admin/src/services/api/types.ts')
for (const op of NEW_OPS) {
  assertContains(adminTypes, `'${op}'`, `Admin types: AiOperation 包含 ${op}`)
}
assertContains(adminTypes, 'Record<AiOperation, number>', 'Admin types: byOperation 改用 Record<AiOperation, number>')

// ─── 9. OPERATION_LABELS 覆盖新增操作 ────────────────────────────────────────

// 「AI 服务管理」页 2026-09-30 拆文件（#1143）：成本明细表与 operation 中文名表移到同目录两个文件。
// 断言对象是这一页的全部源码，三者合并后逐条检查，不放松任何一条。
const aiServicesRoute = [
  'admin/src/routes/ai-services/index.tsx',
  'admin/src/routes/ai-services/AiOperationCostTable.tsx',
  'admin/src/routes/ai-services/aiOperationLabels.ts',
].map((rel) => readApps(rel)).join('\n') + '\n' + readApps('../packages/shared/src/aiDisplayLabels.ts')
assertContains(readApps('admin/src/routes/ai-services/aiOperationLabels.ts'), 'AI_OPERATION_LABELS as OPERATION_LABELS', '操作中文名仍从共享映射接入原页面')
for (const op of NEW_OPS) {
  assertContains(AI_OPERATION_LABELS[op], /[\u4e00-\u9fff]/u, `操作 ${op} 实际共享映射为中文`)
  assertContains(aiServicesRoute, op, `ai-services route: OPERATION_LABELS 覆盖 ${op}`)
}

// ─── 10. 合规：服务端不编造 ASR/TTS 成本（禁止 estimatedCostCny = 0 for NON_TOKEN_BILLED）

// ASR / TTS record 调用里 estimatedCostCny 字段不应存在（undefined 即忽略），
// 而不是 "0"（0 意味着「免费」，是编造）。
const asr_record_block = (() => {
  const idx = mockInterviewCtrl.indexOf("'voiceTranscribe'")
  return idx >= 0 ? mockInterviewCtrl.slice(Math.max(0, idx - 300), idx + 300) : ''
})()
assertNotContains(asr_record_block, 'estimatedCostCny: 0', 'ASR log block 未编造 estimatedCostCny: 0')

const tts_record_block = (() => {
  const idx = mockInterviewCtrl.indexOf("'voiceSynthesize'")
  return idx >= 0 ? mockInterviewCtrl.slice(Math.max(0, idx - 300), idx + 300) : ''
})()
assertNotContains(tts_record_block, 'estimatedCostCny: 0', 'TTS log block 未编造 estimatedCostCny: 0')

// ─── 10b. Admin 全量 operation 明细表 + 成本诚实标注 ─────────────────────────
//
// 页面顶部卡片只覆盖 6 个高频能力。若没有全量明细表，
// 职业规划 / 参会计划 / 模拟面试 / 语音这些能力的花费在 Admin 侧就是不可见的，
// A-6 等于没做完。同时守住：非 token 计费能力不得显示 ¥0（等于谎称免费）。

assertContains(aiServicesRoute, 'NON_TOKEN_BILLED_OPS', 'ai-services route: 声明 NON_TOKEN_BILLED_OPS')
assertContains(aiServicesRoute, 'operationRows', 'ai-services route: 存在全量 operation 明细表数据')
assertContains(aiServicesRoute, '未估算', 'ai-services route: 非 token 计费能力显示「未估算」而非 ¥0')
assertContains(
  aiServicesRoute,
  /分能力调用量与成本/,
  'ai-services route: 明细表分区标题存在',
)
// 明细表的成本单元格必须按 tokenBilled 分支渲染，不能无条件 toFixed 成金额
assertContains(aiServicesRoute, 'row.tokenBilled', 'ai-services route: 成本按 tokenBilled 分支渲染')

// ─── 10c. Admin 必须渲染成本三态，而不是把未采集画成 ¥0 ─────────────────────

assertContains(adminTypes, 'AiOperationCost', 'Admin types: 引入成本三态 AiOperationCost')
assertContains(adminTypes, 'Record<AiOperation, AiOperationCost>', 'Admin types: costByOperation 不再是纯 number')
assertContains(adminTypes, 'unmeasuredCalls', 'Admin types: 暴露未采集笔数')
assertContains(adminTypes, 'costCollectionSince', 'Admin types: 暴露采集起始日期')
assertContains(aiServicesRoute, 'costState', 'ai-services route: 按成本三态渲染')
assertContains(aiServicesRoute, "'uncollected'", 'ai-services route: 存在「未采集」态')
assertContains(aiServicesRoute, 'usage.costCollectionSince', 'ai-services route: 如实标注历史成本不完整（带日期）')
assertContains(aiServicesRoute, '不做回填', 'ai-services route: 明示不回填历史数据（D-2）')
// token 计费能力的成本单元格绝不能无条件 toFixed —— 那正是 ¥0.0000 的来源
assertNotContains(aiServicesRoute, 'usage.costByOperation.jobRecommend.toFixed',
  'ai-services route: 岗位 AI 卡片不再无条件把未采集渲染成 ¥0')
assertContains(aiServicesRoute, 'contractReview', 'ai-services route: 覆盖 contractReview')
assertContains(adminTypes, 'contractReview', 'Admin types: AiOperation 包含 contractReview')
const mockAdapter = readApps('admin/src/services/api/adminAiMockAdapter.ts')
assertContains(mockAdapter, 'measuredCalls', 'Admin mock adapter: costByOperation 已改成三态结构')
assertContains(mockAdapter, 'contractReview', 'Admin mock adapter: 覆盖 contractReview')

}
