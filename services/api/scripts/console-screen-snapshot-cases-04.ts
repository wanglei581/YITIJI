import { type TimelineHeartbeat, type TimelinePrintInterval } from '../src/console-screen/console-screen.timeline'
import { timelineSampleDiff, mulberry32 } from './console-screen-snapshot-cases-03'
import { TimelineSample } from './console-screen-snapshot-cases-18'
import { PrismaService } from '../src/prisma/prisma.service'



export function diffTimelineSamples(now: Date): string[] {
  const failures: string[] = []
  const collect = (label: string, sample: TimelineSample) => {
    const diff = timelineSampleDiff(label, sample)
    if (diff) failures.push(diff)
  }
  collect('no-heartbeat', { now, heartbeats: [], prints: [] })
  collect('stale-heartbeat', {
    now,
    heartbeats: [{ at: new Date(now.getTime() - 48 * 60 * 60 * 1000), printerStatus: 'ready' }],
    prints: [],
  })
  collect('print-on-unknown', {
    now,
    heartbeats: [],
    prints: [{ from: new Date(now.getTime() - 60_000), to: new Date(now.getTime() - 30_000) }],
  })
  const statuses = [null, 'ready', 'ok', 'idle', 'unknown', 'paper_empty', 'offline', 'toner_low', '']
  for (let index = 0; index < 50; index += 1) {
    const rand = mulberry32(0xC0FFEE + index)
    const sampleNow = new Date(now.getTime() - Math.floor(rand() * 3_600_000))
    const heartbeatCount = Math.floor(rand() * 240)
    const heartbeats: TimelineHeartbeat[] = Array.from({ length: heartbeatCount }, () => ({
      at: new Date(sampleNow.getTime() - (rand() * 28 - 1) * 3_600_000),
      printerStatus: statuses[Math.floor(rand() * statuses.length)] ?? null,
    }))
    if (index % 7 === 0) heartbeats.push({ at: new Date(Number.NaN), printerStatus: 'ready' })
    const prints: TimelinePrintInterval[] = Array.from({ length: Math.floor(rand() * 12) }, () => {
      const start = sampleNow.getTime() - rand() * 26 * 3_600_000
      const end = start + (rand() - 0.1) * 3_600_000
      return { from: new Date(Math.min(start, end)), to: new Date(Math.max(start, end)) }
    })
    collect(`random-${index}`, {
      now: sampleNow,
      heartbeats,
      prints,
      onlineWindowMs: [60_000, 180_000, 300_000][Math.floor(rand() * 3)] ?? 180_000,
      heartbeatRowCapExceeded: index === 3,
      printRowCapExceeded: index === 11,
      segmentCap: index === 17 ? 2 : undefined,
    })
    if (failures.length > 0) break
  }
  return failures
}


export async function createOnlineHeartbeats(
  prisma: PrismaService,
  terminalId: string,
  times: readonly Date[],
  printerStatus: string,
): Promise<void> {
  const chunkSize = 200
  for (let offset = 0; offset < times.length; offset += chunkSize) {
    await prisma.terminalHeartbeat.createMany({
      data: times.slice(offset, offset + chunkSize).map((createdAt) => ({
        terminalId,
        status: 'online',
        printerStatus,
        createdAt,
      })),
    })
  }
}


export async function assertPureHelpersSetup(){

return {  }
}
