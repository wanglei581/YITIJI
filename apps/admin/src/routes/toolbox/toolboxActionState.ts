import type {
  KioskToolboxItem,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
} from '@ai-job-print/shared'
import { BLOCK_REASON_LABELS } from './constants.ts'

export function normalizeToolboxDraftItem(item: KioskToolboxItem): KioskToolboxItem {
  return {
    key: item.key,
    title: item.title,
    description: item.description ?? '',
    icon: item.icon || 'wrench',
    to: item.to ?? null,
    disabled: Boolean(item.disabled),
    sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : 0,
    placements: item.placements?.length ? [...item.placements] : ['toolbox'],
    launchMode: item.launchMode ?? 'internal_route',
    externalUrl: item.externalUrl ?? null,
    qrImageUrl: item.qrImageUrl ?? null,
    qrTargetUrl: item.qrTargetUrl ?? null,
  }
}

export function buildToolboxSaveInput(
  enabled: boolean,
  items: KioskToolboxItem[],
): SaveToolboxConfigInput {
  return {
    enabled,
    items: items.map((item, index) => ({
      ...normalizeToolboxDraftItem(item),
      sortOrder: index,
    })),
  }
}

export async function saveToolboxTerminalConfig(
  saveConfig: (terminalId: string, input: SaveToolboxConfigInput) => Promise<TerminalToolboxConfigView>,
  terminalId: string,
  enabled: boolean,
  items: KioskToolboxItem[],
): Promise<{ enabled: boolean; items: KioskToolboxItem[] }> {
  const saved = await saveConfig(terminalId, buildToolboxSaveInput(enabled, items))
  return {
    enabled: saved.enabled,
    items: saved.items.map(normalizeToolboxDraftItem),
  }
}

export function toolboxActionErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (!error || typeof error !== 'object') return fallback
  const candidate = error as { reason?: unknown; message?: unknown }
  if (typeof candidate.reason === 'string' && BLOCK_REASON_LABELS[candidate.reason]) {
    return BLOCK_REASON_LABELS[candidate.reason]
  }
  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    const message = candidate.message.trim()
    const reason = Object.keys(BLOCK_REASON_LABELS).find((key) => message.endsWith(`: ${key}`))
    return reason ? BLOCK_REASON_LABELS[reason] : message
  }
  return fallback
}

export async function runToolboxAction(
  action: () => Promise<unknown>,
  successMessage: string,
  fallback = '操作失败',
): Promise<{ ok: boolean; message: string }> {
  try {
    await action()
    return { ok: true, message: successMessage }
  } catch (error) {
    return { ok: false, message: toolboxActionErrorMessage(error, fallback) }
  }
}
