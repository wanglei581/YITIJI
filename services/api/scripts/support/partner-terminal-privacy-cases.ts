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
    const totalRaw = raws.reduce((a, b) => ({ printed: a.printed + b.printed, settled: a.settled + b.settled, unconfirmed: a.unconfirmed + b.unconfirmed }), raw(0, 0, 0))
    for (const [k, actual] of raws.entries()) {
      const visible = output.terminals[k]!
      for (const [q, value] of quantities(actual).entries()) {
        if (suppressAggregateCount(value) !== null) continue
        // 攻击者知道列合计，也能读其它行的全部非null字段；必须允许两台同时改值。
        const possibilities = vectors.filter((candidate) => {
          if (!agrees(visible.output, candidate)) return false
          const replacementTotal = { printed: totalRaw.printed - actual.printed + candidate.printed,
            settled: totalRaw.settled - actual.settled + candidate.settled,
            unconfirmed: totalRaw.unconfirmed - actual.unconfirmed + candidate.unconfirmed }
          // 会话与新建任务是独立计数；不能把夹具的visitCount=printed当成业务恒等式。
          if (agrees(output.totals.output, replacementTotal)) return true
          return raws.some((other, j) => {
            if (j === k) return false
            const balanced = { printed: other.printed + actual.printed - candidate.printed,
              settled: other.settled + actual.settled - candidate.settled,
              unconfirmed: other.unconfirmed + actual.unconfirmed - candidate.unconfirmed }
            if (quantities(balanced).some((v) => v < 0)) return false
            if (!agrees(output.terminals[j]!.output, balanced)) return false
            return agrees(output.totals.output, totalRaw)
          })
        })
        if (new Set(possibilities.map((v) => quantities(v)[q])).size < 2) multiLeaks.push(`${size}/${i}/${j}/${k}/${q}`)
      }
    }
  }
  assert('T privacy：2–3 台 14406 组抽样，全部行出纸字段与公开合计无法唯一还原隐藏量', multiLeaks.length === 0, multiLeaks.slice(0, 3).join('; '))
  verifyTerminalColumns(assert)
}

/** 独立攻击模型：合计已知，0也可已知；空格候选无上界（由合计约束）。 */
export function verifyTerminalColumns(assert: Assert): void {
  let sources = 0
  let protectedChecks = 0
  for (const size of [2, 3, 4]) {
    let failure = ''
    for (let encoded = 0; encoded < 8 ** size; encoded += 1) {
      let code = encoded
      const values = Array.from({ length: size }, () => { const v = code % 8; code = Math.floor(code / 8); return v })
      const result = assembleTerminalOperations({ period: 'week', from: now, now,
        rows: values.map((v, i) => row({ printed: v, settled: v, unconfirmed: v }, i)), visitRecordingStarted: true })
      sources += 1
      const sum = values.reduce((a, b) => a + b, 0)
      const columns = [
        result.terminals.map((r) => r.visitCount), result.terminals.map((r) => r.serviceCount),
        ...(['printed', 'settled', 'unconfirmed'] as const).map((key) => result.terminals.map((r) => r.output[key])),
      ]
      if (result.totals.visitCount !== suppressAggregateCount(sum) || result.totals.serviceCount !== suppressAggregateCount(sum)) failure ||= `合计必须独立投影：${values}`
      for (const shown of columns) for (const knowsZero of [false, true]) {
        const hidden = shown.flatMap((v, i) => v === null && (!knowsZero || values[i] !== 0) ? [i] : [])
        const residual = sum - shown.reduce<number>((a, b) => a + (b ?? 0), 0)
        values.forEach((v, i) => {
          if (v < 1 || v > 4) return
          protectedChecks += 1
          // 所有非零空格至少1，未知零值时至少0；其余残差任意分配给其它空格。
          const min = knowsZero ? 1 : 0
          const max = residual - min * (hidden.length - 1)
          if (!hidden.includes(i) || (sum >= 5 && (hidden.length < 2 || max <= min))) failure ||= `knownZero=${knowsZero} values=${values} shown=${shown} sum=${sum} cell=${i}`
        })
      }
    }
    assert(`T column privacy：${size}台×0–7全量穷举，列合计已知/零值已知或未知，5列低频值不唯一`, !failure, failure)
  }
  const example = assembleTerminalOperations({ period: 'week', from: now, now,
    rows: [8, 2].map((v, i) => row({ printed: v, settled: v, unconfirmed: v }, i)), visitRecordingStarted: true })
  assert('T column privacy：8与2的逐台服务均隐藏，机构合计10照常公开', example.terminals.every((r) => r.visitCount === null) && example.totals.visitCount === 10)
  console.log(`  terminal column exhaustive: sourceCases=${sources}, protectedChecks=${protectedChecks}`)
}
