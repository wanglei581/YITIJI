import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { printFixture, ready, sendPrint, readRecord, printCommand } from './verify-copy-print.helper'
import { base, plain, expectCode, flush, listen, request } from './verify-copy-device.helper'
import { createCopyRuntime } from '../src/agent/copy-device/copy-runtime'
import { copyBackend } from '../src/agent/copy-device/copy-backend'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import { printWithPdfToPrinter } from '../src/printer/print-with-pdf-to-printer'

export async function recoveryChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('dispatching/spooled 两个崩溃窗口：真实落盘快照重启 unconfirmed、回报、不重派', async () => {
    for (const state of ['dispatching', 'spooled'] as const) {
      let release!: () => void
      const waiting = new Promise<void>((resolve) => { release = resolve })
      const f = printFixture(state === 'dispatching' ? { beforeDriver: () => waiting } : { monitorWait: () => waiting })
      let restart: ReturnType<typeof printFixture> | undefined
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-print-restart-'))
      try {
        await ready(f); await f.runtime.command('print', printCommand, 'owner'); await flush()
        assert.equal(readRecord(f.root).state, state)
        fs.cpSync(f.root, root, { recursive: true })
        restart = printFixture({ root })
        await restart.runtime.whenIdle()
        assert.equal(readRecord(root).state, 'unconfirmed')
        assert.equal(restart.results[0]?.state, 'unconfirmed')
        assert.equal(restart.results[0]?.eventId, readRecord(f.root).eventId)
        assert.equal(restart.printCalls.length, 0)
        assert.equal((await restart.view()).state, 'unconfirmed')
        assert.equal((await restart.runtime.command('print', printCommand, 'owner') as { state: string }).state, 'unconfirmed')
        assert.equal(restart.printCalls.length, 0)
        await expectCode(() => restart!.runtime.command('start', base, 'owner'), 'COPY_ALREADY_DISPATCHED')
        await expectCode(() => restart!.view('other-owner'), 'COPY_NOT_FOUND')
        assert.equal(fs.existsSync(restart.dir()), false)
        assert.ok(restart.audit.some((a) => a.reason === 'COPY_PRINT_TERMINAL'))
      } finally { release(); await restart?.close(); await f.close(); fs.rmSync(root, { recursive: true, force: true }) }
    }
  })
  await check('回报失败耐久重试：同 eventId/终态不变；重启继续，十次封顶后保留记录', async () => {
    const f = printFixture({ reportFails: true })
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-result-restart-'))
    let restart: ReturnType<typeof printFixture> | undefined
    try {
      await ready(f); await sendPrint(f)
      assert.equal(readRecord(f.root).attempts, 1); assert.equal(readRecord(f.root).acked, false)
      assert.equal((await f.view()).state, 'handed')
      fs.cpSync(f.root, root, { recursive: true }); restart = printFixture({ root, reportFails: true })
      await restart.runtime.whenIdle(); assert.equal(restart.results.length, 0)
      restart.clock.jump(30_001); await restart.runtime.tick()
      assert.equal(readRecord(root).attempts, 2)
      restart.failReport(false); restart.clock.jump(60_001); await restart.runtime.tick()
      assert.equal(readRecord(root).acked, true); assert.equal(readRecord(root).state, 'handed')
      assert.equal(new Set([...f.results, ...restart.results].map((r) => r.eventId)).size, 1)
      assert.equal(restart.printCalls.length, 0)
      for (let i = 0; i < 14; i++) { f.clock.jump(1_800_001); await f.runtime.tick() }
      assert.equal(f.results.length, 10); assert.equal(readRecord(f.root).attempts, 10)
      assert.equal((await f.view()).state, 'handed'); assert.equal(f.printCalls.length, 1)
    } finally { await restart?.close(); await f.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  await check('打印期间 clear/180 秒撤预览、监控继续；文件被占用先隔离，后台删除不持设备锁', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const f = printFixture({ monitorWait: () => wait })
    try {
      await ready(f); await f.runtime.command('print', printCommand, 'owner'); await flush()
      f.clock.jump(180_001); await f.runtime.tick()
      const cleared = await f.runtime.command('clear', plain({ operationId: 'clear' }), 'owner') as { purged: boolean }
      assert.equal(cleared.purged, false); assert.equal(fs.existsSync(f.dir()), true)
      await expectCode(() => f.runtime.command('preview', plain({ page: 1 }), 'owner'), 'COPY_EXPIRED')
      assert.equal(f.lock.tryAcquire('scan-device'), undefined)
      f.failDeletion(true); release(); await f.runtime.whenIdle()
      assert.equal((await f.view()).state, 'handed'); assert.equal((await f.view()).purged, false)
      const free = await f.lock.acquire('scan-device'); free.release()
      assert.ok(f.audit.some((a) => a.reason === 'COPY_PRINT_TERMINAL' && a.result === 'delete_failed'))
      f.failDeletion(false); await f.runtime.tick()
      assert.equal((await f.view()).purged, true); assert.equal(fs.existsSync(f.dir()), false)
    } finally { release(); await f.close() }
  })
  await check('Sumatra 超时仍读文件：终态未确认后不锁整机，读取结束后后台删页', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const f = printFixture({ driver: () => wait, timeoutMs: 5, stages: Array(100).fill('not_found') })
    try {
      await ready(f); await sendPrint(f)
      assert.equal((await f.view()).state, 'unconfirmed')
      assert.equal((await f.view()).purged, false); assert.equal(fs.existsSync(f.dir()), true)
      const free = await f.lock.acquire('copy-scan'); free.release()
      release(); await flush(); await f.runtime.tick()
      assert.equal(fs.existsSync(f.dir()), false)
      assert.equal(f.printCalls.length, 1)
    } finally { release(); await f.close() }
  })
  await check('本机 print 严格公共体；在线 print 许可和 result 只发 Agent 元数据；回报丢失重试', async () => {
    const f = printFixture()
    const seen: Array<{ url: string; auth?: string; terminal?: string | string[]; body: string }> = []
    const backend = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (b: Buffer) => chunks.push(b)); req.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        seen.push({ url: req.url!, body, auth: req.headers.authorization, terminal: req.headers['x-terminal-id'] })
        const data = req.url?.includes('permit') ? { ...f.permit(base.copyId), op: 'print', authorizationVersion: 1,
          parameters: { ...f.permit(base.copyId).parameters, pageCount: 1 } } :
          { copyId: base.copyId, generation: 1, terminalId: f.config.terminalId, state: 'handed' }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data }))
      })
    })
    const port = await listen(backend)
    f.config.apiBaseUrl = `http://127.0.0.1:${port}/api/v1`
    const adapter = copyBackend(f.config)
    const permit = await adapter.permit(base.copyId, 'print')
    const runtime = createCopyRuntime(f.config, { root: path.join(f.root, 'network-runtime'),
      permit: adapter.permit, reportPrint: adapter.reportPrint })
    const server = startQrLoginLocalServer(f.config, { copyDevice: f.runtime })!
    await new Promise<void>((resolve) => server.server.once('listening', resolve))
    try {
      assert.equal(permit.op, 'print')
      await adapter.reportPrint(base.copyId, { generation: 1, eventId: 'test-event', state: 'handed' })
      assert.deepEqual(seen.map((r) => r.url), [
        `/api/v1/terminals/${f.config.terminalId}/copy/jobs/${base.copyId}/permit?op=print`,
        `/api/v1/terminals/${f.config.terminalId}/copy/jobs/${base.copyId}/result`,
      ])
      assert.deepEqual(JSON.parse(seen[1]!.body), { generation: 1, eventId: 'test-event', state: 'handed' })
      assert.ok(seen.every((r) => r.auth === `Bearer ${f.config.agentToken}` && r.terminal === f.config.terminalId))
      for (const field of ['printGrant', 'copies', 'file', 'pageCount']) {
        assert.equal((await request(server.port, '/local/copy/print', { ...plain(), [field]: 'forbidden' })).status, 400)
      }
      const started = await request(server.port, '/local/copy/start', base); assert.equal(started.status, 200)
      await f.runtime.whenIdle()
      assert.equal((await request(server.port, '/local/copy/finish', plain({ operationId: 'finish-http' }))).status, 200)
      await f.runtime.whenIdle()
      assert.equal((await request(server.port, '/local/copy/print', printCommand)).status, 200)
      await f.runtime.whenIdle()
      const status = (await request(server.port, '/local/copy/status', plain())).json().data
      assert.equal(status.state, 'handed'); assert.equal(f.printCalls.length, 1)
      assert.equal(JSON.stringify(status).includes('sheet'), false)
      assert.equal(JSON.stringify(status).includes(f.root), false)
    } finally { runtime.stop(); await server.close(); await f.close(); await new Promise<void>((r) => backend.close(() => r())) }
  })
  await check('关闭开关也恢复未终态并耐久回报；损坏账本拒绝打印且不删墓碑', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const f = printFixture({ beforeDriver: () => wait })
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-disabled-restart-'))
    let runtime: ReturnType<typeof createCopyRuntime> | undefined
    const states: string[] = []
    try {
      await ready(f); await f.runtime.command('print', printCommand, 'owner'); await flush()
      fs.cpSync(f.root, root, { recursive: true })
      runtime = createCopyRuntime({ ...f.config, copyDeviceEnabled: false }, { root,
        reportPrint: async (_id, result) => { states.push(result.state) } })
      await runtime.whenIdle()
      assert.deepEqual(states, ['unconfirmed']); assert.equal(readRecord(root).acked, true)
      await expectCode(() => runtime!.command('print', printCommand, 'owner'), 'COPY_DISABLED')
      const ledgerFile = path.join(root, 'print-ledger', fs.readdirSync(path.join(root, 'print-ledger'))[0]!)
      fs.writeFileSync(ledgerFile, 'broken')
      runtime.stop()
      runtime = createCopyRuntime(f.config, { root, reportPrint: async () => { throw new Error('must not report corrupt record') } })
      await runtime.whenIdle()
      assert.equal(fs.readFileSync(ledgerFile, 'utf8'), 'broken')
      // 损坏账本使新派发失败关闭，绝不把它当作没有派发记录。
      assert.equal(states.length, 1)
      runtime.stop()
      const corrupted = printFixture({ root })
      try {
        await ready(corrupted)
        await expectCode(() => corrupted.runtime.command('print', printCommand, 'owner'), 'COPY_STORAGE_UNSAFE')
        assert.equal(corrupted.printCalls.length, 0)
      } finally { await corrupted.close() }
    } finally { runtime?.stop(); release(); await f.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  await check('许可在队列准备期间过期不打；耐久意图落盘失败也不调用驱动', async () => {
    const f = printFixture({ beforeDriver: async () => { f.clock.jump(30_001) } })
    try {
      await ready(f); await sendPrint(f)
      assert.equal(f.printCalls.length, 0); assert.equal((await f.view()).state, 'failed')
    } finally { await f.close() }
    const broken = printFixture()
    try {
      await ready(broken)
      const { copyDirId } = await import('../src/agent/copy-device/copy-storage')
      fs.writeFileSync(path.join(broken.root, 'print-ledger', `${copyDirId(base.copyId, 1)}.json`), '{}')
      await sendPrint(broken)
      assert.equal(broken.printCalls.length, 0); assert.equal((await broken.view()).errorCode, 'COPY_STORAGE_UNSAFE')
      await expectCode(() => broken.runtime.command('print', plain({ operationId: 'try-again' }), 'owner'), 'COPY_STORAGE_UNSAFE')
    } finally { await broken.close() }
  })
  await check('真实打印函数超时回调跟踪实际执行器，超时返回不伪称读文件结束', async () => {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const events: string[] = []
    const result = await printWithPdfToPrinter('/private/copy.pdf', 'configured-printer', { paperSize: 'A4' }, {
      timeoutMs: 5, dispatch: () => wait, onDispatchStart() { events.push('start') },
      onDispatchSettled() { events.push('settled') },
    })
    assert.equal(result.errorCode, 'PRINT_TIMEOUT'); assert.deepEqual(events, ['start'])
    release(); await flush(); assert.deepEqual(events, ['start', 'settled'])
  })
}
