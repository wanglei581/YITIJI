// 收费设置保存成功后，先把读回的生效价盖到终端列表上。
// 保存成功之后才发出的列表请求，回来就以服务器为准、丢掉这台的补丁。

import type { EffectiveUserPrices } from '@ai-job-print/shared'

export interface ChargeSettingsPatchEntry {
  charge: EffectiveUserPrices
  /** 保存成功时的序号。列表请求的序号比它大，才说明请求是保存成功之后发出的。 */
  savedAt: number
}

let clock = 0

/** 保存成功、列表请求发出，共用这一把递增序号。不和首页免费使用那把混用。 */
export function nextChargeSettingsClock(): number {
  clock += 1
  return clock
}

export function applyChargeSettingsPatch<T extends { id: string; charge?: EffectiveUserPrices }>(
  terminals: readonly T[],
  patch: Readonly<Record<string, ChargeSettingsPatchEntry>>,
): T[] {
  return terminals.map((terminal) => {
    const entry = patch[terminal.id]
    if (!entry) return terminal
    return { ...terminal, charge: entry.charge }
  })
}

export function dropChargeSettingsPatchAfterList(
  patch: Readonly<Record<string, ChargeSettingsPatchEntry>>,
  terminals: readonly { id: string }[],
  listIssuedAt: number,
): Record<string, ChargeSettingsPatchEntry> {
  let changed = false
  const next: Record<string, ChargeSettingsPatchEntry> = { ...patch }
  for (const terminal of terminals) {
    const entry = next[terminal.id]
    if (!entry) continue
    if (listIssuedAt > entry.savedAt) {
      delete next[terminal.id]
      changed = true
    }
  }
  return changed ? next : patch
}
