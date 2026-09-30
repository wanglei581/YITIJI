// 建单 / 报价前的打印机可用性门禁（PRT-03）。
//
// 背景：一体机只有「上传 → 预览」这条路在预览页拦打印机离线；我的文档、简历产物、
// 招聘会资料等 19 个入口直达 /print/confirm，服务端 create / quote 又只查能力登记与
// lifecycle，不看心跳。结果是打印机离线也能建单收款，钱收了纸不出，只能人工退款。
//
// 口径：
//   - 最近一条心跳超过 PRINTER_ONLINE_WINDOW_MS（5 分钟，与 Admin 终端列表 /
//     派生告警同窗口）或从未上报 → 视为离线。
//   - 心跳的 printerStatus 落在 UNAVAILABLE_PRINTER_STATUSES → 视为不可用。
//   - offline / error / paper_empty 只在 PRINT_REQUIRE_PRINTER_ONLINE=true 时拦截。
//     生产启动门禁要求它必须为 true（见 production-runtime-gates.ts）。
//     默认关闭是为了让本地与 CI 的隔离夹具（没有 Agent 心跳）继续跑，不是为了
//     给生产留旁路。
//   - queue_cleanup_failed / queue_pause_failed 不看这个开关。Agent 已经停领打印单，
//     开关关掉也要拦报价和建单，否则一体机和小程序仍会下单付款，单子挂着打不出来。
import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'

/** 心跳上报窗口为五分钟；所有终端读取点共用，避免前后台状态分裂。 */
export const TERMINAL_ONLINE_WINDOW_MS = 5 * 60 * 1000
export const PRINTER_ONLINE_WINDOW_MS = TERMINAL_ONLINE_WINDOW_MS

/** Agent 心跳 printerStatus 里，明确不能出纸的取值。unknown 不在其中：
 *  驱动查询失败或未配置时是 unknown，由 Kiosk 端 fail-closed 展示，这里不重复拦。 */
export const UNAVAILABLE_PRINTER_STATUSES = new Set(['offline', 'error', 'paper_empty', 'queue_cleanup_failed', 'queue_pause_failed'])

/** Agent 已确定停领打印单。这两个值不看 PRINT_REQUIRE_PRINTER_ONLINE。 */
export const QUEUE_DISPATCH_HALTED_STATUSES = new Set(['queue_cleanup_failed', 'queue_pause_failed'])

/** 不说「本机」：小程序里会被读成用户自己的手机。 */
export const QUEUE_DISPATCH_HALTED_MESSAGE = '这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端'

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

function isQueueDispatchHalted(availability: PrinterAvailability): boolean {
  return !availability.available
    && availability.reason === 'printer_unavailable'
    && availability.printerStatus !== null
    && QUEUE_DISPATCH_HALTED_STATUSES.has(availability.printerStatus)
}

/**
 * 取件场景的拒绝原话。到机单绑定这台终端，「换一台终端」对取件人是错的；
 * 到机码入口说码没作废，会员「在这台机器领取」入口手里没有码，只说订单没受影响。
 */
const PICKUP_SCENE_MESSAGES: Partial<Record<'order' | 'pickup' | 'claim_here', { halted: string; unavailable: string }>> = {
  pickup: {
    halted: '这台终端暂停接打印单，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员',
    unavailable: '这台终端的打印机暂不可用，你的到机码没有作废，请稍后再来这台终端输码，或找现场工作人员',
  },
  claim_here: {
    halted: '这台终端暂停接打印单，你的订单没有受影响，请稍后再在这台终端领取，或找现场工作人员',
    unavailable: '这台终端的打印机暂不可用，你的订单没有受影响，请稍后再在这台终端领取，或找现场工作人员',
  },
}

/**
 * 队列闸门抛 400 PRINT_TERMINAL_QUEUE_HALTED。
 * 其余不可用状态在开关打开时抛 400 PRINTER_UNAVAILABLE，两句旧文案一个字不改。
 * 不透出心跳时间戳或内部状态串。
 */
export async function assertTerminalPrinterAvailable(
  prisma: PrismaService,
  terminalId: string,
  env: NodeJS.ProcessEnv = process.env,
  scene: 'order' | 'pickup' | 'claim_here' = 'order',
): Promise<void> {
  const availability = await readPrinterAvailability(prisma, terminalId)
  // 先看闸门，再看开关。这两个状态表示 Agent 已经停领，不能被开关放行。
  if (isQueueDispatchHalted(availability)) {
    throw new BadRequestException({
      error: { code: 'PRINT_TERMINAL_QUEUE_HALTED', message: PICKUP_SCENE_MESSAGES[scene]?.halted ?? QUEUE_DISPATCH_HALTED_MESSAGE },
    })
  }
  if (!printerOnlineRequired(env)) return
  if (availability.available) return
  const message =
    availability.reason === 'printer_unavailable'
      ? '本机打印机当前不可用（离线、缺纸或故障），暂不能下单，请联系工作人员'
      : '本机打印服务暂未就绪，暂不能下单，请稍后再试或联系工作人员'
  throw new BadRequestException({
    error: { code: 'PRINTER_UNAVAILABLE', message: PICKUP_SCENE_MESSAGES[scene]?.unavailable ?? message },
  })
}
