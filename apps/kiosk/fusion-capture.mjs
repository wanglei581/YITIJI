import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const out = '/tmp/fusion-captures'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))

const screens = ['01', '02', '03', '04', '05', '07', '08', '09', '11', '13', '14', '15', '32', '37', '40', '48', '55', '61', '62', '77']
for (const id of screens) {
  await page.goto(`http://127.0.0.1:8933/index.html?screen=${id}&capture=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const stage = page.locator('#kiosk-stage')
  await stage.screenshot({ path: `${out}/screen-${id}.png` })
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('#kiosk-stage')
    return { scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight }
  })
  console.log(id, JSON.stringify(overflow))
}
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
