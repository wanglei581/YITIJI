/**
 * 小青文字对话探针的纯判定。只有明确 available === false 才锁输入。
 * 探不到、读不懂都保持原状：不把 AI 说成正常，也不说成不能用。
 */
export function assistantLockFromProbe(body: unknown): 'lock' | 'keep' {
  const row = (body && typeof body === 'object' && 'data' in body
    ? (body as { data: unknown }).data
    : body) as { available?: unknown } | null
  if (row && typeof row === 'object' && row.available === false) return 'lock'
  return 'keep'
}
