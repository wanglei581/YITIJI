import { expect, type Page } from '@playwright/test'
import { injectAdminAuth } from './auth'
import {
  assertNoRuntimeFailures,
  assertNoTechLeak,
  attachPageGuards,
  collectUnhandledRejections,
  type PageGuards,
  waitForAdminHeading,
} from './guards'

export async function openAuthed(page: Page, path: string): Promise<PageGuards> {
  const guards = attachPageGuards(page)
  await injectAdminAuth(page)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('正在验证身份…')).toHaveCount(0, { timeout: 10_000 })
  return guards
}

export async function openAnonymous(page: Page, path: string): Promise<PageGuards> {
  const guards = attachPageGuards(page)
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  return guards
}

export async function settleAdminPage(page: Page, guards: PageGuards): Promise<void> {
  await waitForAdminHeading(page)
  await collectUnhandledRejections(page, guards)
  assertNoRuntimeFailures(guards)
  await assertNoTechLeak(page)
}
