// 招聘会共享工作台（稿 28-jobfair-enhanced）八屏的浏览器夹具。
//
// 夹具是 fail-closed 的：ApiRouter 对没登记的请求一律 abort，并在用例收尾时
// assertNoUnhandledRequests() 抛错。所以「这一页到底发了哪些请求」本身也被断言着——
// 页面悄悄多打一个接口、或者把某个接口漏掉，用例都会红。
//
// 为什么单独一份而不是复用 fusion-w4-api：那份是 W4 域的**整域**夹具（岗位 / 机构 /
// 企业 / 校园 / 政策一起注册），而这里要逐屏切换 loading / empty / error / 结束 / 下架
// 这些互斥形态，需要按屏定制。共用一份会让每个用例都得先拆掉一堆别的登记。
import type { ApiRouter } from '../../fixtures/api-router'

export const FAIR_ID = 'fair-001'
/** 参会准备单是 fairId + taskId 两级路径；taskId 由调用方带进来（location.state）。 */
export const VISIT_PLAN_TASK_ID = 'task-fair-visit-001'
const P = `/api/v1/job-fairs/${FAIR_ID}`

/** 永不应答的响应器，用来把页面稳定地停在 loading 态取快照。 */
export const NEVER = async () => {
  await new Promise((resolve) => setTimeout(resolve, 30_000))
  return { status: 200, json: { success: true, data: null } }
}

export type FairStatus = 'upcoming' | 'ongoing' | 'ended'

export function makeFair(overrides: Record<string, unknown> = {}) {
  return {
    id: FAIR_ID,
    name: '2026 青岛高校毕业生招聘会',
    organizer: '青岛市公共就业服务中心',
    startTime: '2026-10-01T01:00:00.000Z',
    endTime: '2026-10-01T08:00:00.000Z',
    venue: '青岛国际会展中心',
    status: 'upcoming' as FairStatus,
    theme: 'campus',
    city: '青岛市',
    address: '崂山区苗岭路9号',
    trafficInfo: '地铁 11 号线苗岭路站 B 口步行 600 米',
    boothCount: 2,
    jobCount: 3,
    sourceOrgId: 'source-001',
    externalId: 'ext-fair-001',
    sourceName: '青岛公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/fairs/fair-001',
    checkinUrl: 'https://jobs.example.gov.cn/fairs/fair-001/checkin',
    syncTime: '2026-09-18T08:00:00.000Z',
    reviewStatus: 'approved',
    publishStatus: 'published',
    hasManagedData: true,
    managedCompanyCount: 2,
    managedMaterialCount: 1,
    dataSourceNote: '活动信息来自主办方，以来源平台和现场公告为准。',
    ...overrides,
  }
}

export const FAIR_COMPANY = {
  id: 'fair-company-001',
  jobFairId: FAIR_ID,
  name: '青岛示例制造有限公司',
  industry: '智能制造',
  scale: '规模以来源为准',
  description: '示例参展企业。',
  sourceUrl: 'https://jobs.example.gov.cn/companies/company-001',
  jobsCount: 1,
  zoneId: 'zone-001',
  boothNumber: 'A01',
  positions: [{ id: 'position-001', title: '前端工程师', headcount: 2, positionType: 'full_time' }],
}

export const FAIR_ZONE = {
  id: 'zone-001',
  jobFairId: FAIR_ID,
  name: '智能制造专区',
  category: '智能制造',
  city: '青岛市',
  description: '主办方标注的专区说明。',
  sortOrder: 1,
}

export const FAIR_BOOTH = {
  id: 'booth-001',
  fairId: FAIR_ID,
  zoneId: 'zone-001',
  zoneName: '智能制造专区',
  boothNumber: 'A01',
  status: 'occupied',
  companyId: FAIR_COMPANY.id,
  companyName: FAIR_COMPANY.name,
}

export const FAIR_MATERIAL = {
  id: 'material-001',
  fairId: FAIR_ID,
  name: '参展企业名单（完整版）',
  type: 'company_list',
  description: '主办方提供的参展单位与展位号对照表。',
  pageCount: 4,
  fileSizeKB: 820,
  printCount: 0,
  allowPrint: true,
  publishStatus: 'published',
  updatedAt: '2026-09-18T08:00:00.000Z',
}

/** 主办方真的回传了统计（isMockData=false）时的样子。 */
export const FAIR_STATS_REAL = {
  fairId: FAIR_ID,
  fairName: '2026 青岛高校毕业生招聘会',
  totalCompanies: 2,
  checkedInCompanies: 1,
  totalPositions: 3,
  totalHeadcount: 6,
  browseCount: 128,
  scanCount: null,
  printCount: null,
  checkinCount: 64,
  zoneBreakdown: [],
  lastUpdated: '2026-09-20T02:00:00.000Z',
  seekerIntent: [{ label: '智能制造', percent: 60 }],
  // 字段名按 FairIndustrySlice 的契约是 `label`，不是 `industry`。
  // 写错了页面照样渲染，只是那根柱子的名字是空的——夹具与真实契约不一致时，
  // 用例会「通过」，而真机上少一行字没人看得出来。
  industryDistribution: [{ label: '智能制造', count: 2 }],
  dataSourceLabel: '来源数据 · 非实时',
  isMockData: false,
}

const ok = (data: unknown) => ({ status: 200, json: { success: true, data } })
const page = (data: unknown[], total = data.length) => ({
  status: 200,
  json: { success: true, data, pagination: { page: 1, pageSize: 100, total, totalPages: total > 0 ? 1 : 0 } },
})
const boom = { status: 500, json: { error: { code: 'INTERNAL', message: 'fixture failure' } } }

export interface FairApiOptions {
  fair?: Record<string, unknown>
  /** 场次列表返回什么。`'error'` = 500，`'empty'` = 空页。 */
  list?: 'ok' | 'empty' | 'error' | 'pending'
  detail?: 'ok' | 'error' | 'pending'
  companies?: 'ok' | 'empty' | 'error' | 'pending'
  map?: 'ok' | 'empty' | 'error' | 'pending'
  materials?: 'ok' | 'empty' | 'error'
  /** `'real'` = isMockData:false 的真实统计；`'mock'` = isMockData:true（须降级空态）。 */
  stats?: 'real' | 'mock' | 'none' | 'error' | 'pending'
  venueGuide?: 'none' | 'ok' | 'error'
  /** 参会准备单「读上一次结果」的应答：404 = 还没生成过，500 = 这一步失败。 */
  visitPlanLatest?: 'none' | 'not-found' | 'error'
}

/** 未验证机器的生产默认能力集：每个键都下发，但 configured=false（fail-closed）。 */
const UNVERIFIED_CAPABILITIES = [
  'document_print', 'phone_upload', 'cloud_upload', 'usb_import', 'material_pack',
  'scan', 'copy', 'id_photo', 'format_convert', 'signature_stamp',
  'color_print', 'duplex_print',
].map((capabilityKey) => ({ capabilityKey, status: 'not_verified', note: null, configured: false, updatedAt: null }))

/**
 * /print/confirm 落地时会读本机能力（彩色 / 双面按登记决定可用性）。
 * 物料打印成功的用例会走到那一页，所以要单独登记——夹具 fail-closed，
 * 少一条就是 Unhandled API request，而症状看起来像「打印链路坏了」。
 */
export function registerPrintConfirm(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { terminalCode: 'KSK-001', capabilities: UNVERIFIED_CAPABILITIES },
  })
}

/** 壳层（KioskRoot）自己会拉的三条，与业务无关但必须登记，否则 fail-closed 会红。 */
export function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/health', { status: 200, json: { ok: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { isOnline: true, printerStatus: 'ready', paperLevel: 'sufficient' },
  })
}

export function registerFairApi(api: ApiRouter, options: FairApiOptions = {}): void {
  const {
    fair: fairOverrides,
    list = 'ok',
    detail = 'ok',
    companies = 'ok',
    map = 'ok',
    materials = 'ok',
    stats = 'mock',
    venueGuide = 'none',
    visitPlanLatest = 'none',
  } = options
  const fair = makeFair(fairOverrides)

  registerShell(api)

  if (list === 'pending') api.respondWith('GET', '/api/v1/job-fairs', NEVER)
  else if (list === 'error') api.respond('GET', '/api/v1/job-fairs', boom)
  else api.respond('GET', '/api/v1/job-fairs', page(list === 'empty' ? [] : [fair], list === 'empty' ? 0 : 1))

  if (detail === 'pending') api.respondWith('GET', `${P}`, NEVER)
  else if (detail === 'error') api.respond('GET', `${P}`, boom)
  else api.respond('GET', `${P}`, ok(fair))

  if (companies === 'pending') api.respondWith('GET', `${P}/companies`, NEVER)
  else if (companies === 'error') api.respond('GET', `${P}/companies`, boom)
  else api.respond('GET', `${P}/companies`, page(companies === 'empty' ? [] : [FAIR_COMPANY]))
  api.respond('GET', `${P}/companies/${FAIR_COMPANY.id}`, ok(FAIR_COMPANY))

  api.respond('GET', `${P}/zones`, ok(companies === 'empty' || map === 'empty' ? [] : [FAIR_ZONE]))

  if (map === 'pending') api.respondWith('GET', `${P}/map`, NEVER)
  else if (map === 'error') api.respond('GET', `${P}/map`, boom)
  else api.respond('GET', `${P}/map`, ok(map === 'empty' ? { zones: [], booths: [] } : { zones: [FAIR_ZONE], booths: [FAIR_BOOTH] }))

  if (venueGuide === 'error') api.respond('GET', `${P}/venue-guide`, boom)
  else api.respond('GET', `${P}/venue-guide`, venueGuide === 'ok'
    ? ok({
      fairId: FAIR_ID,
      venueName: '青岛国际会展中心',
      halls: [{
        hallId: 'hall-a',
        hallCode: 'A',
        hallName: '智能制造馆',
        industryCategory: '智能制造',
        boothRange: 'A01–A40',
        companyCount: 1,
        companies: [{ companyId: FAIR_COMPANY.id, companyName: FAIR_COMPANY.name, boothNo: 'A01', industry: '智能制造', jobCount: 1, jobTitles: ['前端工程师'] }],
      }],
      facilities: [{ id: 'f-1', type: 'entrance', name: '东门', locationLabel: '一层东侧' }],
    })
    : ok(null))

  if (materials === 'error') api.respond('GET', `${P}/materials`, boom)
  else api.respond('GET', `${P}/materials`, page(materials === 'empty' ? [] : [FAIR_MATERIAL]))

  // 参会准备单「读上一次结果」。两种失败形态必须分开：
  //   404 → 这场还没生成过（可生成）；500 → 这一步真的失败了（要重试，且不能装成空态）。
  if (visitPlanLatest === 'not-found') {
    api.respond('GET', `${P}/visit-plan/${VISIT_PLAN_TASK_ID}`, {
      status: 404,
      json: { error: { code: 'FAIR_VISIT_PLAN_NOT_FOUND', message: '暂无参会准备单，请先生成' } },
    })
  } else if (visitPlanLatest === 'error') {
    api.respond('GET', `${P}/visit-plan/${VISIT_PLAN_TASK_ID}`, boom)
  }

  if (stats === 'pending') api.respondWith('GET', `${P}/stats`, NEVER)
  else if (stats === 'error') api.respond('GET', `${P}/stats`, boom)
  else if (stats === 'none') api.respond('GET', `${P}/stats`, ok(null))
  else if (stats === 'real') api.respond('GET', `${P}/stats`, ok(FAIR_STATS_REAL))
  else api.respond('GET', `${P}/stats`, ok({ ...FAIR_STATS_REAL, isMockData: true }))
}
