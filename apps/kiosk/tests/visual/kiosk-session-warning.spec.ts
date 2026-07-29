import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { expect, test } from '../fixtures/kiosk-test'

const SENSITIVE_SESSION_KEY = 'ai-job-print:current-ai-resume'

interface KioskShellOptions {
  screensaverEnabled?: boolean
  idleTimeoutSec?: number
}

function registerKioskShell(api: ApiRouter, options: KioskShellOptions = {}): void {
  const enabled = options.screensaverEnabled ?? false
  const idleTimeoutSec = options.idleTimeoutSec ?? 4

  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: {
      enabled,
      idleTimeoutSec,
      items: enabled
        ? [
            {
              id: 'warning-screensaver',
              type: 'image',
              url: 'https://warning.invalid/screensaver.png',
              mimeType: 'image/png',
              durationSec: 30,
              sha256: 'warning-screen-fixture',
            },
          ]
        : [],
    },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: {
      smartCampus: { enabled: false, modules: {}, items: [] },
      toolbox: { enabled: false, items: [] },
      configVersion: 'warning-browser-fixture',
      refreshIntervalMs: 300_000,
      serverTime: '2026-07-29T00:00:00.000Z',
    },
  })
}

async function expectWarningWithinThreeSeconds(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/session-timeout$/, { timeout: 3_000 })
  await expect(page.getByRole('heading', { name: '还在使用吗？', exact: true })).toBeVisible()
}

test('ordinary idle warns before clearing and can resume the previous route', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)

  await expectWarningWithinThreeSeconds(page)
  await page.getByRole('button', { name: '继续使用', exact: true }).click()

  await expect(page).toHaveURL(/\/interview\/tips$/)
})

test('warning expiry clears sensitive session state and returns home', async ({ page, api }) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await page.evaluate(({ key, value }) => window.sessionStorage.setItem(key, value), {
    key: SENSITIVE_SESSION_KEY,
    value: 'sensitive',
  })

  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL('http://127.0.0.1:4188/', { timeout: 3_500 })
  await expect
    .poll(() => page.evaluate((key) => window.sessionStorage.getItem(key), SENSITIVE_SESSION_KEY))
    .toBeNull()
})

test('screensaver idle warns before expiry and wakes to a clean homepage', async ({
  page,
  api,
}) => {
  registerKioskShell(api, { screensaverEnabled: true, idleTimeoutSec: 4 })
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)

  await expectWarningWithinThreeSeconds(page)
  await expect(page).toHaveURL(/\/screensaver$/, { timeout: 3_500 })
  await expect(page.locator('[data-kiosk-screen="screensaver"]')).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL('http://127.0.0.1:4188/')
})

test('session warning actions remain touch-safe without horizontal overflow', async ({
  page,
  api,
}) => {
  registerKioskShell(api)
  await page.goto('/interview/tips')
  await expect(page).toHaveURL(/\/interview\/tips$/)

  await expectWarningWithinThreeSeconds(page)

  const continueButton = page.getByRole('button', { name: '继续使用', exact: true })
  const exitButton = page.getByRole('button', { name: '立即退出并清除本机会话', exact: true })
  await expect(continueButton).toBeVisible()
  await expect(exitButton).toBeVisible()

  expect(
    await continueButton.evaluate((element) => element.getBoundingClientRect().height)
  ).toBeGreaterThanOrEqual(72)
  expect(
    await exitButton.evaluate((element) => element.getBoundingClientRect().height)
  ).toBeGreaterThanOrEqual(72)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  )
})
