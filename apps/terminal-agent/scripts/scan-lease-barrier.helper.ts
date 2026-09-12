import assert from 'node:assert/strict'
import http from 'node:http'
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  rmSync,
  readFileSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  processCandidate,
  maskScanName,
} from '../src/agent/scan-watcher'
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

  console.log('PASS scan lease barrier helper checks')
}
