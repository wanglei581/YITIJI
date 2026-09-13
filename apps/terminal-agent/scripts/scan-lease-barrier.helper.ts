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
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  processCandidate,
  maskScanName,
  isolateStartupBacklog,
  finalizeCandidate,
  sweepFolder,
  isStartupBacklogCandidate,
  clearStartupBacklogForTest,
} from '../src/agent/scan-watcher'
import type { TrustedWindowsCandidate } from '../src/agent/scan-input/windows-secure-reader'
import {
  isPreExistingCandidate,
  ScanDirectoryBaseline,
  globalDirectoryBaseline,
  SCAN_PRE_EXISTING_TOLERANCE_MS,
  type ScanTaskLease,
} from '../src/agent/scan-candidate-barrier'
import type { AgentConfig } from '../src/agent/types'

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

    // 非法/无效时间安全兜底返回 false
    assert.equal(isPreExistingCandidate({ mtimeMs: 100 }, 'invalid-iso-date'), false)
  }

  // 2. ScanDirectoryBaseline 内存目录基线判定
  {
    const baseline = new ScanDirectoryBaseline()
    const now = Date.now()
    baseline.recordObservation('stale_scan.pdf', now - 10_000)
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
      globalDirectoryBaseline.recordObservation(oldFile, restartTime - 20_000)

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

  await runOverlappingStartupBacklogRaceTest()

  console.log('PASS scan lease barrier helper checks')
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
