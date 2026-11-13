import type { LocalScanProbeView } from '../../services/scan/localScanProbe'

/**
 * 只有「这次探测是 ready、还在 1 分钟内、并且屏上扫描已开通」才返回这句。
 * 探测失败、能力没开通、还没检查、检查过期，调用方必须传 false，这里返回 null。
 */
export function scanReadyChipText(ok: boolean): string | null {
  if (!ok) return null
  return '扫描仪就绪 · 刚刚检查'
}

export function checkedAgoLabel(observedAt: number | null, now = Date.now()): string | null {
  if (observedAt == null) return null
  const seconds = Math.max(0, Math.floor((now - observedAt) / 1000))
  if (seconds < 10) return '刚刚检查'
  return `${seconds} 秒前检查`
}

export interface ScannerStatusLine {
  label: string
  tone: 'ok' | 'warn' | 'q'
  dep: string
  ago: string | null
}

/**
 * 设备状态页的扫描仪一行。不写「扫描仪就绪」：那句只留给探测成功后的状态签。
 * 超过 1 分钟的成功读数改写成「不算就绪」。
 */
export function scannerStatusLine(probe: LocalScanProbeView): ScannerStatusLine {
  const ago = probe.phase === 'done' ? checkedAgoLabel(probe.observedAt) : null
  if (probe.phase !== 'done') {
    return { label: '正在检查', tone: 'q', dep: '正在向本机程序问', ago: null }
  }
  if (probe.failure === 'unreachable') {
    return { label: '状态未知', tone: 'warn', dep: '本机程序没有回应', ago }
  }
  if (probe.health === 'ready' && probe.freshReady) {
    return { label: '这次读到就绪', tone: 'ok', dep: '这次本机探测读到能扫', ago }
  }
  if (probe.health === 'ready') {
    return { label: '不算就绪', tone: 'warn', dep: '这次读数已经超过 1 分钟', ago }
  }
  if (probe.health === 'busy') {
    return { label: '正忙', tone: 'warn', dep: '这次读到正忙', ago }
  }
  if (probe.health === 'not_found') {
    return { label: '未找到', tone: 'warn', dep: '这次没有找到扫描仪', ago }
  }
  return { label: '状态未知', tone: 'warn', dep: '这次没有确认到状态', ago }
}

export interface ScreenScanBlockInput {
  capLoading: boolean
  /** 能力接口没取到。按未验证禁用，但不要说成已经确认未开通。 */
  capUnknown: boolean
  capAllowed: boolean
  probe: LocalScanProbeView
}

/**
 * 屏上方式为什么现在不能选。null 表示可以选。
 * 稿内原话只有「这台机器还没开通屏上扫描」。其余句子是规格书给的稿外说法。
 */
export function screenScanBlockReason(input: ScreenScanBlockInput): string | null {
  if (input.capLoading) return '正在检查这台机器能不能在屏上扫描'
  if (!input.capAllowed) {
    if (input.capUnknown) return '屏上扫描能力暂时无法确认，请先用面板扫描'
    return '这台机器还没开通屏上扫描'
  }
  if (input.probe.phase === 'idle' || input.probe.phase === 'checking') return '正在检查扫描仪'
  if (input.probe.failure === 'unreachable') return '本机程序连不上，扫描仪状态未知，请先用面板扫描'
  if (input.probe.failure === 'unknown') return '扫描仪状态未知，请先用面板扫描'
  if (input.probe.health === 'busy') return '扫描仪正忙，请稍后再试'
  if (input.probe.health === 'not_found') return '未找到扫描仪，请先用面板扫描'
  if (input.probe.health === 'error') return '扫描仪状态暂时无法确认，请先用面板扫描'
  if (input.probe.health === 'ready' && !input.probe.freshReady) {
    return '扫描仪状态超过 1 分钟没更新，先用面板扫描'
  }
  if (input.probe.health !== 'ready') return '扫描仪状态未知，请先用面板扫描'
  return null
}
