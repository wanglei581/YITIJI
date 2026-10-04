import { suppressAggregateCount } from '../../src/console-screen/console-screen.metric'
import { suppressResidualRow } from '../../src/console-screen/console-screen.residual'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { ScreenSnapshotCache } from '../../src/console-screen/console-screen.cache'
import { ConsoleScreenUsageService } from '../../src/console-screen/console-screen.usage.service'

type Assert = (label: string, condition: boolean, detail?: string) => void
interface Envelope { min: number[]; max: number[] }
function merge(envelope: Envelope, values: readonly number[]): void {
  values.forEach((v, i) => { envelope.min[i] = Math.min(envelope.min[i]!, v); envelope.max[i] = Math.max(envelope.max[i]!, v) })
}
function enumerate(length: number, budget: number, maxValue: number, visit: (row: number[], sum: number) => void): number {
  const row = Array<number>(length).fill(0)
  let visited = 0
  const next = (index: number, remaining: number, sum: number): void => {
    if (index === length) { visit(row, sum); visited += 1; return }
    for (let v = 0; v <= Math.min(maxValue, remaining); v += 1) { row[index] = v; next(index + 1, remaining - v, sum + v) }
  }
  next(0, budget, 0)
  return visited
}

/** 候选不限于0–7：补充隐藏的可见格没有上界，枚举到真实合计。 */
export function verifyResidualPrivacy(assert: Assert): void {
  let sourceCases = 0
  let candidateCases = 0
  let protectedChecks = 0
  const completions = new Map<string, Envelope>()
  for (const outside of [false, true]) {
    for (let n = 1; n <= 6; n += 1) {
      let failure = ''
      sourceCases += enumerate(n, 7 * n, 7, (row, sum) => {
        const shown = suppressResidualRow(row, outside)
        if (row.some((v, i) => v < 5 && shown[i] !== null)) failure ||= `0与1–4必须共用null：row=${row} shown=${shown}`
        const hidden = shown.flatMap((v, i) => v === null ? [i] : [])
        const visibleSum = shown.reduce<number>((total, v) => total + (v ?? 0), 0)
        const hiddenTotal = suppressAggregateCount(sum) === null
        const budget = hiddenTotal ? 4 : sum - visibleSum
        const key = `${outside}:${hidden.length}:${budget}:${hiddenTotal}`
        let env = completions.get(key)
        if (!env) {
          env = { min: Array(hidden.length).fill(Infinity), max: Array(hidden.length).fill(-Infinity) }
          const target = env
          // 可见格保持精确数值；null不限定为0–4，补充隐藏的格没有上界。
          // 枚举全部非负整数组合，未来格不参与；窗口外未知部分取剩余非负量。
          candidateCases += enumerate(hidden.length, budget, budget, (values, residual) => {
            if (hiddenTotal ? residual >= 1 && residual <= 4 : outside || residual === budget) merge(target, values)
          })
          completions.set(key, env)
        }
        row.forEach((value, i) => {
          if (value < 1 || value > 4) return
          protectedChecks += 1
          const index = hidden.indexOf(i)
          if (index < 0 || env!.min[index] === env!.max[index]) failure ||= `outside=${outside} row=${row} shown=${shown} total=${sum} cell=${i}`
        })
      })
      assert(`residual privacy：${n}格×0–7穷举，窗口外未知=${outside}，每个1–4格不唯一`, !failure, failure)
    }
  }
  assert('residual privacy：未来null不计入m/r，补充隐藏最小格且同值取最早', JSON.stringify(suppressResidualRow([3, 5, 5, null], false)) === '[null,null,5,null]')
  assert('residual privacy：饱和4m也补充隐藏，无可见格则维持原样', JSON.stringify(suppressResidualRow([4, 4, 6], false)) === '[null,null,null]' && JSON.stringify(suppressResidualRow([3], false)) === '[null]')
  console.log(`  residual exhaustive: sourceCases=${sourceCases}, candidateCases=${candidateCases}, protectedChecks=${protectedChecks}`)
}

export async function verifyResidualService(assert: Assert, prisma: PrismaService): Promise<void> {
  const now = new Date('2032-10-04T00:07:00Z') // 上海08:07，已发生9格，未来15格。
  const ids: string[] = []
  try {
    for (const [at, count] of [[new Date('2032-10-03T22:01:00Z'), 3], [new Date('2032-10-04T00:01:00Z'), 5]] as const) {
      for (let i = 0; i < count; i += 1) {
        const row = await prisma.aiServiceLog.create({ data: { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', createdAt: at } })
        ids.push(row.id)
      }
    }
    const snapshot = await new ConsoleScreenUsageService(prisma, new ScreenSnapshotCache()).getAdminUsage('today', now)
    const ai = snapshot.metrics.ai
    const heat = snapshot.metrics.heat7d
    const today = heat?.available ? heat.value.days.find((day) => day.date === '2032-10-04') : null
    assert('residual service：真实AI合计8、可见5、低频3与零值共用null', ai?.available === true && ai.value.total === 8 && today?.hours[8] === 5 && today.hours.slice(0, 8).every((v) => v === null))
    // 枚举与公开总计8、可见第8格5、其余null相符的已发生格子组合。
    const possibilities = new Set<number>()
    enumerate(8, 3, 3, (row, sum) => {
      if (sum === 3 && JSON.stringify(suppressResidualRow([...row, 5], false)) === JSON.stringify(today?.hours.slice(0, 9))) possibilities.add(row[6]!)
    })
    assert('residual service：原隐藏格3有0/1/2/3四种可能，未来格不作掩护', possibilities.size === 4, [...possibilities].join(','))
    const pulse = snapshot.metrics.pulse2h
    assert('residual service：脉冲三序列0与1–4均null，可见5保留', pulse?.available === true && pulse.value.buckets.every((b) => b.info === null && b.print === null) && pulse.value.buckets.some((b) => b.ai === 5))
  } finally {
    await prisma.aiServiceLog.deleteMany({ where: { id: { in: ids } } })
  }
}
