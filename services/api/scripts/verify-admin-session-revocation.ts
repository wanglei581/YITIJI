/**
 * verify:admin-session-revocation
 *
 * 管理员与合作机构账号的登录凭证必须能当场作废：
 * 退出只撤销当前 jti；改密、停用、删除、以及带 tokenVersion 递增的角色变更
 * 让该账号已发出的凭证立刻 401。Redis 连不上时回源数据库，不停用放行。
 *
 * 不新建会话表。退出名单只活在 Redis 里，TTL 为该 JWT 剩余寿命；
 * Redis 挂了之后，已经退出的 jti 在过期前会重新可用，停用和版本变化仍由数据库拦住。
 * 当前没有「改角色」的 HTTP 写路径，角色用例按将来写路径必须遵守的三件事模拟：
 * 改 role、tokenVersion + 1、删掉 internal:session-state。
 * 删除机构账号的 HTTP 要动作票据，这里用与 deleteAccount 相同的墓碑字段落库。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Redis } from 'ioredis'
import * as bcrypt from 'bcryptjs'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { registerProcessCleanup, startEphemeralRedis, type EphemeralRedis } from './support/ephemeral-redis-server'
import { bootApp, probe, unusedLoopbackPort, type BootedApp, type HttpProbeResult } from './support/boot-api-child'
import { deadRedisGateEnv } from './support/dead-redis-gate-env'
import { PASSWORD_PROOF_STATE } from '../src/auth/password-proof-state'

const apiRoot = join(import.meta.dirname, '..')
const PASSWORD = 'Qingdao-Ops-2026!'
const NEXT_PASSWORD = 'Lichang-Ops-2026!'
const RESET_PASSWORD = 'Chengyang-Reset-2026!'
const INVALID_MESSAGE = '登录已失效，请重新登录'

let failures = 0
let checks = 0
let loginSourceSeq = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

function errorCode(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const error = (body as { error?: { code?: unknown } }).error
  return typeof error?.code === 'string' ? error.code : ''
}

function errorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const error = (body as { error?: { message?: unknown } }).error
  return typeof error?.message === 'string' ? error.message : ''
}

function tokenOf(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const token = (body as { data?: { token?: unknown } }).data?.token
  return typeof token === 'string' ? token : ''
}

function payloadOf(token: string): { jti?: string; ver?: number } {
  const part = token.split('.')[1] ?? ''
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { jti?: string; ver?: number }
}

function describe(result: HttpProbeResult): string {
  return `HTTP ${result.status} ${errorCode(result.body)} ${errorMessage(result.body)} ${result.raw.slice(0, 240)}`
}

function isPostSuccess(status: number): boolean {
  return status === 200 || status === 201
}

function rejected(result: HttpProbeResult): boolean {
  return result.status === 401
    && errorCode(result.body) === 'AUTH_TOKEN_INVALID'
    && errorMessage(result.body) === INVALID_MESSAGE
}

interface IsolatedDatabase {
  databasePath: string
  databaseUrl: string
  cleanup: () => void
}

function prismaCli(): string {
  const candidates = [
    join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    join(apiRoot, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`找不到 Prisma CLI：${candidates.join(' , ')}`)
  return found
}

function deployIsolatedSqlite(): IsolatedDatabase {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  const directory = mkdtempSync(join(tmpdir(), 'verify-admin-session-revocation-'))
  const databasePath = join(directory, 'verify.db')
  closeSync(openSync(databasePath, 'a'))
  const databaseUrl = `file:${databasePath}`
  const cleanup = (): void => { rmSync(directory, { recursive: true, force: true }) }
  registerProcessCleanup(cleanup)
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  try {
    assertIsolatedVerificationDatabase()
    execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    cleanup()
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`隔离库准备失败：${(err.stderr || err.stdout || err.message || '').trim()}`)
  }
  return { databasePath, databaseUrl, cleanup }
}

async function bootApi(env: Record<string, string>): Promise<BootedApp> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const app = await bootApp(env, 120_000)
    if (app.port < 4100 || app.port > 4199) return app
    await app.stop()
  }
  throw new Error('API 端口连续落在 4100-4199，本门禁不占用这段端口')
}

function login(port: number, loginId: string, password: string, portal: 'admin' | 'partner'): Promise<HttpProbeResult> {
  loginSourceSeq += 1
  return probe(port, '/auth/login', {
    method: 'POST',
    body: { loginId, password, portal },
    timeoutMs: 20_000,
    headers: { 'X-Forwarded-For': `198.51.100.${loginSourceSeq}` },
  })
}

async function session(port: number, loginId: string, password: string, portal: 'admin' | 'partner'): Promise<string> {
  const result = await login(port, loginId, password, portal)
  const token = tokenOf(result.body)
  check(`${loginId} 登录拿到凭证`, isPostSuccess(result.status) && token.length > 0, describe(result))
  return token
}

function call(port: number, path: string, token: string, method = 'GET', body?: unknown): Promise<HttpProbeResult> {
  return probe(port, path, { method, token, body, timeoutMs: 20_000 })
}

function finish(code: number): void {
  console.log(`\nverify:admin-session-revocation：${checks - failures}/${checks} 通过`)
  if (code !== 0) console.error(`❌ ${failures} 项失败`)
  else console.log('✅ 全部通过')
  process.exit(code)
}

function cacheStillAllows(raw: string | null, oldVersion: number): boolean {
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as { enabled?: boolean; tokenVersion?: number }
    return parsed.enabled === true && parsed.tokenVersion === oldVersion
  } catch {
    return true
  }
}

async function main(): Promise<void> {
  console.log('=== 管理员 / 合作机构登录凭证即时失效 verify:admin-session-revocation ===')
  if (!process.env['JWT_SECRET'] || process.env['JWT_SECRET'].length < 16) {
    process.env['JWT_SECRET'] = 'verify-admin-session-revocation-secret'
  }
  const database = deployIsolatedSqlite()
  const sharedDevDb = resolve(apiRoot, 'prisma', 'dev.db')
  const inherited = process.env['DATABASE_URL'] ?? ''
  check(
    '用的是独立临时库，不是 prisma/dev.db',
    resolve(database.databasePath) !== sharedDevDb && !inherited.includes(`${isAbsolute(sharedDevDb) ? sharedDevDb : 'dev.db'}`),
    database.databasePath,
  )

  const suffix = Date.now().toString(36)
  const ids = {
    shinan: `vasr-shinan-${suffix}`,
    licang: `vasr-licang-${suffix}`,
    shibei: `vasr-shibei-${suffix}`,
    huangdao: `vasr-huangdao-${suffix}`,
    jimo: `vasr-jimo-${suffix}`,
    laoshanOrg: `vasr-laoshan-org-${suffix}`,
    laoshan: `vasr-laoshan-${suffix}`,
    chengyangOrg: `vasr-chengyang-org-${suffix}`,
    chengyang: `vasr-chengyang-${suffix}`,
  }
  const names = {
    shinan: '市南区运营主管',
    licang: '李沧区运营主管',
    shibei: '市北区运营主管',
    huangdao: '黄岛区运营主管',
    jimo: '即墨区运营主管',
    laoshan: '崂山区就业服务站',
    chengyang: '城阳区就业服务站',
  }

  let redisServer: EphemeralRedis | null = null
  let inspector: Redis | null = null
  let app: BootedApp | null = null
  let deadApp: BootedApp | null = null
  let prisma: InstanceType<typeof import('../src/prisma/prisma.service').PrismaService> | null = null

  registerProcessCleanup(() => {
    for (const child of [app?.child, deadApp?.child]) {
      if (child && child.exitCode === null && typeof child.pid === 'number') {
        try { child.kill('SIGKILL') } catch { /* 子进程已经没了 */ }
      }
    }
  })

  try {
    redisServer = await startEphemeralRedis()
    inspector = new Redis(redisServer.url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: true })
    inspector.on('error', () => { /* 由下面的断言表现 */ })
    await inspector.connect()
    check('临时 Redis 可 PING', (await inspector.ping()) === 'PONG')

    const { PrismaService } = await import('../src/prisma/prisma.service')
    const { internalSessionRevokedKey } = await import('../src/common/auth/internal-session-revocation')
    prisma = new PrismaService()
    await prisma.onModuleInit()
    const passwordHash = await bcrypt.hash(PASSWORD, 10)
    await prisma.organization.create({ data: { id: ids.laoshanOrg, name: names.laoshan, type: 'school', enabled: true } })
    await prisma.organization.create({ data: { id: ids.chengyangOrg, name: names.chengyang, type: 'school', enabled: true } })
    const admin = (id: string, name: string) => ({
      id, username: name, passwordHash, passwordProofState: PASSWORD_PROOF_STATE.OWNER_MANAGED,
      name, role: 'admin', tokenVersion: 0, enabled: true,
    })
    await prisma.user.createMany({
      data: [
        admin(ids.shinan, names.shinan),
        admin(ids.licang, names.licang),
        admin(ids.shibei, names.shibei),
        admin(ids.huangdao, names.huangdao),
        admin(ids.jimo, names.jimo),
        {
          id: ids.laoshan, username: names.laoshan, passwordHash, passwordProofState: PASSWORD_PROOF_STATE.OWNER_MANAGED,
          name: names.laoshan, role: 'partner', orgId: ids.laoshanOrg, tokenVersion: 0, enabled: true,
        },
        {
          id: ids.chengyang, username: names.chengyang, passwordHash, passwordProofState: PASSWORD_PROOF_STATE.OWNER_MANAGED,
          name: names.chengyang, role: 'partner', orgId: ids.chengyangOrg, tokenVersion: 0, enabled: true,
        },
      ],
    })

    const bootEnv = {
      REDIS_URL: redisServer.url,
      DATABASE_URL: database.databaseUrl,
      VERIFICATION_DATABASE_TARGET: 'isolated',
      ADMIN_LOGIN_SECOND_FACTOR: 'off',
      ADMIN_IP_ALLOWLIST: '',
      TRUST_PROXY_HOPS: '1',
    }
    app = await bootApi(bootEnv)
    check('真实 src/main.ts 已监听', app.listening, app.listening ? '' : app.output().slice(-800))
    if (app.listening) {

    const shinanA = await session(app.port, names.shinan, PASSWORD, 'admin')
    const shinanB = await session(app.port, names.shinan, PASSWORD, 'admin')
    const jtiA = payloadOf(shinanA).jti ?? ''
    const jtiB = payloadOf(shinanB).jti ?? ''
    check('两次登录的 jti 不同且不可猜', jtiA.length >= 16 && jtiB.length >= 16 && jtiA !== jtiB, `${jtiA} / ${jtiB}`)

    const logout = await call(app.port, '/auth/logout', shinanA, 'POST')
    const loggedOut = (logout.body as { data?: { loggedOut?: unknown } } | null)?.data?.loggedOut === true
    check('市南区运营主管退出当前会话', logout.status === 200 && loggedOut, describe(logout))
    const revoked = await inspector.get(internalSessionRevokedKey(jtiA))
    const revokedTtl = await inspector.ttl(internalSessionRevokedKey(jtiA))
    check('退出把当前 jti 写入 Redis，TTL 不超过 24 小时', revoked === ids.shinan && revokedTtl > 0 && revokedTtl <= 24 * 60 * 60,
      `value=${revoked ?? '无'} ttl=${revokedTtl}`)
    check('另一会话的 jti 没有被撤销', (await inspector.get(internalSessionRevokedKey(jtiB))) === null)
    const afterLogout = await call(app.port, '/admin/orgs', shinanA)
    const otherSession = await call(app.port, '/admin/orgs', shinanB)
    check('退出后的凭证访问管理员接口 401', rejected(afterLogout), describe(afterLogout))
    check('另一会话仍可访问管理员接口', otherSession.status === 200, describe(otherSession))
    const logoutAudit = await prisma.auditLog.findFirst({ where: { actorId: ids.shinan, action: 'auth.logout' } })
    check('退出写入审计 auth.logout', logoutAudit !== null)

    const licang = await session(app.port, names.licang, PASSWORD, 'admin')
    const licangVersion = (await prisma.user.findUniqueOrThrow({ where: { id: ids.licang }, select: { tokenVersion: true } })).tokenVersion
    const changed = await call(app.port, '/auth/password/change', licang, 'POST', {
      currentPassword: PASSWORD, newPassword: NEXT_PASSWORD,
    })
    const changedData = (changed.body as { data?: { success?: unknown; token?: unknown } } | null)?.data
    check('自己改密只返回成功，不签发新凭证', isPostSuccess(changed.status) && changedData?.success === true && changedData.token === undefined,
      describe(changed))
    const licangNow = await prisma.user.findUniqueOrThrow({ where: { id: ids.licang }, select: { tokenVersion: true } })
    check('自己改密递增 tokenVersion', licangNow.tokenVersion === licangVersion + 1, `实际 ${licangNow.tokenVersion}`)
    const licangStale = await call(app.port, '/admin/orgs', licang)
    check('改密前的凭证立刻 401', rejected(licangStale), describe(licangStale))
    const licangNext = await session(app.port, names.licang, NEXT_PASSWORD, 'admin')
    check('新密码重新登录后可用', (await call(app.port, '/admin/orgs', licangNext)).status === 200)

    const shibeiA = await session(app.port, names.shibei, PASSWORD, 'admin')
    const shibeiB = await session(app.port, names.shibei, PASSWORD, 'admin')
    const shibeiBefore = (await prisma.user.findUniqueOrThrow({ where: { id: ids.shibei }, select: { tokenVersion: true } })).tokenVersion
    const disabled = await call(app.port, `/admin/internal-accounts/${ids.shibei}/status`, shinanB, 'PATCH', {
      action: 'disable', reason: '暂停使用', adminCurrentPassword: PASSWORD,
    })
    check('管理员停用市北区运营主管', disabled.status === 200, describe(disabled))
    const shibeiRow = await prisma.user.findUniqueOrThrow({ where: { id: ids.shibei }, select: { tokenVersion: true, enabled: true } })
    const shibeiCache = await inspector.get(`internal:session-state:${ids.shibei}`)
    check('停用后数据库 tokenVersion 立刻加一', shibeiRow.enabled === false && shibeiRow.tokenVersion === shibeiBefore + 1,
      `enabled=${shibeiRow.enabled} version=${shibeiRow.tokenVersion}`)
    check('停用写路径没有留下旧版本的可用缓存', !cacheStillAllows(shibeiCache, shibeiBefore), shibeiCache ?? '键已删除')
    const shibeiDeniedA = await call(app.port, '/admin/orgs', shibeiA)
    const shibeiDeniedB = await call(app.port, '/admin/orgs', shibeiB)
    check('停用后该账号两张凭证立刻 401', rejected(shibeiDeniedA) && rejected(shibeiDeniedB),
      `${describe(shibeiDeniedA)} | ${describe(shibeiDeniedB)}`)
    const enabled = await call(app.port, `/admin/internal-accounts/${ids.shibei}/status`, shinanB, 'PATCH', {
      action: 'enable', reason: '恢复使用', adminCurrentPassword: PASSWORD,
    })
    check('重新启用市北区运营主管', enabled.status === 200, describe(enabled))
    const shibeiAfterEnableA = await call(app.port, '/admin/orgs', shibeiA)
    const shibeiAfterEnableB = await call(app.port, '/admin/orgs', shibeiB)
    check('重新启用后旧凭证仍 401', rejected(shibeiAfterEnableA) && rejected(shibeiAfterEnableB),
      `${describe(shibeiAfterEnableA)} | ${describe(shibeiAfterEnableB)}`)
    const shibeiFresh = await session(app.port, names.shibei, PASSWORD, 'admin')
    check('重新登录后新凭证可用', (await call(app.port, '/admin/orgs', shibeiFresh)).status === 200)

    const laoshanA = await session(app.port, names.laoshan, PASSWORD, 'partner')
    const laoshanB = await session(app.port, names.laoshan, PASSWORD, 'partner')
    const laoshanLogout = await call(app.port, '/auth/logout', laoshanA, 'POST')
    check('崂山区就业服务站退出当前会话', laoshanLogout.status === 200, describe(laoshanLogout))
    check('合作机构退出后的凭证 401', rejected(await call(app.port, '/auth/me', laoshanA)), '')
    check('合作机构另一会话不受影响', (await call(app.port, '/auth/me', laoshanB)).status === 200)
    const laoshanBefore = (await prisma.user.findUniqueOrThrow({ where: { id: ids.laoshan }, select: { tokenVersion: true } })).tokenVersion
    const partnerDisabled = await call(app.port, `/admin/orgs/${ids.laoshanOrg}/accounts/${ids.laoshan}/status`, shinanB, 'PATCH', {
      action: 'disable',
    })
    check('管理员停用崂山区就业服务站', partnerDisabled.status === 200, describe(partnerDisabled))
    const laoshanRow = await prisma.user.findUniqueOrThrow({ where: { id: ids.laoshan }, select: { tokenVersion: true, enabled: true } })
    const laoshanCache = await inspector.get(`internal:session-state:${ids.laoshan}`)
    check('合作机构停用后 tokenVersion 加一且缓存不是旧的可用快照',
      laoshanRow.enabled === false && laoshanRow.tokenVersion === laoshanBefore + 1 && !cacheStillAllows(laoshanCache, laoshanBefore),
      `version=${laoshanRow.tokenVersion} cache=${laoshanCache ?? '无'}`)
    check('合作机构停用后剩余凭证立刻 401', rejected(await call(app.port, '/auth/me', laoshanB)))
    const partnerEnabled = await call(app.port, `/admin/orgs/${ids.laoshanOrg}/accounts/${ids.laoshan}/status`, shinanB, 'PATCH', {
      action: 'enable',
    })
    check('重新启用崂山区就业服务站', partnerEnabled.status === 200, describe(partnerEnabled))
    check('重新启用后旧凭证仍 401', rejected(await call(app.port, '/auth/me', laoshanB)))
    const laoshanFresh = await session(app.port, names.laoshan, PASSWORD, 'partner')
    check('合作机构重新登录可用', (await call(app.port, '/auth/me', laoshanFresh)).status === 200)

    const chengyang = await session(app.port, names.chengyang, PASSWORD, 'partner')
    const reset = await call(app.port, `/admin/orgs/${ids.chengyangOrg}/accounts/${ids.chengyang}/password`, shinanB, 'PATCH', {
      password: RESET_PASSWORD,
    })
    check('管理员重置城阳区就业服务站密码', isPostSuccess(reset.status), describe(reset))
    check('重置密码后旧凭证 401', rejected(await call(app.port, '/auth/me', chengyang)))
    const chengyangNext = await session(app.port, names.chengyang, RESET_PASSWORD, 'partner')
    check('重置后的新密码可以登录', (await call(app.port, '/auth/me', chengyangNext)).status === 200)
    await prisma.user.update({
      where: { id: ids.chengyang },
      data: {
        deletedAt: new Date(),
        enabled: false,
        tokenVersion: { increment: 1 },
        username: `deleted:${ids.chengyang}`,
        name: '已移除账号',
      },
    })
    await inspector.del(`internal:session-state:${ids.chengyang}`)
    check('删除账号后旧凭证 401', rejected(await call(app.port, '/auth/me', chengyangNext)))
    const deleteSource = readFileSync(join(apiRoot, 'src/orgs/admin-orgs.service.ts'), 'utf8')
    const deleteBody = deleteSource.slice(deleteSource.indexOf('async deleteAccount('), deleteSource.indexOf('private async withSerializableRetry'))
    check('删除机构账号的 HTTP 写路径本身递增 tokenVersion', deleteBody.includes('tokenVersion: { increment: 1 }'))

    const huangdao = await session(app.port, names.huangdao, PASSWORD, 'admin')
    const huangdaoBefore = (await prisma.user.findUniqueOrThrow({ where: { id: ids.huangdao }, select: { tokenVersion: true } })).tokenVersion
    await prisma.user.update({
      where: { id: ids.huangdao },
      data: { role: 'kiosk', tokenVersion: { increment: 1 } },
    })
    await inspector.del(`internal:session-state:${ids.huangdao}`)
    const huangdaoRow = await prisma.user.findUniqueOrThrow({ where: { id: ids.huangdao }, select: { role: true, tokenVersion: true } })
    check('角色变更同时递增 tokenVersion', huangdaoRow.role === 'kiosk' && huangdaoRow.tokenVersion === huangdaoBefore + 1)
    check('角色变更后旧凭证 401', rejected(await call(app.port, '/admin/orgs', huangdao)))

    const jimo = await session(app.port, names.jimo, PASSWORD, 'admin')
    const jimoDisabled = await call(app.port, `/admin/internal-accounts/${ids.jimo}/status`, shinanB, 'PATCH', {
      action: 'disable', reason: '暂停使用', adminCurrentPassword: PASSWORD,
    })
    check('停用即墨区运营主管并保持停用', jimoDisabled.status === 200, describe(jimoDisabled))

    await app.stop()
    app = null
    const deadPort = await unusedLoopbackPort()
    deadApp = await bootApi({
      ...deadRedisGateEnv(`redis://127.0.0.1:${deadPort}`),
      DATABASE_URL: database.databaseUrl,
      VERIFICATION_DATABASE_TARGET: 'isolated',
      ADMIN_LOGIN_SECOND_FACTOR: 'off',
      ADMIN_IP_ALLOWLIST: '',
      TRUST_PROXY_HOPS: '1',
    })
    check('Redis 不可用时的真实入口已监听', deadApp.listening, deadApp.listening ? '' : deadApp.output().slice(-800))
    if (deadApp.listening) {
      const aliveOnDeadRedis = await call(deadApp.port, '/admin/orgs', shinanB)
      const changedOnDeadRedis = await call(deadApp.port, '/admin/orgs', licang)
      const disabledOnDeadRedis = await call(deadApp.port, '/admin/orgs', jimo)
      check('Redis 不可用时仍有效的凭证继续放行', aliveOnDeadRedis.status === 200, describe(aliveOnDeadRedis))
      check('Redis 不可用时改密前的旧凭证仍 401', rejected(changedOnDeadRedis), describe(changedOnDeadRedis))
      check('Redis 不可用时已停用账号仍 401', rejected(disabledOnDeadRedis), describe(disabledOnDeadRedis))
    }
    }
  } finally {
    await deadApp?.stop()
    await app?.stop()
    if (inspector) await inspector.quit().catch(() => undefined)
    await redisServer?.stop()
    await prisma?.onModuleDestroy().catch(() => undefined)
    database.cleanup()
  }
  finish(failures > 0 ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  finish(1)
})
