// A6：宣传屏 → 素材库上传一张测试图（页面内 canvas 生成「测试·屏保」PNG）→ 播放方案新建并加入 → 终端配置绑定 WALK-001。
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TITLE = '测试·屏保海报（走查）'
const PLAN = '测试·走查轮播方案'
const CODE = 'WALK-001'

export default async ({ page, h }) => {
  const png = join(h.evidDir, 'walk-screensaver-test.png')
  if (!existsSync(png)) {
    await h.goto('/')
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1920
      const g = c.getContext('2d')
      const grd = g.createLinearGradient(0, 0, 0, 1920); grd.addColorStop(0, '#0f766e'); grd.addColorStop(1, '#134e4a')
      g.fillStyle = grd; g.fillRect(0, 0, 1080, 1920)
      g.fillStyle = '#fff'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'
      g.fillText('测试·屏保', 540, 900); g.font = '48px sans-serif'; g.fillText('本地全功能走查用测试图', 540, 1020)
      return c.toDataURL('image/png')
    })
    writeFileSync(png, Buffer.from(dataUrl.split(',')[1], 'base64'))
  }

  await h.goto('/screensaver')
  let shot = await h.shot('screensaver-assets-before')
  await h.log({ action: '打开宣传屏 → 素材库', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 400), screenshot: shot })

  if ((await page.getByText(TITLE).count()) === 0) {
    await page.locator('input[type=file]').setInputFiles(png)
    const card = page.locator('h3:text("上传素材")').locator('xpath=..')
    await card.locator('input[type=text]').fill(TITLE)
    await card.locator('input[type=number]').fill('8')
    h.clearNet()
    await card.getByRole('button', { name: '上传' }).click()
    await h.settle(2000)
    shot = await h.shot('screensaver-uploaded')
    const err = await card.locator('p').allInnerTexts()
    await h.log({ action: '素材库 → 选择文件并上传', input: `walk-screensaver-test.png（1080×1920，页面 canvas 生成）；标题=${TITLE}；停留 8 秒`, result: `网络=${JSON.stringify(h.net().filter((n) => n.method !== 'GET'))}；提示=${err.join(' ') || '无'}；列表含该素材=${(await page.getByText(TITLE).count()) > 0}`, screenshot: shot })
  }

  // 播放方案
  await page.getByRole('button', { name: '播放方案', exact: true }).click()
  await h.settle(800)
  if ((await page.getByText(PLAN).count()) === 0) {
    await page.getByRole('button', { name: /新建方案/ }).click()
    await page.getByPlaceholder('例：大厅常规轮播').fill(PLAN)
    const addBtn = page.locator('li').filter({ hasText: TITLE }).getByRole('button', { name: '加入' })
    const canAdd = await addBtn.count()
    if (canAdd) await addBtn.click()
    shot = await h.shot('screensaver-plan-edit')
    h.clearNet()
    await page.getByRole('button', { name: '保存方案' }).click()
    await h.settle(1500)
    shot = await h.shot('screensaver-plan-saved')
    await h.log({ action: '播放方案 → 新建方案，加入素材，保存方案', input: `${PLAN}；素材=${TITLE}（可加入=${canAdd > 0}）`, result: `网络=${JSON.stringify(h.net().filter((n) => n.method !== 'GET'))}；页面：${(await h.text('main')).replace(/\s+/g, ' ').split('新建方案')[1]?.slice(0, 200) ?? ''}`, screenshot: shot })
  }

  // 终端配置
  await page.getByRole('button', { name: '终端配置', exact: true }).click()
  await h.settle(1000)
  const tcard = page.locator('div').filter({ has: page.getByText(CODE, { exact: true }) }).filter({ has: page.getByRole('button', { name: '保存' }) }).last()
  if ((await tcard.count()) === 0) {
    shot = await h.shot('screensaver-terminals')
    await h.log({ action: '终端配置 → 找 WALK-001', result: `未找到：${(await h.text('main')).replace(/\s+/g, ' ').slice(-300)}`, screenshot: shot })
    return
  }
  const opts = await tcard.locator('select option').allInnerTexts()
  await tcard.locator('select').selectOption({ label: opts.find((o) => o.startsWith(PLAN)) })
  const cb = tcard.locator('input[type=checkbox]')
  if (!(await cb.isChecked())) await cb.check()
  const timeout = await tcard.locator('input[type=number]').inputValue()
  h.clearNet()
  await tcard.getByRole('button', { name: '保存' }).click()
  await h.settle(1500)
  shot = await h.shot('screensaver-terminal-bound')
  await h.log({ action: '终端配置 → WALK-001 选播放方案、勾选启用待机宣传屏、保存', input: `方案=${PLAN}；无操作时长=${timeout} 秒（默认）`, result: `可选方案=${opts.join('、')}；卡片=${(await tcard.innerText()).replace(/\s+/g, ' ')}；网络=${JSON.stringify(h.net().filter((n) => n.method !== 'GET'))}`, screenshot: shot })
}
