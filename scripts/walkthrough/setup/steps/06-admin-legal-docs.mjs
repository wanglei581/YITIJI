// A4：法务文档 → 新增版本（用户服务协议 / 隐私政策 / AI 服务说明）→ 列表点「激活」。经营者信息不激活。
const DOCS = [
  { type: 'terms_of_service', version: 'walk-v1', title: '用户服务协议（走查测试版）', content: '# 用户服务协议（走查测试版）\n\n本文为本地全功能走查使用的测试文本，不是正式协议。\n\n1. 测试·服务内容：AI 简历、打印扫描等。\n2. 测试·用户义务：如实提供信息。\n' },
  { type: 'privacy_policy', version: 'walk-v1', title: '隐私政策（走查测试版）', content: '# 隐私政策（走查测试版）\n\n本文为本地全功能走查使用的测试文本，不是正式隐私政策。\n\n- 测试·收集的信息：手机号、上传的文件。\n- 测试·保存期限：按系统自动清理策略。\n' },
  { type: 'ai_disclaimer', version: 'walk-v1', title: 'AI 服务说明（走查测试版）', content: '# AI 服务说明（走查测试版）\n\n本文为本地全功能走查使用的测试文本。AI 生成内容仅供参考，请本人核对后使用。\n' },
]

export default async ({ page, h }) => {
  page.on('dialog', async (d) => { await h.log({ action: '浏览器确认框', result: d.message().replace(/\s+/g, ' ') }); await d.accept() })
  await h.goto('/legal-docs')
  let shot = await h.shot('legal-docs-before')
  await h.log({ action: '打开法务文档版本', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 300), screenshot: shot })

  for (const d of DOCS) {
    const existing = page.locator('tr').filter({ hasText: d.title })
    if ((await existing.count()) === 0) {
      await page.getByRole('button', { name: '新增版本' }).click()
      const dlg = page.locator('[aria-label="新增法务文档版本"]')
      await dlg.waitFor()
      const typeOpts = await dlg.locator('#docType option').allInnerTexts()
      await dlg.locator('#docType').selectOption(d.type)
      await dlg.locator('#version').fill(d.version)
      await dlg.locator('#title').fill(d.title)
      await dlg.locator('#content').fill(d.content)
      shot = await h.shot(`legal-create-${d.type}`)
      h.clearNet()
      await dlg.getByRole('button', { name: '创建草稿' }).click()
      await h.settle(1200)
      const errTxt = (await dlg.isVisible().catch(() => false)) ? (await dlg.innerText()).replace(/\s+/g, ' ').slice(-200) : ''
      await h.log({ action: `新增法务文档版本：${d.type}`, input: `${d.title} / ${d.version}`, result: `文档类型下拉=${typeOpts.join('、')}；${errTxt ? '弹窗未关：' + errTxt : '创建草稿成功'}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
    }
    const row = page.locator('tr').filter({ hasText: d.title }).first()
    const act = row.getByRole('button', { name: '激活' })
    if (await act.count()) {
      h.clearNet()
      await act.click()
      await h.settle(1200)
      shot = await h.shot(`legal-activated-${d.type}`)
      await h.log({ action: `激活 ${d.type}`, input: d.title, result: `${(await row.innerText()).replace(/\s+/g, ' ')}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
    }
  }
  await h.goto('/legal-docs')
  shot = await h.shot('legal-docs-after')
  await h.log({ action: '法务文档列表（激活后）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 600), screenshot: shot })
}
