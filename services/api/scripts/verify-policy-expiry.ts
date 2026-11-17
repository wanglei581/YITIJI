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
    assert.equal(await expiry.expirePublishedPastDeadline(), 0, '截止日期当天不能被定时任务下架')
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

    const marked = await expiry.expirePublishedPastDeadline()
    assert.equal(marked, 1, '定时任务只把已发布且过期的那一条写成 expired')
    assert.equal((await prisma.policyPost.findUnique({ where: { id: dated.id } }))?.publishStatus, 'expired')
    assert.equal((await prisma.policyPost.findUnique({ where: { id: draft.id } }))?.publishStatus, 'draft', '草稿即使日期已过也不改状态')
    const audits = () => prisma.auditLog.count({ where: { action: 'policy.auto_expire', targetId: dated.id } })
    assert.equal(await audits(), 1, '定时任务要写 policy.auto_expire')
    assert.equal(await expiry.expirePublishedPastDeadline(), 0)
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
