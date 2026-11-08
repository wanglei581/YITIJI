/** 屏上扫描把会话写进 sessionStorage 之后，通知还挂着的那一屏重读。不携带凭证。 */
let epoch = 0
const listeners = new Set<() => void>()

export function bumpScanDeviceEpoch(): void {
  epoch += 1
  for (const listener of listeners) listener()
}

export function subscribeScanDeviceEpoch(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readScanDeviceEpoch(): number {
  return epoch
}
