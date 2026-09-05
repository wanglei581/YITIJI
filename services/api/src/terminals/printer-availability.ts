// 建单 / 报价前的打印机可用性门禁（PRT-03）。
//
// 背景：一体机只有「上传 → 预览」这条路在预览页拦打印机离线；我的文档、简历产物、
// 招聘会资料等 19 个入口直达 /print/confirm，服务端 create / quote 又只查能力登记与
// lifecycle，不看心跳。结果是打印机离线也能建单收款，钱收了纸不出，只能人工退款。
//
// 口径：
//   - 最近一条心跳超过 PRINTER_ONLINE_WINDOW_MS（3 分钟，与 Admin 终端列表 /
//     派生告警同窗口）或从未上报 → 视为离线。
//   - 心跳的 printerStatus 落在 UNAVAILABLE_PRINTER_STATUSES → 视为不可用。
//   - 判定 fail-closed；只在 PRINT_REQUIRE_PRINTER_ONLINE=true 时生效，
//     生产启动门禁要求它必须为 true（见 production-runtime-gates.ts）。
//     默认关闭是为了让本地与 CI 的隔离夹具（没有 Agent 心跳）继续跑，不是为了
//     给生产留旁路。
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'

export const PRINTER_ONLINE_WINDOW_MS = 3 * 60 * 1000

/** Agent 心跳 printerStatus 枚举里，明确不能出纸的取值。unknown 不在其中：
 *  驱动查询失败或未配置时是 unknown，由 Kiosk 端 fail-closed 展示，这里不重复拦。 */
export const UNAVAILABLE_PRINTER_STATUSES = new Set(['offline', 'error', 'paper_empty'])

export function printerOnlineRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['PRINT_REQUIRE_PRINTER_ONLINE'] === 'true'
}

export type PrinterAvailability =
  | { available: true; printerStatus: string | null; lastSeenAt: Date }
  | { available: false; reason: 'no_heartbeat' | 'stale_heartbeat' | 'printer_unavailable'; printerStatus: string | null; lastSeenAt: Date | null }

export async function readPrinterAvailability(
  prisma: PrismaService,
  terminalId: string,
  now: Date = new Date(),
): Promise<PrinterAvailability> {
  const latest = await prisma.terminalHeartbeat.findFirst({
    where: { terminalId },
    orderBy: { createdAt: 'desc' },
    select: { printerStatus: true, createdAt: true },
  })
  if (!latest) return { available: false, reason: 'no_heartbeat', printerStatus: null, lastSeenAt: null }
  if (now.getTime() - latest.createdAt.getTime() > PRINTER_ONLINE_WINDOW_MS) {
    return { available: false, reason: 'stale_heartbeat', printerStatus: latest.printerStatus, lastSeenAt: latest.createdAt }
  }
  if (latest.printerStatus && UNAVAILABLE_PRINTER_STATUSES.has(latest.printerStatus)) {
    return { available: false, reason: 'printer_unavailable', printerStatus: latest.printerStatus, lastSeenAt: latest.createdAt }
  }
  return { available: true, printerStatus: latest.printerStatus, lastSeenAt: latest.createdAt }
}

/**
 * 打印机不可用时抛 400 PRINTER_UNAVAILABLE。文案面向一体机用户（会被前端直接展示），
 * 不透出心跳时间戳或内部状态串。
 */
export async function assertTerminalPrinterAvailable(
  prisma: PrismaService,
  terminalId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!printerOnlineRequired(env)) return
  const availability = await readPrinterAvailability(prisma, terminalId)
  if (availability.available) return
  const message =
    availability.reason === 'printer_unavailable'
      ? '本机打印机当前不可用（离线、缺纸或故障），暂不能下单，请联系工作人员'
      : '本机打印服务暂未就绪，暂不能下单，请稍后再试或联系工作人员'
  throw new BadRequestException({
    error: { code: 'PRINTER_UNAVAILABLE', message },
  })
}
