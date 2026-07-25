/**
 * useTerminalDeviceStatus — Kiosk 终端/打印机状态（P0-2 去伪）
 *
 * 数据源：公开只读 `GET /terminals/:terminalId/printer-status`
 * （含后端已算好的 isOnline：5 分钟心跳窗）。禁止为此调用 Admin 终端列表或告警接口。
 *
 * 硬约束（CLAUDE.md §9 不伪造能力）：
 * - 只有 isOnline===true 且 printerStatus 为 ready（含历史别名 ok/idle）才显示「打印机在线」
 * - null / unknown / 心跳过期 / 请求失败 / 未配置终端 → 「状态未知」或「离线」，绝不 default 成在线+耗材 100%
 * - Agent 当前不上报耗材；tonerKnown=false，禁止用假数值触发「墨粉不足」
 * - 「网络正常」只表示本机能连上 API（本次请求成功），不表示打印机侧网络
 */
import { useEffect, useState } from 'react'
import type { DeviceStatus, PrinterStatus } from '@ai-job-print/shared'
import { API_BASE_URL } from '../services/api/client'
import { getTerminalId } from '../services/api/screensaver'

const ZERO_TONER = { black: 0, cyan: 0, magenta: 0, yellow: 0 } as const

export type TerminalPrinterKind = 'ready' | 'offline' | 'error' | 'low_paper' | 'unknown'

export interface TerminalDeviceStatusView {
  loading: boolean
  /** 本机请求 API 成功（与打印机侧网络无关）。 */
  apiReachable: boolean
  /** 后端心跳窗判定：最近 5 分钟有心跳。 */
  heartbeatOnline: boolean
  /** 可安全展示绿色「打印机在线」并放行打印确认。 */
  printerReady: boolean
  kind: TerminalPrinterKind
  /** 供 PrintPreview 告警/门控；未知态 isOnline=false（fail-closed）。 */
  printer: PrinterStatus
  /** Agent 未上报耗材时恒为 false。 */
  tonerKnown: boolean
  printerName: string
  /** 顶栏/徽标文案（中文）。 */
  printerLabel: string
  networkLabel: string
  /** 兼容旧 DeviceStatus 联合；展示请用 printerLabel。 */
  deviceStatus: DeviceStatus
}

interface PrinterStatusApiBody {
  isOnline?: boolean
  printerStatus?: string | null
  lastSeenAt?: string | null
  data?: {
    isOnline?: boolean
    printerStatus?: string | null
    lastSeenAt?: string | null
  }
}

const REFRESH_MS = 60_000

function printerNameFromEnv(): string {
  return (import.meta.env['VITE_PRINTER_NAME'] ?? '').trim() || '已配置打印机'
}

/** 归一化 Agent / 历史别名；未知原样返回小写串。 */
export function normalizePrinterStatusRaw(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const value = raw.trim().toLowerCase()
  if (!value) return null
  if (value === 'ok' || value === 'idle') return 'ready'
  if (value === 'paper_empty') return 'paper_empty'
  return value
}

/**
 * 纯函数：把后端 isOnline + printerStatus 映射为诚实 UI 状态。
 * 供 hook 与静态守卫共用；default 分支不得返回 isOnline:true。
 */
export function mapTerminalPrinterStatus(input: {
  heartbeatOnline: boolean
  printerStatus: string | null | undefined
}): Pick<TerminalDeviceStatusView, 'kind' | 'printerReady' | 'printer' | 'printerLabel' | 'deviceStatus'> {
  if (!input.heartbeatOnline) {
    return {
      kind: 'offline',
      printerReady: false,
      printer: { isOnline: false, hasPaper: true, tonerLevels: { ...ZERO_TONER }, errorCode: 'offline' },
      printerLabel: '打印机离线',
      deviceStatus: 'offline',
    }
  }

  const raw = normalizePrinterStatusRaw(input.printerStatus)
  switch (raw) {
    case 'ready':
      return {
        kind: 'ready',
        printerReady: true,
        // 耗材未上报：toner 置 0 且由 tonerKnown=false 禁止低墨告警，避免谎报 100%。
        printer: { isOnline: true, hasPaper: true, tonerLevels: { ...ZERO_TONER } },
        printerLabel: '打印机在线',
        deviceStatus: 'online',
      }
    case 'low_paper':
      return {
        kind: 'low_paper',
        printerReady: true,
        printer: {
          isOnline: true,
          hasPaper: true,
          tonerLevels: { ...ZERO_TONER },
          errorCode: 'lowPaper',
        },
        printerLabel: '打印机在线',
        deviceStatus: 'online',
      }
    case 'paper_empty':
      return {
        kind: 'error',
        printerReady: false,
        printer: {
          isOnline: true,
          hasPaper: false,
          tonerLevels: { ...ZERO_TONER },
          errorCode: 'paperEmpty',
        },
        printerLabel: '打印机缺纸',
        deviceStatus: 'error',
      }
    case 'error':
      return {
        kind: 'error',
        printerReady: false,
        printer: {
          isOnline: true,
          hasPaper: false,
          tonerLevels: { ...ZERO_TONER },
          errorCode: 'hardwareError',
        },
        printerLabel: '打印机异常',
        deviceStatus: 'error',
      }
    case 'offline':
      return {
        kind: 'offline',
        printerReady: false,
        printer: { isOnline: false, hasPaper: true, tonerLevels: { ...ZERO_TONER }, errorCode: 'offline' },
        printerLabel: '打印机离线',
        deviceStatus: 'offline',
      }
    default:
      // null / unknown / 未识别取值 → 状态未知（fail-closed，绝不 default 成在线）
      return {
        kind: 'unknown',
        printerReady: false,
        printer: {
          isOnline: false,
          hasPaper: true,
          tonerLevels: { ...ZERO_TONER },
          errorCode: 'statusUnknown',
        },
        printerLabel: '状态未知',
        deviceStatus: 'offline',
      }
  }
}

function unknownView(partial: Partial<TerminalDeviceStatusView> = {}): TerminalDeviceStatusView {
  const mapped = mapTerminalPrinterStatus({ heartbeatOnline: false, printerStatus: null })
  return {
    loading: false,
    apiReachable: false,
    heartbeatOnline: false,
    tonerKnown: false,
    printerName: printerNameFromEnv(),
    networkLabel: '网络异常',
    ...mapped,
    printerLabel: partial.printerLabel ?? '状态未知',
    ...partial,
    kind: partial.kind ?? 'unknown',
    printerReady: false,
  }
}

export function useTerminalDeviceStatus(): TerminalDeviceStatusView {
  const terminalId = getTerminalId()
  const [view, setView] = useState<TerminalDeviceStatusView>(() =>
    terminalId
      ? {
          loading: true,
          apiReachable: false,
          heartbeatOnline: false,
          printerReady: false,
          kind: 'unknown',
          printer: {
            isOnline: false,
            hasPaper: true,
            tonerLevels: { ...ZERO_TONER },
            errorCode: 'statusUnknown',
          },
          tonerKnown: false,
          printerName: printerNameFromEnv(),
          printerLabel: '设备检查中',
          networkLabel: '检测中',
          deviceStatus: 'offline',
        }
      : unknownView({
          loading: false,
          printerLabel: '状态未知',
          networkLabel: '未配置终端',
        }),
  )

  useEffect(() => {
    if (!terminalId) {
      setView(
        unknownView({
          loading: false,
          printerLabel: '状态未知',
          networkLabel: '未配置终端',
        }),
      )
      return
    }

    let cancelled = false
    const ac = new AbortController()

    const load = async (): Promise<void> => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/printer-status`,
          { signal: ac.signal },
        )
        if (cancelled) return
        if (!res.ok) {
          setView(
            unknownView({
              loading: false,
              apiReachable: res.status < 500,
              printerLabel: '状态未知',
              networkLabel: res.status >= 500 ? '网络异常' : '状态未知',
            }),
          )
          return
        }
        const body = (await res.json()) as PrinterStatusApiBody
        const payload = body.data ?? body
        const mapped = mapTerminalPrinterStatus({
          heartbeatOnline: Boolean(payload.isOnline),
          printerStatus: payload.printerStatus,
        })
        if (cancelled) return
        setView({
          loading: false,
          apiReachable: true,
          heartbeatOnline: Boolean(payload.isOnline),
          tonerKnown: false,
          printerName: printerNameFromEnv(),
          networkLabel: '网络正常',
          ...mapped,
        })
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return
        if (cancelled) return
        setView(
          unknownView({
            loading: false,
            apiReachable: false,
            printerLabel: '状态未知',
            networkLabel: '网络异常',
          }),
        )
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, REFRESH_MS)

    return () => {
      cancelled = true
      ac.abort()
      window.clearInterval(timer)
    }
  }, [terminalId])

  return view
}
