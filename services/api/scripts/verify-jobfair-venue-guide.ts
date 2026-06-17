/**
 * 招聘会场馆导览验证。
 *
 * 覆盖(对应需求验收点):
 *   1. Admin 保存导览(展厅+绑定企业+设施) → 持久化成功,返回完整 DTO。
 *   2. Kiosk 读取已发布招聘会 venue-guide 成功:含展厅/企业(岗位摘要为真实 FairCompanyPosition 统计)/设施。
 *   3. 招聘会不存在:Admin → FAIR_NOT_FOUND;Kiosk → data null。
 *   4. 无导览配置 → data null(可被前端识别的空态)。
 *   5. 未发布招聘会:Kiosk → data null(不泄露未发布数据)。
 *   6. 绑定非本招聘会的企业 → COMPANY_NOT_IN_FAIR 拒绝。
 *   7. 展厅编码重复 → HALL_CODE_DUPLICATE 拒绝。
 *   8. 更新(再次 PUT)整体替换:旧展厅消失,新展厅生效。
 *   9. 删除导览 → Kiosk 读到空;级联清理 halls/facilities。
 *   10. Kiosk DTO 不含内部字段(guideId/createdAt/审计字段)。
 *   11. Admin 写接口声明 @Roles('admin')(源码级断言,运行时由全局 Guard 体系保障)。
 *   12. 审计:fair.venue_guide.save / delete 落 AuditLog。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:jobfair-venue-guide
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

if (!process.env['FILE_SIGNING_SECRET'] || process.env['FILE_SIGNING_SECRET'].length < 32) {
  process.env['FILE_SIGNING_SECRET'] = 'verify-venue-guide-test-secret-0123456789abc'
}
process.env['FILE_STORAGE_DRIVER'] = 'local'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

// 稳定且唯一的残留标记(跨运行不变):嵌进机构 id 与管理员 username,开始前预清 + finally 再清。
const RESIDUE_TAG = 'vresidvenueguide'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exitCode = 1; throw new Error(m) }

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

async function main(): Promise<void> {
  console.log('\n=== 招聘会场馆导览验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const svc = new AdminFairsService(prisma, audit, storage)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag)。
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_vvg_${RESIDUE_TAG}_${suffix}`
  const adminRow = await prisma.user.create({
    data: { username: `${RESIDUE_TAG}_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const admin: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  await prisma.organization.create({ data: { id: orgId, name: `验证机构_${suffix}`, type: 'gov' } })
  const mkFair = (ext: string, published: boolean) =>
    prisma.jobFair.create({
      data: {
        sourceOrgId: orgId, externalId: ext, sourceName: '验证来源', sourceUrl: 'https://example.org/f',
        title: `验证导览招聘会_${ext}`, theme: 'campus',
        startAt: new Date(Date.now() + 86400_000), endAt: new Date(Date.now() + 90000_000),
        venue: '验证体育馆', city: '验证市',
        reviewStatus: published ? 'approved' : 'pending',
        publishStatus: published ? 'published' : 'draft',
      },
    })
  const fairPub = await mkFair(`VVG-PUB-${suffix}`, true)
  const fairDraft = await mkFair(`VVG-DRAFT-${suffix}`, false)

  // 本会企业(带岗位) + 另一会企业(用于跨会绑定拒绝)
  const companyA = await prisma.fairCompany.create({
    data: {
      jobFairId: fairPub.id, name: '验证科技公司', industry: 'internet',
      positions: { create: [
        { title: '前端工程师', sortOrder: 0 },
        { title: '算法工程师', sortOrder: 1 },
        { title: '测试工程师', sortOrder: 2 },
        { title: '产品经理', sortOrder: 3 },
      ] },
    },
  })
  const companyB = await prisma.fairCompany.create({
    data: { jobFairId: fairPub.id, name: '验证金融公司', industry: 'finance' },
  })
  const foreignCompany = await prisma.fairCompany.create({
    data: { jobFairId: fairDraft.id, name: '别家招聘会的公司' },
  })

  const baseInput = {
    venueName: '验证体育馆',
    halls: [
      {
        hallCode: 'A', hallName: 'A 厅', industryCategory: '互联网与人工智能',
        description: '互联网相关企业集中展区', boothRange: 'A01-A30', sortOrder: 0,
        companies: [{ fairCompanyId: companyA.id, boothNo: 'A08', sortOrder: 0 }],
      },
      {
        hallCode: 'B', hallName: 'B 厅', industryCategory: '金融与现代服务',
        boothRange: 'B01-B20', sortOrder: 1,
        companies: [{ fairCompanyId: companyB.id, boothNo: 'B02', sortOrder: 0 }],
      },
    ],
    facilities: [
      { type: 'entrance', name: '主入口', locationLabel: '南门入口', relatedHallCode: 'A', sortOrder: 0 },
      { type: 'printPoint', name: '自助打印点', locationLabel: '服务台旁', relatedHallCode: 'B', sortOrder: 1 },
    ],
  }

  // 按稳定 tag 清理:机构名下 fair(级联清 guide/halls/companies/positions)+ 该 tag 的管理员及审计日志 + 机构。
  const cleanup = async () => cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  try {
    // ── 4. 无配置 → data null(空态) ───────────────────────────────────────
    {
      const adminView = await svc.getVenueGuideAdmin(fairPub.id)
      const kioskView = await svc.getPublishedVenueGuide(fairPub.id)
      if (adminView.data !== null || kioskView.data !== null) fail('4. 未配置应返回 data null')
      pass('4. 无导览配置 → data null(前端可识别空态)')
    }

    // ── 1+2. 保存 + Kiosk 读取 ─────────────────────────────────────────────
    {
      const saved = await svc.saveVenueGuide(fairPub.id, baseInput as never, admin)
      if (saved.halls.length !== 2 || saved.facilities.length !== 2) fail('1. 保存结构不完整')
      pass('1. Admin 保存导览(2 厅 + 2 设施 + 企业绑定)成功')

      const { data } = await svc.getPublishedVenueGuide(fairPub.id)
      if (!data) fail('2. Kiosk 读取失败')
      if (data.venueName !== '验证体育馆') fail('2. venueName 错误')
      const hallA = data.halls.find((h) => h.hallCode === 'A')
      if (!hallA || hallA.companyCount !== 1) fail('2. A 厅企业计数错误')
      const companyDto = hallA.companies[0]
      if (companyDto.companyName !== '验证科技公司' || companyDto.boothNo !== 'A08') fail('2. 企业绑定信息错误')
      if (companyDto.jobCount !== 4) fail(`2. 岗位数应为真实统计 4,实际 ${companyDto.jobCount}`)
      if (companyDto.jobTitles.length !== 3 || companyDto.jobTitles[0] !== '前端工程师') {
        fail(`2. 岗位摘要应为前 3 条标题: ${JSON.stringify(companyDto.jobTitles)}`)
      }
      if (data.facilities.length !== 2 || data.facilities[0].type !== 'entrance') fail('2. 设施点位错误')
      pass('2. Kiosk 读取:展厅/企业(真实岗位摘要)/设施齐全')

      // ── 10. 不含内部字段 ─────────────────────────────────────────────────
      const raw = JSON.stringify(data)
      for (const banned of ['guideId', 'createdAt', 'updatedAt', 'reviewedBy', 'sortOrder']) {
        if (raw.includes(`"${banned}"`)) fail(`10. Kiosk DTO 泄露内部字段 ${banned}`)
      }
      pass('10. Kiosk DTO 不含内部/审计字段')
    }

    // ── 3. 招聘会不存在 ────────────────────────────────────────────────────
    await expectCode(() => svc.getVenueGuideAdmin('no_such_fair'), 'FAIR_NOT_FOUND', '3a. Admin 读取不存在招聘会 → FAIR_NOT_FOUND')
    {
      const { data } = await svc.getPublishedVenueGuide('no_such_fair')
      if (data !== null) fail('3b. Kiosk 不存在招聘会应 data null')
      pass('3b. Kiosk 不存在招聘会 → data null')
    }

    // ── 5. 未发布招聘会:Kiosk 不放出 ─────────────────────────────────────
    {
      await svc.saveVenueGuide(fairDraft.id, { ...baseInput, halls: [], facilities: [] } as never, admin)
      const { data } = await svc.getPublishedVenueGuide(fairDraft.id)
      if (data !== null) fail('5. 未发布招聘会的导览不得放出')
      pass('5. 未发布招聘会 → Kiosk data null(不泄露)')
    }

    // ── 6. 跨会企业绑定拒绝 ────────────────────────────────────────────────
    await expectCode(
      () => svc.saveVenueGuide(fairPub.id, {
        ...baseInput,
        halls: [{ ...baseInput.halls[0], companies: [{ fairCompanyId: foreignCompany.id }] }],
        facilities: [], // 设施关联校验(6b)单独覆盖,此处只测企业归属
      } as never, admin),
      'COMPANY_NOT_IN_FAIR',
      '6. 绑定非本招聘会企业 → COMPANY_NOT_IN_FAIR',
    )

    // ── 6b. 设施关联不存在的展厅 → 拒绝(补丁) ────────────────────────────
    await expectCode(
      () => svc.saveVenueGuide(fairPub.id, {
        ...baseInput,
        facilities: [{ type: 'entrance', name: '幽灵入口', relatedHallCode: 'Z' }],
      } as never, admin),
      'FACILITY_HALL_NOT_FOUND',
      '6b. 设施关联不存在展厅(Z) → FACILITY_HALL_NOT_FOUND',
    )

    // ── 6c. 企业跨展厅重复绑定 → 拒绝(补丁) ──────────────────────────────
    await expectCode(
      () => svc.saveVenueGuide(fairPub.id, {
        ...baseInput,
        halls: [
          { ...baseInput.halls[0] },
          { ...baseInput.halls[1], companies: [{ fairCompanyId: companyA.id, boothNo: 'B09' }] },
        ],
      } as never, admin),
      'COMPANY_BOUND_MULTIPLE',
      '6c. 同一企业绑定两个展厅 → COMPANY_BOUND_MULTIPLE',
    )

    // ── 7. 展厅编码重复拒绝 ────────────────────────────────────────────────
    await expectCode(
      () => svc.saveVenueGuide(fairPub.id, {
        ...baseInput,
        halls: [
          { ...baseInput.halls[0] },
          { ...baseInput.halls[1], hallCode: 'a' }, // 大小写归一后与 A 重复
        ],
      } as never, admin),
      'HALL_CODE_DUPLICATE',
      '7. 展厅编码重复(含大小写归一) → HALL_CODE_DUPLICATE',
    )

    // ── 8. 再次 PUT 整体替换 ───────────────────────────────────────────────
    {
      const updated = await svc.saveVenueGuide(fairPub.id, {
        venueName: '验证体育馆·改',
        halls: [{ hallCode: 'C', hallName: 'C 厅', companies: [], sortOrder: 0 }],
        facilities: [],
      } as never, admin)
      if (updated.venueName !== '验证体育馆·改') fail('8. venueName 未更新')
      if (updated.halls.length !== 1 || updated.halls[0].hallCode !== 'C') fail('8. 整体替换未生效')
      const hallCount = await prisma.fairVenueHall.count({
        where: { guide: { jobFairId: fairPub.id } },
      })
      if (hallCount !== 1) fail(`8. 旧展厅未清理,剩余 ${hallCount}`)
      pass('8. 再次保存整体替换:旧展厅清理,新展厅生效')
    }

    // ── 9. 删除导览 ────────────────────────────────────────────────────────
    {
      await svc.deleteVenueGuide(fairPub.id, admin)
      const { data } = await svc.getPublishedVenueGuide(fairPub.id)
      if (data !== null) fail('9. 删除后应读到空')
      const orphans = await prisma.fairVenueHall.count({ where: { guide: { jobFairId: fairPub.id } } })
      if (orphans !== 0) fail('9. halls 未级联清理')
      pass('9. 删除导览 → Kiosk 空态,级联清理生效')
    }

    // ── 13. 审计失败不阻塞保存(补丁断言:AuditService 写失败只 log 不抛) ──
    {
      // 用不存在的 actorId 触发 AuditLog FK 失败:保存必须仍然成功且数据已持久化
      const ghostAdmin: AuthedUser = { userId: `ghost_${suffix}`, role: 'admin', orgId: null }
      const saved = await svc.saveVenueGuide(fairPub.id, {
        venueName: '审计失败容错馆',
        halls: [{ hallCode: 'D', hallName: 'D 厅', companies: [], sortOrder: 0 }],
        facilities: [],
      } as never, ghostAdmin)
      if (saved.venueName !== '审计失败容错馆') fail('13. 审计失败时保存应仍成功')
      const persisted = await prisma.fairVenueGuide.findUnique({ where: { jobFairId: fairPub.id } })
      if (persisted?.venueName !== '审计失败容错馆') fail('13. 数据未持久化')
      pass('13. 审计写失败(actor FK 不存在)不阻塞保存,数据已持久化')
    }

    // ── 11. Admin 写接口 @Roles('admin') 源码断言 ──────────────────────────
    {
      const src = readFileSync(join(__dirname, '../src/jobs/admin-fairs.controller.ts'), 'utf8')
      const idx = src.indexOf("Put('admin/fairs/:id/venue-guide')")
      const before = src.slice(Math.max(0, idx - 300), idx)
      if (idx < 0 || !before.includes("@Roles('admin')") || !before.includes('JwtAuthGuard')) {
        fail('11. venue-guide 写接口缺少 admin 守卫声明')
      }
      pass("11. Admin 写接口声明 JwtAuthGuard + @Roles('admin')(非管理员 403)")
    }

    // ── 12. 审计 ───────────────────────────────────────────────────────────
    {
      const logs = await prisma.auditLog.findMany({ where: { actorId: admin.userId } })
      const actions = new Set(logs.map((l) => l.action))
      for (const expected of ['fair.venue_guide.save', 'fair.venue_guide.delete']) {
        if (!actions.has(expected)) fail(`12. 缺少审计动作 ${expected}`)
      }
      pass('12. venue_guide save/delete 审计落库')
    }

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e.message)
  process.exit(1)
})
