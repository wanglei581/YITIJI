import assert from 'node:assert/strict'

/** 第六批：执行真实组件、真实 CSV 与格式函数；不把悬停当正文。 */
export function verifyBatch6Copy({ runFile, textOf, shared, ui, fail }) {
  try {
    const children = ({ children, title }) => [title, children]
    const metric = ({ title, metric, render }) => [title, metric.available ? render(metric.value) : '暂不能读取']
    const screen = { ...ui, TwinSlot: children, TwinPanel: children, TwinMetricPanel: metric,
      TwinTiles: ({ items }) => items.map((i) => [i.label, i.value]), TwinSceneBox: children,
      TwinDevice: () => null, TwinLegend: ({ items }) => items.map((i) => i.label),
      screenCount: shared.formatCount, screenReasonCopy: () => '', twinTerminalState: () => 'ok', TWIN_STATE_TEXT: { ok: '在线' } }
    const charts = runFile('packages/ui/src/screen/twin/TwinCharts.tsx', {
      '../../lib/cn': { cn: () => '' }, '../ScreenPrimitives': { screenCount: shared.formatCount }, './TwinReasonChip': {},
    })
    const board = runFile('packages/ui/src/screen/twin/TwinTerminalBoard.tsx', {
      '../ScreenPrimitives': screen, '../screenCopy': screen, './TwinFrame': screen, './TwinPanel': screen,
      './TwinCharts': { ...charts, TwinLegend: screen.TwinLegend, TwinTiles: screen.TwinTiles },
      './TwinDevice': screen, './TwinCity': screen,
    })
    const ok = (value) => ({ available: true, value })
    const twin = { generatedAt: '2026-10-04T04:00Z', terminal: { id: 'private-terminal-id', code: 'WALK-003' },
      status: { health: 'healthy', lastHeartbeatAt: null, onlineWindowSeconds: 300, agentVersion: null, wiredNetwork: null },
      printer: ok({ state: 'ready' }), scanner: ok({ state: 'ready' }), currentTask: ok(null),
      today: { printPages: null, printTasks: null, scans: 0, failed: 0, visits: ok(0) }, consumables: { available: false },
      // 故意喂进残留打印段，证明前端旧响应兜底仍不会画色块。
      timeline24h: ok([{ from: '2026-10-03T04:00Z', to: '2026-10-04T03:59Z', state: 'idle' }, { from: '2026-10-04T03:59Z', to: '2026-10-04T04:00Z', state: 'printing' }]),
    }
    function colors(node, out = []) {
      if (!node || typeof node !== 'object') return out
      if (Array.isArray(node)) { node.forEach((n) => colors(n, out)); return out }
      if (typeof node.type === 'function') return colors(node.type(node.props), out)
      if (node.props?.style?.background) out.push(node.props.style.background)
      colors(node.props?.children, out)
      return out
    }
    const props = { twin, formatClock: () => '12:00', formatDateTime: () => '2026-10-04 12:00', unassignedAreaLabel: '未设置' }
    const hidden = board.TwinTerminalBoard(props)
    assert.ok(!colors(hidden).includes('#72d6ff'), '隐藏态仍绘制打印色块')
    assert.ok(textOf(hidden).includes('打印时段不在状态带上单独标出，今日打印单数见上方。'), '状态带缺少固定说明')
    assert.ok(!textOf(hidden).includes('打印中'), '状态带图例仍含打印中')
    for (const n of [0, 3, 4, 5, 12]) {
      const shown = board.TwinTerminalBoard({ ...props, twin: { ...twin, today: { ...twin.today, printTasks: n < 5 && n > 0 ? null : n } } })
      assert.ok(!colors(shown).includes('#72d6ff'), `${n}单时仍绘制打印色块`)
      assert.ok(textOf(shown).includes('打印时段不在状态带上单独标出，今日打印单数见上方。'))
    }
    const heat = charts.TwinHeat({ rows: [{ key: 'today', label: '今天', hours: [null, 5, null] }] })
    const pulse = charts.TwinPulse({ buckets: [{ key: 'now', info: null, ai: 5, print: null }] })
    assert.equal(textOf(heat).replace(/\s/g, ''), '今天061218')
    assert.ok(!textOf(pulse).includes('少于 5') && !textOf(pulse).includes('0'))
    assert.equal(colors(pulse).filter((c) => c === 'rgba(46,230,168,.12)').length, 2)

    // 执行真实UsageView，包括可用空值及取数失败两条路径。
    const date = runFile('packages/shared/src/formatDateTime.ts')
    let usageData
    const usage = runFile('apps/admin/src/routes/screen/UsageView.tsx', {
      '@ai-job-print/shared': { ...shared, ...date },
      react: { useCallback: (fn) => fn, useMemo: (fn) => fn() },
      '@ai-job-print/refresh': { replaceIfChanged() {}, useRefreshable: () => ({ data: usageData }) },
      '@ai-job-print/ui': { ...screen, TwinPulse: () => null },
      '../../services/api/consoleScreen': { normalizeUsageRange: () => '7d' },
      './aiScreenDisplay': {}, './metricLabels': {}, './screenMeta': {}, './UsageHostingOff': {},
      './measureUnit': runFile('apps/admin/src/routes/screen/measureUnit.ts'),
      './screenView': { TwinShell: ({ children, reportingWindowText }) => [reportingWindowText, children], stampText: () => '', failureOf: () => null },
    })
    const chrome = { params: { get: () => '7d' }, lite: true, setParam() {} }
    usageData = { range: '7d', window: { from: '2026-09-26T16:00:00Z', to: '2026-10-03T16:00:00Z' }, generatedAt: '2026-10-04T04:00:00Z', limits: {}, metrics: {} }
    // 其余面板不可用；脉冲独立可用。
    for (const key of ['channels', 'heat7d', 'services', 'ai', 'jobs', 'content']) usageData.metrics[key] = { available: false }
    usageData.metrics.pulse2h = ok({ buckets: [{ start: '2026-10-04T03:55:00Z', info: null, ai: null, print: null }] })
    const usageText = textOf(usage.UsageView({ chrome })).replace(/\s+/g, ' ')
    for (const label of ['信息 不足 5', 'AI 不足 5', '打印 不足 5']) assert.ok(usageText.includes(label), `脉冲null必须显示${label}`)
    assert.ok(usageText.includes('2026-09-27 至 2026-10-03（截至昨天）'), '窗口两端必须均为上海日期')
    usageData.metrics.pulse2h = { available: false, reason: 'source_query_failed' }
    const failedText = textOf(usage.UsageView({ chrome }))
    assert.ok(!failedText.includes('信息 不足 5') && failedText.includes('暂不能读取'), '取数失败必须与null分开')

    const fmt = runFile('apps/partner/src/routes/terminals/terminalOpsFormat.ts', {
      '@ai-job-print/shared': { ...shared, ...runFile('packages/shared/src/formatDateTime.ts') },
      '../../lib/csv': runFile('apps/partner/src/lib/csv.ts'),
    })
    const output = { printed: null, settled: 5, unconfirmed: null, successRate: null }
    assert.equal(fmt.rateText(output), '样本不足，不显示')
    assert.equal(fmt.countText(null), '样本不足，不显示')
    const faults = { offlineCount: 0, offlineMinutes: 0, printerFaultCount: 0, printerFaultMinutes: 0, recoveredCount: 0, avgRecoveryMinutes: null, longestMinutes: null, reportedInWindow: true }
    const row = { terminalCode: 'WALK-003', displayName: null, locationLabel: null, online: true, lastHeartbeatAt: null, visitCount: null, serviceCount: null, output, faults }
    const data = { period: 'week', timezone: 'Asia/Shanghai', window: { from: '2026-09-26T16:00:00Z', to: '2026-10-03T16:00:00Z' }, dataMode: 'live', terminals: [row],
      totals: { terminalCount: 1, onlineTerminals: 1, silentTerminals: 0, visitCount: null, serviceCount: null, output: { ...output, settled: null }, faults },
      visitCount: { recordingStarted: true }, aiAvailability: { reason: 'ai_calls_not_attributed_to_terminal' } }
    const csv = fmt.buildTerminalOpsCsv(data)
    assert.ok(csv.includes('样本不足，不显示') && !/\d(?:\.\d+)?%/.test(csv), 'CSV 隐藏态仍有百分比或空白比率')
    assert.ok(fmt.windowText(data).includes('2026-10-03（截至昨天）'))
    assert.ok(fmt.terminalOpsCsvName('机构', data).includes('2026-10-03（截至昨天）'))
    const drawer = runFile('apps/partner/src/routes/terminals/TerminalOpsDrawer.tsx', {
      '@ai-job-print/ui': { Drawer: children, StatusBadge: () => null }, './terminalOpsFormat': fmt,
    })
    const visible = textOf(drawer.TerminalOpsDrawer({ row, windowLabel: fmt.windowText(data), visitRecordingStarted: true, onClose() {} }))
    assert.ok(visible.includes('样本不足，不显示') && !/\d(?:\.\d+)?%/.test(visible), '页面/抽屉隐藏态仍有百分比')
    const names = runFile('apps/admin/src/routes/ai-services/aiLogDisplay.ts', { '@ai-job-print/shared': shared })
    assert.equal(names.aiProviderName('llm'), '大语言模型')
    assert.equal(names.aiProviderName('llm:deepseek'), 'DeepSeek')
    const money = runFile('apps/admin/src/routes/ai-services/aiUsageDisplay.ts', { '@ai-job-print/shared': shared })
    assert.equal(money.formatCny(0.015), '¥0.0150')
    console.log('  PASS 第六批真实渲染：隐藏态无打印色块、有说明；页面/CSV无百分比；截至昨天；AI名字与四位成本')
  } catch (error) { fail(`第六批展示：${error.message}`) }
}
