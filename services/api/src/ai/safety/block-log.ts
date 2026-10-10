import { currentAiRequestContext } from '../usage/ai-usage-context'

/** 拦截日志只允许这五个字段。不存用户原文，也不存命中词。 */
export interface SafetyBlockRecord {
  time: string
  terminalCode: string
  feature: string
  category: string
  position: 'input' | 'output'
}

const RING_CAP = 200
const ring: SafetyBlockRecord[] = []

/** 落库口子：由 AiSafetyLexiconService 启动时接到审计表。写库失败不影响拒答本身。 */
type SafetyBlockSink = (record: SafetyBlockRecord) => Promise<unknown>
let sink: SafetyBlockSink | null = null

export function registerSafetyBlockSink(next: SafetyBlockSink | null): void {
  sink = next
}

// eslint-disable-next-line no-control-regex -- 刻意匹配控制字符以剔除
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]', 'g')

function sanitizeTerminal(value: string | undefined): string {
  if (!value) return ''
  return value.replace(CONTROL_CHARS, '').trim().slice(0, 64)
}

export function recordSafetyBlock(input: {
  feature: string
  category: string
  position: 'input' | 'output'
}): SafetyBlockRecord {
  const ctx = currentAiRequestContext()
  const terminalCode = sanitizeTerminal(ctx?.terminalCode) || 'none'
  const record: SafetyBlockRecord = {
    time: new Date().toISOString(),
    terminalCode,
    feature: input.feature,
    category: input.category,
    position: input.position,
  }
  console.warn(JSON.stringify(record))
  if (sink) void sink(record).catch(() => undefined)
  ring.push(record)
  if (ring.length > RING_CAP) ring.shift()
  if (ctx) ctx.safetyRefund = true
  return record
}

export function recentSafetyBlocks(): readonly SafetyBlockRecord[] {
  return ring
}

export function clearSafetyBlocks(): void {
  ring.length = 0
}

/** 调用方消费一次。公网次数回滚不是幂等的，所以这里清掉标记，避免再减一次。 */
export function consumeSafetyRefund(): boolean {
  const ctx = currentAiRequestContext()
  if (!ctx?.safetyRefund) return false
  ctx.safetyRefund = false
  return true
}
