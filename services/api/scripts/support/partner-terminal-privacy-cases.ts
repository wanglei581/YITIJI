import { assembleTerminalOperations, projectOutput, type TerminalOpsRaw, type OutputRaw } from '../../src/orgs/partner-terminal-ops'
import { suppressAggregateCount } from '../../src/console-screen/console-screen.metric'

type Assert = (label: string, condition: boolean, detail?: string) => void
const now = new Date('2026-10-04T04:00:00Z')
const raw = (printed: number, failed: number, unconfirmed: number): OutputRaw => ({ printed, settled: printed + failed, unconfirmed })
const quantities = (r: OutputRaw) => [r.printed, r.settled - r.printed, r.unconfirmed, r.settled]
const row = (output: OutputRaw, i: number): TerminalOpsRaw => ({
  terminalCode: `CHECK-${i}`, displayName: null, locationLabel: null, lastHeartbeatAt: null,
  visitCount: output.printed, serviceCount: output.settled, output, segments: [], reportedInWindow: false,
})
function agrees(visible: ReturnType<typeof projectOutput>, candidate: OutputRaw): boolean {
  // 攻击者可用全部非 null 字段，并按接口的一位小数百分比反算。
  return (visible.printed === null || visible.printed === candidate.printed)
    && (visible.settled === null || visible.settled === candidate.settled)
    && (visible.unconfirmed === null || visible.unconfirmed === candidate.unconfirmed)
    && (visible.successRate === null || (candidate.settled > 0
      && Math.round(candidate.printed / candidate.settled * 1000) / 10 === visible.successRate))
}
export function verifyOutputPrivacy(assert: Assert): void {
  const space: OutputRaw[] = []
  for (let p = 0; p <= 8; p++) for (let f = 0; f <= 8; f++) for (let u = 0; u <= 8; u++) space.push(raw(p, f, u))
  const leaks: string[] = []
  for (const actual of space) {
    const output = projectOutput(actual)
    const candidates = space.filter((candidate) => agrees(output, candidate))
    for (const [i, value] of quantities(actual).entries()) {
      if (suppressAggregateCount(value) !== null) continue
      if (new Set(candidates.map((candidate) => quantities(candidate)[i])).size < 2) {
        leaks.push(JSON.stringify({ actual, output, quantity: i }))
      }
    }
    if (quantities(actual).some((v) => suppressAggregateCount(v) === null) && output.successRate !== null) leaks.push('hidden rate')
  }
  assert('T privacy：0–8 的 729 个组合，非 null 字段与一位小数比率均无法唯一反算隐藏量', leaks.length === 0, leaks.slice(0, 3).join('; '))

  // 2–3 台，每个分量 0–6：遍历每台的 343 个向量，跨台组合用确定性错位抽样。
  const vectors: OutputRaw[] = []
  for (let p = 0; p <= 6; p++) for (let f = 0; f <= 6; f++) for (let u = 0; u <= 6; u++) vectors.push(raw(p, f, u))
  const multiLeaks: string[] = []
  for (const size of [2, 3]) for (let i = 0; i < vectors.length; i++) for (let j = 0; j < vectors.length; j += 17) {
    const raws = [vectors[i]!, vectors[j]!, vectors[(i * 17 + j * 31) % vectors.length]!].slice(0, size)
    const output = assembleTerminalOperations({ period: 'week', from: new Date(now.getTime() - 7 * 86400_000), now, rows: raws.map(row), visitRecordingStarted: true })
    for (const column of ['visitCount', 'serviceCount'] as const) {
      if (output.terminals.some((r) => r[column] === null) && output.totals[column] !== null) multiLeaks.push(column)
    }
    const totalRaw = raws.reduce((a, b) => ({ printed: a.printed + b.printed, settled: a.settled + b.settled, unconfirmed: a.unconfirmed + b.unconfirmed }), raw(0, 0, 0))
    for (const [k, actual] of raws.entries()) {
      const visible = output.terminals[k]!
      for (const [q, value] of quantities(actual).entries()) {
        if (suppressAggregateCount(value) !== null) continue
        // 将一台换为另一个向量，逐字段维持所有已发布数字，包括合计与其余终端。
        const possibilities = vectors.filter((candidate) => {
          if (!agrees(visible.output, candidate)) return false
          const changed = { printed: totalRaw.printed - actual.printed + candidate.printed,
            settled: totalRaw.settled - actual.settled + candidate.settled,
            unconfirmed: totalRaw.unconfirmed - actual.unconfirmed + candidate.unconfirmed }
          return agrees(output.totals.output, changed)
        })
        if (new Set(possibilities.map((v) => quantities(v)[q])).size < 2) multiLeaks.push(`${size}/${i}/${j}/${k}/${q}`)
      }
    }
  }
  assert('T privacy：2–3 台 14406 组抽样，合计相减也不能唯一还原隐藏量', multiLeaks.length === 0, multiLeaks.slice(0, 3).join('; '))
}
