import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { copyBackend } from '../src/agent/copy-device/copy-backend'
import { globalDeviceLock } from '../src/agent/device-lock'
import { __resetClaimRateLimitForTests, startTaskRunner } from '../src/agent/task-runner'
import { __resetPrintDispatchGateForTests } from '../src/agent/print-dispatch-gate'
import { openDatabase } from '../src/agent/db'
import { __setUnauthorizedMarkerPathForTests, __resetUnauthorizedForTests } from '../src/agent/auth-state'
import { fixture, base, plain, scan, listen, expectCode, flush } from './verify-copy-device.helper'

async function until(fn: () => boolean): Promise<void> {
  const end = Date.now() + 3000
  while (!fn()) { assert.ok(Date.now() < end, '等待条件超时'); await new Promise((resolve) => setTimeout(resolve, 10)) }
}
export async function networkChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('真实 loopback 后端契约：Agent 身份取许可、无重定向、仅回报代次/页数，无扫描件上传', async () => {
    const f = fixture()
    const seen: Array<{ url: string; body: string; auth?: string; terminal?: string | string[] }> = []
    const backend = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        seen.push({ url: req.url!, body: Buffer.concat(chunks).toString(), auth: req.headers.authorization,
          terminal: req.headers['x-terminal-id'] })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true, data: req.url!.includes('permit') ? f.permit(base.copyId) :
          { copyId: base.copyId, terminalId: f.config.terminalId, generation: 1, pageCount: 1, state: 'scanned' } }))
      })
    })
    const port = await listen(backend)
    f.config.apiBaseUrl = `http://127.0.0.1:${port}/api/v1`
    __setUnauthorizedMarkerPathForTests(path.join(f.root, 'unauthorized'))
    __resetUnauthorizedForTests()
    const actual = fixture({ deps: { ...copyBackend(f.config) } })
    try {
      await scan(actual)
      await actual.runtime.command('finish', plain(), 'owner'); await actual.runtime.whenIdle()
      assert.equal((await actual.view()).state, 'scanned')
      assert.deepEqual(seen.map((r) => r.url), [
        `/api/v1/terminals/${f.config.terminalId}/copy/jobs/${base.copyId}/permit?op=scan`,
        `/api/v1/terminals/${f.config.terminalId}/copy/jobs/${base.copyId}/scan-result`,
      ])
      assert.deepEqual(JSON.parse(seen[1]!.body), { generation: 1, pageCount: 1 })
      for (const row of seen) {
        assert.equal(row.auth, `Bearer ${f.config.agentToken}`)
        assert.equal(row.terminal, f.config.terminalId)
        assert.equal(row.body.includes('file'), false)
      }
    } finally { await actual.close(); await f.close(); await new Promise<void>((r) => backend.close(() => r())) }
  })
  await check('回报丢失显示未确认，新 finish 只重报不重扫；许可网络错误和过长 TTL 拒绝硬件', async () => {
    let fail = true
    let reports = 0
    const f = fixture({ deps: { report: async () => { reports += 1; if (fail) throw new Error('lost') } } })
    try {
      await scan(f)
      await f.runtime.command('finish', plain(), 'owner'); await f.runtime.whenIdle()
      assert.equal((await f.view()).errorCode, 'COPY_SCAN_RESULT_UNCONFIRMED')
      fail = false
      await f.runtime.command('finish', plain({ operationId: 'finish-retry' }), 'owner'); await f.runtime.whenIdle()
      assert.equal((await f.view()).state, 'scanned')
      assert.equal(reports, 2); assert.equal(f.calls.length, 1)
    } finally { await f.close() }
    const offline = fixture({ deps: { permit: async () => { throw new Error('offline') } } })
    try { await scan(offline); assert.equal(offline.calls.length, 0) } finally { await offline.close() }
    const long = fixture()
    try {
      long.patchPermit({ expiresAt: new Date(long.clock.now() + 31_000).toISOString() })
      await scan(long); assert.equal(long.calls.length, 0)
    } finally { await long.close() }
  })
  await check('仅 copy 开启时现有打印领取也共锁；复制扫描持锁时不领取，释放后可领取', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-copy-print-lock-'))
    const previous = process.env['PROGRAMDATA']
    process.env['PROGRAMDATA'] = root
    __setUnauthorizedMarkerPathForTests(path.join(root, 'unauthorized'))
    __resetUnauthorizedForTests(); __resetPrintDispatchGateForTests(); __resetClaimRateLimitForTests()
    const db = openDatabase(); assert.ok(db)
    let claims = 0
    const backend = http.createServer((req, res) => {
      req.on('data', () => undefined)
      req.on('end', () => { if (req.url?.includes('/tasks/claim')) claims += 1
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('[]') })
    })
    const port = await listen(backend)
    const f = fixture({ hold: true, deps: { lock: globalDeviceLock } })
    f.config.apiBaseUrl = `http://127.0.0.1:${port}/api/v1`
    f.config.claimIntervalMs = 3_600_000
    let runner: ReturnType<typeof startTaskRunner> | undefined
    try {
      await f.runtime.command('start', base, 'owner'); await flush()
      assert.equal(f.calls.length, 1)
      runner = startTaskRunner({ config: f.config, db }); runner.wake()
      await new Promise((r) => setTimeout(r, 100)); assert.equal(claims, 0)
      f.complete(); await f.runtime.whenIdle()
      runner.wake(); await until(() => claims === 1)
      const print = await globalDeviceLock.acquire('print-claim')
      await f.runtime.command('next-page', plain(), 'owner'); await flush()
      assert.equal(f.calls.length, 1)
      print.release(); await until(() => f.calls.length === 2)
      f.complete(); await f.runtime.whenIdle()
      await expectCode(() => f.runtime.command('preview', plain({ page: 1 }), 'new-user'), 'COPY_NOT_FOUND')
    } finally {
      runner?.stop(); await f.close(); db.close()
      await new Promise<void>((r) => backend.close(() => r()))
      if (previous === undefined) delete process.env['PROGRAMDATA']; else process.env['PROGRAMDATA'] = previous
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}
