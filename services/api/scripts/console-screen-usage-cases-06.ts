import { type ScreenUsageSnapshot } from '../src/console-screen/console-screen.types'
import { shanghaiDayKey } from '../src/console-screen/console-screen.metric'
import { assert, opened } from './console-screen-usage-cases-01'
import { assertSmallSampleFloorSetup } from './console-screen-usage-cases-05'
import { NOW, DAY7_START, AiSeed, carryContext } from './console-screen-usage-cases-07'



export async function assertSmallSampleFloorPhase1(context: Awaited<ReturnType<typeof assertSmallSampleFloorSetup>>) {
const { input } = context
const { prisma, usage, cache, memberId, terminalId, fileUrl, suffix } = input
await prisma.browseLog.deleteMany()
await prisma.favorite.deleteMany()
await prisma.externalJumpLog.deleteMany()
await prisma.aiServiceLog.deleteMany()
await prisma.printTask.deleteMany()
await prisma.scanTask.deleteMany()
await prisma.order.deleteMany()
await prisma.auditLog.deleteMany()
cache.clear()
const read = async (range: 'today' | '7d' = 'today') => {
    cache.clear()
    return usage.getAdminUsage(range, NOW)
  }
const zero = (await read()).metrics
const zeroAi = opened(zero.ai)
assert(
    'u42z. 空库真实服务返回计数 0；成功率、时延、成本与高峰仍为空',
    Object.values(opened(zero.channels) ?? {}).length === 5
      && Object.values(opened(zero.channels) ?? {}).every((count) => count === 0)
      && opened(zero.services)?.every((row) => row.count === 0) === true
      && Object.values(opened(zero.outcomes) ?? {}).every((count) => count === 0)
      && opened(zero.printSteps)?.paid === 0 && opened(zero.printSteps)?.printed === 0
      && opened(zero.resumeSteps)?.analyzed === 0 && opened(zero.resumeSteps)?.optimized === 0
      && opened(zero.resumeSteps)?.exported === 0
      && zeroAi?.total === 0 && zeroAi.success === 0 && zeroAi.failed === 0
      && zeroAi.costMeasuredCalls === 0 && zeroAi.fallbackCalls === 0
      && zeroAi.successRate === null && zeroAi.avgLatencyMs === null && zeroAi.estimatedCostCny === null
      && opened(zero.heat7d)?.peakHour === null
      && opened(zero.pulse2h)?.buckets.every((b) => b.info === null && b.ai === null && b.print === null) === true,
  )
const expiresAt = new Date('2026-02-01T00:00:00.000Z')
const browseAt = (createdAt: Date) => ({
    endUserId: memberId,
    targetType: 'job',
    targetId: `heat_${suffix}`,
    createdAt,
    expiresAt,
  })
await prisma.browseLog.createMany({
    data: Array.from({ length: 7 }, (_, day) => browseAt(new Date((DAY7_START.getTime() + 86400000) + day * 86_400_000 + 4 * 3_600_000))),
  })
let heat = opened((await read()).metrics.heat7d)
assert(
    'u42. 每天 04:00 各 1 次压制为 null，空格与未来都为 null、峰值为空',
    heat?.days.length === 7
      && heat.days.every((day) => day.hours[4] === null)
      && heat.days.every((day) => day.hours.every((hour) =>
        hour === null))
      && heat.peakHour === null
      && heat.days[heat.days.length - 1]?.date === shanghaiDayKey(NOW),
  )
await prisma.browseLog.createMany({
    data: Array.from({ length: 5 }, () => browseAt(new Date('2026-01-15T02:00:00.000Z'))),
  })
heat = opened((await read()).metrics.heat7d)
assert(
    'u43. 04:00 原始合计为 7 也不当峰值，峰值只来自可见的 10 点',
    heat !== null && heat.days.every((day) => day.hours[4] === null)
      && heat.days.find((day) => day.date === shanghaiDayKey(NOW))?.hours[10] === 5
      && heat.peakHour === 10,
  )
await prisma.browseLog.deleteMany()
const aiOf = (snap: ScreenUsageSnapshot) => opened(snap.metrics.ai)
const stepsOf = (snap: ScreenUsageSnapshot) => opened(snap.metrics.printSteps)
const resumeOf = (snap: ScreenUsageSnapshot) => opened(snap.metrics.resumeSteps)
let seq = 0
const nextId = (prefix: string) => `${prefix}_${seq += 1}_${suffix}`
const printRow = (completedAt: Date) => ({
    id: nextId('edge_print'),
    terminalId,
    fileUrl,
    fileMd5: 'md5',
    status: 'completed',
    completedAt,
    printOutcome: null,
    createdAt: completedAt,
    updatedAt: completedAt,
  })
await prisma.printTask.create({ data: printRow(NOW) })
let snap = await read()
assert(
    'u44. 当天只完成 1 次打印时，结果和步骤都是 null',
    opened(snap.metrics.outcomes)?.printed === null && stepsOf(snap)?.printed === null,
  )
await prisma.printTask.createMany({ data: [printRow(NOW), printRow(NOW), printRow(NOW)] })
snap = await read()
assert(
    'u45. 出纸 4 次时两处仍都是 null',
    opened(snap.metrics.outcomes)?.printed === null && stepsOf(snap)?.printed === null,
  )
await prisma.printTask.create({ data: printRow(NOW) })
snap = await read()
assert(
    'u46. 出纸 5 次时两处都是 5',
    opened(snap.metrics.outcomes)?.printed === 5 && stepsOf(snap)?.printed === 5,
  )
const paidRow = (paidAt: Date) => ({
    orderNo: nextId('edge_order'),
    payStatus: 'paid',
    channel: 'kiosk',
    paidAt,
    endUserId: null,
    createdAt: paidAt,
    amountCents: 100,
  })
await prisma.order.createMany({ data: [paidRow(NOW), paidRow(NOW), paidRow(NOW), paidRow(NOW)] })
snap = await read()
assert(
    'u47. 已支付订单 4 笔时，渠道总数和打印步骤都是 null',
    opened(snap.metrics.channels)?.paidOrders === null && stepsOf(snap)?.paid === null,
  )
await prisma.order.create({ data: paidRow(NOW) })
snap = await read()
assert(
    'u48. 已支付订单 5 笔时，渠道总数和打印步骤都是 5',
    opened(snap.metrics.channels)?.paidOrders === 5 && stepsOf(snap)?.paid === 5,
  )
const aiRow = (seed: AiSeed) => ({ ...seed, terminalId })
const seedAi = (count: number, seed: AiSeed) => prisma.aiServiceLog.createMany({
    data: Array.from({ length: count }, () => aiRow(seed)),
  })
const successSeed = (createdAt: Date): AiSeed => ({
    operation: 'parseResume', status: 'success', provider: 'llm:deepseek',
    estimatedCostCny: 1.5, latencyMs: 100, createdAt,
  })
await seedAi(4, successSeed(NOW))
snap = await read()
assert(
    'u49. AI 4 次计数、时延、成本和解析步骤为 null；失败与兜底 0 保留',
    aiOf(snap)?.total === null
      && aiOf(snap)?.success === null
      && aiOf(snap)?.failed === 0
      && aiOf(snap)?.successRate === null
      && aiOf(snap)?.avgLatencyMs === null
      && aiOf(snap)?.estimatedCostCny === null
      && aiOf(snap)?.costMeasuredCalls === null
      && aiOf(snap)?.fallbackCalls === 0
      && resumeOf(snap)?.analyzed === null,
  )
await seedAi(1, successSeed(NOW))
snap = await read()
assert(
    'u50. AI 成功、总量、时延、成本和解析步骤在 5 次时给出实数',
    aiOf(snap)?.total === 5
      && aiOf(snap)?.success === 5
      && aiOf(snap)?.successRate === 100
      && aiOf(snap)?.avgLatencyMs === 100
      && aiOf(snap)?.estimatedCostCny === 7.5
      && aiOf(snap)?.costMeasuredCalls === 5
      && resumeOf(snap)?.analyzed === 5,
  )
await prisma.aiServiceLog.deleteMany()
await seedAi(2, { ...successSeed(NOW), estimatedCostCny: null })
await seedAi(2, { ...successSeed(NOW), status: 'failed', estimatedCostCny: null, latencyMs: null })
await seedAi(3, { ...successSeed(NOW), operation: 'chatAssistant', status: 'running', provider: 'llm:qwen', estimatedCostCny: null, latencyMs: null })
snap = await read()
assert(
    'u51. 成功加失败只有 4 次时成功率为 null，哪怕总调用已经到 7',
    aiOf(snap)?.total === 7 && aiOf(snap)?.successRate === null,
  )
await seedAi(1, { ...successSeed(NOW), estimatedCostCny: null })
snap = await read()
return carryContext(context, { prisma, usage, cache, memberId, terminalId, fileUrl, suffix, read, zero, zeroAi, expiresAt, browseAt, get heat() { return heat }, set heat(value: typeof heat) { heat = value }, aiOf, stepsOf, resumeOf, get seq() { return seq }, set seq(value: typeof seq) { seq = value }, nextId, printRow, get snap() { return snap }, set snap(value: typeof snap) { snap = value }, paidRow, aiRow, seedAi, successSeed })
}


export async function assertSmallSampleFloorPhase2(context: Awaited<ReturnType<typeof assertSmallSampleFloorPhase1>>) {
const { prisma, read, aiOf, resumeOf, seedAi, successSeed } = context
assert(
    'u52. 成功加失败达到 5 次时给出成功率，分母仍含其它状态',
    aiOf(context.snap)?.total === 8 && aiOf(context.snap)?.successRate === 37.5,
  )
await prisma.aiServiceLog.deleteMany()
await seedAi(4, { ...successSeed(NOW), status: 'failed', estimatedCostCny: null, latencyMs: null })
context.snap = await read()
assert('u53. 失败 4 次为 null', aiOf(context.snap)?.failed === null && aiOf(context.snap)?.total === null)
await seedAi(1, { ...successSeed(NOW), status: 'failed', estimatedCostCny: null, latencyMs: null })
context.snap = await read()
assert('u54. 失败 5 次为 5', aiOf(context.snap)?.failed === 5 && aiOf(context.snap)?.total === 5)
await prisma.aiServiceLog.deleteMany()
const fallbackSeed: AiSeed = {
    operation: 'voiceSynthesize', status: 'running', provider: 'stub',
    estimatedCostCny: null, latencyMs: null, createdAt: NOW,
  }
await seedAi(4, fallbackSeed)
context.snap = await read()
assert('u55. 兜底调用 4 次为 null', aiOf(context.snap)?.fallbackCalls === null)
await seedAi(1, fallbackSeed)
context.snap = await read()
assert('u56. 兜底调用 5 次为 5', aiOf(context.snap)?.fallbackCalls === 5)
await prisma.aiServiceLog.deleteMany()
const optimized: AiSeed = { ...successSeed(NOW), operation: 'optimizeResume', estimatedCostCny: null, latencyMs: null }
await seedAi(4, optimized)
context.snap = await read()
assert('u57. 优化 4 次为 null', resumeOf(context.snap)?.optimized === null)
await seedAi(1, optimized)
context.snap = await read()
assert('u58. 优化 5 次为 5', resumeOf(context.snap)?.optimized === 5)
const auditRow = (createdAt: Date) => ({
    actorRole: 'admin',
    action: 'resume.diagnosis_exported',
    targetType: 'resume',
    createdAt,
    payloadJson: '{}',
  })
await prisma.auditLog.createMany({ data: [auditRow(NOW), auditRow(NOW), auditRow(NOW), auditRow(NOW)] })
context.snap = await read()
assert('u59. 导出 4 次为 null', resumeOf(context.snap)?.exported === null)
await prisma.auditLog.create({ data: auditRow(NOW) })
context.snap = await read()
assert('u60. 导出 5 次为 5', resumeOf(context.snap)?.exported === 5)
return carryContext(context, { fallbackSeed, optimized, auditRow })
}
