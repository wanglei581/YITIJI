// ============================================================
// Smart Campus Service — 智慧校园（按终端开关）
//
// 根据 API_MODE 选择适配器：
//   API_MODE=mock → smartCampusMockAdapter（无后端，返回 enabled:false）
//   API_MODE=http → smartCampusHttpAdapter（真实 /terminals/:id/smart-campus）
//
// 终端 id 复用 screensaver 的 getTerminalId（读 VITE_TERMINAL_ID）。
// ============================================================

import type { KioskSmartCampusConfig } from '@ai-job-print/shared'
import { API_MODE } from './client'
import { getTerminalId } from './screensaver'
import { smartCampusHttpAdapter } from './smartCampusHttpAdapter'
import { smartCampusMockAdapter } from './smartCampusMockAdapter'

export interface SmartCampusServiceInterface {
  getConfig(terminalId: string): Promise<KioskSmartCampusConfig>
}

const adapter: SmartCampusServiceInterface =
  API_MODE === 'http' ? smartCampusHttpAdapter : smartCampusMockAdapter

export const getSmartCampusConfig = (terminalId: string): Promise<KioskSmartCampusConfig> =>
  adapter.getConfig(terminalId)

export { getTerminalId }
