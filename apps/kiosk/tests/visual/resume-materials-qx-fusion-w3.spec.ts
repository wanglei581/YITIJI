import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { assertNoElementCrossesViewport, assertNoHorizontalOverflow, assertQxPillReadable, assertTapTargetPointerHit } from './assert-layout'

// ── 稿 25 求职材料库（/resume/materials）迁入青序流光后的浏览器回归 ───────────────
// 每条用例自带夹具：ApiRouter 未登记的 /api/v1 请求一律中断，并在收尾时判红（fail-closed）。
// 生成走真实登录链路拿会员令牌；本文件不写浏览器存储、不注入脚本。
// 文件名以 fusion-w3.spec.ts 结尾，由 W3 配置（playwright.w3.config.ts）接进 CI。

const MEMBER_TOKEN = 'materials-qx-member-token'
const TEMPLATES = '/api/v1/job-materials/templates'
const GENERATE = '/api/v1/job-materials/generate'
const VIEWPORTS = [{ width: 1080, height: 1920 }, { width: 390, height: 844 }] as const

const FIELDS = [
  { key: 'applicantName', label: '姓名', required: true, maxLength: 40, placeholder: '例：王同学' },
  { key: 'targetRole', label: '目标岗位', required: true, maxLength: 60, placeholder: '例：前端开发工程师' },
  { key: 'targetOrganization', label: '目标单位', required: false, maxLength: 80, placeholder: '例：某科技公司' },
  { key: 'keyStrengths', label: '核心亮点', required: false, maxLength: 280, multiline: true, placeholder: '例：项目经验' },
  { key: 'notes', label: '补充说明', required: false, maxLength: 220, multiline: true, placeholder: '例：语气稳重' },
]
const COVER = {
  id: 'campus-cover-letter', type: 'cover_letter', title: '校招自荐信', description: '适合应届生在校招现场生成一页自荐材料。',
  tags: ['校招', '通用'], status: 'published', recommendedFor: '应届毕业生、校园招聘会', outputFilename: '校招自荐信.pdf', fields: FIELDS,
}
const CHECKLIST = {
  id: 'job-fair-checklist', type: 'materials_checklist', title: '招聘会材料清单', description: '参加招聘会前的材料准备清单。',
  tags: ['招聘会', '通用'], status: 'published', recommendedFor: '招聘会现场打印、材料整理', outputFilename: '招聘会材料清单.pdf', fields: FIELDS,
}
/** 版式模板归 /resume/templates；本页必须把它滤掉，不能混进求职材料目录。 */
const RESUME_TEMPLATE = {
  id: 'tpl-clean', type: 'resume_template', title: '清爽通用简历模板', description: '单栏版式。', tags: ['简历模板'], status: 'published',
  recommendedFor: '版式参考', outputFilename: 'resume.pdf', fields: [],
  resumeLayoutPreset: { style: 'clean', defaultLayout: { columns: 1 }, sectionOrder: ['header', 'summary'] },
}
const FILE = {
  templateId: 'campus-cover-letter', templateTitle: '校招自荐信', documentType: 'cover_letter', fileId: 'jm-fixture-001',
  filename: '校招自荐信.pdf', mimeType: 'application/pdf', sizeBytes: 132096, pageCount: 2,
  signedUrl: '/api/v1/files/jm-fixture-001/content?sig=fixture-download', signedUrlExpiresAt: '2099-01-01T02:30:00.000Z',
  fileExpiresAt: '2099-03-01T00:00:00.000Z', previewUrlPath: '/files/jm-fixture-001/preview-url',
  downloadUrlPath: '/files/jm-fixture-001/download-url', printFileUrl: '/api/v1/files/jm-fixture-001/content?sig=fixture-print',
}
const templatesOf = (...items: unknown[]) => ({ status: 200, json: { success: true, data: items } })

/** 终端壳层 + 真实短信登录链路。 */
function registerShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', { status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true } })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'w3-materials', refreshIntervalMs: 300000, serverTime: '2026-09-23T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
  api.respond('GET', '/api/v1/kiosk/legal/terms_of_service', { status: 200, json: { success: true, data: null } })
  api.respond('GET', '/api/v1/kiosk/legal/privacy_policy', { status: 200, json: { success: true, data: null } })
  api.respond('POST', '/api/v1/member/auth/sms-code', { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } })
  api.respond('POST', '/api/v1/member/auth/login', {
    status: 200,
    json: { success: true, data: { token: MEMBER_TOKEN, user: { id: 'materials-member', phoneMasked: '138****8000', nickname: '材料库会员' } } },
  })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true, data: { loggedOut: true } } })
  // 登录后收藏上下文会读一次会员收藏；本页不展示收藏，给空页即可。
  api.respond('GET', '/api/v1/me/favorites', { status: 200, json: { success: true, data: { items: [], nextCursor: null, total: 0 } } })
}

/** 原文一律不透传：5xx 走统一的「服务暂时不可用」，未登记错误码的 4xx 回落到页面自己的兜底句。 */
const failure = (status: number, message: string) => ({ status, json: { success: false, error: { code: 'FIXTURE_UNREGISTERED', message } } })
const SERVICE_DOWN = '服务暂时不可用，请稍后重试或联系现场工作人员'

/** 已停在登录页时完成短信登录，并等回到材料库。 */
async function loginBackToMaterials(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  for (const digit of '13800138000') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of '123456') await page.getByRole('button', { name: digit, exact: true }).click()
  await page.getByRole('button', { name: '验证并登录', exact: true }).click()
  await page.waitForURL((url) => url.pathname === '/resume/materials')
}

/**
 * 1080×1920 一体机舞台与 390×844 手机（关缩放走流式）各量一遍：操作条不压滚动区、不掉出视口，
 * 无横向溢出与越界元素，状态胶囊可读，返回键与主操作真能被 ≥48px 的指针命中，再落一张截图。
 */
async function captureViewports(page: Page, name: string): Promise<void> {
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size)
    await expect.poll(async () => {
      const scroll = await page.locator('.qx-scroll').boundingBox()
      const ctabar = await page.locator('.qx-ctabar').boundingBox()
      if (!scroll || !ctabar) return 'missing'
      if (scroll.y + scroll.height > ctabar.y + 0.5) return `scroll overlaps ctabar ${scroll.y + scroll.height} > ${ctabar.y}`
      if (ctabar.y + ctabar.height > size.height + 0.5) return `ctabar leaves viewport ${ctabar.y + ctabar.height}`
      return 'ok'
    }, { message: `${name} ${size.width}x${size.height} 操作条与滚动区` }).toBe('ok')
    await assertNoHorizontalOverflow(page)
    await assertNoElementCrossesViewport(page)
    await assertQxPillReadable(page, `${name} ${size.width}x${size.height}`)
    for (const target of [page.locator('.qx-topbar-back'), page.locator('.qx-ctabar .qx-btn').last()]) await assertTapTargetPointerHit(target)
    await page.screenshot({ path: test.info().outputPath(`${name}-${size.width}x${size.height}.png`) })
  }
  await page.setViewportSize({ width: 1080, height: 1920 })
}

const screenOf = (page: Page) => page.locator('[data-kiosk-screen="resume-materials"]')
const cta = (page: Page, name: string) => page.locator('.qx-ctabar').getByRole('button', { name, exact: true })

test('material workshop: catalog, signed-out draft handoff, inline validation and a real print-ready file @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', TEMPLATES, templatesOf(COVER, CHECKLIST, RESUME_TEMPLATE))
  await page.goto('/resume/materials')
  const screen = screenOf(page)
  await expect(screen).toHaveAttribute('data-state', 'select')
  await expect(page.locator('[data-qx-frame="true"]')).toBeVisible()
  await expect(page.locator('.qx-rm-template')).toHaveCount(2)
  await expect(page.getByTestId('material-workshop-template-campus-cover-letter')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.qx-pill')).toHaveText('未登录 · 生成前先存草稿')
  await expect(page.getByText('系统不收取求职者简历给企业', { exact: false })).toBeVisible()
  await captureViewports(page, 'materials-select-signed-out')

  // 分类筛掉的模板不凭空消失：给出回跳入口，点一下切回「全部」并选中它。
  const filters = page.getByRole('navigation', { name: '求职材料分类' })
  await filters.getByRole('button', { name: '材料清单', exact: true }).click()
  await expect(page.locator('.qx-rm-template')).toHaveCount(1)
  const others = page.getByTestId('material-workshop-others')
  await expect(others).toContainText('还有 1 份')
  await others.getByRole('button', { name: /校招自荐信/ }).click()
  await expect(filters.getByRole('button', { name: '全部', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('material-workshop-template-campus-cover-letter')).toHaveAttribute('aria-pressed', 'true')

  // 未登录：先存草稿再去登录，生成请求一次都不发；登录回来草稿原样带回，但不会自动提交。
  await page.locator('#material-field-applicantName').fill('  王同学 ')
  await cta(page, '登录后生成').click()
  await expect(page).toHaveURL(/\/login$/)
  expect(api.requestCount('POST', GENERATE)).toBe(0)
  await loginBackToMaterials(page)
  await expect(screen).toHaveAttribute('data-state', 'select')
  await expect(page.getByText('草稿已原样带回。')).toBeVisible()
  await expect(page.locator('#material-field-applicantName')).toHaveValue('  王同学 ')
  expect(api.requestCount('POST', GENERATE)).toBe(0)

  // 必填为空：就地标红、焦点落在第一个出错字段，请求根本不发。
  await cta(page, '生成可打印版').click()
  const role = page.locator('#material-field-targetRole')
  await expect(role).toHaveAttribute('aria-invalid', 'true')
  await expect(role).toBeFocused()
  await expect(page.locator('#material-field-targetRole-error')).toHaveText('请填写目标岗位')
  expect(await page.locator('#material-field-applicantName').getAttribute('aria-invalid')).toBeNull()
  expect(api.requestCount('POST', GENERATE)).toBe(0)
  await captureViewports(page, 'materials-validation')

  await role.fill('用户运营专员')
  expect(await role.getAttribute('aria-invalid')).toBeNull()
  api.respond('POST', GENERATE, { status: 200, json: { success: true, data: FILE } })
  const sent = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === GENERATE)
  await cta(page, '生成可打印版').click()
  const request = await sent
  expect(request.headers().authorization).toBe(`Bearer ${MEMBER_TOKEN}`)
  expect(request.postDataJSON()).toEqual({ templateId: 'campus-cover-letter', applicantName: '王同学', targetRole: '用户运营专员' })

  // 文件卡只摊开服务端返回的真实字段；签名链接与打印凭证本身都不上屏。
  await expect(screen).toHaveAttribute('data-state', 'generated')
  const card = page.getByTestId('material-workshop-file')
  await expect(card).toHaveAttribute('data-print-ready', '1')
  for (const text of ['校招自荐信.pdf', '2 页', '129 KB', 'jm-fixture-001', '2099-01-01 10:30', '2099-03-01 08:00', '文件已进入我的文档']) {
    await expect(card).toContainText(text)
  }
  expect(await page.locator('body').innerText()).not.toContain('sig=fixture')
  expect(await cta(page, '打印材料').getAttribute('aria-disabled')).toBeNull()
  expect(await cta(page, '查看我的文档').getAttribute('aria-disabled')).toBeNull()
  await captureViewports(page, 'materials-generated')

  // 改字段就收起文件卡：屏幕上不留一张与当前草稿对不上的「已生成」。
  await page.locator('#material-field-notes').fill('希望语气稳重')
  await expect(screen).toHaveAttribute('data-state', 'select')
  await expect(card).toHaveCount(0)
  expect(api.requestCount('POST', GENERATE)).toBe(1)
})

test('material workshop: empty list and read failure are separate honest states with a real retry @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  // ApiRouter 基线对模板列表应答空数组：读取成功但为空，不是故障，也不拿示例模板补位。
  await page.goto('/resume/materials')
  const screen = screenOf(page)
  await expect(screen).toHaveAttribute('data-state', 'empty')
  await expect(page.getByRole('heading', { name: '当前没有已发布的求职材料模板' })).toBeVisible()
  await expect(page.locator('.qx-rm-template')).toHaveCount(0)
  await expect(page.locator('.qx-pill')).toHaveText('当前没有已发布模板')
  await captureViewports(page, 'materials-empty')

  api.respond('GET', TEMPLATES, failure(503, 'fixture template failure'))
  await cta(page, '重新读取一次').click()
  await expect(screen).toHaveAttribute('data-state', 'error')
  await expect(page.getByRole('alert')).toHaveText(SERVICE_DOWN)
  await expect(page.getByText('fixture template failure')).toHaveCount(0)
  await expect(page.locator('.qx-rm-template')).toHaveCount(0)
  await captureViewports(page, 'materials-error')

  api.respond('GET', TEMPLATES, templatesOf(CHECKLIST))
  await cta(page, '重新读取').click()
  await expect(screen).toHaveAttribute('data-state', 'select')
  await expect(page.getByTestId('material-workshop-template-job-fair-checklist')).toHaveAttribute('aria-pressed', 'true')
  expect(api.requestCount('GET', TEMPLATES)).toBe(3)
  expect(api.requestCount('POST', GENERATE)).toBe(0)
})

test('material workshop: failed generation keeps the form; a file without print credential only disables print @w3-kiosk', async ({ page, api }) => {
  registerShell(api)
  api.respond('GET', TEMPLATES, templatesOf(COVER))
  api.respondWith('POST', GENERATE, (n) => n === 1
    ? failure(422, 'fixture generate failure')
    : { status: 200, json: { success: true, data: { ...FILE, printFileUrl: undefined } } })
  await page.goto(`/login?from=${encodeURIComponent('/resume/materials')}`)
  await loginBackToMaterials(page)
  const screen = screenOf(page)
  await expect(screen).toHaveAttribute('data-state', 'select')
  await expect(page.locator('.qx-pill')).toHaveText('固定模板生成 · 内容由你填写')
  await page.locator('#material-field-applicantName').fill('王同学')
  await page.locator('#material-field-targetRole').fill('用户运营专员')

  await cta(page, '生成可打印版').click()
  await expect(screen).toHaveAttribute('data-state', 'failed')
  await expect(page.getByRole('alert')).toContainText('这次没能生成出来：生成失败，请稍后重试')
  await expect(page.getByText('fixture generate failure')).toHaveCount(0)
  await expect(page.getByTestId('material-workshop-file')).toHaveCount(0)
  await expect(page.locator('#material-field-applicantName')).toHaveValue('王同学')
  await expect(page.locator('#material-field-targetRole')).toHaveValue('用户运营专员')
  await captureViewports(page, 'materials-failed')

  await cta(page, '生成可打印版').click()
  await expect(screen).toHaveAttribute('data-state', 'generated-no-print')
  await expect(page.getByTestId('material-workshop-file')).toHaveAttribute('data-print-ready', '0')
  const print = cta(page, '打印材料')
  await expect(print).toHaveAttribute('aria-disabled', 'true')
  await expect(print).toHaveAttribute('aria-describedby', 'material-print-blocked')
  await expect(page.locator('#material-print-blocked')).toHaveText('打印链接未就绪，请重新生成后再试')
  expect(await cta(page, '查看我的文档').getAttribute('aria-disabled')).toBeNull()
  // 置灰不是装饰：点下去也不能进打印确认。
  await print.dispatchEvent('click')
  await expect(page).toHaveURL(/\/resume\/materials$/)
  await captureViewports(page, 'materials-generated-no-print')
  expect(api.requestCount('POST', GENERATE)).toBe(2)
})
