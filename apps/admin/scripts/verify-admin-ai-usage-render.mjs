import assert from 'node:assert/strict'

export async function verifyUsageRender({ check, mountPanel, textOf, find, buttons, tabs, act, SAMPLE, legacySample, loadAdapter, reply, ApiHttpError, deferred, byId, EXHAUSTED_GLOBAL }) {
await check('D1 演示模式：诚实空态，不出现任何数字，也不发请求', async () => {
  const panel = mountPanel({ demo: true })
  const tree = await panel.view.settle()
  assert.match(textOf(tree), /演示模式不连接真实用量数据/)
  assert.doesNotMatch(textOf(tree), /\d/, '演示模式不能出现任何数字（不造演示数据）')
  assert.equal(panel.calls.length, 0)
  assert.equal(byId(tree, 'ai-usage-day'), undefined, '演示模式不渲染日期选择')
})

await check('D2 读取中不出数字；读完只显示服务端给的数', async () => {
  const pending = deferred()
  const panel = mountPanel({ get: () => pending.promise })
  let tree = panel.view.render()
  assert.match(textOf(tree), /正在读取/)
  assert.doesNotMatch(textOf(tree), /已计费金额/)
  pending.resolve(SAMPLE())
  tree = await panel.view.settle()
  assert.match(textOf(tree), /1\.10 元 \/ 100\.00 元/, '已计费金额 / 全局上限要用服务端数字')
  assert.match(textOf(tree), /4 次/)
  assert.match(textOf(tree), /未计量/, '要有一句话解释未计量')
  assert.match(textOf(tree), /0\.05 元\/次/, '解释里要带服务端的保守单价')
  assert.match(textOf(tree), /2 人/)
})

await check('D3 查看北京时间今天且触顶：全局醒目标红并照服务端原话写后果；终端与会员只给终端号和人数', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-29'
  summary.reached = { global: true, terminalIds: ['kiosk-01', 'kiosk-02'], memberCount: 3 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const tree = await panel.view.settle()
  const alert = find(tree, (node) => node.props.role === 'alert').map((node) => textOf(node.children)).join('\n')
  assert.match(alert, /全站当日 AI 额度已用完/)
  assert.ok(alert.includes(EXHAUSTED_GLOBAL), `后果必须引用服务端原话「${EXHAUSTED_GLOBAL}」`)
  assert.match(alert, /这台机器今天的 AI 服务额度已用完/, '单终端触顶要引用终端档原话')
  assert.match(alert, /你今天的 AI 服务额度已用完/, '会员触顶要引用会员档原话')
  assert.match(alert, /终端（尾号 osk-01）、终端（尾号 osk-02）/, '两台终端必须显示各自的末 6 位')
  assert.doesNotMatch(alert, /kiosk-0[12]/, '终端 ID 不在正文展示')
  for (const id of ['kiosk-01', 'kiosk-02']) assert.ok(find(tree, (node) => node.props.title === id).length > 0, `触顶终端 ${id} 必须保留悬停原值`)
  assert.match(alert, /3 人/, '已到会员上限的只给人数')
  assert.doesNotMatch(alert, /会员号|endUser|user-/, '告警里不能出现会员标识')
  assert.match(textOf(tree), /今日已计费金额/)
})

await check('D3b 历史日期触顶：列出终端与人数，但不把「现在就会拒绝新请求」说成正在发生', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-28'
  summary.reached = { global: true, terminalIds: ['kiosk-01'], memberCount: 2 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const tree = await panel.view.settle()
  const text = textOf(tree)
  assert.match(text, /历史日期 2026-09-28/)
  assert.match(text, /不会据此拒绝现在的新请求/)
  assert.doesNotMatch(text, /新的 AI 生成与语音请求会被拒绝/, '历史日期的账不能写成闸门正在拒绝新请求')
  assert.match(text, /终端（尾号 osk-01）/)
  assert.ok(find(await panel.view.settle(), (node) => node.props.title === 'kiosk-01').length > 0, '历史触顶终端在悬停保留 ID')
  assert.match(text, /2 人/)
  assert.doesNotMatch(text, /均未触顶/)
  assert.match(text, /2026-09-28 已计费金额/)
})

await check('D3c 今天只触到单终端：不能写成三档都没满', async () => {
  const summary = SAMPLE()
  summary.day = '2026-09-29'
  summary.reached = { global: false, terminalIds: ['kiosk-01'], memberCount: 0 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const text = textOf(await panel.view.settle())
  assert.match(text, /全站当日额度未用完/)
  assert.doesNotMatch(text, /均未触顶/)
  assert.match(text, /这台机器今天的 AI 服务额度已用完/)
  assert.doesNotMatch(text, /你今天的 AI 服务额度已用完/)
})

await check('D4 四个页签：功能 / 供应商给中文名，终端 / 机构的 null key 给「无已验签终端 / 无机构」', async () => {
  const sample = SAMPLE()
  sample.byTerminal.push({ ...sample.byTerminal[1], key: 'kiosk-02' })
  sample.byOrg.push({ ...sample.byOrg[0], key: 'org-primary-123456' })
  const panel = mountPanel({ get: () => Promise.resolve(sample) })
  let tree = await panel.view.settle()
  assert.match(textOf(tree), /AI简历优化/, '功能页签要显示中文名')
  assert.match(textOf(tree), /已计费金额（计入额度）/)
  act.click(tabs(tree, '按供应商')[0])
  tree = panel.view.render()
  assert.match(textOf(tree), /DeepSeek/)
  act.click(tabs(tree, '按终端')[0])
  tree = panel.view.render()
  assert.match(textOf(tree), /无已验签终端/)
  assert.match(textOf(tree), /终端（尾号 osk-01）/)
  for (const id of ['kiosk-01', 'kiosk-02']) {
    const cells = find(tree, (node) => node.props.title === id)
    assert.ok(cells.some((node) => textOf(node.children) === `终端（尾号 ${id.slice(-6)}）`), `按终端列表 ${id} 的真实尾号及完整 title 必须同在一格`)
  }
  assert.doesNotMatch(textOf(tree), /kiosk-01/)
  act.click(tabs(tree, '按机构')[0])
  tree = panel.view.render()
  assert.match(textOf(tree), /无机构/)
  assert.ok(find(tree, (node) => node.props.title === 'org-primary-123456').some((node) => textOf(node.children) === '机构（尾号 123456）'))
})

await check('D5 当天 0 调用：如实显示 0，不装作没查到', async () => {
  const summary = SAMPLE()
  summary.totals = { key: null, calls: 0, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0, memberCount: 0 }
  summary.byFeature = []
  summary.byVendor = []
  summary.byTerminal = []
  summary.byOrg = []
  summary.reached = { global: false, terminalIds: [], memberCount: 0 }
  const panel = mountPanel({ get: () => Promise.resolve(summary) })
  const tree = await panel.view.settle()
  assert.match(textOf(tree), /当天 0 次 AI 调用/)
  assert.match(textOf(tree), /当日该维度没有调用记录/)
  assert.match(textOf(tree), /0\.00 元 \/ 100\.00 元/)
})

await check('D6 失败可重试：只显示服务端中文说明，不显示错误码，重试后恢复', async () => {
  let attempt = 0
  const panel = mountPanel({
    get: () => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new ApiHttpError('AI_USAGE_DAY_INVALID', '日期格式应为 YYYY-MM-DD', 400))
        : Promise.resolve(SAMPLE())
    },
  })
  let tree = await panel.view.settle()
  assert.match(textOf(tree), /AI 用量读取失败：日期格式应为 YYYY-MM-DD/)
  assert.doesNotMatch(textOf(tree), /AI_USAGE_DAY_INVALID/, '失败说明不能把英文错误码给运营看')
  act.click(buttons(tree, '重试')[0])
  panel.view.render() // 点击只改状态，要再渲染一次 effect 才会发出第二次请求
  assert.equal(panel.calls.length, 2)
  tree = await panel.view.settle()
  assert.match(textOf(tree), /已计费金额/)
})

await check('D7 403：写明只有管理员可以查看', async () => {
  const panel = mountPanel({ get: () => Promise.reject(new ApiHttpError('AUTH_ROLE_FORBIDDEN', '当前角色无权访问 (需要: admin)', 403)) })
  const tree = await panel.view.settle()
  assert.match(textOf(tree), /只有管理员可以查看 AI 用量与额度/)
})

await check('D8 日期：未来日期不采纳也不重取；换成过去某天按该日重取', async () => {
  const panel = mountPanel({})
  let tree = await panel.view.settle()
  assert.equal(panel.calls.length, 1)
  assert.equal(panel.calls[0], '2026-09-29', '默认查北京时间今天')
  assert.match(textOf(tree), /年-月-日/, '英文区域浏览器也给明确的输入格式')
  assert.ok(find(tree, (node) => node.props.lang === 'zh-CN').length > 0, '日期表单使用中文语言')
  // 未来日期（今天 2026-09-29）：不采纳
  byId(tree, 'ai-usage-day').props.onChange({ target: { value: '2026-09-30' } })
  tree = panel.view.render()
  assert.equal(panel.calls.length, 1, '未来日期不能触发重取')
  assert.equal(byId(tree, 'ai-usage-day').props.value, '2026-09-29', '未来日期不能被采纳')
  // 昨天：按该日重取
  byId(tree, 'ai-usage-day').props.onChange({ target: { value: '2026-09-28' } })
  await panel.view.settle()
  assert.equal(panel.calls.length, 2)
  assert.equal(panel.calls[1], '2026-09-28')
})

await check('D9 真适配与渲染：编号 / 机构名、null 和旧字段缺失均可显示；触顶编号同序，完整 ID 留在悬停', async () => {
  for (const mode of ['named', 'null', 'legacy']) {
    const sample = mode === 'legacy' ? legacySample() : SAMPLE()
    sample.day = '2026-09-29'
    sample.byOrg.push({ ...sample.byOrg[0], key: 'org-primary-123456' })
    sample.reached.terminalIds = ['kiosk-02', 'kiosk-01']
    if (mode !== 'legacy') {
      sample.reached.terminals = [
        { terminalId: 'kiosk-02', terminalCode: mode === 'named' ? 'KSK-002' : null },
        { terminalId: 'kiosk-01', terminalCode: null },
      ]
    }
    if (mode === 'named') {
      sample.byTerminal[1].terminalCode = 'KSK-001'
      sample.byOrg[1].orgName = '青岛服务机构'
      // null key 的关联空态优先于名称，不可伪装成已关联。
      sample.byTerminal[0].terminalCode = '不可显示的编号'
      sample.byOrg[0].orgName = '不可显示的机构'
    }
    const panel = mountPanel({ get: () => Promise.resolve(sample) })
    let tree = await panel.view.settle()
    assert.doesNotMatch(textOf(tree), /数据不完整|读取失败/)
    const alert = find(tree, (node) => node.props.role === 'alert').map((node) => textOf(node.children)).join('')
    const reachedName = mode === 'named' ? 'KSK-002' : '终端（尾号 osk-02）'
    assert.ok(alert.includes(`${reachedName}、终端（尾号 osk-01）`), '触顶列表必须按 terminalIds 同序，用 reached.terminals 的编号')
    const reachedTitle = mode === 'named' ? '编号 KSK-002 · ID kiosk-02' : 'kiosk-02'
    assert.ok(find(tree, (node) => node.type === 'span' && node.props.title === reachedTitle).length > 0)
    act.click(tabs(tree, '按终端')[0])
    tree = panel.view.render()
    const terminalName = mode === 'named' ? 'KSK-001' : '终端（尾号 osk-01）'
    const terminalTitle = mode === 'named' ? '编号 KSK-001 · ID kiosk-01' : 'kiosk-01'
    assert.ok(find(tree, (node) => node.type === 'td' && node.props.title === terminalTitle).some((node) => textOf(node.children) === terminalName))
    assert.match(textOf(tree), /无已验签终端/)
    act.click(tabs(tree, '按机构')[0])
    tree = panel.view.render()
    const orgName = mode === 'named' ? '青岛服务机构' : '机构（尾号 123456）'
    const orgTitle = mode === 'named' ? '名称 青岛服务机构 · ID org-primary-123456' : 'org-primary-123456'
    assert.ok(find(tree, (node) => node.type === 'td' && node.props.title === orgTitle).some((node) => textOf(node.children) === orgName))
    assert.match(textOf(tree), /无机构/)
    assert.doesNotMatch(textOf(tree), /不可显示|org-primary-123456|kiosk-01/)
    panel.view.unmount()
  }
})


}
