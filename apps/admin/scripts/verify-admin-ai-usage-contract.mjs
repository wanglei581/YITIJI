import assert from 'node:assert/strict'

export async function verifyUsageContract({ check, read, repoRoot, loadAdapter, load, SAMPLE, legacySample, reply, rejection, ApiHttpError, API_BASE }) {
const controllerSource = read('services/api/src/ai/usage/admin-ai-usage.controller.ts', repoRoot)
const budgetSource = read('services/api/src/ai/usage/ai-budget.service.ts', repoRoot)
const summarySource = read('services/api/src/ai/usage/ai-usage-summary.ts', repoRoot)

function budgetMessage(varName, key) {
  const match = new RegExp(`${key}:\\s*'([^']+)'`).exec(budgetSource.slice(budgetSource.indexOf(varName)))
  assert.ok(match, `ai-budget.service.ts 里找不到 ${varName}.${key} 的原话`)
  return match[1]
}
const EXHAUSTED_GLOBAL = budgetMessage('EXHAUSTED_MESSAGE', 'global')

await check('A1 服务端事实：GET /admin/ai-usage/daily 只给 admin；day 校验与错误码同判法', () => {
  assert.match(controllerSource, /@Controller\('admin\/ai-usage'\)/, '控制器路径变了')
  assert.match(controllerSource, /@Get\('daily'\)/, '缺 GET daily')
  assert.match(controllerSource, /@Roles\('admin'\)/, '不再只限 admin')
  assert.match(controllerSource, /day\?\.trim\(\) \|\| beijingDayKey\(aiUsageNow\(\)\)/, '省略 day 不再默认北京时间今天')
  assert.match(controllerSource, /code: 'AI_USAGE_DAY_INVALID', message: '日期格式应为 YYYY-MM-DD'/, '非法 day 的错误码或提示变了')
})

await check('A2 服务端事实：触顶后果照真实行为——只拦生成与语音，只读导出删除材料检查不拦，次日恢复', () => {
  assert.equal(EXHAUSTED_GLOBAL, '今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常', '全局触顶提示原话变了，面板告警文字要跟着改')
  // 触顶是拒绝（503），不是降级：assertWithinBudget 抛 ServiceUnavailableException
  assert.match(budgetSource, /throw new ServiceUnavailableException\(\{ error: \{ code: AI_BUDGET_EXHAUSTED/, '触顶不再抛 503 AI_BUDGET_EXHAUSTED')
  assert.match(budgetSource, /只拦 generate \/ voice/, '拦截范围说明变了（面板「后果」段落要重写）')
  assert.match(budgetSource, /只读、导出、删除、打印前材料检查（@AiUseExempt）一律不拦/, '豁免范围说明变了（面板「后果」段落要重写）')
  assert.match(budgetSource, /失败关闭/, '读不到花费时不再是失败关闭')
})

await check('A3 服务端事实：桶字段白名单、null key 口径、不含会员号', () => {
  assert.match(summarySource, /null 表示「无已验签终端」\/「无所属机构」/, 'null key 口径说明变了')
  assert.match(summarySource, /\*\*不含会员号\*\*，会员只给人数/, '汇总不再遵守「不含会员号」白名单')
  for (const field of ['calls', 'unmeasuredCalls', 'measuredCostCny', 'chargedCostCny']) {
    assert.match(summarySource, new RegExp(`${field}:`), `桶缺 ${field}`)
  }
})

// ─── B. 适配器（node:vm 沙箱真跑） ───────────────────────────────────────────
const http = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() })).service

await check('B1 http：GET /admin/ai-usage/daily 带管理员令牌与 day 参数，按 { success, data } 取全量字段', async () => {
  const { service, calls } = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() }))
  const summary = await service.getAiUsageDaily('2026-09-28')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${API_BASE}/admin/ai-usage/daily?day=2026-09-28`)
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gate-admin-token')
  // vm 沙箱里创建的对象原型与宿主不同，deepStrictEqual 会连原型一起比：先 JSON 往返归一化。
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), SAMPLE(), '解析结果必须逐字段等于服务端 data')
  assert.equal(service.AI_USAGE_DAILY_DEMO, false, 'http 模式不能标演示')
})

await check('B2 http：省略 day 不带查询串', async () => {
  const { service, calls } = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() }))
  await service.getAiUsageDaily()
  assert.equal(calls[0].url, `${API_BASE}/admin/ai-usage/daily`)
})

await check('B3 http：不合法日期（格式错、月或日越界）根本不发请求', async () => {
  for (const day of ['2026-9-1', '2026/09/28', 'abc', '2026-13-01', '2026-09-32', '']) {
    const { service, calls } = loadAdapter('http', () => reply(200, { success: true, data: SAMPLE() }))
    const error = await rejection(service.getAiUsageDaily(day))
    assert.equal(error.code, 'AI_USAGE_DAY_INVALID', `day=${JSON.stringify(day)}`)
    assert.equal(error.status, 400)
    assert.equal(calls.length, 0, `day=${JSON.stringify(day)} 不能发请求`)
  }
  assert.equal(http.isAiUsageDayKey('2026-09-28'), true)
  assert.equal(http.isAiUsageDayKey('2026-13-01'), false)
})

await check('B4 http：401 跳登录；403 / 400 的错误码与服务端中文 message 原样带回', async () => {
  const unauthorized = loadAdapter('http', () => reply(401, { error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' } }))
  assert.equal((await rejection(unauthorized.service.getAiUsageDaily())).status, 401)
  assert.equal(unauthorized.redirects.length, 1, '401 必须跳登录')

  const forbidden = loadAdapter('http', () => reply(403, { error: { code: 'AUTH_ROLE_FORBIDDEN', message: '当前角色无权访问 (需要: admin)' } }))
  const forbiddenError = await rejection(forbidden.service.getAiUsageDaily())
  assert.equal(forbiddenError.status, 403)
  assert.equal(forbiddenError.code, 'AUTH_ROLE_FORBIDDEN')
  assert.equal(forbiddenError.message, '当前角色无权访问 (需要: admin)', '服务端 message 要原样带回')
  assert.equal(forbidden.redirects.length, 0, '403 不是登录过期，不能跳登录')

  const badDay = loadAdapter('http', () => reply(400, { error: { code: 'AI_USAGE_DAY_INVALID', message: '日期格式应为 YYYY-MM-DD' } }))
  const badDayError = await rejection(badDay.service.getAiUsageDaily())
  assert.equal(badDayError.code, 'AI_USAGE_DAY_INVALID')
  assert.equal(badDayError.message, '日期格式应为 YYYY-MM-DD')

  const offline = loadAdapter('http', () => { throw new TypeError('Failed to fetch') })
  const offlineError = await rejection(offline.service.getAiUsageDaily())
  assert.equal(offlineError.code, 'NETWORK_ERROR')
  assert.equal(offlineError.status, 0)
})

await check('B5 http：响应形状不对不当成功（缺 data / 日期错 / 负数金额 / 未计量单价 0 / 桶字段坏）', async () => {
  const broken = [
    { success: true },
    { success: true, data: { ...SAMPLE(), day: '2026/09/28' } },
    { success: true, data: { ...SAMPLE(), limits: { ...SAMPLE().limits, globalCny: -1 } } },
    { success: true, data: { ...SAMPLE(), limits: { ...SAMPLE().limits, unmeasuredCallCostCny: 0 } } },
    { success: true, data: { ...SAMPLE(), totals: { ...SAMPLE().totals, memberCount: '2' } } },
    { success: true, data: { ...SAMPLE(), reached: { ...SAMPLE().reached, terminalIds: 'kiosk-01' } } },
    { success: true, data: { ...SAMPLE(), byFeature: {} } },
    { success: true, data: { ...SAMPLE(), byTerminal: [{ key: 123, calls: 1, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0 }] } },
    { success: true, data: { ...SAMPLE(), byVendor: [{ key: 'deepseek', calls: -1, unmeasuredCalls: 0, measuredCostCny: 0, chargedCostCny: 0 }] } },
  ]
  for (const body of broken) {
    const { service } = loadAdapter('http', () => reply(200, body))
    const error = await rejection(service.getAiUsageDaily())
    assert.equal(error.code, 'UNEXPECTED_RESPONSE', `body=${JSON.stringify(body).slice(0, 80)} 不能当成功`)
  }
})

await check('B6 mock：标演示、不发请求、直接拒绝（不造假数）', async () => {
  const { service, calls } = loadAdapter('mock')
  assert.equal(service.AI_USAGE_DAILY_DEMO, true, 'mock 模式必须标演示')
  const error = await rejection(service.getAiUsageDaily('2026-09-28'))
  assert.equal(error.code, 'DEMO_MODE_NO_USAGE_DATA')
  assert.equal(calls.length, 0, 'mock 模式不能发请求')
})

await check('B7 新字段缺失（旧服务端）兼容为 null，触顶终端从 terminalIds 同序补齐', async () => {
  const old = legacySample()
  old.reached.terminalIds = ['kiosk-02', 'kiosk-01']
  const { service } = loadAdapter('http', () => reply(200, { success: true, data: old }))
  const summary = await service.getAiUsageDaily()
  const expected = SAMPLE()
  expected.reached.terminalIds = old.reached.terminalIds
  expected.reached.terminals = old.reached.terminalIds.map((terminalId) => ({ terminalId, terminalCode: null }))
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), expected)
})

await check('B8 名称字段类型及 reached.terminals 与 terminalIds 的长度、顺序、ID 严格校验', async () => {
  const edits = [
    (s) => { s.byTerminal[1].terminalCode = 123 },
    (s) => { s.byOrg[0].orgName = {} },
    (s) => { s.reached.terminals = null },
    (s) => { s.reached.terminals = [] },
    (s) => { s.reached.terminals[0].terminalId = null },
    (s) => { s.reached.terminals[0].terminalId = 'different-id' },
    (s) => { s.reached.terminals[0].terminalCode = false },
    (s) => { s.reached.terminals[0] = null },
    (s) => {
      s.reached.terminalIds.push('kiosk-02')
      s.reached.terminals = [{ terminalId: 'kiosk-02', terminalCode: 'KSK-002' }, { terminalId: 'kiosk-01', terminalCode: 'KSK-001' }]
    },
    // 缺新字段也不能掩盖旧字段坏形状。
    (s) => { delete s.byTerminal[1].terminalCode; s.byTerminal[1].calls = '3' },
    (s) => { delete s.byOrg[0].orgName; s.byOrg[0].chargedCostCny = -1 },
    (s) => { delete s.reached.terminals; s.reached.memberCount = -1 },
  ]
  for (const edit of edits) {
    const sample = SAMPLE()
    edit(sample)
    const { service } = loadAdapter('http', () => reply(200, { success: true, data: sample }))
    assert.equal((await rejection(service.getAiUsageDaily())).code, 'UNEXPECTED_RESPONSE')
  }
  const sample = SAMPLE()
  sample.reached.terminalIds = ['kiosk-02', 'kiosk-01']
  sample.reached.terminals = [{ terminalId: 'kiosk-02', terminalCode: 'KSK-002' }, { terminalId: 'kiosk-01', terminalCode: null }]
  const normalized = http.aiUsageDailyFromResponse({ data: sample })
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), sample, '服务端同序编号必须原样保留')
  delete sample.reached.terminals[0].terminalCode
  assert.equal(http.aiUsageDailyFromResponse({ data: sample }).reached.terminals[0].terminalCode, null)
})

// ─── C. 显示名与金额（真跑 aiUsageDisplay.ts） ────────────────────────────────
await check('C1 null key 显示「无已验签终端 / 无机构」；已知 key 给中文名；认不出原样显示', () => {
  const display = load('src/routes/ai-services/aiUsageDisplay.ts', {})
  assert.equal(display.aiUsageKeyName('terminal', null), '无已验签终端')
  assert.equal(display.aiUsageKeyName('org', null), '无机构')
  assert.equal(display.aiUsageKeyName('terminal', 't_09fd'), '终端（尾号 t_09fd）')
  assert.equal(display.aiUsageKeyName('org', 'org_6349'), '机构（尾号 g_6349）')
  assert.equal(display.aiUsageKeyName('terminal', 'ab'), '终端（尾号 ab）', '短 ID 全文显示，不补零')
  assert.equal(display.aiUsageKeyName('org', 'cd'), '机构（尾号 cd）')
  assert.notEqual(display.aiUsageKeyName('terminal', 'db-primary-123456'), display.aiUsageKeyName('terminal', 'db-primary-654321'))
  assert.equal(display.aiUsageKeyName('feature', 'resume_optimize'), 'AI简历优化')
  assert.equal(display.aiUsageKeyName('feature', 'assistant_chat'), 'AI助手对话')
  assert.equal(display.aiUsageKeyName('feature', 'unknown'), '未知功能')
  assert.equal(display.aiUsageKeyName('vendor', 'deepseek'), 'DeepSeek')
  assert.equal(display.aiUsageKeyName('vendor', 'qwen'), '通义千问')
  assert.equal(display.aiUsageKeyName('feature', 'brand_new_feature'), 'brand_new_feature', '认不出的功能 key 必须原样显示')
  assert.equal(display.aiUsageKeyName('vendor', 'api.somehost.com'), 'api.somehost.com', '认不出的厂商 key（主机名）必须原样显示')
})

await check('C2 AI 金额统一四位小数', () => {
  const display = load('src/routes/ai-services/aiUsageDisplay.ts', {})
  assert.equal(display.formatCny(1.1), '¥1.1000')
  assert.equal(display.formatCny(0.05), '¥0.0500')
  assert.equal(display.formatCny(0), '¥0.0000')
  assert.equal(display.formatCny(123.456), '¥123.4560')
})

await check('C4 未登记失败原因显示各自码值，已登记原因保持中文', () => {
  const display = load('src/routes/ai-services/aiUsageDisplay.ts', {})
  const { aiLogReason } = load('src/routes/ai-services/aiLogDisplay.ts', { './aiUsageDisplay': display })
  assert.equal(aiLogReason('NEW_FAILURE_A'), '未归类失败（NEW_FAILURE_A）')
  assert.equal(aiLogReason('NEW_FAILURE_B'), '未归类失败（NEW_FAILURE_B）')
  assert.notEqual(aiLogReason('NEW_FAILURE_A'), aiLogReason('NEW_FAILURE_B'))
  assert.equal(aiLogReason('AI_PROVIDER_ERROR'), '模型厂商服务异常')
})


return { http, EXHAUSTED_GLOBAL }
}
