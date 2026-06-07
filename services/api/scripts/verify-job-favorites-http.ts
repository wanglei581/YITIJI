/**
 * Phase C-2C follow-up — 登录会员收藏 HTTP 端到端验证（真实会员 JWT + 真实 HTTP + Guard + Redis）。
 *
 * 与 verify-member-favorites-benefits.ts（直连 service 层）不同，本脚本走完整 HTTP，
 * 复刻 **Kiosk FavoritesProvider / memberFavorites service 实际发出的请求形状**，证明登录态
 * 收藏链路端到端可用：
 *   - 入库：POST /me/favorites { targetType:'job', targetId, title }
 *   - 读取：GET  /me/favorites?type=job            （= kiosk getMyFavorites(token,'job') / ProfilePage）
 *   - 幂等：重复 POST 不产生重复；DELETE 两次 removed:true → false
 *   - 取消：DELETE /me/favorites/job/:targetId      （= kiosk removeFavorite(token,'job',id)）
 *   - 鉴权：匿名（无 token）一律 401
 *   - 合规：注入投递/候选人字段（forbidNonWhitelisted）→ 400
 *   - type 过滤：job_fair 收藏不出现在 ?type=job 列表
 *
 * 会员登录需短信验证码，无法在脚本里走真实登录；本脚本按 member-auth 同样的会话方案直接铸 session：
 *   JwtService.sign({ sub }, { jwtid })（aud=enduser, 30m）+ redis.setEx(member:session:{jti}, ttl, sub)。
 *
 * 自包含：进程内 NestFactory 起 AppModule（镜像 main.ts 的 prefix/pipe/filter），跑完清理并关闭。
 * 前置：Redis 在线（REDIS_URL）+ JWT_SECRET 已配 + dev.db 已有 Favorite 表。
 * 运行：pnpm verify:job-favorites-http
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { ValidationPipe, BadRequestException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { NestFactory } from '@nestjs/core'
import Redis from 'ioredis'
import { AppModule } from '../src/app.module'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { PrismaService } from '../src/prisma/prisma.service'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'

const PORT = 3097
const BASE = `http://localhost:${PORT}/api/v1`
const SESSION_TTL = 1800

let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  PASS ${msg}`)
  else { failed++; console.error(`  FAIL ${msg}`) }
}

interface FavoriteItem { id: string; targetType: string; targetId: string; title: string | null }

async function main() {
  console.log('\n=== Phase C-2C 登录会员收藏 HTTP 端到端验证 ===')

  const secret = process.env['JWT_SECRET']
  if (!secret) throw new Error('JWT_SECRET 未配置')
  const redisUrl = process.env['REDIS_URL']
  if (!redisUrl) throw new Error('REDIS_URL 未配置（本验证需真实 Redis 会话）')

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const endUserId = `eu_favhttp_${suffix}`
  const jobId = `job_favhttp_${suffix}`
  const fairId = `fair_favhttp_${suffix}`
  const sessionId = randomUUID()

  // 会员 token + 会话（与 member-auth.login 同方案）。
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '30m', audience: 'enduser' } })
  const token = jwt.sign({ sub: endUserId }, { jwtid: sessionId })
  const redis = new Redis(redisUrl)

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  async function cleanup() {
    await prisma.endUser.deleteMany({ where: { id: endUserId } }) // Favorite onDelete: Cascade
    await redis.del(memberSessionKey(sessionId))
  }

  // 进程内起真实 app（镜像 main.ts 关键装配）。
  const app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '请求参数校验失败' } }),
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(PORT)

  const authed = (init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  const jsonHeaders = { 'Content-Type': 'application/json' }

  try {
    await cleanup()
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: `favhttp-${suffix}`, phoneEnc: `favhttp-enc-${suffix}`, nickname: '收藏HTTP会员' } })
    await redis.setex(memberSessionKey(sessionId), SESSION_TTL, endUserId)
    console.log('  会员 + 会话已铸')

    // 1. 入库：POST /me/favorites { targetType:'job', targetId, title }
    const addRes = await fetch(`${BASE}/me/favorites`, authed({ method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetType: 'job', targetId: jobId, title: '前端工程师 · 青岛' }) }))
    const addBody = (await addRes.json()) as { data?: FavoriteItem }
    assert(addRes.status === 201 || addRes.status === 200, `1. 登录态收藏入库 POST → ${addRes.status}`)
    assert(addBody.data?.targetType === 'job' && addBody.data?.targetId === jobId && addBody.data?.title === '前端工程师 · 青岛', '1b. 入库返回 targetType/targetId/title 正确')

    // 2. 读取：GET /me/favorites?type=job（kiosk getMyFavorites(token,'job')）
    const listRes = await fetch(`${BASE}/me/favorites?type=job`, authed())
    const listBody = (await listRes.json()) as { data?: FavoriteItem[] }
    const list = listBody.data ?? []
    assert(listRes.status === 200 && list.some((f) => f.targetId === jobId), '2. 服务端可读回本人收藏（含刚入库岗位）')

    // 3. 幂等新增：再 POST 同岗位 → 列表仍只 1 条该岗位
    await fetch(`${BASE}/me/favorites`, authed({ method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetType: 'job', targetId: jobId, title: '前端工程师 · 青岛(再次)' }) }))
    const list2 = ((await (await fetch(`${BASE}/me/favorites?type=job`, authed())).json()) as { data?: FavoriteItem[] }).data ?? []
    assert(list2.filter((f) => f.targetId === jobId).length === 1, '3. 幂等新增：重复收藏同岗位不产生重复行')

    // 4. type 过滤：加 job_fair 收藏，?type=job 不应出现
    await fetch(`${BASE}/me/favorites`, authed({ method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetType: 'job_fair', targetId: fairId, title: '春季招聘会' }) }))
    const jobsOnly = ((await (await fetch(`${BASE}/me/favorites?type=job`, authed())).json()) as { data?: FavoriteItem[] }).data ?? []
    assert(!jobsOnly.some((f) => f.targetId === fairId) && jobsOnly.some((f) => f.targetId === jobId), '4. type=job 过滤：不返回 job_fair 收藏')

    // 5. 取消（幂等）：DELETE /me/favorites/job/:id 两次
    const del1 = (await (await fetch(`${BASE}/me/favorites/job/${jobId}`, authed({ method: 'DELETE' }))).json()) as { data?: { removed?: boolean } }
    const del2 = (await (await fetch(`${BASE}/me/favorites/job/${jobId}`, authed({ method: 'DELETE' }))).json()) as { data?: { removed?: boolean } }
    assert(del1.data?.removed === true && del2.data?.removed === false, '5. 取消（幂等）：首次 removed:true，再次 removed:false')

    // 6. 取消后读取：岗位不再在列表
    const after = ((await (await fetch(`${BASE}/me/favorites?type=job`, authed())).json()) as { data?: FavoriteItem[] }).data ?? []
    assert(!after.some((f) => f.targetId === jobId), '6. 取消后服务端列表不再含该岗位')

    // 7. 鉴权：匿名（无 token）→ 401
    const anonRes = await fetch(`${BASE}/me/favorites?type=job`, { headers: { Accept: 'application/json' } })
    const anonBody = (await anonRes.json()) as { error?: { code?: string } }
    assert(anonRes.status === 401 && anonBody.error?.code === 'MEMBER_MISSING_TOKEN', '7. 匿名读服务端收藏 → 401 MEMBER_MISSING_TOKEN')

    // 8. 合规：注入投递/候选人字段 → 400（forbidNonWhitelisted）
    const injRes = await fetch(`${BASE}/me/favorites`, authed({ method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetType: 'job', targetId: `${jobId}_x`, applicationStatus: 'applied', candidateId: 'c1' }) }))
    assert(injRes.status === 400, '8. 合规：注入 applicationStatus/candidateId 等未知字段 → 400 拒绝')

    // 9. 非法 targetType → 400
    const badTypeRes = await fetch(`${BASE}/me/favorites`, authed({ method: 'POST', headers: jsonHeaders, body: JSON.stringify({ targetType: 'company', targetId: 'x' }) }))
    assert(badTypeRes.status === 400, '9. 非法 targetType=company → 400')
  } finally {
    await cleanup()
    await app.close()
    redis.disconnect()
    await prisma.onModuleDestroy()
  }

  if (failed > 0) { console.error(`\n${failed} FAILED`); process.exit(1) }
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
