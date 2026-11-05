/** C2e/C2f：控制真实运行器的异步边界；WIA / 云端均为替身，不接触硬件。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startQrLoginLocalServer } from '../src/local-api/qr-login-server'
import { sharedScanDeviceHealth } from '../src/agent/scan-device/scan-device-health'
import { COPY_REVOCATIONS_DIR, COPY_REVOCATION_TTL_MS, COPY_REVOCATION_CLOCK_MARGIN_MS,
  createCopyRevocations } from '../src/agent/copy-device/copy-revocations'
import { copyDirId } from '../src/agent/copy-device/copy-storage'
import type { CopyPrintRecord } from '../src/agent/copy-device/copy-print-ledger'
import { agentConfig, createManualClock } from './verify-scan-device-runner.helper'
import { base, plain, fixture, scan, expectCode, request, flush } from './verify-copy-device.helper'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
const rows = (root: string): unknown[] => JSON.parse(fs.readFileSync(path.join(root, COPY_REVOCATIONS_DIR, 'revoked.json'), 'utf8')) as unknown[]

/** 旧打印的耐久回报可卡住 tick，但不占设备锁，也不建立本次复印会话。 */
function tickFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-revoked-tick-'))
  const directory = path.join(root, 'print-ledger')
  fs.mkdirSync(directory)
  const record: CopyPrintRecord = { version: 1, copyId: 'old-print', generation: 1,
    terminalId: agentConfig().terminalId!, owner: 'owner', pageCount: 1, state: 'handed',
    eventId: '00000000-0000-0000-0000-000000000001', attempts: 0, nextRetryAt: 1_700_000_000_001,
    acked: false, queueCleanupPending: false }
  fs.writeFileSync(path.join(directory, `${copyDirId(record.copyId, 1)}.json`), JSON.stringify(record))
  const entered = deferred()
  const release = deferred()
  const f = fixture({ root, deps: { reportPrint: async () => { entered.resolve(); await release.promise } } })
  return { ...f, entered, release }
}

export async function revocationChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('C2e start 卡在 tick 时 clear/abort 成功；不建会话、不开扫；墓碑过期也不复活在途 start', async () => {
    for (const action of ['clear', 'abort'] as const) for (const expire of [false, true]) {
      const f = tickFixture()
      try {
        await flush(); f.clock.jump(1)
        const starting = expectCode(() => f.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
        await f.entered.promise
        const cleared = await f.runtime.command(action, plain({ operationId: action }), 'owner')
        assert.ok(!Buffer.isBuffer(cleared))
        assert.equal(cleared.state, action === 'clear' ? 'cleared' : 'cancelled')
        assert.equal(cleared.purged, true)
        assert.equal(cleared.pageCount, 0)
        if (expire) {
          f.clock.jump(COPY_REVOCATION_TTL_MS + 1); await f.runtime.tick()
          assert.deepEqual(rows(f.root), [], '到期墓碑已从耐久文件移除')
        }
        f.release.resolve(); await starting; await f.runtime.whenIdle()
        assert.equal(f.calls.length, 0)
        assert.equal(fs.existsSync(f.dir()), false)
        await expectCode(() => f.view(), 'COPY_NOT_FOUND')
        assert.equal(f.lock.snapshot().heldBy, undefined)
      } finally { f.release.resolve(); await f.close() }
    }
  })
  await check('C2e clear 自身卡在 tick 时先撤销；之后到达的 start 立即拒绝', async () => {
    const f = tickFixture()
    try {
      await flush(); f.clock.jump(1)
      const clearing = f.runtime.command('clear', plain(), 'owner')
      await f.entered.promise
      await expectCode(() => f.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
      f.release.resolve()
      const result = await clearing
      assert.ok(!Buffer.isBuffer(result)); assert.equal(result.purged, true)
      assert.equal(f.calls.length, 0)
      await expectCode(() => f.view(), 'COPY_NOT_FOUND')
    } finally { f.release.resolve(); await f.close() }
  })
  await check('C2e HTTP clear 先到返回 200/purged；同代迟到 start 为 410，新 copyId 与新代不受影响', async () => {
    let permits = 0
    const f = fixture({ deps: { permit: async (id) => { permits++; return f.permit(id) } } })
    const server = startQrLoginLocalServer(f.config, { copyDevice: f.runtime })!
    await new Promise<void>((resolve) => server.server.once('listening', resolve))
    try {
      const clear = await request(server.port, '/local/copy/clear', plain({ operationId: 'clear-first' }))
      assert.equal(clear.status, 200); assert.equal(clear.json().data.purged, true)
      assert.equal(clear.json().data.state, 'cleared')
      assert.equal((await request(server.port, '/local/copy/clear', plain({ operationId: 'clear-first' }))).status, 200)
      for (const operationId of ['late-1', 'late-2']) {
        const start = await request(server.port, '/local/copy/start', { ...base, operationId })
        assert.equal(start.status, 410); assert.equal(start.json().error.code, 'COPY_EXPIRED')
      }
      assert.equal(permits, 0); assert.equal(f.calls.length, 0)
      assert.equal((await request(server.port, '/local/copy/status', plain())).status, 404)
      const next = { ...base, copyId: 'new-copy', operationId: 'new-copy-start' }
      await scan(f, next)
      assert.equal(f.calls.length, 1)
      await f.runtime.command('clear', { ...next, operationId: 'new-copy-clear' }, 'owner')
      f.patchPermit({ generation: 2 })
      await scan(f, { ...base, generation: 2, operationId: 'generation-2' })
      assert.equal(f.calls.length, 2, '墓碑只拦同一 copyId + generation')
    } finally { await server.close(); await f.close() }
  })
  await check('C2e 等锁、取许可中、开扫前探测中 clear/abort：不开 WIA、释放锁并清掉会话材料', async () => {
    for (const phase of ['lock', 'permit', 'probe'] as const) for (const action of ['clear', 'abort'] as const) {
      const entered = deferred()
      const release = deferred()
      let permits = 0
      const f = fixture({ deps: {
        permit: async (id) => {
          permits++
          if (phase === 'permit') { entered.resolve(); await release.promise }
          return f.permit(id)
        },
        runProbe: async () => {
          entered.resolve(); await release.promise
          return { state: 'ready', forceKilled: false, stopUnconfirmed: false, elapsedMs: 0 }
        },
      } })
      const held = phase === 'lock' ? await f.lock.acquire('print-claim') : undefined
      if (phase === 'probe') sharedScanDeviceHealth({ clock: f.clock, lock: f.lock,
        deviceName: () => '', getPhase: () => 'idle', runProbe: async () => { throw new Error('reuse health') } }).noteForceKilled()
      try {
        await f.runtime.command('start', base, 'owner'); await flush()
        if (phase !== 'lock') await entered.promise
        const clearing = f.runtime.command(action, plain({ operationId: action }), 'owner')
        held?.release(); release.resolve()
        const result = await clearing
        assert.ok(!Buffer.isBuffer(result)); assert.equal(result.purged, true)
        await f.runtime.whenIdle()
        assert.equal(f.calls.length, 0, `${phase}/${action} 不得迟开 WIA`)
        if (phase === 'lock') assert.equal(permits, 0, '拿锁后先查撤销，再取许可')
        assert.equal(f.lock.snapshot().heldBy, undefined)
        assert.equal(fs.existsSync(f.dir()), false)
        assert.equal((await f.view()).state, action === 'clear' ? 'cleared' : 'cancelled')
      } finally { held?.release(); release.resolve(); await f.close() }
    }
  })
  await check('C2e 墓碑跨重启保留；到期从内存/磁盘清理，之后该代可重新受理', async () => {
    for (const action of ['clear', 'abort'] as const) {
      const f = fixture()
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-revoked-restart-'))
      try {
        await f.runtime.command(action, plain(), 'owner')
        assert.equal(rows(f.root).length, 1)
        fs.cpSync(f.root, root, { recursive: true })
        const restarted = fixture({ root })
        try {
          await expectCode(() => restarted.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
          assert.equal(restarted.calls.length, 0)
          assert.equal(rows(root).length, 1, '启动 sweep 不删撤销墓碑')
          restarted.clock.jump(COPY_REVOCATION_TTL_MS); await restarted.runtime.tick()
          assert.deepEqual(rows(root), [])
          await scan(restarted)
          assert.equal(restarted.calls.length, 1)
        } finally { await restarted.close() }
      } finally { await f.close(); fs.rmSync(root, { recursive: true, force: true }) }
    }
  })
  await check('C2e 撤销写盘失败不报成功、不迟开扫描；恢复后重试，损坏墓碑阻止开扫', async () => {
    const f = fixture()
    const rename = fs.renameSync
    try {
      fs.renameSync = (from, to) => {
        if (String(to).includes(COPY_REVOCATIONS_DIR)) throw new Error('disk unavailable')
        return rename(from, to)
      }
      await expectCode(() => f.runtime.command('clear', plain(), 'owner'), 'COPY_STORAGE_UNSAFE')
      await expectCode(() => f.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
      assert.equal(f.calls.length, 0)
      fs.renameSync = rename; await f.runtime.tick()
      assert.equal(rows(f.root).length, 1)
      await scan(f, { ...base, copyId: 'after-write-recovery', operationId: 'after-recovery' })
      assert.equal(f.calls.length, 1)
    } finally { fs.renameSync = rename; await f.close() }
    const damaged = fixture()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-revoked-corrupt-'))
    try {
      await damaged.runtime.command('clear', plain(), 'owner')
      fs.cpSync(damaged.root, root, { recursive: true })
      fs.writeFileSync(path.join(root, COPY_REVOCATIONS_DIR, 'revoked.json'), '{')
      const restarted = fixture({ root })
      try {
        await expectCode(() => restarted.runtime.command('start', base, 'owner'), 'COPY_STORAGE_UNSAFE')
        assert.equal(restarted.calls.length, 0)
      } finally { await restarted.close() }
    } finally { await damaged.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
  await check('C2f 撤销后 180001ms 的迟到 start 仍拒绝；15 分钟下限之后才重新受理', async () => {
    for (const action of ['clear', 'abort'] as const) {
      let permits = 0
      const f = fixture({ deps: { permit: async (id) => { permits++; return f.permit(id) } } })
      try {
        await f.runtime.command(action, plain(), 'owner')
        f.clock.jump(180_001)
        await expectCode(() => f.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
        f.clock.jump(15 * 60_000 - 180_001 - 1)
        await expectCode(() => f.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
        assert.equal(permits, 0); assert.equal(f.calls.length, 0)
        assert.equal(rows(f.root).length, 1)
        f.clock.jump(2); await f.runtime.tick()
        assert.deepEqual(rows(f.root), [])
        await scan(f)
        assert.equal(permits, 1); assert.equal(f.calls.length, 1)
      } finally { await f.close() }
    }
    // 后端 copy-job.policy.ts 的云端单寿命为 10 分钟，撤销下限必须再加时钟误差余量。
    assert.ok(COPY_REVOCATION_CLOCK_MARGIN_MS >= 5 * 60_000)
    assert.ok(COPY_REVOCATION_TTL_MS >= 10 * 60_000 + COPY_REVOCATION_CLOCK_MARGIN_MS)
  })
  await check('C2f 已知到期更晚时保留至 expiresAt + 余量；重复撤销和重启不缩短', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-revoked-deadline-'))
    const clock = createManualClock()
    const deps = { root, clock, tempHooks: { assertDirectoryAcl() {} } }
    const expiresAt = clock.now() + 20 * 60_000
    try {
      const revocations = createCopyRevocations(deps, copyDirId)
      revocations.revoke(base, expiresAt)
      clock.jump(1)
      revocations.revoke(base, clock.now() + 30_000)
      assert.deepEqual(rows(root), [[copyDirId(base.copyId, base.generation), expiresAt + COPY_REVOCATION_CLOCK_MARGIN_MS]])
      const restarted = createCopyRevocations(deps, copyDirId)
      clock.jump(15 * 60_000)
      restarted.prune(); assert.equal(restarted.has(base), true)
      clock.jump(expiresAt + COPY_REVOCATION_CLOCK_MARGIN_MS - clock.now() - 1)
      restarted.prune(); assert.equal(restarted.has(base), true)
      clock.jump(2); restarted.prune()
      assert.equal(restarted.has(base), false); assert.deepEqual(rows(root), [])
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
  await check('C2f 满 4096 条不淘汰未过期墓碑；新 start HTTP 503 且有可读说明', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-revoked-full-'))
    const directory = path.join(root, COPY_REVOCATIONS_DIR)
    fs.mkdirSync(directory)
    const unexpired = Array.from({ length: 4096 }, (_, i) =>
      [copyDirId(`revoked-${i}`, 1), createManualClock().now() + 15 * 60_000])
    fs.writeFileSync(path.join(directory, 'revoked.json'), JSON.stringify(unexpired))
    let permits = 0
    const f = fixture({ root, deps: { permit: async (id) => { permits++; return f.permit(id) } } })
    const server = startQrLoginLocalServer(f.config, { copyDevice: f.runtime })!
    await new Promise<void>((resolve) => server.server.once('listening', resolve))
    try {
      const start = await request(server.port, '/local/copy/start', base)
      assert.equal(start.status, 503)
      assert.equal(start.json().error.code, 'COPY_REVOCATION_LIMIT')
      const error = JSON.parse(start.bytes.toString()).error as { message: string }
      assert.match(error.message, /撤销保护记录已满.*稍后/)
      await expectCode(() => f.runtime.command('clear', plain(), 'owner'), 'COPY_REVOCATION_LIMIT')
      await expectCode(() => f.runtime.command('start', { ...base, copyId: 'revoked-0' }, 'owner'), 'COPY_EXPIRED')
      assert.deepEqual(rows(root), unexpired, '满额不得覆盖、驱逐未过期标记')
      assert.equal(permits, 0); assert.equal(f.calls.length, 0)
      f.clock.jump(15 * 60_000 + 1)
      await scan(f)
      assert.deepEqual(rows(root), [])
      assert.equal(permits, 1); assert.equal(f.calls.length, 1)
    } finally { await server.close(); await f.close() }
  })
  await check('C2f 上限优先清理已过期墓碑；保留其余 4095 条并接纳新撤销', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-revoked-prune-'))
    const directory = path.join(root, COPY_REVOCATIONS_DIR)
    fs.mkdirSync(directory)
    const now = createManualClock().now()
    const unexpired = Array.from({ length: 4095 }, (_, i) => [copyDirId(`revoked-${i}`, 1), now + 15 * 60_000])
    fs.writeFileSync(path.join(directory, 'revoked.json'), JSON.stringify([
      [copyDirId('already-expired', 1), now - 1], ...unexpired,
    ]))
    const f = fixture({ root })
    try {
      await f.runtime.command('clear', plain(), 'owner')
      assert.deepEqual(rows(root), [...unexpired, [copyDirId(base.copyId, 1), now + COPY_REVOCATION_TTL_MS]])
      await expectCode(() => f.runtime.command('start', base, 'owner'), 'COPY_EXPIRED')
      await expectCode(() => f.runtime.command('start', { ...base, copyId: 'new-copy' }, 'owner'), 'COPY_REVOCATION_LIMIT')
      assert.equal(f.calls.length, 0)
    } finally { await f.close() }
  })
}
