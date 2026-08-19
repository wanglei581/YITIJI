import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const pass = (message) => console.log(`  PASS ${message}`)
const check = (condition, message) => {
  assert.ok(condition, message)
  pass(message)
}

const home = read('src/pages/home/HomePage.tsx')
const view = read('src/pages/home/components/V6HomeView.tsx')
const footer = read('src/pages/home/components/V6HomeFooterPanels.tsx')
const fairHook = read('src/pages/home/hooks/useHomeJobFairHighlight.ts')
const manifest = read('src/pages/home/homeV6Domains.ts')
const css = [
  read('src/pages/home/styles/home-v6.css'),
  read('src/pages/home/styles/home-v6-footer.css'),
  read('src/pages/home/styles/home-v6-motion-responsive.css'),
].join('\n')
const kioskRoot = read('src/layouts/KioskRoot.tsx')

console.log('\n=== Kiosk V6 首页运行时合同 ===')

check(home.includes('KioskPageFrame className="v6-home-page"'), '首页继续复用共享 KioskPageFrame')
check(home.includes('<V6HomeView'), '容器与 V6 presentation 已拆分')
check(home.includes("import './styles/home-v6.css'"), '首页只导入 V6 页级样式')
check(
  !home.includes('prototype-v1.css') &&
    !home.includes('kiosk-uplift.css') &&
    !view.includes('kpv1'),
  '首页不再混入 75 屏 prototype-v1 视觉'
)
check(
  home.includes('useOutletContext<TerminalDeviceStatusView>()') &&
    home.includes('device.printerReady'),
  '设备状态来自共享运行时真值'
)
check(
  home.includes('useToolboxCapabilityState()') && home.includes('useSmartCampusCapabilityState()'),
  '首页读取百宝箱与智慧校园已验证能力状态'
)
check(
  home.includes("campus.status === 'ready' && campus.enabled") &&
    home.includes("toolbox.status === 'ready' && toolbox.enabled"),
  '未知、加载中或关闭能力点击均 fail-closed'
)
check(home.includes("navigate('/login', { state: { from: '/' } })"), '登录入口保留安全返回路径')
check(
  home.includes('useHomeJobFairHighlight()') && home.includes('<V6HomeFooterPanels'),
  '首页恢复真实招聘会与本机状态双面板'
)
// 审核 / 发布闸门在服务端：getPublishedFairs 的 where 恒带
// `reviewStatus:'approved', publishStatus:'published'`，而公开列表 DTO
// （FairListItemDto）**刻意不下发**这两个字段。
//
// 这条断言原先要求 hook 里也比对它们，等于把一个 P0 钉死：真实接口下两者恒为
// undefined，`undefined !== 'approved'` 恒真，每一场都被判不合格，首页永远显示
// 「暂无进行中或即将开始的招聘会」。mock 数据带这两个字段，所以只在接真后才暴露。
//
// 现在反过来断言它们**不在**：谁再把这层不可能成立的过滤加回来就打红。
check(
  fairHook.includes('getJobFairs(terminalId ? { terminalId } : undefined)') &&
    fairHook.includes("fair.status !== 'ongoing'") &&
    fairHook.includes("fair.status !== 'upcoming'") &&
    fairHook.includes('endTime > now'),
  '首页招聘会复用真实接口并过滤时态与结束时间'
)
check(
  !fairHook.includes('fair.reviewStatus') && !fairHook.includes('fair.publishStatus'),
  '首页不拿列表 DTO 不下发的字段做过滤（审核/发布闸门归服务端）'
)
check(
  footer.includes('暂无进行中或即将开始的招聘会') &&
    footer.includes('暂时无法获取招聘会信息') &&
    footer.includes('正在读取已发布场次'),
  '招聘会 loading/empty/error 状态均诚实且稳定'
)
check(
  footer.includes('device: TerminalDeviceStatusView') &&
    footer.includes('device.printerLabel') &&
    footer.includes('device.networkLabel'),
  '本机面板复用 KioskRoot 已有终端状态快照，不发起第二次轮询'
)
check(
  footer.includes('未单独上报') &&
    !/78%|62%|碳粉充足|扫描仪就绪/.test(footer),
  '纸张、碳粉、扫描仪不伪造原型百分比或就绪状态'
)
check(
  home.includes("navigate(`/job-fairs/${encodeURIComponent(fairId)}`)") &&
    footer.includes("onAction('fairs-hub')") &&
    footer.includes("onAction('print-hub')"),
  '招聘会详情、招聘会服务与打印扫描均复用现有真实入口'
)

const domainManifest = manifest.slice(manifest.indexOf('export const HOME_V6_DOMAINS'))
const domainIds = [
  ...domainManifest.matchAll(/id: '(print|resume|jobs|fairs|interview|policy|toolbox|campus)'/g),
].map((match) => match[1])
assert.deepEqual(domainIds, [
  'print',
  'resume',
  'jobs',
  'fairs',
  'interview',
  'policy',
  'toolbox',
  'campus',
])
pass('八个 V6 服务域顺序唯一且完整')
for (const route of [
  '/print-scan',
  '/resume-service',
  '/jobs-service',
  '/fairs-service',
  '/interview-service',
  '/policy-service',
  '/toolbox',
  '/smart-campus',
]) {
  check(manifest.includes(`'${route}'`), `真实域入口保留 ${route}`)
}
// 2026-08-19 入口直达：三条 URL 尾部各加了 &mode=transfer。原断言用整串精确匹配，
// 与它要守的东西（必须落到 Kiosk 自己的上传会话页、且带正确的 tab）无关，故改为
// 前缀匹配并**新增**一条「三个通道型入口必须带 mode=transfer」。
check(
  manifest.includes("'print-phone': '/print/upload?source=document&tab=qr"),
  '手机扫码传先进入 Kiosk 真上传会话页'
)
check(
  manifest.includes("'print-local': '/print/upload?source=document&tab=file") &&
    manifest.includes("'print-usb': '/print/upload?source=document&tab=usb"),
  '本机与 U 盘入口由既有 PrintUploadPage 消费'
)
check(
  ['print-phone', 'print-usb'].every((id) =>
    new RegExp(`'${id}': '/print/upload\\?[^']*&mode=transfer'`).test(manifest)
  ),
  '手机扫码传与 U 盘两个通道型入口带 mode=transfer，落地页不再重复问一遍通道'
)
// print-local 走 <input type="file">，只是桌面 E2E 验证路径，生产一体机不许弹系统
// 文件对话框（CLAUDE.md §17）。钉死它不得被提升为直达入口 —— 直达会给它一个
// 专属标题「本机上传」，把非生产路径包装成一等公民。
check(
  !/'print-local': '\/print\/upload\?[^']*&mode=transfer'/.test(manifest),
  '本机上传不得配直达入口（桌面验证路径，非一体机生产路径）'
)
check(!manifest.includes('/upload/phone'), 'Kiosk 首页不会直接打开手机辅助页')

// ---- 首页服务域按真实能力说话（2026-08-19）----
// 此前两张大卡写死 disabled={false}，而区块标题承诺「绿色入口可办理」——
// 打印机离线时打印域照样是绿的。但整域置灰同样错：域内有三项不经过打印机。
// 故钉三件事：不许再写死 false、区块标题不再承诺办理结果、状态判据是纯函数且分支正确。
const domainStatus = read('src/pages/home/homeDomainStatus.ts')
check(
  !/disabled=\{false\}/.test(view) || /statusNote=/.test(view),
  '大卡若仍写死 disabled={false}，必须同时提供 statusNote 如实说明真实能力',
)
// 剥注释后再判：解释「为什么删掉这句承诺」的注释里必然引用原文，
// 不剥就会把说明文字判成违规（同一个坑今天已在 verify-compliance-copy 踩过一次）。
const viewCode = view.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
check(!viewCode.includes('绿色入口可办理'), '区块标题不得承诺「可办理」——能不能办由真实设备状态决定')
// 按**代码分支**判，不按字符串出现过 —— 注释里也写着「正在确认」，
// 只查字符串的话把 loading 分支整条删掉照样能过（本轮先破后立实测漏放）。
const statusCode = domainStatus.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
check(
  /if\s*\(\s*input\.deviceLoading\s*\)\s*return\s*\{\s*note:\s*'正在确认/.test(statusCode),
  'loading 态必须先返回「正在确认」，不得提前判离线',
)
check(
  domainStatus.includes("'scan-paper'") && domainStatus.includes('仍可用'),
  '离线态只禁纸质扫描并说明哪些仍可用，不整域封死',
)

check(
  view.includes("HOME_V6_DOMAINS.filter((domain) => domain.size === 'large')"),
  '大卡从唯一 typed manifest 渲染'
)
check(
  view.includes("HOME_V6_DOMAINS.filter((domain) => domain.size === 'small')"),
  '小卡从唯一 typed manifest 渲染'
)
check(
  !view.includes('.filter((tile)') && !view.includes('visibleTiles'),
  '智慧校园关闭时不从首页消失'
)
check(
  /domain\.id === 'campus'[\s\S]{0,80}\? !campusEnabled/.test(view) &&
    view.includes('学校接入并完成配置后开放'),
  '智慧校园默认 visible-but-disabled 并显示原因'
)
check(
  /domain\.id === 'toolbox'[\s\S]{0,80}\? !toolboxEnabled/.test(view) &&
    view.includes('本机尚未上架扩展服务'),
  '百宝箱无配置时 visible-but-disabled 并显示原因'
)
check(
  view.includes('disabled={disabled}') && view.includes('aria-describedby='),
  '禁用卡使用原生 disabled 与可访问原因'
)
check(view.includes('/assets/ai-advisor.png'), 'V6 Hero 复用真实小青视觉资产')
check(
  view.includes('第三方或官方来源') && view.includes('不代收简历') && view.includes('来源平台办理'),
  '首页常驻合规边界'
)
check(!/一键投递|立即投递/.test(`${home}\n${view}\n${manifest}`), '首页拒绝违规投递文案')
check(
  !/12 家来源|本周 3 场|已有 1 份|示例办理单/.test(view),
  '运行时首页不渲染设计稿示例统计或个人数据'
)

check(
  css.includes('.v6-home-services__primary') &&
    /grid-template-columns:\s*1\.55fr\s+1fr/.test(css),
  '1080×1920 首行保持 V6 一大一中布局'
)
check(
  css.includes('.v6-home-services__secondary') &&
    /grid-template-columns:\s*repeat\(3,\s*1fr\)/.test(css),
  '1080×1920 次行保持三列服务域'
)
check(
  css.includes('.v6-home-footer-panels') &&
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+330px/.test(css) &&
    /min-height:\s*212px/.test(css),
  '1080×1920 底部恢复约 212px 的 1fr + 330px 双面板锚点'
)
check(
  /\.v6-home-footer-panel button[\s\S]{0,180}min-height:\s*52px/.test(css),
  '底部双面板可点目标不小于 48px'
)
check(
  /@media\s*\(max-width:\s*760px\)/.test(css) &&
    /@media\s*\(max-width:\s*430px\)/.test(css),
  '手机与窄桌面有独立响应式降级'
)
check(
  /@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css) && css.includes('html.lowgpu'),
  '动效提供 reduced-motion 与 lowgpu 退化'
)
check(
  css.includes('@keyframes v6-home-sheen') && css.includes('@keyframes v6-home-orbit'),
  'V6 语义动效已实现'
)
check(!css.includes('.kpv1'), 'V6 首页样式完全路由作用域化')

check(
  kioskRoot.includes('useTerminalDeviceStatus(true)') && kioskRoot.includes('<KioskTopbarStatus'),
  '共享顶栏继续使用真实设备状态'
)
check(
  kioskRoot.includes('<KioskStageFit enabled={!usesFluidViewport}>'),
  '1080×1920 舞台缩放能力未被替换'
)
check(
  home.split('\n').length < 120 &&
    view.split('\n').length < 260 &&
    footer.split('\n').length < 220 &&
    fairHook.split('\n').length < 120 &&
    manifest.split('\n').length < 180,
  '运行时文件保持可维护体积'
)

console.log('\nALL PASS — V6 首页视觉、动作、门控与响应式合同成立\n')
