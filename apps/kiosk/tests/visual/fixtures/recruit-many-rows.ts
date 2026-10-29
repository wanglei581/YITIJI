// 第 11 包「多行」状态的夹具数据：列表一长，整页要能滚到底，每一行都完整、看得见名称。
// 只生成数据，不碰路由登记；用例里 `api.respond(...)` 覆盖对应接口。名称取示例企业与示例机构，不用「测试用户 1」这类占位词。
import { FAIR_ID, FAIR_COMPANY, makeFair } from './fair-workbench-api'

const pad = (n: number) => String(n).padStart(3, '0')
export const ok = (data: unknown) => ({ status: 200, json: { success: true, data } })

const COMPANY_NAMES = [
  '青岛示例制造有限公司', '黄海精密仪器股份有限公司（示例）', '崂山海洋科技有限公司（示例）', '胶州湾物流服务有限公司（示例）',
  '即墨智能装备有限公司（示例）', '城阳生物医药有限公司（示例）', '李沧新能源材料有限公司（示例）', '西海岸数字文创有限公司（示例）',
  '平度现代农业有限公司（示例）', '莱西精密铸造有限公司（示例）',
]
const DISTRICTS = ['崂山区', '黄岛区', '即墨区', '城阳区', '李沧区']
const JOB_TITLES = ['前端工程师', '仓储现场主管', '社区护理员', '机械制图员', '会计助理', '客服专员', '数控操作员', '质检员']

/** 企业目录：n 家，在招岗位数各不相同（含 0 个）。 */
export function manyCompanies(n: number) {
  const items = Array.from({ length: n }, (_, k) => {
    const i = k + 1
    return {
      id: `company-${pad(i)}`, name: COMPANY_NAMES[k % COMPANY_NAMES.length], logoUrl: null, companyType: 'private', industry: 'manufacturing',
      sourceName: '青岛公共就业服务网', province: '山东省', city: '青岛市', district: DISTRICTS[i % DISTRICTS.length],
      description: '专注智能制造。', repJobTitles: JOB_TITLES.slice(i % 4, (i % 4) + 1 + (i % 2)), openJobCount: (i * 3) % 5,
      fairParticipant: i % 3 === 0, tags: ['高新技术企业'],
    }
  })
  const openJobCount = items.reduce((sum, item) => sum + item.openJobCount, 0)
  return {
    list: ok({ items, nextCursor: null, total: n }),
    stats: ok({ companyCount: n, openJobCount, todayNewJobCount: 3, fairCompanyCount: items.filter((item) => item.fairParticipant).length }),
  }
}

/** 线下机构目录：n 家。 */
export function manyAgencies(n: number) {
  const data = Array.from({ length: n }, (_, k) => {
    const i = k + 1
    return {
      id: `agency-${pad(i)}`, name: ['青岛合规人力服务机构', '市南区公共就业服务站', '崂山区人才驿站', '黄岛区职业指导中心', '即墨区就业创业服务中心'][k % 5],
      orgType: 'recruitment', address: `${DISTRICTS[i % DISTRICTS.length]}示例路${i}号`, district: DISTRICTS[i % DISTRICTS.length], lat: 36.0671, lng: 120.3826,
      openHours: i % 2 ? '09:00–17:00' : null, phone: '0532-00000000', website: 'https://agency.example.gov.cn',
      services: i % 2 ? '["岗位咨询","用工咨询"]' : '["岗位咨询","简历指导","政策咨询"]', description: '线下公开服务机构。', logoUrl: null, status: 'open',
      sourceOrgId: 'source-001', externalId: `QD-HR-${pad(i)}`, syncTime: '2026-07-24T08:00:00.000Z',
      createdAt: '2026-07-01T08:00:00.000Z', updatedAt: '2026-07-24T08:00:00.000Z',
    }
  })
  return { status: 200, json: { data, total: n, page: 1, pageSize: 10 } }
}

/** 线下机构详情：带 n 个已发布岗位。 */
export function agencyWithJobs(n: number) {
  return {
    status: 200,
    json: {
      id: 'agency-001', name: '青岛合规人力服务机构', type: '人力资源服务机构', address: '市南区示例路1号', district: '市南区', hours: '09:00–17:00',
      services: ['岗位咨询', '用工咨询'], orgCode: 'QD-HR-001', syncTime: '2026-07-24T08:00:00.000Z', status: 'open', jobCount: n,
      phone: '0532-00000000', description: '线下公开服务机构。', website: 'https://agency.example.gov.cn',
      jobs: Array.from({ length: n }, (_, k) => ({ id: `offline-job-${pad(k + 1)}`, title: JOB_TITLES[k % JOB_TITLES.length], jobType: 'fulltime', location: '市南区', salaryMin: 6000 + k * 500, salaryMax: 9000 + k * 500, status: 'active' })),
    },
  }
}

/** 岗位列表：n 条已审核发布的来源岗位。 */
export function manyJobs(n: number) {
  const data = Array.from({ length: n }, (_, k) => {
    const i = k + 1
    return {
      id: `job-${pad(i)}`, title: JOB_TITLES[k % JOB_TITLES.length], company: COMPANY_NAMES[k % COMPANY_NAMES.length], city: ['青岛市', '烟台', '威海', '潍坊'][k % 4],
      salary: '8000-12000', salaryDisplay: '8,000–12,000 元/月', category: ['fulltime', 'fulltime', 'parttime', 'intern', 'campus'][k % 5], tags: ['React'],
      description: '负责来源岗位信息整理。', requirements: '熟悉常用办公软件。', sourceOrgId: 'source-001', externalId: `ext-job-${pad(i)}`, sourceName: '青岛公共就业服务网',
      sourceUrl: `https://jobs.example.gov.cn/jobs/job-${pad(i)}`, syncTime: '2026-07-24T08:00:00.000Z', reviewStatus: 'approved', publishStatus: 'published',
      dataSourceNote: '信息来自官方来源平台，以来源平台为准。',
    }
  })
  return { status: 200, json: { success: true, data, pagination: { page: 1, pageSize: 100, total: n, totalPages: 1 } } }
}

/** 企业详情里的在招岗位：n 条。 */
export function companyJobs(n: number) {
  const items = Array.from({ length: n }, (_, k) => ({
    id: `job-${pad(k + 1)}`, title: JOB_TITLES[k % JOB_TITLES.length], city: '青岛市', salaryDisplay: '8,000–12,000 元/月', category: ['fulltime', 'parttime', 'intern'][k % 3], tags: ['React'],
    sourceName: '青岛公共就业服务网', sourceUrl: `https://jobs.example.gov.cn/jobs/job-${pad(k + 1)}`, externalId: `ext-job-${pad(k + 1)}`,
  }))
  return ok({ items, nextCursor: null, total: n })
}

/** 招聘会参展企业：n 家，各带不同数量的现场岗位。 */
export function fairCompanies(n: number) {
  const data = Array.from({ length: n }, (_, k) => {
    const i = k + 1
    return {
      ...FAIR_COMPANY, id: `fair-company-${pad(i)}`, name: COMPANY_NAMES[k % COMPANY_NAMES.length], boothNumber: `A${String(i).padStart(2, '0')}`,
      jobsCount: (i % 3) + 1, positions: Array.from({ length: (i % 3) + 1 }, (_, p) => ({ id: `position-${i}-${p}`, title: JOB_TITLES[(k + p) % JOB_TITLES.length], headcount: 2 + p, positionType: 'full_time' })),
    }
  })
  return { status: 200, json: { success: true, data, pagination: { page: 1, pageSize: 100, total: n, totalPages: 1 } } }
}

/** 一家参展企业带 n 个现场岗位（详情页的岗位清单）。 */
export function fairCompanyWithPositions(n: number) {
  return ok({
    ...FAIR_COMPANY,
    jobsCount: n,
    positions: Array.from({ length: n }, (_, k) => ({ id: `position-${pad(k + 1)}`, title: JOB_TITLES[k % JOB_TITLES.length], headcount: 2 + (k % 3), positionType: 'full_time', salary: '6k–9k', location: '青岛市', education: '大专', experience: '1-3年', requirements: '服从现场岗位安排，能按班次到岗。' })),
  })
}

/** 招聘会列表：n 场，名称各不相同。 */
export function manyFairs(n: number, theme = 'campus') {
  const names = ['2026 青岛高校毕业生招聘会', '2026 秋季校园双选会', '2026 海洋科技专场招聘会', '2026 智能制造人才对接会', '2026 青岛市民营企业招聘周']
  const data = Array.from({ length: n }, (_, k) => makeFair({ id: k === 0 ? FAIR_ID : `fair-${pad(k + 1)}`, name: names[k % names.length], theme, externalId: `ext-fair-${pad(k + 1)}` }))
  return { status: 200, json: { success: true, data, pagination: { page: 1, pageSize: 20, total: n, totalPages: 1 } } }
}
