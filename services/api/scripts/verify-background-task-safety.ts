/**
 * verify:background-task-safety —— 后台定时任务一次失败不能让 API 进程退出（2026-10-06 P0）
 *
 * 起因：terminals-agent.service.ts 里 `setInterval(() => void this.resetExpiredClaims(), 30_000)`
 * 没有 catch。一次 Prisma P2028（事务 5 秒内起不来）就成了未处理的 Promise 拒绝，Node 22 直接退出，
 * 走查在本地 rc 栈复现两次。
 *
 *   [1] 静态：services/api/src 里 setInterval / setTimeout 的回调中，不许出现 `void <调用>` 而不接 `.catch(`。
 *   [2] 运行时：scheduleBackground 跑一个每次都失败的任务，进程不出现未处理拒绝、定时器继续跑、错误被记下。
 *   [3] 运行时：真的 TerminalAgentService.onModuleInit 装上的回收定时器，在 $transaction 抛 P2028 时
 *       只记一行 warn（不含 message 原文），不产生未处理拒绝。
 *   [4] 运行时：进程级兜底——未处理拒绝被记日志、推告警，日志与告警都不含 message 原文；卸载后不再接管。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:background-task-safety
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import {
  describeBackgroundError,
  installUnhandledRejectionGuard,
  scheduleBackground,
} from '../src/common/process/background-task'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'

const SRC = join(__dirname, '..', 'src')
let passed = 0
function pass(name: string) {
  passed += 1
  console.log(`  PASS ${name}`)
}

function listTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'generated' || entry === '__tests__') continue
      out.push(...listTs(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

/** [1] 定时器回调里的 `void x()`（x 不是 `.catch(...)` 调用）一律违规。 */
function scanTimers(): string[] {
  const violations: string[] = []
  for (const file of listTs(SRC)) {
    const text = readFileSync(file, 'utf8')
    if (!/set(Interval|Timeout)\s*\(/.test(text)) continue
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && (node.expression.text === 'setInterval' || node.expression.text === 'setTimeout')) {
        const cb = node.arguments[0]
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          const inner = (n: ts.Node) => {
            if (ts.isVoidExpression(n) && ts.isCallExpression(n.expression)) {
              const callee = n.expression.expression
              const isCatch = ts.isPropertyAccessExpression(callee) && callee.name.text === 'catch'
              if (!isCatch) {
                const { line } = sf.getLineAndCharacterOfPosition(n.getStart())
                violations.push(`${relative(join(SRC, '..'), file)}:${line + 1} ${n.getText().slice(0, 80)}`)
              }
            }
            ts.forEachChild(n, inner)
          }
          inner(cb)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return violations
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  console.log('\n[1] 静态扫描：定时器回调里不许有不接 .catch 的 `void 调用`')
  const violations = scanTimers()
  assert.deepEqual(violations, [], `违规：\n${violations.join('\n')}`)
  // 阳性对照：同一个扫描器对一段违规样本必须报出来，避免扫描器本身失效还显示通过。
  {
    const sample = 'class A { x() { setInterval(() => void this.y(), 10) } async y() {} }'
    const sf = ts.createSourceFile('sample.ts', sample, ts.ScriptTarget.Latest, true)
    let found = 0
    const visit = (n: ts.Node) => {
      if (ts.isVoidExpression(n) && ts.isCallExpression(n.expression)) found += 1
      ts.forEachChild(n, visit)
    }
    visit(sf)
    assert.equal(found, 1, '扫描器阳性对照失效')
  }
  pass('services/api/src 的定时器回调都已收住错误（扫描器阳性对照有效）')

  // 统计测试期间出现的未处理拒绝。不装任何兜底时，Node 会在这里触发事件；我们只计数不退出。
  const unhandled: unknown[] = []
  const counter = (reason: unknown) => unhandled.push(reason)
  process.on('unhandledRejection', counter)

  console.log('\n[2] scheduleBackground：任务次次失败，定时器照跑、错误被记、不产生未处理拒绝')
  {
    let calls = 0
    const errors: string[] = []
    const failing = Object.assign(new Error('Transaction API error: 手机号 13800138000 的事务没起来'), { code: 'P2028' })
    const timer = scheduleBackground(async () => { calls += 1; throw failing }, 15, (error) => errors.push(describeBackgroundError(error)))
    await sleep(120)
    clearInterval(timer)
    assert.ok(calls >= 3, `定时器应至少跑 3 次，实际 ${calls}`)
    assert.equal(errors.length, calls, '每次失败都应记一次')
    assert.ok(errors.every((line) => line.includes('code=P2028')), '日志应带错误码')
    assert.ok(errors.every((line) => !line.includes('13800138000') && !line.includes('事务没起来')), '日志不得带 message 原文')
    assert.equal(unhandled.length, 0, `不得产生未处理拒绝，实际 ${unhandled.length}`)
    pass(`任务失败 ${calls} 次，定时器仍在跑，日志只有类型与错误码`)
  }

  console.log('\n[3] 真实 TerminalAgentService：回收定时器遇到 P2028 不让进程退出')
  {
    const captured: Array<() => void> = []
    const realSetInterval = global.setInterval
    ;(global as { setInterval: unknown }).setInterval = ((fn: () => void, _ms: number) => {
      captured.push(fn)
      return { unref() {}, ref() {}, hasRef: () => false, refresh() { return this }, [Symbol.toPrimitive]: () => 0 } as unknown as NodeJS.Timeout
    }) as unknown as typeof setInterval
    const warns: string[] = []
    const svc = Object.create(TerminalAgentService.prototype) as TerminalAgentService & Record<string, unknown>
    svc['logger'] = { warn: (line: string) => warns.push(line), log: () => undefined, error: () => undefined }
    svc['prisma'] = {
      $transaction: async () => {
        throw Object.assign(new Error('Transaction API error: Unable to start a transaction in the given time. 13800138000'), { code: 'P2028' })
      },
    }
    const prevSeed = process.env['ENABLE_TEST_PRINT_TASK_SEED']
    delete process.env['ENABLE_TEST_PRINT_TASK_SEED']
    try {
      await svc.onModuleInit()
    } finally {
      ;(global as { setInterval: unknown }).setInterval = realSetInterval
      if (prevSeed !== undefined) process.env['ENABLE_TEST_PRINT_TASK_SEED'] = prevSeed
    }
    assert.equal(captured.length, 1, '应装上一个回收定时器')
    captured[0]!()
    captured[0]!()
    await sleep(30)
    assert.equal(warns.length, 2, `两次失败应各记一行 warn，实际 ${warns.length}`)
    assert.ok(warns.every((line) => line.startsWith('RESET_EXPIRED_CLAIMS_FAILED') && line.includes('code=P2028')), warns.join(' | '))
    assert.ok(warns.every((line) => !line.includes('13800138000')), '日志不得带 message 原文')
    assert.equal(unhandled.length, 0, `不得产生未处理拒绝，实际 ${unhandled.length}`)
    pass('P2028 只记一行 warn，进程与定时器都还在')
  }

  process.off('unhandledRejection', counter)

  console.log('\n[4] 进程级兜底：未处理拒绝 → 日志 + 告警，不含原文，不退出')
  {
    const logs: string[] = []
    const alerts: Array<{ summary: string; hour: string }> = []
    const uninstall = installUnhandledRejectionGuard({
      log: (line) => logs.push(line),
      alert: async (summary, hour) => { alerts.push({ summary, hour }) },
      now: () => new Date('2026-10-06T07:15:00.000Z'),
    })
    void Promise.reject(Object.assign(new Error('秘密：用户 张三 13800138000'), { code: 'P2028' }))
    await sleep(30)
    uninstall()
    assert.equal(logs.length, 1, `应记一行，实际 ${logs.length}`)
    assert.ok(logs[0]!.startsWith('UNHANDLED_REJECTION') && logs[0]!.includes('code=P2028'), logs[0])
    assert.equal(alerts.length, 1, '应推一次告警')
    assert.equal(alerts[0]!.hour, '2026-10-06T07', '告警按小时分回合')
    for (const text of [logs[0]!, alerts[0]!.summary]) {
      assert.ok(!text.includes('13800138000') && !text.includes('张三'), '日志与告警不得含 message 原文')
    }
    assert.equal(process.listenerCount('unhandledRejection'), 0, '卸载后不应残留监听')
    pass('未处理拒绝被记下并告警，原文不外泄，卸载干净')
  }

  console.log(`\n=== ALL PASS (${passed}) ===`)
}

main().catch((error) => {
  console.error('VERIFY FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
})
