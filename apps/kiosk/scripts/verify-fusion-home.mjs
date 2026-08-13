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
check(
  fairHook.includes('getJobFairs(terminalId ? { terminalId } : undefined)') &&
    fairHook.includes("fair.reviewStatus !== 'approved'") &&
    fairHook.includes("fair.publishStatus !== 'published'") &&
    fairHook.includes("fair.status !== 'ongoing'") &&
    fairHook.includes("fair.status !== 'upcoming'") &&
    fairHook.includes('endTime > now'),
  '首页招聘会复用真实接口并二次过滤审核、发布、时态与结束时间'
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
check(
  manifest.includes("'print-phone': '/print/upload?source=document&tab=qr'"),
  '手机扫码传先进入 Kiosk 真上传会话页'
)
check(
  manifest.includes("'print-local': '/print/upload?source=document&tab=file'") &&
    manifest.includes("'print-usb': '/print/upload?source=document&tab=usb'"),
  '本机与 U 盘入口由既有 PrintUploadPage 消费'
)
check(!manifest.includes('/upload/phone'), 'Kiosk 首页不会直接打开手机辅助页')

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
