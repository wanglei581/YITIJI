/**
 * 阶段1C — Partner 岗位/招聘会编辑能力验证。
 *
 * 覆盖(对应需求验收点):
 *   1. 岗位编辑:字段落库;编辑后强制 reviewStatus=pending、publishStatus=draft、
 *      rejectReason 清空(已发布数据改完即从终端撤下,必须重审)。
 *   2. 来源不可改:externalId / sourceOrgId / sourceName 编辑后保持不变。
 *   3. 越权:编辑他机构数据 → JOB_NOT_FOUND / FAIR_NOT_FOUND(不区分原因,防枚举)。
 *   4. 机构停用 → PARTNER_ORG_NOT_FOUND(写入闸)。
 *   5. 招聘会编辑:同岗位;endAt <= startAt → INVALID_DATE_RANGE。
 *   6. Kiosk 不可见:编辑后的岗位/招聘会不再出现在已发布公开列表。
 *   7. 审计:job.partner_update / fair.partner_update 落 AuditLog(actorRole=partner,
 *      含 changedFields 与原状态)。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:partner-edit
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { JobQualityService } from '../src/job-ai/job-quality.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JobsAdminService } from '../src/jobs/jobs-admin.service'
import { JobsPartnerService } from '../src/jobs/jobs-partner.service'
import { JobsExcelService } from '../src/jobs/jobs-excel.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

// 稳定且唯一的残留标记(跨运行不变):嵌进两个机构 id 与 partner username,开始前预清 + finally 再清。
const RESIDUE_TAG = 'vresidpartneredit'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望错误 ${code},但调用成功`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code},实际: ${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== 阶段1C Partner 编辑能力验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const _jobQuality = new JobQualityService(prisma)
  const _kiosk = new JobsKioskService(prisma)
  const _admin = new JobsAdminService(prisma, audit)
  const _partner = new JobsPartnerService(prisma, audit, _jobQuality)
  const _excel = new JobsExcelService(prisma, audit, _jobQuality)
  const svc = new JobsService(_kiosk, _admin, _partner, _excel)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag)。
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgA = `org_vpe_a_${RESIDUE_TAG}_${suffix}`
  const orgB = `org_vpe_b_${RESIDUE_TAG}_${suffix}`

  await prisma.organization.createMany({
    data: [
      { id: orgA, name: `机构A_${suffix}`, type: 'public_employment_service' },
      { id: orgB, name: `机构B_${suffix}`, type: 'school_employment_center' },
    ],
  })

  const partnerRow = await prisma.user.create({
    data: { username: `${RESIDUE_TAG}_partner_${suffix}`, passwordHash: 'x', name: '验证机构账号', role: 'partner', orgId: orgA },
  })
  const partnerA: AuthedUser = { userId: partnerRow.id, role: 'partner', orgId: orgA }

  // 已审核已发布的岗位(编辑后必须撤下重审)
  const jobA = await prisma.job.create({
    data: {
      sourceOrgId: orgA, externalId: `VPE-JOB-${suffix}`, sourceName: `机构A_${suffix}`,
      sourceUrl: 'https://example.org/job', title: '验证岗位', company: '验证公司', city: '验证市',
      tagsJson: '[]', reviewStatus: 'approved', publishStatus: 'published', rejectReason: null,
    },
  })
  const jobB = await prisma.job.create({
    data: {
      sourceOrgId: orgB, externalId: `VPE-JOB-B-${suffix}`, sourceName: `机构B_${suffix}`,
      sourceUrl: 'https://example.org/job-b', title: '他机构岗位', company: '他公司', city: '验证市',
      tagsJson: '[]', reviewStatus: 'approved', publishStatus: 'published',
    },
  })
  const fairA = await prisma.jobFair.create({
    data: {
      sourceOrgId: orgA, externalId: `VPE-FAIR-${suffix}`, sourceName: `机构A_${suffix}`,
      sourceUrl: 'https://example.org/fair', title: '验证招聘会', theme: 'general',
      startAt: new Date(Date.now() + 86400_000), endAt: new Date(Date.now() + 90000_000),
      venue: '验证展馆', city: '验证市',
      reviewStatus: 'approved', publishStatus: 'published',
    },
  })

  // 按稳定 tag 清理:两个机构名下 job/fair(级联子资源)+ 该 tag 的 partner 账号及审计日志 + 机构。
  const cleanup = async () => cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  try {
    // ── 1+2. 岗位编辑 + 强制重审 + 来源不可改 ─────────────────────────────
    {
      const updated = await svc.updatePartnerJob(
        jobA.id,
        { title: '验证岗位(改)', salary: '8k-12k', tags: ['五险一金'], workType: 'internship' },
        partnerA,
      )
      if (updated.title !== '验证岗位(改)' || updated.salary !== '8k-12k') fail('1. 编辑字段未落库')
      if (updated.reviewStatus !== 'pending' || updated.publishStatus !== 'draft') {
        fail(`1. 编辑后未回 pending+draft: ${updated.reviewStatus}/${updated.publishStatus}`)
      }
      const row = await prisma.job.findUnique({ where: { id: jobA.id } })
      if (row!.category !== 'intern') fail('1. workType→category 映射未生效')
      if (row!.rejectReason !== null || row!.reviewedBy !== null) fail('1. 审核痕迹未清空')
      pass('1. 岗位编辑落库 + 强制回 pending+draft 重审')

      if (updated.externalId !== `VPE-JOB-${suffix}` || updated.sourceOrgId !== orgA || updated.sourceName !== `机构A_${suffix}`) {
        fail('2. 来源字段被意外改动')
      }
      pass('2. externalId / sourceOrgId / sourceName 不可改')
    }

    // ── 3. 越权 ────────────────────────────────────────────────────────────
    await expectCode(() => svc.updatePartnerJob(jobB.id, { title: 'x' }, partnerA), 'JOB_NOT_FOUND', '3a. 编辑他机构岗位 → JOB_NOT_FOUND')
    await expectCode(() => svc.updatePartnerFair('no_such_fair', { title: 'x' }, partnerA), 'FAIR_NOT_FOUND', '3b. 编辑不存在招聘会 → FAIR_NOT_FOUND')

    // ── 4. 机构停用闸 ──────────────────────────────────────────────────────
    {
      await prisma.organization.update({ where: { id: orgA }, data: { enabled: false } })
      await expectCode(() => svc.updatePartnerJob(jobA.id, { title: 'x' }, partnerA), 'PARTNER_ORG_NOT_FOUND', '4. 机构停用后编辑被拒')
      await prisma.organization.update({ where: { id: orgA }, data: { enabled: true } })
    }

    // ── 5. 招聘会编辑 ──────────────────────────────────────────────────────
    {
      const updated = await svc.updatePartnerFair(fairA.id, { title: '验证招聘会(改)', venue: '新展馆' }, partnerA)
      if (updated.name !== '验证招聘会(改)' || updated.venue !== '新展馆') fail('5. 招聘会编辑未落库')
      if (updated.reviewStatus !== 'pending' || updated.publishStatus !== 'draft') fail('5. 招聘会编辑后未回 pending+draft')
      pass('5a. 招聘会编辑落库 + 强制重审')

      await expectCode(
        () => svc.updatePartnerFair(fairA.id, {
          startAt: new Date(Date.now() + 90000_000).toISOString(),
          endAt: new Date(Date.now() + 86400_000).toISOString(),
        }, partnerA),
        'INVALID_DATE_RANGE',
        '5b. 结束时间早于开始时间被拒',
      )
    }

    // ── 6. Kiosk 不可见 ────────────────────────────────────────────────────
    {
      const jobs = await svc.getPublishedJobs({ keyword: '验证岗位' })
      if (jobs.data.some((j) => j.id === jobA.id)) fail('6. 编辑后的岗位仍出现在公开列表')
      const fair = await svc.getPublishedFairById(fairA.id)
      if (fair.data !== null) fail('6. 编辑后的招聘会仍可公开读取')
      pass('6. 编辑后的岗位/招聘会从 Kiosk 公开数据撤下(待重审)')
    }

    // ── 7. 审计 ────────────────────────────────────────────────────────────
    {
      const logs = await prisma.auditLog.findMany({ where: { actorId: partnerA.userId } })
      const jobLog = logs.find((l) => l.action === 'job.partner_update')
      const fairLog = logs.find((l) => l.action === 'fair.partner_update')
      if (!jobLog || !fairLog) fail(`7. 缺少审计动作;实际: ${logs.map((l) => l.action).join(', ')}`)
      if (jobLog.actorRole !== 'partner') fail('7. 审计 actorRole 应为 partner')
      if (!String(jobLog.payloadJson ?? '').includes('changedFields')) fail('7. 审计 payload 缺 changedFields')
      pass('7. partner_update 审计齐全(actorRole=partner + changedFields)')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
