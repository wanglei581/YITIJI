import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fixture, scan, base, plain, expectCode, flush } from './verify-copy-device.helper'
import { agentConfig, createHarness, pushScript } from './verify-scan-device-runner.helper'
import { networkChecks } from './verify-copy-device-network.helper'
import { createCopyRuntime } from '../src/agent/copy-device/copy-runtime'

export async function edgeChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('180 秒按实际操作续期；状态轮询不延后隐私清场', async () => {
    const f = fixture()
    try {
      await scan(f)
      f.clock.jump(170_000)
      await f.runtime.command('preview', plain({ page: 1 }), 'owner')
      f.clock.jump(170_000)
      assert.equal((await f.view()).state, 'page_ready')
      f.clock.jump(10_001)
      assert.equal((await f.view()).state, 'expired')
      assert.equal(fs.existsSync(f.dir()), false)
    } finally { await f.close() }
  })
  await check('WIA 自动预热重试前重取许可：撤销拒绝第二次硬件，旧许可过期时使用新许可', async () => {
    for (const denied of [true, false]) {
      const f = fixture({ hold: true })
      try {
        await f.runtime.command('start', base, 'owner'); await flush()
        assert.equal(f.children.length, 1)
        f.clock.advance(35_000); await flush()
        f.failBeforePage('0x80210007'); await flush()
        if (denied) f.patchPermit({ allowed: false })
        f.clock.advance(10_000); await flush()
        assert.equal(f.children.length, denied ? 1 : 2)
        if (!denied) f.complete()
        await f.runtime.whenIdle()
        assert.equal((await f.view()).state, denied ? 'failed' : 'page_ready')
      } finally { await f.close() }
    }
  })
  await check('定时到期无需新请求即删页；重启后即使关开关仍清启动残留', async () => {
    const f = fixture()
    try {
      await scan(f)
      for (let i = 0; i < 180; i += 1) { f.clock.advance(1000); await flush() }
      await f.runtime.whenIdle()
      assert.equal(fs.existsSync(f.dir()), false)
      assert.ok(f.audit.some((a) => a.reason === 'COPY_EXPIRED'))
    } finally { await f.close() }
    const old = fixture(); await scan(old)
    const reasons: string[] = []
    const off = createCopyRuntime({ ...old.config, copyDeviceEnabled: false }, {
      root: old.root, clock: old.clock,
      tempHooks: { assertDirectoryAcl() {}, audit: { begin(_id, reason) { reasons.push(reason); return { finish() {} } } } },
    })
    try {
      assert.equal(fs.existsSync(old.dir()), false)
      assert.ok(reasons.includes('COPY_STARTUP_RESIDUE'))
      await expectCode(() => off.command('start', base, 'owner'), 'COPY_DISABLED')
    } finally { off.stop(); await old.close() }
  })
  await check('重扫先占新代：重复 start 不重扫，旧代还在停止时 clear 新代不会迟开硬件', async () => {
    const f = fixture({ hold: true })
    try {
      await f.runtime.command('start', base, 'owner'); await flush()
      f.patchPermit({ generation: 2 })
      const next = { ...base, generation: 2, operationId: 'new-generation' }
      const starting = await f.runtime.command('start', next, 'owner')
      const clearing = f.runtime.command('clear', plain({ generation: 2, operationId: 'clear-new' }), 'owner')
      assert.deepEqual(await f.runtime.command('start', next, 'owner'), starting)
      await clearing; await f.runtime.whenIdle()
      assert.equal(f.calls.length, 1)
      assert.equal(fs.existsSync(f.dir()), false)
      assert.equal(fs.existsSync(f.dir(2)), false)
    } finally { await f.close() }
  })
  await check('删除失败撤权隔离，返回真实失败、后台重试；不占设备锁且新会话无旧页', async () => {
    const f = fixture()
    try {
      await scan(f); f.failDeletion(true)
      await expectCode(() => f.runtime.command('clear', plain(), 'owner'), 'COPY_CLEANUP_FAILED')
      assert.equal((await f.view()).purged, false)
      assert.equal(fs.existsSync(f.dir()), true)
      await expectCode(() => f.runtime.command('preview', plain({ page: 1 }), 'owner'), 'COPY_EXPIRED')
      assert.ok(f.audit.some((a) => a.reason === 'COPY_SESSION_CLEAR' && a.result === 'delete_failed'))
      const other = await f.lock.acquire('print-claim'); other.release()
      await f.runtime.command('start', { ...base, copyId: 'copy-2', operationId: 'start-2' }, 'new-owner')
      await f.runtime.whenIdle()
      await expectCode(() => f.runtime.command('preview', plain({ page: 1 }), 'new-owner'), 'COPY_NOT_FOUND')
      f.failDeletion(false); await f.runtime.tick()
      assert.equal(fs.existsSync(f.dir()), false)
      assert.equal((await f.view()).purged, true)
    } finally { await f.close() }
  })
  await check('进纸器自动合成本机 PDF；失败/页数/字节超限清理，扫描颜色与打印颜色分开', async () => {
    const f = fixture({ pages: 3 })
    try {
      f.patchPermit({ parameters: { ...f.permit(base.copyId).parameters, source: 'feeder' } })
      await scan(f, { ...base, source: 'feeder' })
      assert.equal((await f.view()).state, 'scanned'); assert.equal((await f.view()).pageCount, 3)
      assert.equal(f.calls[0]?.color, 'color')
      assert.equal(f.reports.length, 1)
    } finally { await f.close() }
    const oversized = fixture()
    try {
      oversized.setPageBytes(Buffer.alloc(18 * 1024 * 1024))
      await scan(oversized)
      assert.equal((await oversized.view()).state, 'failed')
      assert.equal(fs.existsSync(oversized.dir()), false)
      assert.ok(oversized.audit.some((a) => a.reason === 'COPY_SCAN_FAILED'))
    } finally { await oversized.close() }
    const cap = fixture()
    try {
      cap.config.scanDeviceMaxPages = 1
      await scan(cap)
      await cap.runtime.command('next-page', plain(), 'owner'); await cap.runtime.whenIdle()
      assert.equal(cap.calls.length, 1)
      assert.equal((await cap.view()).errorCode, 'too_large')
      assert.equal(fs.existsSync(cap.dir()), false)
    } finally { await cap.close() }
    const jam = fixture({ hold: true })
    try {
      await jam.runtime.command('start', base, 'owner'); await flush()
      jam.complete('0x80210002'); await jam.runtime.whenIdle()
      assert.equal((await jam.view()).state, 'failed')
      assert.ok(jam.audit.some((a) => a.reason === 'COPY_SCAN_FAILED'))
    } finally { await jam.close() }
  })
  await check('取消排队/扫描竞态不会迟开硬件；许可等待后过期及参数/授权版本变化拒绝', async () => {
    const f = fixture()
    const held = await f.lock.acquire('print-claim')
    try {
      await f.runtime.command('start', base, 'owner')
      const abort = f.runtime.command('abort', plain(), 'owner')
      await flush(); held.release(); await abort; await f.runtime.whenIdle()
      assert.equal(f.calls.length, 0)
    } finally { held.release(); await f.close() }
    for (const patch of ['version', 'parameters'] as const) {
      const f = fixture()
      try {
        await scan(f)
        f.patchPermit(patch === 'version' ? { authorizationVersion: 2 } :
          { parameters: { ...f.permit(base.copyId).parameters, copies: 2 } })
        await f.runtime.command('next-page', plain(), 'owner'); await f.runtime.whenIdle()
        assert.equal(f.calls.length, 1)
        assert.equal((await f.view()).state, 'failed')
      } finally { await f.close() }
    }
  })
  await check('与 A2 扫描共锁、30 秒报忙；复印扫描时 A2 probe 和未来复印打印均拿不到锁', async () => {
    const a = createHarness({ root: fs.mkdtempSync('/tmp/copy-a2-lock-'), config: agentConfig() })
    pushScript(a.scanner, { pages: [{ bytes: 2 }], holdAfterPage: true })
    const f = fixture({ hold: true, deps: { lock: a.lock, clock: a.clock } })
    try {
      await a.runtime.start('taskA'); await flush()
      assert.equal(a.scanner.calls.length, 1)
      await f.runtime.command('start', base, 'owner'); await flush()
      a.clock.advance(30_001); await f.runtime.whenIdle()
      assert.equal(f.calls.length, 0); assert.equal((await f.view()).errorCode, 'COPY_DEVICE_BUSY')
      await a.runtime.abort('taskA'); await a.runtime.whenIdle()
      f.clock.jump(30_001)
      await f.runtime.command('start', { ...base, copyId: 'copy-after-lock', operationId: 'after-lock' }, 'owner')
      await flush()
      assert.equal(f.calls.length, 1)
      assert.equal((await a.runtime.probe()).health, 'busy')
      assert.equal(a.lock.tryAcquire('copy-print'), undefined)
      f.complete(); await f.runtime.whenIdle()
      const print = await a.lock.acquire('copy-print'); print.release()
    } finally { a.scanner.release(); a.runtime.stop(); await f.close(); fs.rmSync(a.root, { recursive: true, force: true }) }
  })
  await check('预览拒绝路径穿越、页号越界、符号链接和跨代；重扫并发只有一场', async () => {
    const f = fixture()
    try {
      await scan(f)
      await expectCode(() => f.runtime.command('preview', plain({ page: 0 }), 'owner'), 'COPY_BAD_REQUEST')
      await expectCode(() => f.runtime.command('preview', plain({ page: 2 }), 'owner'), 'COPY_BAD_REQUEST')
      await expectCode(() => f.runtime.command('preview', plain({ page: 1, generation: 2 }), 'owner'), 'COPY_NOT_FOUND')
      const file = path.join(f.dir(), 'page-001.jpg')
      const outside = path.join(f.root, 'outside.jpg'); fs.writeFileSync(outside, 'secret')
      fs.rmSync(file); fs.symlinkSync(outside, file)
      await assert.rejects(() => f.runtime.command('preview', plain({ page: 1 }), 'owner'))
      await f.runtime.command('clear', plain(), 'owner')
      assert.equal(fs.readFileSync(outside).toString(), 'secret')
    } finally { await f.close() }
  })
  await check('未确认停止只隔离 WIA 和待删材料，释放打印锁；退出后重试删页', async () => {
    let gone = false
    const f = fixture({ deps: { processGone: () => gone,
      startScan(request) {
        const file = path.join(request.outDir, 'page-001.jpg'); fs.writeFileSync(file, 'private')
        return { abort() {}, result: Promise.resolve({ ok: false, endedBy: 'aborted', pages: [], discardedPages: 0,
          forceKilled: true, stopUnconfirmed: true, processId: 888, attempts: 1, setFailed: [], elapsedMs: 0 }) }
      } } })
    try {
      await scan(f)
      assert.equal((await f.view()).purged, false)
      const print = f.lock.tryAcquire('print-claim'); assert.ok(print); print.release()
      gone = true; await f.runtime.tick()
      assert.equal((await f.view()).purged, true)
      assert.equal(f.lock.snapshot().heldBy, undefined)
      assert.equal(fs.existsSync(f.dir()), false)
    } finally { await f.close() }
  })
  await networkChecks(check)
}
