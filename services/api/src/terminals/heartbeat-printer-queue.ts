/** 心跳打印队列五列。缺省写 null：老终端程序不带这些字段也照常落库。 */

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
