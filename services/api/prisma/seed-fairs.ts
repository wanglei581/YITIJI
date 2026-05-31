/**
 * BE-7 fair seed:3 场招聘会 + 19 家参展企业 + 11 个展区。
 *
 * 设计:
 *   - 独立脚本(不动 Mavis 独占的 seed.ts),pnpm db:seed:fairs 触发
 *   - 复用 0b seed 已建好的 org-uni-001 / org-hr-002
 *   - 必须先跑 0b seed 一次,否则 fk 失败:`pnpm db:seed && pnpm db:seed:fairs`
 *   - 全部 approved+published,跑完 Kiosk GET /job-fairs 立刻 3 张卡
 *   - 时间用 2026-06 中下旬固定日期,demo 时呈"upcoming/ongoing"分布
 *
 * 三场招聘会:
 *   1. 2026 届春季校园双选会(theme=campus,uniOrg)
 *      8 家大厂 + 4 个地区展区
 *   2. AI 产业校企合作专场(theme=campus_corp,uniOrg)
 *      6 家 AI 公司 + 4 个技术方向展区 — **校企合作主题变体的演示主场**
 *   3. "百企千岗"民企专场(theme=general,hrOrg)
 *      5 家本地国企/民企 + 3 行业展区
 */
import 'dotenv/config'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '../src/generated/prisma/client'

const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL is required to run seed-fairs')
const adapter = new PrismaLibSql({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const UNI_ORG_ID = 'org-uni-001'
const HR_ORG_ID  = 'org-hr-002'

// Demo 时间窗口(2026 年 6 月中下旬,demo 当前日期 2026-05-31 之后)
const FAIR_1_START = new Date('2026-06-10T09:00:00+08:00')
const FAIR_1_END   = new Date('2026-06-12T17:00:00+08:00')
const FAIR_2_START = new Date('2026-06-15T09:00:00+08:00')
const FAIR_2_END   = new Date('2026-06-17T17:00:00+08:00')
const FAIR_3_START = new Date('2026-06-20T09:00:00+08:00')
const FAIR_3_END   = new Date('2026-06-22T17:00:00+08:00')

interface CompanySpec {
  name: string
  industry: string
  scale: '<50' | '50-500' | '500-2000' | '>2000'
  description: string
  hiringTags: string[]
  jobsCount: number
}

interface ZoneSpec {
  name: string
  category: 'innovation' | 'service' | 'campus_corp_topic' | 'industry'
  city?: string
  description: string
  sortOrder: number
}

async function upsertFair(args: {
  id: string
  externalId: string
  orgId: string
  orgName: string
  title: string
  theme: 'general' | 'campus' | 'campus_corp' | 'industry'
  startAt: Date
  endAt: Date
  venue: string
  city: string
  description: string
  coverImageUrl?: string
  mapImageUrl?: string
  companies: CompanySpec[]
  zones: ZoneSpec[]
}): Promise<void> {
  const fair = await prisma.jobFair.upsert({
    where: { sourceOrgId_externalId: { sourceOrgId: args.orgId, externalId: args.externalId } },
    update: {
      title: args.title,
      theme: args.theme,
      startAt: args.startAt,
      endAt: args.endAt,
      venue: args.venue,
      city: args.city,
      description: args.description,
      coverImageUrl: args.coverImageUrl,
      mapImageUrl: args.mapImageUrl,
      companyCount: args.companies.length,
      jobCount: args.companies.reduce((sum, c) => sum + c.jobsCount, 0),
      reviewStatus: 'approved',
      publishStatus: 'published',
      syncTime: new Date(),
    },
    create: {
      id: args.id,
      sourceOrgId: args.orgId,
      externalId: args.externalId,
      sourceName: args.orgName,
      sourceUrl: `https://example.com/fairs/${args.externalId}`,
      title: args.title,
      theme: args.theme,
      startAt: args.startAt,
      endAt: args.endAt,
      venue: args.venue,
      city: args.city,
      description: args.description,
      coverImageUrl: args.coverImageUrl,
      mapImageUrl: args.mapImageUrl,
      companyCount: args.companies.length,
      jobCount: args.companies.reduce((sum, c) => sum + c.jobsCount, 0),
      reviewStatus: 'approved',
      publishStatus: 'published',
      reviewedBy: 'system-seed',
      reviewedAt: new Date(),
    },
  })

  // 重新种 companies / zones:删旧建新(seed 幂等)
  await prisma.fairCompany.deleteMany({ where: { jobFairId: fair.id } })
  await prisma.fairZone.deleteMany({ where: { jobFairId: fair.id } })

  for (const c of args.companies) {
    await prisma.fairCompany.create({
      data: {
        jobFairId: fair.id,
        name: c.name,
        industry: c.industry,
        scale: c.scale,
        description: c.description,
        hiringTags: c.hiringTags.join(','),
        jobsCount: c.jobsCount,
        sourceUrl: `https://example.com/companies/${encodeURIComponent(c.name)}`,
      },
    })
  }

  for (const z of args.zones) {
    await prisma.fairZone.create({
      data: {
        jobFairId: fair.id,
        name: z.name,
        category: z.category,
        city: z.city ?? null,
        description: z.description,
        sortOrder: z.sortOrder,
      },
    })
  }

  console.log(`✓ fair ${fair.id} (${args.theme}) ${args.title} — ${args.companies.length} companies / ${args.zones.length} zones`)
}

async function main() {
  console.log('🎪 fair seed: starting...')

  // ── Fair 1:校园双选会 ────────────────────────────────────────────────────
  await upsertFair({
    id: 'fair-uni-campus-2026q2',
    externalId: 'EXT-FAIR-UNI-001',
    orgId: UNI_ORG_ID,
    orgName: '某大学就业指导中心',
    title: '2026 届春季校园双选会',
    theme: 'campus',
    startAt: FAIR_1_START,
    endAt: FAIR_1_END,
    venue: '某大学体育馆',
    city: '北京',
    description: '面向 2026 届毕业生的春季校园双选会,涵盖互联网、金融、制造、消费等多个行业。',
    companies: [
      { name: '字节跳动', industry: 'internet', scale: '>2000', description: '互联网内容平台', hiringTags: ['校招', '应届'], jobsCount: 24 },
      { name: '阿里巴巴', industry: 'internet', scale: '>2000', description: '电商与云计算', hiringTags: ['校招', '应届'], jobsCount: 32 },
      { name: '腾讯', industry: 'internet', scale: '>2000', description: '社交与游戏', hiringTags: ['校招'], jobsCount: 28 },
      { name: '美团', industry: 'internet', scale: '>2000', description: '本地生活服务', hiringTags: ['校招', '应届'], jobsCount: 20 },
      { name: '拼多多', industry: 'internet', scale: '>2000', description: '电商平台', hiringTags: ['校招', '应届'], jobsCount: 18 },
      { name: '京东', industry: 'internet', scale: '>2000', description: '电商与物流', hiringTags: ['校招'], jobsCount: 22 },
      { name: '小米', industry: 'consumer', scale: '>2000', description: '智能硬件与 IoT', hiringTags: ['校招', '硬件'], jobsCount: 16 },
      { name: '蚂蚁集团', industry: 'finance', scale: '>2000', description: '金融科技', hiringTags: ['校招', '应届'], jobsCount: 19 },
    ],
    zones: [
      { name: '北京展区', category: 'industry', city: '北京', description: '京津冀互联网/金融岗位集中展区', sortOrder: 1 },
      { name: '上海展区', category: 'industry', city: '上海', description: '长三角金融科技岗位集中展区', sortOrder: 2 },
      { name: '深圳展区', category: 'industry', city: '深圳', description: '粤港澳大湾区互联网岗位展区', sortOrder: 3 },
      { name: '杭州展区', category: 'industry', city: '杭州', description: '电商/云计算岗位展区', sortOrder: 4 },
    ],
  })

  // ── Fair 2:校企合作专场(campus_corp 主题变体演示主场)────────────────
  await upsertFair({
    id: 'fair-uni-corp-ai-2026',
    externalId: 'EXT-FAIR-UNI-002',
    orgId: UNI_ORG_ID,
    orgName: '某大学就业指导中心',
    title: 'AI 产业校企合作专场招聘会',
    theme: 'campus_corp',
    startAt: FAIR_2_START,
    endAt: FAIR_2_END,
    venue: '某大学计算机学院报告厅',
    city: '北京',
    description: '与 AI 产业领军企业共建的校企合作专场,提供产学研全链条岗位与课题。本场不代收简历,投递请前往各企业来源平台。',
    companies: [
      { name: '智谱 AI', industry: 'ai', scale: '500-2000', description: 'GLM 大模型研发,产学合作',  hiringTags: ['校招', '产学研', 'NLP'], jobsCount: 18 },
      { name: 'DeepSeek', industry: 'ai', scale: '500-2000', description: '通用大模型与代码模型',     hiringTags: ['校招', '研究员'],       jobsCount: 14 },
      { name: '月之暗面', industry: 'ai', scale: '50-500',    description: 'Kimi 长文本大模型',         hiringTags: ['校招', 'NLP'],          jobsCount: 12 },
      { name: '商汤科技', industry: 'ai', scale: '>2000',     description: 'CV 与多模态大模型',         hiringTags: ['校招', 'CV', '研究员'], jobsCount: 22 },
      { name: '旷视科技', industry: 'ai', scale: '500-2000', description: 'CV 与机器人',                 hiringTags: ['校招', 'CV', '机器人'], jobsCount: 16 },
      { name: '第四范式', industry: 'ai', scale: '500-2000', description: '企业级 AI 平台',             hiringTags: ['校招', '工程'],         jobsCount: 11 },
    ],
    zones: [
      { name: 'LLM 大模型展区',       category: 'campus_corp_topic', description: 'GLM / DeepSeek / Kimi 等通用大模型岗位与课题',     sortOrder: 1 },
      { name: 'CV 视觉智能展区',       category: 'campus_corp_topic', description: '视觉大模型 / 多模态感知 / 内容生成相关岗位',         sortOrder: 2 },
      { name: '智能机器人展区',         category: 'campus_corp_topic', description: '具身智能 / 工业机器人 / 服务机器人岗位',             sortOrder: 3 },
      { name: '自动驾驶与 AI 芯片展区', category: 'campus_corp_topic', description: '自动驾驶感知 / 决策 / AI 芯片设计岗位',              sortOrder: 4 },
    ],
  })

  // ── Fair 3:本地民企专场 ──────────────────────────────────────────────────
  await upsertFair({
    id: 'fair-hr-1k-2026q2',
    externalId: 'EXT-FAIR-HR-001',
    orgId: HR_ORG_ID,
    orgName: '市人才交流中心',
    title: '第七届"百企千岗"民企专场招聘会',
    theme: 'general',
    startAt: FAIR_3_START,
    endAt: FAIR_3_END,
    venue: '市国际会展中心 A 馆',
    city: '某市',
    description: '本场聚焦本地国企与民企岗位,覆盖制造、金融、服务三大领域。',
    companies: [
      { name: '本地装备制造集团',  industry: 'manufacturing', scale: '>2000', description: '装备制造与重工业', hiringTags: ['社招'],       jobsCount: 30 },
      { name: '本地汽车零部件',    industry: 'manufacturing', scale: '500-2000', description: '汽车零部件',     hiringTags: ['社招', '校招'], jobsCount: 18 },
      { name: '某市农村商业银行',  industry: 'finance',       scale: '>2000', description: '本地银行',         hiringTags: ['校招', '柜员'], jobsCount: 22 },
      { name: '某市新华保险',      industry: 'finance',       scale: '500-2000', description: '寿险代理',       hiringTags: ['社招'],         jobsCount: 14 },
      { name: '某市连锁餐饮',      industry: 'service',       scale: '50-500',  description: '本地餐饮连锁',     hiringTags: ['社招', '应届'], jobsCount: 12 },
    ],
    zones: [
      { name: '制造业展区', category: 'industry', description: '装备制造 / 零部件 / 新能源岗位', sortOrder: 1 },
      { name: '金融业展区', category: 'industry', description: '银行 / 保险 / 证券岗位',           sortOrder: 2 },
      { name: '服务业展区', category: 'industry', description: '餐饮 / 物流 / 文旅岗位',           sortOrder: 3 },
    ],
  })

  console.log('🎪 fair seed: done')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
