/**
 * 企业展示开发种子（仅开发环境使用，绝不用于生产假数据）。
 *
 * 创建：1 个演示来源机构 + 3 家已审核发布的演示企业 + 关联的演示岗位。
 * 所有名称都带「演示」标识；幂等（按 externalId upsert）。
 *
 * 运行：pnpm --filter @ai-job-print/api db:seed:companies
 */
require('dotenv').config()

import { PrismaService } from '../src/prisma/prisma.service'

function assertDemoSeedAllowed(scriptName: string) {
  const url = process.env['DATABASE_URL'] ?? ''
  const explicit = process.env['ALLOW_DEMO_SEED'] === 'true'
  const looksProductionUrl = /\bprod(uction)?\b|ai_job_print_prod/i.test(url)
  if (!explicit && (process.env['NODE_ENV'] === 'production' || looksProductionUrl)) {
    throw new Error(`${scriptName} contains published demo companies/jobs and is blocked for production. Set ALLOW_DEMO_SEED=true only for a deliberate non-production restore.`)
  }
}

assertDemoSeedAllowed('prisma/seed-companies.ts')

const ORG_ID = 'org-demo-companies'

const COMPANIES = [
  {
    externalId: 'demo-co-1',
    name: '未来智造科技有限公司（演示）',
    description: '演示数据：专注智能制造装备的研发、生产与服务，产品应用于汽车制造、新能源、3C 电子、半导体等行业。',
    industry: 'smart_manufacturing', companyType: 'high_tech', scale: '1200+',
    province: '山东省', city: '青岛市', district: '崂山区', address: '株洲路 78 号（演示地址）',
    honorTagsJson: JSON.stringify(['国家高新技术企业（演示）', '专精特新中小企业（演示）']),
    tagsJson: JSON.stringify(['校园招聘']),
    fairParticipant: true, boothNo: 'A18', showBoothNo: true,
    sourceUrl: 'https://example.com/demo/company-1',
    jobs: [
      { externalId: 'demo-co1-j1', title: '自动化设备工程师（演示）', city: '青岛', category: 'fulltime', salary: '15-25K·月', tags: ['自动化控制', 'PLC编程'] },
      { externalId: 'demo-co1-j2', title: '嵌入式软件工程师（演示）', city: '青岛', category: 'fulltime', salary: '18-30K·月', tags: ['C/C++', 'Linux'] },
      { externalId: 'demo-co1-j3', title: '生产计划实习生（演示）', city: '青岛', category: 'intern', salary: '180元·天', tags: ['生产计划', 'Excel'] },
    ],
  },
  {
    externalId: 'demo-co-2',
    name: '中科能源装备集团（演示）',
    description: '演示数据：能源装备制造商，聚焦绿色能源与智能制造领域。',
    industry: 'new_energy', companyType: 'central_soe', scale: '5000+',
    province: '山东省', city: '青岛市', district: '黄岛区',
    honorTagsJson: JSON.stringify([]), tagsJson: JSON.stringify(['校园招聘']),
    fairParticipant: false, boothNo: null, showBoothNo: false,
    sourceUrl: 'https://example.com/demo/company-2',
    jobs: [
      { externalId: 'demo-co2-j1', title: '研发工程师（演示）', city: '青岛', category: 'campus', salary: '12-20K·月', tags: ['新能源'] },
    ],
  },
  {
    externalId: 'demo-co-3',
    name: '华东云创软件有限公司（演示）',
    description: '演示数据：提供云计算、大数据及行业数字化解决方案服务。',
    industry: 'internet_software', companyType: 'private', scale: '300+',
    province: '山东省', city: '青岛市', district: '市南区',
    honorTagsJson: JSON.stringify([]), tagsJson: JSON.stringify([]),
    fairParticipant: false, boothNo: null, showBoothNo: false,
    sourceUrl: 'https://example.com/demo/company-3',
    jobs: [
      { externalId: 'demo-co3-j1', title: 'Java开发工程师（演示）', city: '青岛', category: 'fulltime', salary: '14-22K·月', tags: ['Java', '微服务'] },
      { externalId: 'demo-co3-j2', title: '测试工程师（演示·兼职）', city: '青岛', category: 'parttime', salary: '200元·天', tags: ['测试'] },
    ],
  },
]

async function main() {
  const prisma = new PrismaService()
  try {
    const org = await prisma.organization.upsert({
      where: { id: ORG_ID },
      create: { id: ORG_ID, name: '市人社公共就业平台（演示）', type: 'public_employment_service' },
      update: {},
    })
    for (const c of COMPANIES) {
      const { jobs, ...fields } = c
      const company = await prisma.companyProfile.upsert({
        where: { sourceOrgId_externalId: { sourceOrgId: org.id, externalId: c.externalId } },
        create: {
          sourceOrgId: org.id, sourceName: org.name, ...fields,
          reviewStatus: 'approved', publishStatus: 'published', reviewedAt: new Date(),
        },
        update: { ...fields, reviewStatus: 'approved', publishStatus: 'published' },
      })
      for (const j of jobs) {
        await prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId: org.id, externalId: j.externalId } },
          create: {
            sourceOrgId: org.id, externalId: j.externalId, sourceName: org.name,
            sourceUrl: `https://example.com/demo/jobs/${j.externalId}`,
            title: j.title, company: company.name, city: j.city, category: j.category,
            salary: j.salary, tagsJson: JSON.stringify(j.tags),
            reviewStatus: 'approved', publishStatus: 'published',
            companyProfileId: company.id,
          },
          update: { companyProfileId: company.id, reviewStatus: 'approved', publishStatus: 'published' },
        })
      }
      console.log(`seeded company: ${company.name}`)
    }
    console.log('companies demo seed done（演示数据，仅开发环境）')
  } finally {
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
