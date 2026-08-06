// 百宝箱终端配置 hook（真实终端配置驱动，5 分钟轮询）
// 由首页动态专区卡片与 /toolbox 区页共同消费；模块级缓存避免重复请求闪烁。
import type { KioskToolboxConfig } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { getCachedKioskTerminalConfig, getTerminalId } from '../services/api/terminalConfig'

// 后台未配置百宝箱时只显示空占位。生产入口必须由 Admin 明确配置，
// 不能因配置为空或请求失败而自动公开尚未单独授权的服务。
const DEFAULT_TOOLBOX_CONFIG: KioskToolboxConfig = {
  enabled: true,
  items: [],
}

let cachedToolboxConfig: KioskToolboxConfig = DEFAULT_TOOLBOX_CONFIG

export function useToolboxConfig(): KioskToolboxConfig {
  const [config, setConfig] = useState<KioskToolboxConfig>(() => cachedToolboxConfig)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const terminalId = getTerminalId()
        const terminalConfig = await getCachedKioskTerminalConfig(terminalId)
        const backendToolbox = terminalConfig.toolbox
        cachedToolboxConfig = backendToolbox
        if (alive) setConfig(backendToolbox)
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
