// U 盘导入入口的后台能力闸门。
//
// isUsbImportConfigured() 只说明构建时有没有注入本机网桥令牌。
// 管理员把 usb_import 配成未验收、维护中或不支持之后，令牌还在，入口仍会去读盘。
// 这里先看令牌，再看终端能力，和打印扫描首页那张「U 盘导入」卡用同一套判断。

import { useCallback, useEffect, useState } from 'react'
import { canCreateFormalPrintScanTask } from '@ai-job-print/shared'
import {
  CAPABILITY_STATUS_NOTES,
  loadConfiguredCapabilities,
  resolveCapabilityOverride,
} from '../services/api/printScanCapabilities'
import { isUsbImportConfigured } from '../services/files/usbImportApi'

export type UsbImportGateState = 'loading' | 'allowed' | 'blocked' | 'unknown'

export interface UsbImportGate {
  state: UsbImportGateState
  note: string | null
  retry: () => void
}

/** 令牌已注入、但后台还没放行时，页面拿来盖住文件列表的那一层。 */
export interface UsbImportHold {
  state: Exclude<UsbImportGateState, 'allowed'>
  note: string | null
  onRetry: () => void
}

export const USB_IMPORT_GATE_LOADING_NOTE = '正在确认本机是否开通 U 盘导入…'
export const USB_IMPORT_GATE_UNKNOWN_NOTE = '暂时读不到本机的服务开通情况，请稍后再试或使用其他方式'

export function useUsbImportGate(unconfiguredNote: string | null = null): UsbImportGate {
  const configured = isUsbImportConfigured()
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<UsbImportGateState>(configured ? 'loading' : 'blocked')
  const [note, setNote] = useState<string | null>(configured ? USB_IMPORT_GATE_LOADING_NOTE : unconfiguredNote)

  const retry = useCallback(() => {
    setAttempt((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!configured) {
      setState('blocked')
      setNote(unconfiguredNote)
      return
    }

    let cancelled = false
    setState('loading')
    setNote(USB_IMPORT_GATE_LOADING_NOTE)

    void loadConfiguredCapabilities()
      .then((result) => {
        if (cancelled) return
        if (result.status === 'error') {
          setState('unknown')
          setNote(USB_IMPORT_GATE_UNKNOWN_NOTE)
          return
        }
        // 演示 / mock 模式没有后台开关，保持原来「配了令牌就能用」。
        if (result.status === 'skipped') {
          setState('allowed')
          setNote(null)
          return
        }
        const override = resolveCapabilityOverride(result, 'usb_import')
        // 拉取成功但没有这一行：管理员还没接管，与首页卡片一样放行。
        if (!override || canCreateFormalPrintScanTask(override.status)) {
          setState('allowed')
          setNote(null)
          return
        }
        const custom = override.note?.trim()
        setState('blocked')
        setNote(custom || CAPABILITY_STATUS_NOTES[override.status] || '暂不可用')
      })
      .catch(() => {
        if (cancelled) return
        setState('unknown')
        setNote(USB_IMPORT_GATE_UNKNOWN_NOTE)
      })

    return () => {
      cancelled = true
    }
  }, [configured, attempt, unconfiguredNote])

  return { state, note, retry }
}
