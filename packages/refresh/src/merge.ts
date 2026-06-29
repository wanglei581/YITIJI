export function replaceIfChanged<T>(current: T | undefined, incoming: T): T {
  if (Object.is(current, incoming)) return incoming
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(incoming)) return current as T
  return incoming
}

export function mergeById<T>(
  getId: (item: T) => string,
): (current: T[] | undefined, incoming: T[]) => T[] {
  return (current, incoming) => {
    if (!current || current.length === 0) return incoming
    const previous = new Map(current.map((item) => [getId(item), item]))
    let changed = current.length !== incoming.length
    const merged = incoming.map((next) => {
      const id = getId(next)
      const prev = previous.get(id)
      if (!prev) {
        changed = true
        return next
      }
      if (JSON.stringify(prev) === JSON.stringify(next)) return prev
      changed = true
      return next
    })
    return changed ? merged : current
  }
}
