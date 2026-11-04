/** 心跳打印队列五列。缺省写 null：老终端程序不带这些字段也照常落库。 */

/**
 * 打印队列名。和终端程序同一条规则，改一边要改两边。
 * 长度按 JavaScript 字符串长度（UTF-16 码元）计，正则不带 u 标志，和终端程序 name.length 一致。
 * 控制字符含 C0（U+0000–U+001F）与 C1（U+007F–U+009F）。
 * 不像地址：以 \\ 开头（UNC）、含 ://、或含 IPv4 形四段数字，三者任一命中就拒绝。
 */
// eslint-disable-next-line no-control-regex -- 刻意拒绝队列名里的控制字符，含 C1
const PRINTER_QUEUE_NAME_PATTERN = /^[^\u0000-\u001f\u007f-\u009f]{1,128}$/
const PRINTER_QUEUE_IPV4_PATTERN = /(^|[^0-9])\d{1,3}(\.\d{1,3}){3}([^0-9]|$)/

export function isAcceptablePrinterQueueName(name: string): boolean {
  if (!PRINTER_QUEUE_NAME_PATTERN.test(name)) return false
  if (name.startsWith('\\\\')) return false
  if (name.includes('://')) return false
  if (PRINTER_QUEUE_IPV4_PATTERN.test(name)) return false
  return true
}

export interface PrinterQueueHeartbeatInput {
  printerQueueName?: string
  printerQueuePortKind?: string
  printerQueuePortName?: string
  printerQueueRawStatus?: string
  printerQueueSpooler?: string
}

export interface PrinterQueueHeartbeatData {
  printerQueueName: string | null
  printerQueuePortKind: string | null
  printerQueuePortName: string | null
  printerQueueRawStatus: string | null
  printerQueueSpooler: string | null
}

export function printerQueueHeartbeatData(dto: PrinterQueueHeartbeatInput): PrinterQueueHeartbeatData {
  return {
    printerQueueName: dto.printerQueueName ?? null,
    printerQueuePortKind: dto.printerQueuePortKind ?? null,
    printerQueuePortName: dto.printerQueuePortName ?? null,
    printerQueueRawStatus: dto.printerQueueRawStatus ?? null,
    printerQueueSpooler: dto.printerQueueSpooler ?? null,
  }
}

export const PRINTER_QUEUE_HEARTBEAT_SELECT = {
  printerQueueName: true,
  printerQueuePortKind: true,
  printerQueuePortName: true,
  printerQueueRawStatus: true,
  printerQueueSpooler: true,
} as const

export interface AdminPrinterQueueView {
  printerQueueName: string | null
  printerQueuePortKind: string | null
  printerQueuePortName: string | null
  printerQueueRawStatus: string | null
  printerQueueSpooler: string | null
}

/** 五列都空说明老终端程序没上报，与「报了但读不到」分开。 */
export function toAdminPrinterQueue(
  hb: Partial<AdminPrinterQueueView> | null | undefined,
): AdminPrinterQueueView | null {
  if (!hb) return null
  const view: AdminPrinterQueueView = {
    printerQueueName: hb.printerQueueName ?? null,
    printerQueuePortKind: hb.printerQueuePortKind ?? null,
    printerQueuePortName: hb.printerQueuePortName ?? null,
    printerQueueRawStatus: hb.printerQueueRawStatus ?? null,
    printerQueueSpooler: hb.printerQueueSpooler ?? null,
  }
  const values = [
    view.printerQueueName,
    view.printerQueuePortKind,
    view.printerQueuePortName,
    view.printerQueueRawStatus,
    view.printerQueueSpooler,
  ]
  return values.every((value) => value === null || value === '') ? null : view
}
