import { randomUUID } from 'node:crypto'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { deriveTerminalTimeline } from '../../src/console-screen/console-screen.timeline'
import { loadTerminalTwin } from '../../src/console-screen/console-screen.twin'

type Assert = (label: string, condition: boolean, detail?: string) => void
export async function verifyTimelinePrivacy(assert: Assert, prisma?: PrismaService, terminalId?: string): Promise<void> {
  const now = new Date('2031-10-04T05:01:42.678Z')
  const prints = Array.from({ length: 12 }, (_, i) => ({
    from: new Date(now.getTime() - (i + 1) * 600000), to: new Date(now.getTime() - (i + 1) * 600000 + 120000),
  }))
  const hearts = [{ at: new Date(now.getTime() - 86400000), printerStatus: 'ready' }]
  const base = deriveTerminalTimeline({ now, prints: [], heartbeats: hearts, onlineWindowMs: 86400000 })
  for (const n of [0, 3, 4, 5, 12]) {
    const result = deriveTerminalTimeline({ now, prints: prints.slice(0, n), heartbeats: hearts, onlineWindowMs: 86400000 })
    assert(`timeline privacy：${n}段时不返回 printing 或逐单边界`, result.ok && !result.segments.some((s) => String(s.state) === 'printing') && JSON.stringify(result) === JSON.stringify(base))
    assert(`timeline privacy：${n}段时只返回分钟时间戳`, result.ok && result.segments.every((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s.from) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s.to)))
  }
  const short = deriveTerminalTimeline({ now, heartbeats: hearts, onlineWindowMs: 86400000,
    prints: Array.from({ length: 5 }, (_, i) => ({ from: new Date(now.getTime() - 60000 - i * 5000), to: new Date(now.getTime() - 58500 - i * 5000) })) })
  assert('timeline privacy：秒级短任务也不产生打印位置标记', JSON.stringify(short) === JSON.stringify(base))
  const acrossMidnight = deriveTerminalTimeline({ now: new Date('2031-10-03T16:30:00Z'), heartbeats: [], prints: [{ from: new Date('2031-10-03T15:00:00Z'), to: new Date('2031-10-03T15:02:00Z') }] })
  assert('timeline privacy：跨上海零点也不返回 printing', acrossMidnight.ok && !acrossMidnight.segments.some((s) => String(s.state) === 'printing'))
  const firstAt = new Date('2031-10-04T05:00:00Z')
  const secondAt = new Date('2031-10-04T06:00:00Z')
  const previousPrints = prints.slice(0, 4).map((p) => ({ from: new Date(p.from.getTime() - 120000), to: new Date(p.to.getTime() - 120000) }))
  const first = deriveTerminalTimeline({ now: firstAt, prints: previousPrints, heartbeats: [] })
  const second = deriveTerminalTimeline({ now: secondAt, heartbeats: [], prints: [...previousPrints, { from: new Date('2031-10-04T05:58:00Z'), to: new Date('2031-10-04T05:59:00Z') }] })
  assert('timeline two-read privacy：4→5 两次均无 printing，只随时间推移', [first, second].every((r) => r.ok && !r.segments.some((s) => String(s.state) === 'printing'))
    && JSON.stringify(first) === JSON.stringify(deriveTerminalTimeline({ now: firstAt, prints: [], heartbeats: [] }))
    && JSON.stringify(second) === JSON.stringify(deriveTerminalTimeline({ now: secondAt, prints: [], heartbeats: [] })))
  assert('timeline privacy：打印行数上限也不影响可用性', JSON.stringify(deriveTerminalTimeline({ now, prints, heartbeats: hearts, onlineWindowMs: 86400000, printRowCapExceeded: true })) === JSON.stringify(base))
  if (!prisma || !terminalId) return
  const tasks: string[] = []
  try {
    for (const [i, interval] of prints.entries()) {
      const task = await prisma.printTask.create({ data: { id: randomUUID(), terminalId, status: 'completed', fileUrl: 'https://verify.invalid/file', fileMd5: 'verify', paramsJson: '{}', createdAt: interval.from, completedAt: interval.to } })
      tasks.push(task.id)
      await prisma.printTaskStatusLog.createMany({ data: [{ id: randomUUID(), taskId: task.id, toStatus: 'printing', fromStatus: 'claimed', createdAt: interval.from }, { id: randomUUID(), taskId: task.id, toStatus: 'completed', fromStatus: 'printing', createdAt: interval.to }] })
      if (![2, 3, 4, 11].includes(i)) continue
      for (const audience of ['admin', 'partner'] as const) {
        const twin = await loadTerminalTwin(prisma, terminalId, audience, null, now)
        assert(`timeline privacy：真实${audience}接口${i + 1}单无 printing、无旧字段`, twin.timeline24h.available && !twin.timeline24h.value.some((s) => String(s.state) === 'printing') && !('timelinePrintingSuppressed' in twin))
      }
    }
  } finally {
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: tasks } } })
    await prisma.printTask.deleteMany({ where: { id: { in: tasks } } })
  }
}
