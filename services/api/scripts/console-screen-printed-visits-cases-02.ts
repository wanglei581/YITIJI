import { randomUUID } from 'node:crypto'
import { Prisma, DayPrintInput } from './console-screen-printed-visits-cases-04'
import { type ScreenPrintTrendValue } from '../src/console-screen/console-screen.types'
import { ConsoleScreenService } from '../src/console-screen/console-screen.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'



export async function createDayPrint(prisma: Prisma, terminalId: string, tag: string, fx: DayPrintInput): Promise<void> {
  const taskId = `ptask_day_${tag}_${randomUUID().slice(0, 8)}`
  await prisma.printTask.create({
    data: {
      id: taskId,
      terminalId,
      fileUrl: `https://internal/${taskId}`,
      fileMd5: 'sha',
      paramsJson: JSON.stringify({ copies: fx.copies, colorMode: 'black_white', billablePages: 999, pages: 999 }),
      status: fx.status,
      errorCode: fx.errorCode ?? null,
      printOutcome: fx.printOutcome ?? null,
      completedAt: fx.completedAt,
    },
  })
  const order = await prisma.order.create({
    data: {
      orderNo: `DAY-${tag}-${randomUUID().slice(0, 8)}`,
      type: 'print',
      terminalId,
      printTaskId: taskId,
      amountCents: 0,
      billablePages: fx.pages,
      payStatus: 'paid',
      paidAt: fx.paidAt,
      taskStatus: fx.status,
    },
  })
  if (fx.itemPages !== undefined) {
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        seq: 0,
        fileId: `f_${tag}`,
        colorMode: 'black_white',
        duplex: 'simplex',
        copies: fx.itemCopies ?? fx.copies,
        billablePages: fx.itemPages,
        amountCents: 0,
        status: fx.status,
        printTaskId: taskId,
      },
    })
  }
}


export function trendDayPages(trend: ScreenPrintTrendValue | 'capped', key: string): number | null {
  if (trend === 'capped') return null
  return trend.days.find((day) => day.date === key)?.pages ?? null
}


export async function assertPrintedDayBucketsSetup(
  prisma: Prisma,
  screen: ConsoleScreenService,
  cache: ScreenSnapshotCache,
  orgId: string,
){

return { prisma, screen, cache, orgId }
}
