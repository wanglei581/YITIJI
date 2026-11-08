import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { __resetPrintDispatchGateForTests, claimPrintTasksIfGateOpen, isPrintDispatchBlocked } from '../src/agent/print-dispatch-gate'
import { sharedScanDeviceHealth } from '../src/agent/scan-device/scan-device-health'
import { agentConfig, createHarness, pushScript } from './verify-scan-device-runner.helper'
import { printFixture, ready, sendPrint, readRecord } from './verify-copy-print.helper'
import { base, plain, fixture, scan, flush } from './verify-copy-device.helper'

const claim = (run: () => Promise<void>) => claimPrintTasksIfGateOpen({ holdEnabled: false,
  pause: async () => undefined, cleanup: async () => undefined }, run)

export async function isolationChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('C2c-① 执行器未退出不放下一单；退出后重清迟到作业、耐久解除再放行（暂停开/关）', async () => {
    for (const hold of [false, true]) {
      let release!: () => void
      const waiting = new Promise<void>((resolve) => { release = resolve })
      let lateJob = false
      let cleanupFails = false
      const f = printFixture({ timeoutMs: 5, stages: Array(1000).fill('not_found'),
        driver: async () => { await waiting; lateJob = true }, cleanup: async () => {
          if (cleanupFails) throw new Error('queue unavailable')
          lateJob = false
        } })
      f.config.holdPrinterQueueWhenIdle = hold
      let claims = 0
      try {
        await ready(f); await sendPrint(f)
        assert.equal((await f.view()).state, 'unconfirmed')
        assert.equal(readRecord(f.root).acked, true)
        assert.equal(readRecord(f.root).queueCleanupPending, true)
        const cleanups = f.order.filter((x) => x === 'cleanup').length
        for (let i = 0; i < 3; i++) await claim(async () => { claims++ })
        assert.equal(claims, 0, '执行器存活时普通队列恢复也不能放行')
        assert.equal(f.order.filter((x) => x === 'cleanup').length, cleanups)
        const print = f.lock.tryAcquire('print-claim'); assert.ok(print); print.release()
        cleanupFails = true
        release(); await flush()
        assert.equal(lateJob, true)
        assert.equal(isPrintDispatchBlocked(), true)
        assert.equal(readRecord(f.root).queueCleanupPending, true)
        await claim(async () => { claims++ }); assert.equal(claims, 0)
        cleanupFails = false
        await claim(async () => {
          assert.equal(lateJob, false, '下一单只能在迟到作业删除后领取')
          assert.equal(readRecord(f.root).queueCleanupPending, false)
          claims++
        })
        assert.equal(claims, 1); assert.equal(isPrintDispatchBlocked(), false)
        await f.runtime.tick(); assert.equal(fs.existsSync(f.dir()), false)
      } finally { release(); await f.close(); __resetPrintDispatchGateForTests() }
    }
  })
  await check('C2c-①竞态 执行器在终态首次清理与暂停之间退出，仍须再清迟到作业', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    let lateJob = false
    const f = printFixture({ timeoutMs: 5, stages: Array(1000).fill('not_found'),
      driver: async () => { await waiting; lateJob = true },
      cleanup: async () => { lateJob = false },
      pause: async () => { release(); await flush() },
    })
    try {
      await ready(f); await sendPrint(f)
      assert.equal(lateJob, false, '首次清理时执行器还在，暂停期间退出仍须再清')
      assert.equal(f.order.filter((v) => v === 'cleanup').length, 3)
      assert.equal(readRecord(f.root).queueCleanupPending, false)
      assert.equal(isPrintDispatchBlocked(), false)
    } finally { release(); await f.close(); __resetPrintDispatchGateForTests() }
  })
  await check('C2c-①恢复 已回报终态仍保留清理责任；重启等执行器退出、清理失败重试且不重打', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const f = printFixture({ timeoutMs: 5, driver: () => waiting, stages: Array(1000).fill('not_found') })
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-c2c-restart-'))
    let gone = false
    let cleanupFails = true
    let restart: ReturnType<typeof printFixture> | undefined
    try {
      await ready(f); await sendPrint(f)
      assert.equal(readRecord(f.root).queueCleanupPending, true)
      fs.cpSync(f.root, root, { recursive: true })
      restart = printFixture({ root, executorGone: async () => gone,
        cleanup: async () => { if (cleanupFails) throw new Error('offline') } })
      restart.config.copyDeviceEnabled = false // 关闭复印也要履行旧单清理责任。
      await restart.runtime.whenIdle()
      assert.equal(readRecord(root).state, 'unconfirmed'); assert.equal(readRecord(root).acked, true)
      assert.equal(fs.existsSync(restart.dir()), true)
      assert.equal(restart.order.length, 0, '执行器还在时不作无效清理')
      let claims = 0
      await claim(async () => { claims++ }); assert.equal(claims, 0)
      gone = true
      await claim(async () => { claims++ }); assert.equal(claims, 0)
      assert.equal(readRecord(root).queueCleanupPending, true)
      cleanupFails = false
      await claim(async () => {
        assert.equal(readRecord(root).queueCleanupPending, false); claims++
      })
      assert.equal(claims, 1)
      await restart.runtime.tick()
      assert.equal(fs.existsSync(restart.dir()), false)
      assert.equal(restart.printCalls.length, 0)
      assert.ok(restart.order.filter((v) => v === 'cleanup').length >= 2)
    } finally { release(); await restart?.close(); await f.close(); fs.rmSync(root, { recursive: true, force: true }); __resetPrintDispatchGateForTests() }
  })
  await check('C2c-② WIA 未退出释放全局锁，打印可领取；新复印拒绝且可读，清场/到期结束、材料延后删', async () => {
    for (const [ending, pid] of [['clear', 888], ['expiry', 888], ['clear', undefined], ['expiry', undefined]] as const) {
      let gone = false
      const f = fixture({ deps: { processGone: () => gone,
        startScan(request) {
          fs.writeFileSync(path.join(request.outDir, 'page-001.jpg'), 'private')
          return { abort() {}, result: Promise.resolve({ ok: false, endedBy: 'aborted', pages: [], discardedPages: 0,
            forceKilled: true, stopUnconfirmed: true, processId: pid, attempts: 1, setFailed: [], elapsedMs: 0 }) }
        } } })
      try {
        await scan(f)
        assert.equal((await f.view()).purged, false)
        const printing = f.lock.tryAcquire('print-claim'); assert.ok(printing, 'WIA 不得占住打印领取锁'); printing.release()
        await f.runtime.command('start', { ...base, copyId: 'copy-blocked', operationId: 'blocked' }, 'owner')
        await f.runtime.whenIdle()
        const blocked = await f.runtime.command('status', { ...plain(), copyId: 'copy-blocked' }, 'owner')
        assert.ok(!Buffer.isBuffer(blocked))
        assert.equal(blocked.errorCode, 'COPY_PROCESS_STOP_UNCONFIRMED')
        assert.match(blocked.errorMessage!, /扫描进程尚未确认退出/)
        if (ending === 'clear') {
          const cleared = await f.runtime.command('clear', plain({ operationId: 'clear' }), 'owner')
          assert.ok(!Buffer.isBuffer(cleared)); assert.equal(cleared.state, 'cleared'); assert.equal(cleared.purged, false)
        } else { f.clock.jump(180_001); await f.runtime.tick() }
        assert.equal(fs.existsSync(f.dir()), true)
        gone = true; await f.runtime.tick()
        assert.equal(fs.existsSync(f.dir()), false)
        assert.equal(f.lock.snapshot().heldBy, undefined)
      } finally { await f.close() }
    }
  })
  await check('C2c-③ A2 可疑进程共用健康隔离：复印首次/续页/预热重试均阻断，退出+探测才放行', async () => {
    for (const action of ['first', 'next', 'retry'] as const) {
      let alive = true
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-c2c-a2-'))
      const a = createHarness({ root, config: agentConfig(), isProcessAlive: () => alive })
      const f = fixture({ hold: action === 'retry', deps: { lock: a.lock, clock: a.clock } })
      const health = sharedScanDeviceHealth({ lock: a.lock, clock: a.clock, deviceName: () => '',
        getPhase: () => 'idle', runProbe: async () => { throw new Error('must share A2 health') } })
      try {
        if (action === 'next') await scan(f)
        if (action === 'retry') {
          await f.runtime.command('start', base, 'owner'); await flush()
          f.failBeforePage('0x80210007'); await flush()
          // 同一份 A2 健康状态在预热等待期间被标记可疑，重试不得绕过。
          health.noteProcessStop({ stopUnconfirmed: true, processId: 777 })
          f.clock.advance(10_000); a.clock.jump(10_000); await flush()
          assert.equal(f.children.length, 1, '预热重试不得启动第二个 WIA 进程')
          await f.runtime.whenIdle()
        } else {
          pushScript(a.scanner, { pages: [{ bytes: 2 }], holdAfterPage: true, forceKillOnAbort: true,
            stopUnconfirmed: true, processId: 777 })
          await a.runtime.start('taskA'); await flush()
          await a.runtime.abort('taskA'); await a.runtime.whenIdle()
          assert.equal(health.hasSuspect(), true, '真实 A2 停止路径必须写进共享状态')
          if (action === 'first') await scan(f)
          else { await f.runtime.command('next-page', plain({ operationId: 'next' }), 'owner'); await f.runtime.whenIdle() }
        }
        assert.equal((await f.view()).errorCode, 'COPY_PROCESS_STOP_UNCONFIRMED', action)
        assert.equal(f.calls.length, action === 'first' ? 0 : 1)
        assert.equal(f.children.length, action === 'retry' ? 1 : f.calls.length)
        const probes = a.probeCalls.count
        await a.runtime.probe(); assert.equal(a.probeCalls.count, probes, '旧进程还在时不得探测 WIA')
        alive = false
        assert.equal((await a.runtime.probe()).health, 'ready')
        assert.ok(a.probeCalls.count > probes); assert.equal(health.hasSuspect(), false)
        f.patchPermit({ generation: 2 })
        const command = { ...base, generation: 2, operationId: 'after-probe' }
        if (action === 'retry') {
          await f.runtime.command('start', command, 'owner'); await flush(); f.complete(); await f.runtime.whenIdle()
        } else await scan(f, command)
        const view = await f.runtime.command('status', { ...plain(), generation: 2 }, 'owner')
        assert.ok(!Buffer.isBuffer(view)); assert.equal(view.state, 'page_ready')
      } finally { a.scanner.release(); a.runtime.stop(); await f.close(); fs.rmSync(root, { recursive: true, force: true }) }
    }
  })
}
