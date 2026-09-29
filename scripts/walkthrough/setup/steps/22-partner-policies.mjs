// B10 / B12：政策公告 → 新增政策内容 → 提交审核 → 审核通过 → 发布（勾选对内容负责 → 确认发布）。
// 用法：WALK_POLICY_SET=A|B node run.mjs steps/22-partner-policies.mjs partner|partnerB
const SETS = {
  A: {
    domain: 'example.com',
    items: [
      { title: '测试·灵活就业社保补贴申领指引（走查）', audience: '灵活就业人员', publish: true },
      { title: '测试·高校毕业生求职创业补贴（走查）', audience: '应届高校毕业生', publish: true },
      { title: '测试·零工市场技能培训补贴（走查）', audience: '通用', publish: false },
    ],
  },
  B: {
    domain: 'example.org',
    items: [{ title: '测试·高校毕业生就业见习补贴（走查·机构B）', audience: '应届高校毕业生', publish: true }],
  },
}
const SET = SETS[process.env.WALK_POLICY_SET ?? 'A']

function body(title) {
  return [
    `【测试数据，本地走查用】${title}`,
    '',
    '一、政策说明：测试·本条仅用于验证机构自审发布与一体机展示链路，不是真实政策。',
    '二、材料清单：',
    '1. 测试·身份证复印件 1 份',
    '2. 测试·申请表 1 份（现场领取）',
    '3. 测试·银行卡复印件 1 份',
    '三、办理指引：请到来源链接查看测试说明。',
  ].join('\n')
}

export default async ({ page, h }) => {
  await h.goto('/policy')
  await h.settle(1200)
  let shot = await h.shot(`partner-policy-before-${h.side}`)
  const newBtn = page.getByRole('button', { name: '新增政策内容' })
  await h.log({ action: '打开政策公告', result: `新增按钮可用=${!(await newBtn.isDisabled())}（提示=${await newBtn.getAttribute('title')}）；${(await h.text('main')).replace(/\s+/g, ' ').slice(0, 400)}`, screenshot: shot })
  if (await newBtn.isDisabled()) return

  for (const [i, p] of SET.items.entries()) {
    if ((await page.locator('tr').filter({ hasText: p.title }).count()) === 0) {
      await newBtn.click()
      const drawer = page.locator('[role=dialog]').filter({ hasText: '新增政策内容' }).last()
      await drawer.waitFor()
      const f = (label) => drawer.locator('label').filter({ hasText: label }).first()
      const kinds = await f('内容类型').locator('option').allInnerTexts()
      await f('内容类型').locator('select').selectOption('policy_guide')
      await f('标题').locator('input').fill(p.title)
      await f('适用人群').locator('select').selectOption({ label: p.audience })
      await f('摘要').locator('textarea').fill(`测试·${p.title.replace(/^测试·/, '')}的摘要：材料 3 项，本地走查用。`)
      await f('正文').locator('textarea').fill(body(p.title))
      const src = f('政策来源')
      if (await src.count()) await src.locator('input').fill(`https://${SET.domain}/walk-policy-${i + 1}`)
      const labels = await drawer.locator('label').allInnerTexts()
      shot = await h.shot(`partner-policy-form-${h.side}-${i + 1}`)
      h.clearNet()
      await drawer.getByRole('button', { name: '提交审核' }).click()
      await h.settle(1500)
      const open = await drawer.isVisible().catch(() => false)
      const err = open ? (await drawer.innerText()).replace(/\s+/g, ' ').slice(-250) : ''
      shot = await h.shot(`partner-policy-submitted-${h.side}-${i + 1}`)
      const post = h.net().find((n) => n.method === 'POST')
      await h.log({ action: '新增政策内容 → 提交审核', input: `${p.title}｜类型=政策扶持条目｜人群=${p.audience}｜来源=https://${SET.domain}/walk-policy-${i + 1}｜正文含 3 项材料清单`, result: `${open ? '失败：' + err : '成功'}；表单字段=${labels.map((l) => l.split('\n')[0]).join('/')}；内容类型可选=${kinds.join('、')}；请求=${post ? post.url + ' ' + post.status : '无'}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
      if (open) { await drawer.getByRole('button', { name: '取消' }).click().catch(() => {}); continue }
    }
    const row = () => page.locator('tr').filter({ hasText: p.title }).first()
    if (!p.publish) {
      await h.log({ action: '政策 → 保留在待审核、不发布（对照用）', input: p.title, result: `行=${(await row().innerText()).replace(/\s+/g, ' ')}` })
      continue
    }
    // 自审
    if (await row().getByRole('button', { name: '审核通过' }).count()) {
      h.clearNet()
      await row().getByRole('button', { name: '审核通过' }).click()
      await h.settle(1200)
      shot = await h.shot(`partner-policy-approved-${h.side}-${i + 1}`)
      await h.log({ action: '政策 → 审核通过（本机构自审）', input: p.title, result: `行=${(await row().innerText()).replace(/\s+/g, ' ')}；提示=${(await h.text('main')).match(/「[^」]*」已审核通过[^。]*。[^。]*。?/)?.[0] ?? '无'}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
    }
    if (await row().getByRole('button', { name: '发布', exact: true }).count()) {
      await row().getByRole('button', { name: '发布', exact: true }).click()
      const dlg = page.locator('[role=dialog][aria-labelledby="policy-release-title"]')
      await dlg.waitFor()
      const confirmDisabled = await dlg.getByRole('button', { name: '确认发布' }).isDisabled()
      await dlg.locator('input[type=checkbox]').check()
      shot = await h.shot(`partner-policy-release-dialog-${h.side}-${i + 1}`)
      await h.log({ action: '政策 → 发布 → 弹出发布责任确认', input: p.title, result: `未勾选时「确认发布」禁用=${confirmDisabled}；弹窗=${(await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 400)}`, screenshot: shot })
      h.clearNet()
      await dlg.getByRole('button', { name: '确认发布' }).click()
      await h.settle(1500)
      const open = await dlg.isVisible().catch(() => false)
      shot = await h.shot(`partner-policy-released-${h.side}-${i + 1}`)
      await h.log({ action: '勾选「对内容负责」→ 确认发布', input: p.title, result: `${open ? '失败：' + (await dlg.innerText()).replace(/\s+/g, ' ').slice(-200) : '成功'}；行=${(await row().innerText()).replace(/\s+/g, ' ')}；网络错误=${JSON.stringify(h.netErrors())}`, screenshot: shot })
    }
  }
  await h.goto('/policy')
  await h.settle(1000)
  shot = await h.shot(`partner-policy-list-${h.side}`)
  await h.log({ action: '政策公告列表（最终）', result: (await h.text('main')).replace(/\s+/g, ' ').slice(0, 1200), screenshot: shot })
}
