// 青序并排截图 · 31 权益与活动、40 意见反馈、41 隐私与数据请求。
//
// 只拦 /api/v1、点可见控件，不改页面。会员沿用「林晓雯 / 136****9028」。
// 试点期不写收费金额，也不写「免费领」。活动标题用虚构服务点。
// 运行页没有整屏的态，配到最接近的那一屏，reason 里写明。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../../fixtures/recruitment-hosting'
import { registerMemberLogin } from './kiosk-p1-evidence-capture-api'
import type { QingxuPairTarget, RuntimePlan } from './qingxu-pair-targets'

export interface MePages2Plan {
  plan: RuntimePlan
  reason: string | null
  marker: string | null
  runtimePath: string | null
}

const PLAN: RuntimePlan = { kind: 'me-pages-2' }
const NONE: RuntimePlan = { kind: 'none' }

const BENEFITS = '/api/v1/me/benefits'
const ACTIVITIES = '/api/v1/activities'
const FEEDBACK = '/api/v1/me/feedback'
const PRIVACY = '/api/v1/me/data-requests'

const PRINT_ID = 'act-haichuan-print'
const ENDED_ID = 'act-linjiang-plan'
const SOLD_ID = 'act-qinghe-scan'
const DETAIL_ID = 'fb-ai-slow'
const OPEN_ID = 'fb-preview-cut'
const NEW_ID = 'fb-new-1006'

const NO_SCREEN = '运行页没有整屏态'

const ACTIVITY_REASON: Record<string, string> = {
  'claim-pending': `${NO_SCREEN}。点「立即领取」后按钮停在「领取中…」，整页仍是活动详情。`,
  'claim-success': `${NO_SCREEN}。领取成功只在详情页上出一句「领取成功，已加入我的权益」。`,
  'claim-error': `${NO_SCREEN}。领取失败只在详情页上出一句「领取失败，请稍后重试」。`,
  ended: `${NO_SCREEN}。没有单独的结束页，仍是活动详情，库存标成「已结束」，领取按钮禁用。`,
  'sold-out': `${NO_SCREEN}。没有单独的领完页，仍是活动详情，库存标成「已领完」，领取按钮禁用。`,
}

const PRIVACY_REASON: Record<string, string> = {}

type JsonReply = { status: number; json: unknown }

function ok(data: unknown): JsonReply {
  return { status: 200, json: { success: true, data } }
}

function fail(): JsonReply {
  return { status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'upstream unavailable' } } }
}

function hang(): Promise<never> {
  return new Promise(() => undefined)
}

function hit(marker: string, runtimePath: string, reason: string | null = null): MePages2Plan {
  return { plan: PLAN, reason, marker, runtimePath }
}

function missing(reason: string): MePages2Plan {
  return { plan: NONE, reason, marker: null, runtimePath: null }
}

async function show(page: Page, selector: string): Promise<void> {
  const loc = page.locator(selector).first()
  await loc.waitFor({ state: 'visible', timeout: 20_000 })
  await loc.scrollIntoViewIfNeeded()
}

async function loginTo(page: Page, returnTo: string): Promise<void> {
  const pathOnly = returnTo.split('?')[0]
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  const phoneTab = page.getByRole('button', { name: '手机号登录', exact: true })
  if (await phoneTab.count()) await phoneTab.click()
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  const smsTab = page.getByRole('button', { name: '短信验证码', exact: true })
  if (await smsTab.count()) await smsTab.click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === pathOnly)
}

function prime(api: ApiRouter, token = 'kiosk-session-linxiaowen'): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'qingxu-pairs-me-2'),
  })
  registerMemberLogin(api)
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token,
        user: { id: 'member-linxiaowen', phoneMasked: '136****9028', nickname: '林晓雯' },
      },
    },
  })
}

// ── 31 权益与活动 ────────────────────────────────────────────────

const RULES = '面向在本服务点使用一体机的求职者。登录后可以领取，每人一次。名额用完即止。是否收费以现场公示为准。不代办补贴，也不把权益换成简历投递。'

type Activity = {
  id: string
  title: string
  description: string | null
  rulesText: string | null
  benefitType: 'package_entitlement' | 'ai_quota' | 'subsidy_eligibility_hint'
  sourceType: 'partner' | 'gov' | 'platform'
  quantityTotal: number | null
  stockTotal: number | null
  stockRemaining: number | null
  claimLimitPerUser: number
  status: 'published' | 'ended'
  validFrom: string | null
  validUntil: string | null
  grantValidDays: number | null
  claimable: boolean
  claimed: boolean
  soldOut: boolean
  ended: boolean
  createdAt: string
  updatedAt: string
}

function activity(input: Pick<Activity, 'id' | 'title'> & Partial<Activity>): Activity {
  return {
    description: '试运行期间的服务说明。是否收费以现场公示为准。',
    rulesText: RULES,
    benefitType: 'package_entitlement',
    sourceType: 'partner',
    quantityTotal: 20,
    stockTotal: 40,
    stockRemaining: 27,
    claimLimitPerUser: 1,
    status: 'published',
    validFrom: '2026-09-15T09:00:00.000+08:00',
    validUntil: '2026-11-30T18:00:00.000+08:00',
    grantValidDays: 90,
    claimable: true,
    claimed: false,
    soldOut: false,
    ended: false,
    createdAt: '2026-09-15T09:00:00.000+08:00',
    updatedAt: '2026-10-01T10:00:00.000+08:00',
    ...input,
  }
}

const ACTIVITIES_ITEMS: Activity[] = [
  activity({
    id: PRINT_ID,
    title: '海川区就业服务点 · 试运行打印服务',
    description: '在海川区就业服务点的一体机上整理并打印求职材料。额度记在本人账号上，是否收费以现场公示为准。',
  }),
  activity({
    id: 'act-chengwan-ai',
    title: '澄湾区人力资源服务点 · 简历诊断体验',
    benefitType: 'ai_quota',
    sourceType: 'gov',
    quantityTotal: 6,
    stockTotal: 12,
    stockRemaining: 3,
    description: '可把一份简历交给诊断。次数用完后本活动不再发放。',
    validFrom: '2026-09-20T09:00:00.000+08:00',
    validUntil: '2026-10-31T18:00:00.000+08:00',
  }),
  activity({
    id: SOLD_ID,
    title: '青禾街道便民服务点 · 材料扫描整理',
    stockTotal: 15,
    stockRemaining: 0,
    soldOut: true,
    claimable: false,
    description: '把纸质材料扫描成 PDF 并整理页序。名额已经领完。',
    validFrom: '2026-09-01T09:00:00.000+08:00',
  }),
  activity({
    id: ENDED_ID,
    title: '临江区就业服务点 · 职业规划咨询说明',
    benefitType: 'subsidy_eligibility_hint',
    sourceType: 'gov',
    quantityTotal: null,
    stockTotal: 30,
    stockRemaining: 11,
    status: 'ended',
    ended: true,
    claimable: false,
    description: '只说明职业规划可以怎么看、去哪个窗口问。活动已结束，不再领取。',
    rulesText: '活动已于 9 月 30 日结束，不能再领取。此前领过的说明仍可在我的权益里查看。不代办、不到账。',
    validFrom: '2026-08-20T09:00:00.000+08:00',
    validUntil: '2026-09-30T18:00:00.000+08:00',
    grantValidDays: null,
  }),
  activity({
    id: 'act-chengwan-window',
    title: '澄湾区公共就业服务点 · 窗口办事材料清单',
    benefitType: 'subsidy_eligibility_hint',
    sourceType: 'gov',
    quantityTotal: null,
    stockTotal: null,
    stockRemaining: null,
    description: '列出窗口常问的材料，并给出官方办事入口。本机不代办。',
    validFrom: '2026-09-10T09:00:00.000+08:00',
    validUntil: '2026-12-31T18:00:00.000+08:00',
    grantValidDays: null,
  }),
  activity({
    id: 'act-haichuan-resume',
    title: '海川区就业服务点 · 简历排版整理',
    claimed: true,
    claimable: false,
    stockTotal: 50,
    stockRemaining: 22,
    description: '帮你把已有简历排成适合打印的两页。林晓雯已领取。',
    validFrom: '2026-09-18T09:00:00.000+08:00',
    validUntil: '2026-11-18T18:00:00.000+08:00',
  }),
]

function activityById(id: string, patch: Partial<Activity> = {}): Activity {
  const found = ACTIVITIES_ITEMS.find((item) => item.id === id) ?? ACTIVITIES_ITEMS[0]
  return { ...found, ...patch }
}

const BENEFIT_ROWS = [
  { id: 'grant-resume', benefitType: 'package_entitlement', title: '海川区就业服务点 · 简历排版整理', description: '已领取的排版整理额度。是否收费以现场公示为准。', quantityTotal: 8, quantityRemaining: 6, status: 'active', sourceType: 'partner', validFrom: '2026-09-18T10:20:00.000+08:00', validUntil: '2026-12-18T10:20:00.000+08:00', createdAt: '2026-09-18T10:20:00.000+08:00' },
  { id: 'grant-ai', benefitType: 'ai_quota', serviceKey: 'ai_resume', title: '澄湾区人力资源服务点 · 简历诊断体验', description: '诊断次数记在本人账号上，用完即止。', quantityTotal: 6, quantityRemaining: 4, status: 'active', sourceType: 'gov', validFrom: '2026-09-21T14:05:00.000+08:00', validUntil: '2026-12-21T14:05:00.000+08:00', createdAt: '2026-09-21T14:05:00.000+08:00' },
  { id: 'grant-scan', benefitType: 'package_entitlement', title: '青禾街道便民服务点 · 材料扫描整理', description: '扫描整理额度已经用完，本页只保留记录。', quantityTotal: 4, quantityRemaining: 0, status: 'used_up', sourceType: 'partner', validFrom: '2026-09-02T11:16:00.000+08:00', validUntil: '2026-12-02T11:16:00.000+08:00', createdAt: '2026-09-02T11:16:00.000+08:00' },
  { id: 'grant-plan', benefitType: 'subsidy_eligibility_hint', title: '临江区就业服务点 · 职业规划咨询说明', description: '只保留当时的说明，不代表补贴已经办成。', quantityTotal: null, quantityRemaining: null, status: 'expired', sourceType: 'gov', validFrom: '2026-08-20T09:30:00.000+08:00', validUntil: '2026-09-30T18:00:00.000+08:00', createdAt: '2026-08-20T09:30:00.000+08:00' },
  { id: 'grant-skill', benefitType: 'subsidy_eligibility_hint', title: '澄湾区公共就业服务点 · 职业技能培训报名说明', description: '材料清单和官方入口。本机不代办、不到账。', quantityTotal: null, quantityRemaining: null, status: 'active', sourceType: 'gov', validFrom: '2026-09-28T09:40:00.000+08:00', validUntil: '2026-12-31T18:00:00.000+08:00', createdAt: '2026-09-28T09:40:00.000+08:00' },
  { id: 'grant-window', benefitType: 'package_entitlement', title: '海川区就业服务点 · 窗口材料整理', description: '这项额度已撤销，不能再使用。', quantityTotal: 10, quantityRemaining: 0, status: 'revoked', sourceType: 'partner', validFrom: '2026-09-12T15:10:00.000+08:00', validUntil: '2026-12-12T15:10:00.000+08:00', createdAt: '2026-09-12T15:10:00.000+08:00' },
]

const PRINT_GRANT = {
  id: 'grant-haichuan-print',
  benefitType: 'package_entitlement',
  title: '海川区就业服务点 · 试运行打印服务',
  description: '刚刚领取的打印服务额度。是否收费以现场公示为准。',
  quantityTotal: 20,
  quantityRemaining: 20,
  status: 'active',
  sourceType: 'partner',
  validFrom: '2026-10-06T10:05:00.000+08:00',
  validUntil: '2027-01-04T10:05:00.000+08:00',
  createdAt: '2026-10-06T10:05:00.000+08:00',
}

function activityRuntime(state: string): string {
  if (state === 'ended') return `/activities/${ENDED_ID}`
  if (state === 'sold-out') return `/activities/${SOLD_ID}`
  return `/activities/${PRINT_ID}`
}

function benefitsPlan(screen: string, state: string): MePages2Plan {
  if (screen === 'benefits') return hit(`[data-testid="benefits-state-${state}"]`, '/me/benefits')
  if (screen === 'activities') {
    const marker = state === 'loading'
      ? '[data-kiosk-screen="activities"] p:text-is("加载中…")'
      : state === 'empty'
        ? '[data-kiosk-screen="activities"] p:text-is("暂无可领取活动")'
        : state === 'error'
          ? '[data-kiosk-screen="activities"] p:text-is("出现了一些问题")'
          : '[data-kiosk-screen="activities"] h2:text-is("海川区就业服务点 · 试运行打印服务")'
    return hit(marker, '/activities')
  }
  if (screen === 'activity') {
    const marker = state === 'detail'
      ? '[data-kiosk-screen="activity-detail"] button[aria-label="立即领取"]'
      : state === 'signed-out'
        ? '[data-kiosk-screen="activity-detail"] button[aria-label="登录后领取"]'
        : state === 'claim-pending'
          ? '[data-kiosk-screen="activity-detail"] button[aria-label="领取中…"]'
          : state === 'claim-success'
            ? '.k8-act-message.is-success'
            : state === 'claim-error'
              ? '.k8-act-message.is-error'
              : state === 'ended'
                ? '.k8-act-stock:text-is("已结束")'
                : state === 'sold-out'
                  ? '.k8-act-stock:text-is("已领完")'
                  : null
    if (!marker) return missing(`这一态没有现成注册器：activity/${state}`)
    return hit(marker, activityRuntime(state), ACTIVITY_REASON[state] ?? null)
  }
  return missing(`这一态没有现成注册器：${screen}/${state}`)
}

async function prepareBenefits(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  const { screen, state } = target
  if (screen === 'benefits') {
    if (state === 'loading') api.respondWith('GET', BENEFITS, hang)
    else if (state === 'error') api.respond('GET', BENEFITS, fail())
    else if (state === 'empty') api.respond('GET', BENEFITS, ok({ items: [], nextCursor: null, total: 0 }))
    else api.respond('GET', BENEFITS, ok({ items: BENEFIT_ROWS, nextCursor: null, total: BENEFIT_ROWS.length }))
    if (state !== 'signed-out') await loginTo(page, '/me/benefits')
    else await page.goto('/me/benefits', { waitUntil: 'domcontentloaded' })
    return
  }
  if (screen === 'activities') {
    if (state === 'loading') api.respondWith('GET', ACTIVITIES, hang)
    else if (state === 'error') api.respond('GET', ACTIVITIES, fail())
    else if (state === 'empty') api.respond('GET', ACTIVITIES, ok({ items: [], total: 0 }))
    else api.respond('GET', ACTIVITIES, ok({ items: ACTIVITIES_ITEMS, total: ACTIVITIES_ITEMS.length }))
    await loginTo(page, '/activities')
    return
  }
  const id = state === 'ended' ? ENDED_ID : state === 'sold-out' ? SOLD_ID : PRINT_ID
  const path = `/api/v1/activities/${id}`
  if (state === 'claim-success') {
    let seen = 0
    api.respondWith('GET', path, () => {
      seen += 1
      return ok(activityById(id, { claimed: seen > 1, claimable: seen <= 1 }))
    })
    api.respond('POST', `${path}/claim`, ok(PRINT_GRANT))
  } else {
    api.respond('GET', path, ok(activityById(id)))
  }
  if (state === 'claim-pending') api.respondWith('POST', `${path}/claim`, hang)
  if (state === 'claim-error') {
    api.respond('POST', `${path}/claim`, {
      status: 409,
      json: { success: false, error: { code: 'BENEFIT_ACTIVITY_NOT_CLAIMABLE', message: '活动暂不可领取' } },
    })
  }
  const runtime = activityRuntime(state)
  if (state === 'signed-out') await page.goto(runtime, { waitUntil: 'domcontentloaded' })
  else await loginTo(page, runtime)
  if (state !== 'claim-pending' && state !== 'claim-success' && state !== 'claim-error') return
  const button = page.getByRole('button', { name: '立即领取', exact: true })
  await button.waitFor({ state: 'visible', timeout: 20_000 })
  await button.click()
}

// ── 40 意见反馈 ──────────────────────────────────────────────────

type Reply = { id: string; senderType: 'user' | 'admin'; actorId: string | null; content: string; createdAt: string }
type Ticket = {
  id: string
  category: 'device' | 'print' | 'file_process' | 'general' | 'ai_content'
  title: string
  content: string
  contactPhoneMasked: string | null
  terminalId: string | null
  relatedPrintTaskId: string | null
  status: 'pending' | 'processing' | 'replied' | 'closed'
  createdAt: string
  updatedAt: string
  replies: Reply[]
}

function ticket(input: Omit<Ticket, 'contactPhoneMasked' | 'terminalId' | 'relatedPrintTaskId' | 'replies'> & { replies?: Reply[] }): Ticket {
  return {
    contactPhoneMasked: '136****9028',
    terminalId: 'KSK-001',
    relatedPrintTaskId: null,
    replies: [],
    ...input,
  }
}

const TICKETS: Ticket[] = [
  ticket({
    id: 'fb-scan-gun',
    category: 'device',
    title: '扫码枪扫不出到机码',
    content: '今天在这台机器上取打印件，扫码枪对着到机码扫了几次都没反应，屏幕还停在输入码的地方。',
    status: 'pending',
    createdAt: '2026-10-05T14:26:00.000+08:00',
    updatedAt: '2026-10-05T14:26:00.000+08:00',
  }),
  ticket({
    id: OPEN_ID,
    category: 'print',
    title: '打印预览页文字被截掉一行',
    content: '简历预览最下面一行字被裁掉了，按预览打出来也少这一行。文件是两页的行政助理简历。',
    status: 'processing',
    createdAt: '2026-10-02T09:18:00.000+08:00',
    updatedAt: '2026-10-03T11:05:00.000+08:00',
    replies: [{
      id: 'rp-preview-1',
      senderType: 'admin',
      actorId: null,
      content: '已经看到这条反馈。我们会在这台机器上对一下预览和出纸是不是同一处裁切。核对完把结果写在这条记录里，先不约具体时间。',
      createdAt: '2026-10-03T11:05:00.000+08:00',
    }],
  }),
  ticket({
    id: DETAIL_ID,
    category: 'ai_content',
    title: 'AI 诊断等了很久',
    content: '10 月 1 日上午用简历诊断，转圈转了很久，最后也没有给出诊断。不知道是没生成，还是页面卡住了。',
    status: 'replied',
    createdAt: '2026-09-28T10:42:00.000+08:00',
    updatedAt: '2026-09-29T15:18:00.000+08:00',
    replies: [{
      id: 'rp-ai-1',
      senderType: 'admin',
      actorId: null,
      content: '诊断等待过久这件事我们已经记下。这次如果没有生成结果，可以再提交一次。还是一直转圈的话，可以拨打服务电话，我们远程查这台机器的网络。不承诺当天一定出结果。',
      createdAt: '2026-09-29T15:18:00.000+08:00',
    }],
  }),
  ticket({
    id: 'fb-font',
    category: 'general',
    title: '希望字再大一点',
    content: '我站在机器前，预览和按钮上的字偏小，要凑近才能看清。希望正文能再大一号。',
    status: 'closed',
    createdAt: '2026-09-22T16:08:00.000+08:00',
    updatedAt: '2026-09-24T09:30:00.000+08:00',
    replies: [
      { id: 'rp-font-1', senderType: 'user', actorId: 'member-linxiaowen', content: '主要是预览和底部按钮，站远一点看不清。', createdAt: '2026-09-23T11:12:00.000+08:00' },
      { id: 'rp-font-2', senderType: 'admin', actorId: null, content: '字号我们按你站在机器前的距离再核一遍。这条先关闭。之后如果还是看不清，可以再开一条新的反馈。', createdAt: '2026-09-24T09:30:00.000+08:00' },
    ],
  }),
  ticket({
    id: 'fb-scan-blank',
    category: 'file_process',
    title: '扫描件预览是空白的',
    content: '昨天扫了一页学历证明，扫描完成了，打开预览却是空白，不确定有没有扫进去。',
    status: 'pending',
    createdAt: '2026-09-30T17:46:00.000+08:00',
    updatedAt: '2026-09-30T17:46:00.000+08:00',
  }),
  ticket({
    id: 'fb-touch',
    category: 'device',
    title: '屏幕要点第二次才有反应',
    content: '选打印份数的时候，第一次点加号经常没反应，要点第二次数字才变。',
    status: 'processing',
    createdAt: '2026-09-25T13:22:00.000+08:00',
    updatedAt: '2026-09-26T10:04:00.000+08:00',
  }),
  ticket({
    id: 'fb-duplex',
    category: 'print',
    title: '双面打印只出了正面',
    content: '两页简历我选了双面，出纸只有正面，背面是空白。',
    status: 'replied',
    createdAt: '2026-09-18T11:36:00.000+08:00',
    updatedAt: '2026-09-19T09:48:00.000+08:00',
    replies: [{
      id: 'rp-duplex-1',
      senderType: 'admin',
      actorId: null,
      content: '双面只出正面，多半是这一单的翻面设置没加上。再打的时候看一下参数里是不是「单面」。如果选了双面仍只出一面，把大致时间留在反馈里，我们查这台机器的打印记录。先不约定上门时间。',
      createdAt: '2026-09-19T09:48:00.000+08:00',
    }],
  }),
  ticket({
    id: 'fb-plan',
    category: 'ai_content',
    title: '职业规划建议和我填的专业对不上',
    content: '我填的是行政管理，生成的建议却在讲软件开发。看起来不像根据我这次填写写的。',
    status: 'closed',
    createdAt: '2026-09-16T15:05:00.000+08:00',
    updatedAt: '2026-09-17T10:26:00.000+08:00',
    replies: [{
      id: 'rp-plan-1',
      senderType: 'admin',
      actorId: null,
      content: '职业规划建议是按你当时填写的内容生成的。对不上，就说明那次读到的专业和你想写的不一致。可以在职业规划里改一版再生成。这条按你的要求关闭。',
      createdAt: '2026-09-17T10:26:00.000+08:00',
    }],
  }),
]

function ticketById(id: string): Ticket {
  return TICKETS.find((item) => item.id === id) ?? TICKETS[0]
}

function listItem(item: Ticket) {
  const { replies, ...rest } = item
  void replies
  return rest
}

const NEW_TICKET: Ticket = ticket({
  id: NEW_ID,
  category: 'print',
  title: '打印预览少了一行',
  content: '打印预览页最下面一行字被裁掉了，打出来也少这一行。',
  status: 'pending',
  createdAt: '2026-10-06T10:16:00.000+08:00',
  updatedAt: '2026-10-06T10:16:00.000+08:00',
})

function feedbackPlan(state: string): MePages2Plan {
  // 「正在提交…」写在按钮里的 span 上。button:text-is 只认按钮自己的文本节点，配不到。
  const marker = state === 'submit-busy'
    ? 'button[disabled] span:text-is("正在提交…")'
    : state === 'success'
      ? '.fb-toast:text-is("反馈已提交")'
      : state === 'failure'
        ? '.fb-toast:text-is("提交失败，请检查登录状态或稍后重试")'
        : state === 'reply-busy'
          ? 'button[disabled] span:text-is("正在提交…")'
          : state === 'close-busy'
            ? 'button[disabled]:text-is("正在关闭…")'
            : `[data-testid="member-feedback-state-${state}"]`
  return hit(marker, '/me/feedback', null)
}

async function fillField(page: Page, name: string, value: string): Promise<void> {
  const field = page.getByRole('textbox', { name, exact: true })
  await field.click()
  await field.fill(value)
}

async function prepareFeedback(page: Page, api: ApiRouter, state: string): Promise<void> {
  const ticketId = state === 'detail-loading' || state === 'detail-ready'
    ? DETAIL_ID
    : state === 'reply-busy' || state === 'close-busy'
      ? OPEN_ID
      : null
  if (state === 'service-unavailable') prime(api, '')
  if (state === 'loading') api.respondWith('GET', FEEDBACK, hang)
  else if (state === 'error') api.respond('GET', FEEDBACK, fail())
  else if (state === 'list-empty') api.respond('GET', FEEDBACK, ok({ items: [], nextCursor: null, total: 0 }))
  else api.respond('GET', FEEDBACK, ok({ items: TICKETS.map(listItem), nextCursor: null, total: TICKETS.length }))
  if (ticketId && state === 'detail-loading') api.respondWith('GET', `${FEEDBACK}/${ticketId}`, hang)
  else if (ticketId) api.respond('GET', `${FEEDBACK}/${ticketId}`, ok(ticketById(ticketId)))
  if (state === 'submit-busy') api.respondWith('POST', FEEDBACK, hang)
  if (state === 'failure') api.respond('POST', FEEDBACK, fail())
  if (state === 'success') {
    api.respond('POST', FEEDBACK, ok(NEW_TICKET))
    api.respond('GET', `${FEEDBACK}/${NEW_ID}`, ok(NEW_TICKET))
  }
  if (state === 'reply-busy' && ticketId) api.respondWith('POST', `${FEEDBACK}/${ticketId}/replies`, hang)
  if (state === 'close-busy' && ticketId) api.respondWith('PATCH', `${FEEDBACK}/${ticketId}/close`, hang)

  if (state === 'login') {
    await page.goto('/me/feedback', { waitUntil: 'domcontentloaded' })
    return
  }
  await loginTo(page, ticketId ? `/me/feedback?ticket=${ticketId}` : '/me/feedback')
  if (state === 'submit-busy' || state === 'success' || state === 'failure') {
    await show(page, '[data-testid="member-feedback-state-form-list"]')
    await page.getByRole('button', { name: /^打印服务/ }).click()
    await fillField(page, '反馈内容', '打印预览页最下面一行字被裁掉了，打出来也少这一行。')
    await page.getByRole('button', { name: '提交反馈', exact: true }).click()
  }
  if (state === 'reply-busy' || state === 'close-busy') {
    await show(page, '[data-testid="member-feedback-state-detail-ready"]')
  }
  if (state === 'reply-busy') {
    await fillField(page, '补充描述', '出纸的时候，少的也是预览里最下面那一行。')
    await page.getByRole('button', { name: '追加描述', exact: true }).click()
  }
  if (state === 'close-busy') {
    await page.getByRole('button', { name: '关闭反馈', exact: true }).click()
  }
  if (state === 'detail-ready') {
    await page.getByRole('heading', { name: 'AI 诊断等了很久', exact: true }).scrollIntoViewIfNeeded()
  }
  if (state === 'detail-loading') {
    await page.getByText('正在读取详情', { exact: true }).scrollIntoViewIfNeeded()
  }
}

// ── 41 隐私与数据请求 ────────────────────────────────────────────

// 两三条、类型混合、时间拉开。导出这一条是打电话申请后办完的：这台机器不提交导出。
// 不放 delete。类型名「账号注销（暂未开放）」只在共享常量里，这条夹具不会把它送上屏。
const PRIVACY_ROWS = [
  { id: 'dr-20261002', requestType: 'revoke_consent', status: 'completed', requestedAt: '2026-10-02T15:20:00.000+08:00', handledAt: '2026-10-02T15:20:00.000+08:00', executionStep: null, exportExpiresAt: null, failureCode: null, canRetry: false, canDownload: false },
  { id: 'dr-20260911', requestType: 'export', status: 'completed', requestedAt: '2026-09-11T11:06:00.000+08:00', handledAt: '2026-09-16T09:40:00.000+08:00', executionStep: null, exportExpiresAt: null, failureCode: null, canRetry: false, canDownload: false },
  { id: 'dr-20260806', requestType: 'revoke_consent', status: 'completed', requestedAt: '2026-08-06T09:18:00.000+08:00', handledAt: '2026-08-06T09:18:00.000+08:00', executionStep: null, exportExpiresAt: null, failureCode: null, canRetry: false, canDownload: false },
]

const PRIVACY_NEW = {
  id: 'dr-20261006',
  requestType: 'revoke_consent',
  status: 'completed',
  requestedAt: '2026-10-06T10:24:00.000+08:00',
  handledAt: '2026-10-06T10:24:00.000+08:00',
  executionStep: null,
  exportExpiresAt: null,
  failureCode: null,
  canRetry: false,
  canDownload: false,
}

function privacyBody(items: unknown[]) {
  return ok({ items, nextCursor: null, capabilities: { accountClosureAvailable: false } })
}

function privacyPlan(state: string): MePages2Plan {
  return hit(`[data-testid="member-privacy-state-${state}"]`, '/me/privacy-requests', PRIVACY_REASON[state] ?? null)
}

async function preparePrivacy(page: Page, api: ApiRouter, state: string): Promise<void> {
  const withRows = state !== 'empty'
  if (state === 'loading') api.respondWith('GET', PRIVACY, hang)
  else if (state === 'error') api.respond('GET', PRIVACY, fail())
  else api.respond('GET', PRIVACY, privacyBody(withRows ? PRIVACY_ROWS : []))
  if (state === 'submitting') api.respondWith('POST', PRIVACY, hang)
  if (state === 'success') api.respond('POST', PRIVACY, ok(PRIVACY_NEW))
  if (state === 'failure') {
    api.respond('POST', PRIVACY, {
      status: 400,
      json: { success: false, error: { code: 'DATA_REQUEST_UNAVAILABLE', message: 'upstream rejected' } },
    })
  }
  if (state === 'login') {
    await page.goto('/me/privacy-requests', { waitUntil: 'domcontentloaded' })
    return
  }
  await loginTo(page, '/me/privacy-requests')
  if (state !== 'revoke-confirm' && state !== 'submitting' && state !== 'success' && state !== 'failure') return
  await show(page, '[data-testid="member-privacy-state-history-ready"]')
  await page.getByTestId('member-privacy-revoke-entry').click()
  if (state === 'revoke-confirm') return
  await page.getByRole('button', { name: '确认撤回', exact: true }).click()
}

// ── 对外 ─────────────────────────────────────────────────────────

export function mePages2Plan(file: string, screen: string, state: string): MePages2Plan | null {
  if (file.startsWith('31-')) return benefitsPlan(screen, state)
  if (file.startsWith('40-')) return feedbackPlan(state)
  if (file.startsWith('41-')) return privacyPlan(state)
  return null
}

export async function prepareMePages2(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  if (!(target.nn === '40' && target.state === 'service-unavailable')) prime(api)
  if (target.nn === '31') await prepareBenefits(page, api, target)
  else if (target.nn === '40') await prepareFeedback(page, api, target.state)
  else if (target.nn === '41') await preparePrivacy(page, api, target.state)
  if (target.readyMarker) await show(page, target.readyMarker)
}
