// 百宝箱终端配置 hook（真实终端配置驱动，5 分钟轮询）
// 由首页动态专区卡片与 /toolbox 区页共同消费；模块级缓存避免重复请求闪烁。
import type { KioskToolboxConfig } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { getCachedKioskTerminalConfig, getTerminalId } from '../services/api/terminalConfig'

const EMPTY_TOOLBOX_CONFIG: KioskToolboxConfig = { enabled: false, items: [] }
let cachedToolboxConfig: KioskToolboxConfig = EMPTY_TOOLBOX_CONFIG

export function useToolboxConfig(): KioskToolboxConfig {
  const [config, setConfig] = useState<KioskToolboxConfig>(() => cachedToolboxConfig)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const terminalId = getTerminalId()
        const terminalConfig = await getCachedKioskTerminalConfig(terminalId)
        cachedToolboxConfig = terminalConfig.toolbox
        if (alive) setConfig(terminalConfig.toolbox)
      } catch {
        if (alive) setConfig(cachedToolboxConfig)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return config
}
