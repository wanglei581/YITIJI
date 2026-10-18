/**
 * FLOW1c 同设备恢复凭证 — 后端端到端验证
 *
 * 前置：真实 Redis + 一个可写的 SQLite 库（DATABASE_URL），与 verify-member-auth 相同；
 * 另需 JWT_SECRET(>=16) / SECRET_ENCRYPTION_KEY(>=32) / WECHAT_MINIAPP_APPID（任意测试值即可，用来拼小程序 Referer）。
 * 本机联调时请用单独端口的 Redis 和单独的 SQLite 文件，不要连别的会话在用的库。
 *
 * 运行（services/api/）：pnpm verify:member-restore
 *
 * 验证（真实 HTTP + 直调服务）：
 *   0. 新签发开关 MEMBER_RESTORE_ISSUANCE_ENABLED：不设即关，只认 true / 1 / on；关着时登录回包没有 restoreToken 这个键
 *   1. 签发条件（开关打开时）：要的请求头 + 不带终端头 + 本小程序 Referer 才签；缺任何一条不签；开发者工具的 Referer 也签
 *   2. 访问令牌仍是 30 分钟；恢复后新令牌能访问 /me，仍是同一位会员
 *   3. 换新：首次使用换出新凭证；宽限期内再用上一枚返回同一个后继（幂等，并发两次也一样）
 *   4. 旧凭证再现（后继已用过、或宽限期已过、或隔了几轮）：整组作废，之后当前那一枚也无效
 *   5. 期限：未使用期限、绝对期限到了无效
 *   6. 撤销：主动退出作废这一组；整户作废（换绑手机）；注销流程作废
 *   7. 账号停用：回 ACCOUNT_UNAVAILABLE 并作废；停用后又启用：签发在前的凭证无效，必须重新认证
 *   8. 接口：恢复只认本小程序 Referer；格式不对 400；作废接口幂等
 *   9. 关掉开关只停新签发：已签出的凭证照常恢复、换新、作废；关掉后新的显式登录不签
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { NestFactory } from '@nestjs/core'
import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Redis } from 'ioredis'
import { AppModule } from '../src/app.module'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { REDIS_CLIENT, RedisService } from '../src/common/redis/redis.service'
import { hashPhone } from '../src/common/crypto/phone-identity'
import { MemberRestoreService } from '../src/member-auth/member-restore.service'
import { MemberClosureRedisService } from '../src/member-privacy/member-closure-redis.service'
import { PrismaService } from '../src/prisma/prisma.service'

let failures = 0
function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); failures += 1 }
function check(cond: boolean, msg: string) { if (cond) pass(msg); else fail(msg) }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property
    if (e.constraints) out.push(...Object.values(e.constraints).map((m) => `${path}: ${m}`))
    if (e.children?.length) out.push(...flatten(e.children, path))
  }
  return out
}

interface Json { [k: string]: unknown }
const data = (json: Json) => (json['data'] ?? {}) as Json
const errorCode = (error: unknown): string | undefined =>
  ((error as { getResponse?: () => unknown }).getResponse?.() as { error?: { code?: string } } | undefined)?.error?.code

function jwtPayload(token: string): { sub?: string; exp?: number; iat?: number } {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
}

async function main() {
  console.log('\n=== FLOW1c 同设备恢复凭证 — 后端 E2E ===')
  // CI 不配小程序 appid：用一个测试值拼 Referer。控制器在每次请求时才读这个变量。
  if (!process.env['WECHAT_MINIAPP_APPID']) process.env['WECHAT_MINIAPP_APPID'] = 'wxverifyrestore0001'
  const appid = process.env['WECHAT_MINIAPP_APPID'] ?? ''
  if ((process.env['JWT_SECRET'] ?? '').length < 16) { fail('JWT_SECRET 缺失或 <16'); process.exit(1) }
  if ((process.env['SECRET_ENCRYPTION_KEY'] ?? '').length < 32) { fail('SECRET_ENCRYPTION_KEY 缺失或 <32'); process.exit(1) }
  if (!process.env['REDIS_URL'] || !appid) { fail('REDIS_URL / WECHAT_MINIAPP_APPID 未设置'); process.exit(1) }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error'] })
  app.set('trust proxy', 'loopback')
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: flatten(errors)[0] ?? '请求参数校验失败' },
    }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0)
  const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1/member`
  const redis = app.get(RedisService)
  const rawRedis = app.get<Redis>(REDIS_CLIENT)
  const prisma = app.get(PrismaService)
  const restore = app.get(MemberRestoreService)
  const closure = app.get(MemberClosureRedisService)

  const MINIAPP_REFERER = `https://servicewechat.com/${appid}/3/page-frame.html`
  const DEVTOOLS_REFERER = `https://servicewechat.com/${appid}/devtools/page-frame.html`
  // 每个请求换一个测试 IP：登录与恢复接口都有每分钟 10 次的按 IP 限流，本脚本要连续登录二十多次。
  const freshIp = () => { const n = randomBytes(3); return { 'x-forwarded-for': `10.${n[0]}.${n[1]}.${n[2]}` } }
  const tail = Date.now().toString().slice(-8)
  const PHONE = `137${tail}`
  const phoneHash = hashPhone(PHONE)

  async function call(path: string, body: Json, headers: Record<string, string> = {}, token?: string) {
    const res = await fetch(`${base}${path}`, {
      method: path === '/me' ? 'GET' : 'POST',
      headers: {
        ...(path === '/me' ? {} : { 'Content-Type': 'application/json' }),
        ...freshIp(),
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(path === '/me' ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json }
  }

  /** 发一次验证码并登录。headers 决定是否申请恢复凭证。 */
  async function smsLogin(headers: Record<string, string>) {
    await redis.del(`member:sms:cooldown:${phoneHash}`)
    const code = String(100000 + (randomBytes(2).readUInt16BE(0) % 899999))
    await redis.setEx(`member:sms:code:${phoneHash}`, 300, code)
    return call('/auth/login', {
      phone: PHONE, code, termsVersion: 'draft-pending-legal-review', privacyVersion: 'draft-pending-legal-review',
    }, headers)
  }

  async function expectCode(fn: () => Promise<unknown>, code: string, label: string) {
    try {
      await fn()
      fail(`${label}（期望 ${code}，实际成功）`)
    } catch (error) {
      check(errorCode(error) === code, `${label}（${errorCode(error) ?? 'unknown'}）`)
    }
  }

  try {
    await prisma.endUser.deleteMany({ where: { phoneHash } })
    const KEEP = { 'x-member-keep-signed-in': '1', Referer: MINIAPP_REFERER }

    console.log('── 0. 新签发开关：不设即关，只认 true / 1 / on ─────────────')
    // 外面带进来的值不算数，先清掉，验证「不设」就是关。控制器每次请求现读这个变量。
    delete process.env['MEMBER_RESTORE_ISSUANCE_ENABLED']
    const unset = await smsLogin(KEEP)
    check(unset.status < 300 && typeof data(unset.json)['token'] === 'string', '开关不设：登录照常，拿到访问令牌')
    check(!('restoreToken' in data(unset.json)), '开关不设：不附带恢复凭证，回包里没有 restoreToken 这个键（结构与没有恢复功能的旧版兼容）')
    for (const value of ['off', 'false', '0', 'yes', 'enabled', '', ' ']) {
      process.env['MEMBER_RESTORE_ISSUANCE_ENABLED'] = value
      const res = await smsLogin(KEEP)
      check(res.status < 300 && !('restoreToken' in data(res.json)), `开关为 ${JSON.stringify(value)}：登录照常，不签发`)
    }
    for (const value of ['true', '1', ' ON ']) {
      process.env['MEMBER_RESTORE_ISSUANCE_ENABLED'] = value
      const res = await smsLogin(KEEP)
      check(typeof data(res.json)['restoreToken'] === 'string', `开关为 ${JSON.stringify(value)}：签发`)
    }
    // 下面第 1–8 节都在开关打开时跑；第 9 节再把它关掉。
    process.env['MEMBER_RESTORE_ISSUANCE_ENABLED'] = 'on'

    console.log('── 1. 签发条件 ───────────────────────────────────────')
    const first = await smsLogin(KEEP)
    const firstData = data(first.json)
    const userId = String((firstData['user'] as Json | undefined)?.['id'] ?? '')
    check(first.status === 201 || first.status === 200, `小程序显式登录成功（${first.status}）`)
    check(typeof firstData['restoreToken'] === 'string', '要 + 不带终端头 + 本小程序 Referer：签发恢复凭证')
    for (const [label, headers] of [
      ['不要（没有 x-member-keep-signed-in）', { Referer: MINIAPP_REFERER }],
      ['带 x-terminal-id（一体机）', { ...KEEP, 'x-terminal-id': 'KSK-VERIFY' }],
      ['Referer 缺失', { 'x-member-keep-signed-in': '1' }],
      ['Referer 是别的小程序', { 'x-member-keep-signed-in': '1', Referer: 'https://servicewechat.com/wxother000000000/3/page-frame.html' }],
      ['Referer 不是 servicewechat.com', { 'x-member-keep-signed-in': '1', Referer: `https://evil.example/${appid}/3/page-frame.html` }],
    ] as Array<[string, Record<string, string>]>) {
      const res = await smsLogin(headers)
      check(res.status < 300 && data(res.json)['restoreToken'] === undefined, `${label}：登录照常，不签发`)
    }
    const dev = await smsLogin({ 'x-member-keep-signed-in': '1', Referer: DEVTOOLS_REFERER })
    check(typeof data(dev.json)['restoreToken'] === 'string', '开发者工具的 Referer（/devtools/）也签发')

    console.log('── 2. 访问令牌仍是 30 分钟；恢复后是同一位 ─────────────')
    const access = String(firstData['token'])
    const claims = jwtPayload(access)
    check(claims.exp !== undefined && claims.iat !== undefined && claims.exp - claims.iat === 1800, '访问令牌 exp - iat = 1800 秒')
    const t0 = String(firstData['restoreToken'])
    const r1 = await call('/auth/restore', { restoreToken: t0 }, { Referer: MINIAPP_REFERER })
    const r1d = data(r1.json)
    const t1 = String(r1d['restoreToken'])
    check(r1.status < 300 && typeof r1d['token'] === 'string' && t1 !== t0, '首次使用：换出新访问令牌和新恢复凭证')
    check(jwtPayload(String(r1d['token'])).sub === userId, '新访问令牌是同一位会员')
    const me = await call('/me', {}, {}, String(r1d['token']))
    check(me.status === 200, '新访问令牌能访问 /me')
    const r1c = jwtPayload(String(r1d['token']))
    check(r1c.exp !== undefined && r1c.iat !== undefined && r1c.exp - r1c.iat === 1800, '换出来的访问令牌同样只有 30 分钟')

    console.log('── 3. 宽限期内重试：幂等，并发也一样 ──────────────────')
    const again = await call('/auth/restore', { restoreToken: t0 }, { Referer: MINIAPP_REFERER })
    check(again.status < 300 && data(again.json)['restoreToken'] === t1, '宽限期内再用上一枚：返回同一个后继')
    const [c1, c2] = await Promise.all([
      call('/auth/restore', { restoreToken: t1 }, { Referer: MINIAPP_REFERER }),
      call('/auth/restore', { restoreToken: t1 }, { Referer: MINIAPP_REFERER }),
    ])
    const s1 = data(c1.json)['restoreToken']
    const s2 = data(c2.json)['restoreToken']
    check(c1.status < 300 && c2.status < 300 && typeof s1 === 'string' && s1 === s2, '同一枚凭证并发两次：都成功，后继完全相同')
    const t2 = String(s1)

    console.log('── 4. 旧凭证再现：整组作废 ───────────────────────────')
    await restore.restore(t2) // t2 用过一次 → t3；此时 t1 是两轮之前的
    await expectCode(() => restore.restore(t0), 'MEMBER_RESTORE_REUSED', '隔了两轮的旧凭证再现：判重放')
    const famAfterReuse = await rawRedis.keys(`member:restore:family:${t0.split('.')[0]}`)
    check(famAfterReuse.length === 0, '重放之后整组记录已删除')
    const reLogin = await smsLogin(KEEP)
    const g0 = String(data(reLogin.json)['restoreToken'])
    const g1 = (await restore.restore(g0)).restoreToken
    await restore.restore(g1) // 后继 g1 已被用过
    await expectCode(() => restore.restore(g0), 'MEMBER_RESTORE_REUSED', '后继已被用过之后再用上一枚：判重放')
    process.env['MEMBER_RESTORE_GRACE_SECONDS'] = '1'
    const h0 = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    const h1 = (await restore.restore(h0)).restoreToken
    await sleep(1300)
    await expectCode(() => restore.restore(h0), 'MEMBER_RESTORE_REUSED', '宽限期已过再用上一枚：判重放')
    await expectCode(() => restore.restore(h1), 'MEMBER_RESTORE_INVALID', '整组作废后，当前那一枚也无效')
    delete process.env['MEMBER_RESTORE_GRACE_SECONDS']

    console.log('── 5. 期限 ─────────────────────────────────────────')
    for (const [label, field] of [['未使用期限已到', 'idleExp'], ['绝对期限已到', 'exp']] as const) {
      const token = String(data((await smsLogin(KEEP)).json)['restoreToken'])
      const famKey = `member:restore:family:${token.split('.')[0]}`
      const fam = JSON.parse(String(await rawRedis.get(famKey))) as Record<string, unknown>
      fam[field] = Date.now() - 1000
      await rawRedis.set(famKey, JSON.stringify(fam), 'KEEPTTL')
      await expectCode(() => restore.restore(token), 'MEMBER_RESTORE_INVALID', `${label}：无效，需重新认证`)
    }
    const ttlToken = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    const famTtl = await rawRedis.ttl(`member:restore:family:${ttlToken.split('.')[0]}`)
    check(famTtl > 6 * 86400 && famTtl <= 7 * 86400, `组记录只活到未使用期限（TTL ${famTtl} 秒）`)

    console.log('── 6. 撤销 ─────────────────────────────────────────')
    const out = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    const revoked = await call('/auth/restore/revoke', { restoreToken: out })
    check(revoked.status < 300, '主动退出：作废接口回成功（不要求访问令牌）')
    await expectCode(() => restore.restore(out), 'MEMBER_RESTORE_INVALID', '作废之后换新：无效')
    const again2 = await call('/auth/restore/revoke', { restoreToken: out })
    check(again2.status < 300, '作废接口幂等：再作废一次也回成功')
    const devA = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    const devB = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    const count = await restore.revokeAll(userId)
    check(count >= 2, `整户作废（换绑手机用）：作废 ${count} 组`)
    await expectCode(() => restore.restore(devA), 'MEMBER_RESTORE_INVALID', '整户作废后：第一台设备的凭证无效')
    await expectCode(() => restore.restore(devB), 'MEMBER_RESTORE_INVALID', '整户作废后：第二台设备的凭证无效')
    const beforeClosure = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    await closure.revoke(userId, phoneHash)
    await expectCode(() => restore.restore(beforeClosure), 'MEMBER_RESTORE_INVALID', '注销流程作废后：凭证无效')
    const rebindSource = readFileSync(join(__dirname, '../src/member-auth/member-phone-rebind.service.ts'), 'utf8')
    check(
      /sessionsRevoked = await this\.redis\.revokeMemberSessions\(endUserId\)\s*\n[^\n]*\n\s*await this\.restore\.revokeAll\(endUserId\)\s*\n\s*\} catch \{/.test(rebindSource),
      '换绑手机：整户作废恢复凭证与踢会话在同一个失败即拒绝的块里',
    )

    console.log('── 7. 账号停用 / 停用后又启用 ────────────────────────')
    const beforeDisable = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    await prisma.endUser.update({ where: { id: userId }, data: { enabled: false, status: 'disabled', statusChangedAt: new Date() } })
    await expectCode(() => restore.restore(beforeDisable), 'ACCOUNT_UNAVAILABLE', '账号停用：ACCOUNT_UNAVAILABLE')
    await prisma.endUser.update({ where: { id: userId }, data: { enabled: true, status: 'active', statusChangedAt: new Date() } })
    await expectCode(() => restore.restore(beforeDisable), 'MEMBER_RESTORE_INVALID', '停用时已作废：启用后也无效')
    const beforeFlip = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    await sleep(5)
    await prisma.endUser.update({ where: { id: userId }, data: { enabled: false, status: 'disabled', statusChangedAt: new Date() } })
    await prisma.endUser.update({ where: { id: userId }, data: { enabled: true, status: 'active', statusChangedAt: new Date() } })
    await expectCode(() => restore.restore(beforeFlip), 'MEMBER_RESTORE_INVALID', '签发之后停用又启用（期间没用过）：无效，需重新认证')
    const afterFlip = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    check((await restore.restore(afterFlip)).user.id === userId, '启用之后重新登录签的凭证：照常可用')

    console.log('── 8. 接口边界 ──────────────────────────────────────')
    const live = String(data((await smsLogin(KEEP)).json)['restoreToken'])
    const noRef = await call('/auth/restore', { restoreToken: live })
    check(noRef.status === 401 && (noRef.json['error'] as Json | undefined)?.['code'] === 'MEMBER_RESTORE_INVALID', '恢复不带本小程序 Referer：401 MEMBER_RESTORE_INVALID')
    const bad = await call('/auth/restore', { restoreToken: 'not-a-token' }, { Referer: MINIAPP_REFERER })
    check(bad.status === 400, '恢复凭证格式不对：400')
    const extra = await call('/auth/restore', { restoreToken: live, memberId: 'someone-else' }, { Referer: MINIAPP_REFERER })
    check(extra.status === 400, '多带字段（例如指定会员）：400，不能指定换成谁')
    const stillLive = await call('/auth/restore', { restoreToken: live }, { Referer: MINIAPP_REFERER })
    check(stillLive.status < 300, '上面几次被拒的请求没有作废这一组')

    console.log('── 9. 关掉开关：只停新签发，已签出的凭证不受影响 ─────────')
    const kept = String(data((await smsLogin(KEEP)).json)['restoreToken'] ?? '')
    check(kept.length > 0, '开关开着时签出一枚')
    process.env['MEMBER_RESTORE_ISSUANCE_ENABLED'] = 'off'
    const k1 = await call('/auth/restore', { restoreToken: kept }, { Referer: MINIAPP_REFERER })
    const k1Next = String(data(k1.json)['restoreToken'] ?? '')
    check(k1.status < 300 && typeof data(k1.json)['token'] === 'string' && k1Next.length > 0 && k1Next !== kept, '开关关掉后：已签出的凭证照常恢复，并换出后继')
    const k2 = await call('/auth/restore', { restoreToken: k1Next }, { Referer: MINIAPP_REFERER })
    const k2Next = String(data(k2.json)['restoreToken'] ?? '')
    check(k2.status < 300 && k2Next.length > 0, '开关关掉后：后继照常再恢复')
    const fresh = await smsLogin(KEEP)
    check(fresh.status < 300 && !('restoreToken' in data(fresh.json)), '开关关掉后：新的显式登录不签发')
    const k2Revoked = await call('/auth/restore/revoke', { restoreToken: k2Next })
    check(k2Revoked.status < 300, '开关关掉后：作废接口照常')
    const k2Dead = await call('/auth/restore', { restoreToken: k2Next }, { Referer: MINIAPP_REFERER })
    check(k2Dead.status === 401, '作废之后这一枚不能再恢复（401）')
  } finally {
    delete process.env['MEMBER_RESTORE_GRACE_SECONDS']
    delete process.env['MEMBER_RESTORE_ISSUANCE_ENABLED']
    await prisma.endUser.deleteMany({ where: { phoneHash } }).catch(() => undefined)
    await app.close()
  }

  console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 项`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
