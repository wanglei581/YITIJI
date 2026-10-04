import { SCREEN_JUMP_COPY, SCREEN_MIN_AGGREGATE_SAMPLE } from '../src/console-screen/console-screen.types'
import { shanghaiDayKey } from '../src/console-screen/console-screen.metric'
import { assert, inWindow, opened, isPrinted } from './console-screen-usage-cases-01'
import { assertBehaviorPhase1 } from './console-screen-usage-cases-03'
import { NOW, DAY7_START, carryContext } from './console-screen-usage-cases-07'



export async function assertBehaviorPhase2(context: Awaited<ReturnType<typeof assertBehaviorPhase1>>) {
const { usage, orgA, orgB, favorites, prints, countBrowse, countFav, countJump, aiWhere, successOf, show, today, week, month, admin, services, channels, paidToday } = context
assert(
      'u13. 渠道按 paidAt 计已支付，分项 1–4 为 null，0 保留，未支付和已退款不计',
      channels?.paidOrders === paidToday.length
        && channels.kiosk === show(paidToday.filter((row) => row.channel === 'kiosk').length)
        && channels.miniapp === show(paidToday.filter((row) => row.channel === 'miniapp_cloud').length)
        && channels.unlabeled === show(paidToday.filter((row) => row.channel === null || row.channel === '').length)
        && channels.memberOrders === show(paidToday.filter((row) => row.endUserId !== null).length)
        && paidToday.length === 16
        && channels.miniapp === null
        && channels.kiosk === 6,
      `paid=${String(channels?.paidOrders)} kiosk=${String(channels?.kiosk)} mini=${String(channels?.miniapp)} unlabeled=${String(channels?.unlabeled)} member=${String(channels?.memberOrders)}`,
    )
const outcomes = opened(admin.metrics.outcomes)
const printedToday = prints.filter((row) => isPrinted(row, today.from, today.to)).length
assert(
      'u14. 结果是外跳、收藏、三类成功报告和完成出纸',
      outcomes?.sourceOpens === show(countJump(null, today.from, today.to))
        && outcomes.favorites === show(favorites.filter((row) => inWindow(row.at, today.from, today.to)).length)
        && outcomes.aiReports === show(successOf(['parseResume', 'interviewReport', 'careerPlan'], today.from, today.to))
        && outcomes.printed === show(printedToday)
        && successOf(['parseResume'], today.from, today.to) === 3
        && outcomes.aiReports === 13,
      `opens=${String(outcomes?.sourceOpens)} fav=${String(outcomes?.favorites)} reports=${String(outcomes?.aiReports)} printed=${String(outcomes?.printed)}`,
    )
const steps = opened(admin.metrics.printSteps)
const resume = opened(admin.metrics.resumeSteps)
assert(
      'u15. 上传和检查未写入；付款、出纸、解析、优化、导出与结果共用少于 5 则 null',
      steps?.uploaded.available === false
        && steps.uploaded.reason === 'upload_counter_unwritten'
        && steps.inspected.available === false
        && steps.inspected.reason === 'inspection_counter_unwritten'
        && steps.paid === channels?.paidOrders
        && steps.printed === outcomes?.printed
        && steps.printed === show(printedToday)
        && resume?.uploaded.available === false
        && resume.analyzed === show(successOf(['parseResume'], today.from, today.to))
        && resume.optimized === show(successOf(['optimizeResume'], today.from, today.to))
        && resume.exported === 5
        && resume.analyzed === null
        && resume.optimized === null,
      `printedStep=${String(steps?.printed)} analyzed=${String(resume?.analyzed)} optimized=${String(resume?.optimized)}`,
    )
const aiMetric = opened(admin.metrics.ai)
const aiToday = aiWhere(today.from, today.to)
const successN = aiToday.filter((row) => row.status === 'success').length
const failedN = aiToday.filter((row) => row.status === 'failed').length
const measured = aiToday.filter((row) => row.estimatedCostCny !== null)
const latencyRows = aiToday.filter((row) => row.status === 'success' && row.latencyMs !== null)
const avgLatency = Math.round(latencyRows.reduce((sum, row) => sum + (row.latencyMs ?? 0), 0) / latencyRows.length)
const classify = aiMetric?.byOperation.find((row) => row.operation === 'classifyIntent')
const voice = aiMetric?.byOperation.find((row) => row.operation === 'voiceTranscribe')
const contract = aiMetric?.byOperation.find((row) => row.operation === 'contractReview')
const chat = aiMetric?.byOperation.find((row) => row.operation === 'chatAssistant')
const deepseek = aiMetric?.providers.find((row) => row.provider === 'llm:deepseek')
const qwen = aiMetric?.providers.find((row) => row.provider === 'llm:qwen')
const mock = aiMetric?.providers.find((row) => row.provider === 'mock')
const fallbackN = aiToday.filter((row) => row.provider === 'mock' || row.provider === 'stub').length
assert(
      'u16. AI 总量、成功率、已采集成本和兜底提供者少于 5 则 null',
      aiMetric?.total === show(aiToday.length)
        && aiMetric.success === show(successN)
        && aiMetric.failed === show(failedN)
        && failedN === 4
        && aiMetric.failed === null
        && aiMetric.successRate === Math.round((successN / aiToday.length) * 1000) / 10
        && aiMetric.successRate !== Math.round((successN / (successN + failedN)) * 1000) / 10
        && successN + failedN >= SCREEN_MIN_AGGREGATE_SAMPLE
        && aiMetric.avgLatencyMs === avgLatency
        && measured.length === 3
        && aiMetric.estimatedCostCny === null
        && aiMetric.costMeasuredCalls === null
        && aiMetric.fallbackCalls === show(fallbackN)
        && classify?.count === 8
        && voice?.count === 5
        && contract?.count === null
        && chat?.count === 6
        && deepseek?.label === 'DeepSeek'
        && qwen?.label === '千问'
        && mock?.label === '未就绪兜底'
        && mock.count === null
        && !aiMetric.byOperation.some((row) => row.operation === 'jobApplication'),
      `total=${String(aiMetric?.total)} rate=${String(aiMetric?.successRate)} cost=${String(aiMetric?.estimatedCostCny)} latency=${String(aiMetric?.avgLatencyMs)}`,
    )
const jobs = opened(admin.metrics.jobs)
const content = opened(admin.metrics.content)
const top = opened(admin.metrics.topSources30d)
assert(
      'u17. 岗位与内容只统计会员行为，外跳榜复用小于 5 则不进榜',
      jobs?.browse === show(countBrowse(['job'], today.from, today.to))
        && jobs.favorites === show(countFav('job', today.from, today.to))
        && jobs.sourceOpens === show(countJump('job', today.from, today.to))
        && jobs.coverage === 'members_only'
        && content?.fair === show(countBrowse(['job_fair', 'fair_company'], today.from, today.to))
        && content.policy === show(countBrowse(['policy'], today.from, today.to))
        && content.company === null
        && content.coverage === 'members_only'
        && top?.copy === SCREEN_JUMP_COPY
        && top.items.some((item) => item.sourceName === '公共就业' && item.count === 5)
        && top.items.every((item) => item.count >= 5)
        && !top.items.some((item) => item.sourceName === '小样本'),
    )
const heat = opened(admin.metrics.heat7d)
const todayHeat = heat?.days.find((day) => day.date === '2026-01-15')
assert(
      'u18. 热力是上海自然日的 24 小时：0 与 1–4 同为 null，未来为 null',
      heat?.days.length === 7
        && heat.days[0]?.date === '2026-01-09'
        && heat.days[6]?.date === '2026-01-15'
        && todayHeat?.hours.length === 24
        && todayHeat.hours[0] === 5
        && todayHeat.hours[1] === 5
        && todayHeat.hours[4] === null
        && todayHeat.hours[7] === 5
        && todayHeat.hours[10] !== null
        && todayHeat.hours.slice(11).every((hour) => hour === null)
        && heat.peakHour === 10,
      `h0=${String(todayHeat?.hours[0])} h1=${String(todayHeat?.hours[1])} h4=${String(todayHeat?.hours[4])} h7=${String(todayHeat?.hours[7])} peak=${String(heat?.peakHour)}`,
    )
assert(
      'u18c. 热力图最后一行是今天',
      heat?.days[heat.days.length - 1]?.date === shanghaiDayKey(NOW),
    )
const pulse = opened(admin.metrics.pulse2h)
assert(
      'u19. 脉搏是上海时区近 2 小时的 24 个 5 分钟桶',
      pulse?.bucketMinutes === 5
        && pulse.buckets.length === 24
        && pulse.buckets[0]?.start === '2026-01-15T00:10:00.000Z'
        && pulse.buckets[23]?.start === '2026-01-15T02:05:00.000Z'
        && pulse.buckets[0].ai === null
        && pulse.buckets[0].info === null
        && pulse.buckets[0].print === null
        && pulse.buckets[23].ai !== null
        && pulse.buckets[23].info !== null
        && pulse.buckets[23].print !== null,
      `first=${pulse?.buckets[0]?.start} ai0=${String(pulse?.buckets[0]?.ai)}`,
    )
const weekSnap = await usage.getAdminUsage('7d', NOW)
const monthSnap = await usage.getAdminUsage('30d', NOW)
const weekServices = opened(weekSnap.metrics.services)
const monthServices = opened(monthSnap.metrics.services)
const weekScan = weekServices?.find((item) => item.key === 'scan')?.count
const todayScan = services?.find((item) => item.key === 'scan')?.count
const monthPrint = monthServices?.find((item) => item.key === 'print')?.count
const weekPrint = weekServices?.find((item) => item.key === 'print')?.count
assert(
      'u20. 上海零点是窗口边界：零点计入，零点前 1 毫秒不计入 today',
      todayScan === 5
        && weekScan === null
        && week.from.toISOString() === DAY7_START.toISOString()
        && prints.filter((row) => inWindow(row.createdAt, month.from, month.to)).length === (monthPrint ?? -1)
        && show(prints.filter((row) => inWindow(row.createdAt, week.from, week.to)).length) === weekPrint
        && (monthPrint ?? 0) > (weekPrint ?? 0)
        && opened(weekSnap.metrics.resumeSteps)?.exported === null
        && opened(weekSnap.metrics.channels)?.kiosk === null,
      `scan today/7d=${String(todayScan)}/${String(weekScan)} print 7d/30d=${String(weekPrint)}/${String(monthPrint)}`,
    )
const partnerA = await usage.getPartnerUsage(orgA, 'today', NOW)
const partnerB = await usage.getPartnerUsage(orgB, 'today', NOW)
const contentA = opened(partnerA.metrics.partnerContent)
const contentB = opened(partnerB.metrics.partnerContent)
const rowA = (type: string) => contentA?.byType.find((row) => row.type === type)
const rowB = (type: string) => contentB?.byType.find((row) => row.type === type)
const topA = opened(partnerA.metrics.partnerTop)
return carryContext(context, { outcomes, printedToday, steps, resume, aiMetric, aiToday, successN, failedN, measured, latencyRows, avgLatency, classify, voice, contract, chat, deepseek, qwen, mock, fallbackN, jobs, content, top, heat, todayHeat, pulse, weekSnap, monthSnap, weekServices, monthServices, weekScan, todayScan, monthPrint, weekPrint, partnerA, partnerB, contentA, contentB, rowA, rowB, topA })
}
