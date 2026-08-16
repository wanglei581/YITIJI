import { DEFAULT_SMART_CAMPUS_MODULES, type KioskSmartCampusConfig } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { parseKioskTerminalConfig } from '../services/api/kioskCapabilityValidation'
import { getKioskTerminalConfig, getTerminalId } from '../services/api/terminalConfig'
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
        const rawConfig = await getKioskTerminalConfig(terminalId)
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
          setState({ ...OFF_SMART_CAMPUS_CAPABILITY, status: 'ready', terminalId })
          return
        }
        setState({
          status: 'ready',
          enabled: terminalConfig.smartCampus.enabled,
          terminalId,
          configVersion: terminalConfig.configVersion,
          config: terminalConfig.smartCampus,
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
