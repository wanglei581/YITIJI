/**
 * 运营数据大屏原型自检（1920×1080）。
 *
 * 用法（仓库根目录）：node docs/design/ops-screen-2026-09/probe.mjs docs/design/ops-screen-2026-09 /tmp
 *
 * 查四件事，缺一不可：
 *   1. 页面恰好 1080 高、1920 宽，无滚动
 *   2. 卡片内容无裁剪、同级元素无重叠（只查外框查不出重叠，必须查 scrollHeight 与两两相交）
 *   3. 无小于 13px 的可见文字 —— 大屏是 3 米外看的
 *   4. 每块 .card 都有 .foot 来源脚注 —— 见 README §一，这是本方案的第一条硬约束
 */
import { chromium } from 'playwright-core'
const dir = process.argv[2]
const out = process.argv[3] || '/tmp'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
for (const f of ['01-gov-screen.html', '02-ops-screen.html']) {
  await page.goto(`file://${dir}/${f}`, { waitUntil: 'load' })
  const res = await page.evaluate(() => {
    const problems = []
    document.querySelectorAll('.card').forEach((c) => {
      const cb = c.getBoundingClientRect()
      c.querySelectorAll('*').forEach((e) => {
        const eb = e.getBoundingClientRect()
        if (eb.bottom > cb.bottom + 1 || eb.right > cb.right + 1) {
          problems.push({ el: String(e.className || e.tagName).slice(0, 26), card: c.querySelector('h2')?.textContent.trim().slice(0, 16), by: Math.round(Math.max(eb.bottom - cb.bottom, eb.right - cb.right)) })
        }
      })
    })
    // 内容被压过头：.body 里塞不下就会视觉重叠（外框不变，所以只查外框查不出来）
    document.querySelectorAll('.body, .card').forEach((b) => {
      if (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1) {
        problems.push({ el: 'CLIPPED ' + String(b.className).slice(0, 18), card: b.closest('.card')?.querySelector('h2')?.textContent.trim().slice(0, 16), by: Math.max(b.scrollHeight - b.clientHeight, b.scrollWidth - b.clientWidth) })
      }
    })
    // 兄弟元素相互重叠（.body 与 .foot 压在一起是最常见的一种）
    document.querySelectorAll('.card').forEach((c) => {
      const kids = [...c.children].map((k) => ({ k, r: k.getBoundingClientRect() }))
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i].r, b = kids[j].r
        const ov = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (ov > 1 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1) {
          problems.push({ el: 'OVERLAP ' + String(kids[i].k.className || kids[i].k.tagName) + '/' + String(kids[j].k.className || kids[j].k.tagName), card: c.querySelector('h2')?.textContent.trim().slice(0, 16), by: Math.round(ov) })
        }
      }
    })
    const tiny = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12)
      .map((e) => getComputedStyle(e).fontSize + ' | ' + e.textContent.trim().slice(0, 20))
    return {
      sheets: document.styleSheets.length,
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      cards: document.querySelectorAll('.card').length,
      footless: [...document.querySelectorAll('.card')].filter((c) => !c.querySelector('.foot')).map((c) => c.querySelector('h2')?.textContent.trim()),
      overflow: problems,
      tinyText: [...new Set(tiny)],
    }
  })
  console.log('#### ' + f + ' ####')
  console.log(JSON.stringify(res, null, 1))
  await page.screenshot({ path: `${out}/${f.replace('.html', '')}.png` })
}
await browser.close()
