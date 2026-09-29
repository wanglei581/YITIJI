/**
 * 把 Win32_Printer 的一行读数映射成心跳状态和打印前预检。
 *
 * 前三列与旧探针兼容：PrinterStatus,DetectedErrorState,WorkOffline。
 * 后两列可选：PrinterState,ExtendedPrinterStatus。没有后两列时，行为与加暂停之前一致。
 *
 * 空闲暂停会让队列停住。若因此 PrinterStatus 离开 3/4/5，旧映射会报 unknown，
 * 一体机就显示「状态未知」并不再接单。所以「暂停、且没有故障位」视为就绪。
 * 粉量低是耗材预警，不拦截：暂停且只有 TONER_LOW 仍报就绪。
 * 有 PrinterState / ExtendedPrinterStatus 时，先看离线、缺纸、卡纸、缺粉、开盖，
 * 再看 DetectedErrorState=2「无错误」，避免被「无错误」盖掉。
 * 没有这两列时，行为与加扩展字段之前一致。
 */

import type { PrinterStatus } from './types'

export type PrinterPreflight = 'ok' | 'not_found' | 'offline' | 'paper_empty' | 'error' | 'unknown'

const PAUSE_BIT = 0x1
const ERROR_BIT = 0x2
const PAPER_JAM_BIT = 0x8
const PAPER_OUT_BIT = 0x10
const PAPER_PROBLEM_BIT = 0x40
const OFFLINE_BIT = 0x80
const NOT_AVAILABLE_BIT = 0x1000
const TONER_LOW_BIT = 0x20000
const NO_TONER_BIT = 0x40000
const USER_INTERVENTION_BIT = 0x100000
const OUT_OF_MEMORY_BIT = 0x200000
const DOOR_OPEN_BIT = 0x400000

const PAPER_FAULT_BITS = PAPER_OUT_BIT | PAPER_PROBLEM_BIT
const ERROR_FAULT_BITS =
  ERROR_BIT |
  PAPER_JAM_BIT |
  NOT_AVAILABLE_BIT |
  NO_TONER_BIT |
  USER_INTERVENTION_BIT |
  OUT_OF_MEMORY_BIT |
  DOOR_OPEN_BIT
const READY_WHILE_PAUSED_BITS = PAUSE_BIT | TONER_LOW_BIT

interface ParsedPrinterLine {
  printerStatusCode: number
  detectedError: number
  workOffline: boolean
  printerState: number | null
  extendedStatus: number | null
}

function parseOptionalInt(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const value = parseInt(raw, 10)
  return Number.isNaN(value) ? Number.NaN : value
}

function parseWin32PrinterLine(output: string): ParsedPrinterLine | null {
  const parts = output.split(',')
  if (parts.length < 3) return null
  const printerStatusCode = parseInt(parts[0] ?? '', 10)
  const detectedError = parseInt(parts[1] ?? '', 10)
  if (Number.isNaN(printerStatusCode) || Number.isNaN(detectedError)) return null
  const printerState = parseOptionalInt(parts[3])
  const extendedStatus = parseOptionalInt(parts[4])
  if (Number.isNaN(printerState) || Number.isNaN(extendedStatus)) return null
  return {
    printerStatusCode,
    detectedError,
    workOffline: parts[2] === 'True',
    printerState,
    extendedStatus,
  }
}

function extraFieldsPresent(line: ParsedPrinterLine): boolean {
  return line.printerState !== null || line.extendedStatus !== null
}

function faultFromExtended(line: ParsedPrinterLine): PrinterStatus | null {
  if (!extraFieldsPresent(line)) return null
  const state = line.printerState
  const extended = line.extendedStatus
  if ((state !== null && (state & OFFLINE_BIT) !== 0) || extended === 7) return 'offline'
  if (state !== null && (state & PAPER_FAULT_BITS) !== 0) return 'paper_empty'
  if ((state !== null && (state & ERROR_FAULT_BITS) !== 0) || extended === 9 || extended === 11) {
    return 'error'
  }
  return null
}

function heartbeatFromParsed(line: ParsedPrinterLine): PrinterStatus {
  if (line.workOffline) return 'offline'
  if (line.printerStatusCode === 7 || line.detectedError === 9) return 'offline'
  if (line.detectedError === 4) return 'paper_empty'
  if (line.detectedError === 6 || line.detectedError === 7 || line.detectedError === 8) return 'error'
  if (line.detectedError === 3 || line.detectedError === 5) return 'low_paper'

  // DetectedErrorState=2 是「无错误」。有扩展字段时先看故障位，没有则直接就绪。
  if (line.detectedError === 2) {
    const masked = faultFromExtended(line)
    if (masked) return masked
    return 'ready'
  }

  const extendedFault = faultFromExtended(line)
  if (extendedFault) return extendedFault

  if (
    line.detectedError === 0 &&
    (line.printerStatusCode === 3 || line.printerStatusCode === 4 || line.printerStatusCode === 5)
  ) {
    return 'ready'
  }

  // PrinterStatus 已经不是 3/4/5，DetectedErrorState 仍是 0。
  // 暂停且没有故障位就报就绪。粉量低不算故障，不能因此变成 unknown。
  if (line.detectedError === 0 && extraFieldsPresent(line)) {
    const state = line.printerState
    const pauseSignal = line.extendedStatus === 8 || (state !== null && (state & PAUSE_BIT) !== 0)
    const leftover = state === null ? 0 : state & ~READY_WHILE_PAUSED_BITS
    const leftoverFault = (leftover & (OFFLINE_BIT | PAPER_FAULT_BITS | ERROR_FAULT_BITS)) !== 0
    if (pauseSignal && !leftoverFault) return 'ready'
  }

  return 'unknown'
}

export function mapWin32PrinterQuery(output: string | null): PrinterStatus {
  if (!output) return 'unknown'
  if (output === 'not_found') return 'error'
  const parsed = parseWin32PrinterLine(output)
  if (!parsed) return 'unknown'
  return heartbeatFromParsed(parsed)
}

export function mapWin32PrinterPreflight(output: string | null): PrinterPreflight {
  if (!output) return 'unknown'
  if (output === 'not_found') return 'not_found'
  const parsed = parseWin32PrinterLine(output)
  if (!parsed) return 'unknown'
  const heartbeat = heartbeatFromParsed(parsed)
  if (heartbeat === 'offline' || heartbeat === 'paper_empty' || heartbeat === 'error') return heartbeat
  return 'ok'
}
