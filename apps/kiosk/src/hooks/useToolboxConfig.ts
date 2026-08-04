// 百宝箱终端配置 hook（真实终端配置驱动，5 分钟轮询）
// 由首页动态专区卡片与 /toolbox 区页共同消费；模块级缓存避免重复请求闪烁。
import type { KioskToolboxConfig } from '@ai-job-print/shared'
import { useEffect, useState } from 'react'
import { getCachedKioskTerminalConfig, getTerminalId } from '../services/api/terminalConfig'

// 后台未配置百宝箱时的兜底默认项。只包含已通过 Gate 0 审批、
// 具备完整前台实现的服务；Admin 配置的 toolbox 会覆盖此列表。
const DEFAULT_TOOLBOX_CONFIG: KioskToolboxConfig = {
  enabled: true,
  items: [
    {
      key: 'contract-review',
      title: '合同审查',
      description: '识别试用期、竞业、违约金、薪资和社保等风险条款，仅供参考',
      icon: 'file-text',
      to: '/contract-review',
      disabled: false,
      sortOrder: 100,
      launchMode: 'internal_route',
    },
  ],
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
        // 后台显式配置了百宝箱 items 时覆盖默认值；
        // enabled=true 但 items 为空视为未配置，保留含合同审查的兜底配置。
        const backendToolbox = terminalConfig.toolbox
        const resolved =
          backendToolbox.items.length > 0
            ? backendToolbox
            : DEFAULT_TOOLBOX_CONFIG
        cachedToolboxConfig = resolved
        if (alive) setConfig(resolved)
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
