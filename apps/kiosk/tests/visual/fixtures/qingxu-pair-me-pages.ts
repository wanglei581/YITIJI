// 青序并排截图 · 35 消息、38 文档与订单、39 简历 / 收藏 / AI 记录 / 足迹。
//
// 只拦 /api/v1、点可见控件，不改页面。会员显示名在本文件覆盖登录回包（林晓雯 / 136****9028），
// 不改共享夹具。收藏与足迹按托管 a：只有政策，来源机构用虚构区名，不写补贴金额或比例。
//
// 38 的 documents-access-* 运行页没有整屏态，配到列表上最接近的操作，reason 里写明。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../../fixtures/recruitment-hosting'
import { loginThroughVisibleUi, registerMemberLogin } from './kiosk-p1-evidence-capture-api'
import type { QingxuPairTarget, RuntimePlan } from './qingxu-pair-targets'

export interface MePagesPlan {
  plan: RuntimePlan
  reason: string | null
  marker: string | null
  runtimePath: string | null
}

const PLAN: RuntimePlan = { kind: 'me-pages' }
const hit = (marker: string, runtimePath: string, reason: string | null = null): MePagesPlan => ({
  plan: PLAN, reason, marker, runtimePath,
})

const NOTIF = '/api/v1/me/notifications'
const READ_ALL = '/api/v1/me/notifications/read-all'
const DOCS = '/api/v1/me/documents'
const ORDERS = '/api/v1/me/print-orders'
const RESUMES = '/api/v1/me/resumes'
const FAVS = '/api/v1/me/favorites'
const AI = '/api/v1/me/ai-records'
const INTERVIEWS = '/api/v1/me/mock-interviews'
const JOB_AI = '/api/v1/me/job-ai-sessions'
const BROWSE = '/api/v1/me/browse-logs'
const JUMP = '/api/v1/me/external-jump-logs'

const OPEN_DOC_ID = 'doc-zhilian-20260918'
const AI_DELETE_ID = 'ai-parse-20261006'
const DETAIL_ID = 'br-20261002-haichuan-skill'

const ACCESS_REASON: Record<string, string> = {
  'documents-access-loading': '访问链接四态是列表上方的横幅，不是整页换态。点预览后请求挂起，横幅停在「正在为这份文件取得新的访问链接」。整页仍是 documents-ready。',
  'documents-access-expired': '访问链接四态是列表上方的横幅。预览接口返回已经过去的 expiresAt，横幅写「刚取得的访问链接已经过期」，不打开预览。保存期限到期的「已到期」行是另一件事。整页仍是 documents-ready。',
  'documents-access-error': '访问链接四态是列表上方的横幅。预览接口失败时横幅写「这次没有取得可用链接」，不把失败叫成链接过期。整页仍是 documents-ready。',
  'documents-access-ready': '访问链接四态是列表上方的横幅。预览接口返回未过期链接后，横幅写「预览链接已就绪」，并在当前页打开预览层。整页仍是 documents-ready。',
}

type JsonReply = { status: number; json: unknown }

function ok(data: unknown): JsonReply {
  return { status: 200, json: { success: true, data } }
}

function fail(): JsonReply {
  return { status: 503, json: { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'upstream unavailable' } } }
}

function list(items: unknown[], extra: Record<string, unknown> = {}) {
  return { items, nextCursor: null, total: items.length, ...extra }
}

function hang(): Promise<never> {
  return new Promise(() => undefined)
}

function nState(state: string): string {
  return `[data-testid="notifications-state-${state}"]`
}

function assetState(state: string): string {
  return `[data-testid="member-assets-state-${state}"]`
}

function recState(state: string): string {
  return `[data-testid="member-records-state-${state}"]`
}

async function see(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().waitFor({ state: 'visible', timeout: 20_000 })
}

async function enter(page: Page, runtimePath: string, loggedIn: boolean): Promise<void> {
  if (!loggedIn) {
    await page.goto(runtimePath, { waitUntil: 'domcontentloaded' })
    return
  }
  await loginThroughVisibleUi(page, runtimePath.split('?')[0])
}

function prime(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'qingxu-pairs-me'),
  })
  registerMemberLogin(api)
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: {
      success: true,
      data: {
        token: 'kiosk-session-linxiaowen',
        user: { id: 'member-linxiaowen', phoneMasked: '136****9028', nickname: '林晓雯' },
      },
    },
  })
  api.respond('GET', FAVS, ok(list([])))
  api.respond('GET', JOB_AI, ok(list([])))
  api.respond('GET', INTERVIEWS, ok({ items: [], nextCursor: null }))
}

// ── 35 消息 ──────────────────────────────────────────────────────────

type Notice = {
  id: string
  kind: 'personal' | 'broadcast'
  category: 'print' | 'ai' | 'feedback' | 'maintenance' | 'notice' | 'system'
  title: string
  content: string
  relatedType: 'print_task' | 'ai_resume_result' | 'feedback_ticket' | null
  relatedId: string | null
  isRead: boolean
  createdAt: string
}

const NOTIFICATIONS: Notice[] = [
  { id: 'nt-print-1006', kind: 'personal', category: 'print', title: '简历已打印完成', content: '「智联招聘 林晓雯 行政助理 简历 2026-09-18 终稿.pdf」已出纸，请到出纸口取走。', relatedType: 'print_task', relatedId: 'pt-20261006-1042', isRead: false, createdAt: '2026-10-06T10:48:00.000+08:00' },
  { id: 'nt-ai-1005', kind: 'personal', category: 'ai', title: '简历诊断已完成', content: '10 月 5 日上传的行政助理简历已生成诊断，可在「我的简历」里查看。', relatedType: 'ai_resume_result', relatedId: 'ai-parse-20261005', isRead: false, createdAt: '2026-10-05T16:20:00.000+08:00' },
  { id: 'nt-fb-1002', kind: 'personal', category: 'feedback', title: '你的反馈有了回复', content: '关于 9 月 28 日学历证明打印页边偏窄的反馈，已回复处理说明。', relatedType: 'feedback_ticket', relatedId: 'fb-20260928-edu', isRead: false, createdAt: '2026-10-02T11:05:00.000+08:00' },
  { id: 'nt-maint-0930', kind: 'broadcast', category: 'maintenance', title: '本机 10 月 1 日凌晨短暂停用', content: '海川区服务点这台机器 10 月 1 日 01:00–02:00 做例行维护，期间不能打印。', relatedType: null, relatedId: null, isRead: true, createdAt: '2026-09-30T17:40:00.000+08:00' },
  { id: 'nt-notice-0925', kind: 'broadcast', category: 'notice', title: '打印服务试运行说明', content: '试运行期间打印不收费。正式收费前会另行公告。', relatedType: null, relatedId: null, isRead: true, createdAt: '2026-09-25T09:15:00.000+08:00' },
  { id: 'nt-sys-0927', kind: 'personal', category: 'system', title: '登录设备有变化', content: '9 月 27 日 14:06 你的账号在本服务点的一体机上登录。如果不是你本人，请结束这次使用。', relatedType: null, relatedId: null, isRead: false, createdAt: '2026-09-27T14:06:00.000+08:00' },
  { id: 'nt-print-0918', kind: 'personal', category: 'print', title: '求职信已打印完成', content: '「求职信 海川区公共就业服务中心 行政辅助岗」两份已取走。', relatedType: 'print_task', relatedId: 'pt-20260918-1106', isRead: true, createdAt: '2026-09-18T11:12:00.000+08:00' },
  { id: 'nt-ai-0916', kind: 'personal', category: 'ai', title: '职业规划建议已生成', content: '9 月 16 日的职业规划建议已保存，可在 AI 服务记录里打开。', relatedType: null, relatedId: null, isRead: true, createdAt: '2026-09-16T15:28:00.000+08:00' },
]

type NoticeMode = 'mixed' | 'unread' | 'cleared' | 'none'

function noticeBody(mode: NoticeMode) {
  if (mode === 'none') return list([], { unreadCount: 0 })
  const items = mode === 'unread'
    ? NOTIFICATIONS.filter((item) => !item.isRead)
    : mode === 'cleared'
      ? NOTIFICATIONS.map((item) => ({ ...item, isRead: true }))
      : NOTIFICATIONS
  return list(items, { unreadCount: items.filter((item) => !item.isRead).length })
}

function notificationsPlan(state: string): MePagesPlan {
  return hit(nState(state), '/me/notifications')
}

async function prepareNotifications(page: Page, api: ApiRouter, state: string): Promise<void> {
  const mode: { current: NoticeMode } = { current: state === 'all-empty' ? 'none' : 'mixed' }
  if (state === 'loading') api.respondWith('GET', NOTIF, hang)
  else if (state === 'error') api.respond('GET', NOTIF, fail())
  else api.respondWith('GET', NOTIF, () => ok(noticeBody(mode.current)))
  if (state === 'operation-busy') api.respondWith('PATCH', READ_ALL, hang)
  if (state === 'operation-toast') {
    api.respond('PATCH', READ_ALL, ok({ updated: NOTIFICATIONS.filter((item) => !item.isRead).length }))
  }
  await enter(page, '/me/notifications', state !== 'login')
  if (state === 'login' || state === 'loading' || state === 'error' || state === 'all-empty' || state === 'ready-all') return
  await see(page, nState('ready-all'))
  if (state === 'ready-unread') {
    mode.current = 'unread'
    await page.getByRole('button', { name: /^未读/ }).click()
    return
  }
  if (state === 'unread-empty') {
    mode.current = 'none'
    await page.getByRole('button', { name: /^未读/ }).click()
    return
  }
  if (state === 'operation-toast') mode.current = 'cleared'
  await page.getByRole('button', { name: '全部标记为已读', exact: true }).click()
}

// ── 38 文档与订单 ────────────────────────────────────────────────────

function doc(input: {
  id: string
  filename: string
  mimeType: string
  purpose: string
  sensitiveLevel: string
  assetCategory: string
  retentionPolicy: string
  createdAt: string
  expiresAt: string | null
  sizeBytes: number
  pageCount: number | null
  materialCheckRequired: boolean
}) {
  return {
    ...input,
    allowedRetentionPolicies: input.retentionPolicy === 'long_term'
      ? ['months_3', 'months_6', 'long_term']
      : ['months_3', 'months_6', 'long_term'],
    downloadUrlPath: `/files/${input.id}/download-url`,
    previewUrlPath: `/files/${input.id}/preview-url`,
    reprintable: true,
  }
}

const DOCUMENTS = [
  doc({ id: OPEN_DOC_ID, filename: '智联招聘 林晓雯 行政助理 简历 2026-09-18 终稿.pdf', mimeType: 'application/pdf', purpose: 'resume_upload', sensitiveLevel: 'highly_sensitive', assetCategory: 'original', retentionPolicy: 'months_3', createdAt: '2026-09-18T09:40:00.000+08:00', expiresAt: '2026-12-18T09:40:00.000+08:00', sizeBytes: 248_320, pageCount: 2, materialCheckRequired: true }),
  doc({ id: 'doc-51job-1005', filename: '前程无忧 林晓雯 综合文员 简历(1).pdf', mimeType: 'application/pdf', purpose: 'resume_upload', sensitiveLevel: 'highly_sensitive', assetCategory: 'original', retentionPolicy: 'months_3', createdAt: '2026-10-05T19:12:00.000+08:00', expiresAt: '2027-01-05T19:12:00.000+08:00', sizeBytes: 312_448, pageCount: 2, materialCheckRequired: true }),
  doc({ id: 'doc-boss-1005', filename: 'BOSS直聘 导出 林晓雯 行政助理 20261005 终稿.pdf', mimeType: 'application/pdf', purpose: 'resume_upload', sensitiveLevel: 'highly_sensitive', assetCategory: 'original', retentionPolicy: 'months_3', createdAt: '2026-10-05T11:26:00.000+08:00', expiresAt: '2027-01-05T11:26:00.000+08:00', sizeBytes: 198_656, pageCount: 2, materialCheckRequired: true }),
  doc({ id: 'doc-transcript-0922', filename: '林晓雯_成绩单_2024-2025学年(1).jpg', mimeType: 'image/jpeg', purpose: 'print_doc', sensitiveLevel: 'sensitive', assetCategory: 'original', retentionPolicy: 'months_6', createdAt: '2026-09-22T20:18:00.000+08:00', expiresAt: '2027-03-22T20:18:00.000+08:00', sizeBytes: 2_450_112, pageCount: 1, materialCheckRequired: true }),
  doc({ id: 'doc-cet-0927', filename: '手机相册 英语四级成绩 2026-09-22.jpg', mimeType: 'image/jpeg', purpose: 'print_doc', sensitiveLevel: 'sensitive', assetCategory: 'original', retentionPolicy: 'months_6', createdAt: '2026-09-27T11:16:00.000+08:00', expiresAt: '2027-03-27T11:16:00.000+08:00', sizeBytes: 1_860_224, pageCount: 1, materialCheckRequired: true }),
  doc({ id: 'doc-edu-scan-0928', filename: '林晓雯 学历证明 扫描件 2026-09-28.pdf', mimeType: 'application/pdf', purpose: 'resume_scan', sensitiveLevel: 'highly_sensitive', assetCategory: 'original', retentionPolicy: 'months_3', createdAt: '2026-09-28T14:05:00.000+08:00', expiresAt: '2026-12-28T14:05:00.000+08:00', sizeBytes: 540_672, pageCount: 1, materialCheckRequired: true }),
  doc({ id: 'doc-letter-1002', filename: '求职信 海川区公共就业服务中心 行政辅助岗 2026-10-02.pdf', mimeType: 'application/pdf', purpose: 'cover_letter', sensitiveLevel: 'sensitive', assetCategory: 'derived', retentionPolicy: 'long_term', createdAt: '2026-10-02T09:30:00.000+08:00', expiresAt: null, sizeBytes: 86_016, pageCount: 1, materialCheckRequired: false }),
  doc({ id: 'doc-letter-expired', filename: '林晓雯 自荐信 2026-08-12 终稿.pdf', mimeType: 'application/pdf', purpose: 'cover_letter', sensitiveLevel: 'sensitive', assetCategory: 'original', retentionPolicy: 'months_3', createdAt: '2026-08-12T10:20:00.000+08:00', expiresAt: '2026-09-20T10:20:00.000+08:00', sizeBytes: 74_240, pageCount: 1, materialCheckRequired: false }),
]

function order(input: {
  id: string
  orderNo: string
  status: 'pending' | 'claimed' | 'printing' | 'completed' | 'failed' | 'cancelled'
  fileName: string
  createdAt: string
  completedAt: string | null
  copies?: number
  colorMode?: 'black_white' | 'color'
  duplex?: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  pageRange?: string
  failureCode?: 'PRINT_JOB_UNCONFIRMED' | null
}) {
  return {
    copies: 1,
    colorMode: 'black_white' as const,
    duplex: 'simplex' as const,
    paperSize: 'A4',
    pageRange: 'all',
    amountCents: 0,
    payStatus: 'paid',
    paymentSource: 'free',
    billablePages: 1,
    refundedAmountCents: 0,
    discountCents: 0,
    refundRequired: false,
    pickupCode: null,
    failureCode: null,
    ...input,
  }
}

const PRINT_ORDERS = [
  order({ id: 'pt-20261006-1042', orderNo: 'ORD-20261006-1042', status: 'printing', fileName: '智联招聘 林晓雯 行政助理 简历 2026-09-18 终稿.pdf', createdAt: '2026-10-06T10:42:00.000+08:00', completedAt: null, copies: 1, duplex: 'simplex', pageRange: '1-2' }),
  order({ id: 'pt-20261006-0918', orderNo: 'ORD-20261006-0918', status: 'pending', fileName: '林晓雯_成绩单_2024-2025学年(1).jpg', createdAt: '2026-10-06T09:18:00.000+08:00', completedAt: null, colorMode: 'color' }),
  order({ id: 'pt-20261002-1536', orderNo: 'ORD-20261002-1536', status: 'claimed', fileName: '林晓雯 学历证明 扫描件 2026-09-28.pdf', createdAt: '2026-10-02T15:36:00.000+08:00', completedAt: null }),
  order({ id: 'pt-20260928-1412', orderNo: 'ORD-20260928-1412', status: 'completed', fileName: '求职信 海川区公共就业服务中心 行政辅助岗 2026-10-02.pdf', createdAt: '2026-09-28T14:12:00.000+08:00', completedAt: '2026-09-28T14:18:00.000+08:00', copies: 2, duplex: 'duplex_long_edge' }),
  order({ id: 'pt-20260918-1106', orderNo: 'ORD-20260918-1106', status: 'completed', fileName: '前程无忧 林晓雯 综合文员 简历(1).pdf', createdAt: '2026-09-18T11:06:00.000+08:00', completedAt: '2026-09-18T11:11:00.000+08:00', pageRange: '1-2' }),
  order({ id: 'pt-20260925-1633', orderNo: 'ORD-20260925-1633', status: 'cancelled', fileName: 'BOSS直聘 导出 林晓雯 行政助理 20261005 终稿.pdf', createdAt: '2026-09-25T16:33:00.000+08:00', completedAt: null }),
  order({ id: 'pt-20260922-0940', orderNo: 'ORD-20260922-0940', status: 'failed', fileName: '手机相册 英语四级成绩 2026-09-22.jpg', createdAt: '2026-09-22T09:40:00.000+08:00', completedAt: null, colorMode: 'color', failureCode: 'PRINT_JOB_UNCONFIRMED' }),
  order({ id: 'pt-20260927-1015', orderNo: 'ORD-20260927-1015', status: 'completed', fileName: '林晓雯 自荐信 2026-08-12 终稿.pdf', createdAt: '2026-09-27T10:15:00.000+08:00', completedAt: '2026-09-27T10:18:00.000+08:00' }),
]

const ACCESS_MARKER: Record<string, string> = {
  'documents-access-loading': '[data-testid="member-assets-access"][data-access="loading"]',
  'documents-access-expired': '[data-testid="member-assets-access"][data-access="expired"]',
  'documents-access-error': '[data-testid="member-assets-access"][data-access="error"]',
  'documents-access-ready': '[data-testid="member-assets-access"][data-access="ready"]',
}

function assetsPlan(state: string): MePagesPlan {
  if (state.startsWith('orders-')) return hit(assetState(state), '/me/print-orders')
  if (state.startsWith('documents-access-')) {
    return hit(ACCESS_MARKER[state] ?? '#document-preview-title', '/me/documents', ACCESS_REASON[state] ?? '运行页没有整屏态')
  }
  return hit(assetState(state), '/me/documents')
}

async function prepareAssets(page: Page, api: ApiRouter, state: string): Promise<void> {
  const orders = state.startsWith('orders-')
  const listPath = orders ? ORDERS : DOCS
  const runtimePath = orders ? '/me/print-orders' : '/me/documents'
  const access = state.startsWith('documents-access-')
  if (!access && state.endsWith('-loading')) api.respondWith('GET', listPath, hang)
  else if (!access && state.endsWith('-error')) api.respond('GET', listPath, fail())
  else if (state.endsWith('-empty')) api.respond('GET', listPath, ok(list([])))
  else api.respond('GET', listPath, ok(list(orders ? PRINT_ORDERS : DOCUMENTS)))

  const openPath = `/api/v1/files/${OPEN_DOC_ID}/preview-url`
  if (state === 'documents-access-loading') api.respondWith('GET', openPath, hang)
  if (state === 'documents-access-error') api.respond('GET', openPath, fail())
  if (state === 'documents-access-expired') {
    api.respond('GET', openPath, ok({
      fileId: OPEN_DOC_ID,
      url: 'http://127.0.0.1:9/linxiaowen-resume.pdf',
      printFileUrl: 'http://127.0.0.1:9/linxiaowen-resume-print.pdf',
      expiresAt: '2020-01-01T00:00:00.000Z',
      disposition: 'inline',
    }))
  }
  if (state === 'documents-access-ready') {
    api.respond('GET', openPath, ok({
      fileId: OPEN_DOC_ID,
      url: 'http://127.0.0.1:9/linxiaowen-resume.pdf',
      printFileUrl: 'http://127.0.0.1:9/linxiaowen-resume-print.pdf',
      expiresAt: '2099-01-01T00:00:00.000Z',
      disposition: 'inline',
    }))
  }
  await enter(page, runtimePath, !state.endsWith('-login'))
  if (!access) return
  await see(page, assetState('documents-ready'))
  await page.getByRole('button', { name: '预览', exact: true }).first().click()
}

// ── 39 记录 ──────────────────────────────────────────────────────────

function resume(input: {
  id: string
  taskId: string
  kind: 'parse' | 'generate'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: string
  expiresAt: string | null
  optimized?: boolean
  hasDraft?: boolean
  latestVersion?: number | null
}) {
  return {
    provider: 'llm',
    optimized: false,
    hasDraft: false,
    latestVersion: null,
    updatedAt: input.createdAt,
    ...input,
  }
}

const RESUME_ROWS = [
  resume({ id: 'rs-20261006-a', taskId: 'task-20261006-lin-7f3a91c2', kind: 'parse', status: 'completed', createdAt: '2026-10-06T09:12:00.000+08:00', expiresAt: '2026-12-20T09:12:00.000+08:00', optimized: true, latestVersion: 2 }),
  resume({ id: 'rs-20261006-b', taskId: 'task-20261006-lin-2c8e44b1', kind: 'parse', status: 'processing', createdAt: '2026-10-06T08:40:00.000+08:00', expiresAt: '2026-12-20T08:40:00.000+08:00' }),
  resume({ id: 'rs-20261002', taskId: 'task-20261002-lin-91ab06de', kind: 'parse', status: 'failed', createdAt: '2026-10-02T14:18:00.000+08:00', expiresAt: '2026-12-16T14:18:00.000+08:00' }),
  resume({ id: 'rs-20260930', taskId: 'task-20260930-lin-44d0c8aa', kind: 'parse', status: 'pending', createdAt: '2026-09-30T11:05:00.000+08:00', expiresAt: '2026-12-14T11:05:00.000+08:00' }),
  resume({ id: 'rs-20260820', taskId: 'task-20260820-lin-08f1e77c', kind: 'parse', status: 'completed', createdAt: '2026-08-20T10:22:00.000+08:00', expiresAt: '2026-09-10T10:22:00.000+08:00', optimized: true, latestVersion: 1 }),
  resume({ id: 'rs-20260928', taskId: 'task-20260928-lin-b33a19f0', kind: 'generate', status: 'completed', createdAt: '2026-09-28T16:42:00.000+08:00', expiresAt: '2026-12-28T16:42:00.000+08:00' }),
  resume({ id: 'rs-20260924', taskId: 'task-20260924-lin-6e20ab14', kind: 'generate', status: 'processing', createdAt: '2026-09-24T10:16:00.000+08:00', expiresAt: '2026-12-24T10:16:00.000+08:00' }),
  resume({ id: 'rs-20260927', taskId: 'task-20260927-lin-c5d81290', kind: 'generate', status: 'failed', createdAt: '2026-09-27T15:08:00.000+08:00', expiresAt: '2026-12-27T15:08:00.000+08:00' }),
]

const POLICIES: Array<{ id: string; title: string; org: string }> = [
  { id: 'pol-dengji', title: '失业登记办理指引', org: '海川区公共就业服务中心' },
  { id: 'pol-kunnan', title: '就业困难人员认定申请说明', org: '澄湾区人力资源和社会保障局' },
  { id: 'pol-graduate', title: '高校毕业生实名登记指引', org: '青禾街道便民服务中心' },
  { id: 'pol-skill', title: '职业技能培训报名说明', org: '海川区公共就业服务中心' },
  { id: 'pol-social', title: '灵活就业人员社保缴纳指引', org: '澄湾区人力资源和社会保障局' },
  { id: 'pol-cert', title: '就业创业证申领说明', org: '青禾街道便民服务中心' },
  { id: 'pol-window', title: '公共就业服务窗口办事指南', org: '海川区公共就业服务中心' },
  { id: 'pol-archive', title: '档案转递与接收说明', org: '澄湾区人力资源和社会保障局' },
]

const FAV_TIMES = [
  '2026-10-06T09:05:00.000+08:00',
  '2026-10-05T15:42:00.000+08:00',
  '2026-10-02T11:18:00.000+08:00',
  '2026-09-30T16:27:00.000+08:00',
  '2026-09-28T10:03:00.000+08:00',
  '2026-09-24T14:51:00.000+08:00',
  '2026-09-22T09:36:00.000+08:00',
  '2026-09-16T17:09:00.000+08:00',
]

const FAVORITES = POLICIES.map((item, index) => ({
  id: `fav-${item.id}`,
  targetType: 'policy',
  targetId: item.id,
  title: `${item.title}（${item.org}）`,
  createdAt: FAV_TIMES[index],
}))

const BROWSE_TIMES = [
  '2026-10-06T08:52:00.000+08:00',
  '2026-10-05T14:16:00.000+08:00',
  '2026-10-02T09:48:00.000+08:00',
  '2026-09-30T11:22:00.000+08:00',
  '2026-09-28T15:40:00.000+08:00',
  '2026-09-24T09:11:00.000+08:00',
  '2026-09-18T16:33:00.000+08:00',
  '2026-09-15T10:27:00.000+08:00',
]

const BROWSE_LOGS = POLICIES.map((item, index) => ({
  id: index === 3 ? DETAIL_ID : `br-${item.id}`,
  targetType: 'policy',
  targetId: item.id,
  targetTitle: item.title,
  sourceName: item.org,
  sourceUrl: null,
  externalId: `HC-2026-${item.id}`,
  createdAt: BROWSE_TIMES[index],
}))

const JUMP_LOGS = POLICIES.slice(0, 7).map((item, index) => ({
  id: `jp-${item.id}`,
  targetType: 'policy',
  targetId: item.id,
  targetTitle: item.title,
  sourceName: item.org,
  sourceUrl: null,
  externalId: `HC-2026-${item.id}`,
  action: 'external_open',
  createdAt: [
    '2026-10-06T10:02:00.000+08:00',
    '2026-10-02T13:26:00.000+08:00',
    '2026-09-29T09:44:00.000+08:00',
    '2026-09-25T15:18:00.000+08:00',
    '2026-09-23T11:07:00.000+08:00',
    '2026-09-17T16:55:00.000+08:00',
    '2026-09-27T10:41:00.000+08:00',
  ][index],
}))

function aiRow(input: {
  id: string
  taskId: string
  kind: 'parse' | 'optimize' | 'career_plan' | 'generate'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  createdAt: string
  expiresAt: string | null
}) {
  return {
    provider: 'llm',
    optimized: false,
    hasDraft: false,
    latestVersion: null,
    ...input,
  }
}

const AI_RECORDS = [
  aiRow({ id: AI_DELETE_ID, taskId: 'task-20261006-lin-7f3a91c2', kind: 'parse', status: 'completed', createdAt: '2026-10-06T09:24:00.000+08:00', expiresAt: '2027-01-06T09:24:00.000+08:00' }),
  aiRow({ id: 'ai-opt-20261005', taskId: 'task-20261005-lin-aa19c043', kind: 'optimize', status: 'completed', createdAt: '2026-10-05T16:46:00.000+08:00', expiresAt: '2027-01-05T16:46:00.000+08:00' }),
  aiRow({ id: 'ai-plan-20261002', taskId: 'task-20261002-lin-plan8821', kind: 'career_plan', status: 'completed', createdAt: '2026-10-02T11:22:00.000+08:00', expiresAt: '2027-01-02T11:22:00.000+08:00' }),
  aiRow({ id: 'ai-parse-half', taskId: 'task-20261006-lin-half2208', kind: 'parse', status: 'processing', createdAt: '2026-10-06T08:12:00.000+08:00', expiresAt: '2027-01-06T08:12:00.000+08:00' }),
  aiRow({ id: 'ai-opt-fail', taskId: 'task-20260930-lin-fail4410', kind: 'optimize', status: 'failed', createdAt: '2026-09-30T15:08:00.000+08:00', expiresAt: '2026-12-30T15:08:00.000+08:00' }),
  aiRow({ id: 'ai-plan-expired', taskId: 'task-20260820-lin-old3301', kind: 'career_plan', status: 'completed', createdAt: '2026-08-20T11:40:00.000+08:00', expiresAt: '2026-09-12T11:40:00.000+08:00' }),
  aiRow({ id: 'ai-parse-pending', taskId: 'task-20260924-lin-wait7712', kind: 'parse', status: 'pending', createdAt: '2026-09-24T10:33:00.000+08:00', expiresAt: '2026-12-24T10:33:00.000+08:00' }),
  aiRow({ id: 'ai-gen-0918', taskId: 'task-20260918-lin-gen5506', kind: 'generate', status: 'completed', createdAt: '2026-09-18T09:58:00.000+08:00', expiresAt: '2026-12-18T09:58:00.000+08:00' }),
]

const INTERVIEW_ROWS = [
  {
    sessionId: 'iv-20261006-admin',
    interviewerType: 'hr',
    interviewerLabel: '人事面试官',
    industry: '公共就业服务',
    position: '行政助理 · 文字作答 · 8 题',
    durationMin: 18,
    createdAt: '2026-10-06T15:10:00.000+08:00',
    endedAt: '2026-10-06T15:28:00.000+08:00',
    hasReport: true,
  },
  {
    sessionId: 'iv-20260929-clerk',
    interviewerType: 'manager',
    interviewerLabel: '业务负责人',
    industry: '街道便民服务',
    position: '综合文员 · 文字作答 · 6 题',
    durationMin: 12,
    createdAt: '2026-09-29T10:40:00.000+08:00',
    endedAt: null,
    hasReport: false,
  },
]

function aiBody(dropped: boolean) {
  const items = dropped ? AI_RECORDS.filter((item) => item.id !== AI_DELETE_ID) : AI_RECORDS
  return {
    items,
    nextCursor: null,
    total: items.length,
    qaRecords: [],
    qaNextCursor: null,
    qaTotal: 0,
  }
}

function recordsMarker(screen: string, state: string): string {
  if (screen === 'activity') return recState(`activity-${state}`)
  if (screen === 'activity-detail') return recState(`activity-detail-${state}`)
  return recState(`${screen}-${state}`)
}

function recordsPath(screen: string): string | null {
  if (screen === 'resumes') return '/me/resumes'
  if (screen === 'favorites') return '/me/favorites'
  if (screen === 'ai-records') return '/me/ai-records'
  if (screen === 'activity') return '/me/activity'
  if (screen === 'activity-detail') return `/me/activity/${DETAIL_ID}`
  return null
}

function recordsPlan(screen: string, state: string): MePagesPlan {
  const runtimePath = recordsPath(screen)
  if (!runtimePath) return { plan: { kind: 'none' }, reason: `这一态没有现成注册器：未知画面 ${screen}`, marker: null, runtimePath: null }
  return hit(recordsMarker(screen, state), runtimePath)
}

async function prepareResumes(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'loading') api.respondWith('GET', RESUMES, hang)
  else if (state === 'error') api.respond('GET', RESUMES, fail())
  else if (state === 'empty') api.respond('GET', RESUMES, ok(list([])))
  else api.respond('GET', RESUMES, ok(list(RESUME_ROWS)))
  await enter(page, '/me/resumes', state !== 'login')
}

async function prepareFavorites(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'loading') api.respondWith('GET', FAVS, hang)
  else if (state === 'error') api.respond('GET', FAVS, fail())
  else if (state === 'empty') api.respond('GET', FAVS, ok(list([])))
  else api.respond('GET', FAVS, ok(list(FAVORITES)))
  await enter(page, '/me/favorites', state !== 'login')
}

async function prepareAi(page: Page, api: ApiRouter, state: string): Promise<void> {
  const dropped = { current: false }
  const showRows = state !== 'empty' && state !== 'error' && state !== 'loading'
  if (state === 'loading') api.respondWith('GET', AI, hang)
  else if (state === 'error') api.respond('GET', AI, fail())
  else if (state === 'empty') api.respond('GET', AI, ok(aiBody(true).items.length ? { ...aiBody(true), items: [], total: 0 } : aiBody(true)))
  else api.respondWith('GET', AI, () => ok(dropped.current ? { ...aiBody(true) } : aiBody(false)))
  api.respond('GET', INTERVIEWS, ok({ items: showRows ? INTERVIEW_ROWS : [], nextCursor: null }))
  await enter(page, '/me/ai-records', state !== 'login')
  if (state === 'login' || state === 'loading' || state === 'error' || state === 'empty' || state === 'ready') return
  await see(page, recState('ai-records-ready'))
  await page.getByRole('button', { name: '删除 AI 服务记录', exact: true }).first().click()
  if (state === 'delete-confirm' || state === 'delete-expired') return
  const confirm = page.getByRole('button', { name: '确认删除这条记录，删除后不可恢复', exact: true })
  await confirm.waitFor({ state: 'visible', timeout: 8_000 })
  const del = `/api/v1/me/ai-records/${AI_DELETE_ID}`
  if (state === 'deleting') api.respondWith('DELETE', del, hang)
  else if (state === 'delete-failure') api.respond('DELETE', del, fail())
  else {
    dropped.current = true
    api.respond('DELETE', del, ok({ deleted: true, deletedCount: 2 }))
  }
  await confirm.click()
}

async function prepareActivity(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'loading') api.respondWith('GET', BROWSE, hang)
  else if (state === 'error') api.respond('GET', BROWSE, fail())
  else if (state === 'browse-empty') api.respond('GET', BROWSE, ok(list([])))
  else api.respond('GET', BROWSE, ok(list(BROWSE_LOGS)))
  if (state === 'jump-empty') api.respond('GET', JUMP, ok(list([])))
  else api.respond('GET', JUMP, ok(list(JUMP_LOGS)))
  await enter(page, '/me/activity', state !== 'login')
  if (state !== 'jump-empty' && state !== 'jump-ready') return
  await see(page, recState('activity-browse-ready'))
  await page.getByRole('button', { name: /^外部跳转记录/ }).click()
}

async function prepareActivityDetail(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'loading') {
    api.respondWith('GET', BROWSE, hang)
    api.respondWith('GET', JUMP, hang)
  } else if (state === 'error') {
    api.respond('GET', BROWSE, fail())
    api.respond('GET', JUMP, ok(list([])))
  } else if (state === 'not-found') {
    api.respond('GET', BROWSE, ok(list([])))
    api.respond('GET', JUMP, ok(list([])))
  } else {
    api.respond('GET', BROWSE, ok(list(BROWSE_LOGS)))
    api.respond('GET', JUMP, ok(list(JUMP_LOGS)))
  }
  await enter(page, `/me/activity/${DETAIL_ID}`, state !== 'login')
}

async function prepareRecords(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  if (target.screen === 'resumes') return prepareResumes(page, api, target.state)
  if (target.screen === 'favorites') return prepareFavorites(page, api, target.state)
  if (target.screen === 'ai-records') return prepareAi(page, api, target.state)
  if (target.screen === 'activity') return prepareActivity(page, api, target.state)
  if (target.screen === 'activity-detail') return prepareActivityDetail(page, api, target.state)
}

// ── 对外 ─────────────────────────────────────────────────────────────

export function mePagesPlan(file: string, screen: string, state: string): MePagesPlan | null {
  if (file.startsWith('35-')) return notificationsPlan(state)
  if (file.startsWith('38-')) return assetsPlan(state)
  if (file.startsWith('39-')) return recordsPlan(screen, state)
  return null
}

export async function prepareMePages(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  prime(api)
  if (target.nn === '35') return prepareNotifications(page, api, target.state)
  if (target.nn === '38') return prepareAssets(page, api, target.state)
  if (target.nn === '39') return prepareRecords(page, api, target)
}

// 出纸结果未确认：订单行只渲染 status 文案「失败」，failureCode 不出现在这一页。
// 足迹列表点政策行会去 /renshi，打不开 /me/activity/:id；详情态直接打开该路由。
void ACCESS_REASON
