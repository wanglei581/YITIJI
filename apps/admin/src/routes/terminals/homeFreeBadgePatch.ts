// 首页「免费使用」保存成功后，把服务端返回值盖到终端列表上。
// 这一栏没有单独的读取接口，关抽屉再开读的就是列表里的这一份。
// 列表从服务器刷新到相同值之后，补丁丢掉，避免一直盖住更新的服务器数据。

export function applyHomeFreeBadgePatch<T extends { id: string; homeFreeBadge?: boolean }>(
  terminals: readonly T[],
  patch: Readonly<Record<string, boolean>>,
): T[] {
  return terminals.map((terminal) => {
    if (!Object.prototype.hasOwnProperty.call(patch, terminal.id)) return terminal
    const enabled = patch[terminal.id]
    return terminal.homeFreeBadge === enabled ? terminal : { ...terminal, homeFreeBadge: enabled }
  })
}

export function forgetMatchedHomeFreeBadgePatch(
  patch: Record<string, boolean>,
  terminals: readonly { id: string; homeFreeBadge?: boolean }[],
): Record<string, boolean> {
  let changed = false
  const next: Record<string, boolean> = { ...patch }
  for (const terminal of terminals) {
    if (Object.prototype.hasOwnProperty.call(next, terminal.id) && next[terminal.id] === terminal.homeFreeBadge) {
      delete next[terminal.id]
      changed = true
    }
  }
  return changed ? next : patch
}
