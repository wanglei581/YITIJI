/**
 * 一体机授权闸门「收尾中」的行为走查（第八、九轮 B8–B11）：收尾开始后，已经在办的事不被打断，但不再开始新的办理。
 *
 *   · 运行时根集中拦截（layouts/licenseWindDownRoutes.ts）：收尾开始那一刻记下人站在哪一项服务里；
 *     之后再进入「另一项服务的办理页」，不渲染目标页，整屏换成「本机暂不开始新的办理」+「返回」「回首页」；
 *     任何时候能进的（首页、登录、「我的」与记录、设置、隐私、反馈）和结果查看页（报告、预览、历史报告）不拦；
 *   · 收尾开始时记下的服务和到点时刻存在本机（localStorage），刷新后凭它认，不按刷新后落在的地址重认——被拦的页面刷新还是拦截屏；
 *   · 打印交接按来源放行：当前服务里发起的「拿去打印」（例如图片转 PDF 转完去打印）能进打印台，没有这次交接直接进、
 *     或者收尾开始时站在「我的」「首页」这类任何时候能进的页面里，都进不了打印台；
 *   · 旧结果页（报告、预览、优化、面试报告、自我探索、招聘会规划）按服务自动只读：收尾时不在这一项服务里就只读，
 *     不靠导航时带的标记——从「我的」记录、面试历史列表打开都一样；看得见结果，开始新事的动作（优化、对照、重新练习、导出打印）停用；
 *   · 验过签的答复里没有到期时刻时，页面自己兜一个到点时刻，到点进暂停屏，不会因为没人可清场而长停在收尾。
 *
 * 与 kiosk-license-gate.spec.ts 同一套正式构建 + 假服务端 + 页面时钟（fixtures/license-world.ts、license-gate-kit.ts），
 * 用 playwright.privacy-clear.config.ts 跑。断言照规格写：被拦的页面确实没渲染、停用的按钮确实点不动，
 * 每一条「被拦 / 停用」前面都有一条同样做法下「正常时进得去 / 亮着」的阳性对照。
 */
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'
import {
  boot, expectHomeLive, expectHomeWindingDown, expectTapStays, goInApp, mainNav, markDocument, MINUTE, NO_NEW_TASK, paused,
  settleAfterPause, tap, windDownBlocked,
} from './fixtures/license-gate-kit'
import {
  INTERVIEW_REPORT, INTERVIEW_ROW, INTERVIEW_SESSION_ID, RESUME_REPORT_RECORD, RESUME_ROW, RESUME_TASK_ID,
} from './fixtures/license-records'
import type { LicenseWorld } from './fixtures/license-world'
import { loginThroughVisibleUi } from './fixtures/privacy-clear-shell'

test.describe.configure({ timeout: 120_000 })

/**
 * 验过签却没给到期时刻时，页面自己兜的收尾时长：从第一次看到那一刻起算。
 * 对应源码 services/kioskLicenseGate.ts 的 LICENSE_UNKNOWN_DEADLINE_GRACE_MS（30 分钟，与服务端会话票有效期对齐）；产品改这个数时只改这里。
 */
const UNKNOWN_DEADLINE_GRACE = 30 * MINUTE
/** 打印交接那条用例里用的 1×1 PNG（图片转 PDF 的输入）。 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const emptyPage = { success: true, data: { items: [], nextCursor: null, total: 0 } }
const MEMBER = { token: 'privacy-member-token', user: { id: 'privacy-member', phoneMasked: '139****5678', nickname: '王晓雨' } }

/** 收尾开始：授权失效、当前凭证还剩 10 分钟，推进到页面自己读到验过签的失效答复为止。 */
async function startWindDown(world: LicenseWorld): Promise<void> {
  world.lapse(10 * MINUTE)
  await world.advance(3.5 * MINUTE)
  expect(world.log.profile.some((entry) => entry.verified && entry.licenseState === 'inactive'), '页面应已读到授权失效').toBe(true)
}

/** 走屏上的手机号登录（本人），再把假服务端的时钟读数对齐。 */
async function signIn(page: Page, api: ApiRouter, world: LicenseWorld): Promise<void> {
  api.respond('POST', '/api/v1/member/auth/login', { status: 200, json: { success: true, data: MEMBER } })
  await loginThroughVisibleUi(page, '/', '13912345678')
  await world.sync()
}

/** 点底部导航「我的」；离开屏幕超过 30 秒再进，先问一句「还是你吗？」，答「是我，继续」才进。 */
async function openMine(page: Page): Promise<void> {
  await tap(page, mainNav(page).getByRole('button', { name: '我的' }))
  await page.waitForURL((url) => url.pathname === '/profile')
  const handover = page.getByTestId('handover-confirm')
  if (await handover.isVisible().catch(() => false)) await handover.getByRole('button', { name: '是我，继续' }).click()
}

/** 简历来源页挂载时会建一个手机上传会话并轮询它；给它应答，免得挂载了这一页的用例被当成有未处理的接口请求。 */
function mockSourceUploadSession(api: ApiRouter): void {
  api.respond('POST', '/api/v1/upload-sessions', { status: 201, json: { success: true, data: {
    sessionId: 'license-source-upload', uploadUrl: '/upload/phone', uploadToken: 'license-upload', controlToken: 'license-control', expiresAt: '2099-01-01T00:00:00.000Z',
  } } })
  api.respond('GET', '/api/v1/upload-sessions/license-source-upload', { status: 200, json: { success: true, data: {
    sessionId: 'license-source-upload', status: 'pending', purpose: 'resume_upload', mode: 'temporary', file: null, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z',
  } } })
}

/** 在「我的简历」里点开第一条诊断记录，再点「查看报告」。 */
async function openResumeReport(page: Page): Promise<void> {
  await page.locator('[data-record-kind="parse"] .me-open').first().click()
  await page.getByRole('button', { name: /这份简历的诊断报告/ }).click()
  await page.waitForURL((url) => url.pathname === '/resume/report')
}

/** 在「AI 服务记录」里点开第一条模拟面试记录，再点「打开报告」。 */
async function openInterviewReport(page: Page): Promise<void> {
  await page.getByRole('button', { name: /模拟面试 · 前端开发工程师/ }).click()
  await page.getByRole('button', { name: /查看模拟面试报告/ }).click()
}

// ───────────────────────── 运行时根：进另一项服务的办理页被拦 ─────────────────────────

test('收尾中从首页进另一项服务的办理页：整屏换成「本机暂不开始新的办理」，「返回」「回首页」都能走 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  // 只有下面那条授权正常时的阳性对照会真的挂载简历来源页；被拦的时候它不渲染，也就不发请求。
  mockSourceUploadSession(api)
  // 阳性对照：授权正常时，同样的进法真的进得去简历来源页。
  await goInApp(page, '/resume/source')
  await expect(page.locator('[data-kiosk-screen="resume-source"]')).toBeVisible()
  await expect(windDownBlocked(page)).toHaveCount(0)
  await goInApp(page, '/')
  await expectHomeLive(page)

  // 收尾是在首页开始的；进简历来源页（简历服务的办理页）不渲染目标页，换成拦截屏。
  await startWindDown(world)
  await expectHomeWindingDown(page)
  await goInApp(page, '/resume/source')
  const screen = windDownBlocked(page)
  await expect(screen).toBeVisible()
  await expect(screen).toContainText(NO_NEW_TASK)
  await expect(screen).toContainText('分钟后暂停使用')
  await expect(page.locator('[data-kiosk-screen="resume-source"]'), '被拦的页面不该渲染').toHaveCount(0)
  await expect(screen.getByRole('button'), '拦截屏上只有「返回」「回首页」两个按钮').toHaveText(['返回', '回首页'])

  // 「返回」：回到上一页（首页），拦截屏消失。
  await screen.getByRole('button', { name: '返回', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await expectHomeWindingDown(page)

  // 再进一次，这回走「回首页」。
  await goInApp(page, '/resume/source')
  await expect(windDownBlocked(page)).toBeVisible()
  await windDownBlocked(page).getByRole('button', { name: '回首页', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await expectHomeWindingDown(page)
  await expect(paused(page)).toHaveCount(0)
})

test('收尾开始时正在面试设置页：面试里切阶段照常，进打印台被拦，返回仍回到面试 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { path: '/interview/tips' })
  await page.getByTestId('interview-primary').click()
  await page.waitForURL((url) => url.pathname === '/interview' && url.searchParams.get('stage') === 'setup')
  const stage = (name: string) => page.locator(`[data-interview-stage="${name}"]`)
  await expect(stage('setup')).toBeVisible()

  await startWindDown(world)
  await expect(windDownBlocked(page), '收尾开始时就站在面试里，不该被拦').toHaveCount(0)
  await expect(stage('setup')).toBeVisible()

  // 面试里切阶段：设置 → 技巧 → 设置 → 历史报告 → 设置，都是同一项服务里的页面，照常。
  await page.getByRole('button', { name: /先看面试技巧/ }).click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'tips')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await expect(stage('tips')).toBeVisible()
  await page.getByTestId('interview-primary').click()
  await page.waitForURL((url) => url.searchParams.get('stage') === 'setup')
  await expect(stage('setup')).toBeVisible()
  await goInApp(page, '/interview?stage=reports')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await expect(stage('reports')).toBeVisible()
  await goInApp(page, '/interview?stage=setup')
  await expect(stage('setup')).toBeVisible()

  // 进打印台（另一项服务的办理页）：被拦，面试页不渲染。
  await goInApp(page, '/print/upload')
  await expect(windDownBlocked(page)).toBeVisible()
  await expect(page.locator('[data-interview-workbench]')).toHaveCount(0)

  // 「返回」回到面试设置页，而不是别处。
  await windDownBlocked(page).getByRole('button', { name: '返回', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/interview' && url.searchParams.get('stage') === 'setup')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await expect(stage('setup')).toBeVisible()
})

test('收尾中在被拦的页面刷新：仍是拦截屏，记下的服务不按刷新后的地址重认 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  mockSourceUploadSession(api)
  const sourcePage = page.locator('[data-kiosk-screen="resume-source"]')
  await startWindDown(world)
  await goInApp(page, '/resume/source')
  await expect(windDownBlocked(page)).toBeVisible()
  // 收尾开始时站在哪一项服务里、几点到点，都存在本机（localStorage），刷新后凭它认。
  expect(await page.evaluate(() => window.localStorage.getItem('kiosk_license_winddown_v1')), '收尾开始时应把记下的服务和到点时刻存到本机').not.toBeNull()

  await page.reload()
  await world.sync()
  // 刷新后内存里的状态没了；若按刷新后落在的地址重认（/resume/source = 简历服务），这一页就成了「收尾开始时所在的服务」，被放行。
  await expect(windDownBlocked(page), '刷新之后被拦的页面仍是拦截屏').toBeVisible()
  await expect(sourcePage).toHaveCount(0)
  // 页面自己重新读过 profile（授权仍失效）之后也一样。
  await world.advance(4 * MINUTE)
  await expect(windDownBlocked(page)).toBeVisible()
  await expect(sourcePage).toHaveCount(0)
  await expect(paused(page)).toHaveCount(0)

  // 拦截屏上的出路照常：回首页，仍是收尾中的首页。
  await windDownBlocked(page).getByRole('button', { name: '回首页', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await expectHomeWindingDown(page)
})

test('收尾开始时正在图片转 PDF：转完点「拿这份 PDF 去打印」能进打印台，没有这次交接直接进打印台被拦 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api, { path: '/print-scan/convert' })
  await page.route('**/w2-fixtures/image.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1X1 }))
  // 一体机上图片只能从手机扫码传进来：手机已传、等一体机确认。
  const image = { fileId: 'license-image-001', filename: 'license-image.png', sizeBytes: 1024, mimeType: 'image/png', sha256: 'c'.repeat(64), fileExpiresAt: null, fileUrl: '/w2-fixtures/image.png' }
  api.respond('POST', '/api/v1/upload-sessions', { status: 201, json: { success: true, data: {
    sessionId: 'license-convert-phone', uploadUrl: '/upload/phone', uploadToken: 'license-up', controlToken: 'license-ctl', expiresAt: '2099-01-01T00:00:00.000Z',
  } } })
  api.respond('GET', '/api/v1/upload-sessions/license-convert-phone', { status: 200, json: { success: true, data: {
    sessionId: 'license-convert-phone', status: 'uploaded', purpose: 'print_doc', mode: 'temporary', file: image, requiresKioskConfirmation: false, expiresAt: '2099-01-01T00:00:00.000Z',
  } } })
  api.respond('POST', '/api/v1/upload-sessions/license-convert-phone/confirm', { status: 200, json: { success: true, data: { sessionId: 'license-convert-phone', status: 'confirmed', file: image } } })
  api.respond('POST', '/api/v1/print/convert/images-to-pdf', { status: 200, json: { success: true, data: {
    fileId: 'license-pdf-001', printFileUrl: '/w2-fixtures/image.png', fileMd5: 'e'.repeat(32), sizeBytes: 2048, pages: 1, hasEndUser: false,
  } } })
  // 合成件进打印台后会立刻开始材料检查；本用例只看进不进得了打印台，给一个最小的完成态。
  api.respond('POST', '/api/v1/materials/tasks', { status: 200, json: { success: true, data: {
    id: 'license-convert-inspection', kind: 'inspection', status: 'completed', sourceFileId: 'license-pdf-001',
    result: { mode: 'real', checks: { pageCount: 1, canPrint: true, messages: [] } },
    createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  } } })

  // 收尾在图片转 PDF 这一页开始：这件事自己的打印台入口要留着，但没有这次交接就直接进打印台，不放行。
  await startWindDown(world)
  await goInApp(page, '/print/desk?step=check')
  await expect(windDownBlocked(page), '没有打印交接，直接进打印台要被拦').toBeVisible()
  await expect(page.locator('[data-print-desk]')).toHaveCount(0)
  await windDownBlocked(page).getByRole('button', { name: '返回', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/print-scan/convert')
  await expect(windDownBlocked(page)).toHaveCount(0)

  // 转图片、合成、点「拿这份 PDF 去打印」：这是这件事自己发起的打印交接，收尾中也能进打印台。
  await page.getByRole('button', { name: /手机扫码传图片/ }).click()
  await page.getByRole('button', { name: '确认加入待合并列表' }).click()
  await expect(page.getByText('license-image.png', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /合成 1 张为一份 PDF/ }).click()
  await expect(page.getByTestId('img2pdf-band').getByText('PDF 已生成')).toBeVisible()
  await page.getByRole('button', { name: '拿这份 PDF 去打印' }).click()
  await page.waitForURL((url) => url.pathname === '/print/desk')
  // 先等打印台真的渲染出来：地址一变，拦截屏或目标页不一定已经渲染，先断「没被拦」会空过。
  await expect(page.locator('[data-print-desk]'), '图片转 PDF 里发起的打印，收尾中也要放行：打印台应在屏上').toBeVisible()
  await expect(windDownBlocked(page)).toHaveCount(0)
})

test('收尾中进面试工作台的结果阶段（?stage=report、?stage=reports）不被拦，设置阶段被拦 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  await startWindDown(world)
  await expectHomeWindingDown(page)

  for (const name of ['report', 'reports']) {
    await goInApp(page, `/interview?stage=${name}`)
    await expect(windDownBlocked(page), `?stage=${name} 是结果页，不该被拦`).toHaveCount(0)
    await expect(page.locator(`[data-interview-stage="${name}"]`)).toBeVisible()
    await goInApp(page, '/')
    await expectHomeWindingDown(page)
  }

  // 阴性对照：同一个路径的设置阶段是办理页，从首页进来被拦。
  await goInApp(page, '/interview?stage=setup')
  await expect(windDownBlocked(page)).toBeVisible()
  await expect(page.locator('[data-interview-workbench]')).toHaveCount(0)
})

// ───────────────────────── 从「我的」里打开旧结果：只读 ─────────────────────────

test('收尾中从「我的简历」打开旧诊断报告：报告可看，优化、简历对照、自我探索停用 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  api.respond('GET', '/api/v1/me/resumes', { status: 200, json: { success: true, data: { items: [RESUME_ROW], nextCursor: null, total: 1 } } })
  api.respond('GET', `/api/v1/resume/records/${RESUME_TASK_ID}`, { status: 200, json: RESUME_REPORT_RECORD })
  await signIn(page, api, world)

  // 阳性对照：授权正常时，同一条记录打开的报告，优化入口、简历对照、自我探索都是亮的，没有「只读」说明。
  await goInApp(page, '/me/resumes')
  await openResumeReport(page)
  await expect(page.getByTestId('resume-report-priorities')).toBeVisible()
  await expect(page.getByTestId('resume-report-primary')).toBeEnabled()
  await expect(page.getByRole('button', { name: '简历对照', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '自我探索', exact: true })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: NO_NEW_TASK })).toHaveCount(0)

  // 收尾在「我的简历」里开始：这一页的列表里，看报告照常，继续优化与简历对照停用。
  await goInApp(page, '/me/resumes')
  await startWindDown(world)
  await page.locator('[data-record-kind="parse"] .me-open').first().click()
  await expect(page.getByRole('button', { name: /这份简历的诊断报告$/ })).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: /优化版（/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByRole('button', { name: /简历对照（/ })).toHaveAttribute('aria-disabled', 'true')

  // 打开旧报告：不被拦，报告内容可看，只读说明在，优化入口、简历对照、自我探索停用且点不动。
  await page.getByRole('button', { name: /这份简历的诊断报告$/ }).click()
  await page.waitForURL((url) => url.pathname === '/resume/report')
  await expect(windDownBlocked(page), '旧报告是结果页，不该被拦').toHaveCount(0)
  await expect(page.getByTestId('resume-report-priorities')).toBeVisible()
  await expect(page.getByTestId('resume-report-priorities').getByText('这段经历没有写出规模或结果')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: NO_NEW_TASK })).toBeVisible()
  const optimize = page.getByTestId('resume-report-primary')
  await expect(optimize).toBeDisabled()
  await expect(optimize).toHaveAttribute('title', NO_NEW_TASK)
  for (const name of ['简历对照', '自我探索']) {
    const link = page.getByRole('button', { name, exact: true })
    await expect(link, `${name}：只读时要停用`).toBeDisabled()
    await expect(link).toHaveAttribute('title', NO_NEW_TASK)
    await expectTapStays(page, link, name)
  }
  await expectTapStays(page, optimize, '优化入口')
})

test('收尾中从「AI 服务记录」打开旧模拟面试报告：不被拦，报告可看，重新练习与生成打印版停用，也进不了打印台 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  api.respond('GET', '/api/v1/me/mock-interviews', { status: 200, json: { success: true, data: { items: [INTERVIEW_ROW], nextCursor: null } } })
  api.respond('GET', `/api/v1/mock-interviews/${INTERVIEW_SESSION_ID}/report`, { status: 200, json: INTERVIEW_REPORT })
  await signIn(page, api, world)

  // 阳性对照：授权正常时，同一条记录打开的报告，重新练习、生成打印版都是亮的，没有「只读」说明。
  await goInApp(page, '/me/ai-records')
  await openInterviewReport(page)
  await expect(page.locator('[data-interview-stage="report"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新练习', exact: true })).toBeEnabled()
  await expect(page.getByTestId('interview-primary')).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: NO_NEW_TASK })).toHaveCount(0)

  // 收尾在「AI 服务记录」里开始，再从记录打开旧报告。
  await goInApp(page, '/me/ai-records')
  await startWindDown(world)
  await openInterviewReport(page)
  await expect(windDownBlocked(page), `从记录打开旧面试报告是看结果，不该被拦（当前地址 ${page.url()}）`).toHaveCount(0)
  await expect(page.locator('[data-interview-stage="report"]')).toBeVisible()
  await expect(page.getByText(INTERVIEW_REPORT.data.report.overall.summary)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: NO_NEW_TASK })).toBeVisible()
  const again = page.getByRole('button', { name: '重新练习', exact: true })
  await expect(again).toBeDisabled()
  await expect(again).toHaveAttribute('title', NO_NEW_TASK)
  await expectTapStays(page, again, '重新练习')
  const print = page.getByTestId('interview-primary')
  await expect(print).toBeDisabled()
  await expect(print).toHaveAttribute('title', NO_NEW_TASK)
  await expectTapStays(page, print, '生成打印版')
  // 从「我的」只读打开的旧结果发起不了打印：按钮停用之外，收尾是在「我的」里开始的，打印台也不放行（没有这条来源的打印交接）。
  await goInApp(page, '/print/preview')
  await expect(windDownBlocked(page), '「我的」里开始的收尾，进打印台要被拦').toBeVisible()
})

test('收尾中从面试历史列表打开旧报告：没带只读标记也只读，重新练习与生成打印版停用 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  api.respond('GET', '/api/v1/me/mock-interviews', { status: 200, json: { success: true, data: { items: [INTERVIEW_ROW], nextCursor: null } } })
  api.respond('GET', `/api/v1/mock-interviews/${INTERVIEW_SESSION_ID}/report`, { status: 200, json: INTERVIEW_REPORT })
  await signIn(page, api, world)

  // 阳性对照：授权正常时，从同一个历史列表点「查看」打开的报告，重新练习、生成打印版都是亮的。
  await goInApp(page, '/interview?stage=reports')
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.locator('[data-interview-stage="report"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '重新练习', exact: true })).toBeEnabled()
  await expect(page.getByTestId('interview-primary')).toBeEnabled()

  // 收尾在首页开始（不在面试服务里）：历史列表是结果页，进得去；点「查看」切到报告阶段，没有任何导航标记，也按服务只读。
  await goInApp(page, '/')
  await startWindDown(world)
  await goInApp(page, '/interview?stage=reports')
  await expect(windDownBlocked(page)).toHaveCount(0)
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await expect(page.locator('[data-interview-stage="report"]')).toBeVisible()
  await expect(page.getByText(INTERVIEW_REPORT.data.report.overall.summary)).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: NO_NEW_TASK })).toBeVisible()
  const again = page.getByRole('button', { name: '重新练习', exact: true })
  await expect(again).toBeDisabled()
  await expect(again).toHaveAttribute('title', NO_NEW_TASK)
  const print = page.getByTestId('interview-primary')
  await expect(print).toBeDisabled()
  await expect(print).toHaveAttribute('title', NO_NEW_TASK)
})

// ───────────────────────── 「我的」：查看类入口放开，开始新办理的入口仍锁 ─────────────────────────

test('收尾中本人的「我的」：资产格子、浏览记录、通知、帮助、反馈、隐私请求、设置都能进 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  // 这些页面挂载时读的列表：全按「没有记录」应答，用例看的是能不能进，不是里面有什么。
  for (const path of ['/api/v1/me/documents', '/api/v1/me/browse-logs', '/api/v1/me/notifications', '/api/v1/me/feedback', '/api/v1/me/data-requests']) {
    api.respond('GET', path, { status: 200, json: emptyPage })
  }
  api.respond('GET', '/api/v1/me/mock-interviews', { status: 200, json: { success: true, data: { items: [], nextCursor: null } } })
  await signIn(page, api, world)
  await startWindDown(world)
  await openMine(page)
  await expect(page.getByTestId('profile-asset-resumes')).toBeVisible()

  const entries = [
    ['profile-asset-resumes', '/me/resumes'],
    ['profile-asset-documents', '/me/documents'],
    ['profile-asset-orders', '/me/print-orders'],
    ['profile-asset-favorites', '/me/favorites'],
    ['profile-asset-benefits', '/me/benefits'],
    ['profile-asset-ai', '/me/ai-records'],
    ['profile-activity', '/me/activity'],
    ['profile-notifications', '/me/notifications'],
    ['profile-help', '/help'],
    ['profile-feedback', '/me/feedback'],
    ['profile-privacy', '/me/privacy-requests'],
    ['profile-account', '/me/settings'],
  ] as const
  for (const [testId, route] of entries) {
    await tap(page, page.getByTestId(testId))
    await page.waitForURL((url) => url.pathname === route)
    // 先等「我的」这一页被换掉，再看换上来的不是拦截屏（地址一变，新页面不一定已经渲染，直接断「没被拦」会空过）。
    await expect(page.getByTestId(testId), `${route}：「我的」这一页应已换成目标页`).toHaveCount(0)
    await expect(windDownBlocked(page), `${route}：收尾中能进，不该被拦`).toHaveCount(0)
    await expect(paused(page)).toHaveCount(0)
    await goInApp(page, '/profile')
    await expect(page.getByTestId(testId)).toBeVisible()
  }
})

test('收尾中游客的「我的」：登录按钮能点，「打印扫描」「查政策」停用 @license-gate', async ({ page, api }) => {
  const world = await boot(page, api)
  // 阳性对照：授权正常时，游客「我的」里「不登录也能办」的两张卡，同样的点法真的会进去。
  await tap(page, mainNav(page).getByRole('button', { name: '我的' }))
  await page.waitForURL((url) => url.pathname === '/profile')
  await expect(page.locator('[data-license-locked]')).toHaveCount(0)
  await tap(page, page.getByRole('button', { name: /打印扫描/ }))
  await page.waitForURL((url) => url.pathname === '/print-scan')
  await goInApp(page, '/profile')

  await startWindDown(world)
  await expect(windDownBlocked(page)).toHaveCount(0)

  // 「不登录也能办」里的两张卡：被锁住，点不动。
  const locked = page.locator('[data-license-locked] button')
  await expect(locked).toHaveCount(2)
  await expect(locked.nth(0)).toContainText('打印扫描')
  await expect(locked.nth(1)).toContainText('查政策')
  await expectTapStays(page, locked.nth(0), '打印扫描')
  await expectTapStays(page, locked.nth(1), '查政策')

  // 登录：收尾中也能登录（隐私权利要登录才能办），按钮亮着，点了进登录页。
  const login = page.getByTestId('profile-primary')
  await expect(login).toBeEnabled()
  await tap(page, login)
  await page.waitForURL((url) => url.pathname === '/login')
  await expect(login, '「我的」这一页应已换成登录页').toHaveCount(0)
  await expect(windDownBlocked(page)).toHaveCount(0)
})

// ───────────────────────── 到期时刻为空：页面自己兜到点 ─────────────────────────

test('验过签的答复没有到期时刻：先收尾，页面自己兜到点时刻，到点进暂停屏 @license-gate', async ({ page, api }) => {
  test.setTimeout(300_000)
  const world = await boot(page, api)
  await expectHomeLive(page)
  // 授权失效，并且后台算不出当前凭证何时到期（答复里 currentSessionEndsAt 为空）。不用 lapse：它会替每张票写一个到期时刻。
  world.active = false
  world.omitEndsAt = true
  const inactive = () => world.log.profile.find((entry) => entry.verified && entry.licenseState === 'inactive')
  await world.advanceUntil(async () => inactive() !== undefined, 4 * MINUTE)
  const firstSeen = inactive()!.at
  await expectHomeWindingDown(page)
  await expect(paused(page)).toHaveCount(0)

  // 之后每 3 分钟再读一次，答复里仍没有到期时刻：兜底的到点时刻从「第一次看到」起算，不能被一次次顺延。
  await world.freeze()
  await world.advance(firstSeen + UNKNOWN_DEADLINE_GRACE - 10_000 - world.now())
  await expect(paused(page), '到点前 10 秒还是收尾中').toHaveCount(0)
  await expectHomeWindingDown(page)
  await markDocument(page)
  await world.advance(25_000, { step: 5_000 })
  await expect(paused(page), '过点之后进暂停屏').toBeVisible()
  await world.thaw()
  await settleAfterPause(page)
})
