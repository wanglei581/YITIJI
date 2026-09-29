// A5：AI 服务管理（4 个开关只看不改）+ AI 大模型配置（简历诊断槽位填 DeepSeek / 回环地址，点保存与保存并测试连通）。
export default async ({ page, h }) => {
  page.on('dialog', async (d) => { await h.log({ action: '浏览器确认框', result: d.message().replace(/\s+/g, ' ') }); await d.accept() })

  // —— AI 服务管理 / 4 个开关 ——
  await h.goto('/ai-services')
  await h.settle(1200)
  let shot = await h.shot('ai-services')
  const sw = page.locator('section[aria-labelledby="ai-access-title"]')
  const swText = (await sw.innerText().catch(() => '（未找到开关面板）')).replace(/\s+/g, ' ')
  await h.log({ action: '打开 AI 服务管理，查看 4 个开关（不改动）', result: swText.slice(0, 900), screenshot: shot })
  await h.log({ action: 'AI 服务管理页正文', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 1200) })

  // —— AI 大模型配置 ——
  await h.goto('/ai-config')
  await h.settle(1200)
  shot = await h.shot('ai-config-list')
  const cards = await page.locator('main button.rounded-lg.border.p-3').allInnerTexts()
  await h.log({ action: '打开 AI 大模型配置，查看功能槽位', result: `共 ${cards.length} 个槽位：` + cards.map((c) => c.replace(/\s+/g, ' ').slice(0, 90)).join(' ｜ '), screenshot: shot })

  for (let i = 0; i < 3; i++) {
    await page.locator('main button.rounded-lg.border.p-3').filter({ hasText: '简历诊断' }).first().click()
    await h.settle(600)
    if ((await page.getByText(/当前功能模型/).first().innerText()).includes('简历诊断')) break
  }
  const current = await page.getByText(/当前功能模型/).first().innerText()
  if (!current.includes('简历诊断')) throw new Error('未能选中简历诊断槽位：' + current)
  await page.getByRole('button', { name: 'DeepSeek 深度求索', exact: true }).click()
  if (!(await page.getByText(/当前功能模型/).first().innerText()).includes('简历诊断')) throw new Error('选厂商后槽位被切走')
  const modelInput = page.locator('input[list="model-options"]')
  await modelInput.fill('deepseek-chat')
  await page.locator('input[type=password]').first().fill('walk-fake-key')
  const baseInput = page.locator('label:text("API 地址（baseURL）") + input')
  await baseInput.fill('http://127.0.0.1:4340/v1')
  shot = await h.shot('ai-config-filled')
  await h.log({ action: '简历诊断槽位：选 DeepSeek，填模型/Key/baseURL', input: 'vendor=DeepSeek model=deepseek-chat key=walk-fake-key baseURL=http://127.0.0.1:4340/v1', result: '已填写；' + current, screenshot: shot })

  h.clearNet()
  await page.getByRole('button', { name: '保存配置' }).click()
  await h.settle(1500)
  shot = await h.shot('ai-config-save-result')
  const errLine = await page.locator('main p.text-error-fg, main .text-error-fg').allInnerTexts().catch(() => [])
  await h.log({ action: '点击「保存配置」', result: `页面提示=${errLine.join(' / ') || '（无错误文字）'}；已保存标记=${await page.getByText('✓ 已保存').count()}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })

  h.clearNet()
  await page.getByRole('button', { name: '保存并测试连通' }).click()
  await h.settle(2500)
  shot = await h.shot('ai-config-test-result')
  const card = await page.locator('main').getByText(/连通失败|连通正常/).first().locator('xpath=..').innerText().catch(() => '')
  await h.log({ action: '点击「保存并测试连通」', result: `结果卡=${card.replace(/\s+/g, ' ') || '（无）'}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
}
