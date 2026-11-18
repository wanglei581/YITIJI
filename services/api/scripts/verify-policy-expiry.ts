/**
 * 政策截止日期：公开读取滤掉已过期的，定时任务把已发布行写成 expired 并记审计，改期后重新发布能回来。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:policy-expiry
 */
import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NotFoundException } from '@nestjs/common'
import { Redis } from 'ioredis'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { POLICY_PUBLISH_FIXTURE, POLICY_VERIFIED_DOMAINS_FIXTURE } from './support/policy-publish-fixture'
import { formatBeijingDate } from '../src/common/beijing-display-time'
import { PrismaService } from '../src/prisma/prisma.service'
import { createPrismaClient } from '../src/prisma/create-client'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService } from '../src/policies/policies.service'
import { PolicyExpiryTask } from '../src/policies/policy-expiry.task'
import { PolicyChecklistService } from '../src/policies/policy-checklist.service'
import { AssistantPolicyContextService } from '../src/ai/llm/assistant-policy-context'
import { publicPolicyWhere } from '../src/policies/policy-public-visibility'
import { policyDeadlineThreshold } from '../src/policies/policy-validity'
import { checklistMetadata } from '../src/policies/policy-checklist-metadata'
import { assertPiiScanned } from '../src/print-jobs/pii-scan-gate'
import { CommunityService, communityFeedCacheKey } from '../src/community/community.service'
import { RedisService } from '../src/common/redis/redis.service'
import { isRecruitmentContentHostingEnabled } from '../src/recruitment-hosting/recruitment-hosting'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

// 这道门禁只测普通政策的截止日期，显式关掉招聘托管，不跟着外部环境漂。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

assertIsolatedVerificationDatabase()

function shiftCalendar(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function errorText(error: unknown): string {
  const record = error as { message?: string; meta?: unknown; cause?: unknown }
  return [record?.message, record?.meta ? JSON.stringify(record.meta) : '', record?.cause ? errorText(record.cause) : ''].join('\n')
}

function isSqliteBusy(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const record = current as {
      rawCode?: number
      originalCode?: string
      message?: string
      originalMessage?: string
      cause?: unknown
      meta?: { driverAdapterError?: unknown }
    }
    if (record.rawCode === 5 || record.originalCode === '5') return true
    if (`${record.message ?? ''}\n${record.originalMessage ?? ''}`.includes('SQLITE_BUSY')) return true
    current = record.meta?.driverAdapterError ?? record.cause
  }
  return false
}

function errCode(error: unknown): string | undefined {
  const ex = error as { getResponse?: () => unknown }
  const body = typeof ex.getResponse === 'function' ? ex.getResponse() : undefined
  const record = body && typeof body === 'object' && 'error' in body
    ? (body as { error?: { code?: string } }).error
    : undefined
  return record?.code
}

async function withFrozenNow<T>(instant: Date, run: () => Promise<T>): Promise<T> {
  const RealDate = Date
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof RealDate>) {
      if (args.length === 0) super(instant.getTime())
      else super(...args)
    }

    static override now(): number {
      return instant.getTime()
    }
  }
  globalThis.Date = FrozenDate as DateConstructor
  try {
    return await run()
  } finally {
    globalThis.Date = RealDate
  }
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    assert.fail(`${label} — 期望 ${code}，但调用成功`)
  } catch (error) {
    assert.equal(errCode(error), code, `${label} — 期望 ${code}，实际 ${errCode(error) ?? (error as Error).message}`)
  }
}

async function main(): Promise<void> {
  const whereText = JSON.stringify(publicPolicyWhere({ publishStatus: 'published' }, []))
  assert.match(whereText, /"validThrough":null/, '公开条件必须保留没有截止日期的政策')
  assert.match(whereText, /"gte":/, '公开条件必须保留截止日期还没到的政策')
  console.log('  PASS 公开查询条件带截止日期')

  const today = formatBeijingDate(new Date())
  const tomorrow = shiftCalendar(today, 1)
  const yesterday = shiftCalendar(today, -1)
  const later = shiftCalendar(today, 30)
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const policies = new PoliciesService(prisma, audit)
  const expiry = new PolicyExpiryTask(prisma, audit)
  const checklist = new PolicyChecklistService(prisma, {} as never)
  const assistant = new AssistantPolicyContextService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_plex_${suffix}`
  const org = await prisma.organization.create({
    data: {
      id: orgId,
      name: `截止日期机构_${suffix}`,
      type: 'public_employment_service',
      contentTrustStatus: 'active',
      verifiedOfficialDomainsJson: POLICY_VERIFIED_DOMAINS_FIXTURE,
    },
  })
  const userRow = await prisma.user.create({
    data: { username: `plex_${suffix}`, passwordHash: 'x', name: '截止日期账号', role: 'partner', orgId: org.id },
  })
  const partner: AuthedUser = { userId: userRow.id, role: 'partner', orgId: org.id }
  const ids: string[] = []
  const fileIds: string[] = []
  const redisKeys: string[] = []
  let redis: Redis | null = null
  let ddl: { $executeRawUnsafe: (query: string) => Promise<unknown>; $disconnect: () => Promise<void> } | null = null

  const publish = async (id: string) => {
    await policies.reviewPolicy(id, 'approve', undefined, partner)
    await policies.publishPolicy(id, 'publish', partner, { responsibilityAcknowledged: true })
  }

  try {
    await expectCode(
      () => policies.createPartnerPolicy({
        ...POLICY_PUBLISH_FIXTURE, kind: 'policy_guide', title: `今天截止_${suffix}`, audience: 'general', validThrough: today,
      }, partner),
      'POLICY_DEADLINE_NOT_FUTURE',
      '今天的日期不能当截止日期',
    )
    await expectCode(
      () => policies.createPartnerPolicy({
        ...POLICY_PUBLISH_FIXTURE, kind: 'policy_guide', title: `昨天截止_${suffix}`, audience: 'general', validThrough: yesterday,
      }, partner),
      'POLICY_DEADLINE_NOT_FUTURE',
      '过去的日期不能当截止日期',
    )

    const openEnded = await policies.createPartnerPolicy({
      ...POLICY_PUBLISH_FIXTURE, kind: 'policy_guide', title: `一直有效_${suffix}`, audience: 'general', summary: '没有截止日期',
    }, partner)
    const dated = await policies.createPartnerPolicy({
      ...POLICY_PUBLISH_FIXTURE, kind: 'policy_guide', title: `将来截止_${suffix}`, audience: 'general', summary: '有截止日期', validThrough: tomorrow,
    }, partner)
    ids.push(openEnded.id, dated.id)
    assert.equal(dated.validThrough, tomorrow, '保存后要带回截止日期')
    assert.equal(openEnded.validThrough, undefined, '没填截止日期不能伪装成已到期')
    await publish(openEnded.id)
    await publish(dated.id)

    const listed = async () => (await policies.getPublishedPolicies()).data.map((row) => row.id)
    assert.ok((await listed()).includes(openEnded.id), '没有截止日期的已发布政策必须一直出现')
    assert.ok((await listed()).includes(dated.id), '截止日期还没到的政策必须出现')
    assert.equal((await policies.getPublishedPolicyById(dated.id)).data.validThrough, tomorrow)

    await prisma.policyPost.update({ where: { id: openEnded.id }, data: { validThrough: policyDeadlineThreshold() } })
    assert.ok((await listed()).includes(openEnded.id), '截止日期当天仍然公开')
    assert.equal(await expiry.expirePastDeadline(), 0, '截止日期当天不能被定时任务下架')
    assert.equal((await prisma.policyPost.findUnique({ where: { id: openEnded.id } }))?.publishStatus, 'published')

    await prisma.policyPost.update({ where: { id: dated.id }, data: { validThrough: new Date(`${yesterday}T00:00:00.000Z`) } })
    assert.equal((await listed()).includes(dated.id), false, '过了截止日期的政策不得出现在公开列表')
    await expectCode(() => policies.getPublishedPolicyById(dated.id), 'POLICY_NOT_FOUND', '过期详情与已下架一样是 404')
    assert.equal(await assistant.read(dated.id), null, '小青取材读不到已过期的政策')
    await assert.rejects(() => checklist.generate(dated.id), (error: unknown) => {
      assert.ok(error instanceof NotFoundException)
      assert.equal(errCode(error), 'POLICY_NOT_FOUND')
      return true
    })
    console.log('  PASS 过期政策不出现在列表、详情、小青取材和办事清单')

    const draft = await policies.createPartnerPolicy({
      ...POLICY_PUBLISH_FIXTURE, kind: 'policy_guide', title: `草稿过期_${suffix}`, audience: 'general',
    }, partner)
    ids.push(draft.id)
    await prisma.policyPost.update({
      where: { id: draft.id },
      data: { validThrough: new Date(`${yesterday}T00:00:00.000Z`), publishStatus: 'draft' },
    })

    const marked = await expiry.expirePastDeadline()
    assert.equal(marked, 1, '定时任务只把已发布且过期的那一条写成 expired')
    assert.equal((await prisma.policyPost.findUnique({ where: { id: dated.id } }))?.publishStatus, 'expired')
    assert.equal((await prisma.policyPost.findUnique({ where: { id: draft.id } }))?.publishStatus, 'draft', '草稿即使日期已过也不改状态')
    const audits = () => prisma.auditLog.count({ where: { action: 'policy.auto_expire', targetId: dated.id } })
    assert.equal(await audits(), 1, '定时任务要写 policy.auto_expire')
    assert.equal(await expiry.expirePastDeadline(), 0)
    assert.equal(await audits(), 1, '第二次跑不得再写审计')
    console.log('  PASS 定时任务置 expired、写审计、再次运行不重复')

    const restored = await policies.updatePartnerPolicy(dated.id, { validThrough: later }, partner)
    assert.equal(restored.reviewStatus, 'pending')
    assert.equal(restored.publishStatus, 'draft')
    assert.equal(restored.validThrough, later)
    await publish(dated.id)
    assert.ok((await listed()).includes(dated.id), '改到以后并重新发布后必须重新出现')
    assert.equal((await policies.getPublishedPolicyById(dated.id)).data.id, dated.id)
    console.log('  PASS 改期后重新发布恢复显示')

    const titleHit = await policies.createPartnerPolicy({
      ...POLICY_PUBLISH_FIXTURE,
      kind: 'notice',
      category: 'training',
      title: `培训补贴关键词_${suffix}`,
      summary: '这条摘要不带检索词',
    }, partner)
    const summaryHit = await policies.createPartnerPolicy({
      ...POLICY_PUBLISH_FIXTURE,
      kind: 'notice',
      category: 'subsidy',
      title: `另一条公告_${suffix}`,
      summary: `摘要里有见习补贴词_${suffix}`,
    }, partner)
    ids.push(titleHit.id, summaryHit.id)
    await publish(titleHit.id)
    await publish(summaryHit.id)

    const idsOf = async (keyword: string, extra?: { category?: string; page?: number; pageSize?: number; scope?: { mode: 'org'; orgId: string | null; state: 'bound' | 'unbound' | 'missing' } }) => {
      const page = await policies.getPublishedPolicies({ keyword, ...extra })
      return { ids: page.data.map((row) => row.id), total: page.pagination.total, scope: page.scope }
    }

    const byTitle = await idsOf(`培训补贴关键词_${suffix}`)
    assert.deepEqual(byTitle.ids, [titleHit.id], '关键词命中标题')
    const bySummary = await idsOf(`见习补贴词_${suffix}`)
    assert.deepEqual(bySummary.ids, [summaryHit.id], '关键词命中摘要')
    const padded = await idsOf(`  培训补贴关键词_${suffix}  `)
    assert.deepEqual(padded.ids, [titleHit.id], '关键词先去掉首尾空白')
    const missed = await idsOf(`没有这条_${suffix}`)
    assert.deepEqual(missed.ids, [], '不包含的关键词不命中')
    assert.equal(missed.total, 0)
    const blank = await idsOf('   ')
    assert.ok(blank.ids.includes(titleHit.id) && blank.ids.includes(openEnded.id), '空白关键词等于不筛选')
    await expectCode(
      () => policies.getPublishedPolicies({ keyword: '字'.repeat(31) }),
      'POLICY_KEYWORD_TOO_LONG',
      '关键词超过 30 字',
    )
    const atLimit = await policies.getPublishedPolicies({ keyword: '字'.repeat(30) })
    assert.equal(atLimit.pagination.total, 0, '刚好 30 字可以查，只是没有这么长的标题')
    const withCategory = await idsOf(`_${suffix}`, { category: 'training' })
    assert.deepEqual(withCategory.ids, [titleHit.id], '关键词和类别一起生效')
    const pageOne = await idsOf(`_${suffix}`, { page: 1, pageSize: 1 })
    const pageTwo = await idsOf(`_${suffix}`, { page: 2, pageSize: 1 })
    assert.equal(pageOne.ids.length, 1)
    assert.ok(pageOne.total >= 2, '关键词结果要分页，总数和当页分开')
    assert.equal(pageTwo.total, pageOne.total)
    assert.notEqual(pageTwo.ids[0], pageOne.ids[0])
    const ownOrg = await idsOf(`培训补贴关键词_${suffix}`, { scope: { mode: 'org', orgId, state: 'bound' } })
    assert.deepEqual(ownOrg.ids, [titleHit.id], '关键词和本机构范围一起生效')
    assert.equal(ownOrg.scope, 'bound')
    const otherOrg = await idsOf(`培训补贴关键词_${suffix}`, { scope: { mode: 'org', orgId: `org_other_${suffix}`, state: 'bound' } })
    assert.deepEqual(otherOrg.ids, [], '别的机构范围里搜不到这条')
    await prisma.policyPost.update({ where: { id: titleHit.id }, data: { validThrough: new Date(`${yesterday}T00:00:00.000Z`) } })
    const expiredHit = await idsOf(`培训补贴关键词_${suffix}`)
    assert.deepEqual(expiredHit.ids, [], '过了截止日期的政策按关键词也搜不到')
    console.log('  PASS 关键词命中、不命中、超长、和类别一起、过期搜不到')

    const own = { mode: 'org' as const, orgId, state: 'bound' as const }
    const seedPublished = async (
      title: string,
      summary: string | null,
      extra?: { category?: string; validThrough?: Date | null; createdAt?: Date },
    ) => {
      const row = await prisma.policyPost.create({
        data: {
          sourceOrgId: orgId,
          sourceName: org.name,
          kind: 'notice',
          category: extra?.category ?? 'announcement',
          title,
          summary,
          reviewStatus: 'approved',
          publishStatus: 'published',
          externalUrl: POLICY_PUBLISH_FIXTURE.externalUrl,
          whoCanApply: POLICY_PUBLISH_FIXTURE.whoCanApply,
          requiredMaterials: POLICY_PUBLISH_FIXTURE.requiredMaterials,
          whereToApply: POLICY_PUBLISH_FIXTURE.whereToApply,
          ...(extra?.validThrough !== undefined ? { validThrough: extra.validThrough } : {}),
          ...(extra?.createdAt ? { createdAt: extra.createdAt } : {}),
        },
      })
      ids.push(row.id)
      return row.id
    }
    const literalPage = (keyword: string, extra?: { category?: string; page?: number; pageSize?: number }) =>
      policies.getPublishedPolicies({ keyword, scope: own, pageSize: extra?.pageSize ?? 50, page: extra?.page, category: extra?.category })
    const assertLiteralSet = async (keyword: string, expected: string[], extra?: { category?: string }) => {
      const page = await literalPage(keyword, extra)
      const needle = keyword.trim()
      const got = page.data.map((row) => row.id).sort()
      assert.deepEqual(got, [...expected].sort(), `关键词 ${JSON.stringify(keyword)} 命中集合不对`)
      assert.equal(page.pagination.total, expected.length, `关键词 ${JSON.stringify(keyword)} 总数不对`)
      for (const row of page.data) {
        assert.ok(
          row.title.includes(needle) || (row.summary ?? '').includes(needle),
          `${row.id} 的标题和摘要都不含字面 ${JSON.stringify(needle)}`,
        )
      }
    }

    const percentTitle = await seedPublished(`百分号%字面${suffix}`, '这条摘要没有百分号')
    const hundred = await seedPublished(`报价100%整${suffix}`, '没有通配', { category: 'notice' })
    const hundredX = await seedPublished(`报价100X整${suffix}`, '不该被百分号命中')
    const underscoreTitle = await seedPublished(`下划_线${suffix}`, '摘要没有下划线')
    const backslashTitle = await seedPublished(`反斜\\杠${suffix}`, '摘要没有反斜杠')
    const ab = await seedPublished(`标记A_B${suffix}`, '下划线夹在字母中间')
    const axb = await seedPublished(`标记AXB${suffix}`, '中间是字母不是下划线')
    const aSlashB = await seedPublished(`标记A\\B${suffix}`, '中间是反斜杠')
    const oreilly = await seedPublished(`书名O'Reilly${suffix}`, '撇号按字面')
    const summaryPercent = await seedPublished(`摘要侧${suffix}`, `只有%在摘要${suffix}`)
    const pageIds: string[] = []
    for (let index = 1; index <= 12; index += 1) {
      pageIds.push(await seedPublished(`页%${suffix}#${String(index).padStart(2, '0')}`, '分页夹具'))
    }
    const pageDecoy = await seedPublished(`页X${suffix}#00`, '分页对照，不含百分号')
    const percentIds = [percentTitle, hundred, summaryPercent, ...pageIds]
    const underscoreIds = [underscoreTitle, ab, openEnded.id, dated.id, summaryHit.id]

    await assertLiteralSet('%', percentIds)
    assert.equal((await literalPage('%')).data.some((row) => row.id === hundredX), false)
    await assertLiteralSet('_', underscoreIds)
    await assertLiteralSet('\\', [backslashTitle, aSlashB])
    await assertLiteralSet('100%', [hundred])
    assert.equal((await literalPage('100%')).data.some((row) => row.id === hundredX), false, '100% 不得命中 100X')
    await assertLiteralSet('A_B', [ab])
    const abPage = await literalPage('A_B')
    assert.equal(abPage.data.some((row) => row.id === axb || row.id === aSlashB), false, 'A_B 不得命中 AXB 或 A\\B')
    await assertLiteralSet("O'Reilly", [oreilly])
    const paddedPercent = await literalPage('  100%  ')
    const plainPercent = await literalPage('100%')
    assert.deepEqual(
      paddedPercent.data.map((row) => row.id),
      plainPercent.data.map((row) => row.id),
      '首尾空白去掉后与 100% 同一命中集合',
    )
    assert.equal(paddedPercent.pagination.total, plainPercent.pagination.total)
    const withNotice = await literalPage('%', { category: 'notice' })
    assert.deepEqual(withNotice.data.map((row) => row.id), [hundred], '字面关键词仍和类别一起生效')

    const seen = new Set<string>()
    for (let page = 1; page <= 3; page += 1) {
      const result = await literalPage(`页%${suffix}`, { page, pageSize: 5 })
      assert.equal(result.pagination.total, 12, '命中 12 条时总数保持 12')
      assert.equal(result.data.length, page === 3 ? 2 : 5, `第 ${page} 页条数不对`)
      for (const row of result.data) {
        assert.equal(seen.has(row.id), false, '三页不得重复')
        seen.add(row.id)
        assert.ok(row.title.includes(`页%${suffix}`))
      }
    }
    assert.equal(seen.size, 12)
    assert.equal(seen.has(pageDecoy), false, '页X 不得进入页%的分页')
    await prisma.policyPost.update({ where: { id: pageIds[0] }, data: { validThrough: new Date(`${yesterday}T00:00:00.000Z`) } })
    const afterDeadline = await literalPage(`页%${suffix}`, { pageSize: 20 })
    assert.equal(afterDeadline.pagination.total, 11, '过了截止日期的一条要退出字面关键词结果')
    assert.equal(afterDeadline.data.some((row) => row.id === pageIds[0]), false)
    console.log('  PASS 关键词按字面匹配，通配符、撇号、分页和截止日期一起生效')

    const caseMarker = `Q${suffix}`
    const aiUpper = await seedPublished(`课程AI${caseMarker}`, '大写英文字母')
    const aiLower = await seedPublished(`课程ai${caseMarker}`, '小写英文字母')
    const oreillyLower = await seedPublished(`书名o'reilly${suffix}`, '小写撇号')
    const chineseHit = await seedPublished(`汉字对照${caseMarker}`, '中文按字面')
    const chineseMiss = await seedPublished(`汉子对照${caseMarker}`, '中文差一个字')
    const percentUpper = await seedPublished(`比率AI%${caseMarker}`, '百分号大写')
    const percentLower = await seedPublished(`比率ai%${caseMarker}`, '百分号小写')
    const percentWild = await seedPublished(`比率AIX${caseMarker}`, '百分号不是通配')
    // 应命中的 id 按规格手写。不调用比较函数：函数把 É 折掉，或普通词又跳过内存精筛，集合会对不上。
    const assertCaseFold = async (keyword: string, expected: string[]) => {
      const page = await literalPage(keyword)
      const got = page.data.map((row) => row.id).sort()
      assert.deepEqual(got, [...expected].sort(), `关键词 ${JSON.stringify(keyword)} 在 ${prisma.dbKind} 上的命中集合不对`)
      assert.equal(page.pagination.total, expected.length, `关键词 ${JSON.stringify(keyword)} 在 ${prisma.dbKind} 上的总数不对`)
    }
    const cafeUpper = await seedPublished(`店名Cafe${caseMarker}`, '普通词大写')
    const cafeLower = await seedPublished(`店名cafe${caseMarker}`, '普通词小写')
    const cafeIds = [cafeUpper, cafeLower]
    await assertCaseFold(`Cafe${caseMarker}`, cafeIds)
    await assertCaseFold(`cafe${caseMarker}`, cafeIds)
    const ecoleUpper = await seedPublished(`学校École${caseMarker}`, '大写重音按字面')
    const ecoleLower = await seedPublished(`学校école${caseMarker}`, '小写重音按字面')
    // É 与 é 按字面。École 和 ÉCOLE 只差 A-Z，都只命中大写 É 那一条。école 只命中小写 é 那一条。
    await assertCaseFold(`École${caseMarker}`, [ecoleUpper])
    await assertCaseFold(`école${caseMarker}`, [ecoleLower])
    await assertCaseFold(`ÉCOLE${caseMarker}`, [ecoleUpper])
    const aiIds = [aiUpper, aiLower]
    await assertCaseFold(`AI${caseMarker}`, aiIds)
    await assertCaseFold(`ai${caseMarker}`, aiIds)
    const oreillyIds = [oreilly, oreillyLower]
    await assertCaseFold("O'Reilly", oreillyIds)
    await assertCaseFold("o'reilly", oreillyIds)
    await assertCaseFold(`汉字对照${caseMarker}`, [chineseHit])
    assert.equal((await literalPage(`汉字对照${caseMarker}`)).data.some((row) => row.id === chineseMiss), false, '中文不得按形近字命中')
    const percentCaseIds = [percentUpper, percentLower]
    await assertCaseFold(`AI%${caseMarker}`, percentCaseIds)
    await assertCaseFold(`ai%${caseMarker}`, percentCaseIds)
    assert.equal((await literalPage(`AI%${caseMarker}`)).data.some((row) => row.id === percentWild), false, '含 % 的关键词不得把百分号当成通配')

    const ePercentUpper = await seedPublished(`比率É%${caseMarker}`, '重音百分号大写')
    const ePercentLower = await seedPublished(`比率é%${caseMarker}`, '重音百分号小写')
    const abLower = await seedPublished(`标记a_b${caseMarker}`, '下划线小写')
    await assertCaseFold(`É%${caseMarker}`, [ePercentUpper])
    await assertCaseFold(`é%${caseMarker}`, [ePercentLower])
    // 上面的 A_B 断言发生在这条小写夹具写入之前，期望仍是当时那一条。这里两种写法都要命中两条。
    await assertCaseFold('A_B', [ab, abLower])
    await assertCaseFold('a_b', [ab, abLower])
    await assertCaseFold('100%', [hundred])
    console.log(`  PASS 关键词只折英文字母（${prisma.dbKind}：École/école/ÉCOLE、É%、Cafe/cafe、AI/ai、O'Reilly/o'reilly、A_B、100%、汉字）`)

    const stillPrintable = await seedPublished(`清单仍有效_${suffix}`, '可以打印')
    const expiredPrintable = await seedPublished(`清单已过期_${suffix}`, '不能打印', {
      validThrough: new Date(`${yesterday}T00:00:00.000Z`),
    })
    const makeChecklistFile = async (policyId: string) => {
      const fileId = `file_pl1_${randomUUID().replace(/-/g, '').slice(0, 16)}`
      await prisma.fileObject.create({
        data: {
          id: fileId,
          storageKey: `verify-pl1/${fileId}.pdf`,
          filename: '办事清单.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 128,
          sha256: 'a'.repeat(64),
          purpose: 'policy_checklist',
          createdBy: checklistMetadata(policyId, 1),
          status: 'active',
        },
      })
      fileIds.push(fileId)
      return fileId
    }
    const printableFile = await makeChecklistFile(stillPrintable)
    const expiredFile = await makeChecklistFile(expiredPrintable)
    await assertPiiScanned({
      prisma,
      fileId: printableFile,
      requireCompleted: true,
      missingMessage: '缺少隐私检查',
      pendingMessage: '隐私检查未完成',
    })
    await expectCode(
      () => assertPiiScanned({
        prisma,
        fileId: expiredFile,
        requireCompleted: true,
        missingMessage: '缺少隐私检查',
        pendingMessage: '隐私检查未完成',
      }),
      'POLICY_CHECKLIST_WITHDRAWN',
      '过期政策的办事清单在打印建单前被拒',
    )
    console.log('  PASS 打印建单前拒绝已过截止日期的办事清单')

    const boundary = await seedPublished(`跨日截止_${suffix}`, '北京时间跨零点', {
      validThrough: new Date('2026-11-17T00:00:00.000Z'),
    })
    await withFrozenNow(new Date('2026-11-17T15:59:59.999Z'), async () => {
      assert.equal(policyDeadlineThreshold().toISOString(), '2026-11-17T00:00:00.000Z')
      const page = await policies.getPublishedPolicies({ keyword: `跨日截止_${suffix}`, scope: own })
      assert.deepEqual(page.data.map((row) => row.id), [boundary], '北京时间 11 月 17 日 23:59:59.999 仍有效')
    })
    await withFrozenNow(new Date('2026-11-17T16:00:00.000Z'), async () => {
      assert.equal(policyDeadlineThreshold().toISOString(), '2026-11-18T00:00:00.000Z')
      const page = await policies.getPublishedPolicies({ keyword: `跨日截止_${suffix}`, scope: own })
      assert.deepEqual(page.data.map((row) => row.id), [], '北京时间 11 月 18 日 00:00 已过期')
    })
    console.log('  PASS 北京时间跨零点后截止日当天的政策变为过期')

    const redisUrl = process.env['REDIS_URL']?.trim()
    if (!redisUrl) throw new Error('REDIS_URL is required for the community cache deadline check')
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, connectTimeout: 2_000 })
    const community = new CommunityService(prisma, new RedisService(redis))
    const cachedPolicy = await seedPublished(`社区跨日_${suffix}`, '缓存里的政策', {
      validThrough: new Date('2026-11-17T00:00:00.000Z'),
      createdAt: new Date('2099-01-01T00:00:00.000Z'),
    })
    const hostingKey = isRecruitmentContentHostingEnabled() ? 'hosting' : 'closed'
    const eveningKey = communityFeedCacheKey(hostingKey, { mode: 'all' }, undefined, 20, '2026-11-17')
    redisKeys.push(eveningKey)
    await withFrozenNow(new Date('2026-11-17T15:59:59.000Z'), async () => {
      const page = await community.list(undefined, 20)
      assert.ok(page.items.some((item) => item.id === `policy:${cachedPolicy}`), '北京时间当天 23:59:59 社区动态仍包含这条政策')
    })
    const cachedRaw = await redis.get(eveningKey)
    assert.ok(cachedRaw?.includes(`policy:${cachedPolicy}`), '当天的缓存里确实有这条政策')
    const cachedTtl = await redis.ttl(eveningKey)
    assert.ok(cachedTtl > 60, `当天缓存应还剩大半个 900 秒窗口，实际 TTL ${cachedTtl}`)
    await withFrozenNow(new Date('2026-11-17T16:00:00.000Z'), async () => {
      const page = await community.list(undefined, 20)
      assert.equal(page.items.some((item) => item.id === `policy:${cachedPolicy}`), false, '跨过北京时间零点后社区动态不得再返回这条政策')
      await expectCode(() => policies.getPublishedPolicyById(cachedPolicy), 'POLICY_NOT_FOUND', '同一时刻详情已经拒绝')
    })
    const staleAfter = await redis.get(eveningKey)
    assert.ok(staleAfter?.includes(`policy:${cachedPolicy}`), '旧缓存可以留到 TTL，但不得再被读出来')
    assert.ok((await redis.ttl(eveningKey)) > 60, '旧缓存不能靠删键来掩盖跨日问题')
    console.log('  PASS 社区动态缓存跨过北京时间零点不再返回过期政策')

    const auditRow = await seedPublished(`审计同成_${suffix}`, '审计失败必须回滚', {
      validThrough: new Date(`${yesterday}T00:00:00.000Z`),
    })
    const opened = createPrismaClient(process.env['DATABASE_URL'] ?? '')
    await opened.client.$connect()
    ddl = opened.client
    const auditCount = (targetId: string) => prisma.auditLog.count({ where: { action: 'policy.auto_expire', targetId } })
    const installAuditFailure = async (on: boolean) => {
      if (prisma.dbKind === 'sqlite') {
        await opened.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS verify_policy_auto_expire_fail')
        if (!on) return
        await opened.client.$executeRawUnsafe(
          `CREATE TRIGGER verify_policy_auto_expire_fail
           BEFORE INSERT ON "AuditLog"
           WHEN NEW."action" = 'policy.auto_expire'
           BEGIN
             SELECT RAISE(ABORT, 'injected audit insert failure');
           END`,
        )
        return
      }
      await opened.client.$executeRawUnsafe('DROP TRIGGER IF EXISTS verify_policy_auto_expire_fail ON "AuditLog"')
      await opened.client.$executeRawUnsafe('DROP FUNCTION IF EXISTS verify_policy_auto_expire_fail()')
      if (!on) return
      await opened.client.$executeRawUnsafe(
        `CREATE FUNCTION verify_policy_auto_expire_fail() RETURNS trigger
         LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW."action" = 'policy.auto_expire' THEN
             RAISE EXCEPTION 'injected audit insert failure';
           END IF;
           RETURN NEW;
         END $$`,
      )
      await opened.client.$executeRawUnsafe(
        `CREATE TRIGGER verify_policy_auto_expire_fail
         BEFORE INSERT ON "AuditLog"
         FOR EACH ROW EXECUTE FUNCTION verify_policy_auto_expire_fail()`,
      )
    }
    await installAuditFailure(true)
    await assert.rejects(
      () => expiry.expirePastDeadline(),
      (error: unknown) => {
        // libsql 把触发器的 SQLITE_CONSTRAINT_TRIGGER 标成外键错误，原文在 driverAdapterError 里。
        assert.match(errorText(error), /injected audit insert failure/)
        return true
      },
    )
    assert.equal((await prisma.policyPost.findUnique({ where: { id: auditRow } }))?.publishStatus, 'published')
    assert.equal(await auditCount(auditRow), 0, '审计没写进去时不得留下过期状态')
    await installAuditFailure(false)
    await expiry.expirePastDeadline()
    assert.equal((await prisma.policyPost.findUnique({ where: { id: auditRow } }))?.publishStatus, 'expired')
    assert.equal(await auditCount(auditRow), 1, '恢复后恰好一条 policy.auto_expire')
    await expiry.expirePastDeadline()
    assert.equal(await auditCount(auditRow), 1, '第三次跑不得再写')
    const raceRow = await seedPublished(`审计并发_${suffix}`, '只有一方写审计', {
      validThrough: new Date(`${yesterday}T00:00:00.000Z`),
    })
    // 两个独立的服务实例，各自一条数据库连接。同一个实例上的 Promise.all 不算两路。
    const peers: PrismaService[] = []
    try {
      const leftDb = new PrismaService()
      peers.push(leftDb)
      const rightDb = new PrismaService()
      peers.push(rightDb)
      await leftDb.onModuleInit()
      await rightDb.onModuleInit()
      const runExpiry = async (db: PrismaService): Promise<number> => {
        try {
          return await new PolicyExpiryTask(db, new AuditService(db)).expirePastDeadline()
        } catch (error) {
          // 两条延迟事务同时升级写锁时，SQLite 立刻给没抢到的一方 SQLITE_BUSY，事务不提交。
          // PostgreSQL 会等到对方提交，再按条件更新得到 0，不会进这里。
          if (prisma.dbKind === 'sqlite' && isSqliteBusy(error)) return 0
          throw error
        }
      }
      const [left, right] = await Promise.all([runExpiry(leftDb), runExpiry(rightDb)])
      assert.equal(left + right, 1, '并发下只有一方把这一行改成功')
      assert.equal((await prisma.policyPost.findUnique({ where: { id: raceRow } }))?.publishStatus, 'expired')
      assert.equal(await auditCount(raceRow), 1, '并发下只写一条审计')
    } finally {
      await Promise.all(peers.map((peer) => peer.onModuleDestroy().catch(() => undefined)))
    }
    console.log('  PASS 到期下架与审计同成同败，两个实例并发只写一条')

    console.log('PASS verify:policy-expiry')
  } finally {
    try {
      if (ddl) {
        if (prisma.dbKind === 'sqlite') {
          await ddl.$executeRawUnsafe('DROP TRIGGER IF EXISTS verify_policy_auto_expire_fail')
        } else {
          await ddl.$executeRawUnsafe('DROP TRIGGER IF EXISTS verify_policy_auto_expire_fail ON "AuditLog"')
          await ddl.$executeRawUnsafe('DROP FUNCTION IF EXISTS verify_policy_auto_expire_fail()')
        }
      }
    } catch (error) {
      console.error('drop audit injection failed', error)
    }
    if (redis) {
      if (redisKeys.length > 0) await redis.del(...redisKeys).catch(() => undefined)
      await redis.quit().catch(() => redis?.disconnect())
    }
    await ddl?.$disconnect().catch(() => undefined)
    if (fileIds.length > 0) await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: { in: ids } }, { actorId: userRow.id }] } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: orgId } })
    await prisma.user.deleteMany({ where: { id: userRow.id } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
