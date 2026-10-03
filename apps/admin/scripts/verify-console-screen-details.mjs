export function verifyScreenDetails({ read, check, stripComments, screenFiles, partnerLabels, copyBlock, twinShell, css }) {
const countRule = '1 至 4 次不给数字，写『少于 5』；0 照常显示'
for (const path of ['apps/admin/src/routes/screen/UsageView.tsx', 'apps/admin/src/routes/screen/UsageHostingOff.tsx',
  'apps/partner/src/routes/screen/PartnerUsageView.tsx', 'apps/partner/src/routes/screen/PartnerUsageHostingOff.tsx']) {
  const source = read(path)
  check(source.includes(countRule) && !source.includes('少于 5 次不显示'), `${path}统一 0 / 1–4 口径`)
}
check((read('apps/admin/src/routes/screen/UsageView.tsx').match(/value\.paidOrders >= 5/g) ?? []).length === 2,
  '会员下单占比分母 ≥5 才给百分比，0 不作为足够样本')
// ── 14A. 页眉标题层级 ─────────────────────────────────────────────────────
// 大屏嵌在 Admin / Partner 的 Page 里时，外层 PageHeader 已经是 h1；
// 大屏页眉再渲染一个 h1 就是一页两个 h1 —— 读屏器读不出主次，
// partner 的 route-sweep 也会因 locator('h1') 命中两个而 strict mode violation。
// 这一组守的是「层级由调用方显式决定」，而不是靠 CSS 把其中一个藏起来。
const frame = read('packages/ui/src/screen/ScreenFrame.tsx')
check(
  /export type ScreenHeadingLevel = 1 \| 2/.test(frame),
  '页眉标题层级是受限联合类型（只开放 h1 / h2，不是任意字符串）',
)
check(
  /^\s{2}headingLevel: ScreenHeadingLevel$/m.test(frame),
  'headingLevel 是必填 prop（没有 ?，漏传就是编译错误而不是静默多一个 h1）',
)
check(
  !/headingLevel\s*=\s*[12]/.test(stripComments(frame)),
  'headingLevel 没有默认值（给了默认值，下一个接入点会静默多出一个 h1）',
)
check(
  /const Heading = headingLevel === 1 \? 'h1' : 'h2'/.test(frame)
    && /<Heading>\{title\}<\/Heading>/.test(frame),
  '页眉按层级渲染真实的 h1 / h2 标签',
)
check(
  !/<h1>\{title\}<\/h1>/.test(frame),
  '页眉不再无条件渲染 h1',
)
// 两端都必须按「是否全屏演示」决定层级，且三个调用点一个都不能漏
for (const app of ['admin', 'partner']) {
  const page = read(`apps/${app}/src/routes/screen/index.tsx`)
  const view = read(`apps/${app}/src/routes/screen/screenView.tsx`)
  check(
    /const headingLevel = presenting \? 1 : 2/.test(page),
    `apps/${app} 按是否全屏演示决定标题层级（嵌入 h2 / 全屏 h1）`,
  )
  // 孪生大屏的页眉都在共用外壳里：页面只把层级放进下发给各页签的 chrome，外壳原样透传
  check(
    /const chrome: ScreenChrome = \{\s*headingLevel,/.test(page),
    `apps/${app} 把按展示与否算出的 headingLevel 放进下发给各页签的 chrome`,
  )
  check(
    /headingLevel: ScreenHeadingLevel/.test(view) && /export type ScreenChrome = TwinChrome & \{ headingLevel: ScreenHeadingLevel \}/.test(view),
    `apps/${app} 的 chrome 类型把 headingLevel 收窄为 1 | 2，不自己决定层级`,
  )
}
const twinFrame = read('packages/ui/src/screen/twin/TwinFrame.tsx')
check(
  (twinShell.match(/headingLevel=\{headingLevel\}/g) ?? []).length >= 4
    && /const headingLevel = chrome\.headingLevel/.test(twinShell),
  '孪生外壳把 chrome 的 headingLevel 原样透传给页眉与块位（有数据 / 无数据两种外壳都是）',
)
check(
  /^\s{2}headingLevel: ScreenHeadingLevel$/m.test(twinFrame)
    && /const Heading = headingLevel === 1 \? 'h1' : 'h2'/.test(twinFrame)
    && !/headingLevel\s*=\s*[12]/.test(stripComments(twinFrame)),
  '孪生页眉按层级渲染真实 h1 / h2，headingLevel 必填且没有默认值',
)
check(
  /TwinPanelHeadingContext\.Provider value=\{headingLevel === 1 \? 2 : 3\}/.test(twinFrame),
  '孪生面板标题比页眉低一级（页眉 h1 → 面板 h2；页眉 h2 → 面板 h3）',
)
// 不许用 CSS 把多出来的 h1 藏掉：那只骗眼睛，读屏器和 locator 照样看得见
check(
  !/\.ops-hd\s+h1\s*\{[^}]*display:\s*none/.test(css),
  '没有用 display:none 隐藏多余标题（层级要真的改，不是藏起来）',
)
// 字阶要同时覆盖 h1 与 h2，否则降级成 h2 后字号掉回浏览器默认
check(
  (css.match(/\.ops-hd :is\(h1, h2\)/g) ?? []).length >= 3,
  '页眉字阶三处（基础 / wall / desk）都同时覆盖 h1 与 h2',
)
check(
  (css.match(/\.twin-hd :is\(h1, h2\)/g) ?? []).length >= 3,
  '孪生页眉字阶三处（基础 / wall / desk）都同时覆盖 h1 与 h2',
)

// ── 15. 路由与侧栏接线 ────────────────────────────────────────────────────
const adminRoutes = read('apps/admin/src/routes/index.tsx')
const adminLayout = read('apps/admin/src/layouts/AdminLayoutWrapper.tsx')
const partnerRoutes = read('apps/partner/src/routes/index.tsx')
const partnerLayout = read('apps/partner/src/layouts/PartnerLayoutWrapper.tsx')
check(/path: 'screen',\s*element: <ScreenPage \/>/.test(adminRoutes), '管理员 /screen 路由已注册')
check(/path: 'screen',\s*element: <ScreenPage \/>/.test(partnerRoutes), '机构 /screen 路由已注册')
check(
  /path: 'screen\/:tab',\s*element: <ScreenPage \/>/.test(adminRoutes) && /path: 'screen\/:tab',\s*element: <ScreenPage \/>/.test(partnerRoutes),
  '两端 /screen/:tab 页签路由已注册（每个页签一个地址）',
)
check(
  /location\.pathname\.startsWith\('\/screen\/'\) \? 'screen'/.test(adminLayout) && /location\.pathname\.startsWith\('\/screen\/'\) \? 'screen'/.test(partnerLayout),
  '两端侧栏在 /screen/* 页签下仍高亮「数据大屏」',
)
check(
  /if \(raw === 'gov' \|\| raw === 'usage' \|\| raw === 'ops' \|\| raw === 'terminal'\) return raw/.test(read('apps/admin/src/routes/screen/screenTabs.ts'))
    && /return raw === 'usage' \|\| raw === 'terminal' \? raw : 'overview'/.test(read('apps/partner/src/routes/screen/screenTabs.ts')),
  '非法页签在前端纠正为默认页签，不渲染未知视图',
)
check(/'\/screen':\s*'screen'/.test(adminLayout) && /key: 'screen'/.test(adminLayout), '管理员侧栏有数据大屏入口')
check(/'\/screen':\s*'screen'/.test(partnerLayout) && /key: 'screen'/.test(partnerLayout), '机构侧栏有数据大屏入口')
check(
  (adminLayout.match(/key: 'screen'/g) ?? []).length === 1
    && (partnerLayout.match(/key: 'screen'/g) ?? []).length === 1,
  '两侧各只有一个数据大屏入口，没有重复导航',
)
check(
  /screen:/.test(read('apps/partner/src/routes/Page.tsx')),
  '机构大屏页有 FRONTEND_HINT 归属说明',
)

// ── 16. 服务人次与累计打印口径（W-68 / W-69）────────────────────────────
const govGrid = read('apps/admin/src/routes/screen/GovGrid.tsx')
const partnerGrid = read('apps/partner/src/routes/screen/PartnerGrid.tsx')
const partnerVisit = read('apps/partner/src/routes/screen/PartnerVisitStat.tsx')
const adminUsage = read('apps/admin/src/routes/screen/UsageView.tsx')
const partnerUsage = read('apps/partner/src/routes/screen/PartnerUsageView.tsx')
const partnerUsageOff = read('apps/partner/src/routes/screen/PartnerUsageHostingOff.tsx')
const twinBoard = read('packages/ui/src/screen/twin/TwinTerminalBoard.tsx')
const primaryBlock = partnerLabels.slice(
  partnerLabels.indexOf('export const PARTNER_PRIMARY_KEYS'),
  partnerLabels.indexOf('export function buildPartnerGapEntries'),
)
check(/今日服务人次/.test(govGrid) && /是会话数，不是人数/.test(govGrid), '政务版有「今日服务人次」格，并注明是会话数不是人数')
check(
  /按出纸任务 × 份数计，双面时实际用纸更少/.test(govGrid),
  '政务版累计打印注明按出纸任务乘以份数计，双面时实际用纸更少',
)
check(/screenCount\(g\.visitCount\.value\)/.test(govGrid), '政务版服务人次直接取下发的数，1–4 次也不在前端改写成「少于 5」')
check(primaryBlock.includes("'visitCount'"), '机构主栅格键包含 visitCount，服务人次不会掉进归并')
check(/<PartnerVisitStat\b/.test(partnerGrid) && /今日服务人次/.test(partnerVisit) && /会话数，不是人数/.test(partnerVisit), '机构总览渲染服务人次主栅格卡，并注明是会话数')
check(/title:\s*'少于 5'/.test(copyBlock), '1–4 次的原因显示为「少于 5」，不显示原数')
check(/short:\s*'暂时取不到'/.test(copyBlock), '源查询失败显示「暂时取不到」')
check(/数据量超出统计上限，显示不全/.test(copyBlock), '统计行数超上限如实写「数据量超出统计上限，显示不全」')
check(!/接入前不显示/.test(twinBoard), '单台孪生不再写服务人次接入前不显示')
check(/少于 5/.test(twinBoard) && /暂时取不到/.test(twinBoard), '单台孪生说明里写明少于 5 与暂时取不到')
check(
  govGrid.includes('近 14 个上海自然日，只统计已经出纸的任务：页数按打印页数乘以份数，记在出纸完成的那一天。')
    && govGrid.includes('付了款但没出纸的不算')
    && govGrid.includes('「今日」是今天 0 点到明天 0 点已经出纸的页数。')
    && twinBoard.includes('今日打印页数只统计这台机器今天已经出纸的页数（打印页数乘以份数，按出纸完成时间，上海自然日）')
    && twinBoard.includes('打印页数、打印任务、扫描、打印失败大于 0 且少于 5 时只显示「少于 5」')
    && twinBoard.includes('服务人次是今天在这台机器上开始的使用次数。')
    && twinBoard.includes('1 到 4 次显示「少于 5」，取不到时显示「暂时取不到」')
    && govGrid.includes('乘以份数')
    && govGrid.includes('出纸')
    && twinBoard.includes('乘以份数')
    && twinBoard.includes('出纸')
    && !govGrid.includes('不乘份数')
    && !govGrid.includes('已支付打印订单的内容页')
    && !twinBoard.includes('已支付订单页数'),
  '政务版趋势与单台今日说明都在，且都写明乘以份数、按出纸计',
)
for (const [name, source] of [
  ['管理员服务调用', adminUsage],
  ['机构信息使用', partnerUsage],
  ['机构信息使用（托管关闭）', partnerUsageOff],
]) {
  check(!/访问人次/.test(source), `${name}不再把服务人次叫成访问人次`)
  check(!/kiosk_session_unwritten/.test(source), `${name}不再把缺席的服务人次猜成会话未写入`)
  check(!/as \{ value: unknown \}/.test(source), `${name}按数字类型取值，不再把契约当成 never`)
}
function stripStrings(source) {
  return source
    .replace(/`(?:\\[\s\S]|[^`])*`/g, '``')
    .replace(/'(?:\\.|[^'\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\n])*"/g, '""')
}
// 原因码可以留在字符串里交给文案表翻译。可见文字是标签之间、花括号表达式之外的原文。
const REASON_CODES = ['sample_below_threshold', 'source_query_failed', 'window_row_cap_exceeded', 'kiosk_session_unwritten']
for (const file of screenFiles) {
  const code = stripStrings(stripComments(file.source))
  for (const reason of REASON_CODES) {
    check(!new RegExp(`>[^<{]*${reason}`).test(code), `${file.path} 的可见文字不出现原因码 ${reason}`)
  }
}


}
