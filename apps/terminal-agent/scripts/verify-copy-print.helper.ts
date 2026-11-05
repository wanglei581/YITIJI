import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import type { PrintOptions } from 'pdf-to-printer'
import { print } from '../src/printer/print'
import { printWithPdfToPrinter } from '../src/printer/print-with-pdf-to-printer'
import type { CopyPermit, CopyPrintResult } from '../src/agent/copy-device/copy-types'
import type { PrintJobMonitorStatus } from '../src/agent/wmi'
import { __resetPrintDispatchGateForTests } from '../src/agent/print-dispatch-gate'
import { fixture, base, plain, scan, flush } from './verify-copy-device.helper'
import { copyDirId } from '../src/agent/copy-device/copy-storage'
import type { CopyPrintRecord } from '../src/agent/copy-device/copy-print-ledger'
import { recoveryChecks } from './verify-copy-print-recovery.helper'

export function printFixture(options: { root?: string; stages?: PrintJobMonitorStatus[]; reportFails?: boolean;
  beforeDriver?: () => Promise<void>; driver?: () => Promise<void>; timeoutMs?: number;
  monitorWait?: () => Promise<void>; zeroDispatch?: boolean } = {}) {
  __resetPrintDispatchGateForTests()
  const calls: Array<{ file: string; options?: PrintOptions }> = []
  const results: CopyPrintResult[] = []
  const permits: string[] = []
  const order: string[] = []
  let patch: Partial<CopyPermit> = {}
  let reportFails = options.reportFails ?? false
  let index = 0
  let monitorNow = 0
  const f = fixture({ root: options.root, deps: {
    permit: async (id, op = 'scan') => {
      permits.push(op)
      return op === 'scan' ? f.permit(id) : { ...f.permit(id), op, authorizationVersion: 1,
        parameters: { ...f.permit(id).parameters, pageCount: 1 }, ...patch }
    },
    reportPrint: async (_id, result) => { results.push({ ...result }); if (reportFails) throw new Error('offline') },
    printDependencies: {
      preflight: async () => 'ok', removeOwnJobs: async () => { order.push('cleanup') },
      resume: async () => { order.push('resume'); await options.beforeDriver?.() }, pause: async () => { order.push('pause') },
      print: async (file, printerName, params, hooks) => options.zeroDispatch ?
        print('/definitely-missing-copy.pdf', printerName, params) : printWithPdfToPrinter(file, printerName, params, {
        ...hooks, timeoutMs: options.timeoutMs ?? 1000,
        dispatch: async (file, settings) => {
          order.push('driver'); calls.push({ file, options: settings })
          const record = readRecord(f.root)
          assert.equal(record.state, 'dispatching', '必须先耐久 dispatching 才能调用驱动')
          assert.equal(f.lock.snapshot().heldBy, 'copy-print')
          assert.equal(path.basename(file), `task_copy_${copyDirId(base.copyId, 1)}.pdf`)
          await options.driver?.()
        },
      }),
      monitor: { platform: 'win32', now: () => monitorNow,
        sleep: async (ms) => { monitorNow += ms; await options.monitorWait?.() },
        queryStatus: async () => ({ status: options.stages?.[index++] ?? 'completed' }),
        queryCompletionEvent: async () => false,
      },
    },
  } })
  f.config.holdPrinterQueueWhenIdle = true
  return { ...f, printCalls: calls, results, permits, order,
    patchPrint: (p: Partial<CopyPermit>) => { patch = p }, failReport: (v: boolean) => { reportFails = v } }
}
export function readRecord(root: string): CopyPrintRecord {
  return JSON.parse(fs.readFileSync(path.join(root, 'print-ledger', `${copyDirId(base.copyId, 1)}.json`), 'utf8')) as CopyPrintRecord
}
export async function ready(f: ReturnType<typeof printFixture>): Promise<void> {
  await scan(f)
  await f.runtime.command('finish', plain({ operationId: 'finish' }), 'owner'); await f.runtime.whenIdle()
  assert.equal((await f.view()).state, 'scanned')
}
export const printCommand = plain({ operationId: 'print' })
export async function sendPrint(f: ReturnType<typeof printFixture>): Promise<void> {
  await f.runtime.command('print', printCommand, 'owner'); await f.runtime.whenIdle()
}
export async function printChecks(check: (name: string, fn: () => Promise<void>) => Promise<void>): Promise<void> {
  await check('打印许可拒绝/已派发/过期/跨绑定/参数或授权版本错误不调用驱动', async () => {
    for (const patch of [
      { allowed: false }, { allowed: false, reason: 'COPY_ALREADY_DISPATCHED' },
      { expiresAt: '2000-01-01T00:00:00Z' }, { terminalId: 'wrong' }, { copyId: 'wrong' },
      { generation: 2 }, { op: 'scan' as const }, { authorizationVersion: 0 },
    ]) {
      const f = printFixture()
      try { await ready(f); f.patchPrint(patch); await sendPrint(f); assert.equal(f.printCalls.length, 0) }
      finally { await f.close() }
    }
    for (const parameters of [{ copies: 2 }, { pageCount: 2 }, { duplex: 'duplex_long_edge' as const, copies: 2 }]) {
      const f = printFixture()
      try {
        await ready(f); f.patchPrint({ parameters: { ...f.permit(base.copyId).parameters, pageCount: 1, ...parameters } })
        await sendPrint(f); assert.equal(f.printCalls.length, 0)
      } finally { await f.close() }
    }
  })
  await check('颜色/单双面/份数全部取许可快照；奇数页多份双面即便获许可仍拒绝', async () => {
    for (const parameters of [
      { colorMode: 'color' as const, duplex: 'duplex_short_edge' as const, copies: 1 },
      { colorMode: 'black_white' as const, duplex: 'simplex' as const, copies: 2 },
      { colorMode: 'black_white' as const, duplex: 'duplex_long_edge' as const, copies: 2 },
    ]) {
      const f = printFixture()
      try {
        f.patchPermit({ parameters: { ...f.permit(base.copyId).parameters, ...parameters } })
        await ready(f); await sendPrint(f)
        if (parameters.duplex === 'duplex_long_edge') assert.equal(f.printCalls.length, 0)
        else {
          assert.equal(f.printCalls.length, 1)
          assert.equal(f.printCalls[0]?.options?.copies, parameters.copies)
          assert.equal(f.printCalls[0]?.options?.monochrome, parameters.colorMode === 'black_white')
          assert.equal(f.printCalls[0]?.options?.side, parameters.duplex === 'simplex' ? 'simplex' : 'duplexshort')
        }
      } finally { await f.close() }
    }
  })
  await check('同单同代并发/不同 operation/完成后重复 print 驱动仅一次；队列完成 handed/A4/删页审计', async () => {
    const f = printFixture()
    try {
      await ready(f)
      await Promise.all([f.runtime.command('print', printCommand, 'owner'),
        f.runtime.command('print', plain({ operationId: 'second-print' }), 'owner')])
      await f.runtime.whenIdle()
      for (const command of [printCommand, plain({ operationId: 'third-print' })]) {
        assert.equal((await f.runtime.command('print', command, 'owner') as { state: string }).state, 'handed')
      }
      assert.equal(f.printCalls.length, 1); assert.equal(f.permits.filter((p) => p === 'print').length, 1)
      assert.equal((await f.view()).state, 'handed')
      assert.equal(f.results.length, 1); assert.equal(f.results[0]?.state, 'handed')
      assert.equal(f.printCalls[0]?.options?.paperSize, 'A4')
      assert.equal(f.printCalls[0]?.options?.monochrome, true)
      assert.equal(f.printCalls[0]?.options?.side, 'simplex'); assert.equal(f.printCalls[0]?.options?.copies, 1)
      assert.deepEqual(f.order, ['cleanup', 'resume', 'driver', 'pause'])
      assert.equal(fs.existsSync(f.dir()), false)
      assert.ok(f.audit.some((r) => r.reason === 'COPY_PRINT_TERMINAL' && r.result === 'deleted'))
      const view = await f.view()
      assert.deepEqual(Object.keys(view).sort(), ['errorCode', 'generation', 'pageCount', 'purged', 'state'])
      assert.equal(JSON.stringify(view).includes('sheet'), false)
    } finally { await f.close() }
  })
  await check('驱动入口明确未派发才 failed；命令异常、卡纸、队列消失、监控超时一律 unconfirmed', async () => {
    for (const stages of [['error'], ['not_found'], ['unknown'], ['retained']] as PrintJobMonitorStatus[][]) {
      const f = printFixture({ stages: Array(700).fill(stages[0]) as PrintJobMonitorStatus[] })
      try { await ready(f); await sendPrint(f); assert.equal((await f.view()).state, 'unconfirmed'); assert.equal(f.results[0]?.state, 'unconfirmed') }
      finally { await f.close() }
    }
    const ambiguous = printFixture({ driver: async () => { throw new Error('driver failed after possible spool') } })
    try { await ready(ambiguous); await sendPrint(ambiguous); assert.equal((await ambiguous.view()).state, 'unconfirmed') }
    finally { await ambiguous.close() }
    const explicit = printFixture({ zeroDispatch: true })
    try {
      await ready(explicit); await sendPrint(explicit)
      assert.equal((await explicit.view()).state, 'failed')
      assert.equal(explicit.results[0]?.state, 'failed'); assert.equal(explicit.printCalls.length, 0)
      assert.equal(fs.existsSync(explicit.dir()), false)
    } finally { await explicit.close() }
  })
  await check('复印打印准备至队列终态全程共锁；30 秒忙且不迟开驱动', async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const f = printFixture({ monitorWait: () => waiting })
    try {
      await ready(f); await f.runtime.command('print', printCommand, 'owner'); await flush()
      assert.equal(f.printCalls.length, 1); assert.equal(f.lock.tryAcquire('copy-scan'), undefined)
      assert.equal(f.lock.tryAcquire('print-claim'), undefined)
      release(); await f.runtime.whenIdle(); assert.equal(f.lock.snapshot().heldBy, undefined)
    } finally { release(); await f.close() }
    const busy = printFixture()
    await ready(busy)
    const lock = await busy.lock.acquire('scan-device')
    try {
      await busy.runtime.command('print', printCommand, 'owner'); await flush()
      busy.clock.advance(30_001); await busy.runtime.whenIdle()
      assert.equal((await busy.view()).errorCode, 'COPY_DEVICE_BUSY'); assert.equal(busy.printCalls.length, 0)
      lock.release(); await flush(); assert.equal(busy.printCalls.length, 0)
    } finally { lock.release(); await busy.close() }
  })
  await recoveryChecks(check)
}
