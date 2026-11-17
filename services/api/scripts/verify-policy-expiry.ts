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
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { POLICY_PUBLISH_FIXTURE, POLICY_VERIFIED_DOMAINS_FIXTURE } from './support/policy-publish-fixture'
import { formatBeijingDate } from '../src/common/beijing-display-time'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { PoliciesService } from '../src/policies/policies.service'
import { PolicyExpiryTask } from '../src/policies/policy-expiry.task'
import { PolicyChecklistService } from '../src/policies/policy-checklist.service'
import { AssistantPolicyContextService } from '../src/ai/llm/assistant-policy-context'
import { publicPolicyWhere } from '../src/policies/policy-public-visibility'
import { policyDeadlineThreshold } from '../src/policies/policy-validity'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

assertIsolatedVerificationDatabase()

function shiftCalendar(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function errCode(error: unknown): string | undefined {
  const ex = error as { getResponse?: () => unknown }
  const body = typeof ex.getResponse === 'function' ? ex.getResponse() : undefined
  const record = body && typeof body === 'object' && 'error' in body
    ? (body as { error?: { code?: string } }).error
    : undefined
  return record?.code
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
    console.log('PASS verify:policy-expiry')
  } finally {
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
