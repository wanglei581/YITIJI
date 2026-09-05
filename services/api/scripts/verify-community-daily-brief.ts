/**
 * 官方动态流 / 今日办事清单的真实数据验证。
 *
 * 使用任务专用 SQLite，直接调用两个控制器对应的服务实现；不需要 HTTP 监听或
 * Redis TCP，因此本地受限环境与 CI 均可执行。缓存替身只验证公共缓存路径，个人
 * 订单和收藏查询始终直接访问 Prisma。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { PrismaService } from '../src/prisma/prisma.service'
import { CommunityController } from '../src/community/community.controller'
import { CommunityService } from '../src/community/community.service'
import { DailyBriefController } from '../src/assistant/daily-brief.controller'
import { DailyBriefService, type DailyReport } from '../src/assistant/daily-brief.service'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'

const apiRoot = path.resolve(__dirname, '..')
const dbName = `verify-community-daily-brief-${randomUUID().slice(0, 8)}.db`
const dbPath = path.join(apiRoot, 'prisma', dbName)
process.env['DATABASE_URL'] = `file:./prisma/${dbName}`
process.env['VERIFICATION_DATABASE_TARGET'] ??= 'isolated'
assertIsolatedVerificationDatabase()
closeSync(openSync(dbPath, 'a'))
execFileSync(path.join(apiRoot, 'node_modules', '.bin', 'prisma'), ['db', 'push'], {
  cwd: apiRoot,
  stdio: 'inherit',
  env: process.env,
})

type Cache = {
  get(key: string): Promise<string | null>
  setEx(key: string, ttl: number, value: string): Promise<void>
}
type FeedPage = Awaited<ReturnType<CommunityController['listFeeds']>>

let failures = 0
function assert(condition: unknown, label: string): void {
  if (condition) console.log(`  PASS ${label}`)
  else { failures += 1; console.error(`  FAIL ${label}`) }
}

function inMemoryPublicCache(): Cache {
  const values = new Map<string, string>()
  return {
    async get(key) { return values.get(key) ?? null },
    async setEx(key, _ttl, value) { values.set(key, value) },
  }
}

async function main(): Promise<void> {
  console.log('\n=== 最新动态 / 今日办事清单真实数据验证 ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const cache = inMemoryPublicCache()
  const community = new CommunityController(new CommunityService(prisma, cache as never))
  const daily = new DailyBriefController(new DailyBriefService(prisma, cache as never))
  const guards = (Reflect.getMetadata(GUARDS_METADATA, DailyBriefController) ?? []) as Function[]
  assert(guards.includes(EndUserAuthGuard), '0. POST /assistant/daily-report 声明 EndUserAuthGuard 会员鉴权')
  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgId = `org_cdb_${suffix}`
  const userA = `eu_cdb_a_${suffix}`
  const userB = `eu_cdb_b_${suffix}`
  const userEmpty = `eu_cdb_empty_${suffix}`
  const fairId = `fair_cdb_${suffix}`
  const orderA = `order_cdb_a_${suffix}`
  const orderB = `order_cdb_b_${suffix}`
  const policyId = `policy_cdb_${suffix}`
  const unpublishedPolicyId = `policy_cdb_unpublished_${suffix}`
  const broadcastId = `broadcast_cdb_${suffix}`
  const city = `验证城市${suffix}`
  const now = new Date()
  const today = new Date(now.getTime() - 60 * 60 * 1000)

  async function cleanup(): Promise<void> {
    await prisma.broadcastReadState.deleteMany({ where: { endUserId: { in: [userA, userB, userEmpty] } } })
    await prisma.favorite.deleteMany({ where: { endUserId: { in: [userA, userB, userEmpty] } } })
    await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: orgId } })
    await prisma.jobFair.deleteMany({ where: { id: fairId } })
    await prisma.policyPost.deleteMany({ where: { id: { in: [policyId, unpublishedPolicyId] } } })
    await prisma.benefitActivity.deleteMany({ where: { title: { contains: suffix } } })
    await prisma.systemBroadcast.deleteMany({ where: { id: broadcastId } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userA, userB, userEmpty] } } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
  }

  try {
    await cleanup()
    await prisma.organization.create({ data: { id: orgId, name: '动态验证合作机构', type: 'partner' } })
    await prisma.endUser.createMany({ data: [
      { id: userA, phoneHash: `cdb-a-${suffix}`, phoneEnc: `cdb-a-enc-${suffix}`, nickname: '动态会员A' },
      { id: userB, phoneHash: `cdb-b-${suffix}`, phoneEnc: `cdb-b-enc-${suffix}`, nickname: '动态会员B' },
      { id: userEmpty, phoneHash: `cdb-e-${suffix}`, phoneEnc: `cdb-e-enc-${suffix}`, nickname: '动态会员空' },
    ] })
    await prisma.policyPost.createMany({ data: [
      { id: policyId, sourceOrgId: orgId, sourceName: '动态验证合作机构', title: `已发布政策 ${suffix}`, summary: '政策摘要'.repeat(80), reviewStatus: 'approved', publishStatus: 'published', createdAt: today, syncTime: today },
      { id: unpublishedPolicyId, sourceOrgId: orgId, sourceName: '动态验证合作机构', title: `未发布政策 ${suffix}`, summary: '不得公开', reviewStatus: 'approved', publishStatus: 'draft', createdAt: now, syncTime: today },
    ] })
    await prisma.benefitActivity.create({ data: { title: `已发布权益 ${suffix}`, description: '权益说明', benefitType: 'free_quota', status: 'published', createdAt: today } })
    await prisma.systemBroadcast.create({ data: { id: broadcastId, title: `系统通知 ${suffix}`, content: '系统维护通知', createdAt: today } })
    await prisma.job.create({ data: {
      id: `job_cdb_${suffix}`, sourceOrgId: orgId, externalId: `job-ext-${suffix}`, sourceName: '动态验证合作机构', sourceUrl: 'https://example.invalid/job',
      title: '当日新增岗位', company: '验证公司', city, reviewStatus: 'approved', publishStatus: 'published', syncTime: today,
    } })
    await prisma.jobFair.create({ data: {
      id: fairId, sourceOrgId: orgId, externalId: `fair-ext-${suffix}`, sourceName: '动态验证合作机构', sourceUrl: 'https://example.invalid/fair',
      title: '收藏招聘会', startAt: new Date(now.getTime() + 36 * 60 * 60 * 1000), endAt: new Date(now.getTime() + 42 * 60 * 60 * 1000), venue: '验证会场', city,
      reviewStatus: 'approved', publishStatus: 'published',
    } })
    await prisma.favorite.create({ data: { endUserId: userA, targetType: 'job_fair', targetId: fairId, title: '收藏招聘会' } })
    await prisma.order.createMany({ data: [
      { id: orderA, orderNo: `CDB-A-${suffix}`, endUserId: userA, payStatus: 'paid', pickupStatus: 'pending', pickupCodeExpiresAt: new Date(now.getTime() + 3 * 60 * 60 * 1000), taskStatus: 'pending' },
      { id: orderB, orderNo: `CDB-B-${suffix}`, endUserId: userB, payStatus: 'paid', pickupStatus: 'pending', pickupCodeExpiresAt: new Date(now.getTime() + 3 * 60 * 60 * 1000), taskStatus: 'pending' },
    ] })
    console.log('  独立 SQLite 真实夹具已创建')

    const feeds: FeedPage = await community.listFeeds({ limit: 20 })
    const ids = feeds.items.map((item) => item.id)
    const policy = feeds.items.find((item) => item.id === `policy:${policyId}`)
    assert(feeds.commentsEnabled === false, '1. GET /community/feeds 契约固定 commentsEnabled:false')
    assert(ids.includes(`policy:${policyId}`) && !ids.includes(`policy:${unpublishedPolicyId}`), '2. 未发布 PolicyPost 不出现在 feeds')
    assert(policy?.summary.length === 120 && policy.sourceName === '动态验证合作机构' && policy.action.label === '查看政策', '3. feeds 摘要截断、机构来源和政策动作正确')
    assert(feeds.items.every((item) => !('likeCount' in item) && !('commentCount' in item) && !('likedByMe' in item)), '4. feeds 不返回点赞或评论字段')
    const firstPage = await community.listFeeds({ limit: 1 })
    const secondPage = await community.listFeeds({ limit: 10, cursor: firstPage.nextCursor ?? undefined })
    assert(
      firstPage.nextCursor !== null
        && firstPage.items.length === 1
        && !secondPage.items.some((item) => item.id === firstPage.items[0]?.id),
      '4b. publishedAt|id 游标分页返回后续项且无重复',
    )
    console.log(`  FEED_SAMPLE ${JSON.stringify(policy)}`)

    const report: DailyReport = await daily.create({ endUserId: userA, sessionId: 'verify' }, { city })
    const pickup = report.modules.find((module) => module.type === 'pickup_expiring')
    const fair = report.modules.find((module) => module.type === 'fair_countdown')
    const cityNew = report.modules.find((module) => module.type === 'city_new')
    assert(pickup?.items?.some((item) => item.orderId === orderA) && !pickup?.items?.some((item) => item.orderId === orderB), '5. 他人订单不出现在本人 daily-report')
    assert(fair?.items?.some((item) => item.fairId === fairId) && cityNew?.city === city && cityNew.newJobs === 1 && (cityNew.newPolicies ?? 0) >= 1, '6. 收藏招聘会倒计时与当日城市新增真实聚合')
    assert(report.modules.some((module) => module.type === 'broadcast') && report.empty === false, '7. 最新未删除广播进入每日提醒')
    console.log(`  DAILY_REPORT_SAMPLE ${JSON.stringify(report)}`)

    const withoutCity: DailyReport = await daily.create({ endUserId: userA, sessionId: 'verify' }, {})
    assert(!withoutCity.modules.some((module) => module.type === 'city_new'), '8. city 缺省时无 city_new')

    await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } })
    await prisma.favorite.deleteMany({ where: { endUserId: userA } })
    await prisma.systemBroadcast.deleteMany({ where: { id: broadcastId } })
    const empty: DailyReport = await daily.create({ endUserId: userEmpty, sessionId: 'verify' }, {})
    assert(empty.empty === true && JSON.stringify(empty.modules) === '[]', '9. 四空时 empty:true、modules:[]')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true })
  }

  if (failures > 0) process.exit(1)
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
