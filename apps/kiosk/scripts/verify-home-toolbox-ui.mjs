/**
 * 百宝箱布局守卫（prototype-v1 首页迁移后调整）。
 *
 * 背景：01-home.html 原型把百宝箱画成首页聚合 zone-card；生产的可启动 items +
 * 启动弹窗 + 匿名事件上报能力经用户批准迁到 /toolbox 区页（ToolboxZonePage）。
 * 本守卫随结构迁移调整读取目标，真实能力断言等价或更强，不弱化：
 *   A. /toolbox 区页 config 驱动，并保留组件内部防御性「待配置」分支；
 *      路由父边界在无安全可启动项时不会挂载该业务页。
 *   B. 首页 zone-row 中百宝箱聚合卡排在智慧校园之前，并 → /toolbox。
 *   C. /toolbox 保留统一终端配置读取 + 站内/外部H5/二维码启动 + 扫码提示 +
 *      外部离场确认 + 匿名事件上报（launch modals 文件未变，断言保留）。
 *   C2. 百宝箱外部 H5 不在点击时直接整页跳出。
 *   D. 智慧校园保留终端开关隐藏逻辑并渲染后台投放应用项。
 *   E/E2. 终端默认配置 + 事件上报 sendBeacon/keepalive 且不发送 URL/host。
 *
 * 运行：pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), 'utf8') : '')

let failed = 0
const pass = (msg) => console.log(`  PASS ${msg}`)
const fail = (msg) => {
  console.error(`  FAIL ${msg}`)
  failed++
}

const home = read('src/pages/home/HomePage.tsx')
const homeDomains = read('src/pages/home/homeV6Domains.ts')
const homeView = read('src/pages/home/components/V6HomeView.tsx')
const toolboxPage = read('src/pages/toolbox/ToolboxZonePage.tsx')
const launchHelpers = read('src/pages/home/components/kioskAppLaunch.ts')
const toolboxHook = read('src/hooks/useToolboxConfig.ts')
const capabilityGuard = read('src/auth/KioskCapabilityGuard.tsx')
const capabilityValidation = read('src/services/api/kioskCapabilityValidation.ts')
const launchModals = read('src/pages/home/components/ToolboxLaunchModals.tsx')
const terminalConfig = read('src/services/api/terminalConfig.ts')
const toolboxLaunchEvents = read('src/services/api/toolboxLaunchEvents.ts')
const routes = read('src/routes/index.tsx')
const packageJson = read('package.json')

console.log('\n=== 百宝箱布局验证（prototype-v1 + /toolbox 区页）===')

// A. /toolbox 区页 config 驱动 + 内部防御性「待配置」分支（不声明路由可达）
if (
  toolboxPage.includes('export function ToolboxZonePage(') &&
  toolboxPage.includes('useToolboxCapabilitySnapshot()') &&
  toolboxPage.includes('config.enabled ?') &&
  toolboxPage.includes('待配置') &&
  toolboxPage.includes('后续功能上线后将在这里展示')
) {
  pass('A. /toolbox 区页由真实 config 驱动且保留内部防御性「待配置」分支')
} else {
  fail('A. /toolbox 区页必须 config 驱动且保留内部防御性待配置分支')
}

// B. V6 首页固定展示八个服务域；百宝箱在智慧校园之前，且 → /toolbox。
const toolboxCard = homeDomains.indexOf("id: 'toolbox'")
const campusCard = homeDomains.indexOf("id: 'campus'")
if (
  toolboxCard >= 0 &&
  campusCard >= 0 &&
  toolboxCard < campusCard &&
  /toolbox:\s*['"]\/toolbox['"]/.test(homeDomains)
) {
  pass('B. V6 首页百宝箱排在智慧校园前且 action 映射进入 /toolbox')
} else {
  fail('B. V6 首页百宝箱必须排在智慧校园前并进入 /toolbox')
}

// /toolbox 路由已注册
if (/path:\s*'toolbox'/.test(routes) && /ToolboxZonePage/.test(routes)) {
  pass('B2. /toolbox 路由已注册到 ToolboxZonePage')
} else {
  fail('B2. /toolbox 路由必须注册到 ToolboxZonePage')
}

// C. /toolbox 保留统一配置读取 + 三种启动方式 + 扫码提示 + 离场确认 + 事件上报
if (
  toolboxHook.includes('getKioskTerminalConfig(terminalId)') &&
  toolboxHook.includes('terminalConfig.toolbox') &&
  toolboxHook.includes('parseKioskTerminalConfig') &&
  toolboxPage.includes('launchKioskAppItem') &&
  toolboxPage.includes('isLaunchableKioskAppItem') &&
  toolboxPage.includes('QrLaunchModal') &&
  toolboxPage.includes('ExternalLaunchModal') &&
  // 启动分发逻辑已抽到共享助手 kioskAppLaunch（两侧同源不发散）；断言随之指向该文件
  launchHelpers.includes('onExternal(item)') &&
  launchHelpers.includes('navigate(item.to)') &&
  launchModals.includes('function targetLabel') &&
  launchModals.includes('运营方声明目标') &&
  launchModals.includes('即将进入第三方服务') &&
  launchModals.includes('返回首页') &&
  launchModals.includes('role="dialog"') &&
  launchModals.includes("target.split('?')[0]") &&
  launchModals.includes('本终端不记录你在第三方页面的办理结果') &&
  launchModals.includes("action: 'show_qr'") &&
  launchModals.includes("action: 'open_external_notice'") &&
  launchModals.includes("action: 'open_external_confirmed'") &&
  launchModals.includes("action: 'cancel_external'") &&
  launchModals.includes('recordToolboxLaunchEventBeforeUnload')
) {
  pass(
    'C. /toolbox 从统一终端配置读取并支持站内/外部H5/二维码启动、扫码提示、外部离场确认和匿名事件上报'
  )
} else {
  fail('C. /toolbox 统一终端配置、启动方式、扫码提示、外部离场确认或匿名事件上报缺失')
}

// C2. 外部 H5 不在点击时直接整页跳出
if (
  !toolboxPage.includes('window.location.assign(item.externalUrl)') &&
  !home.includes('window.location.assign(item.externalUrl)')
) {
  pass('C2. 百宝箱外部 H5 不在点击时直接整页跳出（先走离场确认）')
} else {
  fail('C2. 百宝箱外部 H5 必须先展示离场提示，不得点击时直接跳转')
}

// D. V6 首页保留两个域的位置，但配置关闭时必须 disabled + 可见原因，不能隐藏或放行。
if (
  home.includes('useSmartCampusCapabilityState()') &&
  home.includes('useToolboxCapabilityState()') &&
  home.includes("campus.status === 'ready' && campus.enabled") &&
  home.includes("toolbox.status === 'ready' && toolbox.enabled") &&
  /domain\.id === 'toolbox'[\s\S]{0,80}\? !toolboxEnabled/.test(homeView) &&
  /domain\.id === 'campus'[\s\S]{0,80}\? !campusEnabled/.test(homeView) &&
  homeView.includes('本机默认关闭，学校接入并完成配置后开放') &&
  homeView.includes('本机尚未上架扩展服务')
) {
  pass('D. V6 首页保留百宝箱/智慧校园位置，关闭时真实禁用并说明原因')
} else {
  fail('D. V6 首页百宝箱/智慧校园必须可见但关闭时 fail-closed')
}

// E. 终端底层兼容默认不能成为路由授权；能力边界必须只接受 ready+有效启动项。
if (
  terminalConfig.includes('toolbox: { enabled: true, items: [] }') &&
  toolboxHook.includes('config.items.some(isLaunchableKioskAppItem)') &&
  capabilityGuard.includes("state.status === 'ready'") &&
  capabilityGuard.includes('state.terminalId === currentTerminalId')
) {
  pass('E. 百宝箱底层兼容默认不会绕过能力边界')
} else {
  fail('E. 百宝箱只有已确认且至少一个有效启动项时才可进入')
}

// E2. 事件上报 sendBeacon/keepalive 且不发送 URL/host
if (
  toolboxLaunchEvents.includes('navigator.sendBeacon') &&
  toolboxLaunchEvents.includes('keepalive: true') &&
  toolboxLaunchEvents.includes("credentials: 'omit'") &&
  toolboxLaunchEvents.includes("API_MODE !== 'http'") &&
  toolboxLaunchEvents.includes('getTerminalId()') &&
  !toolboxLaunchEvents.includes('targetHost') &&
  !toolboxLaunchEvents.includes('externalUrl')
) {
  pass('E2. Kiosk 百宝箱事件上报使用 sendBeacon/keepalive 且不发送 URL/host')
} else {
  fail('E2. Kiosk 百宝箱事件上报必须可靠且不得发送 URL/host')
}

// E3. Kiosk 本地兜底同样必须为空，并完整尊重后端 enabled/items。
if (
  toolboxHook.includes("status: 'loading'") &&
  toolboxHook.includes('enabled: false') &&
  toolboxHook.includes('activeController?.abort()') &&
  toolboxHook.includes('requestGeneration !== generation') &&
  capabilityValidation.includes('isValidKioskAppItem') &&
  !toolboxHook.includes('cached') &&
  !toolboxHook.includes('stale')
) {
  pass('E3. 百宝箱初始、刷新、异常与乱序响应均 fail-closed')
} else {
  fail('E3. 百宝箱不得因缓存、畸形配置或请求失败公开未授权服务')
}

// F. package.json 注册
if (packageJson.includes('"verify:home-toolbox-ui"')) {
  pass('F. package.json 注册 verify:home-toolbox-ui')
} else {
  fail('F. package.json 缺少 verify:home-toolbox-ui')
}

if (failed > 0) {
  console.error(`\nFAIL ${failed} 项失败：百宝箱布局验证未通过`)
  process.exit(1)
}
console.log('\nALL PASS — 百宝箱布局（prototype-v1 + /toolbox 区页）符合预期\n')
