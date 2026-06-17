/**
 * Phase 0b seed:1 admin + 2 partner org + 13 job(覆盖 reviewStatus × publishStatus 关键组合)。
 *
 * 运行:
 *   pnpm --filter ./services/api db:seed
 *
 * 设计要点:
 * - 使用稳定的人类可读 ID(org-uni-001 等),便于与前端 mock 对齐
 * - upsert 而非 create,允许重复运行而不报唯一约束错;update 用全字段刷新(去 id),
 *   保证重复 seed 把展示字段 / 行业 tag 更新到最新
 * - 密码用 bcryptjs hash,salt rounds 10
 * - 覆盖 13 条 Job:11 approved+published(多城市 × 多行业 × 4 category × 2 来源)、
 *   1 pending+draft、1 approved+draft(后两条用于验证 Kiosk 不暴露未发布岗位)
 */
import 'dotenv/config'
import { createPrismaClient } from '../src/prisma/create-client'
import * as bcrypt from 'bcryptjs'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL is required to run seed')

function assertDemoSeedAllowed(scriptName: string) {
  const explicit = process.env['ALLOW_DEMO_SEED'] === 'true'
  const looksProductionUrl = /\bprod(uction)?\b|ai_job_print_prod/i.test(url)
  if (!explicit && (process.env['NODE_ENV'] === 'production' || looksProductionUrl)) {
    throw new Error(`${scriptName} contains demo jobs/orgs and is blocked for production. Set ALLOW_DEMO_SEED=true only for a deliberate non-production restore.`)
  }
}

assertDemoSeedAllowed('prisma/seed.ts')
const prisma = createPrismaClient(url).client

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

  // ── Terminal seed ─────────────────────────────────────────────────────────
  //
  // Kiosk 前端使用稳定业务码 KSK-001 拉取打印机状态/待机屏配置。
  // Agent 注册后仍可通过 terminalCode upsert 覆盖 token 和指纹;这里不硬编码任何打印机型号。
  const kioskTerminal = await prisma.terminal.upsert({
    where: { terminalCode: 'KSK-001' },
    update: { orgId: uniOrg.id },
    create: {
      id: 't_ksk_001',
      terminalCode: 'KSK-001',
      agentToken: 'seed-terminal-token-ksk-001',
      deviceFingerprint: 'seed-terminal-fingerprint-ksk-001',
      orgId: uniOrg.id,
    },
  })
  await prisma.terminalHeartbeat.create({
    data: {
      terminalId: kioskTerminal.id,
      printerStatus: 'ok',
      agentVersion: 'seed',
      ipAddress: '127.0.0.1',
      diskFreeGb: null,
    },
  })
  console.log(`✓ terminal: ${kioskTerminal.terminalCode}`)

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
  //
  // 行业(industry)无独立 DB 列,约定以 `行业:` 前缀 tag 存放在 tagsJson(见
  // services/api/src/jobs/jobs.service.ts 的 INDUSTRY_TAG_PREFIX / buildJobIndustryTag)。
  // 前端 industry 字段由后端从该前缀 tag 抽取;tag chip 不显示前缀。
  //
  // 数据覆盖:多城市 × 多行业 × 4 种 category × 2 来源机构,用于演示 Kiosk
  // 关键词 / 城市 / 行业 / 类型 / 来源筛选。sourceUrl 均为可校验 https。
  const jobs = [
    // ── 高校就业信息网(uniOrg) ───────────────────────────────────────────
    {
      id: 'job-uni-0041', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0041', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0041',
      title: '软件开发实习生', company: '青软科技有限公司', city: '青岛市',
      category: 'intern', salary: '5K-8K',
      description: '参与企业级 Java 后端服务开发,跟随导师完成模块编码、单元测试与联调。',
      requirements: '计算机相关专业在读,熟悉 Java 与 Spring 基础,每周到岗不少于 4 天。',
      tagsJson: JSON.stringify(['行业:互联网', 'Java', 'Spring']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0042', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0042', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0042',
      title: '产品运营校招生', company: '浙优电商平台', city: '杭州市',
      category: 'campus', salary: '10K-15K',
      description: '负责平台活动策划与用户增长运营,撰写运营方案并跟进数据复盘。',
      requirements: '2026 届本科及以上,逻辑清晰、对数据敏感,有运营实习经历优先。',
      tagsJson: JSON.stringify(['行业:电商零售', '增长', '运营']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0043', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0043', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0043',
      title: '前端开发工程师', company: '京东方信息技术公司', city: '北京市',
      category: 'fulltime', salary: '15K-25K',
      description: '负责中后台管理系统前端开发,参与组件库建设与页面性能优化。',
      requirements: '本科及以上,熟悉 React / TypeScript,有 2 年以上前端项目经验。',
      tagsJson: JSON.stringify(['行业:互联网', 'React', 'TypeScript']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0045', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0045', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0045',
      title: '智能制造工艺工程师', company: '海尔智家股份公司', city: '青岛市',
      category: 'fulltime', salary: '12K-18K',
      description: '负责产线工艺改进与自动化设备调试,推进数字化车间落地。',
      requirements: '机械 / 自动化相关专业本科及以上,熟悉 PLC 与精益生产。',
      tagsJson: JSON.stringify(['行业:先进制造', '工艺', '自动化']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0046', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0046', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0046',
      title: '中学数学教师(校招)', company: '青岛育才实验学校', city: '青岛市',
      category: 'campus', salary: '8K-12K',
      description: '承担初中数学教学与班级管理,参与教研与课程设计。',
      requirements: '数学相关专业本科及以上,持教师资格证,普通话二级甲等以上。',
      tagsJson: JSON.stringify(['行业:教育培训', '教学', '教研']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0047', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0047', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0047',
      title: '新媒体内容兼职', company: '潮岛文化传媒工作室', city: '青岛市',
      category: 'parttime', salary: '150-200元/天',
      description: '负责短视频脚本撰写与图文内容排版,配合账号日常更新。',
      requirements: '文字功底扎实,熟悉主流内容平台,可灵活排班。',
      tagsJson: JSON.stringify(['行业:文化传媒', '新媒体', '文案']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-uni-0044', sourceOrgId: uniOrg.id,  sourceId: uniExcel.id,
      externalId: 'UNI-2026-JOB-0044', sourceName: '高校就业信息网',
      sourceUrl:  'https://job.uni.edu.cn/jobs/UNI-2026-JOB-0044',
      title: '数据分析实习', company: '深证金融科技公司', city: '深圳市',
      category: 'intern', salary: '8K-12K',
      description: '协助风控团队完成数据清洗、指标统计与可视化报表。',
      requirements: '统计 / 计算机相关在读,熟悉 SQL 与 Python 数据分析库。',
      tagsJson: JSON.stringify(['行业:金融', 'SQL', 'Python']),
      // 演示用:待审核 — 不应出现在 Kiosk
      reviewStatus: 'pending', publishStatus: 'draft',
    },

    // ── 市人才网(hrOrg) ──────────────────────────────────────────────────
    {
      id: 'job-hr-1001', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1001', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/jobs/HR-2026-JOB-1001',
      title: '社区工作人员', company: '市南区街道社区服务中心', city: '青岛市',
      category: 'fulltime', salary: '6K-9K',
      description: '负责社区党建、居民事务办理与志愿服务组织协调。',
      requirements: '大专及以上学历,本地户籍优先,具备良好沟通与文书能力。',
      tagsJson: JSON.stringify(['行业:公共服务', '党建', '社区服务']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-hr-1003', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1003', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/jobs/HR-2026-JOB-1003',
      title: '人力资源专员', company: '青岛城投集团', city: '青岛市',
      category: 'fulltime', salary: '8K-12K',
      description: '负责招聘、员工关系与培训组织,维护人事档案与考勤。',
      requirements: '人力资源相关专业本科及以上,熟悉劳动法规与招聘流程。',
      tagsJson: JSON.stringify(['行业:人力资源', 'HR', '招聘']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-hr-1004', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1004', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/jobs/HR-2026-JOB-1004',
      title: '康复治疗师', company: '济南市第一康复医院', city: '济南市',
      category: 'fulltime', salary: '7K-11K',
      description: '为住院与门诊患者制定并执行康复治疗方案,记录康复评估。',
      requirements: '康复治疗学专业本科及以上,持康复治疗师资格证。',
      tagsJson: JSON.stringify(['行业:医疗健康', '康复', '临床']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-hr-1005', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1005', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/jobs/HR-2026-JOB-1005',
      title: '银行大堂经理', company: '齐鲁商业银行上海分行', city: '上海市',
      category: 'fulltime', salary: '9K-14K',
      description: '负责网点客户引导、业务咨询与厅堂服务管理。',
      requirements: '金融 / 经济相关专业本科及以上,有银行网点服务经验优先。',
      tagsJson: JSON.stringify(['行业:金融', '客户服务']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-hr-1006', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1006', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/jobs/HR-2026-JOB-1006',
      title: '仓储分拣兼职', company: '顺丰速运青岛分拨中心', city: '青岛市',
      category: 'parttime', salary: '25元/小时',
      description: '负责快件分拣、扫描与装卸,按班次完成分拨作业。',
      requirements: '身体健康,能适应倒班,可立即到岗。',
      tagsJson: JSON.stringify(['行业:公共服务', '仓储', '分拣']),
      reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: 'job-hr-1002', sourceOrgId: hrOrg.id,  sourceId: hrApi.id,
      externalId: 'HR-2026-JOB-1002', sourceName: '市人才网',
      sourceUrl:  'https://hr.gov.cn/jobs/HR-2026-JOB-1002',
      title: '行政综合管理岗', company: '某市属国有企业', city: '青岛市',
      category: 'fulltime', salary: '8K-12K',
      description: '负责公文流转、会务保障与办公后勤管理。',
      requirements: '行政管理相关专业本科及以上,文字功底扎实。',
      tagsJson: JSON.stringify(['行业:公共服务', '行政']),
      // 演示用:已审核但还未发布 — 不应出现在 Kiosk
      reviewStatus: 'approved', publishStatus: 'draft',
    },
  ]

  for (const job of jobs) {
    // update 用全字段(去掉 id)刷新,保证重复 seed 能把展示字段/行业 tag 更新到最新
    const { id: _id, ...refreshable } = job
    void _id
    await prisma.job.upsert({
      where: { sourceOrgId_externalId: { sourceOrgId: job.sourceOrgId, externalId: job.externalId } },
      update: refreshable,
      create: job,
    })
  }
  const published = jobs.filter((j) => j.reviewStatus === 'approved' && j.publishStatus === 'published').length
  console.log(`✓ jobs: ${jobs.length} (${published} approved+published, 1 pending, 1 approved+draft)`)

  console.log('🌱 0b seed: done.')
}

main()
  .then(async () => { await prisma.$disconnect() })
  .catch(async (e) => {
    console.error('seed failed:', e)
    await prisma.$disconnect()
    process.exit(1)
  })
