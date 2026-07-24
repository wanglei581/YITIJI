import type { Page } from '@playwright/test'
import { compatibilityRedirects, productionRoutePatterns } from '../route-manifest'
import { W6_LONG_LEGAL_TEXT } from './fusion-w6-api'

export type ProductionRoutePattern = (typeof productionRoutePatterns)[number]

export interface W6RouteCase {
  pattern: ProductionRoutePattern
  url: string
  marker: string
  viewport: 'kiosk' | 'mobile'
  landmark: 'main' | 'presentation' | 'none'
  requiresFusionRoot: boolean
  requiresTouchTargets: boolean
  featureText?: string
  longText?: string
  expectedPath?: string
  seed?: (page: Page) => Promise<void>
}

type W6RouteDefinition = Omit<W6RouteCase, 'viewport' | 'landmark' | 'requiresFusionRoot' | 'requiresTouchTargets'> & Partial<Pick<W6RouteCase, 'landmark' | 'requiresFusionRoot' | 'requiresTouchTargets'>>

const MOBILE_ROUTE_PATTERNS = new Set<ProductionRoutePattern>(['/member/qr-login', '/upload/phone'])
const TOUCH_TARGET_EXEMPTIONS = ['/screensaver', '/upload/phone'] as const satisfies readonly ProductionRoutePattern[]
const touchTargetExemptions = new Set<ProductionRoutePattern>(TOUCH_TARGET_EXEMPTIONS)

function createRouteCase(definition: W6RouteDefinition): W6RouteCase {
  const viewport = MOBILE_ROUTE_PATTERNS.has(definition.pattern) ? 'mobile' : 'kiosk'
  if (definition.requiresTouchTargets === false && !touchTargetExemptions.has(definition.pattern)) {
    throw new Error(`W6 touch-target exemption is not allowlisted: ${definition.pattern}`)
  }
  return {
    viewport,
    landmark: definition.landmark ?? 'main',
    requiresFusionRoot: definition.requiresFusionRoot ?? true,
    requiresTouchTargets: definition.requiresTouchTargets ?? !touchTargetExemptions.has(definition.pattern),
    ...definition,
  }
}

const screen = (name: string) => `[data-kiosk-screen="${name}"]`
const w2 = (name: string) => `[data-w2-page="${name}"]`
const w4 = '.w4-page-frame'
const member = screen('member-list')

async function seedScreensaver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.location.pathname !== '/screensaver') return
    window.history.replaceState({
      usr: {
        playlist: {
          enabled: true,
          idleTimeoutSec: 180,
          items: [{ id: 'w6-screen', type: 'image', url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E', durationSec: 60, sortOrder: 0 }],
        },
      },
      key: 'w6-screen',
      idx: 0,
    }, '', '/screensaver')
  })
}

const w6RouteDefinitions: readonly W6RouteDefinition[] = [
  { pattern: '/', url: '/', marker: '.kpv1', featureText: '简历、打印、岗位信息' },
  { pattern: '/login', url: '/login', marker: screen('login'), featureText: '登录后，简历和记录', landmark: 'none' },
  { pattern: '/member/qr-login', url: '/member/qr-login?ticketId=w6-ticket', marker: screen('member-qr-login'), featureText: '手机确认登录' },
  { pattern: '/upload/phone', url: '/upload/phone', marker: screen('phone-upload'), featureText: '上传链接已失效' },
  { pattern: '/legal/:doc', url: '/legal/privacy', marker: screen('legal-doc'), featureText: '隐私政策', longText: W6_LONG_LEGAL_TEXT, landmark: 'none' },
  { pattern: '/resume/job-fit', url: '/resume/job-fit', marker: screen('resume-job-fit'), featureText: '岗位匹配', requiresFusionRoot: false },
  { pattern: '/resume/career-plan', url: '/resume/career-plan', marker: screen('resume-career-plan'), featureText: '职业规划', requiresFusionRoot: false },
  { pattern: '/interview/setup', url: '/interview/setup', marker: screen('interview-setup'), featureText: '模拟面试', requiresFusionRoot: false },
  { pattern: '/interview/session', url: '/interview/session', marker: screen('interview-session'), featureText: '会话已失效', requiresFusionRoot: false },
  { pattern: '/interview/report', url: '/interview/report', marker: screen('interview-report'), featureText: '报告不存在或已过期', requiresFusionRoot: false },
  { pattern: '/interview/tips', url: '/interview/tips', marker: screen('interview-tips'), featureText: '面试', requiresFusionRoot: false },
  { pattern: '/interview/reports', url: '/interview/reports', marker: screen('interview-reports'), featureText: '面试报告', requiresFusionRoot: false },
  { pattern: '/screensaver', url: '/screensaver', marker: screen('screensaver'), featureText: '触摸屏幕开始使用', landmark: 'presentation', seed: seedScreensaver },
  { pattern: '/session-timeout', url: '/session-timeout', marker: screen('session-timeout'), featureText: '还在使用吗？' },
  { pattern: '/error-offline', url: '/error-offline', marker: screen('error-offline'), featureText: '网络连接中断' },
  { pattern: '/assistant', url: '/assistant', marker: screen('assistant'), featureText: '小青' },
  { pattern: '/profile', url: '/profile', marker: screen('profile'), featureText: '我的' },
  { pattern: '/me/resumes', url: '/me/resumes', marker: member, featureText: '我的简历' },
  { pattern: '/me/print-orders', url: '/me/print-orders', marker: member, featureText: '打印订单' },
  { pattern: '/me/documents', url: '/me/documents', marker: member, featureText: '我的文档' },
  { pattern: '/me/favorites', url: '/me/favorites', marker: member, featureText: '我的收藏' },
  { pattern: '/me/ai-records', url: '/me/ai-records', marker: member, featureText: 'AI服务记录' },
  { pattern: '/me/benefits', url: '/me/benefits', marker: member, featureText: '我的权益' },
  { pattern: '/me/activity', url: '/me/activity', marker: member, featureText: '浏览与跳转记录' },
  { pattern: '/me/activity/:id', url: '/me/activity/w6-record', marker: screen('activity-detail'), featureText: '登录后查看本人记录' },
  { pattern: '/me/notifications', url: '/me/notifications', marker: member, featureText: '消息通知' },
  { pattern: '/me/feedback', url: '/me/feedback', marker: member, featureText: '意见反馈' },
  { pattern: '/me/settings', url: '/me/settings', marker: screen('member-settings'), featureText: '账号设置' },
  { pattern: '/help', url: '/help', marker: screen('help'), featureText: '帮助中心' },
  { pattern: '/activities', url: '/activities', marker: screen('activities'), featureText: '权益活动' },
  { pattern: '/activities/:id', url: '/activities/activity-001', marker: screen('activity-detail'), featureText: '权益活动详情' },
  { pattern: '/renshi', url: '/renshi', marker: '.w4-policy-page', featureText: '仅信息指引 · 不代办' },
  { pattern: '/campus', url: '/campus', marker: '[data-kiosk-component="page-frame"] .campus-proto', featureText: '2026 青岛高校毕业生招聘会' },
  { pattern: '/campus/welcome', url: '/campus/welcome', marker: '[data-kiosk-component="page-frame"]', featureText: '校园招聘迎新指引' },
  { pattern: '/campus/freshman-insights', url: '/campus/freshman-insights', marker: '[data-kiosk-component="page-frame"]', featureText: '校园招聘数据' },
  { pattern: '/toolbox', url: '/toolbox', marker: screen('toolbox'), featureText: '百宝箱' },
  { pattern: '/smart-campus', url: '/smart-campus', marker: w4, featureText: '智慧校园' },
  { pattern: '/smart-campus/welcome', url: '/smart-campus/welcome', marker: w4, featureText: '迎新系统' },
  { pattern: '/smart-campus/freshman-insights', url: '/smart-campus/freshman-insights', marker: '[data-kiosk-component="page-frame"]:has-text("校园大数据暂未开放")', featureText: '校园大数据' },
  { pattern: '/smart-campus/service/:key', url: '/smart-campus/service/campus-card', marker: w4, featureText: '校园卡办理' },
  { pattern: '/print-scan', url: '/print-scan', marker: w2('print-scan-home'), featureText: '打印扫描服务' },
  { pattern: '/print-scan/feature/:key', url: '/print-scan/feature/id-photo', marker: w2('print-scan-feature'), featureText: '证件照' },
  { pattern: '/print-scan/convert', url: '/print-scan/convert', marker: w2('print-scan-convert'), featureText: '格式转换' },
  { pattern: '/print-scan/sign', url: '/print-scan/sign', marker: w2('print-scan-sign'), featureText: '签名盖章' },
  { pattern: '/print/scan-convert', url: '/print/scan-convert', expectedPath: compatibilityRedirects['/print/scan-convert'], marker: w2('print-scan-convert'), featureText: '格式转换' },
  { pattern: '/print/scan-sign', url: '/print/scan-sign', expectedPath: compatibilityRedirects['/print/scan-sign'], marker: w2('print-scan-sign'), featureText: '签名盖章' },
  { pattern: '/print/scan-feature', url: '/print/scan-feature', expectedPath: compatibilityRedirects['/print/scan-feature'], marker: w2('print-scan-feature'), featureText: '证件照' },
  { pattern: '/print/upload', url: '/print/upload', marker: w2('print-upload'), featureText: '文档打印' },
  { pattern: '/print/material-check', url: '/print/material-check', marker: 'p:text-is("未找到文件信息")', featureText: '未找到文件信息' },
  { pattern: '/print/preview', url: '/print/preview', marker: w2('print-preview'), featureText: '未找到文件信息' },
  { pattern: '/print/params', url: '/print/params', marker: w2('print-params'), featureText: '未找到文件信息' },
  { pattern: '/print/confirm', url: '/print/confirm', marker: w2('print-confirm'), featureText: '未找到文件信息' },
  { pattern: '/print/cashier', url: '/print/cashier', marker: 'p:text-is("未找到待支付订单")', featureText: '未找到待支付订单' },
  { pattern: '/print/progress', url: '/print/progress', marker: 'p:text-is("未找到打印任务")', featureText: '未找到打印任务' },
  { pattern: '/print/done', url: '/print/done', marker: w2('print-done'), featureText: '打印完成' },
  { pattern: '/resume', url: '/resume', expectedPath: compatibilityRedirects['/resume'], marker: screen('resume-source'), featureText: 'AI 简历诊断' },
  { pattern: '/resume/upload', url: '/resume/upload', expectedPath: compatibilityRedirects['/resume/upload'], marker: screen('resume-source'), featureText: 'AI 简历诊断' },
  { pattern: '/resume/source', url: '/resume/source', marker: screen('resume-source'), featureText: 'AI 简历诊断' },
  { pattern: '/resume/generate', url: '/resume/generate', marker: screen('resume-generate'), featureText: 'AI 简历生成' },
  { pattern: '/resume/generate/preview', url: '/resume/generate/preview', marker: screen('resume-generate-preview'), featureText: '生成结果已清除' },
  { pattern: '/resume/parse', url: '/resume/parse', marker: screen('resume-parse'), featureText: '正在读取上传文件' },
  { pattern: '/resume/report', url: '/resume/report', marker: screen('resume-report'), featureText: '还没有诊断报告' },
  { pattern: '/resume/optimize', url: '/resume/optimize', marker: screen('resume-optimize'), featureText: '请先上传简历完成诊断' },
  { pattern: '/resume/export', url: '/resume/export', marker: screen('resume-export'), featureText: '导出与打印' },
  { pattern: '/resume/templates', url: '/resume/templates', marker: screen('resume-templates'), featureText: '简历模板' },
  { pattern: '/resume/materials', url: '/resume/materials', marker: screen('resume-materials'), featureText: '求职材料' },
  { pattern: '/scan/start', url: '/scan/start', marker: w2('scan-start'), featureText: '扫描服务' },
  { pattern: '/scan/settings', url: '/scan/settings', marker: w2('scan-settings'), featureText: '扫描指引' },
  { pattern: '/scan/progress', url: '/scan/progress', expectedPath: '/scan/start', marker: w2('scan-start'), featureText: '扫描服务' },
  { pattern: '/scan/result', url: '/scan/result', marker: w2('scan-result'), featureText: '扫描未完成' },
  { pattern: '/jobs', url: '/jobs', marker: w4, featureText: '岗位信息' },
  { pattern: '/jobs/:id', url: '/jobs/job-001', marker: w4, featureText: '前端工程师' },
  { pattern: '/jobs/:id/offline', url: '/jobs/offline-job-001/offline', marker: w4, featureText: '线下机构岗位' },
  { pattern: '/offline-agencies', url: '/offline-agencies', marker: w4, featureText: '线下招聘机构' },
  { pattern: '/notifications', url: '/notifications', marker: member, featureText: '消息通知' },
  { pattern: '/companies', url: '/companies', marker: w4, featureText: '找企业' },
  { pattern: '/companies/:id', url: '/companies/company-001', marker: w4, featureText: '青岛示例制造有限公司' },
  { pattern: '/job-fairs', url: '/job-fairs', marker: w4, featureText: '招聘会' },
  { pattern: '/job-fairs/checkin', url: '/job-fairs/checkin', marker: w4, featureText: '来源平台入场入口' },
  { pattern: '/job-fairs/:id', url: '/job-fairs/fair-001', marker: w4, featureText: '2026 青岛高校毕业生招聘会' },
  { pattern: '/job-fairs/:id/companies', url: '/job-fairs/fair-001/companies', marker: w4, featureText: '参展企业' },
  { pattern: '/job-fairs/:id/companies/:companyId', url: '/job-fairs/fair-001/companies/fair-company-001', marker: w4, featureText: '青岛示例制造有限公司' },
  { pattern: '/job-fairs/:id/map', url: '/job-fairs/fair-001/map', marker: w4, featureText: '场馆导览' },
  { pattern: '/job-fairs/:id/materials', url: '/job-fairs/fair-001/materials', marker: w4, featureText: '活动资料' },
  { pattern: '/job-fairs/:id/visit-plan', url: '/job-fairs/fair-001/visit-plan', marker: w4, featureText: 'AI参会准备单' },
  { pattern: '/job-fairs/:id/stats', url: '/job-fairs/fair-001/stats', marker: 'p:text-is("真实数据正在接入")', featureText: '真实数据正在接入' },
] as const

export const w6RouteCases: readonly W6RouteCase[] = w6RouteDefinitions.map(createRouteCase)

export const w6KioskCases = w6RouteCases.filter(({ viewport }) => viewport === 'kiosk')
export const w6MobileCases = w6RouteCases.filter(({ viewport }) => viewport === 'mobile')

const actualPatterns = w6RouteCases.map(({ pattern }) => pattern)
const duplicates = actualPatterns.filter((pattern, index) => actualPatterns.indexOf(pattern) !== index)
const missing = productionRoutePatterns.filter((pattern) => !actualPatterns.includes(pattern))
const unexpected = actualPatterns.filter((pattern) => !productionRoutePatterns.includes(pattern))

if (duplicates.length || missing.length || unexpected.length || actualPatterns.length !== 86) {
  throw new Error(`W6 route ownership mismatch: count=${actualPatterns.length}; duplicates=${duplicates.join(',')}; missing=${missing.join(',')}; unexpected=${unexpected.join(',')}`)
}
if (w6MobileCases.length !== 2) throw new Error(`W6 mobile ownership mismatch: ${w6MobileCases.length}`)
if (w6KioskCases.length !== 84) throw new Error(`W6 kiosk ownership mismatch: ${w6KioskCases.length}`)
