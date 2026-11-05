import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import { parseConfigText } from '../src/agent/config-manager'
import { COPY_DELETION_REASONS } from '../src/agent/copy-device/copy-types'
import { fixture, base, plain, scan, expectCode, request, JPEG } from './verify-copy-device.helper'
import { printChecks } from './verify-copy-print.helper'
import { edgeChecks } from './verify-copy-device-edges.helper'

let passed = 0
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn(); passed += 1; console.log(`PASS ${name}`)
}
async function main(): Promise<void> {
  await check('开关默认关闭且拒绝全部本机复印路由；无硬件调用', async () => {
    const f = fixture()
    assert.equal(parseConfigText(JSON.stringify({ ...f.config, copyDeviceEnabled: undefined })).copyDeviceEnabled, false)
    assert.throws(() => parseConfigText(JSON.stringify({ ...f.config, copyDeviceEnabled: 'true' })))
    f.config.copyDeviceEnabled = false
    const server = startQrLoginLocalServer(f.config, { copyDevice: f.runtime })!
    await new Promise<void>((resolve) => server.server.once('listening', resolve))
    try {
      for (const action of ['start', 'next-page', 'finish', 'status', 'preview', 'abort', 'clear', 'print']) {
        assert.equal((await request(server.port, `/local/copy/${action}`, base)).json().error.code, 'COPY_DISABLED')
      }
      assert.equal(f.calls.length, 0)
    } finally { await server.close(); await f.close() }
  })
  await check('在线许可拒绝、过期、跨单/终端/代次/操作、坏参数均不动硬件', async () => {
    for (const patch of [
      { allowed: false }, { allowed: undefined }, { generation: 2 }, { terminalId: 'other' },
      { copyId: 'other' }, { op: 'print' as const }, { authorizationVersion: -1 },
      { expiresAt: '2000-01-01T00:00:00Z' }, { expiresAt: 'bad' },
    ]) {
      const f = fixture()
      try { f.patchPermit(patch); await scan(f); assert.equal(f.calls.length, 0); assert.equal((await f.view()).state, 'failed') }
      finally { await f.close() }
    }
    const f = fixture()
    try {
      f.patchPermit({ parameters: { ...f.permit(base.copyId).parameters, source: 'feeder' } })
      await scan(f); assert.equal(f.calls.length, 0)
    } finally { await f.close() }
  })
  await check('operationId 幂等与异参/异操作冲突；玻璃台续页、合成及仅页数回报', async () => {
    const f = fixture()
    try {
      const first = await f.runtime.command('start', base, 'owner')
      await f.runtime.whenIdle()
      assert.deepEqual(await f.runtime.command('start', base, 'owner'), first)
      assert.equal(f.calls.length, 1)
      await expectCode(() => f.runtime.command('start', { ...base, scanColor: 'gray' }, 'owner'), 'COPY_OPERATION_CONFLICT')
      await expectCode(() => f.runtime.command('abort', plain({ operationId: base.operationId }), 'owner'), 'COPY_OPERATION_CONFLICT')
      await f.runtime.command('next-page', plain({ operationId: 'page-2' }), 'owner')
      await f.runtime.whenIdle()
      assert.deepEqual(f.calls.map((r) => r.startIndex), [1, 2])
      assert.equal((await f.view()).pageCount, 2)
      assert.equal(f.lock.snapshot().heldBy, undefined)
      await f.runtime.command('finish', plain({ operationId: 'finish' }), 'owner')
      await f.runtime.whenIdle()
      assert.equal((await f.view()).state, 'scanned')
      assert.equal(fs.readFileSync(path.join(f.dir(), 'scan.pdf')).subarray(0, 4).toString(), '%PDF')
      assert.deepEqual(f.reports, [{ id: base.copyId, generation: 1, pageCount: 2 }])
      assert.equal(fs.existsSync(path.join(path.dirname(f.root), 'scan-device', base.copyId)), false)
      await expectCode(() => f.runtime.command('preview', plain({ page: 1 }), 'other-owner'), 'COPY_NOT_FOUND')
    } finally { await f.close() }
  })
  await check('Origin、静态/短期桥接令牌、小请求体及 scanTaskId 拒绝；预览字节与禁缓存', async () => {
    const f = fixture()
    let scanCalls = 0
    const server = startQrLoginLocalServer(f.config, { copyDevice: f.runtime,
      scanDevice: { start: async () => { scanCalls += 1; return { state: 'ready', pageCount: 0, errorCode: null } },
        nextPage: async () => { throw new Error('unused') }, finish: async () => { throw new Error('unused') },
        abort: async () => { throw new Error('unused') }, probe: async () => ({ health: 'ready', observedAt: '' }) } })!
    await new Promise<void>((resolve) => server.server.once('listening', resolve))
    try {
      assert.equal((await request(server.port, '/local/copy/start', base, { origin: 'https://evil.test' })).status, 403)
      assert.equal((await request(server.port, '/local/copy/start', base, { token: 'wrong' })).status, 403)
      for (const body of [{ scanTaskId: base.copyId }, { ...base, file: '/tmp/no' }, { ...base, generation: 0 }]) {
        assert.equal((await request(server.port, '/local/copy/start', body)).status, 400)
      }
      assert.equal((await request(server.port, '/local/copy/start', {}, { raw: 'x'.repeat(8193) })).status, 413)
      assert.equal((await request(server.port, '/local/copy/start', {}, { raw: '{' })).status, 400)
      assert.equal((await request(server.port, '/local/copy/start?x=1', base)).status, 400)
      assert.equal((await request(server.port, '/local/copy/start', base, { method: 'GET' })).status, 405)
      assert.equal((await request(server.port, '/local/scan/start', base)).status, 400)
      assert.equal(scanCalls, 0)
      const boot = await request(server.port, '/local/bridge/session', {}, { raw: '' })
      const token = boot.json().data.token!
      assert.equal((await request(server.port, '/local/copy/start', base, { token })).status, 200)
      await f.runtime.whenIdle()
      const preview = await request(server.port, '/local/copy/preview', plain({ page: 1 }), { token })
      assert.equal(preview.status, 200)
      assert.equal(preview.headers['content-type'], 'image/jpeg')
      assert.equal(preview.headers['cache-control'], 'no-store, private')
      assert.equal(preview.headers['pragma'], 'no-cache')
      assert.equal(preview.headers['x-content-type-options'], 'nosniff')
      assert.equal(preview.headers['location'], undefined)
      assert.deepEqual(preview.bytes, JPEG)
      assert.equal((await request(server.port, '/local/copy/preview', plain({ page: 1 }))).status, 404)
      const status = await request(server.port, '/local/copy/status', plain(), { token })
      assert.equal(status.bytes.includes(Buffer.from(f.root)), false)
      assert.deepEqual(Object.keys(status.json().data).sort(), ['errorCode', 'generation', 'pageCount', 'state'])
      assert.equal((await request(server.port, '/local/copy/clear', plain({ operationId: 'clear-http' }), { token })).status, 200)
      assert.equal((await request(server.port, '/local/copy/preview', plain({ page: 1 }), { token })).status, 410)
      assert.equal(fs.existsSync(f.dir()), false)
    } finally { await server.close(); await f.close() }
  })
  await check('abort / clear / 到期 / 启动残留 / 重扫：删除真实页并使用正确审计码', async () => {
    assert.deepEqual([...COPY_DELETION_REASONS].sort(), ['COPY_PRINT_TERMINAL', 'COPY_RESCAN', 'COPY_USER_CANCEL',
      'COPY_SESSION_CLEAR', 'COPY_EXPIRED', 'COPY_SCAN_FAILED', 'COPY_STARTUP_RESIDUE'].sort())
    for (const action of ['abort', 'clear', 'expiry', 'rescan'] as const) {
      const f = fixture()
      try {
        await scan(f)
        assert.equal(fs.existsSync(path.join(f.dir(), 'page-001.jpg')), true)
        if (action === 'expiry') { f.clock.jump(180_001); await f.runtime.tick() }
        else if (action === 'rescan') {
          f.patchPermit({ generation: 2 })
          await f.runtime.command('start', { ...base, generation: 2, operationId: 'rescan' }, 'owner')
          await f.runtime.whenIdle()
        } else await f.runtime.command(action, plain(), 'owner')
        assert.equal(fs.existsSync(f.dir()), false, `${action} 必须删除真实目录`)
        const reason = { abort: 'COPY_USER_CANCEL', clear: 'COPY_SESSION_CLEAR', expiry: 'COPY_EXPIRED', rescan: 'COPY_RESCAN' }[action]
        assert.ok(f.audit.some((row) => row.reason === reason && row.result === 'deleted'))
      } finally { await f.close() }
    }
    const f = fixture(); await scan(f); const root = f.root
    // 模拟进程退出：保留文件，用同一根重新创建运行器。
    const restart = fixture({ root })
    try {
      assert.equal(fs.existsSync(f.dir()), false)
      assert.ok(restart.audit.some((row) => row.reason === 'COPY_STARTUP_RESIDUE' && row.result === 'deleted'))
      assert.equal(restart.calls.length, 0)
    } finally { await restart.close(); await f.close() }
  })
  await edgeChecks(check)
  await printChecks(check)
  console.log(`verify-copy-device: ${passed} checks passed`)
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
