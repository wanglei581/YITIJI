import type { KioskSmartCampusConfig } from '@ai-job-print/shared'
import { DEFAULT_SMART_CAMPUS_MODULES } from '@ai-job-print/shared'

/**
 * 智慧校园配置 Mock adapter。
 *
 * 纯 mock 模式（无后端）下一律返回 enabled:false：智慧校园需后端 + 管理员按终端开启
 * 才生效。诚实降级——mock 下首页不出现智慧校园模块，非 bug。
 */
export const smartCampusMockAdapter = {
  async getConfig(): Promise<KioskSmartCampusConfig> {
    return { enabled: false, modules: { ...DEFAULT_SMART_CAMPUS_MODULES } }
  },
}
