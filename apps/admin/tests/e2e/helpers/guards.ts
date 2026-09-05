import { expect, type Locator, type Page } from '@playwright/test'

const TECH_LEAK = /\bTypeError\b|\bundefined\b|\[object Object\]|Failed to fetch|Cannot read/

const BENIGN_CONSOLE = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  /Failed to load resource: the server responded with a status of 4\d\d/i,
]

export interface PageGuards {
  consoleErrors: string[]
  pageErrors: string[]
  rejections: string[]
}

export function attachPageGuards(page: Page): PageGuards {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const rejections: string[] = []

  page.on('pageerror', (error) => {
    pageErrors.push(error.message)
  })
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (BENIGN_CONSOLE.some((pattern) => pattern.test(text))) return
    consoleErrors.push(text)
  })
  page.addInitScript(() => {
    window.addEventListener('unhandledrejection', (event) => {
      const bag = window as unknown as { __e2eRejections?: string[] }
      bag.__e2eRejections = bag.__e2eRejections ?? []
      const reason = event.reason as { message?: string } | string | undefined
      bag.__e2eRejections.push(typeof reason === 'string' ? reason : String(reason?.message ?? reason ?? 'unhandledrejection'))
    })
  })

  return { consoleErrors, pageErrors, rejections }
}

export async function collectUnhandledRejections(page: Page, guards: PageGuards): Promise<void> {
  const extra = await page.evaluate(() => {
    const bag = window as unknown as { __e2eRejections?: string[] }
    return bag.__e2eRejections ?? []
  })
  guards.rejections.push(...extra)
}

export function assertNoRuntimeFailures(guards: PageGuards): void {
  expect(guards.pageErrors, `uncaught pageerror: ${guards.pageErrors.join(' | ')}`).toEqual([])
  expect(guards.rejections, `unhandledrejection: ${guards.rejections.join(' | ')}`).toEqual([])
  expect(guards.consoleErrors, `console error: ${guards.consoleErrors.join(' | ')}`).toEqual([])
}

export async function assertNoTechLeak(page: Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text, '页面出现英文技术串').not.toMatch(TECH_LEAK)
}

export function mainPane(page: Page): Locator {
  return page.locator('main.ui-admin-content, main.clogin, main').first()
}

export async function waitForAdminHeading(page: Page): Promise<Locator> {
  const heading = page.locator('h1').first()
  await expect(heading).toBeVisible({ timeout: 15_000 })
  await expect(heading).not.toHaveText(/^\s*$/)
  return heading
}

export async function expectChineseFeedback(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  const text = (await locator.innerText()).trim()
  expect(text.length).toBeGreaterThan(0)
  expect(text).toMatch(/[\u4e00-\u9fff]/)
  expect(text).not.toMatch(TECH_LEAK)
}

export async function expectDialogAndDismiss(page: Page, trigger: () => Promise<void>, pattern: RegExp): Promise<string> {
  const held: { message?: string } = {}
  page.once('dialog', (dialog) => {
    held.message = dialog.message()
    void dialog.dismiss()
  })
  await trigger()
  expect(held.message, '未出现浏览器确认框').toBeTruthy()
  expect(held.message).toMatch(pattern)
  return held.message as string
}

export async function expectDialogAndAccept(page: Page, trigger: () => Promise<void>, pattern: RegExp): Promise<string> {
  const held: { message?: string } = {}
  page.once('dialog', (dialog) => {
    held.message = dialog.message()
    void dialog.accept()
  })
  await trigger()
  expect(held.message, '未出现浏览器确认框').toBeTruthy()
  expect(held.message).toMatch(pattern)
  return held.message as string
}
