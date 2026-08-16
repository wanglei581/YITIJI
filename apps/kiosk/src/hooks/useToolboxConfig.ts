import type { KioskToolboxConfig } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import {
  isLaunchableKioskAppItem,
  parseKioskTerminalConfig,
} from '../services/api/kioskCapabilityValidation'
import { getCachedKioskTerminalConfig, getTerminalId } from '../services/api/terminalConfig'

export type CapabilityStatus = 'loading' | 'ready'

export interface ToolboxCapabilityState {
  status: CapabilityStatus
  enabled: boolean
  terminalId: string
  configVersion: string
  config: KioskToolboxConfig
}

const OFF_CONFIG: KioskToolboxConfig = { enabled: false, items: [] }
export const OFF_TOOLBOX_CAPABILITY: ToolboxCapabilityState = {
  status: 'loading',
  enabled: false,
  terminalId: '',
  configVersion: '',
  config: OFF_CONFIG,
}
const REFRESH_MS = 5 * 60 * 1000

export function useToolboxCapabilityState(): ToolboxCapabilityState {
  const [state, setState] = useState<ToolboxCapabilityState>(OFF_TOOLBOX_CAPABILITY)

  useEffect(() => {
    let mounted = true
    let generation = 0
    let activeController: AbortController | null = null

    const load = async () => {
      generation += 1
      const requestGeneration = generation
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      setState(OFF_TOOLBOX_CAPABILITY)

      const terminalId = getTerminalId()
      if (!terminalId) {
        if (mounted && requestGeneration === generation) {
          setState({ ...OFF_TOOLBOX_CAPABILITY, status: 'ready' })
        }
        return
      }

      try {
        // 走统一配置缓存（TTL 30s，短于本 hook 的刷新周期）：避免同会话内跨页面
        // 重复请求造成百宝箱入口闪烁。E3 门禁校验的正是这条复用。
        const rawConfig = await getCachedKioskTerminalConfig(terminalId)
        const terminalConfig = parseKioskTerminalConfig(rawConfig)
        const currentTerminalId = getTerminalId()
        if (
          !mounted ||
          controller.signal.aborted ||
          requestGeneration !== generation ||
          currentTerminalId !== terminalId
        ) {
          return
        }
        if (!terminalConfig) {
          setState({ ...OFF_TOOLBOX_CAPABILITY, status: 'ready', terminalId })
          return
        }
        const config = terminalConfig.toolbox
        const enabled = config.enabled && config.items.some(isLaunchableKioskAppItem)
        setState({
          status: 'ready',
          enabled,
          terminalId,
          configVersion: terminalConfig.configVersion,
          config,
        })
      } catch {
        if (
          mounted &&
          !controller.signal.aborted &&
          requestGeneration === generation &&
          getTerminalId() === terminalId
        ) {
          setState({ ...OFF_TOOLBOX_CAPABILITY, status: 'ready', terminalId })
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      mounted = false
      generation += 1
      activeController?.abort()
      window.clearInterval(timer)
    }
  }, [])

  return state
}
