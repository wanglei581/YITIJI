/** C2d：与复印交错时，A2 必须在拿锁后复查共享 WIA 隔离。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { LocalScanError } from '../src/agent/scan-device/scan-device-runner'
import { sharedScanDeviceHealth } from '../src/agent/scan-device/scan-device-health'
import { agentConfig, createHarness, deviceLease, pushScript, flush, probeResult } from './verify-scan-device-runner.helper'
import { base, plain, fixture, scan } from './verify-copy-device.helper'

export async function verifyScanDeviceIsolation(root: string): Promise<void> {
  for (const action of ['first', 'next', 'first-exited'] as const) {
    let alive = true
    const firstPage = action !== 'next'
    const probeOwners: Array<string | undefined> = []
    const a = createHarness({ root: path.join(root, action), config: agentConfig(), isProcessAlive: () => alive })
    const health = sharedScanDeviceHealth({ clock: a.clock, lock: a.lock, deviceName: () => '', getPhase: () => 'idle',
      isProcessAlive: () => alive, runProbe: async () => {
        a.probeCalls.count++
        probeOwners.push(a.lock.snapshot().heldBy)
        assert.ok(a.lock.snapshot().heldBy, '解除隔离的探测必须复用已持有锁')
        assert.equal(a.lock.tryAcquire('competing-probe'), undefined)
        return probeResult('ready')
      } }, true)
    const f = fixture({ deps: { lock: a.lock, clock: a.clock, processGone: () => !alive,
      startScan: () => ({ abort() {}, result: Promise.resolve({ ok: false, endedBy: 'error', errorCode: 'unknown',
        pages: [], discardedPages: 0, forceKilled: true, stopUnconfirmed: true, processId: 977, attempts: 1,
        setFailed: [], elapsedMs: 0 }) }) } })
    try {
      a.lease.current = { kind: 'lease', lease: deviceLease('taskA', a.clock.now(), { device: { source: 'flatbed', colorMode: 'gray' } }) }
      if (action === 'next') {
        pushScript(a.scanner, { pages: [{ bytes: 10 }] })
        await a.runtime.start('taskA'); await a.runtime.whenIdle()
      }
      // 复印先持锁，A2 首次检查通过后排队；复印登记可疑再放锁。
      const holder = await a.lock.acquire('copy-scan')
      await f.runtime.command('start', base, 'owner'); await flush()
      let first: ReturnType<typeof a.runtime.start> | undefined
      if (firstPage) {
        first = a.runtime.start('taskA')
        await flush()
        assert.equal(a.lock.snapshot().waiting.length, 2, '复印排在 A2 前；A2 已通过首次检查并等锁')
      }
      // 真实复印错误路径写共享健康（不能只改 A2 自己的私有状态）。
      if (action === 'first-exited') alive = false
      holder.release()
      if (action === 'first-exited') {
        await first; await a.runtime.whenIdle(); await f.runtime.whenIdle()
        assert.equal(health.hasSuspect(), false)
        assert.equal(a.scanner.calls.length, 1)
        assert.ok(probeOwners.includes('scan:taskA'), '首次扫描必须借用已持有扫描锁探测')
        console.log('PASS C2d-② A2 首次等锁期间旧进程退出：拿锁后探测成功再开扫')
        continue
      }
      if (first) {
        const view = await first
        assert.equal(view.state, 'error')
        assert.equal(view.errorCode, 'busy')
      } else {
        await f.runtime.whenIdle()
        await assert.rejects(a.runtime.nextPage('taskA'), (error: unknown) => error instanceof LocalScanError && error.code === 'LOCAL_SCAN_BUSY')
      }
      await a.runtime.whenIdle(); await f.runtime.whenIdle()
      assert.equal(health.hasSuspect(), true)
      assert.equal(a.scanner.calls.length, action === 'first' ? 0 : 1, `${action} 不得启动新 WIA`)
      assert.equal(a.lock.snapshot().heldBy, undefined)
      const probes = a.probeCalls.count
      alive = false
      pushScript(a.scanner, { pages: [{ bytes: 10 }] })
      if (action === 'next') await a.runtime.nextPage('taskA')
      else await a.runtime.start('taskA')
      await a.runtime.whenIdle()
      assert.ok(a.probeCalls.count > probes)
      assert.equal(health.hasSuspect(), false)
      if (action === 'next') assert.ok(probeOwners.includes('scan:taskA'), '续页必须借用已持有扫描锁探测')
      assert.equal(a.scanner.calls.length, action === 'first' ? 1 : 2)
      assert.equal(a.reports[a.reports.length - 1]?.state, 'page_ready')
      console.log(`PASS C2d-② A2 ${action === 'first' ? '首次检查后等锁期间' : '待翻页时'}复印登记可疑：拒绝开扫，退出+持锁探测后放行`)
    } finally { a.scanner.release(); a.runtime.stop(); await f.close() }
  }
  for (const action of ['first', 'next'] as const) {
    // 共享健康状态由复印运行时先建，下面这次调用只是取回同一份；旧进程在不在看夹具的 processGone。
    // 必须注入「仍在」：不注入就去查本机真实的 978 号进程，Mac 上碰巧存在、CI 的 Linux 上常不存在，结果随机器变。
    const f = fixture({ deps: { processGone: () => false } })
    const health = sharedScanDeviceHealth({ clock: f.clock, lock: f.lock, deviceName: () => '', getPhase: () => 'idle',
      runProbe: async () => probeResult('ready'), isProcessAlive: () => true })
    try {
      if (action === 'next') await scan(f)
      const holder = await f.lock.acquire('scan-device')
      try {
        if (action === 'first') await f.runtime.command('start', base, 'owner')
        else await f.runtime.command('next-page', plain({ operationId: 'next-race' }), 'owner')
        await flush()
        assert.equal(f.lock.snapshot().waiting.length, 1)
        health.noteProcessStop({ stopUnconfirmed: true, processId: 978 })
      } finally { holder.release() }
      await f.runtime.whenIdle()
      assert.equal((await f.view()).errorCode, 'COPY_PROCESS_STOP_UNCONFIRMED')
      assert.equal(f.calls.length, action === 'first' ? 0 : 1)
      console.log(`PASS C2d-② 复印 ${action} 拿锁后复查：等待期间登记可疑仍拒绝开扫`)
    } finally { await f.close() }
  }
}
