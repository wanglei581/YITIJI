import { DEFAULT_SMART_CAMPUS_MODULES, type KioskSmartCampusConfig } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { parseKioskTerminalConfig } from '../services/api/kioskCapabilityValidation'
import { getSmartCampusConfig } from '../services/api/smartCampus'
import { getCachedKioskTerminalConfig, getTerminalId } from '../services/api/terminalConfig'
import type { CapabilityStatus } from './useToolboxConfig'

export interface SmartCampusCapabilityState {
  status: CapabilityStatus
  enabled: boolean
  terminalId: string
  configVersion: string
  config: KioskSmartCampusConfig
}

const OFF_CONFIG: KioskSmartCampusConfig = {
  enabled: false,
  modules: { ...DEFAULT_SMART_CAMPUS_MODULES },
  items: [],
}
export const OFF_SMART_CAMPUS_CAPABILITY: SmartCampusCapabilityState = {
  status: 'loading',
  enabled: false,
  terminalId: '',
  configVersion: '',
  config: OFF_CONFIG,
}
const REFRESH_MS = 5 * 60 * 1000

export function useSmartCampusCapabilityState(): SmartCampusCapabilityState {
  const [state, setState] = useState<SmartCampusCapabilityState>(OFF_SMART_CAMPUS_CAPABILITY)

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
      setState(OFF_SMART_CAMPUS_CAPABILITY)

      const terminalId = getTerminalId()
      if (!terminalId) {
        if (mounted && requestGeneration === generation) {
          setState({ ...OFF_SMART_CAMPUS_CAPABILITY, status: 'ready' })
        }
        return
      }

      try {
        // 优先走统一配置缓存（TTL 30s，短于本 hook 5 分钟的刷新周期，不会读到陈旧值）：
        // 作用是避免同会话内跨页面重复请求造成的开关闪烁。
        // 统一配置不可用时回退到旧的智慧校园专用接口，避免整块能力因单点故障消失。
        // 两条路都失败才落到下面的 catch → 一律 OFF（fail-closed：机器搬离校园绝不残留入口）。
        let smartCampus: KioskSmartCampusConfig
        let configVersion = ''
        try {
          const rawConfig = await getCachedKioskTerminalConfig(terminalId)
          const terminalConfig = parseKioskTerminalConfig(rawConfig)
          if (!terminalConfig) {
            const currentTerminalId = getTerminalId()
            if (
              mounted &&
              !controller.signal.aborted &&
              requestGeneration === generation &&
              currentTerminalId === terminalId
            ) {
              setState({ ...OFF_SMART_CAMPUS_CAPABILITY, status: 'ready', terminalId })
            }
            return
          }
          smartCampus = terminalConfig.smartCampus
          configVersion = terminalConfig.configVersion
        } catch {
          smartCampus = await getSmartCampusConfig(terminalId)
        }
        const currentTerminalId = getTerminalId()
        if (
          !mounted ||
          controller.signal.aborted ||
          requestGeneration !== generation ||
          currentTerminalId !== terminalId
        ) {
          return
        }
        setState({
          status: 'ready',
          enabled: smartCampus.enabled,
          terminalId,
          configVersion,
          config: smartCampus,
        })
      } catch {
        if (
          mounted &&
          !controller.signal.aborted &&
          requestGeneration === generation &&
          getTerminalId() === terminalId
        ) {
          setState({ ...OFF_SMART_CAMPUS_CAPABILITY, status: 'ready', terminalId })
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
