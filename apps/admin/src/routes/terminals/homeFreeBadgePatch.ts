// 首页「免费使用」保存成功后，先把服务端返回值盖到终端列表上。
// 这一栏没有单独的读取接口，关抽屉再开读的就是列表里的这一份。
// 保存成功之后才发出的列表请求，回来就以服务器为准、丢掉这台的补丁，
// 不管两边值同不同。请求在保存成功之前发出的，回来仍可能是旧值，补丁继续盖住。
// 服务器没给这个字段（undefined / null）当关，不能因为对不上补丁就一直盖住。

export interface HomeFreeBadgePatchEntry {
  enabled: boolean
  /** 保存成功时的序号。列表请求的序号比它大，才说明请求是保存成功之后发出的。 */
  savedAt: number
}

let clock = 0

/** 保存成功、列表请求发出，共用这一把递增序号，避免同一毫秒里分不清先后。 */
export function nextHomeFreeBadgeClock(): number {
  clock += 1
  return clock
}

/** 缺省、null 都是关。只有明确的 true 才是开。 */
export function homeFreeBadgeOn(value: unknown): boolean {
  return value === true
}

export function applyHomeFreeBadgePatch<T extends { id: string; homeFreeBadge?: boolean | null }>(
  terminals: readonly T[],
  patch: Readonly<Record<string, HomeFreeBadgePatchEntry>>,
): T[] {
  return terminals.map((terminal) => {
    const entry = patch[terminal.id]
    if (!entry) return terminal
    if (terminal.homeFreeBadge === entry.enabled) return terminal
    return { ...terminal, homeFreeBadge: entry.enabled }
  })
}

export function dropHomeFreeBadgePatchAfterList(
  patch: Readonly<Record<string, HomeFreeBadgePatchEntry>>,
  terminals: readonly { id: string; homeFreeBadge?: boolean | null }[],
  listIssuedAt: number,
): Record<string, HomeFreeBadgePatchEntry> {
  let changed = false
  const next: Record<string, HomeFreeBadgePatchEntry> = { ...patch }
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
