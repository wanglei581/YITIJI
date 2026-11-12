/**
 * 一体机取件页：本人、本机、还没取的手机单。
 *
 * 文件名打码与 services/api/src/print-jobs/pickup-file-mask.ts 同一算法。
 * 一体机不从后端源码导入。屏上只留打码后的名字，不留原始文件名，也不留到机码。
 */
import { helpNeededLine, preferUnattended, printProblemLine } from '../../copy/unattendedCopy'

/** 核销回执里的文件名：保留首字与扩展名，其余打码。不含正文。 */
export function maskPickupFileName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const baseName = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const dot = baseName.lastIndexOf('.')
  const ext = dot > 0 && dot < baseName.length - 1 ? baseName.slice(dot) : ''
  const stem = ext ? baseName.slice(0, baseName.length - ext.length) : baseName
  const head = Array.from(stem)[0] ?? ''
  if (!head) return `***${ext}`
  return `${head}***${ext}`
}

/** 时间线里用得到的字段。到机码和原始文件名不进这一层的输出。 */
export interface PickupHereSource {
  kind: string
  orderId: string | null
  title: string | null
  itemCount: number
  claimableHere: boolean
  createdAt?: string | null
  billablePages?: number | null
}

export interface PickupHereRow {
  orderId: string
  label: string
  /** 下单时间（北京时间）和内容页数。缺了就不写，不把缺省当成 0。 */
  detail: string | null
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/** 「11月12日 14:20」。用 UTC+8 的日历字段，不依赖运行环境时区。读不到或不是时间就省略。 */
export function formatPickupHereWhen(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || iso.length === 0) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  const hour = String(shifted.getUTCHours()).padStart(2, '0')
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${month}月${day}日 ${hour}:${minute}`
}

/** 有下单时间、有正整数内容页数就拼上。时间线没有独立的面数字段，页数用 billablePages。 */
export function pickupHereDetail(item: { createdAt?: string | null; billablePages?: number | null }): string | null {
  const when = formatPickupHereWhen(item.createdAt)
  const pages = typeof item.billablePages === 'number' && Number.isInteger(item.billablePages) && item.billablePages > 0
    ? `${item.billablePages} 页`
    : null
  const parts = [when, pages].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** 只留手机单件和材料包，并且服务端已经判定能在这台机器领。现场单不进这张表。 */
export function pickupHereRows(items: readonly PickupHereSource[]): PickupHereRow[] {
  const rows: PickupHereRow[] = []
  for (const item of items) {
    if (item.claimableHere !== true) continue
    if (item.kind !== 'cloud_single' && item.kind !== 'package') continue
    if (typeof item.orderId !== 'string' || item.orderId.length === 0) continue
    const label = item.kind === 'package'
      ? (Number.isInteger(item.itemCount) && item.itemCount > 0 ? `材料包 · ${item.itemCount} 个文件` : '材料包')
      : (maskPickupFileName(item.title) ?? '文件')
    rows.push({ orderId: item.orderId, label, detail: pickupHereDetail(item) })
  }
  return rows
}

/**
 * 点单领取被终态拒绝后，这一行不该再挂着「还没取」。
 * 网络失败和打印机暂不可用要留着，否则重试找不到这一单。
 */
export function pickupHereClaimDropsRow(kind: string, code: string | null | undefined): boolean {
  if (kind === 'closed' || kind === 'invalid') return true
  return code === 'PICKUP_TERMINAL_MISMATCH' || code === 'PRINT_ORDER_NOT_FOUND'
}

/** 点单时打印机暂不可用。不说「输码」：人没有输码。 */
export function pickupHereRecoverableLine(code: string | null | undefined): string | null {
  if (code === 'PRINT_TERMINAL_QUEUE_HALTED') {
    return `这台终端暂停接打印单，这单还在，没有作废，请稍后再来这台终端领取。${helpNeededLine()}`
  }
  if (code === 'PRINTER_UNAVAILABLE') {
    return `这台终端的打印机暂不可用，这单还在，没有作废，请稍后再来这台终端领取。${helpNeededLine()}`
  }
  return null
}

/** 点单时网络失败。不说「到机码」。 */
export function pickupHereNetworkLine(): string {
  return `这次领取结果还没确认，请重试。${printProblemLine()}`
}

/** 点领取时服务端说这单不在这台机器。不用「到机码无效」那句，因为人没有输码。 */
export const PICKUP_HERE_OTHER_MACHINE =
  '这笔订单不在这台机器取件，请到下单时选的网点领取'

export function pickupHereMismatchMessage(serverMessage: string): string {
  return preferUnattended(serverMessage.trim(), PICKUP_HERE_OTHER_MACHINE)
}
