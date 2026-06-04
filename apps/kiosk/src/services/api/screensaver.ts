// ============================================================
// Screensaver Service — 待机宣传屏
//
// 根据 API_MODE 选择适配器:
//   API_MODE=mock → screensaverMockAdapter(无后端,返回 enabled:false)
//   API_MODE=http → screensaverHttpAdapter(真实 /terminals/:id/screensaver)
// ============================================================

import type { KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { API_MODE } from './client'
import { screensaverHttpAdapter } from './screensaverHttpAdapter'
import { screensaverMockAdapter } from './screensaverMockAdapter'

export interface ScreensaverServiceInterface {
  getPlaylist(terminalId: string): Promise<KioskScreensaverPlaylist>
}

const adapter: ScreensaverServiceInterface =
  API_MODE === 'http' ? screensaverHttpAdapter : screensaverMockAdapter

export const getScreensaverPlaylist = (terminalId: string): Promise<KioskScreensaverPlaylist> =>
  adapter.getPlaylist(terminalId)

/** 当前终端 id(与打印机状态一致,读 VITE_TERMINAL_ID)。空表示未配置终端。 */
export const getTerminalId = (): string => (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
