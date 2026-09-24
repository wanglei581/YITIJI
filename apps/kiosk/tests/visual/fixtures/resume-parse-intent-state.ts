import type { Page } from '@playwright/test'

const KEY = 'ai-job-print:kiosk-resume-parse-intent'

interface StoredIntent {
  intent: string
  payload: { fileId: string }
}

export async function readResumeParseIntents(page: Page): Promise<StoredIntent[]> {
  return page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as StoredIntent[] : []
  }, KEY)
}

export async function clearResumeParseIntents(page: Page): Promise<void> {
  await page.evaluate((key) => window.sessionStorage.removeItem(key), KEY)
}

export async function changeStoredResumeFileId(page: Page, fileId: string): Promise<void> {
  await page.evaluate(({ key, nextFileId }) => {
    const rows = JSON.parse(window.sessionStorage.getItem(key) || '[]') as StoredIntent[]
    if (!rows[0]) throw new Error('Expected one stored resume parse intent')
    rows[0].payload.fileId = nextFileId
    window.sessionStorage.setItem(key, JSON.stringify(rows))
  }, { key: KEY, nextFileId: fileId })
}
