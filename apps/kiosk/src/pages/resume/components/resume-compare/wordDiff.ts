/**
 * 逐字差异（原句 → 改写）。自实现的分词 LCS，不依赖第三方 diff 组件：
 * 第三方 viewer 会渲染折叠按钮与屏外隐藏节点，在 27 寸竖屏与手机断点上过不了触控 / 越界门禁。
 * 中文按单字、字母数字按连续串、其余按单个符号分词；两侧超过 MAX_TOKENS 时退化为整段删除 + 整段新增，仍然诚实。
 */
export type DiffSegment = { type: 'equal' | 'del' | 'ins'; text: string }

const MAX_TOKENS = 600

export function tokenize(text: string): string[] {
  const out: string[] = []
  const re = /[A-Za-z0-9_%.\-+]+|\s+|[一-鿿]|[^\s]/gu
  for (const m of text.matchAll(re)) out.push(m[0])
  return out
}

export function wordDiff(before: string, after: string): DiffSegment[] {
  if (before === after) return before ? [{ type: 'equal', text: before }] : []
  const a = tokenize(before)
  const b = tokenize(after)
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    const out: DiffSegment[] = []
    if (before) out.push({ type: 'del', text: before })
    if (after) out.push({ type: 'ins', text: after })
    return out
  }
  const n = a.length
  const m = b.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const segments: DiffSegment[] = []
  const push = (type: DiffSegment['type'], text: string) => {
    const last = segments[segments.length - 1]
    if (last && last.type === type) last.text += text
    else segments.push({ type, text })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { push('equal', a[i]); i += 1; j += 1 }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', a[i]); i += 1 }
    else { push('ins', b[j]); j += 1 }
  }
  while (i < n) { push('del', a[i]); i += 1 }
  while (j < m) { push('ins', b[j]); j += 1 }
  return segments
}
