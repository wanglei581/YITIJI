import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { EventEmitter, once } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { DeviceLock } from '../src/agent/device-lock'
import { createCopyRuntime } from '../src/agent/copy-device/copy-runtime'
import { copyDirId } from '../src/agent/copy-device/copy-storage'
import { CopyError, type CopyCommand, type CopyDeps, type CopyPermit, type CopyView } from '../src/agent/copy-device/copy-types'
import { startWiaScan, type WiaScanRequest } from '../src/agent/scan-device/wia-runner'
import { agentConfig, createManualClock, flush } from './verify-scan-device-runner.helper'

export const ALLOWED = 'https://kiosk.copy.test'
export const TOKEN = 'copy-test-bridge-token'
export const JPEG = Buffer.from('ffd8ffe000104a46494600010201012c012c0000ffc00011080010001003012200021100031100ffda000c03010002110311003f005affd9', 'hex')
export const base: CopyCommand = { copyId: 'copy-1', generation: 1, operationId: 'start-1', source: 'flatbed', scanColor: 'color' }
export const plain = (patch: Partial<CopyCommand> = {}): CopyCommand => ({ copyId: base.copyId, generation: 1, operationId: 'operation', ...patch })

/** 与 A2 同样的 EventEmitter 假子进程：真正经过 WIA stdout 解析、页文件核实与取消逻辑。 */
class FakeChild extends EventEmitter {
  pid = 4242
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  closed = false
  send(value: unknown): void { this.stdout.emit('data', Buffer.from(`${JSON.stringify(value)}\n`)) }
  close(): void { if (!this.closed) { this.closed = true; this.emit('close', 0) } }
}
export function fixture(options: { hold?: boolean; pages?: number; root?: string; deps?: Partial<CopyDeps> } = {}) {
  const root = options.root ?? fs.mkdtempSync(path.join(os.tmpdir(), 'verify-copy-device-'))
  const clock = createManualClock()
  const config = agentConfig({ copyDeviceEnabled: true, scanDeviceEnabled: false,
    localApiAllowedOrigins: [ALLOWED], localApiPort: 0, localApiBridgeToken: TOKEN })
  const lock = new DeviceLock({ clock, logger: { log() {}, warn() {} } })
  const calls: WiaScanRequest[] = []
  const children: FakeChild[] = []
  const audit: Array<{ id: string; reason: string; result?: string }> = []
  const reports: unknown[] = []
  let permitPatch: Partial<CopyPermit> = {}
  let last: { child: FakeChild; request: WiaScanRequest } | undefined
  let pageBytes: Buffer = JPEG
  let deleteFails = false
  const complete = (error?: string): void => {
    assert.ok(last)
    const { child, request } = last
    const count = options.pages ?? 1
    for (let i = 0; i < count; i += 1) {
      const index = (request.startIndex ?? 1) + i
      const file = `page-${String(index).padStart(3, '0')}.jpg`
      fs.writeFileSync(path.join(request.outDir, file), pageBytes)
      child.send({ page: index, file, bytes: pageBytes.length, via: 'wia' })
    }
    child.send(error ? { ok: false, code: 'wia_error', pages: count, hresult: error } :
      { ok: true, pages: count, canceled: false })
    child.close()
  }
  const permit = (id: string): CopyPermit => ({ allowed: true, reason: null, copyId: id, op: 'scan', generation: 1,
    authorizationVersion: 0, expiresAt: new Date(clock.now() + 30_000).toISOString(),
    parameters: { source: base.source!, colorMode: 'black_white', duplex: 'simplex', copies: 1,
      pageCount: 0, maxPages: 20, maxCopies: 99 }, ...permitPatch })
  const runtime = createCopyRuntime(config, {
    clock, lock, root,
    tempHooks: {
      assertDirectoryAcl() {},
      audit: { begin(id, reason) { const row = { id, reason, result: '' }; audit.push(row)
        return { finish(outcome) { row.result = outcome.result } } } },
      removeDirectory(dir) {
        if (deleteFails) throw Object.assign(new Error('injected'), { code: 'EACCES' })
        fs.rmSync(dir, { recursive: true })
      },
    },
    permit: async (id) => permit(id),
    report: async (id, generation, pageCount) => { reports.push({ id, generation, pageCount }) },
    runProbe: async () => ({ state: 'ready', forceKilled: false, stopUnconfirmed: false, elapsedMs: 0 }),
    startScan(request) {
      calls.push(request)
      const result = startWiaScan(request, {
        root, clock, powershellPath: 'fake-powershell',
        spawnProcess() {
          const child = new FakeChild()
          children.push(child)
          last = { child, request }
          if (!options.hold) queueMicrotask(() => complete())
          return child as unknown as ChildProcess
        },
        writeCancelFlag(file) { fs.writeFileSync(file, '1'); last?.child.close() },
        killProcessTree: async () => { last?.child.close() },
      })
      return result
    }, ...options.deps,
  })
  const view = async (owner = 'owner'): Promise<CopyView> =>
    await runtime.command('status', plain(), owner) as CopyView
  return { root, config, clock, lock, runtime, calls, audit, reports, permit, complete, view, children,
    failBeforePage(hresult: string) {
      assert.ok(last); last.child.send({ ok: false, code: 'wia_error', pages: 0, hresult }); last.child.close()
    },
    dir: (generation = 1) => path.join(root, copyDirId(base.copyId, generation)),
    patchPermit: (patch: Partial<CopyPermit>) => { permitPatch = patch },
    setPageBytes: (bytes: Buffer) => { pageBytes = bytes },
    failDeletion: (value: boolean) => { deleteFails = value },
    async close() { runtime.stop(); await runtime.whenIdle(); fs.rmSync(root, { recursive: true, force: true }) },
  }
}
export async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(fn, (error: unknown) => error instanceof CopyError && error.code === code)
}
export async function scan(f: ReturnType<typeof fixture>, command = base): Promise<void> {
  await f.runtime.command('start', command, 'owner')
  await f.runtime.whenIdle()
}
export async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as { port: number }).port
}
export async function request(port: number, route: string, body: unknown, patch: { origin?: string; token?: string; method?: string; raw?: string } = {}) {
  const bytes = patch.raw ?? JSON.stringify(body)
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Buffer; json: () => { data: CopyView & { token?: string }; error: { code: string } } }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: route, method: patch.method ?? 'POST',
      headers: { Origin: patch.origin ?? ALLOWED, 'X-Local-Bridge-Token': patch.token ?? TOKEN,
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => { const bytes = Buffer.concat(chunks)
        resolve({ status: res.statusCode!, headers: res.headers, bytes, json: () => JSON.parse(bytes.toString()) }) })
    })
    req.on('error', reject); req.end(bytes)
  })
}
export { flush }
