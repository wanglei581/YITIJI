/**
 * 门禁用的「拉起真实 src/main.ts 子进程」helper。
 *
 * 与 `verify-boot-resilience.ts` 里的同名逻辑同源；抽出来是为了让新增门禁
 * （verify:redis-degradation-truth / verify:error-observability）复用同一套
 * 启动 + 探测约定，而不是各写一份行为略有差异的拷贝。
 * 刻意不改动 verify-boot-resilience.ts 自身，避免在修 P0 的同时动既有门禁。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const API_ROOT = join(__dirname, '..', '..')
const MAIN_ENTRY = join(API_ROOT, 'src', 'main.ts')

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function unusedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return port
}

export interface BootedApp {
  child: ChildProcess
  port: number
  listening: boolean
  output: () => string
  stop: () => Promise<void>
}

/** 启动真实入口 src/main.ts，等到它监听端口或超时。 */
export async function bootApp(env: Record<string, string>, waitMs: number): Promise<BootedApp> {
  const port = await unusedLoopbackPort()
  let buffer = ''
  const child = spawn(process.execPath, ['-r', '@swc-node/register', MAIN_ENTRY], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      NODE_ENV: 'development',
      // 明确关掉测试出纸种子，避免门禁往共享库里写打印任务。
      ENABLE_TEST_PRINT_TASK_SEED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { buffer += chunk.toString() })

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    }
  }

  const deadline = Date.now() + waitMs
  let listening = false
  while (Date.now() < deadline) {
    if (buffer.includes('AI Job Print API running')) { listening = true; break }
    if (child.exitCode !== null) break
    await sleep(250)
  }
  return { child, port, listening, output: () => buffer, stop }
}

export interface HttpProbeResult {
  status: number
  body: unknown
  raw: string
  elapsedMs: number
}

export async function probe(
  port: number,
  path: string,
  init: { method?: string; token?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<HttpProbeResult> {
  const started = Date.now()
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.token) headers['Authorization'] = `Bearer ${init.token}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 90_000)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const raw = await response.text()
    let body: unknown = null
    try { body = JSON.parse(raw) } catch { body = null }
    return { status: response.status, body, raw, elapsedMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}
