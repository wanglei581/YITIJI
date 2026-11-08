export type CopyPrintStage = 'received' | 'handing'
export const COPY_PRINT_LABELS: Record<CopyPrintStage, string> = { received: '已收到', handing: '正在交给打印机' }
export function copyPrintPhase(state: string): 'printing' | 'done' | 'unconfirmed' | 'error' {
  if (state === 'handed') return 'done'
  if (state === 'failed') return 'error'
  if (['printing', 'dispatching', 'spooled'].includes(state)) return 'printing'
  return 'unconfirmed'
}
export function copyFault(code: string | null): 'nopaper' | 'jam' | 'busy' | 'noresp' | 'timeout' | 'limit' | 'off' {
  if (code === 'feeder_empty') return 'nopaper'
  if (code === 'paper_jam' || code === 'cover_open') return 'jam'
  if (code === 'busy' || code === 'COPY_DEVICE_BUSY') return 'busy'
  if (code === 'timeout') return 'timeout'
  if (code === 'too_large' || code === 'COPY_LIMIT_EXCEEDED') return 'limit'
  if (['COPY_UNAUTHORIZED', 'COPY_CAPABILITY_REVOKED', 'COPY_CAPABILITY_DISABLED', 'COPY_EXPIRED'].includes(code ?? '')) return 'off'
  return 'noresp'
}
/** 超过大小、中途没开通两屏借「没有响应」那套字，问小青不跟着借「扫描仪连不上怎么办」。null 时用那套字自己的问句。 */
export function copyErrorAsk(fault: ReturnType<typeof copyFault>): string | null {
  return fault === 'limit' ? '原件太多怎么复印' : fault === 'off' ? '面板上怎么复印' : null
}
