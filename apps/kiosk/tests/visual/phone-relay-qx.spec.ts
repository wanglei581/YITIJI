// 51 手机接力：小青页脚、签名屏、扫码登录错误态、390×844 字号、单卡留白、预检错误说明在首屏。
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import { prepareRelayPages, type RelayPagesPlan } from './fixtures/qingxu-pair-relay-pages'
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
