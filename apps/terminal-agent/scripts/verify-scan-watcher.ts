import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import http from 'node:http'
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  readFileSync,
  utimesSync,
  chmodSync,
  linkSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import {
  sweepUnclaimedDir,
  processCandidate,
  startScanWatcher,
  maskScanName,
  UNCLAIMED_MAX_AGE_MS,
  DELIVERY_RETRY_MAX_MS,
} from '../src/agent/scan-watcher'
import type { AgentConfig } from '../src/agent/types'
import { runOverlappingStartupBacklogRaceTest, runScanLeaseBarrierTests } from './scan-lease-barrier.helper'

const STARTUP_BACKLOG_PREMARK_BLOCK = `  // ATOMIC_STARTUP_BACKLOG_PREMARK: every direct-child path is marked before any
  // await so watcher add/sweep/process cannot deliver a later sibling.
  for (const name of entries) {
    if (name === UNCLAIMED_DIRNAME) continue
    const fullPath = join(folder, name)
    if (!isDirectChild(fullPath, name, folder)) continue
    startupBacklogPaths.add(resolve(fullPath))
  }

`

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
  assert.match(source, /const startupBacklogPaths\s*=\s*new Set<string>\(\)/, 'must have a startup backlog path tracking Set for never-deliver enforcement')
  assert.match(source, /if\s*\(\s*startupBacklogPaths\.has\(resolvedCandidatePath\)\s*\)/, 'processCandidate must check startupBacklogPaths to prevent delivery')
  assert.match(source, /startupBacklogPaths\.delete\(resolvedCandidatePath\)/, 'must clear backlog marker upon successful quarantine')
  {
    const isolateStart = source.indexOf('export async function isolateStartupBacklog')
    const isolateEnd = source.indexOf('export function startScanWatcher')
    assert.ok(isolateStart >= 0 && isolateEnd > isolateStart, 'isolateStartupBacklog must precede startScanWatcher')
    const isolateBody = source.slice(isolateStart, isolateEnd)
    const readdirIdx = isolateBody.indexOf('readdirSync(folder)')
    const premarkIdx = isolateBody.indexOf('ATOMIC_STARTUP_BACKLOG_PREMARK')
    const firstAwaitIdx = isolateBody.indexOf('await waitForStableFile')
    assert.ok(readdirIdx >= 0, 'isolateStartupBacklog must readdirSync the folder')
    assert.ok(premarkIdx > readdirIdx, 'premark-all must run after readdir')
    assert.ok(firstAwaitIdx > premarkIdx, 'premark-all must complete before any await')
    assert.equal(
      isolateBody.slice(readdirIdx, premarkIdx).includes('await'),
      false,
      'no await may appear between readdir and premark-all',
    )
    assert.equal(
      isolateBody.includes(STARTUP_BACKLOG_PREMARK_BLOCK),
      true,
      'isolateStartupBacklog must synchronously premark every direct-child path before the first await',
    )
  }
  assert.match(
    source,
    /const trustedWindowsCandidate = readTrustedWindowsCandidate\(\s*scanWatchFolder,\s*filename,\s*stableSnapshot\s*\)/,
    'Windows candidate reads must cross the packaged same-handle trusted-reader boundary',
  )
  assert.match(source, /finalizeTrustedWindowsCandidate\(/, 'Windows delivery deletion and quarantine must use the native identity token')
  assert.match(source, /sweepTrustedWindowsUnclaimed\(/, 'Windows TTL deletion must use the native identity token')
  assert.match(source, /if \(process\.platform === 'win32'\) \{[\s\S]*?sweepTrustedWindowsUnclaimed/, 'Windows sweep must branch into the secure native mutation path')

  // 以下三条是 Critical code-review 之后新增的并发安全加固，但在本脚本里没有实际
  // 可行的方式做成真实动态用例（原因分别标注在各行），因此保留成本低的静态正则
  // 断言，作为"有人不小心删掉这段防御代码"时的廉价回归警报——不是运行时正确性证明。
  assert.match(
    source,
    /file disappeared before processing, skipping/,
    'must re-check file existence right before reading it (second existsSync, after the stability check), in case it vanished in that window',
  )
  // 无法动态触发：稳定性检查通过 → 二次 existsSync 复查之间只隔一次微任务恢复，
  // 外部测试代码没有可靠手段在这个窗口内精确插入一次文件删除。
  assert.match(
    source,
    /processCandidate\(filePath, filename, config\)\.catch\(/,
    'the chokidar add-event call site must attach .catch() since processCandidate is async but the event handler itself is not',
  )
  // 无法在本一次性脚本里动态触发：需要真实启动持久 chokidar 监听器并触发一次
  // 真实文件系统 add 事件，文件顶部注释已明确这类真实长驻监听行为交给 Windows
  // 真机 / 长驻进程验收覆盖，不在这里伪装通过。
  assert.match(
    source,
    /sweep failed to process \$\{maskScanName\(name\)\}, continuing with remaining files/,
    'sweepFolder must catch per-file errors so one bad file does not abort the rest of the sweep',
  )
  assert.match(
    source,
    /unsafe scan input candidate skipped during sweep — \$\{maskScanName\(name\)\}/,
    'sweepFolder skip logs must mask the scan file name',
  )
  assert.doesNotMatch(
    source,
    /base\.slice\(0,\s*2\)/,
    'maskScanName must not keep a filename prefix',
  )
  assert.equal(maskScanName('张三简历.pdf'), '***(4).pdf')
  assert.equal(maskScanName('ab.pdf'), '***(2).pdf')
  assert.equal(maskScanName('身份证扫描件.PNG'), '***(6).PNG')
  assert.equal(maskScanName('noext'), '***(5)')
  assert.equal(maskScanName('.hidden'), '***(7)')
  assert.doesNotMatch(maskScanName('张三简历.pdf'), /张/)
  assert.doesNotMatch(maskScanName('李四材料.pdf'), /^[^(*]/)
  // 无法动态触发：processCandidate 自身已经用一个吞掉一切异常的外层 catch 兜底
  // （见下面 verifyUnexpectedErrorOuterCatch），意味着通过 sweepFolder 的公开
  // 路径调用它时它实际上不会再向外抛出——这段 catch 目前是纯防御性代码，只能
  // 通过白盒 mock processCandidate 本身才能真正触发，不值得为此增加脆弱性。

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

async function captureLogsAsync(fn: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const originalStdout = process.stdout.write.bind(process.stdout)
  const originalStderr = process.stderr.write.bind(process.stderr)
  let stdout = ''
  let stderr = ''
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  // logger.err() writes to stderr (not stdout) — the outer-catch-all path uses
  // err(), so it must be captured too, or assertions against it would always
  // see an empty string and never actually check the log wording.
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await fn()
  } finally {
    process.stdout.write = originalStdout
    process.stderr.write = originalStderr
  }
  return { stdout, stderr }
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

    // 日志只报告安全化事件标识 + 滞留时长，不得记录可能含 PII 的文件名或内容。
    assert.match(
      stdout,
      /event=(?:[a-f0-9]{12}|untracked)/,
      'cleanup log must mention only a keyed event id or the safe audit-unavailable marker',
    )
    assert.doesNotMatch(stdout, /stale-25h\.pdf/, 'cleanup log must not include the filename')
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
      if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
        if (errorCode === 'NO_WAITING_SCAN_TASK') {
          res.writeHead(409, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ statusCode: 409, error: { code: 'NO_WAITING_SCAN_TASK', message: '当前终端没有等待扫描的任务' } }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            scanTaskId: 'scan-task-verify-1',
            serverNow: new Date().toISOString(),
            notBefore: new Date(Date.now() - 24 * 3600_000).toISOString(),
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            deliveryLease: 'test-delivery-lease-token',
          },
        }))
        return
      }
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

async function startGenericServerErrorStub(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            scanTaskId: 'scan-task-verify-1',
            serverNow: new Date().toISOString(),
            notBefore: new Date(Date.now() - 24 * 3600_000).toISOString(),
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            deliveryLease: 'test-delivery-lease-token',
          },
        }))
        return
      }
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end()
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

async function startSuccessBackendStub(
  onRequest?: (rawBody: string) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          success: true,
          data: {
            scanTaskId: 'scan-task-verify-1',
            serverNow: new Date().toISOString(),
            notBefore: new Date(Date.now() - 60_000).toISOString(),
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            deliveryLease: 'test-delivery-lease-token',
          },
        }))
        return
      }
      onRequest?.(Buffer.concat(chunks).toString('utf8'))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, data: { scanTaskId: 'scan-task-verify-1', fileId: 'file-verify-1' } }))
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

// ── Part 2c: processCandidate 成功投递路径 — 真实 HTTP 200 stub 后端 ──────────
// .mjs → .ts 转换时唯一真正的覆盖缺口：没有任何用例（静态或动态）跑过一次成功
// 投递（200 OK），也就没有任何用例验证过 unlinkSync(filePath) 这条"投递成功后删除
// 源文件"的核心隐私契约（扫描件不应该在共享目录里残留）。补上。
async function verifySuccessfulDeliveryDeletesSourceFile(): Promise<void> {
  let capturedBody = ''
  const backend = await startSuccessBackendStub((body) => {
    capturedBody = body
  })
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-success-'))
  try {
    const filename = 'success-delivery.pdf'
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, '%PDF-1.4 real content that must not linger on disk after delivery')

    const config = makeConfig(backend.baseUrl, scanFolder)
    const { stdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

    assert.equal(
      existsSync(filePath),
      false,
      'a successfully delivered file must be unlinkSync-ed from the main scan folder (privacy: no lingering scans)',
    )
    assert.equal(
      existsSync(join(scanFolder, '_unclaimed', filename)),
      false,
      'a successfully delivered file must NOT end up quarantined in _unclaimed',
    )
    assert.match(stdout, /delivered and removed source file/, 'success path must log that the source file was removed')
    assert.match(capturedBody, /name="scanTaskId"/, 'successful delivery multipart body must include scanTaskId field')
    assert.match(capturedBody, /name="deliveryLease"/, 'successful delivery multipart body must include deliveryLease field')
    assert.match(capturedBody, /name="candidateSnapshotAt"/, 'successful delivery multipart body must include candidateSnapshotAt field')
    assert.match(capturedBody, /name="observedAt"/, 'successful delivery multipart body must include observedAt field')

    console.log('PASS processCandidate success path: 200 OK delivery unlinkSync-es the source file and sends signed lease')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

// ── Part 2d: inFlightPaths 去重 — 并发调用同一路径只投递一次 ─────────────────
// processCandidate 在做任何异步等待之前，同步执行 has()/add()（第一次 await 落在
// waitForStableFile 内部的 setTimeout 上）。这意味着"背靠背同步调用两次
// processCandidate(同一 filePath)，不等待第一次的 Promise"可以确定性地复现
// Critical code-review 修复的那个并发场景，不依赖人为延时或猜时序。
// A scan-folder entry is attacker-controlled local input. It must never be
// possible to make the Agent read and deliver a file outside the folder by
// replacing a scanner output with a symbolic link.
async function verifySymbolicLinkCandidateNeverReachesDelivery(): Promise<void> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-symlink-'))
  const scanFolder = join(temporaryRoot, 'scan')
  mkdirSync(scanFolder)
  try {
    const outsideFile = join(temporaryRoot, 'outside-secret.pdf')
    const filename = 'scanner-output.pdf'
    const linkedPath = join(scanFolder, filename)
    writeFileSync(outsideFile, '%PDF-1.4 outside data that must never be read or delivered')
    symlinkSync(outsideFile, linkedPath, 'file')

    let deliveryCount = 0
    const config = makeConfig('http://127.0.0.1:1/api/v1', scanFolder)
    await processCandidate(linkedPath, filename, config, async () => {
      deliveryCount += 1
    })

    assert.equal(deliveryCount, 0, 'a symbolic-link candidate must be rejected before delivery')
    assert.equal(existsSync(linkedPath), true, 'rejecting an unsafe candidate must not unlink it')
    assert.match(readFileSync(outsideFile, 'utf8'), /outside data/, 'the outside target must remain untouched')
    console.log('PASS processCandidate scan boundary: symbolic-link candidates never reach delivery')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

async function verifyAlternateOutsideFileBypassesAreRejected(): Promise<void> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-boundary-bypass-'))
  const scanFolder = join(temporaryRoot, 'scan')
  mkdirSync(scanFolder)
  try {
    const outsideFile = join(temporaryRoot, 'outside-secret.pdf')
    writeFileSync(outsideFile, '%PDF-1.4 outside data')
    const hardLinkName = 'hard-linked-output.pdf'
    const hardLinkPath = join(scanFolder, hardLinkName)
    linkSync(outsideFile, hardLinkPath)

    let deliveryCount = 0
    const config = makeConfig('http://127.0.0.1:1/api/v1', scanFolder)
    await processCandidate(hardLinkPath, hardLinkName, config, async () => {
      deliveryCount += 1
    })
    await processCandidate(outsideFile, 'outside-secret.pdf', config, async () => {
      deliveryCount += 1
    })

    assert.equal(deliveryCount, 0, 'hard links and direct outside paths must both be rejected before delivery')
    assert.equal(existsSync(hardLinkPath), true, 'a rejected hard-link entry must remain for operator review')
    assert.equal(existsSync(outsideFile), true, 'the outside target must remain untouched')
    console.log('PASS processCandidate bypass review: hard links and direct outside paths never reach delivery')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

async function verifySupportedImageCandidatesStillDeliver(): Promise<void> {
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-images-'))
  try {
    const config = makeConfig('http://127.0.0.1:1/api/v1', scanFolder)
    for (const filename of ['scanner-output.jpg', 'scanner-output.JPEG', 'scanner-output.png']) {
      const filePath = join(scanFolder, filename)
      writeFileSync(filePath, 'real scanner image bytes')
      let deliveryCount = 0
      await processCandidate(filePath, filename, config, async () => {
        deliveryCount += 1
      })
      assert.equal(deliveryCount, 1, `${filename} must still reach the existing delivery sink`)
      assert.equal(existsSync(filePath), false, `${filename} must still be removed after successful delivery`)
    }
    console.log('PASS processCandidate compatibility: JPEG/JPG/PNG scans still deliver and are removed')
  } finally {
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

function verifyWindowsUnverifiableFolderBlocksWatcherStartup(): void {
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-windows-block-'))
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  assert.ok(platformDescriptor, 'process.platform must have a restorable descriptor')
  try {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' })
    const config = makeConfig('http://127.0.0.1:1/api/v1', scanFolder)
    const { stdout } = captureWarnLogs(() => {
      assert.equal(
        startScanWatcher(config),
        undefined,
        'Windows watcher startup must fail closed while reparse-point safety is unverifiable',
      )
    })
    assert.match(stdout, /scan input blocked; watcher not started — reparse_point_unverifiable/)
    console.log('PASS startScanWatcher Windows boundary: unverifiable reparse-point safety blocks startup')
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor)
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

async function verifyInFlightDedupSkipsConcurrentDuplicate(): Promise<void> {
  let requestCount = 0
  const backend = await startSuccessBackendStub(() => {
    requestCount += 1
  })
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-dedup-'))
  try {
    const filename = 'concurrent-scan.pdf'
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, '%PDF-1.4 must only be delivered once')

    const config = makeConfig(backend.baseUrl, scanFolder)

    // 故意不 await 第一次调用：两次调用在同一个事件循环 tick 内背靠背发起，
    // 第二次调用发起时 inFlightPaths 里必然已经同步 add 过第一次的 filePath。
    const first = processCandidate(filePath, filename, config)
    const second = processCandidate(filePath, filename, config)
    await Promise.all([first, second])

    assert.equal(
      requestCount,
      1,
      'two concurrent processCandidate calls for the same filePath must result in exactly one HTTP delivery — the in-flight guard must skip the second',
    )
    assert.equal(existsSync(filePath), false, 'the one delivery that did happen must still unlinkSync the source file')

    console.log('PASS processCandidate in-flight dedup: concurrent calls for the same path deliver exactly once, not twice')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

// ── Part 2e: processCandidate 外层兜底 catch — 真实不可读文件触发未预期错误 ──
// 稳定性检查、二次 existsSync 复查都只依赖 stat/exists，不需要读权限，所以给
// 文件 chmod 0o000 之后依然能通过前两关，直到 readFileSync(filePath) 真正因为
// EACCES 抛出——这条异常落在外层 try/catch 里（不是 HTTP 投递那层 inner try），
// 真实触发"未预期错误"分支，而不是靠字符串猜测源码里有没有这段兜底。
// 仅在拥有者确实没有读权限的宿主上才有意义（多数 CI/开发机如此）；以 root 身份
// 跑（会绕过权限位）则退化为跳过，避免因宿主环境差异导致误报失败。
async function verifyUnexpectedErrorOuterCatch(): Promise<void> {
  const backend = await startSuccessBackendStub()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-outer-catch-'))
  try {
    const filename = 'unreadable.pdf'
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, '%PDF-1.4 permission denied on purpose')
    chmodSync(filePath, 0o000)

    let permissionsEnforced = true
    try {
      readFileSync(filePath)
      permissionsEnforced = false
    } catch {
      // 期望路径：确认这个宿主真的会因为权限位拒绝读取。
    }
    if (!permissionsEnforced) {
      console.log('SKIP processCandidate outer-catch check: running with read access despite chmod 0o000 (likely root), cannot simulate an unreadable file on this host')
      return
    }

    const config = makeConfig(backend.baseUrl, scanFolder)
    const { stderr } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

    // err() (unlike warn()/log()) writes to stderr, not stdout — see captureLogsAsync.
    assert.match(
      stderr,
      /unexpected error processing candidate, leaving file in place for retry/,
      'an unreadable file must be caught by the outer catch-all and logged, not crash processCandidate',
    )
    assert.equal(
      existsSync(filePath),
      true,
      'a file that hit the unexpected-error path must remain in place in the main folder for retry (not deleted, not quarantined)',
    )

    console.log('PASS processCandidate outer catch-all: a real EACCES read failure is caught, logged, and leaves the file in place')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
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

async function verifyImmediateQuarantineForCode(
  errorCode: string,
  filename: string,
  content: string,
  expectedLog: RegExp,
  forbiddenLogs: RegExp[],
  scenarioLabel: string,
): Promise<void> {
  const backend = await startFailingBackendStub(errorCode)
  const scanFolder = mkdtempSync(join(tmpdir(), `scan-watcher-verify-${errorCode.toLowerCase()}-`))
  try {
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, content)

    const config = makeConfig(backend.baseUrl, scanFolder)
    const { stdout: capturedStdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

    assert.equal(existsSync(filePath), false, `a ${errorCode} file must be moved out of the main scan folder`)
    const unclaimedPath = join(scanFolder, '_unclaimed', filename)
    assert.equal(existsSync(unclaimedPath), true, `${errorCode} must quarantine to _unclaimed immediately`)
    assert.equal(readFileSync(unclaimedPath, 'utf8'), content)

    assert.match(capturedStdout, expectedLog)
    for (const forbidden of forbiddenLogs) {
      assert.doesNotMatch(capturedStdout, forbidden)
    }
    console.log(`PASS processCandidate: ${scenarioLabel} is quarantined immediately, with distinguishable log wording`)
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
  }
}

async function verifyScanTaskStateChangedQuarantinesImmediately(): Promise<void> {
  await verifyImmediateQuarantineForCode(
    'SCAN_TASK_STATE_CHANGED',
    'state-changed.pdf',
    '%PDF-1.4 matched-then-cancelled scan',
    /scan task state changed after match/,
    [/no waiting scan task/, /retry timeout exceeded/, /already delivered previously/],
    'SCAN_TASK_STATE_CHANGED',
  )
}

async function verifyScanFileAlreadyDeliveredQuarantinesImmediately(): Promise<void> {
  await verifyImmediateQuarantineForCode(
    'SCAN_FILE_ALREADY_DELIVERED',
    'already-delivered.pdf',
    '%PDF-1.4 lost-response duplicate retry',
    /already delivered previously/,
    [/no waiting scan task/, /retry timeout exceeded/, /scan task state changed after match/],
    'SCAN_FILE_ALREADY_DELIVERED',
  )
}

async function verifyScanFilePreviouslyAttemptedQuarantinesImmediately(): Promise<void> {
  await verifyImmediateQuarantineForCode(
    'SCAN_FILE_PREVIOUSLY_ATTEMPTED',
    'prev-attempt.pdf',
    '%PDF-1.4 previously attempted scan',
    /file content was previously attempted but not completed/,
    [/no waiting scan task/, /retry timeout exceeded/, /scan task state changed after match/, /already delivered previously/],
    'SCAN_FILE_PREVIOUSLY_ATTEMPTED',
  )
}

async function verifyScanFileStaleCaptureQuarantinesImmediately(): Promise<void> {
  await verifyImmediateQuarantineForCode(
    'SCAN_FILE_STALE_CAPTURE',
    'stale-capture.pdf',
    '%PDF-1.4 stale capture scan',
    /file capture is stale for current session/,
    [/no waiting scan task/, /retry timeout exceeded/, /scan task state changed after match/, /already delivered previously/],
    'SCAN_FILE_STALE_CAPTURE',
  )
}

// ── Part 2h: B1-11 回归护栏 — 真正无法识别的 5xx（无 error.code）必须继续走既有重试路径 ──
// 防止未来重构把匹配条件写宽（例如变成"任何非 2xx 都立即隔离"），意外吞掉合法的网络抖动/
// 后端瞬时故障重试能力。同时兼作 NO_RETRY_CONFIG 修复的回归护栏：一次真实 500 必须快速
// 失败（deliver POST 禁用了 axios 层自动重试），不能再触发 3 次内部重试导致的 30s×3 挂起。
async function verifyGenericServerErrorStillRetriesNormally(): Promise<void> {
  const backend = await startGenericServerErrorStub()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-verify-generic-5xx-'))
  try {
    const filename = 'generic-5xx.pdf'
    const filePath = join(scanFolder, filename)
    writeFileSync(filePath, '%PDF-1.4 transient backend failure')
    // mtime 只有 30 分钟前，远低于 2 小时重试上限。

    backdateMtime(filePath, 30 * 60 * 1000)
    const config = makeConfig(backend.baseUrl, scanFolder)
    const startedAt = Date.now()
    await processCandidate(filePath, filename, config)
    const elapsedMs = Date.now() - startedAt

    assert.equal(
      existsSync(filePath),
      true,
      'a generic 5xx with no recognizable error.code must stay in the main folder for the next sweep — must NOT be treated like SCAN_TASK_STATE_CHANGED / SCAN_FILE_ALREADY_DELIVERED / NO_WAITING_SCAN_TASK',
    )
    assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), false, 'a generic 5xx must NOT be quarantined early')
    assert.ok(
      elapsedMs < 5_000,
      `a real 5xx must fail fast now that deliver POST carries NO_RETRY_CONFIG (took ${elapsedMs}ms — axios-layer retry with the stale form-data stream would have taken 12s+)`,
    )

    console.log('PASS processCandidate: a raw 5xx with no structured error.code fails fast (NO_RETRY_CONFIG) and is left in place for the sweep-level retry, not treated as an immediate-quarantine cause')
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

function verifyPremarkAllMutationMakesOverlappingTestNonzero(): void {
  const watcherPath = join(__dirname, '../src/agent/scan-watcher.ts')
  const original = readFileSync(watcherPath, 'utf8')
  assert.equal(
    original.includes(STARTUP_BACKLOG_PREMARK_BLOCK),
    true,
    'premark-all block must exist before reverse mutation',
  )
  const mutated = original.replace(STARTUP_BACKLOG_PREMARK_BLOCK, '')
  assert.notEqual(mutated, original, 'removing premark-all must actually change scan-watcher.ts')
  try {
    writeFileSync(watcherPath, mutated)
    const childArgs = [...process.execArgv]
    if (process.argv[1] && resolvePath(process.argv[1]) !== resolvePath(__filename)) {
      childArgs.push(process.argv[1])
    }
    childArgs.push(__filename, '--overlapping-startup-backlog-race')
    const result = spawnSync(process.execPath, childArgs, {
      encoding: 'utf8',
      cwd: join(__dirname, '..'),
      timeout: 60_000,
      env: process.env,
    })
    const output = `${result.stdout}\n${result.stderr}`
    assert.notEqual(result.status, 0, `removing premark-all must make overlapping test nonzero\n${output}`)
    assert.match(
      output,
      /overlapping two-file race must NEVER request scan lease for the second file/,
      `mutated overlapping test must fail on nonzero lease, not an unrelated error\n${output}`,
    )
    console.log('PASS premark-all reverse mutation: overlapping test becomes nonzero')
  } finally {
    writeFileSync(watcherPath, original)
  }
  assert.equal(readFileSync(watcherPath, 'utf8'), original, 'premark-all reverse mutation must restore scan-watcher.ts')
}

async function main(): Promise<void> {
  if (process.argv.includes('--overlapping-startup-backlog-race')) {
    await runOverlappingStartupBacklogRaceTest()
    return
  }
  verifySourceStructure()
  verifyUnclaimedCleanup()
  await verifyRetryCapExpired()
  await verifyRetryCapNotYetExpired()
  await verifyNoWaitingTaskStillDistinctFromRetryTimeout()
  await verifyScanTaskStateChangedQuarantinesImmediately()
  await verifyScanFileAlreadyDeliveredQuarantinesImmediately()
  await verifyScanFilePreviouslyAttemptedQuarantinesImmediately()
  await verifyScanFileStaleCaptureQuarantinesImmediately()
  await verifyGenericServerErrorStillRetriesNormally()
  await verifySymbolicLinkCandidateNeverReachesDelivery()
  await verifyAlternateOutsideFileBypassesAreRejected()
  await verifySupportedImageCandidatesStillDeliver()
  verifyWindowsUnverifiableFolderBlocksWatcherStartup()
  await verifySuccessfulDeliveryDeletesSourceFile()
  await verifyInFlightDedupSkipsConcurrentDuplicate()
  await verifyUnexpectedErrorOuterCatch()
  await runScanLeaseBarrierTests()
  verifyPremarkAllMutationMakesOverlappingTestNonzero()
  verifyPlatformGapDisclosure()
  console.log('verify-scan-watcher: ok')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
