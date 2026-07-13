import assert from 'node:assert/strict'
import http from 'node:http'
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  readFileSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sweepUnclaimedDir,
  processCandidate,
  UNCLAIMED_MAX_AGE_MS,
  DELIVERY_RETRY_MAX_MS,
} from '../src/agent/scan-watcher'
import type { AgentConfig } from '../src/agent/types'

// 本脚本分两部分：
//   Part 1：源码结构性断言（chokidar 实时监听 wiring——ignoreInitial / ignored /
//     setInterval——不适合在一次性 verify 脚本里真的启动持久监听器和事件循环，
//     保持静态检查）。
//   Part 2：真实调用 sweepUnclaimedDir / processCandidate——真实临时目录、真实
//     backdate 过的 mtime、真实 HTTP stub 后端，不是纯推理/静态断言。
//
// chokidar 的真实实时监听行为（watcher.on('add') 触发）需要 Windows 真机 /
// 长驻进程验收覆盖，不在本脚本中伪装通过。

const source = readFileSync(join(__dirname, '../src/agent/scan-watcher.ts'), 'utf8')

function verifySourceStructure(): void {
  assert.match(source, /export function startScanWatcher/, 'must export startScanWatcher')
  assert.match(source, /scanWatchFolder\?\.trim\(\)/, 'must treat unconfigured scanWatchFolder as a no-op, not a crash')
  assert.match(source, /ignoreInitial:\s*true/, 'chokidar watch must ignore pre-existing files at boot (handled separately by sweepFolder)')
  assert.match(source, /setInterval\(\(\) => void sweepFolder/, 'must periodically re-sweep the folder, not rely solely on chokidar change events for retries')
  assert.match(source, /ignored:\s*\(path: string\) => path\.includes\(UNCLAIMED_DIRNAME\)/, 'chokidar watch must also exclude the _unclaimed quarantine directory from live-watch events')
  assert.match(source, /if \(name === UNCLAIMED_DIRNAME\) continue/, 'sweepFolder must skip the _unclaimed quarantine directory itself in its main-file loop')
  assert.match(source, /const inFlightPaths\s*=\s*new Set<string>\(\)/, 'must have an in-flight path tracking Set to prevent concurrent double-processing of the same file')
  assert.match(source, /\}\s*finally\s*\{\s*inFlightPaths\.delete\(filePath\)/, 'the in-flight marker must be released in a finally block so it is cleared even when processing throws')

  // B1-7 加固：两个新常量必须存在且以 mtime 为判据（不是新增独立状态记录）。
  assert.match(source, /export const UNCLAIMED_MAX_AGE_MS\s*=/, 'must define an _unclaimed max-age constant')
  assert.match(source, /export const DELIVERY_RETRY_MAX_MS\s*=/, 'must define a delivery retry-cap constant')
  assert.match(source, /sweepUnclaimedDir\(scanWatchFolder\)/, 'sweepFolder must invoke the _unclaimed cleanup on every periodic sweep')
  assert.match(source, /statSync\(filePath\)\.mtime\.getTime\(\)/, 'retry-cap decision must be derived from the file\'s own mtime, not a new tracking mechanism')

  console.log('PASS scan-watcher source structure checks')
}

// ── Part 2a: sweepUnclaimedDir — 真实临时目录 + backdate 过的 mtime ──────────

function backdateMtime(filePath: string, ageMs: number): void {
  const past = new Date(Date.now() - ageMs)
  utimesSync(filePath, past, past)
}

function captureWarnLogs(fn: () => void): { stdout: string } {
  const original = process.stdout.write.bind(process.stdout)
  let stdout = ''
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    fn()
  } finally {
    process.stdout.write = original
  }
  return { stdout }
}

async function captureLogsAsync(fn: () => Promise<void>): Promise<{ stdout: string }> {
  const original = process.stdout.write.bind(process.stdout)
  let stdout = ''
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    await fn()
  } finally {
    process.stdout.write = original
  }
  return { stdout }
}

function verifyUnclaimedCleanup(): void {
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-unclaimed-'))
  try {
    const unclaimedDir = join(scanFolder, '_unclaimed')
    mkdirSync(unclaimedDir)

    // 计划文档给出的两个具体样例：25 小时前（必须删）与 1 小时前（必须留）。
    const staleSecret = 'STALE-ID-CARD-CONTENT-MUST-NOT-APPEAR-IN-LOGS'
    writeFileSync(join(unclaimedDir, 'stale-25h.pdf'), staleSecret)
    backdateMtime(join(unclaimedDir, 'stale-25h.pdf'), 25 * 60 * 60 * 1000)

    writeFileSync(join(unclaimedDir, 'fresh-1h.pdf'), 'fresh content')
    backdateMtime(join(unclaimedDir, 'fresh-1h.pdf'), 1 * 60 * 60 * 1000)

    // 边界加固：卡在阈值两侧一点点的文件，防止实现把比较写反（>= vs >）或
    // 写死成与 24h 不同的值时仍然“恰好”通过上面两个宽松样例。
    writeFileSync(join(unclaimedDir, 'just-under-threshold.pdf'), 'x')
    backdateMtime(join(unclaimedDir, 'just-under-threshold.pdf'), UNCLAIMED_MAX_AGE_MS - 5 * 60 * 1000)

    writeFileSync(join(unclaimedDir, 'just-over-threshold.pdf'), 'x')
    backdateMtime(join(unclaimedDir, 'just-over-threshold.pdf'), UNCLAIMED_MAX_AGE_MS + 5 * 60 * 1000)

    // 目录本身（例如未来误建的子目录）不得被当成文件处理导致抛错。
    mkdirSync(join(unclaimedDir, 'a-subdir'))

    const { stdout } = captureWarnLogs(() => sweepUnclaimedDir(scanFolder))

    assert.equal(
      existsSync(join(unclaimedDir, 'stale-25h.pdf')),
      false,
      'a file idle 25h in _unclaimed (older than the 24h threshold) must be deleted',
    )
    assert.equal(
      existsSync(join(unclaimedDir, 'fresh-1h.pdf')),
      true,
      'a file idle only 1h in _unclaimed (well under the 24h threshold) must be kept',
    )
    assert.equal(
      existsSync(join(unclaimedDir, 'just-under-threshold.pdf')),
      true,
      'a file just under the 24h threshold must survive (boundary must not delete too early)',
    )
    assert.equal(
      existsSync(join(unclaimedDir, 'just-over-threshold.pdf')),
      false,
      'a file just over the 24h threshold must be deleted (boundary must not keep it forever)',
    )
    assert.equal(existsSync(join(unclaimedDir, 'a-subdir')), true, 'sweepUnclaimedDir must not touch subdirectories')

    // 日志必须报告文件名 + 滞留时长，绝不能把文件内容写进日志。
    assert.match(stdout, /stale-25h\.pdf/, 'cleanup log must mention the deleted filename')
    assert.doesNotMatch(stdout, new RegExp(staleSecret), 'cleanup log must never include file content')

    console.log('PASS sweepUnclaimedDir real-fs checks (age threshold boundary, subdir safety, no content in logs)')
  } finally {
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

// ── Part 2b: processCandidate 重试上限 — 真实 HTTP stub 后端 ─────────────────

async function startFailingBackendStub(errorCode: string): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    // 消费请求体，避免连接挂起。
    req.on('data', () => undefined)
    req.on('end', () => {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: { code: errorCode, message: 'simulated failure' } }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(typeof address === 'object' && address, 'backend stub must bind to a TCP port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

function makeConfig(apiBaseUrl: string, scanWatchFolder: string): AgentConfig {
  return {
    apiBaseUrl,
    terminalCode: 'T-SCAN-VERIFY',
    printerName: 'Test Printer',
    agentVersion: 'verify',
    terminalId: 'terminal-scan-1',
    agentToken: 'agent-token-secret',
    scanWatchFolder,
  }
}

async function verifyRetryCapExpired(): Promise<void> {
  // 后端持续返回一个"不是 NO_WAITING_SCAN_TASK"的错误码 —— 模拟投递反复失败的真实情况。
  const backend = await startFailingBackendStub('SIMULATED_OTHER_FAILURE')
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-retry-expired-'))
  try {
    const filename = 'expired-retry.pdf'
    const filePath = join(scanFolder, filename)
    // 稳定性检查要求文件大小连续两次读取一致；写一次即可（大小不再变化）。
    writeFileSync(filePath, '%PDF-1.4 stale delivery attempt')
    // mtime 设为 3 小时前，超过 DELIVERY_RETRY_MAX_MS（2 小时）。
    backdateMtime(filePath, DELIVERY_RETRY_MAX_MS + 60 * 60 * 1000)

    const config = makeConfig(backend.baseUrl, scanFolder)
    const { stdout: capturedStdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

    assert.equal(existsSync(filePath), false, 'an expired-retry file must be moved out of the main scan folder')
    const unclaimedPath = join(scanFolder, '_unclaimed', filename)
    assert.equal(existsSync(unclaimedPath), true, 'an expired-retry file must land in _unclaimed instead of being deleted or left in place')
    assert.equal(
      readFileSync(unclaimedPath, 'utf8'),
      '%PDF-1.4 stale delivery attempt',
      'quarantined file content must be preserved (renameSync, not a lossy copy)',
    )

    assert.match(capturedStdout, /retry timeout exceeded/, 'log must clearly say this was a retry-timeout abandonment')
    assert.doesNotMatch(
      capturedStdout,
      /no waiting scan task/,
      'retry-timeout log wording must NOT reuse the NO_WAITING_SCAN_TASK wording, so the two _unclaimed causes stay distinguishable',
    )

    console.log('PASS processCandidate retry-cap: expired file (>2h old, repeatedly failing) is quarantined with distinguishable log wording')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

async function verifyRetryCapNotYetExpired(): Promise<void> {
  const backend = await startFailingBackendStub('SIMULATED_OTHER_FAILURE')
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-retry-fresh-'))
  try {
    const filename = 'recent-retry.pdf'
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, '%PDF-1.4 recent delivery attempt')
    // mtime 只有 30 分钟前，远低于 2 小时上限 —— 必须继续留在原地等下一轮 sweep 重试。
    backdateMtime(filePath, 30 * 60 * 1000)

    const config = makeConfig(backend.baseUrl, scanFolder)
    await processCandidate(filePath, filename, config)

    assert.equal(existsSync(filePath), true, 'a recently-failing file (well under the 2h retry cap) must stay in the main folder for the next sweep, not be quarantined early')
    assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), false, 'a recently-failing file must NOT be moved to _unclaimed yet')

    console.log('PASS processCandidate retry-cap: fresh failing file (<2h old) stays in place for the next sweep (not vacuously quarantined)')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

async function verifyNoWaitingTaskStillDistinctFromRetryTimeout(): Promise<void> {
  // 回归护栏：真正的"无等待任务"分支即使文件很新也必须立刻隔离，且日志措辞
  // 与"重试超时"不同——防止未来重构把两条分支的措辞合并到一起。
  const backend = await startFailingBackendStub('NO_WAITING_SCAN_TASK')
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-no-waiting-task-'))
  try {
    const filename = 'no-task-yet.pdf'
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, '%PDF-1.4 brand new scan')
    // mtime 几乎是现在——远低于任何重试上限，验证 NO_WAITING_SCAN_TASK 分支
    // 不依赖 mtime，立即隔离。

    const config = makeConfig(backend.baseUrl, scanFolder)
    const { stdout: capturedStdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

    assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), true, 'NO_WAITING_SCAN_TASK must still quarantine immediately regardless of file age')
    assert.match(capturedStdout, /no waiting scan task/, 'NO_WAITING_SCAN_TASK log wording must be preserved')
    assert.doesNotMatch(capturedStdout, /retry timeout exceeded/, 'NO_WAITING_SCAN_TASK path must not be confused with the retry-timeout path in logs')

    console.log('PASS processCandidate: NO_WAITING_SCAN_TASK path remains immediate and distinguishable from the new retry-timeout path')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

function verifyPlatformGapDisclosure(): void {
  console.log(
    'NOTE: chokidar 实时 add 事件触发 processCandidate 的路径（startScanWatcher 内部）未在本脚本中真实启动持久监听器，' +
      '仍按既有约定保持静态结构检查；真实长驻监听行为需 Windows 真机 / 长时间运行验收覆盖。',
  )
}

async function main(): Promise<void> {
  verifySourceStructure()
  verifyUnclaimedCleanup()
  await verifyRetryCapExpired()
  await verifyRetryCapNotYetExpired()
  await verifyNoWaitingTaskStillDistinctFromRetryTimeout()
  verifyPlatformGapDisclosure()
  console.log('verify-scan-watcher: ok')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
