/**
 * 场馆导览 seed:给 seed-fairs 的示例招聘会补一份 A/B/C 厅导览配置,方便本地验收。
 *
 * 前置:先跑 `pnpm db:seed && pnpm db:seed:fairs`(需要 fair-uni-campus-2026q2 及其参展企业)。
 * 运行:pnpm --filter @ai-job-print/api db:seed:venue-guide
 *
 * 设计:绑定企业全部来自该招聘会已有 FairCompany(不复制企业信息);
 * 幂等:重复执行会整体重建该招聘会的导览配置。
 */
import 'dotenv/config'
import { createPrismaClient } from '../src/prisma/create-client'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL is required')
const prisma = createPrismaClient(url).client

const FAIR_ID = 'fair-uni-campus-2026q2'

async function main() {
  const fair = await prisma.jobFair.findUnique({
    where: { id: FAIR_ID },
    include: { companies: { orderBy: { jobsCount: 'desc' } } },
  })
  if (!fair) {
    console.error(`招聘会 ${FAIR_ID} 不存在,请先执行 pnpm db:seed && pnpm db:seed:fairs`)
    process.exit(1)
  }
  if (fair.companies.length === 0) {
    console.error('该招聘会无参展企业,请先执行 pnpm db:seed:fairs')
    process.exit(1)
  }

  // 幂等:删除旧导览(级联清理 halls/facilities)
  await prisma.fairVenueGuide.deleteMany({ where: { jobFairId: FAIR_ID } })

  // 把已有企业按行业粗分到 A/B/C 三个厅
  const isTech = (i: string | null) => ['internet', 'ai', 'manufacturing', 'consumer'].includes(i ?? '')
  const isFinance = (i: string | null) => ['finance', 'service'].includes(i ?? '')
  const techCompanies = fair.companies.filter((c) => isTech(c.industry))
  const financeCompanies = fair.companies.filter((c) => isFinance(c.industry))
  const otherCompanies = fair.companies.filter((c) => !isTech(c.industry) && !isFinance(c.industry))

  const boothNo = (prefix: string, i: number) => `${prefix}${String(i + 1).padStart(2, '0')}`

  await prisma.fairVenueGuide.create({
    data: {
      jobFairId: FAIR_ID,
      venueName: '某大学体育馆',
      halls: {
        create: [
          {
            hallCode: 'A',
            hallName: 'A 厅',
            industryCategory: '互联网与人工智能',
            description: '互联网、AI、智能制造、消费电子相关企业集中展区',
            boothRange: 'A01-A30',
            sortOrder: 0,
            companies: {
              create: techCompanies.map((c, i) => ({ fairCompanyId: c.id, boothNo: boothNo('A', i), sortOrder: i })),
            },
          },
          {
            hallCode: 'B',
            hallName: 'B 厅',
            industryCategory: '金融与现代服务',
            description: '金融、生活服务类企业集中展区',
            boothRange: 'B01-B20',
            sortOrder: 1,
            companies: {
              create: financeCompanies.map((c, i) => ({ fairCompanyId: c.id, boothNo: boothNo('B', i), sortOrder: i })),
            },
          },
          {
            hallCode: 'C',
            hallName: 'C 厅',
            industryCategory: '综合行业',
            description: '教育、医疗及其他行业企业展区',
            boothRange: 'C01-C15',
            sortOrder: 2,
            companies: {
              create: otherCompanies.map((c, i) => ({ fairCompanyId: c.id, boothNo: boothNo('C', i), sortOrder: i })),
            },
          },
        ],
      },
      facilities: {
        create: [
          { type: 'entrance', name: '主入口', locationLabel: '南门入口', relatedHallCode: 'A', sortOrder: 0 },
          { type: 'serviceDesk', name: '服务台', locationLabel: 'A 厅与 B 厅之间', relatedHallCode: 'A', sortOrder: 1 },
          { type: 'printPoint', name: '自助打印点', locationLabel: '服务台旁(AI求职打印一体机)', relatedHallCode: 'B', sortOrder: 2 },
          { type: 'consulting', name: '就业咨询区', locationLabel: 'C 厅入口处', relatedHallCode: 'C', sortOrder: 3 },
        ],
      },
    },
  })

  console.log(
    `venue guide seeded: fair=${FAIR_ID} halls=A(${techCompanies.length})/B(${financeCompanies.length})/C(${otherCompanies.length}) facilities=4`,
  )
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
