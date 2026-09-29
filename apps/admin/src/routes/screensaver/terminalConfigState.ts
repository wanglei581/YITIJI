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

export interface ScreensaverTerminalPlace {
  name: string | null
  location: string | null
}

export function indexScreensaverTerminalPlaces(
  rows: Array<{ id: string; terminalCode: string; displayName: string | null; locationLabel: string | null }>,
): Map<string, ScreensaverTerminalPlace> {
  const places = new Map<string, ScreensaverTerminalPlace>()
  for (const row of rows) {
    const place = { name: row.displayName, location: row.locationLabel }
    if (row.id) places.set(row.id, place)
    if (row.terminalCode) places.set(row.terminalCode, place)
  }
  return places
}

export function screensaverTerminalHeading(
  terminal: { terminalId: string; terminalCode: string | null },
  place: ScreensaverTerminalPlace | undefined,
): { title: string; subtitle: string | null } {
  const code = terminal.terminalCode ?? terminal.terminalId
  const name = place?.name?.trim() ?? ''
  const location = place?.location?.trim() ?? ''
  const parts = [name, location].filter((part) => part.length > 0 && part !== code)
  if (parts.length === 0) return { title: code, subtitle: null }
  return { title: parts.join(' · '), subtitle: code }
}
