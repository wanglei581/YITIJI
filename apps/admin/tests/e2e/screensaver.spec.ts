import { expect, test } from '@playwright/test'
import { dwellLimitHint, screensaverUploadLimitText } from '../../src/routes/screensaver/assetUploadRules'
import { expectDialogAndDismiss } from './helpers/guards'
import { openAuthed, settleAdminPage } from './helpers/open'

test.describe('宣传屏（mock 口径）', () => {
  test('三个 Tab 可切换；删除素材有二次确认', async ({ page }) => {
    const guards = await openAuthed(page, '/screensaver')
    await settleAdminPage(page, guards)
    await expect(page.getByRole('heading', { name: '宣传屏' })).toBeVisible()
    await expect(page.getByText('状态获取失败')).toHaveCount(0)
    await expect(page.getByText(/AI 文生图海报：二期能力，暂未启用/)).toBeVisible()

    for (const tab of ['素材库', '播放方案', '终端配置']) {
      await page.getByRole('button', { name: tab }).click()
    }

    await page.getByRole('button', { name: '素材库' }).click()
    const remove = page.getByRole('button', { name: /删除/ }).first()
    if (await remove.isVisible()) {
      await expectDialogAndDismiss(page, () => remove.click(), /确认删除素材/)
    }
  })
})

const uploadCopy = [
  '不要上传：招聘简章；写了用人单位和岗位、人数、薪资、条件或报名方式的图片或视频；列出企业或岗位的招聘会海报；企业或商业招聘网站的二维码。',
  '可以上传：机构介绍和服务时间；就业政策和补贴宣传；不指向具体单位和岗位的讲座、培训通知；本机使用指引。',
  '拿不准的先不放：只写时间地点的招聘会预告；机构招聘自己工作人员的公告；人才引进政策里附带的岗位表。',
  '图片和视频里的招聘信息，同样算发布招聘信息。',
]
for (const mode of ['off', 'error', 'on']) {
  test(`上传提示：托管 ${mode}，原文与上传动作`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('mock:recruitment-hosting', value), mode)
    const guards = await openAuthed(page, '/screensaver')
    await settleAdminPage(page, guards)
    const notice = page.getByRole('note', { name: '上传前请先看' })
    // 等上传区挂载后再检查明确开启时提示消失，防止空页面假通过。
    await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
    if (mode === 'on') await expect(notice).toHaveCount(0)
    else {
      await expect(notice).toBeVisible()
      for (const copy of uploadCopy) await expect(notice.getByText(copy, { exact: true })).toBeVisible()
    }
    await expect(page.getByText(/待机宣传屏属线下一体机运营广告位/)).toBeVisible()
    await page.locator('input[type=file]').setInputFiles({ name: 'notice.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVwAAAABJRU5ErkJggg==', 'base64') })
    await page.getByPlaceholder('例：就业服务宣传海报').fill('上传提示测试')
    await expect(page.getByRole('button', { name: '上传', exact: true })).toBeEnabled()
  })
}

test('不合规文件和超长时长不能提交', async ({ page }) => {
  const uploads: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('ad-assets')) uploads.push(req.url())
  })
  const guards = await openAuthed(page, '/screensaver')
  await settleAdminPage(page, guards)
  await expect(page.getByRole('heading', { name: '上传素材' })).toBeVisible()
  await expect(page.getByText(screensaverUploadLimitText())).toBeVisible()
  await expect(page.getByText(dwellLimitHint('upload'))).toBeVisible()
  await expect(page.getByText(dwellLimitHint('external'))).toBeVisible()
  const help = page.getByText('只能填视频文件本身的网址', { exact: false })
  await expect(help).toBeVisible()
  await expect(help).not.toContainText('HTTPS')
  await expect(help).not.toContainText('iframe')
  await expect(help).not.toContainText('直链')
  await expect(page.getByRole('button', { name: '技术说明' })).toHaveAttribute('title', /HTTPS/)
  await expect(page.getByRole('button', { name: '技术说明' })).toHaveAttribute('title', /iframe/)
  await expect(page.getByRole('button', { name: '技术说明' })).toHaveAttribute('title', /直链/)

  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('这不是图片') })
  await expect(page.getByRole('alert')).toContainText('只能选择 JPG、PNG、WebP 图片，或 MP4、WebM 视频')
  await page.getByPlaceholder('例：就业服务宣传海报').fill('文本不应入库')
  await page.getByRole('button', { name: '上传', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('只能选择 JPG、PNG、WebP 图片，或 MP4、WebM 视频')
  await expect(page.getByText('文本不应入库')).toHaveCount(0)
  expect(uploads).toEqual([])

  await page.locator('input[type=file]').setInputFiles({ name: 'ok.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVwAAAABJRU5ErkJggg==', 'base64') })
  await page.getByPlaceholder('例：就业服务宣传海报').fill('超时长不应入库')
  await page.locator('input[type=number]').first().fill('1801')
  await page.getByRole('button', { name: '上传', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('1800')
  await expect(page.getByText('超时长不应入库')).toHaveCount(0)
  expect(uploads).toEqual([])

  await page.getByRole('button', { name: '终端配置' }).click()
  await expect(page.getByText(dwellLimitHint('idle'))).toBeVisible()
  await page.locator('input[type=number]').fill('1801')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('1800')
  await expect(page.getByText('已保存')).toHaveCount(0)
  expect(uploads).toEqual([])
})
