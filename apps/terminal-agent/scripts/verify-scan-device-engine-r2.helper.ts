/**
 * 屏上扫描引擎第二轮：必需属性失败、强杀未确认、卡纸留给调用方（卡纸断言在原 helper 里改了一处）。
 * 由 verify-scan-device-engine.ts 调用。不单独改环境变量。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { WIA_HRESULT, WIA_REQUIRED_PROPERTY_IDS } from '../src/agent/scan-device/wia-script'
import { WIA_ABORT_GRACE_MS, WIA_FORCE_KILL_WAIT_MS, startWiaScan } from '../src/agent/scan-device/wia-runner'
import { makeRig, settle, step, type Rig } from './verify-scan-device-engine.helper'

function pageLine(rig: Rig, index: number): string {
  const file = `page-${String(index).padStart(3, '0')}.jpg`
  fs.writeFileSync(path.join(rig.taskDir, file), Buffer.alloc(32, 0x61))
  return JSON.stringify({ page: index, file, bytes: 32, via: 'wia' })
}

function doneWith(pages: number, setFailed: number[]): string {
  return JSON.stringify({ ok: true, pages, canceled: false, setFailed })
}

export async function runnerChecksR2(): Promise<void> {
  await step('扫描：必需 WIA 属性设失败或缺失 → not_ready，不当成功', async () => {
    for (const id of WIA_REQUIRED_PROPERTY_IDS) {
      const rig = makeRig(`req-${id}`)
      const handle = startWiaScan({ source: 'flatbed', color: 'gray', outDir: rig.taskDir }, rig.deps)
      rig.children[0].send(`${pageLine(rig, 1)}\n${doneWith(1, [id])}\n`)
      rig.children[0].exit(0)
      const result = await handle.result
      assert.equal(result.ok, false, `属性 ${id} 失败不能当成功`)
      assert.equal(result.errorCode, 'not_ready', `属性 ${id}`)
      assert.equal(result.endedBy, 'error')
    }
  })

  await step('扫描：可选属性 3096 / 6149 / 6150 失败仍成功，卡纸不改成 not_ready', async () => {
    for (const id of [3096, 6149, 6150]) {
      const rig = makeRig(`opt-${id}`)
      const handle = startWiaScan({ source: 'flatbed', color: 'gray', outDir: rig.taskDir }, rig.deps)
      rig.children[0].send(`${pageLine(rig, 1)}\n${doneWith(1, [id])}\n`)
      rig.children[0].exit(0)
      const result = await handle.result
      assert.equal(result.ok, true, `可选属性 ${id} 失败仍应成功`)
      assert.equal(result.errorCode, undefined)
    }
    const jam = makeRig('jam-prop')
    const handle = startWiaScan({ source: 'feeder', color: 'gray', outDir: jam.taskDir, maxPages: 5 }, jam.deps)
    jam.children[0].send(
      `${pageLine(jam, 1)}\n${JSON.stringify({ ok: false, code: 'wia_error', hresult: WIA_HRESULT.PAPER_JAM, pages: 1, setFailed: [3088] })}\n`,
    )
    jam.children[0].exit(0)
    const jammed = await handle.result
    assert.equal(jammed.errorCode, 'paper_jam')
    assert.equal(jammed.discardedPages, 0)
    assert.equal(jammed.pages.length, 1)
  })

  await step('扫描：进纸器扫空但必需属性失败 → not_ready', async () => {
    const rig = makeRig('empty-prop')
    const handle = startWiaScan({ source: 'feeder', color: 'gray', outDir: rig.taskDir, maxPages: 5 }, rig.deps)
    rig.children[0].send(
      `${pageLine(rig, 1)}\n${JSON.stringify({ ok: false, code: 'wia_error', hresult: WIA_HRESULT.PAPER_EMPTY, pages: 1, setFailed: [6151] })}\n`,
    )
    rig.children[0].exit(0)
    const result = await handle.result
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'not_ready')
  })

  await step('强杀：taskkill 没确认成功就立即返回未确认停止，不再空等 10 秒', async () => {
    const rig = makeRig('kill-false')
    rig.deps.killProcessTree = async (pid) => {
      rig.killed.push(pid)
      return false
    }
    const handle = startWiaScan({ source: 'feeder', color: 'gray', outDir: rig.taskDir }, rig.deps)
    rig.children[0].pid = 5151
    handle.abort()
    await rig.clock.advance(WIA_ABORT_GRACE_MS)
    await settle()
    assert.equal(rig.clock.pending(), 0, '没确认强杀成功就不能再挂 10 秒等待')
    const result = await handle.result
    assert.equal(result.forceKilled, true)
    assert.equal(result.stopUnconfirmed, true)
    assert.equal(result.endedBy, 'aborted')
    assert.deepEqual(rig.killed, [5151])
  })

  await step('强杀：进程在 10 秒内仍不退出 → 未确认停止，结果照样返回', async () => {
    const rig = makeRig('kill-hang')
    const handle = startWiaScan({ source: 'feeder', color: 'gray', outDir: rig.taskDir }, rig.deps)
    handle.abort()
    await rig.clock.advance(WIA_ABORT_GRACE_MS)
    await rig.clock.advance(WIA_FORCE_KILL_WAIT_MS)
    const result = await handle.result
    assert.equal(result.stopUnconfirmed, true)
    assert.equal(result.forceKilled, true)
    assert.equal(result.endedBy, 'aborted')
    assert.equal(rig.clock.pending(), 0)
  })

  await step('强杀：进程在等待窗口内退出 → 停止已确认', async () => {
    const rig = makeRig('kill-exit')
    const handle = startWiaScan({ source: 'feeder', color: 'gray', outDir: rig.taskDir }, rig.deps)
    handle.abort()
    await rig.clock.advance(WIA_ABORT_GRACE_MS)
    await rig.clock.advance(1_000)
    rig.children[0].exit(1)
    const result = await handle.result
    assert.equal(result.stopUnconfirmed, false)
    assert.equal(result.forceKilled, true)
  })
}
