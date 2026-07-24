import type { ApiRouter } from '../../fixtures/api-router'
import { registerW4Api } from '../../fixtures/fusion-w4-api'

const success = (data: unknown) => ({ success: true, data })

export const W6_LONG_LEGAL_TEXT = '这是用于 W6 路由验收的超长隐私政策段落：终端仅在用户主动发起简历分析、文档打印或扫描时处理完成当次服务所必需的信息，不建立企业可检索的简历库，不向企业转交求职材料，也不在平台内提供投递、筛选、面试邀约或录用管理。匿名文件和高敏材料按服务配置设置短期有效期，公共终端在退出、闲置超时或进入待机后清理会话信息。用户应在打印前复核文件内容、页数和打印参数，在使用 AI 或 OCR 结果前复核姓名、联系方式、经历与其他关键信息；如需查看、删除或调整本人记录，请在登录后使用「我的」相应入口，或联系现场工作人员处理。'

export function registerW6Api(api: ApiRouter): void {
  registerW4Api(api)

  const get = (path: string, json: unknown) => api.respond('GET', path, { status: 200, json })
  const post = (path: string, json: unknown) => api.respond('POST', path, { status: 200, json })
  const del = (path: string, json: unknown) => api.respond('DELETE', path, { status: 200, json })

  get('/api/v1/terminals/KSK-001/capabilities', { capabilities: [] })
  get('/api/v1/terminals/KSK-001/smart-campus', { enabled: true, modules: { welcome: true, bigdata: false, luggage: true, panorama: true }, items: [] })
  get('/api/v1/kiosk/device/status', { data: { scanner: { status: 'ready', online: true, busy: false } } })
  get('/api/v1/print/price-config', { billingEnabled: true, items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] })
  get('/api/v1/kiosk/legal/terms_of_service', success({
    content: 'W6 用户服务协议验收文本。本终端不提供平台内投递，岗位与招聘会仅作为来源信息入口。',
    publishedAt: '2026-07-24T00:00:00.000Z',
  }))
  get('/api/v1/kiosk/legal/privacy_policy', success({
    content: W6_LONG_LEGAL_TEXT,
    publishedAt: '2026-07-24T00:00:00.000Z',
  }))
  get('/api/v1/member/auth/qr/w6-ticket/status', success({ status: 'pending', deviceLabel: 'W6 验收终端', expiresAt: '2099-01-01T00:00:00.000Z' }))
  get('/api/v1/mock-interviews/capabilities/voice', { data: { asrEnabled: false, ttsEnabled: false } })
  get('/api/v1/activities', success({ items: [] }))
  get('/api/v1/activities/activity-001', success({
    id: 'activity-001', title: 'W6 打印服务体验活动', description: '用于路由验收的合成活动。',
    benefitType: 'free_quota', sourceType: 'platform', quantityTotal: 1, stockRemaining: 10,
    validFrom: null, validUntil: null, rulesText: '仅用于验收', claimed: false, soldOut: false, ended: false,
  }))
  get('/api/v1/job-materials/templates', success([]))

  const offlineJob = {
    id: 'offline-job-001', title: '现场咨询岗位', salary: '薪资面议', jobType: 'fulltime', location: '青岛市',
    tags: ['现场咨询'], responsibilities: ['了解公开岗位信息'], requirements: ['携带本人材料到店咨询'],
    agencyId: 'agency-001', agencyName: '青岛合规人力服务机构', agencyType: '人力资源服务机构',
    agencyAddress: '市南区示例路1号', agencyHours: '09:00–17:00', agencyPhone: '0532-00000000',
    agencyServices: ['岗位咨询'], sourceName: '线下机构公开信息', sourceType: 'offline_agency',
    syncTime: '2026-07-24T08:00:00.000Z', externalId: 'offline-ext-001',
    agency: { id: 'agency-001', name: '青岛合规人力服务机构', orgType: '人力资源服务机构', address: '市南区示例路1号', phone: '0532-00000000', openHours: '09:00–17:00', services: '岗位咨询', status: 'open' },
  }
  get('/api/v1/kiosk/offline-jobs/offline-job-001', success(offlineJob))

  const fairCompany = {
    id: 'fair-company-001', jobFairId: 'fair-001', name: '青岛示例制造有限公司', industry: '智能制造',
    scale: 'medium', description: '示例参展企业。', sourceUrl: 'https://jobs.example.gov.cn/companies/company-001',
    jobsCount: 1, zoneId: 'zone-001', boothNumber: 'A01',
    positions: [{ id: 'position-001', title: '前端工程师', headcount: 2, positionType: 'full_time' }],
  }
  get('/api/v1/job-fairs/fair-001/companies/fair-company-001', success(fairCompany))
  get('/api/v1/job-fairs/fair-001/map', success({ zones: [{ id: 'zone-001', jobFairId: 'fair-001', name: '智能制造专区', category: '智能制造', city: '青岛市', sortOrder: 1 }], booths: [] }))
  get('/api/v1/job-fairs/fair-001/materials', { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } })
  get('/api/v1/job-fairs/fair-001/venue-guide', success(null))

  post('/api/v1/scan/sessions', success({
    scanTaskId: 'w6-scan-001', controlToken: 'w6-control', status: 'waiting', scanType: 'document',
    instructions: ['放好原件', '在打印机面板开始扫描'], expiresAt: '2099-01-01T00:00:00.000Z',
  }))
  del('/api/v1/scan/sessions/w6-scan-001', success({ scanTaskId: 'w6-scan-001', status: 'cancelled' }))
}
