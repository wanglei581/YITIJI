/**
 * 临时 redis-server 启停自检。
 *
 * 不放进 ephemeral-redis-server.ts：那个文件只负责拉起、停掉和退出清理，
 * 再塞进自检会超过 500 行。不放进 verify-internal-login-real-redis.ts：
 * 那条门禁写的是登录断言，再塞也会超过 500 行。
 *
 * 卡住时自检自己在 15 秒退出，不把整条门禁挂住。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  registerProcessCleanup,
  runEphemeralCleanup,
  startEphemeralRedis,
} from './ephemeral-redis-server'

const SELF_CHECK_BUDGET_MS = 15_000
const require = createRequire(import.meta.url)
const serverModulePath = join(import.meta.dirname, 'ephemeral-redis-server.ts')
const apiRoot = join(import.meta.dirname, '..', '..')

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export interface EphemeralRedisSelfCheck {
  name: string
  ok: boolean
  detail?: string
}

function redisAnswersPing(port: number): Promise<boolean> {
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

async function withDeadline<T>(budgetMs: number, label: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<T>(() => {
        timer = setTimeout(() => {
          console.error(`自检超时：${label}（超过 ${budgetMs}ms）`)
          process.exit(1)
        }, budgetMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function assertCleanupIsIdempotent(): EphemeralRedisSelfCheck {
  const directory = mkdtempSync(join(tmpdir(), 'ephemeral-redis-cleanup-'))
  writeFileSync(join(directory, 'marker'), 'x')
  registerProcessCleanup(() => {
    rmSync(directory, { recursive: true, force: true })
  })
  let failed = ''
  try {
    runEphemeralCleanup()
    runEphemeralCleanup()
  } catch (error) {
    failed = error instanceof Error ? error.message : String(error)
  }
  return {
    name: '清理钩子可以重复调用，临时目录会被删掉',
    ok: failed === '' && !existsSync(directory),
    detail: failed || undefined,
  }
}

async function assertMissingBinaryFailsFast(): Promise<EphemeralRedisSelfCheck> {
  const missing = join(tmpdir(), `missing-redis-${randomBytes(4).toString('hex')}`)
  const started = Date.now()
  let message = ''
  try {
    const redis = await withDeadline(SELF_CHECK_BUDGET_MS, '不存在的 redis-server 没有失败', () => (
      startEphemeralRedis({ command: missing, attempts: 1 })
    ))
    await redis.stop().catch(() => undefined)
    message = '启动函数返回了，没有失败'
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  const elapsed = Date.now() - started
  return {
    name: '不存在的 redis-server 在 15 秒内失败，而不是一直等下去',
    ok: elapsed < SELF_CHECK_BUDGET_MS && message.includes('没有 redis-server'),
    detail: `${elapsed}ms ${message}`,
  }
}

async function assertStopDoesNotWaitForever(): Promise<EphemeralRedisSelfCheck> {
  const stopTimeoutMs = 1_000
  const started = Date.now()
  let message = ''
  try {
    const redis = await withDeadline(SELF_CHECK_BUDGET_MS, '停不掉的子进程没有在超时内结束', () => (
      startEphemeralRedis({
        command: process.execPath,
        args: ['-e', 'process.on("SIGTERM", function () {}); setInterval(function () {}, 1000)'],
        readyTimeoutMs: 250,
        stopTimeoutMs,
        attempts: 1,
      })
    ))
    await redis.stop().catch(() => undefined)
    message = '这个进程不该被当成已经就绪的 redis-server'
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  const elapsed = Date.now() - started
  return {
    name: '不听 SIGTERM 的子进程会在超时后被停掉，不会无限等下去',
    ok: elapsed >= stopTimeoutMs && elapsed < SELF_CHECK_BUDGET_MS && message.includes('没有就绪'),
    detail: `${elapsed}ms ${message}`,
  }
}

function killIfAlive(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (typeof child.pid !== 'number' || child.pid <= 0) return
  try { child.kill('SIGKILL') } catch { /* 已经没了 */ }
}

async function assertSignalCleanupStopsRedis(): Promise<EphemeralRedisSelfCheck> {
  const scriptPath = join(tmpdir(), `ephemeral-redis-signal-${randomBytes(4).toString('hex')}.cjs`)
  writeFileSync(scriptPath, `
    const fs = require('fs')
    const loaded = require(process.argv[2])
    const start = loaded.startEphemeralRedis || (loaded.default && loaded.default.startEphemeralRedis)
    start().then((redis) => {
      fs.writeSync(1, JSON.stringify({ port: redis.port, directory: redis.directory, pid: redis.pid }) + '\\n')
      setInterval(() => {}, 1000)
    }).catch((error) => {
      console.error(error && error.stack ? error.stack : error)
      process.exit(1)
    })
  `)
  const child = spawn(process.execPath, [
    '-r', require.resolve('@swc-node/register'),
    scriptPath,
    serverModulePath,
  ], { cwd: apiRoot, stdio: ['ignore', 'pipe', 'pipe'] })
  child.on('error', () => { /* 启动失败由退出码体现，不能打成未处理异常 */ })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
  let detail = ''
  let readyDirectory: string | undefined
  try {
    const ready = await withDeadline(
      SELF_CHECK_BUDGET_MS,
      'SIGTERM 清理自检没有拿到临时 Redis',
      async () => {
        const deadline = Date.now() + 12_000
        while (Date.now() < deadline) {
          const newline = stdout.indexOf('\n')
          if (newline >= 0) {
            const line = stdout.slice(0, newline).trim()
            if (line.startsWith('{')) {
              try {
                return JSON.parse(line) as { port?: number; directory?: string; pid?: number }
              } catch {
                return null
              }
            }
          }
          if (child.exitCode !== null || child.signalCode !== null) return null
          await sleep(50)
        }
        return null
      },
    )
    if (!ready?.directory || typeof ready.port !== 'number' || typeof ready.pid !== 'number') {
      detail = `子进程没有留下临时 Redis。exit=${child.exitCode ?? 'none'} ${stderr.trim().slice(-400)}`
    } else {
      readyDirectory = ready.directory
      child.kill('SIGTERM')
      const exited = await new Promise<boolean>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve(true)
          return
        }
        const timer = setTimeout(() => resolve(false), 8_000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve(true)
        })
      })
      let directoryGone = !existsSync(ready.directory)
      let silent = !(await redisAnswersPing(ready.port))
      const probeDeadline = Date.now() + 2_000
      while (Date.now() < probeDeadline && (!directoryGone || !silent)) {
        await sleep(50)
        directoryGone = !existsSync(ready.directory)
        silent = !(await redisAnswersPing(ready.port))
      }
      if (!exited || !directoryGone || !silent) {
        detail = `exited=${exited} directoryGone=${directoryGone} silent=${silent} ${stderr.trim().slice(-300)}`
      }
      if (!silent) {
        try { process.kill(ready.pid, 'SIGKILL') } catch { /* 已经没了 */ }
      }
      if (existsSync(ready.directory)) rmSync(ready.directory, { recursive: true, force: true })
    }
  } catch (error) {
    detail = error instanceof Error ? error.message : String(error)
  } finally {
    killIfAlive(child)
    if (readyDirectory && existsSync(readyDirectory)) {
      rmSync(readyDirectory, { recursive: true, force: true })
    }
    rmSync(scriptPath, { force: true })
  }
  return {
    name: '进程收到 SIGTERM 时会停掉 redis-server 并删除临时目录',
    ok: detail === '',
    detail: detail || undefined,
  }
}

/** 启动函数的失败路径必须自己收尾。任何一条卡住，自检会在 15 秒时退出。 */
export async function collectEphemeralRedisSelfChecks(): Promise<EphemeralRedisSelfCheck[]> {
  const idempotent = assertCleanupIsIdempotent()
  const missing = await assertMissingBinaryFailsFast()
  const stubborn = await assertStopDoesNotWaitForever()
  const signal = await assertSignalCleanupStopsRedis()
  return [idempotent, missing, stubborn, signal]
}
