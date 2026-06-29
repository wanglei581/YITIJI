import { useEffect, useState } from 'react'
import type { KioskSmartCampusConfig } from '@ai-job-print/shared'
import { DEFAULT_SMART_CAMPUS_MODULES } from '@ai-job-print/shared'
import { getSmartCampusConfig, getTerminalId } from '../services/api/smartCampus'
import { getKioskTerminalConfig } from '../services/api/terminalConfig'

// 与 screensaver 控制器的"失败保留上次配置（防黑屏）"相反：
// 智慧校园承载校园专属入口，机器搬离校园后绝不能残留。因此：
//   - 初始值 / 无 terminalId / 从未成功拉取 → 一律 OFF（模块整张不渲染）
//   - 不持久化到 localStorage：重启后从 OFF 起步，直到向后端确认
//   - 仅用进程内 cached 避免同会话内跨页面闪烁；机器搬离校园由后端返回 enabled:false 处理
const OFF: KioskSmartCampusConfig = { enabled: false, modules: { ...DEFAULT_SMART_CAMPUS_MODULES } }
const REFRESH_MS = 5 * 60 * 1000

let cached: KioskSmartCampusConfig | null = null

/** 拉取本终端的智慧校园开关配置。默认 OFF；周期刷新；不持久化。 */
export function useSmartCampusConfig(): KioskSmartCampusConfig {
  const [config, setConfig] = useState<KioskSmartCampusConfig>(cached ?? OFF)

  useEffect(() => {
    const terminalId = getTerminalId()
    if (!terminalId) {
      setConfig(OFF)
      return
    }
    let alive = true
    const load = async (): Promise<void> => {
      try {
        let c: KioskSmartCampusConfig
        try {
          const terminalConfig = await getKioskTerminalConfig(terminalId)
          c = terminalConfig.smartCampus
        } catch {
          c = await getSmartCampusConfig(terminalId)
        }
        if (alive) {
          cached = c
          setConfig(c)
        }
      } catch {
        // 网络失败：保留同会话内上次成功值（无则 OFF），不升级为 ON
        if (alive) setConfig(cached ?? OFF)
      }
    }
    void load()
    const t = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  return config
}
