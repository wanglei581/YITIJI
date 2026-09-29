/**
 * verify:print-truth-hardening — 2026-09-05 硬件链路收口（AGT-02 / AGT-03）的行为门禁。
 *
 * 纯进程内：注入 download / wait 函数，不碰网络、打印机、SQLite。
 *   1. downloadWithRetry：网络层错误与 5xx 按 2s/5s/10s 退避重试，第 4 次仍失败才抛；
 *      4xx 立即失败不重试；成功即停。
 *   2. computeMonitorTimeoutMs：预热 90s + 面数 × 每面秒数（黑白 3s、彩色 4s、黑白双面 6s、彩色双面 8s），
 *      未知取值按 8s，封顶 15 分钟，且小于服务端 printing 未确认时限（20 分钟）。
 *   3. 源码契约：任务执行器用 computeMonitorTimeoutMs 而不是写死 30_000；
 *      PRINT_TIMEOUT 走队列监控而不是直接 failed；日志不落原始文件名。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { computeMonitorTimeoutMs, downloadWithRetry, monitorPrintJob } from '../src/agent/task-runner'
import { PRINT_MAX_SIDES_PER_ORDER, PRINT_MONITOR_CAP_MS, worstCaseDuplexColorTimeoutMs } from '../src/agent/print-monitor-timeout'

function axiosError(status: number | undefined): Error {
  const error = new axios.AxiosError(`http ${status ?? 'network'}`)
  if (status !== undefined) {
    error.response = { status } as never
  }
  return error
}

async function main(): Promise<void> {
  // ── 1. downloadWithRetry ──────────────────────────────────────────────────
  {
    const waits: number[] = []
    let calls = 0
    await downloadWithRetry('https://example.invalid/f', '/tmp/x', 'task-a', {
      download: async () => {
        calls += 1
        if (calls < 3) throw axiosError(undefined)
      },
      wait: async (ms) => { waits.push(ms) },
    })
    assert.equal(calls, 3, 'network errors must be retried until success')
    assert.deepEqual(waits, [2_000, 5_000], 'backoff must be 2s then 5s before the successful third attempt')
  }
  {
    const waits: number[] = []
    let calls = 0
    await assert.rejects(
      downloadWithRetry('https://example.invalid/f', '/tmp/x', 'task-b', {
        download: async () => { calls += 1; throw axiosError(503) },
        wait: async (ms) => { waits.push(ms) },
      }),
      /http 503/,
    )
    assert.equal(calls, 4, '5xx must be attempted 4 times in total')
    assert.deepEqual(waits, [2_000, 5_000, 10_000], 'three backoff waits before giving up')
  }
  {
    let calls = 0
    await assert.rejects(
      downloadWithRetry('https://example.invalid/f', '/tmp/x', 'task-c', {
        download: async () => { calls += 1; throw axiosError(401) },
        wait: async () => { throw new Error('must not wait on 4xx') },
      }),
      /http 401/,
    )
    assert.equal(calls, 1, '4xx (expired signature / missing file) must fail immediately')
  }

  // ── 2. computeMonitorTimeoutMs ────────────────────────────────────────────
  assert.equal(computeMonitorTimeoutMs(undefined, undefined), 93_000, 'unknown pages/copies fall back to one simplex side plus warmup')
  assert.equal(computeMonitorTimeoutMs(1, 1), 93_000)
  assert.equal(computeMonitorTimeoutMs(3, 1), 99_000)
  assert.equal(computeMonitorTimeoutMs(30, 2), 270_000, '30 pages × 2 copies = 60 simplex sides → 90s + 180s')
  assert.equal(computeMonitorTimeoutMs(500, 5), PRINT_MONITOR_CAP_MS, 'window is capped at 15 minutes')
  assert.equal(computeMonitorTimeoutMs(0, -1), 93_000, 'non-positive inputs fall back to one side')
  assert.equal(computeMonitorTimeoutMs(Number.NaN, 2), 96_000, 'NaN pages fall back to 1 page but honour copies')
  assert.equal(computeMonitorTimeoutMs(1, 1, { colorMode: 'color', duplex: 'simplex' }), 94_000)
  assert.equal(computeMonitorTimeoutMs(1, 1, { colorMode: 'black_white', duplex: 'duplex_long_edge' }), 96_000)
  assert.equal(computeMonitorTimeoutMs(1, 1, { colorMode: 'color', duplex: 'duplex_short_edge' }), 98_000, 'color and duplex use the 8s tier')
  assert.equal(computeMonitorTimeoutMs(1, 1, { colorMode: ' Color ', duplex: ' Duplex_Long_Edge ' }), 98_000)
  assert.equal(computeMonitorTimeoutMs(1, 1, { colorMode: 'nope', duplex: 'simplex' }), 98_000, 'unknown values use the slowest tier')
  assert.equal(computeMonitorTimeoutMs(1, 1, { colorMode: '  ', duplex: '' }), 93_000, 'blank values stay simplex black and white')
  assert.equal(computeMonitorTimeoutMs(100, 1, { colorMode: 'color', duplex: 'duplex_long_edge' }), 890_000)
  assert.equal(worstCaseDuplexColorTimeoutMs(), 890_000)
  assert.equal(PRINT_MAX_SIDES_PER_ORDER, 100)
  assert.equal(computeMonitorTimeoutMs(101, 1, { colorMode: 'color', duplex: 'duplex_long_edge' }), 898_000, '101 sides are not rejected here')
  assert.ok(computeMonitorTimeoutMs(9_999, 9_999) === PRINT_MONITOR_CAP_MS)
  assert.ok(PRINT_MONITOR_CAP_MS < 20 * 60_000)
  const hundred = await monitorHundredDuplexColorSides()
  assert.equal(hundred.failed, false)
  assert.notEqual(hundred.errorCode, 'PRINT_JOB_UNCONFIRMED')

  // ── 3. 源码契约 ───────────────────────────────────────────────────────────
  const source = fs.readFileSync(path.join(__dirname, '../src/agent/task-runner.ts'), 'utf8')
  assert.match(source, /computeMonitorTimeoutMs\(task\.billablePages, task\.params\?\.copies, task\.params\)/, 'monitor window must be derived from pages × copies and print params')
  assert.doesNotMatch(source, /monitorPrintJob\([\s\S]{0,120}\n\s+30_000,/, 'monitor window must not be a hard-coded 30s')
  assert.match(source, /dispatchTimedOut = !result\.success && result\.errorCode === 'PRINT_TIMEOUT'/, 'PRINT_TIMEOUT must fall through to queue monitoring')
  assert.match(source, /await downloadWithRetry\(/, 'download must go through the retry helper')
  assert.doesNotMatch(source, /name=\$\{task\.fileName/, 'logs must not contain the raw file name')
  const scanSource = fs.readFileSync(path.join(__dirname, '../src/agent/scan-watcher.ts'), 'utf8')
  assert.doesNotMatch(scanSource, /(log|warn|err)\([^\n]*\$\{(filename|name)\}/, 'scan-watcher logs must mask file names')
  assert.doesNotMatch(scanSource, /base\.slice\(0,\s*2\)/, 'maskScanName must not keep a filename prefix')
  assert.match(scanSource, /return `\*\*\*\(\$\{base\.length\}\)\$\{ext\}`/, 'maskScanName must emit ***(len)+ext only')
  assert.match(scanSource, /STABILITY_REQUIRED_CONSECUTIVE = 3/, 'scan stability must require three consecutive identical snapshots')

  verifyTimeoutOrderingMutations()
  console.log('ALL PASS: print truth hardening (download retry, monitor window, log masking)')
}

async function monitorHundredDuplexColorSides(): Promise<{ failed: boolean; errorCode: string }> {
  let now = 0
  const timeoutMs = computeMonitorTimeoutMs(100, 1, { colorMode: 'color', duplex: 'duplex_long_edge' })
  const outcome = await monitorPrintJob('Printer', 'task-100', timeoutMs, 6_000, {
    platform: 'win32',
    now: () => now,
    sleep: async (ms) => { now += ms },
    dispatchedAtMs: 0,
    queryCompletionEvent: async () => false,
    queryStatus: async () => (now >= 100 * 8_000 ? { status: 'completed' } : { status: 'printing' }),
  })
  assert.ok(now >= 800_000 && now <= timeoutMs, 'the clock must reach the conservative finish inside the window')
  return outcome
}

const timeoutChild = `
const fs = require('fs')
const { worstCaseDuplexColorTimeoutMs, PRINT_MONITOR_CAP_MS, PRINT_MAX_SIDES_PER_ORDER, computeMonitorTimeoutMs } = require('./src/agent/print-monitor-timeout')
const { monitorPrintJob } = require('./src/agent/task-runner')
const server = fs.readFileSync('../../services/api/src/terminals/terminals-agent.service.ts', 'utf8')
const match = server.match(/PRINTING_UNCONFIRMED_TIMEOUT_MS = (\\d+) \\* 60 \\* 1000/)
if (!match) process.exit(1)
const serverMs = Number(match[1]) * 60 * 1000
const worst = worstCaseDuplexColorTimeoutMs()
if (PRINT_MAX_SIDES_PER_ORDER !== 100) process.exit(1)
if (worst !== 890000) process.exit(1)
if (worst > PRINT_MONITOR_CAP_MS) process.exit(1)
if (!(PRINT_MONITOR_CAP_MS < serverMs)) process.exit(1)
if (!(worst > 5 * 60 * 1000)) process.exit(1)
const nope = computeMonitorTimeoutMs(1, 1, { colorMode: 'Nope', duplex: 'simplex' })
if (nope !== 98000) process.exit(1)
const spaced = computeMonitorTimeoutMs(1, 1, { colorMode: ' Color ', duplex: ' duplex_short_edge ' })
if (spaced !== 98000) process.exit(1)
const blank = computeMonitorTimeoutMs(1, 1, { colorMode: '  ', duplex: '' })
if (blank !== 93000) process.exit(1)
;(async () => {
  let now = 0
  const timeoutMs = computeMonitorTimeoutMs(100, 1, { colorMode: 'color', duplex: 'duplex_long_edge' })
  const outcome = await monitorPrintJob('Printer', 'task-100', timeoutMs, 6000, {
    platform: 'win32',
    now: () => now,
    sleep: async (ms) => { now += ms },
    dispatchedAtMs: 0,
    queryCompletionEvent: async () => false,
    queryStatus: async () => (now >= 100 * 8000 ? { status: 'completed' } : { status: 'printing' }),
  })
  if (outcome.failed || outcome.errorCode === 'PRINT_JOB_UNCONFIRMED') process.exit(1)
  if (!(now >= 800000 && now <= timeoutMs)) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

function verifyTimeoutOrderingMutations(): void {
  const agentRoot = path.join(__dirname, '..')
  const timeoutPath = path.join(agentRoot, 'src/agent/print-monitor-timeout.ts')
  const serverPath = path.join(agentRoot, '../../services/api/src/terminals/terminals-agent.service.ts')
  const timeoutSource = fs.readFileSync(timeoutPath, 'utf8')
  const serverSource = fs.readFileSync(serverPath, 'utf8')
  const run = () => spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', timeoutChild], {
    cwd: agentRoot,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  })
  assert.equal(run().status, 0, 'timeout ordering child must pass before mutations')
  const mutations: Array<[string, string, string, string]> = [
    ['server timeout back to 10 minutes', serverPath, 'export const PRINTING_UNCONFIRMED_TIMEOUT_MS = 20 * 60 * 1000', 'export const PRINTING_UNCONFIRMED_TIMEOUT_MS = 10 * 60 * 1000'],
    ['agent cap at least 20 minutes', timeoutPath, 'export const PRINT_MONITOR_CAP_MS = 15 * 60_000', 'export const PRINT_MONITOR_CAP_MS = 20 * 60_000'],
    ['color duplex side fast enough to miss the 890s worst case', timeoutPath, 'const COLOR_DUPLEX_SIDE_MS = 8_000', 'const COLOR_DUPLEX_SIDE_MS = 1_000'],
    ['unknown print params use the fastest tier', timeoutPath, 'if (!colorKnown || !duplexKnown) return COLOR_DUPLEX_SIDE_MS', 'if (!colorKnown || !duplexKnown) return SIMPLEX_BW_SIDE_MS'],
  ]
  for (const [label, file, from, to] of mutations) {
    const original = file === serverPath ? serverSource : timeoutSource
    assert.ok(original.includes(from), `${label}: anchor missing`)
    fs.writeFileSync(file, original.replace(from, to))
    try {
      const result = run()
      assert.notEqual(result.status, 0, `${label}: reversed ordering must fail`)
    } finally {
      fs.writeFileSync(file, original)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
