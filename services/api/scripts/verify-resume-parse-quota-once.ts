/**
 * resume_parse consumeOnce。隔离的本机 redis-server，不连生产。
 * 同意图回放不计第二次；超限在 Lua 内整单拒绝。marker 过期后不退回已计数。
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpException } from '@nestjs/common'
import { Redis } from 'ioredis'
import {
  AiPublicQuotaService,
  resumeParseQuotaCounterKey,
  resumeParseQuotaMarkerKey,
  type AiPublicQuotaContext,
} from '../src/ai/ai-public-quota.service'
import { resumeParseIntentId } from '../src/ai/resume-parse-intent'
import { resumeParseIntentTtlMs } from '../src/ai/resume-parse-submission.service'
import { RedisService } from '../src/common/redis/redis.service'

const DAY_ONE = new Date('2026-09-24T15:30:00.000Z')
const DAY_TWO = new Date('2026-09-24T16:30:00.000Z')

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function intent(): string {
  return resumeParseIntentId(randomBytes(32).toString('base64url'))
}

function limits(member: number, terminal: number, ip: number): void {
  process.env['AI_RESUME_PARSE_MEMBER_DAILY_LIMIT'] = String(member)
  process.env['AI_RESUME_PARSE_TERMINAL_DAILY_LIMIT'] = String(terminal)
  process.env['AI_RESUME_PARSE_IP_DAILY_LIMIT'] = String(ip)
}

async function expectStatus(run: () => Promise<unknown>, status: number, code: string): Promise<void> {
  try {
    await run()
    throw new Error(`expected ${status} ${code}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expected ')) throw error
    assert.ok(error instanceof HttpException)
    assert.equal(error.getStatus(), status)
    const body = error.getResponse() as { error?: { code?: string } }
    assert.equal(body.error?.code, code)
  }
}

interface IsolatedRedis {
  child: ChildProcess
  dir: string
  port: number
  stderr(): string
  exited(): { code: number | null; signal: NodeJS.Signals | null } | null
}

async function freePort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const opened = typeof address === 'object' && address ? address.port : 0
        server.close(() => resolve(opened))
      })
    })
    if (port !== 0 && port !== 6379) return port
  }
  throw new Error('no isolated redis port; refusing 6379')
}

function pingRedis(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, 200)
    const finish = (up: boolean) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(up)
    }
    socket.once('error', () => finish(false))
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'))
    socket.on('data', (data) => {
      if (data.toString().includes('+PONG')) finish(true)
    })
  })
}

function openRedis(port: number): Redis {
  if (port === 6379) throw new Error('refusing to connect to redis port 6379')
  const client = new Redis({
    host: '127.0.0.1',
    port,
    lazyConnect: true,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    reconnectOnError: () => false,
  })
  client.on('error', () => undefined)
  return client
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      resolve()
    }, 1_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function startRedis(port: number): Promise<IsolatedRedis> {
  if (port === 6379) throw new Error('refusing to start redis on port 6379')
  const dir = await mkdtemp(join(tmpdir(), 'resume-parse-quota-'))
  // Redis treats EOF on stdin as a reason to exit. stdio 'ignore' is /dev/null,
  // so the process can answer one PING and then shut down. Keep the pipe open.
  const child = spawn('redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--save', '',
    '--appendonly', 'no',
    '--daemonize', 'no',
    '--supervised', 'no',
    '--dir', dir,
    '--protected-mode', 'yes',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null
  child.stdout?.resume()
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2000)
  })
  child.stdin?.on('error', () => undefined)
  child.once('error', () => {
    exit = exit ?? { code: null, signal: null }
  })
  child.once('exit', (code, signal) => {
    exit = { code, signal }
  })
  try {
    const deadline = Date.now() + 8_000
    let up = false
    while (Date.now() < deadline && !exit) {
      if (await pingRedis(port)) {
        up = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!up || exit) {
      throw new Error(`redis-server failed to stay up port=${port} code=${exit?.code ?? 'none'} signal=${exit?.signal ?? 'none'} stderr=${stderr.trim()}`)
    }
    return { child, dir, port, stderr: () => stderr, exited: () => exit }
  } catch (error) {
    await stopChild(child)
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}

async function main(): Promise<void> {
  console.log('=== resume parse quota consumeOnce ===')
  const previousTtl = process.env['AI_RESUME_RESULT_TTL_HOURS']
  process.env['AI_RESUME_RESULT_TTL_HOURS'] = '24'
  limits(20, 120, 240)

  let calls = 0
  const untouched = new AiPublicQuotaService({
    async consumeQuotaOnce() {
      calls += 1
      return 'charged' as const
    },
  } as unknown as RedisService)
  await expectStatus(
    () => untouched.consumeOnce({ intentId: 'not-a-hash', markerTtlSeconds: 60, context: { member: 'm', terminal: null, ip: '203.0.113.1' } }),
    503,
    'AI_PUBLIC_QUOTA_UNAVAILABLE',
  )
  await expectStatus(
    () => untouched.consumeOnce({ intentId: intent(), markerTtlSeconds: 60, context: { member: null, terminal: null, ip: null } }),
    503,
    'AI_PUBLIC_QUOTA_UNAVAILABLE',
  )
  assert.equal(calls, 0)
  const down = new AiPublicQuotaService({
    async consumeQuotaOnce() {
      throw new Error('redis down')
    },
  } as unknown as RedisService)
  await expectStatus(
    () => down.consumeOnce({
      intentId: intent(),
      markerTtlSeconds: Math.ceil(resumeParseIntentTtlMs() / 1000),
      context: { member: 'm', terminal: null, ip: '203.0.113.2' },
    }),
    503,
    'AI_PUBLIC_QUOTA_UNAVAILABLE',
  )
  pass('invalid input and Redis errors fail closed before or without a partial charge')

  const port = await freePort()
  const runtime = await startRedis(port)
  const client = openRedis(runtime.port)
  const quota = new AiPublicQuotaService(new RedisService(client))
  const failIfRedisDied = () => {
    const exit = runtime.exited()
    if (!exit) return
    throw new Error(`redis-server exited code=${exit.code} signal=${exit.signal} stderr=${runtime.stderr().trim()}`)
  }
  const count = async (dimension: 'member' | 'terminal' | 'ip', value: string, now: Date) => {
    const raw = await client.get(resumeParseQuotaCounterKey(dimension, value, dayOf(now)))
    return raw === null ? 0 : Number(raw)
  }
  try {
    await client.connect()
    failIfRedisDied()
    limits(20, 120, 240)
    const shared = intent()
    const context: AiPublicQuotaContext = { member: 'member-a', terminal: 'term-a', ip: '203.0.113.10' }
    const raced = await Promise.all(Array.from({ length: 8 }, () => quota.consumeOnce({
      intentId: shared,
      markerTtlSeconds: 60,
      context,
      now: DAY_ONE,
    })))
    assert.equal(raced.filter((item) => item.outcome === 'charged').length, 1)
    assert.equal(raced.filter((item) => item.outcome === 'replay').length, 7)
    assert.equal(await count('member', 'member-a', DAY_ONE), 1)
    assert.equal(await count('ip', '203.0.113.10', DAY_ONE), 1)
    const markerTtl = await client.ttl(resumeParseQuotaMarkerKey(shared))
    assert.ok(markerTtl >= Math.ceil(resumeParseIntentTtlMs() / 1000) - 2)
    pass('eight concurrent calls with one intent charge once')

    await client.flushdb()
    limits(10, 120, 1)
    const first: AiPublicQuotaContext = { member: 'member-a', terminal: null, ip: '203.0.113.20' }
    const second: AiPublicQuotaContext = { member: 'member-b', terminal: null, ip: '203.0.113.20' }
    assert.equal((await quota.consumeOnce({ intentId: intent(), markerTtlSeconds: 60, context: first, now: DAY_ONE })).outcome, 'charged')
    await expectStatus(
      () => quota.consumeOnce({ intentId: intent(), markerTtlSeconds: 60, context: second, now: DAY_ONE }),
      429,
      'AI_PUBLIC_QUOTA_EXCEEDED',
    )
    assert.equal(await count('member', 'member-a', DAY_ONE), 1)
    assert.equal(await count('member', 'member-b', DAY_ONE), 0)
    assert.equal(await count('ip', '203.0.113.20', DAY_ONE), 1)
    pass('a second intent over the IP limit does not partially increment the member counter')

    await client.flushdb()
    limits(1, 120, 240)
    const [left, right] = await Promise.allSettled([
      quota.consumeOnce({ intentId: intent(), markerTtlSeconds: 60, context: { member: 'only', terminal: null, ip: null }, now: DAY_ONE }),
      quota.consumeOnce({ intentId: intent(), markerTtlSeconds: 60, context: { member: 'only', terminal: null, ip: null }, now: DAY_ONE }),
    ])
    const fulfilled = [left, right].filter((item): item is PromiseFulfilledResult<{ outcome: string }> => item.status === 'fulfilled')
    const rejected = [left, right].filter((item) => item.status === 'rejected')
    assert.equal(fulfilled.length, 1)
    assert.equal(fulfilled[0]?.value.outcome, 'charged')
    assert.equal(rejected.length, 1)
    assert.ok(rejected[0]?.status === 'rejected' && rejected[0].reason instanceof HttpException)
    assert.equal(rejected[0]?.status === 'rejected' ? rejected[0].reason.getStatus() : 0, 429)
    assert.equal(await count('member', 'only', DAY_ONE), 1)
    pass('two different intents at a limit of one produce a single charge')

    await client.flushdb()
    limits(5, 120, 240)
    const lasting = intent()
    const dayContext: AiPublicQuotaContext = { member: 'day-user', terminal: null, ip: '203.0.113.30' }
    const charged = await quota.consumeOnce({ intentId: lasting, markerTtlSeconds: 60, context: dayContext, now: DAY_ONE })
    const replayed = await quota.consumeOnce({ intentId: lasting, markerTtlSeconds: 60, context: dayContext, now: DAY_TWO })
    assert.equal(charged.outcome, 'charged')
    assert.equal(charged.day, '2026-09-24')
    assert.equal(replayed.outcome, 'replay')
    assert.equal(replayed.day, '2026-09-25')
    assert.equal(await client.get(resumeParseQuotaMarkerKey(lasting)), '2026-09-24')
    assert.equal(await count('member', 'day-user', DAY_ONE), 1)
    assert.equal(await count('member', 'day-user', DAY_TWO), 0)
    await client.del(resumeParseQuotaMarkerKey(lasting))
    const afterExpiry = await quota.consumeOnce({ intentId: lasting, markerTtlSeconds: 60, context: dayContext, now: DAY_TWO })
    assert.equal(afterExpiry.outcome, 'charged')
    assert.equal(await count('member', 'day-user', DAY_ONE), 1)
    assert.equal(await count('member', 'day-user', DAY_TWO), 1)
    pass('day rollover replays until the marker is gone, then charges the new day without refunding the old day')

    await client.flushdb()
    process.env['AI_RESUME_RESULT_TTL_HOURS'] = '72'
    const wide = intent()
    await quota.consumeOnce({
      intentId: wide,
      markerTtlSeconds: 1,
      context: { member: 'wide', terminal: null, ip: null },
      now: DAY_ONE,
    })
    const wideTtl = await client.ttl(resumeParseQuotaMarkerKey(wide))
    assert.ok(wideTtl >= Math.ceil(resumeParseIntentTtlMs() / 1000) - 2)
    pass('marker TTL stays at least the configured intent TTL')

    await client.flushdb()
    process.env['AI_RESUME_RESULT_TTL_HOURS'] = '24'
    limits(20, 120, 240)
    const legacyContext: AiPublicQuotaContext = { member: 'legacy', terminal: null, ip: '203.0.113.40' }
    const firstTicket = await quota.consume('resume_parse', legacyContext)
    const secondTicket = await quota.consume('resume_parse', legacyContext)
    assert.equal(await count('member', 'legacy', new Date()), 2)
    await quota.rollback(secondTicket)
    assert.equal(await count('member', 'legacy', new Date()), 1)
    assert.equal(firstTicket.keys.length > 0, true)
    const assistant = await quota.consume('assistant_chat', { member: 'chat', terminal: null, ip: null })
    assert.equal(assistant.keys.length, 1)
    pass('legacy consume and rollback still count every call and do not use the intent marker')
    failIfRedisDied()
  } catch (error) {
    const exit = runtime.exited()
    if (exit && error instanceof Error) {
      const detail = `redis-server exited code=${exit.code} signal=${exit.signal} stderr=${runtime.stderr().trim()}`
      if (!error.message.includes('redis-server exited')) error.message += ` | ${detail}`
    }
    throw error
  } finally {
    client.disconnect()
    await stopChild(runtime.child)
    await rm(runtime.dir, { recursive: true, force: true })
    if (previousTtl === undefined) delete process.env['AI_RESUME_RESULT_TTL_HOURS']
    else process.env['AI_RESUME_RESULT_TTL_HOURS'] = previousTtl
    delete process.env['AI_RESUME_PARSE_MEMBER_DAILY_LIMIT']
    delete process.env['AI_RESUME_PARSE_TERMINAL_DAILY_LIMIT']
    delete process.env['AI_RESUME_PARSE_IP_DAILY_LIMIT']
  }
  console.log('PASS resume parse quota consumeOnce')
}

function dayOf(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
