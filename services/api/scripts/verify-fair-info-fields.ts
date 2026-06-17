/**
 * P1-A① 招聘会大屏 / 地图字段 后台增改入口 — 验证。
 *
 * 字段范围(仅这 7 个,不碰参展企业/展区/资料/导览/Partner):
 *   mapImageUrl / coverImageUrl / latitude / longitude / trafficInfo / expectedAttendance / seekerIntent
 *
 * 覆盖(对应验收点):
 *   1.  写入 + 读回:updateFairInfo 写地图/大屏字段 + 校园招聘展示字段 → 返回值(经 mapFair)读回一致;
 *       mapImageUrl/coverImageUrl 走现有 DTO 字段;来源字段(sourceName/externalId/sourceUrl)不被改动。
 *   1b. 序列化:seekerIntent → seekerIntentJson(DB 列为 JSON 字符串);数值列如实落库。
 *   1c. listFairs 经 mapFair 新鲜读回一致(回填链路 admin-fairs.service → mapFair → Fair → AdminFairView)。
 *   2.  Kiosk 公开读取链路(JobsService,无新增 Kiosk UI):
 *       getPublishedFairDetail / getFairMap / getFairStats 均能拿到地图/大屏字段;seekerIntent 被现有 parse 链路消费。
 *   3.  seekerIntent 空标签行过滤:含空 label 行 → service 过滤后只存非空行。
 *   4.  清空语义:latitude/longitude/expectedAttendance=null、trafficInfo=''、seekerIntent=[] → 全清空;
 *       seekerIntentJson 落 null;mapImageUrl='' 清空为空串。
 *   5.  DTO 校验(class-validator):非法 latitude/longitude/expectedAttendance/seekerIntent percent / 空 label 被拒;合法通过。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:fair-info-fields
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

// 验证脚本强制本地存储,绝不把测试文件写入生产 COS。
process.env['FILE_STORAGE_DRIVER'] = 'local'

import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { AdminFairsService } from '../src/jobs/admin-fairs.service'
import { JobsService } from '../src/jobs/jobs.service'
import { UpdateFairInfoDto } from '../src/jobs/dto/admin-fair.dto'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

// 稳定且唯一的残留标记(跨运行不变):嵌进机构 id 与管理员 username,开始前预清 + finally 再清。
const RESIDUE_TAG = 'vresidinfofields'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

const json = (v: unknown) => JSON.stringify(v)

async function expectValid(plain: Record<string, unknown>, label: string): Promise<void> {
  const dto = plainToInstance(UpdateFairInfoDto, plain)
  const errors = await validate(dto)
  if (errors.length > 0) fail(`${label} — 期望校验通过,实际报错字段: ${json(errors.map((e) => e.property))}`)
  pass(label)
}

async function expectInvalid(plain: Record<string, unknown>, label: string): Promise<void> {
  const dto = plainToInstance(UpdateFairInfoDto, plain)
  const errors = await validate(dto)
  if (errors.length === 0) fail(`${label} — 期望校验失败,但通过了`)
  pass(label)
}

async function main() {
  console.log('\n=== P1-A① 招聘会大屏/地图字段 验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const svc = new AdminFairsService(prisma, audit, storage)
  const jobs = new JobsService(prisma, audit)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag)。
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const orgId = `org_vff_${RESIDUE_TAG}_${suffix}`

  // AuditLog.actorId 有 FK → User,须建真实测试管理员行(脚本结束清理)。username 含稳定 tag 便于残留清理。
  const adminRow = await prisma.user.create({
    data: { username: `${RESIDUE_TAG}_admin_${suffix}`, passwordHash: 'x', name: '验证管理员', role: 'admin' },
  })
  const adminUser: AuthedUser = { userId: adminRow.id, role: 'admin', orgId: null }

  await prisma.organization.create({ data: { id: orgId, name: `验证机构_${suffix}`, type: 'gov' } })
  // 已审核 + 已发布:满足 Kiosk 公开读取(getPublishedFairDetail/getFairMap/getFairStats)的可见性门槛。
  const fair = await prisma.jobFair.create({
    data: {
      sourceOrgId: orgId, externalId: `VFF-${suffix}`, sourceName: '验证来源', sourceUrl: 'https://example.org/vff',
      title: '验证招聘会', theme: 'general',
      startAt: new Date(Date.now() + 86400_000), endAt: new Date(Date.now() + 90000_000),
      venue: '验证展馆', city: '验证市',
      reviewStatus: 'approved', publishStatus: 'published',
    },
  })

  // 按稳定 tag 清理:机构名下 fair(级联子资源)+ 该 tag 的管理员及其审计日志 + 机构本身。
  const cleanup = async () => cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const slices = [
    { label: '研发技术类', percent: 43 },
    { label: '市场运营类', percent: 28 },
    { label: '职能支持类', percent: 29 },
  ]
  const MAP = 'https://cdn.example.org/map.png'
  const COVER = 'https://cdn.example.org/cover.png'
  const TRAFFIC = '地铁2号线人才中心站 B 口步行 200m'
  const SCHOOL = '验证大学就业指导中心'
  const AUDIENCE = '2026届毕业生 / 本科 / 研究生'
  const SERVICES = ['自助打印', 'AI简历诊断', '咨询台']
  const ADMISSION = '凭学生证或身份证免费入场，预约以来源平台为准'

  try {
    // ── 1. 写入 + 读回 ──────────────────────────────────────────────────────
    {
      const updated = await svc.updateFairInfo(
        fair.id,
        {
          mapImageUrl: MAP,
          coverImageUrl: COVER,
          latitude: 36.0671,
          longitude: 120.3826,
          trafficInfo: TRAFFIC,
          expectedAttendance: 3000,
          seekerIntent: slices,
          hostSchoolName: SCHOOL,
          audienceLabel: AUDIENCE,
          onsiteServices: SERVICES,
          admissionMethod: ADMISSION,
        },
        adminUser,
      )
      if (updated.mapImageUrl !== MAP) fail('1. mapImageUrl 未写入/回填')
      if (updated.coverImageUrl !== COVER) fail('1. coverImageUrl 未写入/回填')
      if (updated.latitude !== 36.0671 || updated.longitude !== 120.3826) fail('1. 经纬度未写入')
      if (updated.trafficInfo !== TRAFFIC) fail('1. trafficInfo 未写入')
      if (updated.expectedAttendance !== 3000) fail('1. expectedAttendance 未写入')
      if (json(updated.seekerIntent) !== json(slices)) fail(`1. seekerIntent 解析不一致: ${json(updated.seekerIntent)}`)
      if (updated.hostSchoolName !== SCHOOL) fail('1. hostSchoolName 未写入/回填')
      if (updated.audienceLabel !== AUDIENCE) fail('1. audienceLabel 未写入/回填')
      if (json(updated.onsiteServices) !== json(SERVICES)) fail(`1. onsiteServices 解析不一致: ${json(updated.onsiteServices)}`)
      if (updated.admissionMethod !== ADMISSION) fail('1. admissionMethod 未写入/回填')
      if (updated.sourceName !== '验证来源' || updated.externalId !== `VFF-${suffix}` || updated.sourceUrl !== 'https://example.org/vff') {
        fail('1. 来源字段被本次编辑意外改动')
      }
      pass('1a. updateFairInfo 写入地图/大屏字段 + 校园招聘展示字段,返回值(经 mapFair)读回一致,来源字段不变')

      const raw = await prisma.jobFair.findUnique({ where: { id: fair.id } })
      if (!raw?.seekerIntentJson || json(JSON.parse(raw.seekerIntentJson)) !== json(slices)) {
        fail(`1. seekerIntentJson DB 列不是预期 JSON: ${raw?.seekerIntentJson}`)
      }
      if (raw.latitude !== 36.0671 || raw.longitude !== 120.3826 || raw.expectedAttendance !== 3000 || raw.trafficInfo !== TRAFFIC) {
        fail('1. 数值/文本列写入不符')
      }
      if (raw.hostSchoolName !== SCHOOL || raw.audienceLabel !== AUDIENCE || raw.admissionMethod !== ADMISSION) {
        fail('1. 校园招聘展示文本列写入不符')
      }
      if (!raw.onsiteServicesJson || json(JSON.parse(raw.onsiteServicesJson)) !== json(SERVICES)) {
        fail(`1. onsiteServicesJson DB 列不是预期 JSON: ${raw.onsiteServicesJson}`)
      }
      pass('1b. seekerIntent/onsiteServices 序列化为 JSON 字符串,数值/文本列如实落库')

      const list = await svc.listFairs()
      const hit = list.find((f) => f.id === fair.id)
      if (!hit) fail('1. listFairs 未含测试招聘会')
      if (hit.latitude !== 36.0671 || hit.trafficInfo !== TRAFFIC || hit.expectedAttendance !== 3000 || hit.mapImageUrl !== MAP) {
        fail('1. listFairs 读回不符')
      }
      if (json(hit.seekerIntent) !== json(slices)) fail('1. listFairs seekerIntent 读回不符')
      if (hit.hostSchoolName !== SCHOOL || hit.audienceLabel !== AUDIENCE) fail('1. listFairs 校园招聘展示字段读回不符')
      if (json(hit.onsiteServices) !== json(SERVICES)) fail('1. listFairs onsiteServices 读回不符')
      if (hit.admissionMethod !== ADMISSION) fail('1. listFairs admissionMethod 读回不符')
      pass('1c. listFairs 经 mapFair 新鲜读回一致(回填链路打通)')
    }

    // ── 2. Kiosk 公开读取链路(无新增 Kiosk UI) ─────────────────────────────
    {
      const detail = await jobs.getPublishedFairDetail(fair.id)
      if (!detail) fail('2. getPublishedFairDetail 返回 null')
      const f = detail.fair
      if (f.latitude !== 36.0671 || f.longitude !== 120.3826 || f.trafficInfo !== TRAFFIC || f.expectedAttendance !== 3000 || f.mapImageUrl !== MAP) {
        fail('2. 招聘会详情未带出地图/大屏字段')
      }
      if (json(f.seekerIntent) !== json(slices)) fail('2. 招聘会详情 seekerIntent 不符')
      if (f.hostSchoolName !== SCHOOL || f.audienceLabel !== AUDIENCE || f.admissionMethod !== ADMISSION) {
        fail('2. 招聘会详情未带出校园招聘展示字段')
      }
      if (json(f.onsiteServices) !== json(SERVICES)) fail('2. 招聘会详情 onsiteServices 不符')
      pass('2a. getPublishedFairDetail 带出地图/大屏字段 + 校园招聘展示字段')

      const map = await jobs.getFairMap(fair.id)
      if (!map.data || map.data.mapImageUrl !== MAP) fail('2. getFairMap 未带出 mapImageUrl')
      pass('2b. getFairMap 带出 mapImageUrl')

      const stats = await jobs.getFairStats(fair.id)
      if (!stats.data || stats.data.expectedAttendance !== 3000) fail('2. getFairStats 未带出 expectedAttendance')
      if (json(stats.data.seekerIntent) !== json(slices)) fail('2. getFairStats seekerIntent 未被 parse 链路消费')
      pass('2c. getFairStats 带出 expectedAttendance + seekerIntent(现有 parse 链路消费)')
    }

    // ── 3. seekerIntent 空标签行过滤 ───────────────────────────────────────
    {
      await svc.updateFairInfo(
        fair.id,
        { seekerIntent: [{ label: '有效项', percent: 60 }, { label: '   ', percent: 40 }] },
        adminUser,
      )
      const raw = await prisma.jobFair.findUnique({ where: { id: fair.id } })
      const parsed = raw?.seekerIntentJson ? JSON.parse(raw.seekerIntentJson) : []
      if (parsed.length !== 1 || parsed[0].label !== '有效项') {
        fail(`3. 空标签行未被过滤: ${raw?.seekerIntentJson}`)
      }
      pass('3. seekerIntent 空标签行被 service 过滤,仅存非空行')
    }

    // ── 4. 清空语义 ────────────────────────────────────────────────────────
    {
      const cleared = await svc.updateFairInfo(
        fair.id,
        {
          latitude: null,
          longitude: null,
          trafficInfo: '',
          expectedAttendance: null,
          seekerIntent: [],
          mapImageUrl: '',
          hostSchoolName: '',
          audienceLabel: '',
          onsiteServices: [],
          admissionMethod: '',
        },
        adminUser,
      )
      if (cleared.latitude !== null || cleared.longitude !== null || cleared.expectedAttendance !== null) fail('4. 经纬度/人数未清空为 null')
      if (cleared.trafficInfo !== null) fail('4. trafficInfo 空串未清空为 null')
      if (json(cleared.seekerIntent) !== json([])) fail('4. seekerIntent 未清空为 []')
      if (cleared.hostSchoolName !== null || cleared.audienceLabel !== null || cleared.admissionMethod !== null) {
        fail('4. 校园招聘展示文本空串未清空为 null')
      }
      if (json(cleared.onsiteServices) !== json([])) fail('4. onsiteServices 未清空为 []')
      if (cleared.mapImageUrl !== '') fail('4. mapImageUrl 未清空为空串')
      const raw = await prisma.jobFair.findUnique({ where: { id: fair.id } })
      if (raw?.seekerIntentJson !== null) fail(`4. seekerIntentJson 未落 null: ${raw?.seekerIntentJson}`)
      if (raw?.onsiteServicesJson !== null) fail(`4. onsiteServicesJson 未落 null: ${raw?.onsiteServicesJson}`)
      if (raw.latitude !== null || raw.expectedAttendance !== null || raw.trafficInfo !== null) fail('4. DB 列未清空为 null')
      if (raw.hostSchoolName !== null || raw.audienceLabel !== null || raw.admissionMethod !== null) fail('4. 校园招聘展示 DB 列未清空为 null')
      pass('4. 清空语义:数值/文本→null、数组→[]、JSON 列→null')
    }

    // ── 5. DTO 校验(class-validator)───────────────────────────────────────
    {
      await expectValid(
        {
          latitude: 36.0671,
          longitude: 120.3826,
          trafficInfo: '正常文本',
          expectedAttendance: 3000,
          mapImageUrl: 'https://x.example/m.png',
          seekerIntent: [{ label: '研发技术类', percent: 43 }],
          hostSchoolName: '验证大学',
          audienceLabel: '2026届毕业生',
          onsiteServices: ['自助打印'],
          admissionMethod: '凭证入场',
        },
        '5a. 合法地图/大屏字段 + 校园招聘展示字段校验通过',
      )
      await expectInvalid({ latitude: 91 }, '5b. latitude > 90 被拒')
      await expectInvalid({ latitude: -91 }, '5c. latitude < -90 被拒')
      await expectInvalid({ longitude: 181 }, '5d. longitude > 180 被拒')
      await expectInvalid({ longitude: -181 }, '5e. longitude < -180 被拒')
      await expectInvalid({ expectedAttendance: -1 }, '5f. expectedAttendance 负数被拒')
      await expectInvalid({ expectedAttendance: 1.5 }, '5g. expectedAttendance 非整数被拒')
      await expectInvalid({ seekerIntent: [{ label: '', percent: 50 }] }, '5h. seekerIntent 空 label 被拒')
      await expectInvalid({ seekerIntent: [{ label: '研发', percent: 101 }] }, '5i. seekerIntent percent > 100 被拒')
      await expectInvalid({ seekerIntent: [{ label: '研发', percent: -1 }] }, '5j. seekerIntent percent < 0 被拒')
      await expectInvalid({ hostSchoolName: 'x'.repeat(121) }, '5k. hostSchoolName 超长被拒')
      await expectInvalid({ audienceLabel: 'x'.repeat(161) }, '5l. audienceLabel 超长被拒')
      await expectInvalid({ onsiteServices: ['x'.repeat(51)] }, '5m. onsiteServices 单项超长被拒')
      await expectInvalid({ admissionMethod: 'x'.repeat(301) }, '5n. admissionMethod 超长被拒')
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
