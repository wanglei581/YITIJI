import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
const out = '/tmp/dir-captures'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const files = [
  ['d', 'direction-d-refined-home.html'],
]
for (const [key, file] of files) {
  await page.goto(`http://127.0.0.1:8935/docs/design/kiosk-visual-directions-2026-08/${file}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.locator('.kiosk').screenshot({ path: `${out}/${key}.png` })
}
await browser.close()
