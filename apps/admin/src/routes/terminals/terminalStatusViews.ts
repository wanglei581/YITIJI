// 设备管理「终端 / 打印机 / 外设」三个页签共用的状态词表。
// 只在这里维护一份，页面不另起词表。

import type { AdminTerminalRecord } from '../../services/api/devices'

export type BadgeTone = 'success' | 'error' | 'warning' | 'default'

// ─── 扫描输入闸门（Agent fail-closed 状态，只读）────────────────────────────
//
// Agent 在目录身份变化 / 读取失败 / watcher 异常时会把扫描输入锁死，并且**进程内不可逆**
// ——只有重启 Agent 才恢复。这道闸门保护的是「上一位的扫描件不会投给下一位」，
// 所以后台只呈现，不提供任何远程解除入口（远程放宽 = 把隐私闸门交给网络）。
//
// 原因码来自服务端白名单枚举 SCAN_INPUT_REASONS（heartbeat.dto.ts），不是自由文本；
// 查不到的码原样显示，既不猜也不拼接任意载荷。

export const SCAN_INPUT_REASON_LABELS: Readonly<Record<string, string>> = {
  not_configured: '未配置扫描目录',
  reparse_point_unverifiable: '目录重解析点无法核验',
  reparse_point: '目录是重解析点',
  not_directory: '目标不是目录',
  unavailable: '目录不可用',
  not_readable: '目录不可读',
  watcher_rebuild: '监听器重建',
  watcher_error: '监听器异常',
  identity_unavailable: '目录身份取不到',
  root_identity_changed: '目录身份已变化',
  readdir_failed: '目录读取失败',
  watcher_ready_failed: '监听器启动失败',
  startup_backlog_failed: '启动积压处理失败',
  startup_incomplete: '启动检查未完成',
  unknown: '未知原因',
}

type ScanInputFields = Pick<AdminTerminalRecord, 'scanInputHealth' | 'scanInputAction' | 'scanInputReason'>

export function scanInputView(t: ScanInputFields) {
  const health = t.scanInputHealth ?? null
  // 四个字段同生同死：一个都没有 = 这台 Agent 还没上报这一组（旧版本 / mock）。
  // 必须说「未上报」——把没测到说成正常，正是这条遥测要防的事。
  if (!health) return { badge: 'default' as const, label: '未上报', detail: null, restart: false }
  if (health === 'locked_out') {
    const reason = t.scanInputReason
      ? SCAN_INPUT_REASON_LABELS[t.scanInputReason] ?? t.scanInputReason
      : '原因未上报'
    return {
      badge: 'error' as const,
      label: '已锁死',
      detail: reason,
      // 服务端强制 locked_out ⇒ action=restart_required，这里仍按上报值判，不替它断言。
      restart: t.scanInputAction === 'restart_required',
    }
  }
  if (health === 'healthy') return { badge: 'success' as const, label: '正常', detail: null, restart: false }
  return { badge: 'warning' as const, label: '未知', detail: null, restart: false }
}

// ─── 打印机状态 ──────────────────────────────────────────────────────────────
//
// Agent 真实上报：ready / offline / error / low_paper / unknown（apps/terminal-agent/src/agent/types.ts）。
// ok / idle 是历史心跳的正常值；paper_empty / not_found 是早期约定，保留识别兼容存量心跳。
// 认不出的原值显示「未知状态」并按需处理对待，绝不当成正常。

const PRINTER_STATUS_MAP: Readonly<Record<string, { badge: BadgeTone; label: string }>> = {
  ok:          { badge: 'success', label: '正常' },
  ready:       { badge: 'success', label: '正常' },
  idle:        { badge: 'success', label: '正常' },
  low_paper:   { badge: 'warning', label: '纸张不足' },
  offline:     { badge: 'error',   label: '离线' },
  paper_empty: { badge: 'warning', label: '缺纸' },
  error:       { badge: 'error',   label: '故障' },
  not_found:   { badge: 'warning', label: '未检测到' },
  unknown:     { badge: 'default', label: '驱动未返回状态' },
}

export function printerStatusView(status: string | null): { badge: BadgeTone; label: string } {
  if (!status) return { badge: 'default', label: '未上报' }
  return PRINTER_STATUS_MAP[status] ?? { badge: 'warning', label: '未知状态' }
}

// ─── 磁盘 ────────────────────────────────────────────────────────────────────

/** 服务端已把 Agent 取不到磁盘时的 -1 归为 null；null 一律显示「未知」。 */
export function fmtDisk(gb: number | null | undefined): string {
  if (gb === null || gb === undefined || !Number.isFinite(gb) || gb < 0) return '未知'
  return `${gb.toFixed(1)} GB`
}
