/** C2d：真实 ledger 写失败，仍隔离但可恢复；不接触打印机。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { claimPrintTasksIfGateOpen, isPrintDispatchBlocked, __resetPrintDispatchGateForTests } from '../src/agent/print-dispatch-gate'
import { printFixture, ready, sendPrint, readRecord } from './verify-copy-print.helper'
import { base, plain, expectCode, flush } from './verify-copy-device.helper'

const claim = (run: () => Promise<void>) => claimPrintTasksIfGateOpen({ holdEnabled: false,
  pause: async () => undefined, cleanup: async () => undefined }, run)

export async function cleanupWriteChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('C2d-① 单次 rename/fsync 失败：现场重核、耐久成功后云打印恢复，旧单不重派（运行中/重启）', async () => {
    for (const restarted of [false, true]) for (const failure of ['rename', 'file-fsync', 'directory-fsync'] as const) {
      if (failure === 'directory-fsync' && process.platform === 'win32') continue
      let release!: () => void
      const waiting = new Promise<void>((resolve) => { release = resolve })
      const original = printFixture({ timeoutMs: 5, stages: Array(1000).fill('not_found'), driver: () => waiting })
      let f = original
      let gone = false
      let surveys = 0
      let restartRoot: string | undefined
      const rename = fs.renameSync
      const sync = fs.fsyncSync
      let writes = 0
      let failures = 0
      try {
        await ready(original); await sendPrint(original)
        if (restarted) {
          restartRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'copy-cleanup-write-'))
          fs.cpSync(original.root, restartRoot, { recursive: true })
          f = printFixture({ root: restartRoot, executorGone: async () => { surveys++; return gone } })
          await f.runtime.whenIdle()
        }
        assert.equal(readRecord(f.root).queueCleanupPending, true)
        // 只对清理完成这一次写入注入故障，其余 ledger 写入均正常。
        if (failure === 'rename') fs.renameSync = (from, to) => {
          if (String(to).startsWith(path.join(f.root, 'print-ledger'))) {
            writes++
            if (failures++ === 0) throw new Error('once: rename unavailable')
          }
          return rename(from, to)
        }
        else fs.fsyncSync = (fd) => {
          const directory = fs.fstatSync(fd).isDirectory()
          if (directory === (failure === 'directory-fsync')) {
            writes++
            if (failures++ === 0) throw new Error('once: fsync unavailable')
          }
          return sync(fd)
        }
        let claims = 0
        await claim(async () => { claims++ })
        assert.equal(claims, 0, '执行器没退出仍挡领取')
        if (restarted) gone = true
        else { release(); await flush() }
        await claim(async () => { claims++ })
        assert.equal(failures, 1, '一次故障后应退避，不马上连写')
        assert.equal(claims, 0)
        assert.equal(isPrintDispatchBlocked(), true)
        const cleanupCount = f.order.filter((v) => v === 'cleanup').length
        const surveyCount = surveys
        const writeCount = writes
        f.clock.jump(999)
        await claim(async () => { claims++ })
        assert.equal(writes, writeCount, '退避结束前不重写')
        f.clock.jump(1)
        await claim(async () => {
          assert.equal(readRecord(f.root).queueCleanupPending, false, '领取前先持久化')
          claims++
        })
        assert.equal(claims, 1, '瞬态写失败恢复后无需重启 Agent')
        assert.equal(isPrintDispatchBlocked(), false)
        assert.ok(f.order.filter((v) => v === 'cleanup').length > cleanupCount, '下一轮必须重新清队列')
        if (restarted) assert.ok(surveys > surveyCount, '下一轮必须重新检查执行器')
        await expectCode(() => f.runtime.command('start', { ...base, operationId: 'restart-after-write' }, 'owner'), 'COPY_ALREADY_DISPATCHED')
        await f.runtime.command('print', plain({ operationId: 'again-after-write' }), 'owner')
        await f.runtime.whenIdle()
        assert.equal(original.printCalls.length, 1)
        if (restarted) assert.equal(f.printCalls.length, 0)
      } finally {
        fs.renameSync = rename; fs.fsyncSync = sync
        release(); await flush()
        if (f !== original) await f.close()
        await original.close()
        if (restartRoot) fs.rmSync(restartRoot, { recursive: true, force: true })
        __resetPrintDispatchGateForTests()
      }
    }
  })
  await check('C2d-① 持续 rename 失败：1/2/4/8/16/30 秒封顶退避、可读日志、云打印被挡且不重派', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const f = printFixture({ timeoutMs: 5, stages: Array(1000).fill('not_found'), driver: () => waiting })
    const rename = fs.renameSync
    const write = process.stdout.write
    const logs: string[] = []
    let attempts = 0
    let claims = 0
    try {
      await ready(f); await sendPrint(f)
      process.stdout.write = ((chunk: string | Uint8Array) => { logs.push(String(chunk)); return true }) as typeof write
      fs.renameSync = (from, to) => {
        if (String(to).startsWith(path.join(f.root, 'print-ledger'))) { attempts++; throw new Error('disk unavailable') }
        return rename(from, to)
      }
      release(); await flush()
      assert.equal(attempts, 1)
      for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const before: number = attempts
        f.clock.jump(delay - 1)
        for (let i = 0; i < 3; i++) await claim(async () => { claims++ })
        assert.equal(attempts, before, '每个退避窗口最多写一次')
        f.clock.jump(1)
        await claim(async () => { claims++ })
        assert.equal(attempts, before + 1)
        assert.equal(claims, 0)
        assert.equal(readRecord(f.root).queueCleanupPending, true)
      }
      assert.equal(f.printCalls.length, 1)
      assert.equal(isPrintDispatchBlocked(), true)
      assert.equal(logs.filter((v) => v.includes('cleanup completion persist failed')).length, attempts)
      assert.ok(logs.some((v) => v.includes('retry in 30000ms') && v.includes('check ledger storage')))
      fs.renameSync = rename
      f.clock.jump(30000)
      await claim(async () => { claims++ })
      assert.equal(claims, 1)
      assert.ok(logs.some((v) => v.includes('cleanup completion persisted; print isolation released')))
    } finally { fs.renameSync = rename; process.stdout.write = write; release(); await f.close(); __resetPrintDispatchGateForTests() }
  })
  await check('C2d-① 清理写入及终态写入连续失败：恢复后仍可持久化清理，不重派墓碑', async () => {
    const rename = fs.renameSync
    const f = printFixture({ pause: async () => {
      fs.renameSync = (from, to) => {
        if (String(to).startsWith(path.join(f.root, 'print-ledger'))) throw new Error('persistent disk failure')
        return rename(from, to)
      }
    } })
    try {
      await ready(f); await sendPrint(f)
      assert.equal(readRecord(f.root).state, 'spooled', '终态写入也已失败')
      assert.equal(readRecord(f.root).queueCleanupPending, true)
      assert.equal(isPrintDispatchBlocked(), true)
      const cleanups = f.order.filter((step) => step === 'cleanup').length
      fs.renameSync = rename
      f.clock.jump(1000)
      let claims = 0
      await claim(async () => { claims++ })
      assert.equal(claims, 1)
      assert.equal(readRecord(f.root).queueCleanupPending, false)
      assert.ok(f.order.filter((step) => step === 'cleanup').length > cleanups, '已完成打印的清理写失败后，也必须重新清队列')
      await expectCode(() => f.runtime.command('start', { ...base, operationId: 'after-disk-recovery' }, 'owner'), 'COPY_ALREADY_DISPATCHED')
      assert.equal(f.printCalls.length, 1)
    } finally { fs.renameSync = rename; await f.close(); __resetPrintDispatchGateForTests() }
  })
}
