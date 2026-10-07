// 51 手机接力：小青页脚、签名屏、扫码登录错误态、390×844 字号、单卡留白、预检错误说明在首屏。
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { prepareRelayPages, QR_STATES, UPLOAD_STATES, relayPagesPlan, type RelayPagesPlan } from './fixtures/qingxu-pair-relay-pages'
import type { QingxuPairTarget } from './fixtures/qingxu-pair-targets'

const XIAOQING = '回到这台机器后，可以让小青接着看你的材料。小青不替你确认登录，也不替你发出文件。'
const PHONE = '13812346627'
const TICKET = 'relay51staff0123456789abcd'
const STATUS = `/api/v1/member/auth/qr/${TICKET}/status`
const CONFIRM = `/api/v1/member/auth/qr/${TICKET}/confirm`
const SMS = '/api/v1/member/auth/sms-code'
const DEVICE = '大厅里的这台机器'

function pending(remain: number) {
  return {
    status: 200,
    json: { success: true, data: { status: 'pending', deviceLabel: DEVICE, returnTo: '/', expiresInSeconds: remain } },
  }
}

function fail(status: number, code: string, message: string) {
  return { status, json: { success: false, error: { code, message } } }
}

const SMS_OK = { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } }

function asTarget(screen: string, state: string, runtimeUrl: string): QingxuPairTarget {
  const plan: RelayPagesPlan = {
    plan: { kind: 'relay-pages' },
    reason: null,
    marker: null,
    runtimePath: runtimeUrl,
  }
  return {
    file: '51-phone-relay.html',
    nn: '51',
    screen,
    state,
    protoQuery: '',
    waitProtoState: false,
    protoSessionLost: false,
    route: plan.runtimePath,
    runtimeUrl: plan.runtimePath,
    readyMarker: plan.marker,
    capture: true,
    missingReason: null,
    plan: plan.plan,
  }
}

async function openQr(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.goto(`/member/qr-login?ticketId=${TICKET}`, { waitUntil: 'domcontentloaded' })
  const root = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(root).toHaveAttribute('data-mobile-qr-state', /ready|device-missing/)
  return root
}

async function send(root: ReturnType<Page['locator']>): Promise<void> {
  await root.getByLabel('手机号，11 位数字').fill(PHONE)
  await root.getByRole('button', { name: '获取短信验证码' }).click()
}

async function confirm(root: ReturnType<Page['locator']>, code: string): Promise<void> {
  await expect(root).toHaveAttribute('data-mobile-qr-state', 'code-sent')
  await root.getByLabel('短信验证码，6 位数字').fill(code)
  await root.getByRole('button', { name: '确认本次一体机登录请求' }).click()
}

function refuseStaff(text: string): void {
  expect(text).not.toContain('工作人员')
  expect(text).not.toContain('服务台')
}

test('两条手机接力路由都只放小青页脚句，不放问小青按钮 @mobile', async ({ page }) => {
  await page.goto('/member/qr-login')
  await expect(page.locator('.k1-mobile-qr-xiaoqing')).toHaveText(XIAOQING)
  await expect(page.getByRole('button', { name: '问小青' })).toHaveCount(0)
  await page.goto('/upload/phone')
  await expect(page.locator('.ph-up-xiaoqing')).toHaveText(XIAOQING)
  await expect(page.getByRole('button', { name: '问小青' })).toHaveCount(0)
  await expect(page.locator('main[data-kiosk-screen="phone-upload"]')).toContainText(XIAOQING)
})

test('签名屏不指向本机上传，不写工作人员 @mobile', async ({ page, api }) => {
  api.respond('GET', '/api/v1/public/support-contact', { status: 404, json: { success: false } })
  await prepareRelayPages(page, api, asTarget('phone-upload', 'signature-blocked', '/upload/phone#purpose=signature_image'))
  const root = page.locator('main[data-kiosk-screen="phone-upload"]')
  await expect(root.getByRole('heading', { name: '签名暂不支持手机上传', exact: true })).toBeVisible()
  const text = await root.innerText()
  expect(text).not.toContain('本机上传')
  expect(text).not.toContain('在原步骤上传')
  expect(text).toContain('可用的签名方式请回一体机在「签名」那一步查看。')
  expect(text).toContain('请回到「签名」的原步骤查看可用方式。没有可用方式时，需要帮助？查看《隐私政策》里的联系方式。')
  expect(text).toContain('回到原步骤查看可用方式；只接受本人手写签名图片。')
  expect(text).toContain('返回上一步。需要帮助？查看《隐私政策》里的联系方式。本页没有别的上传方式可试。')
  expect(text).not.toContain('拨打服务电话')
  refuseStaff(text)
})

test('扫码登录各错误态不出现工作人员，有号码和没号码两种拼法都读得通 @mobile', async ({ page, api }) => {
  api.respond('GET', STATUS, pending(126))
  api.respond('POST', SMS, fail(400, 'SMS_REJECTED', '请求失败（400）'))
  const denied = await openQr(page)
  await send(denied)
  await expect(denied).toHaveAttribute('data-mobile-qr-state', 'send-error')
  await expect(denied).toContainText('需要帮助？拨打服务电话')
  const deniedText = await denied.innerText()
  expect(deniedText).toContain('系统没有接受这次请求。请核对手机号后再试；仍然不行就回一体机换其他登录方式。')
  expect(deniedText).not.toMatch(/，需要帮助？/)
  refuseStaff(deniedText)

  api.respond('GET', '/api/v1/public/support-contact', { status: 404, json: { success: false } })
  api.respond('POST', SMS, fail(429, 'SMS_DAILY_LIMIT', '请求失败（429）'))
  await page.goto(`/member/qr-login?ticketId=${TICKET}`, { waitUntil: 'domcontentloaded' })
  const tomorrow = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(tomorrow).toHaveAttribute('data-mobile-qr-state', 'ready')
  await send(tomorrow)
  await expect(tomorrow).toHaveAttribute('data-mobile-qr-state', 'send-limited')
  await expect(tomorrow).toContainText('需要帮助？查看《隐私政策》里的联系方式。')
  const tomorrowText = await tomorrow.innerText()
  expect(tomorrowText).toContain('不方便换号就回一体机换其他登录方式。')
  expect(tomorrowText).not.toContain('拨打服务电话')
  expect(tomorrowText).not.toMatch(/，需要帮助？/)
  refuseStaff(tomorrowText)

  api.respond('GET', '/api/v1/public/support-contact', {
    status: 200,
    json: {
      success: true,
      data: { servicePhone: '18369161921', serviceHours: '工作日 9:00–18:00', otherOnlineTerminalNearby: false, miniappPublished: false },
    },
  })
  api.respond('POST', SMS, SMS_OK)
  api.respond('POST', CONFIRM, fail(401, 'SMS_CODE_EXPIRED', '验证码已过期'))
  await page.goto(`/member/qr-login?ticketId=${TICKET}`, { waitUntil: 'domcontentloaded' })
  const expired = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(expired).toHaveAttribute('data-mobile-qr-state', 'ready')
  await send(expired)
  await confirm(expired, '572046')
  await expect(expired).toHaveAttribute('data-mobile-qr-state', 'confirm-code-expired')
  await expect(expired).toContainText('回一体机在屏幕上换其他登录方式。需要帮助？拨打服务电话 18369161921（工作日 9:00–18:00）。')
  const expiredText = await expired.innerText()
  refuseStaff(expiredText)

  api.respond('POST', CONFIRM, fail(400, 'QR_CONFIRM_REJECTED', '请求失败（400）'))
  await page.goto(`/member/qr-login?ticketId=${TICKET}`, { waitUntil: 'domcontentloaded' })
  const rejected = page.locator('main[data-kiosk-screen="member-qr-login"]')
  await expect(rejected).toHaveAttribute('data-mobile-qr-state', 'ready')
  await send(rejected)
  await confirm(rejected, '204816')
  await expect(rejected).toHaveAttribute('data-mobile-qr-state', 'confirm-rejected')
  await expect(rejected).toContainText('需要帮助？拨打服务电话 18369161921（工作日 9:00–18:00）。')
  const rejectedText = await rejected.innerText()
  expect(rejectedText).toContain('系统没有接受这次确认。可以核对手机号和验证码后再试；仍然不行就回一体机换其他登录方式。')
  expect(rejectedText).toContain('这张二维码没有因此作废。')
  expect(rejectedText).not.toMatch(/，需要帮助？/)
  const alert = rejected.locator('.k1-mobile-qr-alert')
  await expect(alert).toBeVisible()
  const alertBox = await alert.boundingBox()
  const formBox = await rejected.locator('.k1-mobile-qr-card').boundingBox()
  expect(alertBox && formBox && alertBox.y < formBox.y).toBe(true)
  refuseStaff(rejectedText)
})

test('390×844 可见文字不小于 15px，三张单卡屏整行空白小于 160px @mobile', async ({ page, api }) => {
  test.setTimeout(120_000)
  const screens: Array<{ screen: 'qr-login' | 'phone-upload'; state: string; url: string }> = [
    { screen: 'qr-login', state: 'missing-ticket', url: '/member/qr-login' },
    { screen: 'qr-login', state: 'checking', url: '/member/qr-login?ticketId=relay51qr0123456789abcdef' },
    { screen: 'qr-login', state: 'ready', url: '/member/qr-login?ticketId=relay51qr0123456789abcdef' },
    { screen: 'qr-login', state: 'send-error', url: '/member/qr-login?ticketId=relay51qr0123456789abcdef' },
    { screen: 'phone-upload', state: 'invalid', url: '/upload/phone' },
    { screen: 'phone-upload', state: 'signature-blocked', url: '/upload/phone#purpose=signature_image' },
    { screen: 'phone-upload', state: 'idle', url: '/upload/phone#sessionId=upl51haichuan&token=tok51haichuan&purpose=resume_upload' },
  ]
  for (const item of screens) {
    await page.goto('about:blank')
    await prepareRelayPages(page, api, asTarget(item.screen, item.state, item.url))
    const small = await page.evaluate(() => {
      const root = document.querySelector('main')
      if (!root) return [{ size: 0, sample: '没有主区域' }]
      const found: Array<{ size: number; sample: string }> = []
      const visit = (node: Element, pseudo?: '::before' | '::after') => {
        if (!(node instanceof HTMLElement)) return
        const style = getComputedStyle(node, pseudo)
        if (!pseudo && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return
        const raw = pseudo ? style.content : [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent ?? '').join('')
        const text = raw.replace(/^['"]|['"]$/g, '').trim()
        if (!text || text === 'none' || text === 'normal') return
        const size = Number.parseFloat(style.fontSize)
        if (size < 14.99) found.push({ size, sample: `${node.tagName.toLowerCase()}${pseudo ?? ''} ${text.slice(0, 24)}` })
      }
      root.querySelectorAll('*').forEach((node) => {
        visit(node)
        visit(node, '::before')
        visit(node, '::after')
      })
      return found
    })
    expect(small, `${item.screen}/${item.state} 小于 15px：${JSON.stringify(small)}`).toEqual([])
  }

  const blanks: Record<string, number> = {}
  for (const item of [
    { screen: 'qr-login' as const, state: 'checking', url: '/member/qr-login?ticketId=relay51qr0123456789abcdef', root: '.k1-mobile-qr-content' },
    { screen: 'phone-upload' as const, state: 'invalid', url: '/upload/phone', root: '.k1-phone-upload-content' },
    { screen: 'phone-upload' as const, state: 'signature-blocked', url: '/upload/phone#purpose=signature_image', root: '.k1-phone-upload-content' },
  ]) {
    await page.goto('about:blank')
    await prepareRelayPages(page, api, asTarget(item.screen, item.state, item.url))
    const gap = await page.evaluate((selector) => {
      const root = document.querySelector(selector)
      if (!(root instanceof HTMLElement)) return -1
      const box = root.getBoundingClientRect()
      const skip = new Set([
        'k1-mobile-qr-flow', 'k1-mobile-qr-takeover', 'k1-mobile-qr-content', 'k1-mobile-qr-grow', 'k1-mobile-qr-wave',
        'ph-up-flow', 'ph-up-takeover', 'k1-phone-upload-content', 'ph-up-grow', 'ph-up-wave',
      ])
      const occupied = new Uint8Array(Math.max(1, Math.ceil(box.height)))
      root.querySelectorAll('*').forEach((node) => {
        if (!(node instanceof HTMLElement)) return
        if ([...node.classList].some((name) => skip.has(name))) return
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return
        const rect = node.getBoundingClientRect()
        if (rect.height < 1 || rect.width < 1) return
        const hasText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim())
        const painted = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent'
        const bordered = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].some((key) => Number.parseFloat(style[key as 'borderTopWidth']) > 0)
        if (!hasText && !painted && !bordered) return
        const top = Math.max(0, Math.floor(rect.top - box.top))
        const bottom = Math.min(occupied.length, Math.ceil(rect.bottom - box.top))
        for (let y = top; y < bottom; y += 1) occupied[y] = 1
      })
      let max = 0
      let run = 0
      for (const bit of occupied) {
        if (bit) run = 0
        else {
          run += 1
          if (run > max) max = run
        }
      }
      return max
    }, item.root)
    blanks[`${item.screen}/${item.state}`] = gap
    expect(gap, `${item.screen}/${item.state} 整行空白 ${gap}px`).toBeLessThan(160)
  }
  console.log(`手机接力整行空白 ${JSON.stringify(blanks)}`)
})

test('390×844 四态预检错误说明的底边不超过首屏 @mobile', async ({ page, api }) => {
  test.setTimeout(90_000)
  for (const state of ['empty-error', 'too-large', 'type-error', 'content-type-error']) {
    // 四态只改 hash。同一文档里改 hash 不会卸掉已选文件，下一态就等不到 idle。
    await page.goto('about:blank')
    await prepareRelayPages(page, api, asTarget('phone-upload', state, `/upload/phone#sessionId=upl51haichuan&token=tok51haichuan&purpose=resume_upload`))
    const note = page.getByTestId('phone-upload-precheck-error')
    await expect(note).toBeVisible()
    const metrics = await note.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const flow = el.closest('.ph-up-flow')
      const flowRect = flow instanceof HTMLElement ? flow.getBoundingClientRect() : null
      return { bottom: rect.bottom, flowBottom: flowRect ? flowRect.bottom : null }
    })
    console.log(`预检错误说明底边 ${state} ${metrics.bottom} 可见流 ${metrics.flowBottom}`)
    expect(metrics.bottom, `${state} 预检错误说明底边 ${metrics.bottom}`).toBeLessThanOrEqual(844)
    expect(metrics.flowBottom, `${state} 没有量到可见流`).not.toBeNull()
    // 844 含页脚占位。说明若落在滚动流外面，底边仍可能小于 844，但首屏看不全。
    expect(metrics.bottom, `${state} 预检错误说明底边 ${metrics.bottom} 超过可见流底边 ${metrics.flowBottom}`).toBeLessThanOrEqual(metrics.flowBottom ?? 0)
  }
})

async function visibleMetrics(page: Page, selector: string) {
  return page.locator(selector).evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const dock = document.querySelector('.k1-mobile-qr-dock')?.getBoundingClientRect()
    return {
      top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
      viewport: window.innerHeight, width: window.innerWidth,
      dockTop: dock?.top ?? window.innerHeight,
    }
  })
}

async function expectInViewport(page: Page, selector: string, name: string, aboveDock = false) {
  await expect(page.locator(selector)).toBeVisible()
  let lastMetrics: Awaited<ReturnType<typeof visibleMetrics>> | null = null
  const message = `${name} 应完整可见${aboveDock ? '且不被按钮条挡住' : ''}`
  try {
    await expect.poll(async () => {
      const m = await visibleMetrics(page, selector)
      lastMetrics = m
      const bottom = aboveDock ? Math.min(m.viewport, m.dockTop) : m.viewport
      return { 合格: m.top >= -1 && m.bottom <= bottom + 1 && m.left >= -1 && m.right <= m.width + 1, 读数: m }
    }, { message }).toMatchObject({ 合格: true })
  } catch (error) {
    throw new Error(`${message}，最后读数 ${JSON.stringify(lastMetrics)}\n${error instanceof Error ? error.message : String(error)}`)
  }
}

test('390×844 三态手机号输入框在首屏 @mobile', async ({ page, api }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const state of ['ready', 'device-missing', 'send-loading']) {
    await page.goto('about:blank')
    const plan = relayPagesPlan('51-phone-relay.html', 'qr-login', state)
    expect(plan?.runtimePath, `${state} 应有夹具地址`).toBeTruthy()
    await prepareRelayPages(page, api, asTarget('qr-login', state, plan!.runtimePath!))
    await expect.poll(async () => page.getByLabel('手机号，11 位数字').evaluate((el) => {
      const input = el.getBoundingClientRect()
      const flow = document.querySelector('.k1-mobile-qr-flow')!.getBoundingClientRect()
      return { 合格: input.top >= flow.top && input.bottom <= flow.bottom, 输入框上: input.top, 输入框下: input.bottom, 滚动区上: flow.top, 滚动区下: flow.bottom }
    }), { message: `${state} 手机号输入框应完整落在首屏滚动区内` }).toMatchObject({ 合格: true })
    const cardLines = await page.locator('.k1-mobile-qr-device').evaluate((el) => {
      const chip = el.querySelector('.k1-mobile-qr-device-chip')!
      const note = el.querySelector('.k1-mobile-qr-device-note > span')!
      const chipStyle = getComputedStyle(chip)
      const chipBox = chip.getBoundingClientRect()
      const chipTextHeight = chipBox.height - Number.parseFloat(chipStyle.paddingTop) - Number.parseFloat(chipStyle.paddingBottom)
        - Number.parseFloat(chipStyle.borderTopWidth) - Number.parseFloat(chipStyle.borderBottomWidth)
      return {
        chipLines: chipTextHeight / Number.parseFloat(chipStyle.lineHeight),
        noteLines: note.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(note).lineHeight),
      }
    })
    expect(cardLines.chipLines, `${state} 胶囊应为一行，读数 ${JSON.stringify(cardLines)}`).toBe(1)
    expect(cardLines.noteLines, `${state} 核对说明应为两行，读数 ${JSON.stringify(cardLines)}`).toBe(2)
    if (state === 'device-missing') {
      const clearance = await page.getByLabel('手机号，11 位数字').evaluate((el) => {
        const input = el.getBoundingClientRect()
        const flow = document.querySelector('.k1-mobile-qr-flow')!.getBoundingClientRect()
        return { inputBottom: input.bottom, flowBottom: flow.bottom, gap: flow.bottom - input.bottom }
      })
      expect(clearance.gap, `${state} 输入框下方至少留 12px，读数 ${JSON.stringify(clearance)}`).toBeGreaterThanOrEqual(12)
    }
    expect(await page.locator('.k1-mobile-qr-flow').evaluate((el) => el.scrollTop), `${state} 首屏不应靠滚动凑出输入框`).toBe(0)
  }
})

test('比稿矮或比稿窄的视口主路径可见 @mobile', async ({ page, api }) => {
  test.setTimeout(180_000)
  const screens = [
    { screen: 'qr-login', state: 'ready', selector: 'input[aria-label="手机号，11 位数字"]' },
    { screen: 'qr-login', state: 'code-sent', selector: 'input[aria-label="短信验证码，6 位数字"]' },
    { screen: 'phone-upload', state: 'idle', selector: '.ph-up-pill' },
    ...['empty-error', 'too-large', 'type-error', 'content-type-error'].map((state) => ({ screen: 'phone-upload', state, selector: '[data-testid="phone-upload-precheck-error"]' })),
  ]
  for (const viewport of [{ width: 390, height: 700 }, { width: 360, height: 640 }, { width: 390, height: 800 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(viewport)
    for (const item of screens) {
      await page.goto('about:blank')
      const plan = relayPagesPlan('51-phone-relay.html', item.screen, item.state)
      expect(plan?.runtimePath, `${item.screen}/${item.state} 应有夹具地址`).toBeTruthy()
      await prepareRelayPages(page, api, asTarget(item.screen, item.state, plan!.runtimePath!))
      const name = `${viewport.width}×${viewport.height} ${item.screen}/${item.state}`
      const qr = item.screen === 'qr-login'
      await expectInViewport(page, item.selector, name, qr)
      if (qr) {
        await expectInViewport(page, '.k1-mobile-qr-confirm', `${name} 确认按钮`)
        const button = await visibleMetrics(page, '.k1-mobile-qr-confirm')
        expect(button.bottom - button.top, `${name} 主按钮高度 ${button.bottom - button.top}`).toBeGreaterThanOrEqual(56)
      } else if (item.state === 'idle') {
        const button = await visibleMetrics(page, '.ph-up-pill')
        expect(button.bottom - button.top, `${name} 选择文件按钮高度 ${button.bottom - button.top}`).toBeGreaterThanOrEqual(56)
      } else {
        await expect(page.getByTestId('phone-upload-precheck-error')).toHaveAttribute('data-tone', 'error')
      }
      const content = qr ? '.k1-mobile-qr-content' : '.k1-phone-upload-content'
      if (item.state !== 'code-sent') {
        expect(await page.locator(content).evaluate((el) => el.scrollTop), `${name} 主路径首屏不能靠滚动凑出来`).toBe(0)
      }
      // 每屏先量首屏，再滚到底，正文和页脚都不能被嵌套滚动或隐藏规则卡住。
      for (const position of ['首屏', '底部']) {
        if (position === '底部') {
          await page.locator(content).evaluate((el) => { el.scrollTop = el.scrollHeight })
          await expectInViewport(page, qr ? '.k1-mobile-qr-xiaoqing' : '.ph-up-xiaoqing', `${name} 小青全文`)
          await expectInViewport(page, qr ? '.k1-mobile-qr-footer' : '.ph-up-footer', `${name} 隐私全文`)
          await expect(page.locator(qr ? '.k1-mobile-qr-xiaoqing' : '.ph-up-xiaoqing')).toHaveText(XIAOQING)
          const scroll = await page.locator(content).evaluate((el) => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }))
          expect(Math.abs(scroll.top + scroll.height - scroll.total), `${name} 滚到底读数 ${JSON.stringify(scroll)}`).toBeLessThanOrEqual(1)
        }
        const metrics = await page.evaluate(() => {
          const small: string[] = []
          const tiny: string[] = []
          const hiddenFoot: string[] = []
          const visible = (el: Element) => {
            const rect = el.getBoundingClientRect()
            if (rect.bottom <= 0 || rect.top >= innerHeight || rect.width < 1 || rect.height < 1) return false
            for (let parent: Element | null = el; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent)
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
            }
            return true
          }
          document.querySelectorAll('main *').forEach((el) => {
            if (!visible(el)) return
            const style = getComputedStyle(el)
            const rect = el.getBoundingClientRect()
            const text = [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('').trim()
            if ((text || el instanceof HTMLInputElement) && Number.parseFloat(style.fontSize) < 15) small.push(`${el.className} ${style.fontSize} ${text.slice(0, 16)}`)
            if (el.matches('button, .ph-up-picker') && (rect.width < 48 || rect.height < 48)) tiny.push(`${el.className} ${rect.width}×${rect.height}`)
            for (const pseudo of ['::before', '::after']) {
              const ps = getComputedStyle(el, pseudo)
              if (ps.content && !['none', 'normal', '""', "''"].includes(ps.content) && Number.parseFloat(ps.fontSize) < 15) small.push(`${el.className}${pseudo} ${ps.fontSize}`)
            }
          })
          document.querySelectorAll('.k1-mobile-qr-xiaoqing, .k1-mobile-qr-footer, .ph-up-xiaoqing, .ph-up-footer').forEach((el) => {
            const style = getComputedStyle(el)
            if (style.display === 'none' || style.maxHeight !== 'none' || ['hidden', 'clip'].includes(style.overflowY) || (style.webkitLineClamp && style.webkitLineClamp !== 'none')) hiddenFoot.push(`${el.className} ${style.cssText}`)
          })
          return { small, tiny, hiddenFoot, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
        })
        expect(metrics.small, `${name} ${position} 小字号 ${JSON.stringify(metrics.small)}`).toEqual([])
        expect(metrics.tiny, `${name} ${position} 小点击区 ${JSON.stringify(metrics.tiny)}`).toEqual([])
        expect(metrics.hiddenFoot, `${name} 页脚隐藏规则 ${JSON.stringify(metrics.hiddenFoot)}`).toEqual([])
        expect(metrics.documentWidth, `${name} ${position} 文档宽 ${metrics.documentWidth}，视口宽 ${metrics.viewportWidth}`).toBeLessThanOrEqual(metrics.viewportWidth)
      }
    }
  }
})

test('29 态顶栏副标题不被截断 @mobile', async ({ page, api }) => {
  test.setTimeout(360_000)
  expect(QR_STATES.length + UPLOAD_STATES.length, '夹具状态应完整覆盖 29 态').toBe(29)
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 })
    for (const item of [
      ...QR_STATES.map((state) => ({ screen: 'qr-login', state, selector: '.k1-mobile-qr-brand small' })),
      ...UPLOAD_STATES.map((state) => ({ screen: 'phone-upload', state, selector: '.ph-up-brand small' })),
    ]) {
      await page.goto('about:blank')
      const plan = relayPagesPlan('51-phone-relay.html', item.screen, item.state)
      expect(plan?.runtimePath, `${item.screen}/${item.state} 应有夹具地址`).toBeTruthy()
      await prepareRelayPages(page, api, asTarget(item.screen, item.state, plan!.runtimePath!))
      const metrics = await page.locator(item.selector).evaluate((el) => {
        const style = getComputedStyle(el)
        const rect = el.getBoundingClientRect()
        const segments = [...el.querySelectorAll('span')].map((span) => {
          const range = document.createRange()
          range.selectNodeContents(span)
          const rects = [...range.getClientRects()].filter((box) => box.width > 0 && box.height > 0)
          return { text: span.textContent, rects: rects.map((box) => ({ top: box.top, bottom: box.bottom, left: box.left, right: box.right })) }
        })
        return { scroll: el.scrollWidth, client: el.clientWidth, overflow: style.textOverflow, whitespace: style.whiteSpace, lines: rect.height / Number.parseFloat(style.lineHeight), top: rect.top, bottom: rect.bottom, segments }
      })
      const name = `${width} ${item.screen}/${item.state} 副标题读数 ${JSON.stringify(metrics)}`
      expect(metrics.scroll, name).toBeLessThanOrEqual(metrics.client)
      expect(metrics.overflow === 'ellipsis' && metrics.whitespace === 'nowrap', name).toBe(false)
      expect(metrics.lines, name).toBeLessThanOrEqual(2.01)
      if (metrics.lines > 1.01) {
        expect(metrics.segments, `${name} 折行副标题应分成两段`).toHaveLength(2)
        expect(metrics.segments[0].text, `${name} 第一段应以「·」结尾`).toMatch(/·$/)
        for (const [index, segment] of metrics.segments.entries()) {
          const label = index === 0 ? '第一段应整段同行' : '第二段应整段同行，不能从词中间断开'
          expect(segment.rects.length, `${name} ${label}，应有可见矩形`).toBeGreaterThan(0)
          const tops = segment.rects.map((rect) => rect.top)
          expect(Math.max(...tops) - Math.min(...tops), `${name} ${label}`).toBeLessThanOrEqual(1)
        }
        const firstBottom = Math.max(...metrics.segments[0].rects.map((rect) => rect.bottom))
        const secondTop = Math.min(...metrics.segments[1].rects.map((rect) => rect.top))
        expect(secondTop, `${name} 第二段应从第二行开始`).toBeGreaterThan(firstBottom - 1)
      }
      await expectInViewport(page, item.selector, name)
      if (width === 390 && item.screen === 'qr-login' && !['ticket-expired', 'confirm-unknown'].includes(item.state)) {
        expect(metrics.lines, `${name} 默认副标题在 390 宽仍应只有一行`).toBeLessThanOrEqual(1.01)
      }
    }
  }
})
