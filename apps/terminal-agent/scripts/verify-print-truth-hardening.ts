/**
 * verify:print-truth-hardening — 2026-09-05 硬件链路收口（AGT-02 / AGT-03）的行为门禁。
 *
 * 纯进程内：注入 download / wait 函数，不碰网络、打印机、SQLite。
 *   1. downloadWithRetry：网络层错误与 5xx 按 2s/5s/10s 退避重试，第 4 次仍失败才抛；
 *      4xx 立即失败不重试；成功即停。
 *   2. computeMonitorTimeoutMs：30s 基线 + 每面 3s，按 页数×份数 放大，封顶 5 分钟，
 *      缺省/非法输入回落 1 页 1 份；上限必须小于服务端 printing 超时（10 分钟）。
 *   3. 源码契约：任务执行器用 computeMonitorTimeoutMs 而不是写死 30_000；
 *      PRINT_TIMEOUT 走队列监控而不是直接 failed；日志不落原始文件名。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import axios from 'axios'
import { computeMonitorTimeoutMs, downloadWithRetry } from '../src/agent/task-runner'

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
  assert.equal(computeMonitorTimeoutMs(undefined, undefined), 33_000, 'unknown pages/copies fall back to one sheet')
  assert.equal(computeMonitorTimeoutMs(1, 1), 33_000)
  assert.equal(computeMonitorTimeoutMs(3, 1), 39_000)
  assert.equal(computeMonitorTimeoutMs(30, 2), 210_000, '30 pages × 2 copies = 60 sheets → 30s + 180s')
  assert.equal(computeMonitorTimeoutMs(500, 5), 300_000, 'window is capped at 5 minutes')
  assert.equal(computeMonitorTimeoutMs(0, -1), 33_000, 'non-positive inputs fall back to one sheet')
  assert.equal(computeMonitorTimeoutMs(Number.NaN, 2), 36_000, 'NaN pages fall back to 1 page but honour copies')
  assert.ok(computeMonitorTimeoutMs(9_999, 9_999) < 10 * 60_000, 'cap must stay below the server printing timeout (10 min)')

  // ── 3. 源码契约 ───────────────────────────────────────────────────────────
  const source = fs.readFileSync(path.join(__dirname, '../src/agent/task-runner.ts'), 'utf8')
  assert.match(source, /computeMonitorTimeoutMs\(task\.billablePages, task\.params\?\.copies\)/, 'monitor window must be derived from pages × copies')
  assert.doesNotMatch(source, /monitorPrintJob\([\s\S]{0,120}\n\s+30_000,/, 'monitor window must not be a hard-coded 30s')
  assert.match(source, /dispatchTimedOut = !result\.success && result\.errorCode === 'PRINT_TIMEOUT'/, 'PRINT_TIMEOUT must fall through to queue monitoring')
  assert.match(source, /await downloadWithRetry\(/, 'download must go through the retry helper')
  assert.doesNotMatch(source, /name=\$\{task\.fileName/, 'logs must not contain the raw file name')
  const scanSource = fs.readFileSync(path.join(__dirname, '../src/agent/scan-watcher.ts'), 'utf8')
  assert.doesNotMatch(scanSource, /(log|warn|err)\([^\n]*\$\{filename\}/, 'scan-watcher logs must mask file names')
  assert.match(scanSource, /STABILITY_REQUIRED_CONSECUTIVE = 3/, 'scan stability must require three consecutive identical snapshots')

  console.log('ALL PASS: print truth hardening (download retry, monitor window, log masking)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
