import { type MutableRefObject, useEffect, useRef, useState } from 'react'

export type HomeDeviceTone = 'positive' | 'warning' | 'negative' | 'neutral'

export interface HomeDeviceStatusView {
  label: string
  paperLabel: string
  tone: HomeDeviceTone
  networkIssue: boolean
}

interface HomePrinterStatusResponse {
  printerStatus?: unknown
  paperLevel?: unknown
  isOnline?: boolean
}

function isNetworkOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function paperLabelFor(paperLevel: unknown): string {
  switch (paperLevel) {
    case 'sufficient': return 'A4纸充足'
    case 'low': return 'A4纸余量偏低'
    case 'empty': return 'A4纸已用尽'
    default: return 'A4纸状态待检测'
  }
}

function mapPrinterStatus(printerStatus: unknown, paperLevel?: unknown): HomeDeviceStatusView {
  const paperLabel = paperLabelFor(paperLevel)
  switch (printerStatus) {
    case 'ready':
      return { label: '打印机在线', paperLabel, tone: 'positive', networkIssue: false }
    case 'offline':
      return { label: '打印机离线', paperLabel, tone: 'negative', networkIssue: false }
    case 'error':
      return { label: '打印机异常', paperLabel, tone: 'negative', networkIssue: false }
    case 'low_paper':
      return { label: '纸张余量偏低', paperLabel: 'A4纸余量偏低', tone: 'warning', networkIssue: false }
    default:
      return { label: '打印机状态未知', paperLabel, tone: 'neutral', networkIssue: false }
  }
}

function initialDeviceStatus(terminalId: string): HomeDeviceStatusView {
  if (isNetworkOffline()) {
    return { label: '网络异常', paperLabel: '纸张状态待检测', tone: 'negative', networkIssue: true }
  }
  if (!terminalId) {
    return { label: '设备状态未配置', paperLabel: '纸张状态待检测', tone: 'neutral', networkIssue: false }
  }
  return { label: '设备状态检测中', paperLabel: '纸张状态待检测', tone: 'neutral', networkIssue: false }
}

export function useHomeDeviceStatus(enabled = true): HomeDeviceStatusView {
  const terminalId = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
  const [deviceStatus, setDeviceStatus] = useState<HomeDeviceStatusView>(() => initialDeviceStatus(terminalId))
  const abortControllerRef = useRef<AbortController | null>(null)
  const requestGenerationRef: MutableRefObject<number> = useRef(0)

  useEffect(() => {
    if (!enabled) return

    const refreshDeviceStatus = async (showLoading: boolean) => {
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      const generation = ++requestGenerationRef.current
      abortControllerRef.current = controller

      if (navigator.onLine === false) {
        setDeviceStatus({ label: '网络异常', paperLabel: '纸张状态待检测', tone: 'negative', networkIssue: true })
        return
      }
      if (!terminalId) {
        setDeviceStatus({ label: '设备状态未配置', paperLabel: '纸张状态待检测', tone: 'neutral', networkIssue: false })
        return
      }

      if (showLoading) {
        setDeviceStatus({ label: '设备状态检测中', paperLabel: '纸张状态待检测', tone: 'neutral', networkIssue: false })
      }

      try {
        const response = await fetch(`/api/v1/terminals/${terminalId}/printer-status`, {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Printer status request failed')
        const data: HomePrinterStatusResponse = await response.json()

        if (generation !== requestGenerationRef.current) return
        if (controller.signal.aborted) return
        if (data.isOnline === false) {
          setDeviceStatus({ label: '打印机离线', paperLabel: paperLabelFor(data.paperLevel), tone: 'negative', networkIssue: false })
          return
        }
        setDeviceStatus(mapPrinterStatus(data.printerStatus))
      } catch {
        if (generation !== requestGenerationRef.current) return
        if (controller.signal.aborted) return
        setDeviceStatus(
          isNetworkOffline()
            ? { label: '网络异常', paperLabel: '纸张状态待检测', tone: 'negative', networkIssue: true }
            : { label: '设备状态暂不可用', paperLabel: '纸张状态待检测', tone: 'neutral', networkIssue: false },
        )
      }
    }

    const handleOnline = () => {
      void refreshDeviceStatus(true)
    }
    const handleOffline = () => {
      abortControllerRef.current?.abort()
      ++requestGenerationRef.current
      setDeviceStatus({ label: '网络异常', paperLabel: '纸张状态待检测', tone: 'negative', networkIssue: true })
    }

    void refreshDeviceStatus(true)
    const intervalId = window.setInterval(() => {
      void refreshDeviceStatus(false)
    }, 30_000)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      abortControllerRef.current?.abort()
    }
  }, [enabled, terminalId])

  return deviceStatus
}
