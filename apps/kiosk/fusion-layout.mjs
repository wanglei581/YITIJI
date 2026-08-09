import { chromium } from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
for (const id of ['01', '03', '13', '14', '32', '48']) {
  await page.goto(`http://127.0.0.1:8933/index.html?screen=${id}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(200)
  const r = await page.evaluate(() => {
    const q = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }
    }
    return {
      actionbar: q('.screen-actionbar'),
      bottomnav: q('.kiosk-bottomnav'),
      screenBody: q('.screen-body'),
      main: q('.screen-main'),
    }
  })
  console.log(id, JSON.stringify(r))
}
await browser.close()
