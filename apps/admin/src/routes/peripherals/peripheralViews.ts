// 外设页「按外设看」的状态推导。数据只来自 GET /admin/terminals 的心跳字段，
// 词表复用终端页（terminalStatusViews.ts），这里只补原因与处置建议。

import type { AdminTerminalRecord } from '../../services/api/devices'
import { fmtDisk, printerStatusView, scanInputView, type BadgeTone } from '../terminals/terminalStatusViews'

/** 磁盘低于它就提示清理（扫描缓存与日志都落在本机）。 */
export const LOW_DISK_GB = 5

export interface PeripheralItem {
  key: 'printer' | 'scan' | 'network' | 'local' | 'agent'
  name: string
  badge: BadgeTone
  label: string
  reason: string | null
  observedAt: string | null
  advice: string | null
}

const PRINTER_ADVICE: Readonly<Record<string, string>> = {
  offline: '检查打印机电源、网线或 USB 线，确认驱动里的打印机名称与终端配置一致。',
  error: '到现场看打印机面板报错（卡纸、缺粉、盖板未关），处理后重新上电。',
  low_paper: '可打印，补充 A4 纸。',
  paper_empty: '补充 A4 纸。',
  not_found: '确认打印机驱动已安装，终端配置里的打印机名称与驱动一致。',
  unknown: '驱动没有返回状态；持续出现时重启终端程序（Terminal Agent）或检查打印机驱动。',
  queue_cleanup_failed: '请到机器前看打印机和 Windows 打印队列，恢复后会自动解除。',
  queue_pause_failed: '请到机器前看打印机和 Windows 打印队列，恢复后会自动解除。',
}

/** 终端离线时，除 Agent 一项外都给这句：离线前的上报不代表现状，先恢复连接再看。 */
export const OFFLINE_ITEM_ADVICE = '终端已离线，先恢复终端连接（见终端程序一项），再看此项。'

const WIRED_TEXT: Readonly<Record<string, string>> = { connected: '已连接', disconnected: '未连接', unknown: '未知' }
const PRINTER_LINK_TEXT: Readonly<Record<string, string>> = {
  reachable: '可达',
  unreachable: '不可达',
  not_network_printer: 'USB 连接（无网络链路）',
  unknown: '未知',
}

function reportedText(value: string | null | undefined, words: Readonly<Record<string, string>>): string {
  if (value === null || value === undefined) return '未上报'
  return words[value] ?? `无法识别（${value}）`
}

/**
 * 有线网络与打印机链路。只有「网线已连接」且「打印机可达或走 USB」才算正常；
 * Agent 报 unknown 显示「未知」，旧 Agent 不上报（null）显示「未上报」，都用中性色，不当成正常。
 */
export function networkView(t: AdminTerminalRecord): { badge: BadgeTone; label: string; reason: string | null; advice: string | null } {
  if (!t.online) return { badge: 'default', label: '未知', reason: null, advice: OFFLINE_ITEM_ADVICE }
  if (t.wiredNetworkStatus === 'disconnected') {
    return { badge: 'error', label: '有断开', reason: '一体机网线未连', advice: '检查一体机网线与交换机端口。' }
  }
  if (t.printerNetworkStatus === 'unreachable') {
    return { badge: 'error', label: '有断开', reason: '一体机连不上打印机', advice: '检查打印机网线与地址，确认与一体机在同一网段。' }
  }
  const wiredOk = t.wiredNetworkStatus === 'connected'
  const printerOk = t.printerNetworkStatus === 'reachable' || t.printerNetworkStatus === 'not_network_printer'
  if (wiredOk && printerOk) {
    return {
      badge: 'success',
      label: '正常',
      reason: t.printerNetworkStatus === 'not_network_printer' ? '打印机走 USB，无网络链路' : null,
      advice: null,
    }
  }
  const neverReported = (t.wiredNetworkStatus ?? null) === null && (t.printerNetworkStatus ?? null) === null
  return {
    badge: 'default',
    label: neverReported ? '未上报' : '未知',
    reason: `网线：${reportedText(t.wiredNetworkStatus, WIRED_TEXT)}；打印机链路：${reportedText(t.printerNetworkStatus, PRINTER_LINK_TEXT)}`,
    advice: neverReported
      ? '这台终端程序没有上报网络状态，确认终端程序版本。'
      : '网络状态未能判定；持续出现时到现场核对网线与打印机连接。',
  }
}

export function isOfflineTerminal(t: AdminTerminalRecord): boolean {
  return !t.online
}

export function hasPrinterIssue(t: AdminTerminalRecord): boolean {
  if (!t.online) return false
  const badge = printerStatusView(t.printerStatus ?? null).badge
  return badge === 'error' || badge === 'warning'
}

export function hasScanIssue(t: AdminTerminalRecord): boolean {
  return t.online && scanInputView(t).badge === 'error'
}

export function hasNetworkIssue(t: AdminTerminalRecord): boolean {
  return t.online && (t.wiredNetworkStatus === 'disconnected' || t.printerNetworkStatus === 'unreachable')
}

export function hasLocalIssue(t: AdminTerminalRecord): boolean {
  return t.online && (t.localTaskDatabaseAvailable === false || (t.diskFreeGb !== null && t.diskFreeGb < LOW_DISK_GB))
}

export function hasAnyIssue(t: AdminTerminalRecord): boolean {
  return isOfflineTerminal(t) || hasPrinterIssue(t) || hasScanIssue(t) || hasNetworkIssue(t) || hasLocalIssue(t)
}

function localDbView(t: AdminTerminalRecord): { badge: BadgeTone; label: string } {
  if (t.localTaskDatabaseAvailable === true) return { badge: 'success', label: '本地任务库正常' }
  if (t.localTaskDatabaseAvailable === false) return { badge: 'error', label: '本地任务库不可用' }
  return { badge: 'default', label: '本地任务库未上报' }
}

/** 抽屉里逐项列出；终端离线时每项都写明是「离线前最后一次上报」，不当成现状。 */
export function peripheralItems(t: AdminTerminalRecord): PeripheralItem[] {
  const stale = t.online ? null : '终端已离线，以下为离线前最后一次上报，不代表现状。'
  const heartbeatAt = t.lastHeartbeatAt ?? null
  const printer = printerStatusView(t.printerStatus ?? null)
  const scan = scanInputView(t)
  const db = localDbView(t)
  const lowDisk = t.diskFreeGb !== null && t.diskFreeGb < LOW_DISK_GB
  const network = networkView(t)

  const items: PeripheralItem[] = [
    {
      key: 'printer',
      name: '打印机',
      badge: t.online ? printer.badge : 'default',
      label: printer.label,
      reason: stale ?? (t.printerStatus && !(t.printerStatus in PRINTER_ADVICE) && printer.badge !== 'success'
        ? `终端程序上报了无法识别的状态「${t.printerStatus}」`
        : null),
      observedAt: heartbeatAt,
      advice: !t.online
        ? OFFLINE_ITEM_ADVICE
        : printer.badge !== 'success'
          ? PRINTER_ADVICE[t.printerStatus ?? ''] ?? (t.printerStatus ? '状态无法识别，请到现场核对打印机面板。' : '这台终端程序没有上报打印机状态，确认终端程序版本。')
          : null,
    },
    {
      key: 'scan',
      name: '面板扫描到本机目录',
      badge: t.online ? scan.badge : 'default',
      label: scan.label,
      reason: stale ?? scan.detail,
      observedAt: t.scanInputObservedAt ?? heartbeatAt,
      advice: !t.online
        ? OFFLINE_ITEM_ADVICE
        : scan.badge === 'error'
          ? `${scan.restart ? '需重启终端程序（Terminal Agent）恢复，可在终端详情「远程操作」里远程重启；' : ''}先核对扫描目录配置与共享权限。`
          : null,
    },
    {
      key: 'network',
      name: '有线网络与打印机链路',
      badge: network.badge,
      label: network.label,
      reason: stale ?? network.reason,
      observedAt: heartbeatAt,
      advice: network.advice,
    },
    {
      key: 'local',
      name: '本地任务库与磁盘',
      badge: !t.online ? 'default' : db.badge === 'error' || lowDisk ? 'error' : db.badge,
      label: `${db.label} · 磁盘可用 ${fmtDisk(t.diskFreeGb)}`,
      reason: stale ?? (t.localTaskDatabaseAvailable === false
        ? '本地任务库不可用，已暂停领取打印任务'
        : lowDisk ? `磁盘可用空间低于 ${LOW_DISK_GB} GB` : null),
      observedAt: heartbeatAt,
      advice: !t.online
        ? OFFLINE_ITEM_ADVICE
        : t.localTaskDatabaseAvailable === false
          ? '到现场重启终端程序（Terminal Agent）；仍不可用请联系研发排查本地库文件。'
          : lowDisk ? '清理本机扫描缓存与日志。' : null,
    },
    {
      key: 'agent',
      name: '终端程序',
      badge: t.online ? 'success' : 'error',
      label: t.online ? `在线 · ${t.agentVersion ?? '版本未上报'}` : t.lastHeartbeatAt ? '离线' : '从未上报',
      reason: t.online ? null : t.lastHeartbeatAt ? '超过 5 分钟没有心跳' : '这台终端还没有上报过心跳',
      observedAt: heartbeatAt,
      advice: t.online ? null : '检查一体机电源、网络，以及终端程序（Terminal Agent）服务是否在运行。',
    },
  ]
  return items
}

export const UNREPORTED_PERIPHERALS = ['U 盘', '扫码枪', '摄像头', '读卡器'] as const
