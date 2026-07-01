/**
 * 智慧校园契约本地副本。
 *
 * **契约源**：packages/shared/src/types/smartCampus.ts
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs，shared 为
 * ESM-only（见 files/file.types.ts、content/content.types.ts 顶部说明）。
 * 任何字段变更必须同步两处。
 *
 * 合规（compliance-boundary.md §九）：本模块不含任何学生数据；校园大数据本期冻结，
 * bigdata 仅为开关位。
 */

import type { KioskToolboxItemView } from '../terminals/terminal-toolbox.types'

export type SmartCampusModuleKey = 'welcome' | 'bigdata' | 'luggage' | 'panorama'

export interface SmartCampusModules {
  welcome: boolean
  bigdata: boolean
  luggage: boolean
  panorama: boolean
}

export const DEFAULT_SMART_CAMPUS_MODULES: SmartCampusModules = {
  welcome: false,
  bigdata: false,
  luggage: false,
  panorama: false,
}

export interface KioskSmartCampusConfig {
  enabled: boolean
  modules: SmartCampusModules
  items: KioskToolboxItemView[]
}

export interface TerminalSmartCampusConfigView {
  terminalId: string
  enabled: boolean
  modules: SmartCampusModules
  updatedAt: string | null
}

export interface SmartCampusTerminalView {
  terminalId: string
  terminalCode: string | null
  orgId?: string | null
  orgName?: string | null
  isOnline: boolean
  config: TerminalSmartCampusConfigView | null
}

export interface SaveSmartCampusConfigInput {
  enabled: boolean
  modules: Partial<SmartCampusModules>
}
