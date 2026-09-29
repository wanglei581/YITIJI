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
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
  stop: () => Promise<void>
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, 2_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * 拉起只监听 127.0.0.1 的 redis-server。不落盘、不持久化。
 * PATH 上没有 redis-server 时直接失败，不改连共享实例，也不跳过。
 */
export async function startEphemeralRedis(): Promise<EphemeralRedis> {
  let lastDetail = ''
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const port = await unusedLoopbackPort()
    const dir = await mkdtemp(join(tmpdir(), 'internal-login-real-redis-'))
    let stderr = ''
    let spawnError: Error | null = null
    const child = spawn('redis-server', [
      '--bind', '127.0.0.1',
      '--port', String(port),
      '--save', '',
      '--appendonly', 'no',
      '--daemonize', 'no',
      '--dir', dir,
      '--protected-mode', 'yes',
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    child.on('error', (error: Error) => { spawnError = error })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })

    const stop = async (): Promise<void> => {
      await stopProcess(child)
      await rm(dir, { recursive: true, force: true })
    }

    const deadline = Date.now() + 8_000
    let ready = false
    while (Date.now() < deadline) {
      if (spawnError) break
      if (child.exitCode !== null) break
      if (await pingRedis(port)) { ready = true; break }
      await sleep(80)
    }

    if (ready) {
      return { port, url: `redis://127.0.0.1:${port}`, stop }
    }

    await stop()
    if (spawnError && (spawnError as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('PATH 上没有 redis-server。本门禁需要真实 Redis，不改用内存桩，也不跳过。')
    }
    lastDetail = `第 ${attempt} 次 port=${port} exit=${child.exitCode ?? 'none'} ${stderr.trim().slice(-400)}`
  }
  throw new Error(`临时 redis-server 没有就绪。${lastDetail}`)
}
