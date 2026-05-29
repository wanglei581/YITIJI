/**
 * Phase 0b seed:1 admin + 2 partner org + 6 job(覆盖 reviewStatus × publishStatus 关键组合)。
 *
 * 运行:
 *   pnpm --filter ./services/api db:seed
 *
 * 设计要点:
 * - 使用稳定的人类可读 ID(org-uni-001 等),便于与前端 mock 对齐
 * - upsert 而非 create,允许重复运行而不报唯一约束错
 * - 密码用 bcryptjs hash,salt rounds 10
 * - 覆盖 6 条 Job:
 *     · 4 条 approved+published (高校 org)
 *     · 1 条 approved+published (人才中心 org)
 *     · 1 条 pending+draft      (待审核演示)
 *     · 不出现 rejected — 但 sample 数据可在后续补
 */
import 'dotenv/config'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '../src/generated/prisma/client'
import * as bcrypt from 'bcryptjs'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL is required to run seed')
const adapter = new PrismaLibSql({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const SALT_ROUNDS = 10

async function main() {
  console.log('🌱 0b seed: starting...')

  // ── Organizations ─────────────────────────────────────────────────────────
  const uniOrg = await prisma.organization.upsert({
    where: { id: 'org-uni-001' },
    update: {},
    create: {
      id:      'org-uni-001',
      name:    '某大学就业指导中心',
      type:    'school_employment_center',
      contact: 'job@uni.edu.cn',
      enabled: true,
    },
  })
  const hrOrg = await prisma.organization.upsert({
    where: { id: 'org-hr-002' },
    update: {},
    create: {
      id:      'org-hr-002',
      name:    '市人才交流中心',
      type:    'public_employment_service',
      contact: 'service@hr.gov.cn',
      enabled: true,
    },
  })
  console.log(`✓ orgs: ${uniOrg.id}, ${hrOrg.id}`)

  // ── Users ─────────────────────────────────────────────────────────────────
  const adminHash    = await bcrypt.hash('admin',    SALT_ROUNDS)
  const partnerHash1 = await bcrypt.hash('partner1', SALT_ROUNDS)
  const partnerHash2 = await bcrypt.hash('partner2', SALT_ROUNDS)

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminHash, name: '系统管理员', role: 'admin', orgId: null, enabled: true },
    create: { username: 'admin',    passwordHash: adminHash,    name: '系统管理员',         role: 'admin',   orgId: null },
  })
  await prisma.user.upsert({
    where: { username: 'partner1' },
    update: { passwordHash: partnerHash1, name: '高校就业指导中心', role: 'partner', orgId: uniOrg.id, enabled: true },
    create: { username: 'partner1', passwordHash: partnerHash1, name: '高校就业指导中心', role: 'partner', orgId: uniOrg.id },
  })
  await prisma.user.upsert({
    where: { username: 'partner2' },
    update: { passwordHash: partnerHash2, name: '市人才交流中心',   role: 'partner', orgId: hrOrg.id, enabled: true },
    create: { username: 'partner2', passwordHash: partnerHash2, name: '市人才交流中心',   role: 'partner', orgId: hrOrg.id },
  })
  console.log(`✓ users: admin / partner1 / partner2`)

  // ── JobSource ─────────────────────────────────────────────────────────────
  const uniExcel = await prisma.jobSource.upsert({
    where: { id: 'src-uni-excel' },
    update: {},
    create: {
      id:          'src-uni-excel',
      orgId:       uniOrg.id,
      name:        '高校就业信息 Excel',
      sourceKind:  'school',
      accessMode:  'excel',
      syncFreq:    'manual',
      description: '手动上传 Excel 模板,自动解析岗位字段',
      enabled:     true,
    },
  })
  const hrApi = await prisma.jobSource.upsert({
    where: { id: 'src-hr-api' },
    update: {},
    create: {
      id:          'src-hr-api',
      orgId:       hrOrg.id,
      name:        '市人才网 API',
      sourceKind:  'aggregator',
      accessMode:  'api',
      syncFreq:    'hourly',
      description: 'RESTful API,每小时自动拉取岗位数据',
      enabled:     true,
    },
  })
  console.log(`✓ jobSources: ${uniExcel.id}, ${hrApi.id}`)

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const jobs = [
    {
      id: 'job-uni-0041', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0041', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/j/41',
      title: '软件开发实习生', company: '某科技有限公司', city: '上海',
      category: 'intern', salary: '5K-8K',
      tagsJson: JSON.stringify(['Java', 'Spring']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0042', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0042', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/j/42',
      title: '产品运营校招生', company: '某电商平台', city: '杭州',
      category: 'campus', salary: '10K-15K',
      tagsJson: JSON.stringify(['增长', '运营']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0043', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0043', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/j/43',
      title: '前端开发工程师', company: '某互联网公司', city: '北京',
      category: 'fulltime', salary: '15K-25K',
      tagsJson: JSON.stringify(['React', 'TypeScript']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0044', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0044', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/j/44',
      title: '数据分析实习', company: '某金融科技公司', city: '深圳',
      category: 'intern', salary: '8K-12K',
      tagsJson: JSON.stringify(['SQL', 'Python']),
      // 演示用:待审核
      reviewStatus: 'pending', publishStatus: 'draft',
    },
    {
      id: 'job-hr-1001', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1001', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/j/1001',
      title: '社区工作人员', company: '某社区服务中心', city: '本市',
      category: 'fulltime', salary: '6K-9K',
      tagsJson: JSON.stringify(['党建', '社区服务']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-hr-1002', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1002', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/j/1002',
      title: '人力资源专员', company: '某国有企业', city: '本市',
      category: 'fulltime', salary: '8K-12K',
      tagsJson: JSON.stringify(['HR']),
      // 演示用:已审核但还未发布
      reviewStatus: 'approved', publishStatus: 'draft',
    },
  ]

  for (const job of jobs) {
    await prisma.job.upsert({
      where: { sourceOrgId_externalId: { sourceOrgId: job.sourceOrgId, externalId: job.externalId } },
      update: {},
      create: job,
    })
  }
  console.log(`✓ jobs: ${jobs.length} (4 approved+published, 1 pending, 1 approved+draft)`)

  console.log('🌱 0b seed: done.')
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (e) => {
    console.error('seed failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
