import type {
  SaveScreensaverConfigInput,
  TerminalScreensaverConfigView,
} from '@ai-job-print/shared'

export interface ScreensaverTerminalFormState {
  enabled: boolean
  timeout: string
  playlistId: string
}

export function screensaverTerminalFormState(
  config: Pick<TerminalScreensaverConfigView, 'enabled' | 'idleTimeoutSec' | 'playlistId'> | null | undefined,
): ScreensaverTerminalFormState {
  return {
    enabled: config?.enabled ?? false,
    timeout: String(config?.idleTimeoutSec ?? 180),
    playlistId: config?.playlistId ?? '',
  }
}

export function buildScreensaverConfigInput(
  enabled: boolean,
  timeout: string,
  playlistId: string,
): SaveScreensaverConfigInput {
  return {
    enabled,
    idleTimeoutSec: Math.max(30, Math.min(1800, Number(timeout) || 180)),
    playlistId: playlistId || null,
  }
}

export async function saveScreensaverTerminalForm(
  saveConfig: (terminalId: string, input: SaveScreensaverConfigInput) => Promise<TerminalScreensaverConfigView>,
  terminalId: string,
  enabled: boolean,
  timeout: string,
  playlistId: string,
): Promise<ScreensaverTerminalFormState> {
  const saved = await saveConfig(
    terminalId,
    buildScreensaverConfigInput(enabled, timeout, playlistId),
  )
  return screensaverTerminalFormState(saved)
}
