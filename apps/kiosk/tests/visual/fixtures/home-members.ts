import type { Page, Request, Route } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, RECRUITMENT_HOSTING_ON, terminalConfigWithHosting } from '../../fixtures/recruitment-hosting'
import { registerPrivacyShell } from './privacy-clear-shell'

/**
 * 首页「继续办理」类走查（home-continue-handover、home-fill-when-empty）共用的夹具：
 * 几位带手机号的会员，各自名下的打印订单与简历，按令牌应答的登录与「我的」读取，
 * 以及首页第三行磁贴数不同的几种终端配置。
 */
export interface Member {
  phone: string
  masked: string
  id: string
  nickname: string
  token: string
}

export const WANG: Member = { phone: '13912345678', masked: '139****5678', id: 'member-wang-xiaoyu', nickname: '王晓雨', token: 'member-token-wang-xiaoyu' }
export const CHEN: Member = { phone: '13687654321', masked: '136****4321', id: 'member-chen-lixing', nickname: '陈立行', token: 'member-token-chen-lixing' }
export const LIN: Member = { phone: '13755556666', masked: '137****6666', id: 'member-lin-yue', nickname: '林悦', token: 'member-token-lin-yue' }
/** 登录着、名下没有进行中的打印，也没有待优化的简历：首页没有「继续办理」可摆。 */
export const MEI: Member = { phone: '13566667777', masked: '135****7777', id: 'member-mei-qing', nickname: '梅青', token: 'member-token-mei-qing' }
const MEMBERS = [WANG, CHEN, LIN, MEI]

export const WANG_FILE = '王晓雨-个人简历-2026秋招.pdf'
export const CHEN_FILE = '陈立行-求职信-物流专员.pdf'
export const PRINT_TITLE = '打印任务进行中'
export const RESUME_TITLE = '上次诊断的简历，可继续优化'

function printOrder(id: string, fileName: string, status: 'pending' | 'claimed' | 'printing', createdAt: string) {
  return {
    id,
    orderNo: `ORD-20261029-${id.slice(-6).toUpperCase()}`,
    status,
    fileName,
    createdAt,
    completedAt: null,
    copies: 1,
    colorMode: 'black_white',
    duplex: 'simplex',
    paperSize: 'A4',
    pageRange: 'all',
  }
}

function diagnosedResume(id: string, taskId: string) {
  return {
    id,
    taskId,
    kind: 'parse',
    status: 'completed',
    provider: 'deepseek',
    optimized: false,
    hasDraft: false,
    latestVersion: null,
    createdAt: '2026-10-29T01:03:11.000Z',
    updatedAt: '2026-10-29T01:04:52.000Z',
    expiresAt: null,
  }
}

/** 每个人名下的打印订单与简历，按令牌给；没带令牌或令牌不认识给 401。 */
const ORDERS: Record<string, unknown[]> = {
  [WANG.token]: [printOrder('task-wang-20261029-a3f7c2', WANG_FILE, 'printing', '2026-10-29T01:12:40.000Z')],
  [CHEN.token]: [printOrder('task-chen-20261029-9be041', CHEN_FILE, 'pending', '2026-10-29T02:31:05.000Z')],
  [LIN.token]: [],
  [MEI.token]: [],
}
const RESUMES: Record<string, unknown[]> = {
  [WANG.token]: [diagnosedResume('resume-row-wang-01', 'ai-task-wang-5d21e8')],
  [CHEN.token]: [],
  [LIN.token]: [diagnosedResume('resume-row-lin-01', 'ai-task-lin-77c0b4')],
  [MEI.token]: [],
}

export interface MeCall {
  path: string
  auth: string | null
}

/** 登录按手机号认人；打印订单、简历按令牌给各自的；记下每一条 /me 请求带的是谁的令牌。 */
export async function routeMembers(page: Page, api: ApiRouter): Promise<MeCall[]> {
  registerPrivacyShell(api)
  const calls: MeCall[] = []
  page.on('request', (request: Request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/me/')) calls.push({ path: url.pathname, auth: request.headers()['authorization'] ?? null })
  })
  await page.route('**/api/v1/member/auth/login', async (route) => {
    const body = route.request().postDataJSON() as { phone?: string }
    const member = MEMBERS.find((m) => m.phone === body.phone)
    await route.fulfill({
      status: member ? 200 : 400,
      contentType: 'application/json',
      body: JSON.stringify(member
        ? { success: true, data: { token: member.token, user: { id: member.id, phoneMasked: member.masked, nickname: member.nickname } } }
        : { success: false, error: { code: 'MEMBER_LOGIN_FAILED', message: '登录失败' } }),
    })
  })
  const byToken = (table: Record<string, unknown[]>) => async (route: Route) => {
    const auth = route.request().headers()['authorization'] ?? ''
    const member = MEMBERS.find((m) => auth === `Bearer ${m.token}`)
    await route.fulfill({
      status: member ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(member
        ? { success: true, data: { items: table[member.token] ?? [], nextCursor: null, total: (table[member.token] ?? []).length } }
        : { success: false, error: { code: 'MEMBER_UNAUTHORIZED', message: '请先登录' } }),
    })
  }
  await page.route('**/api/v1/me/print-orders**', byToken(ORDERS))
  await page.route('**/api/v1/me/resumes**', byToken(RESUMES))
  return calls
}


export type HomeVariant = 'default' | 'channels' | 'hosting' | 'gov' | 'full'

/** 本机构官方渠道（3.14）：有渠道时首页第三行多一块「本机构官方渠道」。 */
const OFFICIAL_CHANNELS = [
  { name: '就业指导中心微信公众号', url: 'https://mp.example.edu.cn/official', displayOrder: 1, organizationName: '青岛示例大学就业指导中心' },
  { name: '青岛示例大学就业信息网', url: 'https://career.example.edu.cn/jobs?from=kiosk', displayOrder: 2, organizationName: '青岛示例大学就业指导中心' },
]

/**
 * 首页第三行的磁贴数跟着终端配置走，≥ 4 块时首页进「压紧」版式（大卡矮一些）：
 *   default 2 块（到机取件、帮助）；channels 3 块（+ 本机构官方渠道）；
 *   hosting 4 块（托管打开：+ 社会招聘、校园招聘）；gov 5 块（渠道 + 百宝箱 + 智慧校园）；full 6 块。
 * 要在登录之前调用（终端配置在首页挂载时读）。
 */
export function configureHomeVariant(api: ApiRouter, variant: HomeVariant): void {
  const hostingOn = variant === 'hosting' || variant === 'full'
  const config = terminalConfigWithHosting(hostingOn ? RECRUITMENT_HOSTING_ON : RECRUITMENT_HOSTING_OFF, `home-variant-${variant}`)
  if (variant === 'gov' || variant === 'full') {
    config.toolbox = { enabled: true, items: [] }
    config.smartCampus = { enabled: true, modules: { welcome: true, bigdata: false, luggage: false, panorama: false }, items: [] }
  }
  api.respond('GET', '/api/v1/terminals/KSK-001/config', { status: 200, json: config })
  const channels = variant === 'channels' || variant === 'gov' ? OFFICIAL_CHANNELS : []
  api.respond('GET', '/api/v1/terminals/KSK-001/official-channels', { status: 200, json: { items: channels, legacyPlatforms: [] } })
}
