import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

/** 第五批：执行真实展示组件，锚在可见文字、状态条件与点击结果。 */
export function verifyBatch5Copy({ runFile, textOf, shared, ui, hooks, repoRoot, fail }) {
  const read = (file) => readFileSync(join(repoRoot, file), 'utf8')
  const icons = new Proxy({}, { get: () => () => null })
  const children = ({ children, title, source, action }) => [title, source, action, children]
  const screenUi = new Proxy({
    ...ui, ComplianceBanner: children, SectionCard: children, Button: children,
    TwinMetricPanel: ({ title, source, metric, render }) => [title, source, metric?.available ? render(metric.value) : '暂时取不到'],
    TwinPanel: children, TwinSlot: children,
    TwinTiles: ({ items }) => items.map((item) => [item.label, item.value, item.unit]),
    TwinBarList: ({ items }) => items.map((item) => [item.label, item.valueText ?? item.value]),
    screenCount: shared.formatCount,
    twinTerminalState: () => 'ok', TWIN_STATE_TEXT: { ok: '在线' },
  }, { get: (target, key) => target[key] ?? children })
  const charts = runFile('packages/ui/src/screen/twin/TwinCharts.tsx', {
    '../../lib/cn': { cn: () => '' }, '../ScreenPrimitives': { screenCount: shared.formatCount }, './TwinReasonChip': {},
  })
  screenUi.twinSmall = charts.twinSmall
  const assertText = (node, phrases, forbidden = []) => {
    const text = textOf(node).replace(/\s+/g, ' ').trim()
    for (const phrase of phrases) assert.ok(text.replace(/\s+/g, '').includes(phrase.replace(/\s+/g, '')), `实际渲染缺少 ${phrase}`)
    for (const raw of forbidden) assert.ok(!text.includes(raw), `实际渲染露出 ${raw}`)
    return text
  }
  try {
    const copy = [
      '上传前请先看',
      '不要上传：招聘简章；写了用人单位和岗位、人数、薪资、条件或报名方式的图片或视频；列出企业或岗位的招聘会海报；企业或商业招聘网站的二维码。',
      '可以上传：机构介绍和服务时间；就业政策和补贴宣传；不指向具体单位和岗位的讲座、培训通知；本机使用指引。',
      '拿不准的先不放：只写时间地点的招聘会预告；机构招聘自己工作人员的公告；人才引进政策里附带的岗位表。',
      '图片和视频里的招聘信息，同样算发布招聘信息。',
    ]
    const notice = runFile('apps/admin/src/routes/screensaver/AssetUploadNotice.tsx', { '@ai-job-print/ui': screenUi })
    for (const hosting of [{ status: 'loading' }, { status: 'error' }, { status: 'ready', enabled: false }]) {
      const rendered = notice.AssetUploadNotice({ hosting })
      for (const phrase of copy) assert.ok(textOf(rendered).includes(phrase), `上传原文逐字不符：${phrase}`)
      assertText(rendered, copy)
    }
    assert.equal(textOf(notice.AssetUploadNotice({ hosting: { status: 'ready', enabled: true } })), '')
    const assets = read('apps/admin/src/routes/screensaver/AssetsTab.tsx')
    assert.ok(assets.includes('const hosting = useRecruitmentHosting()') && assets.includes('<AssetUploadNotice hosting={hosting} />'))
    assert.ok(assets.indexOf('<AssetUploadNotice') < assets.indexOf('>上传素材</h3>'))
    assert.ok(assets.includes('onClick={handleUpload} disabled={uploading || !file}'), '提示不能拦截上传')
    assert.ok(read('apps/admin/src/routes/screensaver/index.tsx').includes('待机宣传屏属线下一体机运营广告位'), '页头独立合规提示保留')
    const log = runFile('apps/admin/src/routes/ai-services/aiLogDisplay.ts', { '@ai-job-print/shared': shared })
    const display = runFile('apps/admin/src/routes/screen/aiScreenDisplay.ts', {
      '@ai-job-print/shared': shared, '../ai-services/aiLogDisplay': log,
    })
    const labels = runFile('apps/admin/src/routes/screen/metricLabels.ts', { '@ai-job-print/shared': shared, '@ai-job-print/ui': screenUi })
    const panels = runFile('apps/admin/src/routes/screen/UsageHostingOff.tsx', {
      '@ai-job-print/shared': shared, '@ai-job-print/ui': screenUi, './metricLabels': labels, './aiScreenDisplay': display,
    })
    const unknownRows = labels.aiOperationRows([{ operation: 'new_a', count: 0 }, { operation: 'parseResume', count: 6 }, { operation: 'new_b', count: null }])
    assert.equal(unknownRows[0].label, '其他 AI 服务（1）')
    assert.equal(unknownRows[0].count, 0)
    assert.equal(unknownRows[2].label, '其他 AI 服务（2）')
    assert.equal(unknownRows[2].count, null)
    const value = { byOperation: [{ operation: 'parseResume', count: 10 }, { operation: 'chatAssistant', count: null }, { operation: 'future_op', count: 6 }, { operation: 'another_future_op', count: null }, { operation: 'careerPlan', count: 0 }],
      providers: [{ provider: 'llm:deepseek:deepseek-v4-flash', label: 'llm:deepseek:deepseek-v4-flash', count: 10 },
        { provider: 'AI_PROVIDER_ERROR', label: 'AI_PROVIDER_ERROR', count: null },
        { provider: 'ServiceUnavailableException', label: 'ServiceUnavailableException', count: 5 }],
      estimatedCostCny: null, successRate: null, avgLatencyMs: null, fallbackCalls: null, failed: 0, total: 21 }
    assertText(panels.UsageAiPanel({ metric: { available: true, value }, rangeText: '今日', presenting: false }),
      ['简历解析', 'AI 对话', '其他 AI 服务（1）', '其他 AI 服务（2）', '职业规划 0', 'DeepSeek · deepseek-v4-flash', '模型厂商服务异常', 'AI 服务暂时不可用', '少于 5'],
      ['llm:deepseek', 'parseResume', 'chatAssistant', 'future_op', 'another_future_op', 'ServiceUnavailableException', 'AI_PROVIDER_ERROR'])
    assertText(panels.UsageAiQualityPanel({ metric: { available: true, value }, rangeText: '近 7 天' }),
      ['近 7 天窗口', '降级兜底', '不是日志状态', '少于 5', '样本不足'])
    const gov = runFile('apps/admin/src/routes/screen/GovGrid.tsx', {
      '@ai-job-print/shared': shared, '@ai-job-print/ui': screenUi, './GovHostingOff': {}, './metricLabels': labels,
      './screenMeta': {}, './screenTabs': {}, './screenView': {},
    }, '\nexport { TaskFlow }\n')
    assertText(gov.TaskFlow({ printByStatus: { cancelled: 7 }, scanByStatus: { cancelled: 12, completed: 5 } }), ['7 已取消（打印）', '5 扫描完成'], ['12 已取消'])
    assert.ok(read('apps/admin/src/routes/screen/GovGrid.tsx').includes('<span>AI 服务调用（累计）</span>'))
    const ops = read('apps/admin/src/routes/screen/OpsGrid.tsx')
    for (const phrase of ['近 24 小时成功率，0 次不给百分比；兜底模型次数见服务调用页。']) assert.ok(ops.includes(phrase))
    const board = runFile('packages/ui/src/screen/twin/TwinTerminalBoard.tsx', {
      '../ScreenPrimitives': screenUi, '../screenCopy': {}, './TwinDevice': screenUi, './TwinCharts': screenUi,
      './TwinCity': screenUi, './TwinFrame': screenUi, './TwinPanel': screenUi,
    })
    const twin = { terminal: { code: 'KSK-TEST' }, generatedAt: '2026-10-03T03:00:00Z',
      status: { health: 'ok', onlineWindowSeconds: 180 }, currentTask: { available: true, value: null },
      printer: { available: true, value: { state: 'idle' } }, scanner: { available: true, value: { state: 'unknown' } },
      consumables: { available: true, value: {} }, timeline24h: { available: false },
      today: { printPages: 0, printTasks: 0, scans: 0, failed: 7, visits: { available: true, value: 0 } } }
    const common = { twin, formatClock: () => '11:00', formatDateTime: () => '2026-10-03 11:00', unassignedAreaLabel: '未设置所在区' }
    assertText(board.TwinTerminalBoard(common), ['今日打印失败 7 次，详情见打印扫描运维'])
    assertText(board.TwinTerminalBoard({ ...common, failureGuidance: '如需处理请联系平台运营' }), ['今日打印失败 7 次，如需处理请联系平台运营'], ['打印扫描运维'])
    for (const [file, phrase] of [['apps/admin/src/routes/screen/TerminalTwinView.tsx', '详情见打印扫描运维'], ['apps/partner/src/routes/screen/PartnerTerminalView.tsx', '如需处理请联系平台运营']]) assert.ok(read(file).includes(`failureGuidance="${phrase}"`))
    const constants = runFile('apps/admin/src/routes/toolbox/constants.ts', { '@ai-job-print/shared': shared })
    const host = runFile('apps/admin/src/routes/toolbox/components/ToolboxAllowedHostPanel.tsx', {
      react: hooks([{ host: '', purpose: 'web_app' }, '', '']), '@ai-job-print/shared': shared,
      '@ai-job-print/ui': screenUi, '../../../services/api/toolbox': {}, '../constants': constants,
    })
    assertText(host.ToolboxAllowedHostPanel({ hosts: [], onRefresh() {} }), ['域名审核记录', '同时通过本页审核和服务器配置检查'], ['DB', 'env', 'TOOLBOX_ALLOW_EXTERNAL_URL'])
    const governance = read('apps/admin/src/routes/toolbox/components/ToolboxGovernancePanel.tsx')
    assert.ok(governance.includes('发布失败时会说明具体原因。') && governance.includes('ENTRY_TYPE_LABELS['))
    assert.ok(governance.includes('window.confirm(') && governance.includes('disabled={!selectedApp}'))
    for (const reason of Object.values(constants.BLOCK_REASON_LABELS)) assert.ok(!/DB|env|BLOCK_REASON_LABELS|TOOLBOX_ALLOW_EXTERNAL_URL/.test(reason))
    const widgets = runFile('apps/admin/src/routes/dashboard/DashboardWidgets.tsx', { 'lucide-react': icons })
    const tasks = runFile('apps/admin/src/routes/dashboard/RecentPrintTasks.tsx', {
      '@ai-job-print/shared': { ...shared, formatTime: () => '11:00' }, '@ai-job-print/ui': screenUi, './DashboardWidgets': widgets,
    })
    let retried = 0
    const props = { tasks: [], total: 0, loading: false, error: false, onRetry: () => { retried++ } }
    assertText(tasks.RecentPrintTasks(props), ['暂无打印任务', '进入订单管理'])
    assertText(tasks.RecentPrintTasks({ ...props, loading: true }), ['加载中', '进入订单管理'], ['暂无打印任务'])
    const tree = tasks.RecentPrintTasks({ ...props, error: true })
    assertText(tree, ['打印任务加载失败', '重试', '进入订单管理'], ['暂无打印任务'])
    function clickRetry(node) {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(clickRetry); return }
      if (typeof node.type === 'function') { clickRetry(node.type(node.props)); return }
      if (node.type === 'button' && textOf(node) === '重试') node.props.onClick()
      else clickRetry(node.props?.children)
    }
    clickRetry(tree)
    assert.equal(retried, 1)
    console.log('  PASS 第五批上传原文与四种状态、AI 展示、取消口径、孪生提示、百宝箱工程词与区块重试')
  } catch (error) { fail(error.message) }
}
