import assert from 'node:assert/strict'
import http from 'node:http'
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
  utimesSync,
  mkdirSync,
  chmodSync,
  lstatSync,
  linkSync,
  symlinkSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import {
  processCandidate,
  isolateStartupBacklog,
  finalizeCandidate,
  sweepFolder,
  isStartupBacklogCandidate,
  clearStartupBacklogForTest,
  noteScanInputUnavailableForTest,
  noteScanWatcherRebuildForTest,
  isScanDeliveryPausedForTest,
  beginScanWatchSessionForTest,
  enterRunningForTest,
  getScanInputStateForTest,
  getScanInputGenerationForTest,
  getScanInputLockOutReasonForTest,
  lockOutScanInputForTest,
  stopScanWatchSessionForTest,
  setScanCandidateTestHooks,
  holdScanLifecycleExclusiveForTest,
  runPeriodicScanSweepForTest,
  getScanLifecycleExclusiveStatsForTest,
  startScanWatcher,
} from '../src/agent/scan-watcher'
import type { TrustedWindowsCandidate } from '../src/agent/scan-input/windows-secure-reader'
import {
  ScanDeliveryBarrier,
  isPreExistingCandidate,
  ScanDirectoryBaseline,
  globalDirectoryBaseline,
  SCAN_PRE_EXISTING_TOLERANCE_MS,
  SCAN_CAPTURE_FOREIGN_LEASE,
  SCAN_LEASE_NOT_BEFORE_INVALID,
  canonicalizeScanPath,
  readScanFolderIdentity,
  scanFolderIdentityChanged,
} from '../src/agent/scan-candidate-barrier'
import type { AgentConfig } from '../src/agent/types'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function makeHelperConfig(apiBaseUrl: string, scanWatchFolder: string): AgentConfig {
  return {
    apiBaseUrl,
    terminalCode: 'T-SCAN-BARRIER',
    printerName: 'Barrier Test Printer',
    agentVersion: 'verify-barrier',
    terminalId: 'terminal-scan-barrier',
    agentToken: 'barrier-agent-token',
    scanWatchFolder,
  }
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

export async function runScanLeaseBarrierTests(): Promise<void> {
  clearStartupBacklogForTest()
  // 1. isPreExistingCandidate 单元判定与容差测试
  {
    const leaseNotBeforeIso = '2026-09-12T10:00:10.000Z'
    const leaseNotBeforeMs = new Date(leaseNotBeforeIso).getTime()

    // 文件最后写入时间早于 租约创建 - 5000ms 容差
    const staleSnapshot = { mtimeMs: leaseNotBeforeMs - SCAN_PRE_EXISTING_TOLERANCE_MS - 100 }
    assert.equal(isPreExistingCandidate(staleSnapshot, leaseNotBeforeIso), true)

    // 文件最后写入时间在容差范围内（合法新生成文件）
    const freshSnapshot = { mtimeMs: leaseNotBeforeMs - SCAN_PRE_EXISTING_TOLERANCE_MS + 100 }
    assert.equal(isPreExistingCandidate(freshSnapshot, leaseNotBeforeIso), false)

    // birthtime 早于容差
    const staleBirthtime = {
      mtimeMs: leaseNotBeforeMs + 1000,
      birthtimeMs: leaseNotBeforeMs - SCAN_PRE_EXISTING_TOLERANCE_MS - 500,
    }
    assert.equal(isPreExistingCandidate(staleBirthtime, leaseNotBeforeIso), true)

    // 非法/无效时间 fail-closed：不能证明文件新于当前任务
    assert.equal(isPreExistingCandidate({ mtimeMs: 100 }, 'invalid-iso-date'), true)
  }

  {
    const baseline = new ScanDirectoryBaseline()
    const now = Date.now()
    const sameEntry = { dev: 1, ino: 10 }
    const otherEntry = { dev: 1, ino: 99 }
    baseline.recordObservation('job.tmp', now, 'task_A', sameEntry)
    baseline.bindCapture('job.pdf', now, 'task_B', new Set(['job.pdf']), sameEntry)
    assert.equal(
      baseline.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])),
      true,
      'same-inode vanished temp under A is adopted onto the pdf and is foreign to B',
    )
    assert.equal(
      baseline.isForeignToLease('job.pdf', 'task_A', new Set(['job.pdf'])),
      false,
      'adopted predecessor under A is not foreign to A',
    )
    baseline.remove('job.pdf')
    baseline.bindCapture('job.pdf', now, 'task_B', new Set(['job.pdf']), otherEntry)
    assert.equal(
      baseline.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])),
      false,
      'after A is removed, a later B reuse of the stem is B own observation',
    )

    const reuse = new ScanDirectoryBaseline()
    reuse.recordObservation('job.tmp', now, 'task_A', sameEntry)
    reuse.bindCapture('job.pdf', now, 'task_B', new Set(['job.pdf']), otherEntry)
    assert.equal(
      reuse.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])),
      false,
      'a new directory entry reusing the stem must not inherit A',
    )

    const renamedUnknown = new ScanDirectoryBaseline()
    renamedUnknown.recordObservation('job.tmp', now, 'task_A')
    renamedUnknown.bindCapture('job.pdf', now, 'task_B', new Set(['job.pdf']), otherEntry)
    assert.equal(
      renamedUnknown.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])),
      true,
      'missing inode cannot prove a new capture; inherit fail-closed',
    )

    const nameReuse = new ScanDirectoryBaseline()
    nameReuse.recordObservation('job.pdf', now, 'task_A', sameEntry)
    nameReuse.recordObservation('job.pdf', now + 1, 'task_B', otherEntry)
    assert.equal(
      nameReuse.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])),
      false,
      'same basename with a different inode replaces the closed observation',
    )

    const orphan = new ScanDirectoryBaseline()
    orphan.recordObservation('job.tmp', now, 'task_A', sameEntry)
    orphan.retainLiveEntries(new Set())
    orphan.bindCapture('job.pdf', now, 'task_B', new Set(['job.pdf']), sameEntry)
    assert.equal(
      orphan.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])),
      false,
      'vanished stem with no live successor is dropped before a later B capture',
    )

    const transferred = new ScanDirectoryBaseline()
    transferred.recordObservation('job.tmp', now, 'task_A', sameEntry)
    assert.equal(
      transferred.closeVanishedCapture('job.tmp', new Set(['job.pdf']), (name) => (
        name === 'job.pdf' ? sameEntry : undefined
      )),
      'job.pdf',
      'closeVanishedCapture must adopt a same-inode live successor before dropping the vanished name',
    )
    assert.equal(transferred.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])), true)
    transferred.remove('job.pdf')

    const gone = new ScanDirectoryBaseline()
    gone.recordObservation('job.tmp', now, 'task_A', sameEntry)
    assert.equal(
      gone.closeVanishedCapture('job.tmp', new Set(['job.pdf']), (name) => (
        name === 'job.pdf' ? otherEntry : undefined
      )),
      undefined,
      'closeVanishedCapture must not adopt a different inode',
    )
    gone.bindCapture('job.pdf', now, 'task_B', new Set(['job.pdf']), otherEntry)
    assert.equal(gone.isForeignToLease('job.pdf', 'task_B', new Set(['job.pdf'])), false)
    baseline.clear()
  }

  // 2. ScanDirectoryBaseline 内存目录基线判定
  {
    const baseline = new ScanDirectoryBaseline()
    const now = Date.now()
    baseline.recordObservation('stale_scan.pdf', now - 10_000, null)
    assert.equal(baseline.isPreExisting('stale_scan.pdf', now), true)
    assert.equal(baseline.isPreExisting('non_existent.pdf', now), false)
    baseline.remove('stale_scan.pdf')
    assert.equal(baseline.isPreExisting('stale_scan.pdf', now), false)
  }

  // 3. 场景用例：A 旧文件残留 -> A 取消 -> B 创建 (waiting) -> Agent 启动/sweep
  // 证明：旧文件隔离至 _unclaimed，B 保持 waiting 且绝无 FileObject 挂载
  {
    const deliveredTaskIds: string[] = []
    let taskBStatus = 'waiting'
    let taskBFileObject: unknown = null

    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          // 当前生效的是任务 B 的租约（任务 A 已经取消）
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              success: true,
              data: {
                scanTaskId: 'task_B_id',
                serverNow: new Date().toISOString(),
                notBefore: new Date().toISOString(), // 任务 B 刚刚建立
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                deliveryLease: 'lease_for_task_B',
              },
            }),
          )
          return
        }

        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          // 如果旧文件被意外投递，记录下来
          deliveredTaskIds.push(req.url)
          taskBStatus = 'completed'
          taskBFileObject = { fileId: 'file_leak' }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_B_id', fileId: 'file_leak' } }))
          return
        }

        res.writeHead(404)
        res.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-scenario-a-b-'))
    try {
      const oldFilename = 'scanner_output_taskA.pdf'
      const oldFilePath = join(scanFolder, oldFilename)
      writeFileSync(oldFilePath, '%PDF-1.4 old leftover from task A')
      // 将 mtime 回拨到 60 秒前（模拟在任务 B 租约创建前即已存在）
      const past = new Date(Date.now() - 60_000)
      utimesSync(oldFilePath, past, past)

      const config = makeHelperConfig(baseUrl, scanFolder)
      const { stdout } = await captureLogsAsync(() => processCandidate(oldFilePath, oldFilename, config))

      // 验证：旧文件被移出主目录并隔离到 _unclaimed
      assert.equal(existsSync(oldFilePath), false, 'old leftover file must not remain in main scan folder')
      const quarantinedPath = join(scanFolder, '_unclaimed', oldFilename)
      assert.equal(existsSync(quarantinedPath), true, 'old leftover file must be quarantined into _unclaimed')
      assert.match(stdout, /candidate file existed prior to scan lease start/, 'log must record pre-existing barrier')

      // 验证：deliver 绝未被触发，任务 B 状态保持 waiting，无 FileObject 挂载
      assert.equal(deliveredTaskIds.length, 0, 'deliver must never be called for pre-existing leftover file')
      assert.equal(taskBStatus, 'waiting', 'task B must remain in waiting state')
      assert.equal(taskBFileObject, null, 'task B must not have any FileObject attached')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      globalDirectoryBaseline.clear()
    }
  }

  // 4. 租约失效或过期（SCAN_LEASE_INVALID / SCAN_LEASE_EXPIRED）立即隔离，绝不重试
  for (const leaseErrCode of ['SCAN_LEASE_INVALID', 'SCAN_LEASE_EXPIRED'] as const) {
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              success: true,
              data: {
                scanTaskId: 'task_id_test',
                serverNow: new Date().toISOString(),
                notBefore: new Date(Date.now() - 20_000).toISOString(),
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                deliveryLease: 'test_token',
              },
            }),
          )
          return
        }
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: { code: leaseErrCode, message: 'lease failure' } }))
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

    const scanFolder = mkdtempSync(join(tmpdir(), `scan-watcher-lease-${leaseErrCode}-`))
    try {
      const filename = `lease-fail-${leaseErrCode}.pdf`
      const filePath = join(scanFolder, filename)
      writeFileSync(filePath, '%PDF-1.4 lease failure candidate')

      const config = makeHelperConfig(baseUrl, scanFolder)
      const { stdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

      assert.equal(existsSync(filePath), false)
      assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), true)
      assert.match(stdout, /scan lease invalid or expired; moved to _unclaimed/)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      globalDirectoryBaseline.clear()
    }
  }

  // 5. 无等待任务（NO_WAITING_SCAN_TASK）时租约端点返回 409，文件立即隔离进 _unclaimed
  {
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            statusCode: 409,
            error: { code: 'NO_WAITING_SCAN_TASK', message: '当前终端没有等待扫描的任务' },
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-no-lease-'))
    try {
      const filename = 'no-waiting-task-candidate.pdf'
      const filePath = join(scanFolder, filename)
      writeFileSync(filePath, '%PDF-1.4 no waiting task candidate')

      const config = makeHelperConfig(baseUrl, scanFolder)
      const { stdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

      assert.equal(existsSync(filePath), false)
      assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), true)
      assert.match(stdout, /no waiting scan task, moved to _unclaimed/)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      globalDirectoryBaseline.clear()
    }
  }

  // 6. 正常单次投递：合法新文件通过租约屏障并成功完成投递，源文件删除
  {
    let receivedMultipart = ''
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              success: true,
              data: {
                scanTaskId: 'task_fresh_123',
                serverNow: new Date().toISOString(),
                notBefore: new Date(Date.now() - 30_000).toISOString(),
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                deliveryLease: 'valid_delivery_lease_token',
              },
            }),
          )
          return
        }
        receivedMultipart = Buffer.concat(chunks).toString('utf8')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_fresh_123', fileId: 'file_fresh_123' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-normal-delivery-'))
    try {
      const filename = 'fresh_scan.pdf'
      const filePath = join(scanFolder, filename)
      writeFileSync(filePath, '%PDF-1.4 fresh scan document bytes')

      const config = makeHelperConfig(baseUrl, scanFolder)
      const { stdout } = await captureLogsAsync(() => processCandidate(filePath, filename, config))

      assert.equal(existsSync(filePath), false, 'source file must be deleted upon 200 delivery')
      assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), false)
      assert.match(stdout, /delivered and removed source file/)

      assert.match(receivedMultipart, /name="scanTaskId"[\s\S]*task_fresh_123/)
      assert.match(receivedMultipart, /name="deliveryLease"[\s\S]*valid_delivery_lease_token/)
      assert.match(receivedMultipart, /name="candidateSnapshotAt"/)
      assert.match(receivedMultipart, /name="observedAt"/)
      assert.doesNotMatch(
        receivedMultipart,
        /name="candidateBirthtimeAt"/,
        'candidateBirthtimeAt must not be part of multipart body; birthtime API contract revoked',
      )
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      globalDirectoryBaseline.clear()
    }
  }

  // 7. Agent 重启与基线恢复：启动前已有旧文件 -> 租约开始后 sweep -> 旧文件隔离
  {
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-restart-baseline-'))
    try {
      const oldFile = 'preexisting_before_restart.pdf'
      const oldPath = join(scanFolder, oldFile)
      writeFileSync(oldPath, '%PDF-1.4 preexisting before agent restart')
      const restartTime = Date.now()
      // 记录观察基线
      globalDirectoryBaseline.recordObservation(oldFile, restartTime - 20_000, null)

      const server = http.createServer((req, res) => {
        req.on('data', () => undefined)
        req.on('end', () => {
          if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                success: true,
                data: {
                  scanTaskId: 'task_after_restart',
                  serverNow: new Date().toISOString(),
                  notBefore: new Date(restartTime).toISOString(),
                  expiresAt: new Date(Date.now() + 300_000).toISOString(),
                  deliveryLease: 'restart_lease_token',
                },
              }),
            )
            return
          }
          res.writeHead(500)
          res.end()
        })
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      assert.ok(typeof address === 'object' && address)
      const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

      const config = makeHelperConfig(baseUrl, scanFolder)
      const { stdout } = await captureLogsAsync(() => processCandidate(oldPath, oldFile, config))

      assert.equal(existsSync(oldPath), false)
      assert.equal(existsSync(join(scanFolder, '_unclaimed', oldFile)), true)
      assert.match(stdout, /candidate file existed prior to scan lease start/)

      await new Promise<void>((resolve) => server.close(() => resolve()))
    } finally {
      rmSync(scanFolder, { recursive: true, force: true })
      globalDirectoryBaseline.clear()
    }
  }

  // 8. Fail-closed startup backlog：Agent 启动时已有文件立即安全隔离至 _unclaimed，重启仍不会误投递
  {
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-startup-backlog-'))
    try {
      const backlogFile1 = 'startup_backlog_1.pdf'
      const backlogFile2 = 'startup_backlog_2.pdf'
      writeFileSync(join(scanFolder, backlogFile1), '%PDF-1.4 backlog file 1')
      writeFileSync(join(scanFolder, backlogFile2), '%PDF-1.4 backlog file 2')

      const quarantinedCount = await isolateStartupBacklog(scanFolder)
      assert.equal(quarantinedCount, 2, 'all pre-existing startup files must be quarantined')

      assert.equal(existsSync(join(scanFolder, backlogFile1)), false, 'backlog file 1 must be moved out of scan folder')
      assert.equal(existsSync(join(scanFolder, backlogFile2)), false, 'backlog file 2 must be moved out of scan folder')
      assert.equal(existsSync(join(scanFolder, '_unclaimed', backlogFile1)), true, 'backlog file 1 must be quarantined in _unclaimed')
      assert.equal(existsSync(join(scanFolder, '_unclaimed', backlogFile2)), true, 'backlog file 2 must be quarantined in _unclaimed')

      // 模拟 Agent 再次重启：_unclaimed 中的历史文件已被排除，主目录已无新文件，隔离数应为 0
      const restartQuarantined = await isolateStartupBacklog(scanFolder)
      assert.equal(restartQuarantined, 0, 'on restart, files in _unclaimed are ignored and not re-quarantined')
    } finally {
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  // 9. Windows 平台安全变异约束：无凭据抛 SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING，提供真实/合法凭据不抛该错误
  {
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-win-quarantine-'))
    const testFile = 'win_token_test.pdf'
    const filePath = join(scanFolder, testFile)
    writeFileSync(filePath, '%PDF-1.4 win token test')

    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    assert.ok(platformDescriptor, 'process.platform descriptor must exist')
    try {
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' })

      // (a) 缺少 trustedWindowsCandidate 时必须严格抛出 SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING
      assert.throws(
        () => finalizeCandidate(filePath, scanFolder, testFile, undefined, 'quarantine'),
        (err: unknown) => (err as Error).message === 'SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING',
        'Windows quarantine without trustedWindowsCandidate must fail-closed with token missing error',
      )

      // (b) 传入有效结构的 trustedWindowsCandidate 时绝不抛 SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING
      const fakeTrusted: TrustedWindowsCandidate = {
        bytes: Buffer.from('%PDF-1.4 win token test'),
        rootIdentity: { volume: 1, fileId: 100n },
        candidateIdentity: { volume: 1, fileId: 200n },
        size: 24,
        mtimeMs: Date.now(),
      }
      try {
        finalizeCandidate(filePath, scanFolder, testFile, fakeTrusted, 'quarantine')
      } catch (err: unknown) {
        assert.notEqual(
          (err as Error).message,
          'SCAN_INPUT_SECURE_MUTATION_TOKEN_MISSING',
          'must not throw token missing when trusted candidate is supplied',
        )
      }
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor)
      rmSync(scanFolder, { recursive: true, force: true })
    }
  }

  // 10. 真实执行测试：启动 backlog 隔离失败（EACCES / helper failure）后 never-deliver 屏障保持：
  // 证明：
  // (a) 启动识别为 backlog 的文件，在首次隔离失败（EACCES）后留在扫描根目录；
  // (b) 随后的 sweep 周期中，该文件绝不进入 lease 申请（0 lease），绝不进入投递（0 deliver）；
  // (c) 失败记录高严重度日志，且绝不泄露文件名或文件内容；
  // (d) 修复目标权限后重试隔离，成功进入 _unclaimed，标记被正确清除；
  // (e) 再次 sweep 依然 0 lease、0 deliver，源文件已不在根目录。
  {
    clearStartupBacklogForTest()
    let leaseRequestCount = 0
    let deliverRequestCount = 0

    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          leaseRequestCount += 1
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              success: true,
              data: {
                scanTaskId: 'task_should_never_bind',
                serverNow: new Date().toISOString(),
                notBefore: new Date(Date.now() - 30_000).toISOString(),
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                deliveryLease: 'unauthorized_backlog_lease',
              },
            }),
          )
          return
        }

        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          deliverRequestCount += 1
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_should_never_bind', fileId: 'leaked_id' } }))
          return
        }

        res.writeHead(404)
        res.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-backlog-never-deliver-'))
    try {
      const backlogFilename = 'startup_backlog_secret.pdf'
      const backlogSecretContent = '%PDF-1.4 CONFIDENTIAL-STARTUP-BACKLOG-CONTENT-NEVER-DELIVER'
      const backlogPath = join(scanFolder, backlogFilename)
      writeFileSync(backlogPath, backlogSecretContent)

      // 预先建立 _unclaimed 目录并剥夺写权限，精确模拟隔离目标不可写（EACCES 真实失败）
      const unclaimedDir = join(scanFolder, '_unclaimed')
      mkdirSync(unclaimedDir, { recursive: true })
      chmodSync(unclaimedDir, 0o555)

      const config = makeHelperConfig(baseUrl, scanFolder)

      // 1. 首次启动隔离：因 _unclaimed 只读触发真实 EACCES
      const { stdout: isolateStdout, stderr: isolateStderr } = await captureLogsAsync(async () => {
        const quarantinedCount = await isolateStartupBacklog(scanFolder)
        assert.equal(quarantinedCount, 0, 'quarantine must fail closed on EACCES and return 0 quarantined')
      })

      // 验证首次隔离失败后：
      // 文件必须仍存在于扫描根目录（因为隔离失败未能移走）
      assert.equal(existsSync(backlogPath), true, 'failed quarantine must leave file in place')
      assert.equal(existsSync(join(unclaimedDir, backlogFilename)), false, 'file must not be in _unclaimed yet')
      // 必须被记入 backlog 集合（永久 never-deliver 标记生效）
      assert.equal(isStartupBacklogCandidate(backlogPath), true, 'failed candidate must remain marked as startup backlog')
      // 首次启动过程绝不申请租约、绝不投递
      assert.equal(leaseRequestCount, 0, 'isolateStartupBacklog must never request lease')
      assert.equal(deliverRequestCount, 0, 'isolateStartupBacklog must never deliver file')
      // 失败记录高严重度日志（写入 stderr）
      assert.match(isolateStderr, /failed to isolate startup backlog candidate — code=EACCES/)
      // 绝不泄露文件名或文件内容
      assert.doesNotMatch(isolateStderr, /startup_backlog_secret\.pdf/, 'isolate failure stderr must not leak filename')
      assert.doesNotMatch(isolateStderr, new RegExp(backlogSecretContent), 'isolate failure stderr must not leak content')
      assert.doesNotMatch(isolateStdout, /startup_backlog_secret\.pdf/, 'isolate failure stdout must not leak filename')
      assert.doesNotMatch(isolateStdout, new RegExp(backlogSecretContent), 'isolate failure stdout must not leak content')

      // 2. 后续 sweep 周期（模拟第一次 sweep，目标依然只读）
      const { stdout: sweep1Stdout, stderr: sweep1Stderr } = await captureLogsAsync(async () => {
        await sweepFolder(scanFolder, config)
      })

      // 验证后续 sweep 零 lease、零 deliver
      assert.equal(leaseRequestCount, 0, 'subsequent sweep 1 must NEVER request scan lease for backlog candidate')
      assert.equal(deliverRequestCount, 0, 'subsequent sweep 1 must NEVER deliver backlog candidate')
      assert.equal(existsSync(backlogPath), true, 'file must still be in root folder')
      assert.equal(existsSync(join(unclaimedDir, backlogFilename)), false, 'file must not be in _unclaimed yet')
      assert.equal(isStartupBacklogCandidate(backlogPath), true, 'candidate must still be marked as startup backlog')
      // 隔离重试失败记录高严重度日志
      assert.match(sweep1Stderr, /startup backlog quarantine retry failed — code=EACCES/)
      // 绝不泄露文件名或内容
      assert.doesNotMatch(sweep1Stderr, /startup_backlog_secret\.pdf/, 'sweep retry stderr must not leak filename')
      assert.doesNotMatch(sweep1Stderr, new RegExp(backlogSecretContent), 'sweep retry stderr must not leak content')

      // 3. 再次后续 sweep（模拟第二次 sweep，目标依然只读）
      await sweepFolder(scanFolder, config)
      assert.equal(leaseRequestCount, 0, 'subsequent sweep 2 must still NEVER request scan lease')
      assert.equal(deliverRequestCount, 0, 'subsequent sweep 2 must still NEVER deliver')
      assert.equal(isStartupBacklogCandidate(backlogPath), true, 'candidate must still be marked as startup backlog')

      // 4. 恢复目标目录写权限，模拟重试成功
      chmodSync(unclaimedDir, 0o755)

      const { stdout: sweepSuccessStdout } = await captureLogsAsync(async () => {
        await sweepFolder(scanFolder, config)
      })

      // 验证：重试隔离成功后，文件移入 _unclaimed，标记清除，零 lease、零 deliver
      assert.equal(leaseRequestCount, 0, 'successful quarantine sweep must NEVER request lease')
      assert.equal(deliverRequestCount, 0, 'successful quarantine sweep must NEVER deliver')
      assert.equal(existsSync(backlogPath), false, 'quarantined file must be removed from root scan folder')
      const targetQuarantinedPath = join(unclaimedDir, backlogFilename)
      assert.equal(existsSync(targetQuarantinedPath), true, 'file must now exist in _unclaimed')
      assert.equal(
        readFileSync(targetQuarantinedPath, 'utf8'),
        backlogSecretContent,
        'file content in _unclaimed must be preserved',
      )
      assert.equal(isStartupBacklogCandidate(backlogPath), false, 'backlog candidate mark must be cleared upon success')
      assert.match(sweepSuccessStdout, /startup backlog candidate quarantined/)

      // 5. 再次运行 sweep：确认完全收敛，零 lease、零 deliver
      await sweepFolder(scanFolder, config)
      assert.equal(leaseRequestCount, 0)
      assert.equal(deliverRequestCount, 0)
    } finally {
      try {
        chmodSync(join(scanFolder, '_unclaimed'), 0o755)
      } catch {}
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  await runLateCrossSessionCaptureTests()
  await runOverlappingStartupBacklogRaceTest()
  await runScanInputLockoutTests()

  console.log('PASS scan lease barrier helper checks')
}

export async function runLateCrossSessionCaptureTests(): Promise<void> {
  clearStartupBacklogForTest()
  globalDirectoryBaseline.clear()

  {
    let currentTaskId = 'task_A'
    let leaseNotBeforeMs = Date.now() - 30_000
    let deliverCount = 0
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              scanTaskId: currentTaskId,
              serverNow: new Date().toISOString(),
              notBefore: new Date(leaseNotBeforeMs).toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: `lease_${currentTaskId}`,
            },
          }))
          return
        }
        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          deliverCount += 1
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: currentTaskId, fileId: 'leaked' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-late-ab-'))
    const filename = 'late-from-a.pdf'
    try {
      beginScanWatchSessionForTest()
      await isolateStartupBacklog(scanFolder)
      writeFileSync(join(scanFolder, filename), '%PDF-1.4 started under A finishes after B')
      setScanCandidateTestHooks({
        afterStable: () => {
          currentTaskId = 'task_B'
          leaseNotBeforeMs = Date.now()
        },
      })
      const { stdout } = await captureLogsAsync(() =>
        processCandidate(join(scanFolder, filename), filename, makeHelperConfig(baseUrl, scanFolder)),
      )
      assert.equal(deliverCount, 0, 'A-to-B late appearance must NEVER upload')
      assert.equal(existsSync(join(scanFolder, filename)), false)
      assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), true)
      assert.match(stdout, new RegExp(SCAN_CAPTURE_FOREIGN_LEASE))
      console.log('PASS late A-to-B appearance during stability wait: quarantined, 0 deliver')
    } finally {
      setScanCandidateTestHooks({})
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  {
    let currentTaskId = 'task_A'
    let deliverCount = 0
    let leaseGets = 0
    const firstLease = deferred()
    const holdFirstLease = deferred()
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          leaseGets += 1
          const respond = () => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              success: true,
              data: {
                scanTaskId: currentTaskId,
                serverNow: new Date().toISOString(),
                notBefore: new Date(Date.now() - 30_000).toISOString(),
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                deliveryLease: `lease_${currentTaskId}`,
              },
            }))
          }
          if (leaseGets === 1) {
            firstLease.resolve()
            void holdFirstLease.promise.then(respond)
            return
          }
          respond()
          return
        }
        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          deliverCount += 1
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: currentTaskId, fileId: 'leaked' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-rename-await-'))
    const tmpName = 'job.tmp'
    const pdfName = 'job.pdf'
    const tmpPath = join(scanFolder, tmpName)
    const pdfPath = join(scanFolder, pdfName)
    try {
      beginScanWatchSessionForTest()
      await isolateStartupBacklog(scanFolder)
      writeFileSync(tmpPath, '%PDF-1.4 started under A')
      const config = makeHelperConfig(baseUrl, scanFolder)
      const tmpDone = processCandidate(tmpPath, tmpName, config)
      await firstLease.promise
      renameSync(tmpPath, pdfPath)
      holdFirstLease.resolve()
      await tmpDone
      currentTaskId = 'task_B'
      const { stdout } = await captureLogsAsync(() => processCandidate(pdfPath, pdfName, config))
      assert.equal(deliverCount, 0, 'temp-to-pdf rename from A must NEVER upload to B')
      assert.equal(existsSync(pdfPath), false)
      assert.equal(existsSync(join(scanFolder, '_unclaimed', pdfName)), true)
      assert.match(stdout, new RegExp(SCAN_CAPTURE_FOREIGN_LEASE))
      console.log('PASS A-to-B temp rename during opening-lease await: quarantined, 0 deliver')
    } finally {
      holdFirstLease.resolve()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  {
    let deliverCount = 0
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              scanTaskId: 'task_B',
              serverNow: new Date().toISOString(),
              notBefore: 'not-a-date',
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: 'lease_bad_notbefore',
            },
          }))
          return
        }
        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          deliverCount += 1
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_B', fileId: 'leaked' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-bad-notbefore-'))
    const filename = 'fresh-but-invalid-notbefore.pdf'
    try {
      beginScanWatchSessionForTest()
      await isolateStartupBacklog(scanFolder)
      writeFileSync(join(scanFolder, filename), '%PDF-1.4 fresh bytes invalid notBefore')
      const { stdout } = await captureLogsAsync(() =>
        processCandidate(join(scanFolder, filename), filename, makeHelperConfig(baseUrl, scanFolder)),
      )
      assert.equal(deliverCount, 0, 'invalid notBefore must NEVER upload')
      assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), true)
      assert.match(stdout, new RegExp(SCAN_LEASE_NOT_BEFORE_INVALID))
      console.log('PASS invalid lease notBefore fail-closed: quarantined, 0 deliver')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  {
    let deliverCount = 0
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              scanTaskId: 'task_B',
              serverNow: new Date().toISOString(),
              notBefore: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: 'lease_same_task',
            },
          }))
          return
        }
        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          deliverCount += 1
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_B', fileId: 'ok' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-same-task-'))
    const filename = 'fresh-under-b.pdf'
    try {
      beginScanWatchSessionForTest()
      await isolateStartupBacklog(scanFolder)
      writeFileSync(join(scanFolder, filename), '%PDF-1.4 legitimate B capture')
      await processCandidate(join(scanFolder, filename), filename, makeHelperConfig(baseUrl, scanFolder))
      assert.equal(deliverCount, 1, 'same-task fresh capture must still deliver')
      assert.equal(existsSync(join(scanFolder, filename)), false)
      assert.equal(existsSync(join(scanFolder, '_unclaimed', filename)), false)
      console.log('PASS same-task fresh capture still delivers')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  {
    let currentTaskId = 'task_A'
    const delivered: string[] = []
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              scanTaskId: currentTaskId,
              serverNow: new Date().toISOString(),
              notBefore: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: `lease_${currentTaskId}`,
            },
          }))
          return
        }
        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          delivered.push(currentTaskId)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: currentTaskId, fileId: 'ok' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-overlap-ab-'))
    const fileA = 'overlap-a.pdf'
    const fileB = 'overlap-b.pdf'
    try {
      beginScanWatchSessionForTest()
      await isolateStartupBacklog(scanFolder)
      writeFileSync(join(scanFolder, fileA), '%PDF-1.4 overlap A')
      writeFileSync(join(scanFolder, fileB), '%PDF-1.4 overlap B')
      const config = makeHelperConfig(baseUrl, scanFolder)
      setScanCandidateTestHooks({
        afterStable: async (name) => {
          if (name !== fileA) return
          currentTaskId = 'task_B'
          await processCandidate(join(scanFolder, fileB), fileB, config)
        },
      })
      await processCandidate(join(scanFolder, fileA), fileA, config)
      assert.equal(delivered.length, 1, 'only the file that opened under B may upload')
      assert.equal(delivered[0], 'task_B')
      assert.equal(existsSync(join(scanFolder, '_unclaimed', fileA)), true, 'file opened under A must quarantine')
      assert.equal(existsSync(join(scanFolder, fileB)), false, 'file opened under B must deliver')
      assert.equal(existsSync(join(scanFolder, '_unclaimed', fileB)), false)
      console.log('PASS reverse-order overlapping A/B captures: each keeps its own opening task')
    } finally {
      setScanCandidateTestHooks({})
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  {
    const deliverTaskIds: string[] = []
    const server = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => {
        if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              scanTaskId: 'task_B',
              serverNow: new Date().toISOString(),
              notBefore: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: 'lease_B',
            },
          }))
          return
        }
        if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
          deliverTaskIds.push('task_B')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_B', fileId: 'ok' } }))
          return
        }
        res.writeHead(404)
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(typeof address === 'object' && address)
    const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
    const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-stem-reuse-'))
    const tmpName = 'reuse-job.tmp'
    const pdfName = 'reuse-job.pdf'
    try {
      beginScanWatchSessionForTest()
      await isolateStartupBacklog(scanFolder)
      writeFileSync(join(scanFolder, tmpName), 'partial under A')
      globalDirectoryBaseline.recordObservation(tmpName, Date.now(), 'task_A')
      renameSync(join(scanFolder, tmpName), join(scanFolder, pdfName))
      writeFileSync(join(scanFolder, pdfName), '%PDF-1.4 A capture to quarantine')
      await processCandidate(join(scanFolder, pdfName), pdfName, makeHelperConfig(baseUrl, scanFolder))
      assert.equal(existsSync(join(scanFolder, '_unclaimed', pdfName)), true, 'A reuse-stem capture must quarantine')
      assert.equal(deliverTaskIds.length, 0)

      writeFileSync(join(scanFolder, pdfName), '%PDF-1.4 later legitimate B capture')
      await processCandidate(join(scanFolder, pdfName), pdfName, makeHelperConfig(baseUrl, scanFolder))
      assert.equal(deliverTaskIds.length, 1, 'later B capture reusing the stem must deliver')
      assert.equal(existsSync(join(scanFolder, pdfName)), false)
      console.log('PASS stem reuse after A quarantine: later B capture is not poisoned')

      const orphanTmp = 'reuse-orphan.tmp'
      const orphanPdf = 'reuse-orphan.pdf'
      writeFileSync(join(scanFolder, orphanTmp), 'orphan under A')
      const orphanStat = lstatSync(join(scanFolder, orphanTmp))
      globalDirectoryBaseline.recordObservation(
        orphanTmp,
        Date.now(),
        'task_A',
        { dev: orphanStat.dev, ino: orphanStat.ino },
      )
      unlinkSync(join(scanFolder, orphanTmp))
      writeFileSync(join(scanFolder, orphanPdf), '%PDF-1.4 later B capture after A tmp vanished')
      const orphanPdfStat = lstatSync(join(scanFolder, orphanPdf))
      assert.notEqual(
        orphanPdfStat.ino,
        orphanStat.ino,
        'orphan reuse fixture must be a new directory entry',
      )
      await processCandidate(join(scanFolder, orphanPdf), orphanPdf, makeHelperConfig(baseUrl, scanFolder))
      assert.equal(deliverTaskIds.length, 2, 'later B capture after vanished A tmp must deliver')
      assert.equal(existsSync(join(scanFolder, orphanPdf)), false)
      console.log('PASS stem reuse after vanished A temp: later B capture is not poisoned')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      rmSync(scanFolder, { recursive: true, force: true })
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()
    }
  }

  await runUnknownDirectoryListingFailClosedTest()
}

export async function runUnknownDirectoryListingFailClosedTest(): Promise<void> {
  clearStartupBacklogForTest()
  globalDirectoryBaseline.clear()
  let deliverCount = 0
  let leaseGets = 0
  const firstLease = deferred()
  const holdFirstLease = deferred()
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
        leaseGets += 1
        const respond = () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            success: true,
            data: {
              scanTaskId: 'task_B',
              serverNow: new Date().toISOString(),
              notBefore: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: 'lease_B',
            },
          }))
        }
        if (leaseGets === 1) {
          firstLease.resolve()
          void holdFirstLease.promise.then(respond)
          return
        }
        respond()
        return
      }
      if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
        deliverCount += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: { scanTaskId: 'task_B', fileId: 'leaked' } }))
        return
      }
      res.writeHead(404)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(typeof address === 'object' && address)
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-listing-unknown-'))
  const filename = 'listing-unknown.pdf'
  const filePath = join(scanFolder, filename)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    writeFileSync(filePath, '%PDF-1.4 listing unknown must not bind')
    const pending = captureLogsAsync(() =>
      processCandidate(filePath, filename, makeHelperConfig(baseUrl, scanFolder)),
    )
    await firstLease.promise
    chmodSync(scanFolder, 0o300)
    holdFirstLease.resolve()
    const { stdout } = await pending
    assert.equal(deliverCount, 0, 'unknown directory listing must NEVER upload')
    assert.equal(getScanInputStateForTest(), 'locked_out')
    assert.equal(getScanInputLockOutReasonForTest(), 'readdir_failed')
    assert.match(stdout, /SCAN_INPUT_RESTART_REQUIRED/)
    chmodSync(scanFolder, 0o755)
    assert.equal(existsSync(filePath), true, 'unknown listing must abort before POST, not silently treat folder as empty')
    console.log('PASS unknown directory listing fail-closed: lockout, 0 deliver')
  } finally {
    holdFirstLease.resolve()
    try {
      chmodSync(scanFolder, 0o755)
    } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

/**
 * Two regular files plus symlink/hardlink at startup. Hold the first accepted
 * file in waitForStableFile while the second (and unsafe siblings) are processed.
 * Premark-all must yield 0 lease / 0 deliver, retain the marker on EACCES, and
 * never deliver symlink or hardlink candidates.
 */
export async function runOverlappingStartupBacklogRaceTest(): Promise<void> {
  clearStartupBacklogForTest()
  let leaseRequestCount = 0
  let deliverRequestCount = 0

  const server = http.createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
        leaseRequestCount += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            success: true,
            data: {
              scanTaskId: 'task_should_never_bind_overlap',
              serverNow: new Date().toISOString(),
              notBefore: new Date(Date.now() - 30_000).toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: 'unauthorized_overlap_lease',
            },
          }),
        )
        return
      }

      if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
        deliverRequestCount += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            success: true,
            data: { scanTaskId: 'task_should_never_bind_overlap', fileId: 'leaked_overlap_id' },
          }),
        )
        return
      }

      res.writeHead(404)
      res.end()
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(typeof address === 'object' && address)
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'scan-watcher-overlapping-backlog-'))
  const scanFolder = join(temporaryRoot, 'scan')
  mkdirSync(scanFolder)
  const unclaimedDir = join(scanFolder, '_unclaimed')
  mkdirSync(unclaimedDir)
  chmodSync(unclaimedDir, 0o555)

  const holdName = 'a-startup-hold.pdf'
  const raceName = 'b-startup-race.pdf'
  const symlinkName = 'c-startup-symlink.pdf'
  const hardlinkName = 'd-startup-hardlink.pdf'
  const holdPath = join(scanFolder, holdName)
  const racePath = join(scanFolder, raceName)
  const symlinkPath = join(scanFolder, symlinkName)
  const hardlinkPath = join(scanFolder, hardlinkName)
  const outsideFile = join(temporaryRoot, 'outside-secret.pdf')
  const holdSecret = '%PDF-1.4 CONFIDENTIAL-HOLD-STARTUP-BACKLOG'
  const raceSecret = '%PDF-1.4 CONFIDENTIAL-RACE-STARTUP-BACKLOG'
  const outsideSecret = '%PDF-1.4 CONFIDENTIAL-OUTSIDE-NEVER-DELIVER'

  writeFileSync(holdPath, holdSecret)
  writeFileSync(racePath, raceSecret)
  writeFileSync(outsideFile, outsideSecret)
  symlinkSync(outsideFile, symlinkPath, 'file')
  linkSync(outsideFile, hardlinkPath)

  const acceptedNames = readdirSync(scanFolder).flatMap((name) => {
    if (name === '_unclaimed') return []
    try {
      const snapshot = lstatSync(join(scanFolder, name))
      if (!snapshot.isFile() || snapshot.nlink !== 1 || !/\.pdf$/i.test(name)) return []
      return [name]
    } catch {
      return []
    }
  })
  assert.equal(acceptedNames.length, 2, 'overlapping race needs exactly two accepted regular startup files')
  const firstName = acceptedNames[0]
  const secondName = acceptedNames[1]
  const firstPath = join(scanFolder, firstName)
  const secondPath = join(scanFolder, secondName)

  let holdFirst = true
  const holdTimer = setInterval(() => {
    if (!holdFirst) return
    try {
      writeFileSync(firstPath, `${holdSecret} ${Date.now()}`)
    } catch {
      // Isolation may move the hold file after we release the timer.
    }
  }, 120)
  holdTimer.unref()

  const config = makeHelperConfig(baseUrl, scanFolder)
  try {
    const { stderr } = await captureLogsAsync(async () => {
      const isolatePromise = isolateStartupBacklog(scanFolder)
      try {
        await processCandidate(secondPath, secondName, config)
        await processCandidate(symlinkPath, symlinkName, config)
        await processCandidate(hardlinkPath, hardlinkName, config)
      } finally {
        holdFirst = false
        clearInterval(holdTimer)
      }
      await isolatePromise
    })

    assert.equal(leaseRequestCount, 0, 'overlapping two-file race must NEVER request scan lease for the second file')
    assert.equal(deliverRequestCount, 0, 'overlapping two-file race must NEVER deliver the second file')
    assert.equal(isStartupBacklogCandidate(firstPath), true, 'EACCES on first file must retain startup backlog marker')
    assert.equal(isStartupBacklogCandidate(secondPath), true, 'EACCES on second file must retain startup backlog marker')
    assert.equal(isStartupBacklogCandidate(symlinkPath), true, 'symlink startup candidate must stay marked never-deliver')
    assert.equal(isStartupBacklogCandidate(hardlinkPath), true, 'hardlink startup candidate must stay marked never-deliver')
    assert.equal(existsSync(firstPath), true, 'failed quarantine must leave the held file in place')
    assert.equal(existsSync(secondPath), true, 'failed quarantine must leave the overlapped file in place')
    assert.equal(existsSync(symlinkPath), true, 'symlink must remain for operator review')
    assert.equal(existsSync(hardlinkPath), true, 'hardlink must remain for operator review')
    assert.equal(existsSync(join(unclaimedDir, firstName)), false)
    assert.equal(existsSync(join(unclaimedDir, secondName)), false)
    assert.match(stderr, /code=EACCES/, 'overlapping isolate/process must surface the EACCES quarantine retry')
    assert.doesNotMatch(stderr, /a-startup-hold\.pdf|b-startup-race\.pdf|c-startup-symlink\.pdf|d-startup-hardlink\.pdf/)
    assert.doesNotMatch(stderr, /CONFIDENTIAL-HOLD-STARTUP-BACKLOG|CONFIDENTIAL-RACE-STARTUP-BACKLOG|CONFIDENTIAL-OUTSIDE-NEVER-DELIVER/)
    assert.equal(readFileSync(outsideFile, 'utf8'), outsideSecret, 'outside symlink/hardlink target must remain untouched')

    chmodSync(unclaimedDir, 0o755)
    await sweepFolder(scanFolder, config)

    assert.equal(leaseRequestCount, 0, 'EACCES retry sweep must NEVER request scan lease')
    assert.equal(deliverRequestCount, 0, 'EACCES retry sweep must NEVER deliver')
    assert.equal(existsSync(firstPath), false, 'retried first file must leave the scan root')
    assert.equal(existsSync(secondPath), false, 'retried second file must leave the scan root')
    assert.equal(existsSync(join(unclaimedDir, firstName)), true, 'retried first file must land in _unclaimed')
    assert.equal(existsSync(join(unclaimedDir, secondName)), true, 'retried second file must land in _unclaimed')
    assert.equal(isStartupBacklogCandidate(firstPath), false, 'successful quarantine must clear the first marker')
    assert.equal(isStartupBacklogCandidate(secondPath), false, 'successful quarantine must clear the second marker')
    assert.equal(existsSync(symlinkPath), true, 'symlink must never be delivered or unlinked')
    assert.equal(existsSync(hardlinkPath), true, 'hardlink must never be delivered or unlinked')
    assert.equal(isStartupBacklogCandidate(symlinkPath), true, 'unsafe symlink marker must be retained')
    assert.equal(isStartupBacklogCandidate(hardlinkPath), true, 'unsafe hardlink marker must be retained')
    assert.equal(readFileSync(outsideFile, 'utf8'), outsideSecret)

    console.log('PASS overlapping startup backlog race: zero lease/delivery, EACCES retry, unsafe never-deliver')
  } finally {
    holdFirst = false
    clearInterval(holdTimer)
    try {
      chmodSync(unclaimedDir, 0o755)
    } catch {}
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(temporaryRoot, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

async function startCountingLeaseServer(): Promise<{
  baseUrl: string
  close: () => Promise<void>
  leaseCount: () => number
  deliverCount: () => number
  leaseNotBeforeIso: string
}> {
  let leaseCount = 0
  let deliverCount = 0
  const leaseNotBeforeIso = new Date(Date.now() - 30_000).toISOString()
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined)
    req.on('end', () => {
      if (req.method === 'GET' && req.url?.includes('/scan-tasks/current-lease')) {
        leaseCount += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            success: true,
            data: {
              scanTaskId: 'task_recovery_must_not_bind_old',
              serverNow: new Date().toISOString(),
              notBefore: leaseNotBeforeIso,
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              deliveryLease: 'recovery_lease_token',
            },
          }),
        )
        return
      }
      if (req.method === 'POST' && req.url?.includes('/scan-sessions/deliver')) {
        deliverCount += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            success: true,
            data: { scanTaskId: 'task_recovery_must_not_bind_old', fileId: 'should_only_bind_new' },
          }),
        )
        return
      }
      res.writeHead(404)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(typeof address === 'object' && address)
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    leaseCount: () => leaseCount,
    deliverCount: () => deliverCount,
    leaseNotBeforeIso,
  }
}

export async function runStartupInspectionFailureZeroDeliveryTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-startup-inspect-fail-'))
  const offlineFolder = `${scanFolder}.offline`
  const oldName = 'startup-unseen.pdf'
  const oldPath = join(scanFolder, oldName)
  const oldSecret = '%PDF-1.4 STARTUP-INSPECT-FAIL-MUST-NOT-DELIVER'
  writeFileSync(oldPath, oldSecret)
  renameSync(scanFolder, offlineFolder)
  try {
    beginScanWatchSessionForTest()
    const { stdout } = await captureLogsAsync(async () => {
      const quarantined = await isolateStartupBacklog(scanFolder)
      assert.equal(quarantined, 0, 'startup inspection failure must not quarantine by guessing')
    })
    assert.equal(getScanInputStateForTest(), 'locked_out')
    assert.equal(isScanDeliveryPausedForTest(), true, 'startup inspection failure must pause delivery')
    assert.match(stdout, /SCAN_INPUT_RESTART_REQUIRED/)
    await processCandidate(oldPath, oldName, makeHelperConfig(backend.baseUrl, scanFolder))
    assert.equal(backend.leaseCount(), 0, 'startup inspection failure must NEVER request a scan lease')
    assert.equal(backend.deliverCount(), 0, 'startup inspection failure must NEVER deliver')
    assert.equal(existsSync(join(offlineFolder, oldName)), true, 'unseen startup file must remain untouched')
    console.log('PASS startup inspection failure: delivery stays paused, zero lease/delivery')
  } finally {
    try {
      if (!existsSync(scanFolder) && existsSync(offlineFolder)) renameSync(offlineFolder, scanFolder)
    } catch {}
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    rmSync(offlineFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runLockoutUntilRestartSafetyTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-lockout-until-restart-'))
  const offlineFolder = `${scanFolder}.offline`
  const oldName = 'remounted-old.pdf'
  const newName = 'after-lockout.pdf'
  const oldPath = join(scanFolder, oldName)
  const newPath = join(scanFolder, newName)
  const oldSecret = '%PDF-1.4 LOCKOUT-OLD-MUST-NOT-BIND'
  const newSecret = '%PDF-1.4 LOCKOUT-NEW-MUST-NOT-DELIVER-THIS-PROCESS'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    const isolated = await isolateStartupBacklog(scanFolder)
    assert.equal(isolated, 0)
    assert.equal(getScanInputStateForTest(), 'running')

    writeFileSync(oldPath, oldSecret)
    renameSync(scanFolder, offlineFolder)
    const { stdout } = await captureLogsAsync(async () => {
      await processCandidate(oldPath, oldName, config)
    })
    assert.equal(getScanInputStateForTest(), 'locked_out')
    assert.equal(backend.leaseCount(), 0, 'unavailable window must NEVER request a scan lease')
    assert.equal(backend.deliverCount(), 0, 'unavailable window must NEVER deliver')
    assert.match(stdout, /SCAN_INPUT_RESTART_REQUIRED/)

    renameSync(offlineFolder, scanFolder)
    const refreshed = Date.now()
    utimesSync(oldPath, new Date(refreshed), new Date(refreshed))
    assert.equal(
      isPreExistingCandidate({ mtimeMs: refreshed, birthtimeMs: refreshed }, backend.leaseNotBeforeIso),
      false,
      'refreshed timestamps must look new to mtime/birthtime — lockout must not rely on them',
    )

    writeFileSync(newPath, newSecret)
    await processCandidate(newPath, newName, config)
    assert.equal(backend.leaseCount(), 0, 'after lockout this process must NEVER request a scan lease')
    assert.equal(backend.deliverCount(), 0, 'after lockout this process must NEVER deliver')
    assert.equal(getScanInputStateForTest(), 'locked_out')

    console.log('PASS lockout-until-restart: unavailable then restored still lease=0/deliver=0')
  } finally {
    try {
      if (!existsSync(scanFolder) && existsSync(offlineFolder)) renameSync(offlineFolder, scanFolder)
    } catch {}
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    rmSync(offlineFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runRootIdentityLockoutTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-root-identity-lockout-'))
  const stashFolder = `${scanFolder}.stash`
  const oldName = 'identity-old.pdf'
  const newName = 'identity-new.pdf'
  const oldSecret = '%PDF-1.4 ROOT-IDENTITY-OLD-MUST-NOT-BIND'
  const newSecret = '%PDF-1.4 ROOT-IDENTITY-NEW-MUST-NOT-DELIVER'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    const previousIdentity = readScanFolderIdentity(scanFolder)
    assert.ok(previousIdentity, 'running folder must have a readable identity')
    assert.equal(getScanInputStateForTest(), 'running')

    writeFileSync(join(scanFolder, oldName), oldSecret)
    renameSync(scanFolder, stashFolder)
    mkdirSync(scanFolder)
    writeFileSync(join(scanFolder, oldName), oldSecret)
    const now = Date.now()
    utimesSync(join(scanFolder, oldName), new Date(now), new Date(now))
    const currentIdentity = readScanFolderIdentity(scanFolder)
    assert.ok(currentIdentity)
    assert.equal(
      scanFolderIdentityChanged(previousIdentity, currentIdentity),
      true,
      'replacing the directory must change root identity',
    )

    await sweepFolder(scanFolder, config)
    assert.equal(getScanInputStateForTest(), 'locked_out')
    assert.equal(backend.leaseCount(), 0, 'root-identity change must NEVER lease')
    assert.equal(backend.deliverCount(), 0, 'root-identity change must NEVER deliver')

    writeFileSync(join(scanFolder, newName), newSecret)
    await processCandidate(join(scanFolder, newName), newName, config)
    assert.equal(backend.leaseCount(), 0)
    assert.equal(backend.deliverCount(), 0)

    console.log('PASS root identity lockout: this process never leases/delivers after identity change')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    rmSync(stashFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runWatcherErrorLockoutTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-rebuild-lockout-'))
  const oldName = 'rebuild-old.pdf'
  const newName = 'rebuild-new.pdf'
  const oldSecret = '%PDF-1.4 WATCHER-ERROR-OLD-MUST-NOT-BIND'
  const newSecret = '%PDF-1.4 WATCHER-ERROR-NEW-MUST-NOT-DELIVER'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    writeFileSync(join(scanFolder, oldName), oldSecret)
    const now = Date.now()
    utimesSync(join(scanFolder, oldName), new Date(now), new Date(now))
    noteScanWatcherRebuildForTest()
    assert.equal(getScanInputStateForTest(), 'locked_out')
    assert.equal(isScanDeliveryPausedForTest(), true)

    await sweepFolder(scanFolder, config)
    assert.equal(backend.leaseCount(), 0, 'watcher error/rebuild request must NEVER lease')
    assert.equal(backend.deliverCount(), 0, 'watcher error/rebuild request must NEVER deliver')

    writeFileSync(join(scanFolder, newName), newSecret)
    await processCandidate(join(scanFolder, newName), newName, config)
    assert.equal(backend.leaseCount(), 0)
    assert.equal(backend.deliverCount(), 0)

    console.log('PASS watcher error lockout: this process never leases/delivers after rebuild request')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runRecoveryEaccesRetryTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-recovery-eacces-'))
  const unclaimedDir = join(scanFolder, '_unclaimed')
  mkdirSync(unclaimedDir)
  chmodSync(unclaimedDir, 0o555)
  const oldName = 'recovery-eacces.pdf'
  const oldPath = join(scanFolder, oldName)
  const oldSecret = '%PDF-1.4 RECOVERY-EACCES-MUST-NOT-DELIVER'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    writeFileSync(oldPath, oldSecret)
    noteScanInputUnavailableForTest()
    assert.equal(getScanInputStateForTest(), 'locked_out')

    const { stderr } = await captureLogsAsync(async () => {
      await sweepFolder(scanFolder, config)
    })
    assert.equal(backend.leaseCount(), 0, 'EACCES recovery retry must NEVER request a scan lease')
    assert.equal(backend.deliverCount(), 0, 'EACCES recovery retry must NEVER deliver')
    assert.equal(existsSync(oldPath), true, 'failed recovery quarantine must leave the file in place')
    assert.equal(isStartupBacklogCandidate(oldPath), true, 'EACCES must retain the never-deliver marker')
    assert.match(stderr, /code=EACCES/)
    assert.doesNotMatch(stderr, /recovery-eacces\.pdf/)
    assert.doesNotMatch(stderr, /RECOVERY-EACCES-MUST-NOT-DELIVER/)

    chmodSync(unclaimedDir, 0o755)
    await sweepFolder(scanFolder, config)
    assert.equal(backend.leaseCount(), 0)
    assert.equal(backend.deliverCount(), 0)
    assert.equal(existsSync(oldPath), false)
    assert.equal(existsSync(join(unclaimedDir, oldName)), true)
    assert.equal(isStartupBacklogCandidate(oldPath), false)

    console.log('PASS recovery EACCES retry: zero lease/delivery, marker retained then quarantined')
  } finally {
    try {
      chmodSync(unclaimedDir, 0o755)
    } catch {}
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runPathCanonicalizationRecoveryTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-canonical-path-'))
  const oldName = 'canonical-old.pdf'
  const oldSecret = '%PDF-1.4 CANONICAL-PATH-MUST-NOT-BIND'
  const directPath = join(scanFolder, oldName)
  const dottedPath = join(scanFolder, '.', oldName)
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    writeFileSync(directPath, oldSecret)
    noteScanInputUnavailableForTest()
    await sweepFolder(scanFolder, config)

    assert.equal(canonicalizeScanPath(dottedPath), canonicalizeScanPath(directPath))
    assert.equal(canonicalizeScanPath(resolvePath(scanFolder, oldName)), canonicalizeScanPath(directPath))
    assert.equal(backend.leaseCount(), 0)
    assert.equal(backend.deliverCount(), 0)
    assert.equal(existsSync(join(scanFolder, '_unclaimed', oldName)), true)

    writeFileSync(directPath, oldSecret)
    noteScanWatcherRebuildForTest()
    await processCandidate(dottedPath, oldName, config)
    assert.equal(backend.leaseCount(), 0, 'non-canonical path must still hit the never-deliver marker')
    assert.equal(backend.deliverCount(), 0)
    assert.equal(existsSync(join(scanFolder, '_unclaimed', oldName)), true)

    console.log('PASS path canonicalization: dotted/resolved paths share never-deliver identity')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runNormalStartupThenNewFileDeliversTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-normal-startup-'))
  const oldName = 'startup-old.pdf'
  const newName = 'after-running.pdf'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    writeFileSync(join(scanFolder, oldName), '%PDF-1.4 STARTUP-OLD')
    beginScanWatchSessionForTest()
    const quarantined = await isolateStartupBacklog(scanFolder)
    assert.equal(quarantined, 1)
    assert.equal(getScanInputStateForTest(), 'running')
    assert.equal(existsSync(join(scanFolder, '_unclaimed', oldName)), true)
    assert.equal(backend.leaseCount(), 0)

    writeFileSync(join(scanFolder, newName), '%PDF-1.4 AFTER-RUNNING')
    await processCandidate(join(scanFolder, newName), newName, config)
    assert.equal(backend.leaseCount(), 2)
    assert.equal(backend.deliverCount(), 1)
    assert.equal(existsSync(join(scanFolder, newName)), false)
    console.log('PASS normal startup: old files isolated, files after RUNNING still deliver')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runRestartSimulationAfterLockoutTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-restart-sim-'))
  const leftover = 'leftover-after-crash.pdf'
  const fresh = 'after-restart.pdf'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    lockOutScanInputForTest('unavailable')
    writeFileSync(join(scanFolder, leftover), '%PDF-1.4 LEFTOVER')
    await processCandidate(join(scanFolder, leftover), leftover, config)
    assert.equal(backend.leaseCount(), 0)
    assert.equal(backend.deliverCount(), 0)

    clearStartupBacklogForTest()
    writeFileSync(join(scanFolder, leftover), '%PDF-1.4 LEFTOVER')
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    assert.equal(getScanInputStateForTest(), 'running')
    assert.equal(existsSync(join(scanFolder, leftover)), false)
    assert.equal(existsSync(join(scanFolder, '_unclaimed', leftover)), true)
    assert.equal(backend.leaseCount(), 0)

    writeFileSync(join(scanFolder, fresh), '%PDF-1.4 AFTER-RESTART')
    await processCandidate(join(scanFolder, fresh), fresh, config)
    assert.equal(backend.leaseCount(), 2)
    assert.equal(backend.deliverCount(), 1)
    console.log('PASS restart simulation: new session isolates leftovers, then new files deliver')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runOldGenerationBlockedAfterStableTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-lockout-after-stable-'))
  const filename = 'inflight-stable.pdf'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    writeFileSync(join(scanFolder, filename), '%PDF-1.4 INFLIGHT-STABLE')
    setScanCandidateTestHooks({
      afterStable: () => lockOutScanInputForTest('unavailable'),
    })
    await processCandidate(join(scanFolder, filename), filename, config)
    assert.equal(backend.leaseCount(), 1, 'opening lineage lease may already have returned before lockout')
    assert.equal(backend.deliverCount(), 0, 'lockout after stable wait must NEVER deliver')
    console.log('PASS old generation blocked after stable wait: 0 lease / 0 POST')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runOldGenerationBlockedAfterLeaseTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-lockout-after-lease-'))
  const filename = 'inflight-lease.pdf'
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    writeFileSync(join(scanFolder, filename), '%PDF-1.4 INFLIGHT-LEASE')
    setScanCandidateTestHooks({
      afterLease: () => lockOutScanInputForTest('unavailable'),
    })
    await processCandidate(join(scanFolder, filename), filename, config)
    assert.equal(backend.leaseCount(), 2, 'opening plus closing lease may already have returned')
    assert.equal(backend.deliverCount(), 0, 'lockout after lease must NEVER POST deliver')
    console.log('PASS old generation blocked after lease: lease returned, 0 POST')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runPeriodicSingleFlightAndStopRaceTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-exclusive-stop-'))
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  let releaseHold: () => void = () => undefined
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve
  })
  try {
    beginScanWatchSessionForTest()
    await isolateStartupBacklog(scanFolder)
    const held = holdScanLifecycleExclusiveForTest(hold)
    const skipped = await runPeriodicScanSweepForTest(scanFolder, config)
    assert.equal(skipped, 'skipped')
    assert.ok(getScanLifecycleExclusiveStatsForTest().skipped >= 1)
    releaseHold()
    await held

    writeFileSync(join(scanFolder, 'stop-race.pdf'), '%PDF-1.4 STOP-RACE')
    setScanCandidateTestHooks({
      afterStable: () => stopScanWatchSessionForTest(),
    })
    await processCandidate(join(scanFolder, 'stop-race.pdf'), 'stop-race.pdf', config)
    assert.equal(backend.leaseCount(), 1, 'opening lineage lease may return before stop')
    assert.equal(backend.deliverCount(), 0, 'stop during in-flight must NEVER deliver')
    assert.equal(getScanInputStateForTest(), 'stopped')
    assert.equal(
      startScanWatcher(config),
      undefined,
      'stop must refuse a new watcher attach in this process',
    )
    console.log('PASS periodic single-flight and stop race: skip overlapping sweep, stop blocks attach and POST')
  } finally {
    releaseHold()
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runWindowsCaseFoldCanonicalKeyTest(): Promise<void> {
  assert.equal(
    canonicalizeScanPath('/Scan/Foo.PDF', 'win32'),
    canonicalizeScanPath('/scan/foo.pdf', 'win32'),
    'Windows path keys must case-fold',
  )
  assert.notEqual(
    canonicalizeScanPath('/Scan/Foo.PDF', 'linux'),
    canonicalizeScanPath('/scan/foo.pdf', 'linux'),
    'non-Windows path keys stay case-sensitive',
  )
  const folder = mkdtempSync(join(tmpdir(), 'scan-watcher-casefold-'))
  try {
    const mixed = join(folder, 'Case.PDF')
    assert.equal(
      canonicalizeScanPath(join(folder, 'case.pdf'), 'win32'),
      canonicalizeScanPath(mixed, 'win32'),
    )
    console.log('PASS Windows case-fold canonical key (8.3/fileId not claimed)')
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

export function runScanDeliveryBarrierUnitContractTests(): void {
  const barrier = new ScanDeliveryBarrier()

  // Contract 1: allowsAttach 只有 idle 为 true
  assert.equal(barrier.allowsAttach(), true, 'idle allows attach')

  // Contract 2: beginWatchSession 仅 idle 可成功并返回 boolean，非法调用不改变 state/generation/identity/reason
  assert.equal(barrier.beginWatchSession(), true, 'beginWatchSession succeeds from idle')
  assert.equal(barrier.getState(), 'initializing')
  assert.equal(barrier.getGeneration(), 1)
  assert.equal(barrier.establishedIdentity(), undefined)
  assert.equal(barrier.lockOutCode(), undefined)
  assert.equal(barrier.allowsAttach(), false, 'initializing does not allow attach')

  // Calling beginWatchSession from initializing fails and mutates nothing
  assert.equal(barrier.beginWatchSession(), false, 'beginWatchSession fails from initializing')
  assert.equal(barrier.getState(), 'initializing')
  assert.equal(barrier.getGeneration(), 1)
  assert.equal(barrier.establishedIdentity(), undefined)
  assert.equal(barrier.lockOutCode(), undefined)

  // Contract 4: enterRunning 成功时必须隔离 generation (generation increments)
  const fakeId = { canonicalPath: '/tmp/scan', dev: 1, ino: 2 }
  assert.equal(barrier.enterRunning(fakeId), true, 'enterRunning succeeds from initializing')
  assert.equal(barrier.getState(), 'running')
  assert.equal(barrier.getGeneration(), 2, 'enterRunning must increment generation')
  assert.equal(barrier.allowsAttach(), false, 'running does not allow attach')
  assert.equal(barrier.generationAllowsDelivery(1), false, 'generation from initializing cannot deliver in running')
  assert.equal(barrier.generationAllowsDelivery(2), true, 'generation matching running can deliver')

  // Calling beginWatchSession from running fails and mutates nothing
  assert.equal(barrier.beginWatchSession(), false, 'beginWatchSession fails from running')
  assert.equal(barrier.getState(), 'running')
  assert.equal(barrier.getGeneration(), 2)
  assert.equal(barrier.establishedIdentity(), fakeId)
  assert.equal(barrier.lockOutCode(), undefined)

  // Calling enterRunning from running fails and mutates nothing
  assert.equal(barrier.enterRunning(fakeId), false, 'enterRunning fails when already running')
  assert.equal(barrier.getGeneration(), 2)

  // Contract 3: lockOut 对 locked_out/stopped 幂等并保留首次 reason
  barrier.lockOut('first_reason')
  assert.equal(barrier.getState(), 'locked_out')
  assert.equal(barrier.getGeneration(), 3)
  assert.equal(barrier.lockOutCode(), 'first_reason')
  assert.equal(barrier.allowsAttach(), false, 'locked_out does not allow attach')

  // Second lockOut on locked_out is idempotent and preserves first reason
  barrier.lockOut('second_reason')
  assert.equal(barrier.getState(), 'locked_out')
  assert.equal(barrier.getGeneration(), 3, 'lockOut on locked_out must not bump generation')
  assert.equal(barrier.lockOutCode(), 'first_reason', 'lockOut on locked_out must retain first reason')

  // Calling beginWatchSession from locked_out fails and mutates nothing
  assert.equal(barrier.beginWatchSession(), false, 'beginWatchSession fails from locked_out')
  assert.equal(barrier.getState(), 'locked_out')
  assert.equal(barrier.getGeneration(), 3)
  assert.equal(barrier.lockOutCode(), 'first_reason')

  // Now test stopped state
  barrier.stop()
  assert.equal(barrier.getState(), 'stopped')
  assert.equal(barrier.getGeneration(), 4)
  assert.equal(barrier.lockOutCode(), 'stopped')
  assert.equal(barrier.allowsAttach(), false, 'stopped does not allow attach')

  // lockOut on stopped is idempotent and preserves first reason
  barrier.lockOut('attempt_after_stopped')
  assert.equal(barrier.getState(), 'stopped')
  assert.equal(barrier.getGeneration(), 4, 'lockOut on stopped must not bump generation')
  assert.equal(barrier.lockOutCode(), 'stopped', 'lockOut on stopped must retain stopped reason')

  // beginWatchSession on stopped fails and mutates nothing
  assert.equal(barrier.beginWatchSession(), false, 'beginWatchSession fails from stopped')
  assert.equal(barrier.getState(), 'stopped')
  assert.equal(barrier.getGeneration(), 4)
  assert.equal(barrier.lockOutCode(), 'stopped')

  console.log('PASS ScanDeliveryBarrier unit contract checks (allowsAttach, beginWatchSession, lockOut idempotency, generation isolation)')
}

export async function runEnterRunningGenerationIsolationTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-init-generation-isolation-'))
  const initFilename = 'candidate-during-initializing.pdf'
  const runningFilename = 'candidate-after-running.pdf'
  const initPath = join(scanFolder, initFilename)
  const runningPath = join(scanFolder, runningFilename)
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    // 1. Start watch session -> state becomes initializing (generation = 1)
    beginScanWatchSessionForTest()
    assert.equal(getScanInputStateForTest(), 'initializing')
    assert.equal(getScanInputGenerationForTest(), 1)

    // Write file that arrives during initializing
    writeFileSync(initPath, '%PDF-1.4 CREATED-DURING-INITIALIZING')

    // Hook afterStable: while candidate-during-initializing is waiting in waitForStableFile,
    // isolateStartupBacklog completes and calls enterRunning, bumping generation to 2!
    let enteredRunningDuringCandidate = false
    setScanCandidateTestHooks({
      afterStable: () => {
        const id = readScanFolderIdentity(scanFolder)
        if (id) {
          enterRunningForTest(id)
        }
        enteredRunningDuringCandidate = true
      },
    })

    await processCandidate(initPath, initFilename, config)
    assert.equal(enteredRunningDuringCandidate, true, 'candidate must have experienced enterRunning transition')

    // CONTRACT 4 VERIFICATION:
    // The candidate captured during initializing must NEVER lease or deliver in running!
    assert.equal(
      backend.leaseCount(),
      0,
      'candidate captured during initializing must NEVER request a scan lease or deliver',
    )
    assert.equal(backend.deliverCount(), 0, 'candidate captured during initializing must NEVER deliver')
    assert.equal(existsSync(initPath), false, 'initializing candidate must be moved out of scan folder')
    assert.equal(
      existsSync(join(scanFolder, '_unclaimed', initFilename)),
      true,
      'initializing candidate must be quarantined to _unclaimed',
    )

    // Clear test hooks
    setScanCandidateTestHooks({})

    // NOW VERIFY: new file arriving in running CAN deliver normally!
    writeFileSync(runningPath, '%PDF-1.4 CREATED-AFTER-RUNNING')
    await processCandidate(runningPath, runningFilename, config)
    assert.equal(backend.leaseCount(), 2, 'candidate created in running must successfully request scan lease')
    assert.equal(backend.deliverCount(), 1, 'candidate created in running must successfully deliver')
    assert.equal(existsSync(runningPath), false, 'delivered file must be removed')

    console.log('PASS enterRunning generation isolation: initializing candidate quarantined (0 lease/deliver), running candidate delivers (1 lease/deliver)')
  } finally {
    setScanCandidateTestHooks({})
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runIsolateStartupBacklogIdentityChangeLockoutTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-backlog-identity-change-'))
  const stashFolder = `${scanFolder}.stash`
  const testFile = 'startup-file.pdf'
  writeFileSync(join(scanFolder, testFile), '%PDF-1.4 STARTUP-FILE')
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    assert.equal(getScanInputStateForTest(), 'initializing')

    // Hook during startup isolation: replace the directory before post-isolation check
    setScanCandidateTestHooks({
      duringStartupIsolation: () => {
        renameSync(scanFolder, stashFolder)
        mkdirSync(scanFolder)
      },
    })

    await isolateStartupBacklog(scanFolder)

    // CONTRACT 5 VERIFICATION:
    // Identity changed during isolation -> must lockout, not enter running!
    assert.equal(
      getScanInputStateForTest(),
      'locked_out',
      'isolateStartupBacklog with changed identity must lockout',
    )
    assert.equal(
      getScanInputLockOutReasonForTest(),
      'root_identity_changed',
      'lockout reason must be root_identity_changed',
    )

    // Subsequent candidate in this process must NEVER lease or deliver
    const postFile = 'after-identity-change.pdf'
    writeFileSync(join(scanFolder, postFile), '%PDF-1.4 AFTER-IDENTITY-CHANGE')
    await processCandidate(join(scanFolder, postFile), postFile, config)
    assert.equal(backend.leaseCount(), 0, 'locked-out process must NEVER lease')
    assert.equal(backend.deliverCount(), 0, 'locked-out process must NEVER deliver')

    console.log('PASS isolateStartupBacklog identity change lockout: lockOut root_identity_changed, 0 lease/deliver')
  } finally {
    setScanCandidateTestHooks({})
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    rmSync(stashFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runIsolateStartupBacklogIdentityMissingLockoutTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-backlog-identity-missing-'))
  const stashFolder = `${scanFolder}.stash`
  const testFile = 'startup-file-missing.pdf'
  writeFileSync(join(scanFolder, testFile), '%PDF-1.4 STARTUP-FILE-MISSING')
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  try {
    beginScanWatchSessionForTest()
    assert.equal(getScanInputStateForTest(), 'initializing')

    // Hook: remove the folder completely so readScanFolderIdentity returns undefined
    setScanCandidateTestHooks({
      duringStartupIsolation: () => {
        renameSync(scanFolder, stashFolder)
      },
    })

    await isolateStartupBacklog(scanFolder)

    // CONTRACT 5 VERIFICATION:
    // Identity missing after isolation -> must lockout identity_unavailable, not enter running!
    assert.equal(
      getScanInputStateForTest(),
      'locked_out',
      'isolateStartupBacklog with missing identity must lockout',
    )
    assert.equal(
      getScanInputLockOutReasonForTest(),
      'identity_unavailable',
      'lockout reason must be identity_unavailable',
    )

    console.log('PASS isolateStartupBacklog identity missing lockout: lockOut identity_unavailable')
  } finally {
    setScanCandidateTestHooks({})
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    rmSync(stashFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runStartScanWatcherInitialHealthLockoutTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const nonExistentFolder = join(tmpdir(), `non-existent-scan-dir-${Date.now()}`)
  const config = makeHelperConfig(backend.baseUrl, nonExistentFolder)
  try {
    assert.equal(getScanInputStateForTest(), 'idle')

    const handle = startScanWatcher(config)
    assert.equal(handle, undefined, 'startScanWatcher on unready folder must return undefined')

    // CONTRACT 6 VERIFICATION:
    // Initial health not ready -> immediately lockout!
    assert.equal(
      getScanInputStateForTest(),
      'locked_out',
      'startScanWatcher initial health not ready must immediately lockout',
    )
    assert.equal(
      getScanInputLockOutReasonForTest(),
      'unavailable',
      'lockout reason must match health reason',
    )

    // Secondary start must also be blocked
    const secondHandle = startScanWatcher(config)
    assert.equal(secondHandle, undefined, 'secondary start must return undefined')
    assert.equal(getScanInputStateForTest(), 'locked_out')
    assert.equal(getScanInputLockOutReasonForTest(), 'unavailable')

    console.log('PASS startScanWatcher initial health lockout: immediately locked_out, reason recorded')
  } finally {
    await backend.close()
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runSecondaryStartBlockedAcrossStatesTest(): Promise<void> {
  clearStartupBacklogForTest()
  const backend = await startCountingLeaseServer()
  const scanFolder = mkdtempSync(join(tmpdir(), 'scan-watcher-secondary-start-'))
  const config = makeHelperConfig(backend.baseUrl, scanFolder)
  const testCandidate = 'sample-candidate.pdf'
  const testCandidatePath = join(scanFolder, testCandidate)

  const states = ['locked_out', 'running', 'initializing', 'stopped'] as const

  try {
    for (const targetState of states) {
      clearStartupBacklogForTest()
      globalDirectoryBaseline.clear()

      // Set up target state
      if (targetState === 'initializing') {
        beginScanWatchSessionForTest()
      } else if (targetState === 'running') {
        beginScanWatchSessionForTest()
        const id = readScanFolderIdentity(scanFolder)
        assert.ok(id)
        enterRunningForTest(id)
      } else if (targetState === 'locked_out') {
        lockOutScanInputForTest('setup_lockout')
      } else if (targetState === 'stopped') {
        stopScanWatchSessionForTest()
      }
      assert.equal(getScanInputStateForTest(), targetState)

      // Set up baseline and backlog tracking
      globalDirectoryBaseline.recordObservation(testCandidate, Date.now() - 20_000, null)
      assert.equal(
        globalDirectoryBaseline.isPreExisting(testCandidate, Date.now()),
        true,
        'baseline must have recorded observation',
      )

      // Mark candidate in backlog
      writeFileSync(testCandidatePath, '%PDF-1.4 SAMPLE')
      // Note down generation and state before secondary start
      const genBefore = getScanInputGenerationForTest()
      const stateBefore = getScanInputStateForTest()
      const reasonBefore = getScanInputLockOutReasonForTest()

      // Secondary start
      const handle = startScanWatcher(config)

      // Assertions for Contract 7:
      assert.equal(handle, undefined, `startScanWatcher in ${targetState} must return undefined (no watcher)`)
      assert.equal(getScanInputStateForTest(), stateBefore, `state must not change from ${targetState}`)
      assert.equal(getScanInputGenerationForTest(), genBefore, `generation must not change from ${targetState}`)
      assert.equal(getScanInputLockOutReasonForTest(), reasonBefore, `reason must not change from ${targetState}`)
      assert.equal(
        globalDirectoryBaseline.isPreExisting(testCandidate, Date.now()),
        true,
        `baseline must not be cleared on secondary start from ${targetState}`,
      )

      // Zero lease / zero POST
      assert.equal(backend.leaseCount(), 0, `secondary start in ${targetState} must have 0 lease`)
      assert.equal(backend.deliverCount(), 0, `secondary start in ${targetState} must have 0 deliver`)
    }

    console.log('PASS secondary start blocked across locked_out/running/initializing/stopped (no watcher, no clear, no state/gen change, 0 lease/POST)')
  } finally {
    await backend.close()
    rmSync(scanFolder, { recursive: true, force: true })
    clearStartupBacklogForTest()
    globalDirectoryBaseline.clear()
  }
}

export async function runScanInputLockoutTests(): Promise<void> {
  runScanDeliveryBarrierUnitContractTests()
  await runStartupInspectionFailureZeroDeliveryTest()
  await runNormalStartupThenNewFileDeliversTest()
  await runLockoutUntilRestartSafetyTest()
  await runRootIdentityLockoutTest()
  await runWatcherErrorLockoutTest()
  await runRestartSimulationAfterLockoutTest()
  await runOldGenerationBlockedAfterStableTest()
  await runOldGenerationBlockedAfterLeaseTest()
  await runPeriodicSingleFlightAndStopRaceTest()
  await runWindowsCaseFoldCanonicalKeyTest()
  await runRecoveryEaccesRetryTest()
  await runPathCanonicalizationRecoveryTest()
  await runEnterRunningGenerationIsolationTest()
  await runIsolateStartupBacklogIdentityChangeLockoutTest()
  await runIsolateStartupBacklogIdentityMissingLockoutTest()
  await runStartScanWatcherInitialHealthLockoutTest()
  await runSecondaryStartBlockedAcrossStatesTest()
}
