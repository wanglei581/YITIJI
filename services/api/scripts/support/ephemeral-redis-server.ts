/**
 * 门禁用的临时 redis-server。
 *
 * 为什么单独成文件：`verify-boot-resilience.ts` 里已有一份私有的
 * `startRedisServer`，参数就是下面这一组。本任务要复用那种起法，但不能改
 * 那条门禁（也不改 `verify-redis-degradation-truth.ts`，它的 Redis 是死端口）。
 * 把启动函数抽进去再改调用点，等于给一条已经在 CI 里的门禁换启动路径。
 * 所以新门禁用这一份；启动参数与那份私有函数一致，并写明 `--daemonize no`，
 * 保证被关掉的就是我们拉起的进程，而不是 fork 出去的孙进程。
 *
 * 端口由操作系统分配，避开 4100–4199（其它车道的服务）以及本机已约定的
 * 6379 / 6391，避免接到共享 Redis 上。
 *
 * 启停同时听 error、exit、close，并有 10 秒上限。spawn 失败（ENOENT）
 * 只发 error、不发 exit；只等 exit 会一直卡住。超时后先 SIGKILL，再抛错。
 * 进程退出（exit / SIGINT / SIGTERM / uncaughtException）时停掉 redis 并
 * 删掉临时目录。清理可以重复调用。
 * 自检在 ephemeral-redis-self-check.ts，避免这个文件再往上堆。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 停一个已经拉起的 redis-server。到点还没结束就 SIGKILL，然后报错，不再等。 */
const STOP_TIMEOUT_MS = 10_000
const READY_TIMEOUT_MS = 8_000

function isReservedPort(port: number): boolean {
  return (port >= 4100 && port <= 4199) || port === 6379 || port === 6391
}

async function bindEphemeralPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('临时端口没有拿到数字端口号')
  }
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

async function unusedLoopbackPort(): Promise<number> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = await bindEphemeralPort()
    if (!isReservedPort(port)) return port
  }
  throw new Error('连续分配到保留端口（4100-4199 / 6379 / 6391），临时 Redis 不启动')
}

function pingRedis(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const finish = (ok: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(400)
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
    socket.once('connect', () => {
      socket.write('*1\r\n$4\r\nPING\r\n')
    })
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      if (buffer.includes('+PONG')) finish(true)
    })
  })
}

export interface EphemeralRedis {
  port: number
  url: string
  directory: string
  pid: number | undefined
  stop: () => Promise<void>
}

export interface EphemeralRedisOptions {
  /** 默认 `redis-server`。自检把它指到一个不存在的路径。 */
  command?: string
  /** 不传则用 redis-server 那组参数。自检用它拉起一个不听 SIGTERM 的进程。 */
  args?: string[]
  readyTimeoutMs?: number
  stopTimeoutMs?: number
  attempts?: number
}

interface ActiveRedis {
  child: ChildProcess
  directory: string
}

const active = new Set<ActiveRedis>()
const extraCleanups: Array<() => void> = []
let hooksInstalled = false
let cleaning = false

/**
 * pid 还没有时不能 kill。spawn 失败会在 nextTick 里才报错，在那之前 pid 是
 * undefined，ChildProcess.kill 会打到整个进程组，把门禁自己杀掉。
 */
function safeKill(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (typeof child.pid !== 'number' || child.pid <= 0) return
  try {
    child.kill(signal)
  } catch {
    // 进程已经没了。
  }
}

/** 停掉还活着的 redis-server，删掉临时目录，并跑外部登记的清理。重复调用不抛错。 */
export function runEphemeralCleanup(): void {
  if (cleaning) return
  cleaning = true
  try {
    for (const entry of [...active]) {
      active.delete(entry)
      safeKill(entry.child, 'SIGKILL')
      try {
        rmSync(entry.directory, { recursive: true, force: true })
      } catch {
        // 目录已经没了。
      }
    }
    for (const cleanup of [...extraCleanups]) {
      try {
        cleanup()
      } catch {
        // 某一个清理失败不能挡住其余的，也不能让钩子自己抛出去。
      }
    }
  } finally {
    cleaning = false
  }
}

export function registerProcessCleanup(cleanup: () => void): void {
  installCleanupHooks()
  extraCleanups.push(cleanup)
}

function installCleanupHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  const onSignal = (signal: NodeJS.Signals): void => {
    runEphemeralCleanup()
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.on('exit', runEphemeralCleanup)
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  process.on('uncaughtException', (error: Error) => {
    runEphemeralCleanup()
    console.error(error)
    process.exit(1)
  })
}

/**
 * 同时听 error、exit、close。三者都没来就在 timeoutMs 后返回 timeout，
 * 调用方负责 SIGKILL。不能只等 exit：ENOENT 不会发 exit。
 */
class ChildWatch {
  spawnError: Error | null = null
  sawEnd = false
  private readonly waiters: Array<() => void> = []

  constructor(private readonly child: ChildProcess) {
    child.on('error', (error: Error) => {
      this.spawnError = error
      this.noteEnd()
    })
    child.on('exit', () => this.noteEnd())
    child.on('close', () => this.noteEnd())
  }

  ended(): boolean {
    return this.sawEnd || this.child.exitCode !== null || this.child.signalCode !== null
  }

  private noteEnd(): void {
    if (this.sawEnd) return
    this.sawEnd = true
    const pending = this.waiters.splice(0)
    for (const waiter of pending) waiter()
  }

  wait(timeoutMs: number): Promise<'event' | 'timeout'> {
    if (this.ended()) return Promise.resolve('event')
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: 'event' | 'timeout'): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => finish('timeout'), timeoutMs)
      this.waiters.push(() => finish('event'))
      if (this.ended()) finish('event')
    })
  }
}

async function stopProcess(child: ChildProcess, watch: ChildWatch, timeoutMs: number): Promise<void> {
  if (watch.ended()) return
  safeKill(child, 'SIGTERM')
  const first = await watch.wait(timeoutMs)
  if (first === 'event' || watch.ended()) return
  safeKill(child, 'SIGKILL')
  const second = await watch.wait(timeoutMs)
  if (second === 'timeout' && !watch.ended()) {
    throw new Error('停止 redis-server 超时，已发送 SIGKILL 仍未退出')
  }
}

/**
 * 拉起只监听 127.0.0.1 的 redis-server。不落盘、不持久化。
 * PATH 上没有 redis-server 时直接失败，不改连共享实例，也不跳过。
 */
export async function startEphemeralRedis(options: EphemeralRedisOptions = {}): Promise<EphemeralRedis> {
  installCleanupHooks()
  const command = options.command ?? 'redis-server'
  const attempts = options.attempts ?? 4
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS
  const stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
  let lastDetail = ''
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const port = await unusedLoopbackPort()
    const directory = await mkdtemp(join(tmpdir(), 'internal-login-real-redis-'))
    const args = options.args ?? [
      '--bind', '127.0.0.1',
      '--port', String(port),
      '--save', '',
      '--appendonly', 'no',
      '--daemonize', 'no',
      '--dir', directory,
      '--protected-mode', 'yes',
    ]
    let stderr = ''
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const watch = new ChildWatch(child)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 4_000) stderr = stderr.slice(-2_000)
    })
    const entry: ActiveRedis = { child, directory }
    active.add(entry)
    let stopped = false
    const stop = async (): Promise<void> => {
      if (stopped) return
      stopped = true
      try {
        await stopProcess(child, watch, stopTimeoutMs)
      } finally {
        active.delete(entry)
        await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      }
    }

    const deadline = Date.now() + readyTimeoutMs
    let ready = false
    while (Date.now() < deadline) {
      if (watch.spawnError || watch.sawEnd || child.exitCode !== null) break
      if (await pingRedis(port)) {
        ready = true
        break
      }
      await sleep(80)
    }

    if (ready) {
      return { port, url: `redis://127.0.0.1:${port}`, directory, pid: child.pid, stop }
    }

    const spawnError = watch.spawnError
    await stop()
    if (spawnError && (spawnError as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('PATH 上没有 redis-server。本门禁需要真实 Redis，不改用内存桩，也不跳过。')
    }
    lastDetail = `第 ${attempt} 次 port=${port} exit=${child.exitCode ?? 'none'} ${stderr.trim().slice(-400)}`
  }
  throw new Error(`临时 redis-server 没有就绪。${lastDetail}`)
}
