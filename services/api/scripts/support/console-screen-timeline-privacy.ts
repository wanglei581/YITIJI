import { randomUUID } from 'node:crypto'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { suppressAggregateCount } from '../../src/console-screen/console-screen.metric'
import { deriveTerminalTimeline } from '../../src/console-screen/console-screen.timeline'
import { loadTerminalTwin } from '../../src/console-screen/console-screen.twin'

type Assert = (label: string, condition: boolean, detail?: string) => void
export async function verifyTimelinePrivacy(assert: Assert, prisma?: PrismaService, terminalId?: string): Promise<void> {
  const now = new Date('2031-10-04T05:01:42.678Z')
  const prints = Array.from({ length: 5 }, (_, i) => ({
    from: new Date(now.getTime() - (i + 1) * 600000), to: new Date(now.getTime() - (i + 1) * 600000 + 120000),
  }))
  const hearts = [{ at: new Date(now.getTime() - 86400000), printerStatus: 'ready' }]
  const three = deriveTerminalTimeline({ now, prints: prints.slice(0, 3), heartbeats: hearts, onlineWindowMs: 86400000 })
  const five = deriveTerminalTimeline({ now, prints, heartbeats: hearts, onlineWindowMs: 86400000 })
  assert('timeline privacy：近24小时3段时不逐段返回 printing，撤覆盖后不留逐单边界', three.ok && three.printingSuppressed && three.segments.length === 1 && !three.segments.some((s) => s.state === 'printing'))
  assert('timeline privacy：5段照常返回 printing', five.ok && !five.printingSuppressed && five.segments.filter((s) => s.state === 'printing').length === 5)
  assert('timeline privacy：时间戳只有分钟，没有秒与毫秒', [three, five].every((r) => r.ok && r.segments.every((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s.from) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s.to))))
  // 走查实际任务只持续约1.5秒，达到阈值后不能因截分钟而全丢。
  const short = deriveTerminalTimeline({ now, heartbeats: hearts, onlineWindowMs: 86400000,
    prints: Array.from({ length: 5 }, (_, i) => ({ from: new Date(now.getTime() - 60000 - i * 5000), to: new Date(now.getTime() - 58500 - i * 5000) })) })
  assert('timeline privacy：5个秒级短任务截分钟后仍有打印标记，不放大真实时长', short.ok && !short.printingSuppressed && short.segments.some((s) => s.state === 'printing' && s.from === s.to))
  // 昨日23点仍在近24小时，今日printTasks为0也要按时间带本身压制。
  const acrossMidnight = deriveTerminalTimeline({ now: new Date('2031-10-03T16:30:00Z'), heartbeats: [], prints: [{ from: new Date('2031-10-03T15:00:00Z'), to: new Date('2031-10-03T15:02:00Z') }] })
  assert('timeline privacy：跨上海零点按近24小时窗口判断', acrossMidnight.ok && acrossMidnight.printingSuppressed && !acrossMidnight.segments.some((s) => s.state === 'printing'))
  // 两份输出：先隐藏4段，再增加1段。后一次公开的旧窗口内4段构成下界，
  // 与第一次小样本说明提供的上界相交，只剩4；不能仅验证单次响应。
  const firstAt = new Date('2031-10-04T05:00:00Z')
  const secondAt = new Date('2031-10-04T06:00:00Z')
  const previousPrints = prints.slice(0, 4).map((p) => ({ from: new Date(p.from.getTime() - 120000), to: new Date(p.to.getTime() - 120000) }))
  const first = deriveTerminalTimeline({ now: firstAt, prints: previousPrints, heartbeats: [] })
  const second = deriveTerminalTimeline({ now: secondAt, heartbeats: [], prints: [...previousPrints, { from: new Date('2031-10-04T05:58:00Z'), to: new Date('2031-10-04T05:59:00Z') }] })
  const survivingLowerBound = second.ok ? second.segments.filter((s) => s.state === 'printing' && Date.parse(s.from) >= firstAt.getTime() - 86400000 && Date.parse(s.to) <= firstAt.getTime()).length : 0
  const possibilities = Array.from({ length: 9 }, (_, n) => n).filter((n) => suppressAggregateCount(n) === null && n >= survivingLowerBound)
  assert('timeline two-read privacy：4→5 后仍不能唯一锁定前一次被隐藏的4段', first.ok && first.printingSuppressed && second.ok && possibilities.length > 1, `later-old-window-segments=${survivingLowerBound}, possible-hidden-counts=${possibilities.join(',')}`)
  if (!prisma || !terminalId) return
  // 验真正 loadTerminalTwin 的响应形状，管理员与机构走相同投影。
  const tasks = []
  for (const [i, interval] of prints.entries()) {
    const task = await prisma.printTask.create({ data: { id: randomUUID(), terminalId, status: 'completed', fileUrl: 'https://verify.invalid/file', fileMd5: 'verify', paramsJson: '{}', createdAt: interval.from, completedAt: interval.to } })
    tasks.push(task.id)
    await prisma.printTaskStatusLog.createMany({ data: [{ id: randomUUID(), taskId: task.id, toStatus: 'printing', fromStatus: 'claimed', createdAt: interval.from }, { id: randomUUID(), taskId: task.id, toStatus: 'completed', fromStatus: 'printing', createdAt: interval.to }] })
    if (i !== 2 && i !== 4) continue
    const twin = await loadTerminalTwin(prisma, terminalId, 'admin', null, now)
    const segments = twin.timeline24h.available ? twin.timeline24h.value : []
    assert(`timeline privacy：真实接口${i + 1}单与说明字段一致`, i === 2 ? twin.timelinePrintingSuppressed && !segments.some((s) => s.state === 'printing') : !twin.timelinePrintingSuppressed && segments.some((s) => s.state === 'printing'))
  }
  await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: tasks } } })
  await prisma.printTask.deleteMany({ where: { id: { in: tasks } } })
}
