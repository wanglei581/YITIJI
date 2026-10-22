import 'reflect-metadata'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { PrismaService } from '../../src/prisma/prisma.service'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { registerProcessCleanup, startEphemeralRedis } from './ephemeral-redis-server'

const API_ROOT = resolve(__dirname, '../..')
const ENV_KEYS = ['NODE_ENV', 'DATABASE_URL', 'POSTGRES_URL', 'REDIS_URL', 'JWT_SECRET', 'SECRET_ENCRYPTION_KEY'] as const

/** Own loopback-only cluster; never accepts or reads an external connection URL. */
async function startFirstOrderPostgres() {
  const directory = mkdtempSync('/tmp/fo-pg-')
  const cluster = join(directory, 'data')
  let started = false, stopped = false
  const stop = () => {
    if (stopped) return
    if (started) {
      const result = spawnSync('pg_ctl', ['-D', cluster, '-m', 'immediate', '-w', '-t', '10', 'stop'], { encoding: 'utf8', timeout: 15_000 })
      if (result.status !== 0) throw new Error(`Fixture PostgreSQL stop failed; preserve owned cluster ${directory}`)
    }
    stopped = true
    rmSync(directory, { recursive: true, force: true })
  }
  registerProcessCleanup(stop)
  try {
    const socket = createServer()
    await new Promise<void>((yes, no) => { socket.once('error', no); socket.listen(0, '127.0.0.1', yes) })
    const address = socket.address()
    if (!address || typeof address === 'string') throw new Error('Fixture PostgreSQL port allocation failed')
    const port = address.port
    await new Promise<void>((yes, no) => socket.close((error) => error ? no(error) : yes()))
    if (Buffer.byteLength(join(directory, `.s.PGSQL.${port}`)) >= 80) throw new Error('Fixture PostgreSQL socket path too long')
    const init = spawnSync('initdb', ['-D', cluster, '--auth=trust', '--no-locale', '--encoding=UTF8'], { encoding: 'utf8', timeout: 30_000 })
    if (init.status !== 0) throw new Error(`Fixture initdb failed: ${(init.stderr + init.stdout).slice(-1500)}`)
    // pid/log/socket live only inside this owned short directory; no shared PG instance is touched.
    const run = spawnSync('pg_ctl', ['-D', cluster, '-l', join(directory, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory} -F`, '-w', '-t', '15', 'start'], { encoding: 'utf8', timeout: 20_000 })
    if (run.status !== 0) {
      // A startup timeout may leave a running postmaster, so stop by this exact cluster.
      started = existsSync(join(cluster, 'postmaster.pid'))
      throw new Error(`Fixture pg_ctl start failed: ${(run.stderr + run.stdout).slice(-1000)}`)
    }
    started = true
    return { url: `postgresql://${encodeURIComponent(userInfo().username)}@127.0.0.1:${port}/postgres`, stop }
  } catch (error) { stop(); throw error }
}

export interface FirstOrderFixture {
  app: INestApplication
  prisma: PrismaService
  base: string
  directory: string
  mode: 'sqlite' | 'postgres'
  users: { admin: string; partner: string; other: string; kiosk: string }
  tokens: { admin: string; partner: string; other: string; kiosk: string }
  orgs: { own: string; other: string }
  terminals: { monthly: string; spare: string; other: string; small: string }
  close(): Promise<void>
}

/** Real isolated SQLite + Redis + Nest/guards. Never reads .env or reuses caller databases. */
export async function createFirstOrderFixture(options: { mode?: 'sqlite' | 'postgres' } = {}): Promise<FirstOrderFixture> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing first-order fixture in production')
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  const directory = mkdtempSync(join(tmpdir(), 'first-order-http-'))
  const database = join(directory, 'fixture.db')
  const mode = options.mode ?? 'sqlite'
  const postgres = mode === 'postgres' ? await startFirstOrderPostgres().catch((error: unknown) => { rmSync(directory, { recursive: true, force: true }); throw error }) : undefined
  closeSync(openSync(database, 'a', 0o600))
  registerProcessCleanup(() => rmSync(directory, { recursive: true, force: true }))
  const redis = await startEphemeralRedis().catch((error: unknown) => {
    try { postgres?.stop() } finally { rmSync(directory, { recursive: true, force: true }) }
    throw error
  })
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = postgres?.url ?? `file:${database}`
  if (postgres) process.env.POSTGRES_URL = postgres.url
  else delete process.env.POSTGRES_URL
  process.env.REDIS_URL = redis.url
  process.env.JWT_SECRET = randomBytes(48).toString('hex')
  process.env.SECRET_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  let app: INestApplication | undefined
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    try { await app?.close() } finally {
      try { await redis.stop() } finally {
        try { postgres?.stop() } finally {
          rmSync(directory, { recursive: true, force: true })
          for (const key of ENV_KEYS) {
            if (saved[key] === undefined) delete process.env[key]
            else process.env[key] = saved[key]
          }
        }
      }
    }
  }
  try {
    const push = spawnSync(process.execPath, [join(API_ROOT, 'node_modules/prisma/build/index.js'), 'db', 'push', ...(postgres ? ['--config', 'prisma.postgres.config.ts'] : [])], {
      cwd: API_ROOT, env: { ...process.env, DOTENV_CONFIG_PATH: join(directory, 'no-dotenv') }, encoding: 'utf8', timeout: 60_000,
    })
    if (push.status !== 0) throw new Error(`Fixture schema push failed: ${(push.stderr + push.stdout).slice(-2000)}`)
    const { FirstOrderModule } = await import('../../src/first-order/first-order.module')
    const { OrgsModule } = await import('../../src/orgs/orgs.module')
    @Module({ imports: [FirstOrderModule, OrgsModule] })
    class FirstOrderVerificationModule {}
    app = await NestFactory.create(FirstOrderVerificationModule, { logger: ['error'], abortOnError: false })
    app.setGlobalPrefix('api/v1')
    app.enableCors({ origin: /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, credentials: true })
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const prisma = app.get(PrismaService)
    const nonce = randomUUID().slice(0, 8)
    const orgs = { own: `fo-own-${nonce}`, other: `fo-other-${nonce}` }
    for (const [key, id] of Object.entries(orgs)) {
      await prisma.organization.create({ data: { id, name: key === 'own' ? '首单验证机构' : '另一验证机构', type: 'public_employment_service', enabled: true, contentTrustStatus: 'active' } })
    }
    const users = { admin: `fo-admin-${nonce}`, partner: `fo-partner-${nonce}`, other: `fo-other-user-${nonce}`, kiosk: `fo-kiosk-${nonce}` }
    const tokens = {} as FirstOrderFixture['tokens']
    for (const key of ['admin', 'partner', 'other', 'kiosk'] as const) {
      const role = key === 'other' ? 'partner' : key
      const orgId = key === 'partner' ? orgs.own : key === 'other' ? orgs.other : null
      await prisma.user.create({ data: { id: users[key], username: users[key], name: users[key], role, orgId, enabled: true, tokenVersion: 0, passwordHash: 'fixture-not-a-login-password' } })
      tokens[key] = app.get(JwtService).sign({ sub: users[key], ver: 0, jti: randomUUID() })
    }
    const terminals = { monthly: `fo-monthly-${nonce}`, spare: `fo-spare-${nonce}`, other: `fo-other-device-${nonce}`, small: `fo-small-${nonce}` }
    for (const [key, id] of Object.entries(terminals)) {
      await prisma.terminal.create({ data: {
        id, terminalCode: id.toUpperCase(), agentToken: randomBytes(32).toString('hex'), deviceFingerprint: id,
        orgId: key === 'other' ? orgs.other : orgs.own, orgBoundAt: new Date('2026-01-01T00:00:00Z'),
        enabled: true, lifecycleStatus: 'active', displayName: `${key}验证终端`, locationLabel: '验证大厅', lastHeartbeatAt: new Date(),
      } })
    }
    return { app, prisma, directory, mode, base: `${await app.getUrl()}/api/v1`, users, tokens, orgs, terminals, close }
  } catch (error) { await close(); throw error }
}

export function previousMonth(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600_000)
  const from = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1) - 8 * 3600_000)
  const to = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 8 * 3600_000)
  const month = new Date(from.getTime() + 8 * 3600_000).toISOString().slice(0, 7)
  return { from, to, month }
}

/** Synthetic task/result records exercise aggregation, never establish real-device output. */
export async function seedFirstOrderMonth(f: FirstOrderFixture, small = false) {
  const { prisma } = f
  const { from, to, month } = previousMonth()
  const terminalId = small ? f.terminals.small : f.terminals.monthly
  const project = await prisma.serviceProject.create({ data: {
    orgId: f.orgs.own, name: small ? '小样本验证项目' : '自然月验证项目', reference: small ? `SMALL-${randomUUID()}` : `=SUM(1,2)-${randomUUID()}`,
    serviceStartAt: new Date(from.getTime() - 86_400_000), serviceEndAt: new Date(Date.now() + 365 * 86_400_000),
    serviceScope: '免费打印与年度技术服务；验证数据', supportContact: '平台验证服务窗口',
  } })
  const deployment = await prisma.serviceDeployment.create({ data: {
    orgId: f.orgs.own, projectId: project.id, terminalId, activeTerminalId: terminalId,
    terminalCode: terminalId.toUpperCase(), locationLabel: '验证大厅', startedAt: new Date(from.getTime() - 86_400_000),
  } })
  const count = small ? 1 : 10
  for (let i = 0; i < count; i++) await prisma.kioskSession.create({ data: {
    terminalId, orgId: f.orgs.own, clientSessionId: randomUUID(), startedAt: new Date(from.getTime() + i * 60_000),
    lastActiveAt: new Date(from.getTime() + i * 60_000), expiresAt: to,
  } })
  if (!small) for (const startedAt of [new Date(from.getTime() - 1), to]) await prisma.kioskSession.create({ data: {
    terminalId, orgId: f.orgs.own, clientSessionId: randomUUID(), startedAt, lastActiveAt: startedAt, expiresAt: new Date(to.getTime() + 60_000),
  } })
  for (const type of small ? ['printed'] : ['printed', 'unconfirmed', 'failed']) {
    for (let i = 0; i < (small ? 1 : 5); i++) {
      const id = randomUUID()
      await prisma.printTask.create({ data: {
        id, terminalId, fileUrl: 'https://fixture.invalid/PRIVATE_RESUME_BODY.pdf', fileMd5: 'a'.repeat(32), paramsJson: '{"copies":2}',
        createdAt: new Date(from.getTime() - 1000), completedAt: new Date(from.getTime() + i * 60_000),
        status: type === 'printed' ? 'completed' : 'failed', errorCode: type === 'unconfirmed' ? 'PRINT_JOB_UNCONFIRMED' : null,
      } })
      await prisma.order.create({ data: { orderNo: `FO-${id}`, printTaskId: id, terminalId, billablePages: 2, sourceFileName: 'PRIVATE_RESUME_BODY.pdf', paymentSource: 'free', amountCents: 0, payStatus: 'paid' } })
    }
  }
  for (const createdAt of [new Date(from.getTime() - 60_000), new Date(from.getTime() + 60_000), new Date(to.getTime() - 60_000)]) {
    await prisma.terminalHeartbeat.create({ data: { terminalId, createdAt, printerStatus: 'ready' } })
  }
  return { project, deployment, from, to, month }
}

if (require.main === module) {
  void (async () => {
    const fixture = await createFirstOrderFixture({ mode: process.argv.includes('--postgres') ? 'postgres' : 'sqlite' })
    const seeded = await seedFirstOrderMonth(fixture)
    const descriptor = join(fixture.directory, 'browser-fixture.json')
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, base: fixture.base, tokens: fixture.tokens, users: fixture.users, orgs: fixture.orgs, terminals: fixture.terminals, month: seeded.month, projectId: seeded.project.id }), { mode: 0o600 })
    console.log(`First-order fixture ready; private descriptor: ${descriptor}`)
    const close = async () => { await fixture.close(); process.exit(0) }
    process.once('SIGINT', () => void close())
    process.once('SIGTERM', () => void close())
  })().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
}
