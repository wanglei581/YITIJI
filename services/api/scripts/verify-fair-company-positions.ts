/**
 * P1-A② 参展企业岗位明细(FairCompanyPosition)CRUD — 验证。
 *
 * 字段集(Kiosk 企业详情已展示的 9 项;position.sourceUrl 前台不展示,不在本编辑器):
 *   title(必填)/ positionType(full_time|part_time|intern)/ salary / headcount(非负整数)
 *   / education / experience / location / department / requirements
 *
 * 覆盖(对应验收点):
 *   1.  create 写入岗位 → 返回值带回岗位(按 sortOrder 升序);字段如实落库。
 *   2.  sortOrder 按表单行顺序写入(DB 列 0/1/2;读回顺序一致)。
 *   3.  getFairDetail 回填:company.positions 与写入一致(Admin 详情可读回,含 seed 已有岗位的 include 修复)。
 *   4.  update 全量替换:新岗位集替换旧集(增/删/改/重排都生效)。
 *   5.  清空:update positions=[] → 该企业无岗位行(DB 0 行)。
 *   6.  空标题行过滤:含空 title 行 → service 过滤,只存非空行。
 *   7.  Kiosk 公开读取(无新增 UI):getFairCompanyById / getFairCompanies 带出岗位。
 *   8.  DTO 校验(class-validator):空 title / 负 headcount / 非整数 headcount / 非法 positionType 被拒;合法通过。
 *   9.  审计:fair.company.create / fair.company.update 落 AuditLog(payload 含 positionCount)。
 *   10. 级联删:deleteCompany → 该企业岗位行被级联删除。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:fair-company-positions
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

process.env['FILE_STORAGE_DRIVER'] = 'local'

import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import { FairMaterialPrintBridgeService } from '../src/jobs/fair-material-print-bridge.service'
import { JobsService } from '../src/jobs/jobs.service'
import { SaveFairCompanyDto } from '../src/jobs/dto/admin-fair.dto'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

// 稳定且唯一的残留标记(跨运行不变):嵌进机构 id 与管理员 username,开始前预清 + finally 再清。
const RESIDUE_TAG = 'vresidcompos'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }
const json = (v: unknown) => JSON.stringify(v)

async function expectValid(plain: Record<string, unknown>, label: string): Promise<void> {
  const errors = await validate(plainToInstance(SaveFairCompanyDto, plain))
  if (errors.length > 0) fail(`${label} — 期望校验通过,实际报错: ${json(errors.map((e) => e.property))}`)
  pass(label)
}
async function expectInvalid(plain: Record<string, unknown>, label: string): Promise<void> {
  const errors = await validate(plainToInstance(SaveFairCompanyDto, plain))
  if (errors.length === 0) fail(`${label} — 期望校验失败,但通过了`)
  pass(label)
}

async function main() {
  console.log('\n=== P1-A② 参展企业岗位明细 CRUD 验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const files = new FilesService(prisma, audit, storage)
  const bridge = new FairMaterialPrintBridgeService(prisma, storage, files)
  const svc = new AdminFairsService(prisma, audit, storage, bridge)
  const jobs = new JobsService(prisma, audit)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag)。
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_vcp_${RESIDUE_TAG}_${suffix}`

  const adminRow = await prisma.user.create({
    data: { username: `${RESIDUE_TAG}_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const adminUser: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  await prisma.organization.create({ data: { id: orgId, name: `验证机构_${suffix}`, type: 'gov' } })
  // approved + published:满足 Kiosk 公开读取门槛。
  const fair = await prisma.jobFair.create({
    data: {
      sourceOrgId: orgId, externalId: `VCP-${suffix}`, sourceName: '验证来源', sourceUrl: 'https://example.org/vcp',
      title: '验证招聘会', theme: 'general',
      startAt: new Date(Date.now() + 86400_000), endAt: new Date(Date.now() + 90000_000),
      venue: '验证展馆', city: '验证市',
      reviewStatus: 'approved', publishStatus: 'published',
    },
  })

  // 按稳定 tag 清理:机构名下 fair(级联删 FairCompany/Position 等)+ 该 tag 的管理员及审计日志 + 机构。
  const cleanup = async () => cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  // PrismaService 经组合暴露 model delegate,未暴露顶层 fairCompanyPosition;
  // 经 fairCompany.include 读岗位(含 sortOrder),避免依赖未暴露的 delegate。
  const readPositions = async (cid: string) =>
    (await prisma.fairCompany.findUnique({ where: { id: cid }, include: { positions: { orderBy: { sortOrder: 'asc' } } } }))?.positions ?? []

  const P_FE = {
    title: '前端工程师', positionType: 'full_time', salary: '15-25K', headcount: 3,
    education: '本科', experience: '3-5年', location: '青岛', department: '研发中心', requirements: '熟悉 React/TS',
  }
  const P_INTERN = { title: '产品实习生', positionType: 'intern', salary: '200/天', headcount: 2, location: '青岛' }

  try {
    let companyId: string

    // ── 1 + 2. create 写入岗位 + sortOrder ──────────────────────────────────
    {
      const created = await svc.createCompany(fair.id, { name: '验证企业A', positions: [P_FE, P_INTERN] }, adminUser)
      companyId = created.id
      if (created.positions.length !== 2) fail(`1. 岗位数应为 2,实际 ${created.positions.length}`)
      if (created.positions[0].title !== '前端工程师' || created.positions[1].title !== '产品实习生') {
        fail(`2. 岗位顺序不符: ${json(created.positions.map((p) => p.title))}`)
      }
      const p0 = created.positions[0]
      if (p0.positionType !== 'full_time' || p0.salary !== '15-25K' || p0.headcount !== 3 || p0.education !== '本科' || p0.experience !== '3-5年' || p0.location !== '青岛' || p0.department !== '研发中心' || p0.requirements !== '熟悉 React/TS') {
        fail(`1. 岗位字段未如实落库: ${json(p0)}`)
      }
      pass('1. createCompany 写入岗位,返回带回岗位,9 字段如实落库')

      const rows = await readPositions(companyId)
      if (rows.length !== 2 || rows[0].sortOrder !== 0 || rows[1].sortOrder !== 1) fail(`2. sortOrder DB 列不是 0/1: ${json(rows.map((r) => r.sortOrder))}`)
      if (rows[0].title !== '前端工程师') fail('2. sortOrder 顺序与表单不一致')
      pass('2. sortOrder 按表单行顺序写入(DB 0/1,读回升序)')
    }

    // ── 3. getFairDetail 回填 ───────────────────────────────────────────────
    {
      const detail = await svc.getFairDetail(fair.id)
      const c = detail.companies.find((x) => x.id === companyId)
      if (!c) fail('3. getFairDetail 未含测试企业')
      if (c.positions.length !== 2 || c.positions[0].title !== '前端工程师') fail(`3. getFairDetail 岗位回填不符: ${json(c.positions.map((p) => p.title))}`)
      pass('3. getFairDetail 回填 company.positions(Admin 详情可读回)')
    }

    // ── 4. update 全量替换(增/删/改/重排)────────────────────────────────
    {
      const updated = await svc.updateCompany(
        fair.id,
        companyId,
        { name: '验证企业A', positions: [{ ...P_INTERN, title: '产品实习生(改)' }, { title: '后端工程师', headcount: 5, positionType: 'full_time' }] },
        adminUser,
      )
      if (updated.positions.length !== 2) fail('4. 替换后岗位数应为 2')
      if (updated.positions[0].title !== '产品实习生(改)' || updated.positions[1].title !== '后端工程师') fail(`4. 全量替换后顺序/内容不符: ${json(updated.positions.map((p) => p.title))}`)
      const dbCount = (await readPositions(companyId)).length
      if (dbCount !== 2) fail(`4. 旧岗位未被删除(DB 应 2 行,实际 ${dbCount})`)
      pass('4. updateCompany 全量替换岗位(旧集删除,新集按序重建)')
    }

    // ── 5. 清空岗位 ────────────────────────────────────────────────────────
    {
      const cleared = await svc.updateCompany(fair.id, companyId, { name: '验证企业A', positions: [] }, adminUser)
      if (cleared.positions.length !== 0) fail('5. positions=[] 未清空')
      const dbCount = (await readPositions(companyId)).length
      if (dbCount !== 0) fail(`5. 清空后 DB 仍有 ${dbCount} 行岗位`)
      pass('5. update positions=[] 清空该企业全部岗位')
    }

    // ── 6. 空标题行过滤 ────────────────────────────────────────────────────
    {
      const created = await svc.createCompany(
        fair.id,
        { name: '验证企业B', positions: [{ title: '有效岗位', headcount: 1 }, { title: '   ', headcount: 9 }] },
        adminUser,
      )
      if (created.positions.length !== 1 || created.positions[0].title !== '有效岗位') {
        fail(`6. 空标题行未被过滤: ${json(created.positions.map((p) => p.title))}`)
      }
      pass('6. 空标题岗位行被 service 过滤,仅存非空行')
    }

    // ── 7. Kiosk 公开读取(无新增 UI)──────────────────────────────────────
    {
      const c2 = await svc.createCompany(fair.id, { name: '验证企业C', positions: [P_FE] }, adminUser)
      const byId = await jobs.getFairCompanyById(fair.id, c2.id)
      if (!byId.data || byId.data.positions.length !== 1 || byId.data.positions[0].title !== '前端工程师') {
        fail('7. getFairCompanyById 未带出岗位')
      }
      const list = await jobs.getFairCompanies(fair.id, 1, 50)
      const hit = list.data.find((x) => x.id === c2.id)
      if (!hit || hit.positions.length !== 1) fail('7. getFairCompanies 未带出岗位')
      pass('7. Kiosk getFairCompanyById / getFairCompanies 带出岗位明细')
    }

    // ── 8. DTO 校验(class-validator)──────────────────────────────────────
    {
      await expectValid(
        { name: '企业X', positions: [{ title: '工程师', positionType: 'full_time', headcount: 3, salary: '面议', education: '本科' }] },
        '8a. 合法岗位校验通过',
      )
      await expectInvalid({ name: '企业X', positions: [{ title: '', headcount: 1 }] }, '8b. 空 title 被拒')
      await expectInvalid({ name: '企业X', positions: [{ title: '工程师', headcount: -1 }] }, '8c. 负 headcount 被拒')
      await expectInvalid({ name: '企业X', positions: [{ title: '工程师', headcount: 1.5 }] }, '8d. 非整数 headcount 被拒')
      await expectInvalid({ name: '企业X', positions: [{ title: '工程师', positionType: 'manager' }] }, '8e. 非法 positionType 被拒')
    }

    // ── 9. 审计 ────────────────────────────────────────────────────────────
    {
      const logs = await prisma.auditLog.findMany({ where: { actorId: adminUser.userId } })
      const actions = new Set(logs.map((l) => l.action))
      if (!actions.has('fair.company.create') || !actions.has('fair.company.update')) {
        fail(`9. 缺少审计动作;实际: ${[...actions].join(', ')}`)
      }
      const createLog = logs.find((l) => l.action === 'fair.company.create')
      const payload = createLog?.payloadJson ? JSON.parse(createLog.payloadJson as string) : {}
      if (typeof payload.positionCount !== 'number') fail('9. 审计 payloadJson 未含 positionCount')
      pass('9. fair.company.create/update 落 AuditLog(payload 含 positionCount)')
    }

    // ── 10. 级联删 ─────────────────────────────────────────────────────────
    {
      const c = await svc.createCompany(fair.id, { name: '验证企业D', positions: [P_FE, P_INTERN] }, adminUser)
      const before = (await readPositions(c.id)).length
      if (before !== 2) fail('10. 前置岗位创建失败')
      await svc.deleteCompany(fair.id, c.id, adminUser)
      // 企业删除成功且查不到 → 其岗位经 FK onDelete: Cascade 一并删除(否则删除会 FK 失败)。
      const gone = await prisma.fairCompany.findUnique({ where: { id: c.id } })
      if (gone !== null) fail('10. deleteCompany 后企业仍存在')
      pass('10. deleteCompany 级联删除该企业岗位(企业删除成功即证级联)')
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
