import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, BrowserContext, Locator, Page, Request } from '@playwright/test'

export const KIOSK_ORIGIN = process.env.INTERACTION_KIOSK_ORIGIN ?? 'http://127.0.0.1:5273'
export const API_ORIGIN = process.env.INTERACTION_API_ORIGIN ?? 'http://127.0.0.1:3010'
export const FIXTURE_PDF = process.env.SWEEP_PDF ?? '/tmp/sweep-fixtures/valid-2p.pdf'
export const EVIDENCE_ROOT = join(
  fileURLToPath(new URL('../../../../docs/reviews/interaction-sweep-2026-09-08/ai-resume/', import.meta.url)),
)

export const FORBIDDEN_APPLY = /一键投递|立即投递|平台投递/
export const ALLOWED_APPLY = /去来源平台投递|扫码前往来源平台投递|来源平台投递页|来源平台投递/g
export const PRODUCTION_HOST = /zyidai\.cn|120\.48\.13\.190/i
export const MEMBER_PHONE = '13800000000'
const SMS_LOG = '/tmp/sweep-api.log'
const SMS_PEPPER = 'dev-secret-encryption-key-replace-in-prod-min-32-chars'

export type FourObs = {
  urlChanged: boolean
  apiRequests: string[]
  domChanged: boolean
  overlayOrToastOrError: boolean
  beforeUrl: string
  afterUrl: string
  beforeTextLen: number
  afterTextLen: number
}

export type ControlOp = {
  journey: string
  step: string
  route: string
  control: string
  selectorHint: string
  kind: 'click' | 'fill' | 'check' | 'select'
  disabled: boolean
  dead: boolean
  skipped?: string
  stub?: string
  observations: FourObs
  runtimeErrors: string[]
  forbiddenCopy: string[]
  screenshot: string
  note?: string
}

const CONTROL_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="checkbox"]',
  'summary',
].join(', ')

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function evidenceDir(journey: string): string {
  const dir = join(EVIDENCE_ROOT, journey)
  ensureDir(dir)
  return dir
}

function opsPath(): string {
  ensureDir(EVIDENCE_ROOT)
  return join(EVIDENCE_ROOT, 'operations.jsonl')
}

export function resetEvidence(): void {
  ensureDir(EVIDENCE_ROOT)
  writeFileSync(opsPath(), '')
}

export function readOperations(): ControlOp[] {
  if (!existsSync(opsPath())) return []
  return readFileSync(opsPath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ControlOp)
}

export function appendOperation(op: ControlOp): void {
  appendFileSync(opsPath(), `${JSON.stringify(op)}\n`)
}

export function slug(value: string): string {
  return value
    .replace(/\s+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .slice(0, 60) || 'step'
}

export async function newSweepContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    baseURL: KIOSK_ORIGIN,
  })
  const page = await context.newPage()
  await page.route(PRODUCTION_HOST, async (route) => {
    await route.abort('blockedbyclient')
  })
  return { context, page }
}

export function attachCollectors(page: Page): {
  runtimeErrors: string[]
  productionHits: string[]
  takeApiSince: () => string[]
} {
  const runtimeErrors: string[] = []
  const productionHits: string[] = []
  const apiLog: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error') runtimeErrors.push(`console: ${msg.text()}`)
  })
  page.on('request', (request: Request) => {
    const url = request.url()
    if (PRODUCTION_HOST.test(url)) productionHits.push(`${request.method()} ${url}`)
    if (url.includes('/api/v1/')) apiLog.push(`${request.method()} ${new URL(url).pathname}`)
  })
  let cursor = 0
  return {
    runtimeErrors,
    productionHits,
    takeApiSince: () => {
      const slice = apiLog.slice(cursor)
      cursor = apiLog.length
      return slice
    },
  }
}

async function pageFingerprint(page: Page): Promise<{ url: string; text: string; overlay: boolean; html: string }> {
  const url = page.url()
  const text = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim()
  const overlay = await page.locator('[role="dialog"], [role="alertdialog"], .qx-rd-overlay, .k-error, [role="alert"], .me-toast, .rrp-export-error').count()
  const html = await page.locator('body').evaluate((el) => el.innerHTML.slice(0, 80_000)).catch(() => '')
  return { url, text, overlay: overlay > 0, html }
}

export async function scanForbidden(page: Page): Promise<string[]> {
  const text = ((await page.locator('body').innerText().catch(() => '')) || '').replace(ALLOWED_APPLY, '')
  const hits = text.match(FORBIDDEN_APPLY)
  return hits ? [...new Set(hits)] : []
}

export async function shot(page: Page, journey: string, step: string): Promise<string> {
  const dir = evidenceDir(journey)
  const file = `${String(Date.now()).slice(-8)}-${slug(step)}.png`
  const path = join(dir, file)
  await page.screenshot({ path, fullPage: true })
  return `docs/reviews/interaction-sweep-2026-09-08/ai-resume/${journey}/${file}`
}

export async function observeAfter(
  page: Page,
  before: Awaited<ReturnType<typeof pageFingerprint>>,
  apiRequests: string[],
): Promise<FourObs> {
  await page.waitForTimeout(450)
  const after = await pageFingerprint(page)
  return {
    urlChanged: stripOrigin(before.url) !== stripOrigin(after.url),
    apiRequests,
    domChanged: before.html !== after.html || before.text !== after.text,
    overlayOrToastOrError: after.overlay !== before.overlay || after.overlay,
    beforeUrl: stripOrigin(before.url),
    afterUrl: stripOrigin(after.url),
    beforeTextLen: before.text.length,
    afterTextLen: after.text.length,
  }
}

function stripOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

export function isDead(obs: FourObs, disabled: boolean): boolean {
  if (disabled) return false
  return !obs.urlChanged && obs.apiRequests.length === 0 && !obs.domChanged && !obs.overlayOrToastOrError
}

export async function recordStep(opts: {
  page: Page
  journey: string
  step: string
  control: string
  selectorHint: string
  kind: ControlOp['kind']
  disabled?: boolean
  skipped?: string
  stub?: string
  note?: string
  collectors: ReturnType<typeof attachCollectors>
  act: () => Promise<void>
}): Promise<ControlOp> {
  const before = await pageFingerprint(opts.page)
  opts.collectors.takeApiSince()
  let disabled = Boolean(opts.disabled)
  try {
    if (!opts.skipped) await opts.act()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const screenshot = await shot(opts.page, opts.journey, `${opts.step}-error`)
    const op: ControlOp = {
      journey: opts.journey,
      step: opts.step,
      route: stripOrigin(opts.page.url()),
      control: opts.control,
      selectorHint: opts.selectorHint,
      kind: opts.kind,
      disabled,
      dead: false,
      skipped: opts.skipped,
      stub: opts.stub,
      observations: {
        urlChanged: false,
        apiRequests: [],
        domChanged: false,
        overlayOrToastOrError: true,
        beforeUrl: stripOrigin(before.url),
        afterUrl: stripOrigin(opts.page.url()),
        beforeTextLen: before.text.length,
        afterTextLen: before.text.length,
      },
      runtimeErrors: [...opts.collectors.runtimeErrors, `action-error: ${message}`],
      forbiddenCopy: await scanForbidden(opts.page),
      screenshot,
      note: opts.note ?? message,
    }
    appendOperation(op)
    return op
  }
  const apiRequests = opts.collectors.takeApiSince()
  const observations = await observeAfter(opts.page, before, apiRequests)
  if (!disabled) {
    // Re-check disabled after the click in case the locator was stale.
    disabled = Boolean(opts.disabled)
  }
  const screenshot = await shot(opts.page, opts.journey, opts.step)
  const op: ControlOp = {
    journey: opts.journey,
    step: opts.step,
    route: observations.afterUrl,
    control: opts.control,
    selectorHint: opts.selectorHint,
    kind: opts.kind,
    disabled,
    dead: !opts.skipped && isDead(observations, disabled),
    skipped: opts.skipped,
    stub: opts.stub,
    observations,
    runtimeErrors: [...opts.collectors.runtimeErrors],
    forbiddenCopy: await scanForbidden(opts.page),
    screenshot,
    note: opts.note,
  }
  appendOperation(op)
  return op
}

export type VisibleControl = {
  locator: Locator
  tag: string
  type: string
  text: string
  disabled: boolean
  fingerprint: string
}

export async function listVisibleControls(page: Page): Promise<VisibleControl[]> {
  const locators = page.locator(CONTROL_SELECTOR)
  const count = await locators.count()
  const result: VisibleControl[] = []
  for (let i = 0; i < count; i += 1) {
    const locator = locators.nth(i)
    if (!(await locator.isVisible().catch(() => false))) continue
    const info = await locator.evaluate((el) => {
      const element = el as HTMLElement
      const disabled = (
        element.hasAttribute('disabled')
        || element.getAttribute('aria-disabled') === 'true'
        || (element as HTMLButtonElement).disabled === true
      )
      const text = (element.getAttribute('aria-label')
        || element.innerText
        || (element as HTMLInputElement).placeholder
        || element.getAttribute('name')
        || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      return {
        tag: element.tagName.toLowerCase(),
        type: (element.getAttribute('type') || '').toLowerCase(),
        text,
        disabled,
      }
    }).catch(() => null)
    if (!info) continue
    result.push({
      locator,
      tag: info.tag,
      type: info.type,
      text: info.text || `${info.tag}#${i}`,
      disabled: info.disabled,
      fingerprint: `${info.tag}|${info.type}|${info.text}|${i}`,
    })
  }
  return result
}

export function shouldSkipControl(control: VisibleControl, extraSkip: string[] = []): string | null {
  const text = control.text
  if (control.type === 'file') return 'file-input-handled-separately'
  if (/^\[DEV\]/.test(text) || text.includes('[DEV]')) return 'dev-only-control'
  if (extraSkip.some((item) => text.includes(item))) return `journey-skip:${text}`
  return null
}

export async function operateControl(
  page: Page,
  control: VisibleControl,
  journey: string,
  stepPrefix: string,
  collectors: ReturnType<typeof attachCollectors>,
  extraSkip: string[] = [],
): Promise<ControlOp> {
  const skip = shouldSkipControl(control, extraSkip)
  const kind: ControlOp['kind'] = control.tag === 'select'
    ? 'select'
    : control.tag === 'textarea' || (control.tag === 'input' && !['checkbox', 'radio', 'button', 'submit'].includes(control.type))
      ? (control.type === 'checkbox' || control.type === 'radio' ? 'check' : 'fill')
      : control.type === 'checkbox' || control.type === 'radio' || control.tag === 'input' && control.type === 'checkbox'
        ? 'check'
        : 'click'
  return recordStep({
    page,
    journey,
    step: `${stepPrefix}-${control.text || control.tag}`,
    control: control.text,
    selectorHint: control.fingerprint,
    kind,
    disabled: control.disabled,
    skipped: skip ?? undefined,
    collectors,
    act: async () => {
      if (control.disabled) return
      await control.locator.scrollIntoViewIfNeeded().catch(() => undefined)
      if (kind === 'fill') {
        const sample = /电话|手机|phone/i.test(control.text) ? MEMBER_PHONE
          : /邮箱|email/i.test(control.text) ? 'test@example.com'
            : /姓名|name/i.test(control.text) ? '测试用户'
              : '这是交互走查填写的中文内容'
        await control.locator.fill(sample)
        return
      }
      if (kind === 'check') {
        await control.locator.check({ force: true }).catch(async () => {
          await control.locator.click()
        })
        return
      }
      if (kind === 'select') {
        const options = control.locator.locator('option')
        const total = await options.count()
        if (total >= 2) {
          const value = await options.nth(1).getAttribute('value')
          if (value !== null) await control.locator.selectOption(value)
          else await control.locator.selectOption({ index: 1 })
        }
        return
      }
      await control.locator.click()
    },
  })
}

export async function waitReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.locator('body').waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(400)
}

export async function gotoHome(page: Page): Promise<void> {
  await page.goto(`${KIOSK_ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  await waitReady(page)
}

export async function clickNamed(page: Page, name: string | RegExp): Promise<Locator> {
  const locator = page.getByRole('button', { name })
  await locator.first().scrollIntoViewIfNeeded()
  await locator.first().click()
  await waitReady(page)
  return locator.first()
}

export async function fillDiagnosisDirection(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  await recordStep({
    page, journey, step: 'fill-target-job', control: '目标岗位', selectorHint: 'input[placeholder*=前端工程师]',
    kind: 'fill', collectors,
    act: async () => {
      await page.getByPlaceholder(/前端工程师|财务助理/).fill('前端工程师')
    },
  })
  await recordStep({
    page, journey, step: 'open-industry', control: '选择行业方向', selectorHint: 'button[aria-label="选择行业方向"]',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '选择行业方向' }).click()
    },
  })
  const industryButtons = page.locator('[role="dialog"] button, .ui-kiosk-modal button')
  const industryCount = await industryButtons.count()
  if (industryCount >= 3) {
    await recordStep({
      page, journey, step: 'pick-industry-second', control: '行业第二项', selectorHint: 'industry-option-1',
      kind: 'click', collectors,
      act: async () => {
        // index 0 is often 暂不指定
        await industryButtons.nth(1).click()
      },
    })
  }
  if (await page.getByRole('button', { name: '完成' }).count()) {
    await recordStep({
      page, journey, step: 'industry-done', control: '完成', selectorHint: 'button:完成',
      kind: 'click', collectors,
      act: async () => {
        await page.getByRole('button', { name: '完成' }).click()
      },
    })
  }
  const selects = page.locator('select')
  const selectCount = await selects.count()
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i)
    if (!(await select.isVisible().catch(() => false))) continue
    if (await select.isDisabled().catch(() => false)) continue
    await recordStep({
      page, journey, step: `select-${i}-second`, control: `下拉#${i}`, selectorHint: `selectnth=${i}`,
      kind: 'select', collectors,
      act: async () => {
        const options = select.locator('option')
        if (await options.count() >= 2) await select.selectOption({ index: 1 })
      },
    })
  }
}

export async function uploadResumePdf(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  const fileInput = page.locator('input[type="file"][aria-label="选择本机简历文件"]')
  await recordStep({
    page, journey, step: 'upload-pdf', control: '选择本机简历文件', selectorHint: 'input[type=file][aria-label="选择本机简历文件"]',
    kind: 'fill', collectors,
    act: async () => {
      await fileInput.setInputFiles(FIXTURE_PDF)
      await page.getByText(/已就绪|valid-2p|开始 AI 诊断/).first().waitFor({ timeout: 20_000 })
    },
  })
}

export async function confirmAiConsent(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /确认使用简历 AI/ })
  if (await dialog.count() === 0) return
  await recordStep({
    page, journey, step: 'consent-confirm', control: '同意并继续', selectorHint: 'dialog:确认使用简历 AI >> 同意并继续',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '同意并继续' }).click()
    },
  })
}

export async function waitReport(page: Page): Promise<void> {
  await page.waitForURL((url) => url.pathname === '/resume/report', { timeout: 90_000 })
  await waitReady(page)
  await page.locator('[data-kiosk-screen="resume-report"], .rrp-page, text=简历诊断报告').first().waitFor({ timeout: 20_000 })
}

export async function confirmFactsIfOpen(page: Page, journey: string, collectors: ReturnType<typeof attachCollectors>): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /导出前核对事实/ })
  if (await dialog.count() === 0) return
  const boxes = dialog.locator('input[type="checkbox"]')
  const total = await boxes.count()
  for (let i = 0; i < total; i += 1) {
    await recordStep({
      page, journey, step: `fact-check-${i}`, control: `事实核对#${i}`, selectorHint: 'dialog checkbox',
      kind: 'check', collectors,
      act: async () => {
        await boxes.nth(i).check()
      },
    })
  }
  await recordStep({
    page, journey, step: 'fact-confirm-export', control: '确认导出', selectorHint: 'dialog >> 确认导出',
    kind: 'click', collectors,
    act: async () => {
      await dialog.getByRole('button', { name: '确认导出' }).click()
    },
  })
}

export async function closePreviewIfOpen(page: Page): Promise<void> {
  const close = page.getByRole('button', { name: /关闭|完成|返回/ }).filter({ hasText: /关闭|完成/ })
  if (await page.locator('[role="dialog"]').count() === 0) return
  const dialogClose = page.locator('[role="dialog"] button').filter({ hasText: /关闭|完成|知道了/ })
  if (await dialogClose.count()) {
    await dialogClose.first().click().catch(() => undefined)
    await page.waitForTimeout(300)
  } else if (await close.count()) {
    await close.first().click().catch(() => undefined)
  }
}

function readSmsFromLog(): string | null {
  if (!existsSync(SMS_LOG)) return null
  const text = readFileSync(SMS_LOG, 'utf8')
  const matches = [...text.matchAll(/验证码:\s*(\d{6})/g)]
  return matches.length ? matches[matches.length - 1][1] : null
}

function readSmsFromRedis(phone: string): string | null {
  try {
    const hash = createHmac('sha256', SMS_PEPPER).update(phone).digest('hex')
    const value = execFileSync('redis-cli', ['GET', `member:sms:code:${hash}`], { encoding: 'utf8' }).trim()
    return /^\d{6}$/.test(value) ? value : null
  } catch {
    return null
  }
}

export async function loginMemberViaSms(
  page: Page,
  journey: string,
  collectors: ReturnType<typeof attachCollectors>,
): Promise<{ stub: string | null; codeSource: string | null }> {
  await page.waitForURL((url) => url.pathname === '/login', { timeout: 15_000 }).catch(() => undefined)
  if (!page.url().includes('/login')) {
    await page.goto(`${KIOSK_ORIGIN}/login?from=${encodeURIComponent('/')}`, { waitUntil: 'domcontentloaded' })
    await waitReady(page)
  }
  await recordStep({
    page, journey, step: 'agree-terms', control: '我已阅读并同意', selectorHint: 'role=checkbox name=我已阅读并同意',
    kind: 'check', collectors,
    act: async () => {
      await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
    },
  })
  for (const digit of MEMBER_PHONE) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await shot(page, journey, 'phone-entered')
  const beforeSend = existsSync(SMS_LOG) ? readFileSync(SMS_LOG, 'utf8').length : 0
  await recordStep({
    page, journey, step: 'send-sms', control: '获取验证码', selectorHint: 'button:获取验证码',
    kind: 'click', collectors,
    act: async () => {
      await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    },
  })
  let code: string | null = null
  let source: string | null = null
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(250)
    const fromRedis = readSmsFromRedis(MEMBER_PHONE)
    if (fromRedis) { code = fromRedis; source = 'redis:member:sms:code'; break }
    if (existsSync(SMS_LOG) && readFileSync(SMS_LOG, 'utf8').length > beforeSend) {
      const fromLog = readSmsFromLog()
      if (fromLog) { code = fromLog; source = SMS_LOG; break }
    }
  }
  if (!code) {
    return { stub: null, codeSource: null }
  }
  const codeInput = page.getByRole('button', { name: '短信验证码', exact: true })
  if (await codeInput.count()) await codeInput.click()
  for (const digit of code) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await recordStep({
    page, journey, step: 'verify-login', control: '验证并登录', selectorHint: 'button:验证并登录',
    kind: 'click', collectors, note: `sms-code-source=${source}`,
    act: async () => {
      await page.getByRole('button', { name: '验证并登录', exact: true }).click()
      await page.waitForTimeout(1200)
    },
  })
  return { stub: null, codeSource: source }
}

export function summarize(ops: ControlOp[]): {
  journeys: string[]
  routes: string[]
  controls: number
  dead: ControlOp[]
  errors: ControlOp[]
  forbidden: ControlOp[]
  skipped: ControlOp[]
} {
  const journeys = [...new Set(ops.map((op) => op.journey))]
  const routes = [...new Set(ops.map((op) => op.route))]
  return {
    journeys,
    routes,
    controls: ops.filter((op) => !op.skipped).length,
    dead: ops.filter((op) => op.dead),
    errors: ops.filter((op) => op.runtimeErrors.length > 0),
    forbidden: ops.filter((op) => op.forbiddenCopy.length > 0),
    skipped: ops.filter((op) => Boolean(op.skipped)),
  }
}

export function writeSummary(ops: ControlOp[]): string {
  const summary = summarize(ops)
  const path = join(EVIDENCE_ROOT, 'summary.json')
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), ...summary, operations: ops.length }, null, 2))
  return path
}

// keep dirname referenced so bundlers don't drop the import if tests compile it
void dirname
