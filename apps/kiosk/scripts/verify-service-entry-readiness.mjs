import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

let failures = 0
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`)
  else {
    failures += 1
    console.error(`  FAIL ${message}`)
  }
}

console.log('\n=== Kiosk 入口服务真实性守卫 ===')

const readinessHook = read('src/hooks/useApiReadiness.ts')
for (const marker of [
  "'checking' | 'ready' | 'unavailable'",
  'AbortController',
  "cache: 'no-store'",
  '/health',
  'READINESS_TIMEOUT_MS',
]) {
  check(readinessHook.includes(marker), `在线服务探测保留 ${marker}`)
}


// 2026-09-20：五个服务台（/resume-service /jobs-service /fairs-service
// /interview-service /policy-service）迁入青序流光，五份旧壳页面已从路由摘掉，
// 共用 src/pages/service-hubs/QxServiceHubPage.tsx 一份实现。
//
// 断言改钉**活面**而不是那五个不再渲染的文件——门禁钉在死代码上就是只剩形式。
// 不变量一条没放宽，只是换了它该看的地方：
//   · 入口级在线服务探测仍在；
//   · checking 与 unavailable 都 fail-closed（不是只拦 unavailable）；
//   · 被拦的能力不得仍是可点控件，且必须说得出原因；
//   · 旧壳 `requiresApi: false` 的四个入口仍然离线可进，其余仍然 fail-closed。
const hubPage = read('src/pages/service-hubs/QxServiceHubPage.tsx')
const hubModel = read('src/pages/service-hubs/serviceHubModel.ts')
const hubSpecs = read('src/pages/service-hubs/serviceHubSpecs.ts')

// 状态条的三态诚实话术随组件一起搬进服务台自己的提示条（旧 ServiceReadinessStrip
// 组件已随五页删除）。这条判据一字未改，只是钉到了真正渲染它的地方。
check(!/AI.*已连接/.test(hubPage), '健康检查不扩大声明为 AI 能力已连接')
// ready 态也必须出声。公共终端上「什么都没显示」会被读成「一切正常」，
// 所以就绪时说的是「进入后再确认」，而不是替下游页面承诺能办。
check(
  hubPage.includes('本页只负责分流，不预报在线、名额、价格或办理结果'),
  '服务台就绪态不预报在线 / 名额 / 价格 / 办理结果'
)

check(hubPage.includes('useApiReadiness'), '服务台使用入口级在线服务探测')
check(hubPage.includes('useTerminalDeviceStatus'), '服务台设备类能力看真实终端设备状态')
// 「检查中」与「不可用」都必须算 blocked。只拦 unavailable 等于用「还不知道」冒充「可以用」。
check(
  /apiChecking:\s*apiStatus === 'checking'/.test(hubPage) &&
    /apiDown:\s*apiStatus === 'unavailable'/.test(hubPage),
  '服务台把 checking 与 unavailable 分开取，两者都进降级判据'
)
check(
  /const apiBlocked = apiStatus !== 'ready'/.test(hubPage),
  '服务台 apiBlocked 覆盖 checking 与 unavailable（fail-closed）'
)
check(
  /if \(state\.apiChecking\) return/.test(hubModel) &&
    /if \(state\.deviceChecking\) return/.test(hubModel),
  '降级判据在「正在确认」阶段同样返回不可用原因（不得放行）'
)
// 被拦时不是「灰掉的按钮」而是一张说明原因的非可点卡片：CLAUDE.md §9「不伪造能力」，
// 点不动必须说得出为什么。
check(
  /className="qx-hub-card is-unavailable"[\s\S]*?role="group"[\s\S]*?aria-disabled="true"/.test(hubPage),
  '不可用能力不再是可点控件（role=group + aria-disabled）'
)
check(
  /data-disabled-reason=\{`capability:\$\{cap\.kind\}`\}/.test(hubPage),
  '不可用能力带 data-disabled-reason，原因可被走查取证'
)
for (const copy of ['正在确认在线服务', '在线服务暂不可用', '重新检测']) {
  check(hubPage.includes(copy), `服务台展示真实检查状态「${copy}」`)
}
check(/onClick=\{retryApi\}/.test(hubPage), '服务台保留在线服务重新检测入口')

// 旧壳五页把「后端不可达也能进」写成 `requiresApi: false`，**默认 true**；
// 迁移必须原样保住这条 fail-closed，不能因为稿把浏览类标成 `kind: 'info'`
// 就让 /jobs、/job-fairs、/me/* 在后端断开时仍写着「进入 →」。
// 青序流光把它收进 serviceHubModel 的 needsBackend()：白名单登记即可离线进，
// 未登记一律按需要后端。下面两族断言分别钉「白名单里有什么」和「默认是拒绝」。
const OFFLINE_ENTRIES = [
  ['/jobs/online-platforms', '线上招聘平台保留离线二维码入口'],
  ['/interview/tips', '面试技巧保留离线阅读入口'],
  ['/renshi?tab=social', '社保指南保留离线指引入口'],
  ['/renshi?tab=register', '档案与登记保留离线指引入口'],
]
for (const [route, label] of OFFLINE_ENTRIES) {
  check(
    new RegExp(`route: '${route.replace(/[?]/g, '\\$&')}',\\s*kind: 'info'`).test(hubSpecs) &&
      new RegExp(`'${route.replace(/[?]/g, '\\$&')}',`).test(
        hubModel.slice(hubModel.indexOf('OFFLINE_CAPABLE_ROUTES')),
      ),
    label
  )
}
check(
  /export function needsBackend\(route: string\): boolean \{\s*return !OFFLINE_CAPABLE_ROUTES\.has\(route\)/.test(
    hubModel,
  ),
  '离线可进是白名单制：未登记的路由一律按需要后端（fail-closed）'
)
// 判据要真的作用在每张卡上：unavailableReason 必须拿到该卡的 route，
// 否则白名单写得再对也落不到界面上。
check(
  /unavailableReason\(cap\.kind, cap\.route, availability\)/.test(hubPage) &&
    /unavailableReason\(link\.kind, link\.route, availability\)/.test(hubPage),
  '能力卡与常用入口都按各自 route 判定是否可进'
)
check(
  /unavailableReason\(kind, goal\.route, availability\)/.test(hubPage) &&
    /capabilityKindFor\(spec, goal\.route\)/.test(hubPage),
  '目标分段与能力卡共用同一条 fail-closed 判据，不得另开一条可点通道'
)
{
  const noticeFn = hubPage.slice(hubPage.indexOf('function noticeCopy'), hubPage.indexOf('export function QxServiceHubPage'))
  const apiDownAt = noticeFn.indexOf('if (state.apiDown)')
  const apiCheckingAt = noticeFn.indexOf('if (state.apiChecking)')
  const deviceOffAt = noticeFn.indexOf('if (state.deviceOff)')
  check(
    apiDownAt >= 0 && apiCheckingAt > apiDownAt && deviceOffAt > apiCheckingAt,
    '分流提示条：apiDown / apiChecking 优先于 deviceOff（device-off 文案会声称 AI 仍可进入）'
  )
}
check(
  /if \(!needsBackend\(route\)\) return null/.test(hubModel) &&
    /if \(state\.apiDown\) return '在线服务当前不可用'/.test(hubModel) &&
    /if \(state\.apiChecking\) return '正在确认在线服务'/.test(hubModel),
  '需要后端的入口在 unavailable / checking 下都给出原因（两半都 fail-closed）'
)

// 规格表 ↔ 稿 16-service-hubs.html 的转录对账。
// 这份 36 张卡 / 17 个目标 / 15 条常用入口的规格是机械抽取产物；2026-09-10 那版
// 漏掉稿里的 quick，15 条通往「我的」台账的入口静默消失过一次。手改 specs、
// 或改了稿没重跑抽取，在这里当场变红。
const { SERVICE_HUB_SPECS_TEXT, SERVICE_HUB_SPECS_COUNTS } = await import(
  './extract-service-hub-specs.mjs'
)
check(
  hubSpecs === SERVICE_HUB_SPECS_TEXT,
  `serviceHubSpecs.ts 与稿 16-service-hubs.html 逐字节一致（hubs=${SERVICE_HUB_SPECS_COUNTS.hubs} cards=${SERVICE_HUB_SPECS_COUNTS.cards} goals=${SERVICE_HUB_SPECS_COUNTS.goals} quick=${SERVICE_HUB_SPECS_COUNTS.quick}）；不一致请跑 node scripts/extract-service-hub-specs.mjs 而不是手改`
)

const printScanHome = read('src/pages/print-scan/PrintScanHomePage.tsx')
check(printScanHome.includes('loadConfiguredCapabilities'), '打印扫描首页保留能力加载状态')
check(!printScanHome.includes('getConfiguredCapabilities'), '打印扫描首页不再吞掉能力加载失败')
// P39 迁移（V6 纵切第一刀）把「能力是否已确认」从行内三元收成
// toProbeStatus() + confirmed 两步，断言随结构改写，**不变量一字未变**：
// 只有探测结果不是 error 才判定为已确认，其余一律 fail-closed。
check(
  /function toProbeStatus[\s\S]*?load\.status === 'error' \? 'error' : 'ok'/.test(printScanHome),
  '能力探测失败一律判为未确认（不得把 error 当成可放行）'
)
check(
  /const confirmed = probe === 'ok'/.test(printScanHome),
  '只有能力配置读取成功才放行任务入口'
)
check(/available: false,[\s\S]*?to: ''/.test(printScanHome), '能力未确认时正式任务入口 fail-closed')
for (const forbidden of ['AI 就绪', '自动双面打印', '一次最多 50 页', '固定输出 PDF']) {
  check(!printScanHome.includes(forbidden), `打印扫描首页不再显示未证明断言「${forbidden}」`)
}

const capabilityApi = read('src/services/api/printScanCapabilities.ts')
for (const marker of ['AbortController', "cache: 'no-store'", 'CAPABILITY_TIMEOUT_MS']) {
  check(capabilityApi.includes(marker), `能力配置请求保留 ${marker}`)
}

const home = read('src/pages/home/HomePage.tsx')
check(home.includes('useTerminalDeviceStatus'), '首页本机卡使用真实打印机状态')
for (const forbidden of ['文档打印就绪', '材料扫描就绪', '自动双面可用']) {
  check(!home.includes(forbidden), `首页不再硬编码「${forbidden}」`)
}

const upload = read('src/pages/print/PrintUploadPage.tsx')
check(!upload.includes('生产 Kiosk 将切换为 Agent 文件中转'), '打印上传页不显示内部实现横幅')
check(!upload.includes('import { API_MODE }'), '打印上传页移除仅供开发横幅使用的 API_MODE import')

console.log('')
if (failures > 0) {
  console.error(`=== FAILED: ${failures} assertion(s) ===\n`)
  process.exit(1)
}
console.log('=== ALL PASS ===\n')
