import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
page.on('pageerror', (err) => errors.push(String(err)))

// 收集全部屏 id
await page.goto('http://127.0.0.1:8933/index.html?screen=01', { waitUntil: 'networkidle' })
const ids = await page.evaluate(() => window.KioskPrototype.screens.map(s => s.id))

let fail = 0
for (const id of ids) {
  for (const state of ['default', 'loading', 'empty', 'error']) {
    await page.goto(`http://127.0.0.1:8933/index.html?screen=${id}&state=${state}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(120)
    const r = await page.evaluate(() => {
      const el = document.querySelector('#kiosk-stage')
      if (!el) return { missing: true }
      const main = el.querySelector('.screen-main')
      return {
        w: el.scrollWidth === el.clientWidth,
        h: el.scrollHeight === el.clientHeight,
        hasMain: !!main,
        mainVisible: main ? main.clientHeight > 0 : false,
      }
    })
    if (!r.w || !r.h || !r.hasMain || !r.mainVisible) {
      fail++
      console.log('FAIL', id, state, JSON.stringify(r))
    }
  }
}
console.log('total screens:', ids.length, 'failures:', fail)
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await browser.close()
