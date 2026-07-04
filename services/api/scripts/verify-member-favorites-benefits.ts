/**
 * Phase C-2C — 会员收藏 + 权益底座归属/合规验证。
 *
 * 覆盖：
 *   收藏（Favorite）
 *     1. 新增 + 列表：会员可收藏 job / job_fair / policy 并读回本人列表。
 *     2. 幂等新增：重复收藏同一对象不报错、不产生重复行，仅刷新标题快照。
 *     3. type 过滤：?type=job 只返回该类型。
 *     4. 取消（幂等）：删除存在的收藏 removed:true；再次删除 removed:false，均不报错。
 *     5. 跨用户隔离（双向）：A 看不到 B 的收藏；A 删 B 的收藏（同 targetId）只删自己的，不影响 B。
 *     5b. 收藏写入前校验目标真实存在且已发布，title 由服务端派生，不信任前端 title。
 *   权益（BenefitGrant）
 *     6. 本人可读 + 状态/额度字段正确；只回元数据（无支付凭证 / sourceRef 内部关联不强制暴露敏感值）。
 *     7. 跨用户隔离：A 看不到 B 的权益。
 *     8. 空列表返回 []（无任何收藏 / 权益的会员）。
 *     9. 合规：subsidy_eligibility_hint 资格提示文案 info-only，不含"到账 / 已发放金额"等承诺词。
 *   鉴权（EndUserAuthGuard，收藏写 + 权益读共用）
 *     10. 匿名 / 错 token / 无会话 → 401；有效 token + 会话 → 通过并注入本人 endUserId。
 *
 * 运行：pnpm verify:member-favorites-benefits
 *
 * service 读写路径只依赖 prisma；guard 用最小桩注入 jwt / redis，确定性验证鉴权分支。
 */
import 'dotenv/config'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import type { ExecutionContext } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MemberFavoritesService } from '../src/member-favorites/member-favorites.service'
import { MemberBenefitsService } from '../src/member-benefits/member-benefits.service'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'

const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-member-favorites-benefits-${randomUUID().slice(0, 8)}.db`
if (fallbackDbName) {
  process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
  prepareFallbackDb()
}

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectGuardCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望 401 ${code}，但 canActivate 通过（鉴权未拦截）`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

async function expectErrorCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望 ${code}，但操作成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

function mockCtx(headers: Record<string, string>): ExecutionContext {
  const req = { headers }
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

async function main() {
  console.log('\n=== Phase C-2C 会员收藏 + 权益底座归属/合规验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const favs = new MemberFavoritesService(prisma)
  const benefits = new MemberBenefitsService(prisma)
  const firstPage = { cursor: null, pageSize: 20 }

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_fb_a_${suffix}`
  const userB = `eu_fb_b_${suffix}`
  const userC = `eu_fb_c_${suffix}` // 无任何收藏 / 权益 → 空列表
  const allUserIds = [userA, userB, userC]
  const orgId = `org_fb_${suffix}`

  // 共享 targetId，用于验证"删除时不会跨用户删到他人收藏"。
  let sharedJobId = ''
  let fairId = ''
  let policyId = ''
  let draftJobId = ''

  async function cleanup() {
    // Favorite / BenefitGrant 对 EndUser 是 onDelete: Cascade，删用户即连带清理。
    await prisma.endUser.deleteMany({ where: { id: { in: allUserIds } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: orgId } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: orgId } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: orgId } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
  }

  try {
    await cleanup()
    for (const [id, n] of [[userA, '会员A'], [userB, '会员B'], [userC, '会员C']] as const) {
      await prisma.endUser.create({ data: { id, phoneHash: `fb-${id}`, phoneEnc: `fb-enc-${id}`, nickname: n } })
    }
    pass('三个测试会员已创建')
    await prisma.organization.create({ data: { id: orgId, name: `收藏测试机构${suffix}`, type: 'licensed_hr_agency' } })
    const job = await prisma.job.create({
      data: {
        sourceOrgId: orgId,
        externalId: `fav-job-${suffix}`,
        sourceName: '收藏来源平台',
        sourceUrl: 'https://example.com/fav-job',
        title: `服务端岗位标题${suffix}`,
        company: '收藏测试公司',
        city: '青岛',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    sharedJobId = job.id
    const draftJob = await prisma.job.create({
      data: {
        sourceOrgId: orgId,
        externalId: `fav-draft-${suffix}`,
        sourceName: '收藏来源平台',
        sourceUrl: 'https://example.com/fav-draft',
        title: `未发布岗位${suffix}`,
        company: '收藏测试公司',
        city: '青岛',
        reviewStatus: 'pending',
        publishStatus: 'draft',
      },
    })
    draftJobId = draftJob.id
    const fair = await prisma.jobFair.create({
      data: {
        sourceOrgId: orgId,
        externalId: `fav-fair-${suffix}`,
        sourceName: '收藏招聘会来源',
        sourceUrl: 'https://example.com/fav-fair',
        title: `服务端招聘会标题${suffix}`,
        venue: '收藏测试会场',
        city: '青岛',
        startAt: new Date(),
        endAt: new Date(Date.now() + 86_400_000),
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    fairId = fair.id
    const policy = await prisma.policyPost.create({
      data: {
        sourceOrgId: orgId,
        sourceName: '收藏政策来源',
        kind: 'policy_guide',
        title: `服务端政策标题${suffix}`,
        externalUrl: 'https://example.gov.cn/fav-policy',
        reviewStatus: 'approved',
        publishStatus: 'published',
      },
    })
    policyId = policy.id
    pass('收藏测试目标已创建（已发布岗位 / 招聘会 / 政策 + 未发布岗位）')

    // ── 1. 新增 + 列表 ───────────────────────────────────────────
    await favs.add(userA, { targetType: 'job', targetId: sharedJobId, title: '前端伪造岗位标题' })
    await favs.add(userA, { targetType: 'job_fair', targetId: fairId, title: '前端伪造招聘会标题' })
    await favs.add(userA, { targetType: 'policy', targetId: policyId, title: '前端伪造政策标题' })
    const listA = (await favs.list(userA, firstPage)).items
    const titles = new Set(listA.map((f) => f.title))
    if (
      listA.length === 3 &&
      new Set(listA.map((f) => f.targetType)).size === 3 &&
      titles.has(`服务端岗位标题${suffix}`) &&
      titles.has(`服务端招聘会标题${suffix}`) &&
      titles.has(`服务端政策标题${suffix}`) &&
      !titles.has('前端伪造岗位标题')
    ) {
      pass('1. 新增 + 列表：A 收藏 job/job_fair/policy 各 1，title 全部由服务端目标派生')
    } else fail(`1. A 收藏列表异常：${JSON.stringify(listA)}`)

    // ── 2. 幂等新增 ──────────────────────────────────────────────
    const reAdded = await favs.add(userA, { targetType: 'job', targetId: sharedJobId, title: '前端伪造更新标题' })
    const listA2 = (await favs.list(userA, firstPage)).items
    const jobFavs = listA2.filter((f) => f.targetType === 'job' && f.targetId === sharedJobId)
    if (listA2.length === 3 && jobFavs.length === 1 && jobFavs[0].title === `服务端岗位标题${suffix}` && reAdded.id === jobFavs[0].id) {
      pass('2. 幂等新增：重复收藏同一岗位不产生重复行，仍使用服务端派生标题')
    } else fail(`2. 幂等新增失败：${JSON.stringify(listA2)}`)

    // ── 3. type 过滤 ─────────────────────────────────────────────
    const onlyJobs = (await favs.list(userA, firstPage, 'job')).items
    if (onlyJobs.length === 1 && onlyJobs[0].targetType === 'job') pass('3. type 过滤：?type=job 只返回 1 条 job 收藏')
    else fail(`3. type 过滤异常：${JSON.stringify(onlyJobs)}`)

    // ── 4. 取消（幂等）──────────────────────────────────────────
    const rm1 = await favs.remove(userA, 'policy', policyId)
    const rm2 = await favs.remove(userA, 'policy', policyId)
    const listA3 = (await favs.list(userA, firstPage)).items
    if (rm1.removed === true && rm2.removed === false && listA3.length === 2 && !listA3.some((f) => f.targetType === 'policy')) {
      pass('4. 取消（幂等）：首次删 removed:true，再删 removed:false，policy 收藏已移除')
    } else fail(`4. 取消收藏异常：rm1=${JSON.stringify(rm1)} rm2=${JSON.stringify(rm2)} list=${JSON.stringify(listA3)}`)

    // ── 5. 跨用户隔离（B 收藏同一 sharedJobId）─────────────────────
    await favs.add(userB, { targetType: 'job', targetId: sharedJobId, title: 'B 伪造标题' })
    const listB = (await favs.list(userB, firstPage)).items
    // A 试图删"同 targetId"的收藏：只应删自己的；B 的不受影响。
    await favs.remove(userA, 'job', sharedJobId)
    const listAafter = (await favs.list(userA, firstPage)).items
    const listBafter = (await favs.list(userB, firstPage)).items
    const crossOk =
      listB.length === 1 && listB[0].title === `服务端岗位标题${suffix}` &&
      !listAafter.some((f) => f.targetId === sharedJobId) && // A 自己的已删
      listBafter.length === 1 && listBafter[0].targetId === sharedJobId // B 的仍在
    if (crossOk) pass('5. 跨用户隔离：A 删同 targetId 收藏只删本人，B 对同一对象的收藏不受影响')
    else fail(`5. 跨用户隔离失败：listB=${JSON.stringify(listB)} listBafter=${JSON.stringify(listBafter)} listAafter=${JSON.stringify(listAafter)}`)

    // ── 5b. 目标校验：未发布 / 不存在拒绝，零落库 ─────────────────
    await expectErrorCode(
      () => favs.add(userA, { targetType: 'job', targetId: draftJobId, title: '未发布也不应落库' }),
      'FAVORITE_TARGET_NOT_FOUND',
      '5b-1. 未发布岗位不可收藏',
    )
    await expectErrorCode(
      () => favs.add(userA, { targetType: 'policy', targetId: `missing-policy-${suffix}`, title: '不存在也不应落库' }),
      'FAVORITE_TARGET_NOT_FOUND',
      '5b-2. 不存在政策不可收藏',
    )
    const dirtyFavorites = await prisma.favorite.count({
      where: { endUserId: userA, OR: [{ targetId: draftJobId }, { targetId: `missing-policy-${suffix}` }] },
    })
    if (dirtyFavorites === 0) pass('5b-3. 被拒绝收藏目标零落库')
    else fail(`5b-3. 被拒绝收藏目标产生脏记录 count=${dirtyFavorites}`)

    // ── 权益：构造数据（直接落库，模拟后续活动/套餐发放）────────────
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.benefitGrant.create({ data: { endUserId: userA, benefitType: 'free_quota', title: '免费打印 5 次', quantityTotal: 5, quantityRemaining: 3, status: 'active', sourceType: 'campus', validUntil: future } })
    await prisma.benefitGrant.create({ data: { endUserId: userA, benefitType: 'coupon', title: '简历打印 8 折券', status: 'expired', sourceType: 'platform' } })
    await prisma.benefitGrant.create({ data: { endUserId: userA, benefitType: 'subsidy_eligibility_hint', title: '高校毕业生求职补贴资格提示', description: '符合条件可按官方指引准备材料清单，前往人社官方入口申请。具体以官方审核为准。', status: 'active', sourceType: 'gov' } })
    await prisma.benefitGrant.create({ data: { endUserId: userB, benefitType: 'coupon', title: 'B 的券', status: 'active', sourceType: 'platform' } })

    // ── 6. 本人可读 + 只回元数据 ──────────────────────────────────
    const benA = (await benefits.list(userA, firstPage)).items
    const readableOk = benA.length === 3 && benA.some((b) => b.status === 'active') && benA.some((b) => b.status === 'expired')
    const quotaOk = benA.some((b) => b.benefitType === 'free_quota' && b.quantityRemaining === 3 && b.quantityTotal === 5)
    if (readableOk && quotaOk) pass('6. 本人可读权益：A 得到 3 条，active/expired 状态与额度字段正确')
    else fail(`6. A 权益列表异常：${JSON.stringify(benA)}`)

    // ── 7. 跨用户隔离 ────────────────────────────────────────────
    const benB = (await benefits.list(userB, firstPage)).items
    if (benB.length === 1 && benB[0].title === 'B 的券' && !benA.some((b) => b.title === 'B 的券')) {
      pass('7. 跨用户隔离：A 看不到 B 的权益，B 只看到自己的')
    } else fail(`7. 权益跨用户隔离失败：benB=${JSON.stringify(benB)}`)

    // ── 8. 空列表返回 [] ─────────────────────────────────────────
    const emptyOk =
      JSON.stringify((await favs.list(userC, firstPage)).items) === '[]' &&
      JSON.stringify((await benefits.list(userC, firstPage)).items) === '[]'
    if (emptyOk) pass('8. 空列表返回 []（无收藏 / 权益会员 C）')
    else fail('8. 空列表未返回 []')

    // ── 9. 合规：补贴资格提示 info-only，无"到账 / 已发放金额"承诺词 ──
    const hint = benA.find((b) => b.benefitType === 'subsidy_eligibility_hint')
    const hintText = `${hint?.title ?? ''} ${hint?.description ?? ''}`
    const forbidden = ['到账', '已发放金额', '保证发放', '必到账', '直接领取现金']
    const hit = forbidden.find((w) => hintText.includes(w))
    if (hint && !hit) pass('9. 合规：补贴资格提示为 info-only（官方指引 / 材料清单），无"到账 / 已发放金额"承诺词')
    else fail(`9. 补贴资格提示含承诺性文案或缺失：hit=${hit ?? 'N/A'} text=${hintText}`)

    // ── 10. 鉴权（EndUserAuthGuard）─────────────────────────────
    const guardNoToken = new EndUserAuthGuard({} as never, {} as never, {} as never)
    await expectGuardCode(() => guardNoToken.canActivate(mockCtx({})), 'MEMBER_MISSING_TOKEN', '10a. 匿名（无 Authorization）→ 401 MEMBER_MISSING_TOKEN')

    const jwtThrows = { verify: () => { throw new Error('bad') } } as never
    const guardBad = new EndUserAuthGuard(jwtThrows, {} as never, {} as never)
    await expectGuardCode(() => guardBad.canActivate(mockCtx({ authorization: 'Bearer bad.token' })), 'MEMBER_TOKEN_INVALID', '10b. 错 token → 401 MEMBER_TOKEN_INVALID')

    const jwtOk = { verify: () => ({ sub: userA, jti: 'sess-x' }) } as never
    const prismaEnabled = { endUser: { findUnique: async () => ({ enabled: true }) } } as never
    const guardNoSession = new EndUserAuthGuard(jwtOk, { get: async () => null } as never, {} as never)
    await expectGuardCode(() => guardNoSession.canActivate(mockCtx({ authorization: 'Bearer ok.token' })), 'MEMBER_SESSION_EXPIRED', '10c. 有效 token 但无 Redis 会话 → 401 MEMBER_SESSION_EXPIRED')

    const guardOk = new EndUserAuthGuard(jwtOk, { get: async () => userA } as never, prismaEnabled)
    const ctx = mockCtx({ authorization: 'Bearer ok.token' })
    const allowed = await guardOk.canActivate(ctx)
    const injected = (ctx.switchToHttp().getRequest() as { endUser?: { endUserId: string } }).endUser
    if (allowed === true && injected?.endUserId === userA) pass('10d. 有效会员 token + 会话 → 通过并注入本人 endUserId')
    else fail('10d. 有效会员鉴权未通过或未注入 endUser')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  cleanupFallbackDb()
  process.exit(1)
})

function cleanupFallbackDb(): void {
  if (!fallbackDbName) return
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`prisma/${fallbackDbName}${suffix}`, { force: true })
  }
}

function prepareFallbackDb(): void {
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], { stdio: 'pipe' })
  } catch (error) {
    const details = (error as { stdout?: Buffer; stderr?: Buffer })
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    cleanupFallbackDb()
    throw error
  }
}
