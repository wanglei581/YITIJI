/**
 * 校园/招聘会公开接口生产数据防线验证。
 *
 * 覆盖:
 *   1. EXCLUDE_DEMO_PUBLIC_DATA=true 时,公开招聘会列表不返回演示/验证数据;
 *   2. 演示/验证招聘会详情和子资源不可公开读取;
 *   3. 同一严格模式下,正式学校发布数据仍可正常展示。
 *
 * 运行:pnpm --filter @ai-job-print/api verify:public-fair-demo-guard
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { JobsService } from '../src/jobs/jobs.service'
import { cleanFairVerifyResidue } from './lib/verify-fair-residue'

process.env['EXCLUDE_DEMO_PUBLIC_DATA'] = 'true'

// 稳定且唯一的残留标记(跨运行不变):嵌进本脚本所有机构 id,
// 开始前预清 + finally 再清,异常/中断后下次运行也能按它收掉残留。
const RESIDUE_TAG = 'vresidpubguard'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

async function main() {
  console.log('\n=== 公开招聘会演示数据隔离验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const svc = new JobsService(prisma, audit)

  // 预清:收掉上一次被强杀/锁超时漏删的本脚本残留(按稳定 tag)。
  await cleanFairVerifyResidue(prisma, RESIDUE_TAG)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  // demoOrgId 保留 org_vff_ 前缀(继续命中生产 demo guard 的机构前缀判定),并嵌入稳定 tag 便于清理。
  const demoOrgId = `org_vff_${RESIDUE_TAG}_${suffix}`
  const realOrgId = `org_real_${RESIDUE_TAG}_${suffix}`

  await prisma.organization.createMany({
    data: [
      { id: demoOrgId, name: `验证大学就业指导中心_${suffix}`, type: 'school_employment_center' },
      { id: realOrgId, name: `青岛滨海职业技术学院就业指导中心_${suffix}`, type: 'school_employment_center' },
    ],
  })

  const demoFair = await prisma.jobFair.create({
    data: {
      sourceOrgId: demoOrgId,
      externalId: `VFF-${suffix}`,
      sourceName: '验证来源',
      sourceUrl: `https://example.org/fairs/${suffix}`,
      title: '验证招聘会',
      theme: 'campus',
      startAt: new Date(Date.now() + 86400_000),
      endAt: new Date(Date.now() + 90000_000),
      venue: '验证展馆',
      city: '验证市',
      hostSchoolName: '验证大学就业指导中心',
      reviewStatus: 'approved',
      publishStatus: 'published',
    },
  })

  const realFair = await prisma.jobFair.create({
    data: {
      sourceOrgId: realOrgId,
      externalId: `REAL-CAMPUS-${suffix}`,
      sourceName: `青岛滨海职业技术学院就业指导中心_${suffix}`,
      sourceUrl: `https://career.qdbinhai.edu.cn/fairs/${suffix}`,
      title: `青岛滨海职业技术学院2026届校园双选会_${suffix}`,
      theme: 'campus',
      startAt: new Date(Date.now() + 172800_000),
      endAt: new Date(Date.now() + 176400_000),
      venue: '大学生活动中心一层大厅',
      city: '青岛',
      hostSchoolName: `青岛滨海职业技术学院就业指导中心_${suffix}`,
      audienceLabel: '2026届毕业生',
      admissionMethod: '凭学生证入场,预约以学校就业信息网为准',
      reviewStatus: 'approved',
      publishStatus: 'published',
    },
  })

  try {
    const list = await svc.getPublishedFairs({ pageSize: 100 })
    if (list.data.some((f) => f.id === demoFair.id)) fail('1. 严格模式公开列表仍返回演示/验证招聘会')
    if (!list.data.some((f) => f.id === realFair.id)) fail('1. 严格模式误伤正式学校招聘会')
    pass('1. 严格模式列表:过滤演示/验证数据,保留正式学校数据')

    const demoDetail = await svc.getPublishedFairById(demoFair.id)
    if (demoDetail.data !== null) fail('2. 演示/验证招聘会详情仍可公开读取')
    const demoCompanies = await svc.getFairCompanies(demoFair.id, 1, 20)
    if (demoCompanies.total !== 0 || demoCompanies.data.length !== 0) fail('2. 演示/验证招聘会子资源仍可公开读取')
    const demoStats = await svc.getFairStats(demoFair.id)
    if (demoStats.data !== null) fail('2. 演示/验证招聘会统计仍可公开读取')
    pass('2. 严格模式详情/子资源:演示/验证招聘会不可公开读取')

    const realDetail = await svc.getPublishedFairById(realFair.id)
    if (!realDetail.data || realDetail.data.hostSchoolName !== `青岛滨海职业技术学院就业指导中心_${suffix}`) {
      fail('3. 正式学校招聘会详情未正常公开读取')
    }
    pass('3. 严格模式详情:正式学校招聘会仍正常公开展示')

    console.log('\n=== ALL PASS ===')
  } finally {
    await cleanFairVerifyResidue(prisma, RESIDUE_TAG)
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
