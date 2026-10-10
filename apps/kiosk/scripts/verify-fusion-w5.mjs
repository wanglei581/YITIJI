import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex')

// 第八次 8-7：真实卸载作废未收文件的会话，StrictMode 重放和确认过程有守卫。
for (const path of ['src/pages/upload/components/UploadSessionQrPanel.tsx', 'src/pages/upload/hooks/useUploadSession.ts']) {
  const source = read(path)
  assert.match(source, /mountedRef\.current = true[\s\S]*return \(\) => \{[\s\S]*mountedRef\.current = false[\s\S]*queueMicrotask\(\(\) => \{[\s\S]*if \(mountedRef\.current \|\| confirmingRef\.current\) return[\s\S]*if \(!existing \|\| phase === 'uploaded' \|\| phase === 'confirmed' \|\| phase === 'cancelled' \|\| phase === 'expired'\) return[\s\S]*void cancelUploadSession\(existing\.sessionId, existing\.controlToken\)\.catch\(\(\) => undefined\)/, `8-7 ${path} 卸载静默作废且避开重放与确认`)
}
console.log('PASS 8-7 两套上传真实卸载静默作废')

const W5_ROUTES = [
  '/member/qr-login', '/upload/phone', '/login', '/legal/:doc',
  '/screensaver', '/session-timeout', '/error-offline', '/profile',
  '/me/resumes', '/me/print-orders', '/me/documents', '/me/favorites',
  '/me/ai-records', '/me/benefits', '/me/activity', '/me/activity/:id',
  '/me/notifications', '/me/feedback', '/me/settings', '/me/privacy-requests', '/help',
  '/activities', '/activities/:id', '/toolbox',   '/notifications',
]
const SELF_ASSESSMENT_V1_ROUTES = [
  '/resume/self-assessment/intro',
  '/resume/self-assessment/questions',
  '/resume/self-assessment/result',
  '/resume/self-assessment/history',
]
const W5_ROUTES_EXPANDED = [...W5_ROUTES, ...SELF_ASSESSMENT_V1_ROUTES]

const FROZEN = new Map([
  // W4 L1：掩码、真实冷却/有效期、错误码分态；新基线另由 verify-w4-login-profile-l1 动态回归。
  // 哈希随 A2.1 登录切片同步更新（V6 落 main）：该 hook 的两处错误文案由
  // `cause instanceof MemberApiError ? cause.message : 兜底` 改为统一走
  // resolveMemberApiErrorMessage(cause, 兜底)，行为等价且兜底文案更具体。
  // 冻结契约本身不放宽，仍逐字节校验，只是基线随已评审的有意改动前移。
  ['src/pages/auth/hooks/useMemberPhoneLogin.ts', 'c8c88ed5a85d1e3c3d22d8715a23fc9168a50876b194b3352a182d5ff2c97824'],
  ['src/pages/profile/assets/useMemberProfileOverview.ts', '3679de500e38d9d84b5f77680090997dc27eabca861af58c3d407eeb9e420395'],
  // 哈希随「扫描入口统一到 /scan」同步更新（2026-09-13）：唯一改动是「扫描文件」这条
  // 入口的 route 从兼容重定向地址 '/scan/start' 改成工作台真地址 '/scan'，不增不减入口。
  // 冻结契约不放宽，仍逐字节校验；入口标签与地址另有 verify:profile-inkpaper-home /
  // verify:lightflow-profile-entry 的 22 条对照表钉死。
  // 旧哈希 dad0e5fbf3d7ea3e22ffa852750158d5ee1af50e028a7b8df9fc01c0a3a2b0ae。
  // 2026-09-28 用词：账号设置说明「登录状态与会话说明」改为「登录状态与公共设备使用说明」。
  // 入口条数、路由、图标都没变。旧哈希 3b05eac00356d5e5c59912752a105bdb268c2bec5b0b57bc455a2a69d63103e0。
  // 2026-10-06 C2-3：产品负责人 10/4 方案②，取件凭证码取消，到机码是唯一的码。
  // 「打印订单」说明从「取件码、打印状态」改为「打印进度与出纸状态」。
  // 入口条数、路由、图标都没变。冻结契约不放宽，仍逐字节校验，只是基线随有意改动前移。
  // 旧哈希 c3eab9286546efab60ec8e3e5dfe9f1a4724c0e17e27f09e159a541ac4ef83e3。
  ['src/pages/profile/profileEntries.ts', 'c75cce264658aa3bc10451fc38195a8b45ec7ef6e4edfdc278510134c06e860d'],
  ['src/pages/profile/profileTypes.ts', 'a97ea090c8c691f4873255fe4258813d37344371159d54dba89f8c251b46c89f'],
  ['src/pages/profile/assets/format.ts', '84f96614592bbcb611eeec10351435f661dd817e14cd3637e5d76f5e61451d04'],
  // 2026-09-29 走查 W-01：反馈分类补「AI 内容投诉」（ai_content，C3）。纯追加：
  // CATEGORY_OPTIONS 与 CATEGORY_META 各加一行，原有四类、状态表、解析函数一字未动；
  // 服务端与小程序早已有这一类，缺这一行时小程序提交的 AI 投诉在一体机列表里取不到类别元数据。
  // 投诉说明与答复天数放在同目录 aiComplaint.ts，不进冻结文件。
  // 冻结契约不放宽，仍逐字节校验，只是基线随已评审的有意改动前移。
  // 旧哈希 a54e706d069dfff939b65d6714a1bbfa032b49cda974f14507362b00a11a048f。
  ['src/pages/profile/me/feedback/types.ts', '8154883cc92aaba2888e8b614690e964d6f23fb43c172eae729096a5eefd4199'],
  // 哈希随 API-20「顾客侧待退款状态」同步更新（2026-09-06）。
  // 纯追加：原有导出未删；新增 refunding 展示、PENDING_REFUND_* 常量与
  // memberPayStatusLabel（待退款信号优先于「已支付」）。到账时间不以天数承诺。
  // 冻结契约不放宽，仍逐字节校验，只是基线随已评审的有意改动前移。
  // 2026-09-28 用词：实付提示「无独立字段，不按应付减优惠推算」改为
  // 「没有单独记下实付，不按应付减优惠来推算」。仍然禁止用应付减优惠推算实付。
  // 旧哈希 edf85a5efbedc41feefa33097b5b62688af30d0d93b7f0a79dd74a9cd779e846。
  // 2026-09-29 W-51：价目为 0 或免费来源时实付写「0 元（免费试运营）」；页范围没传写「全部页」；
  // 订单号只认 ORD-。非 0 元仍标未记录，继续禁止用应付减优惠推算。
  // 旧哈希 af818425cc5f0ab1fa634d4be09dbe7920dbc0c61d5312dd77b4fa476dbe50fb。
  // 2026-10-06 合并：保留候选侧 isFreeMemberOrder（已有支付状态，且金额为 0 或来源为 free；
  // 没有支付状态的历史订单仍不算免费）。同时免费单不再展示「待退款 / 已退款 / 退款中」，
  // 状态改写「免费」；付过钱的单仍按 refundRequired 优先显示待退款。待退款说明不再写工作人员。
  // 冻结契约不放宽，仍逐字节校验，只是基线随这次合并前移。
  // 旧哈希 50f3278ee897efe7c10b90990d4aacab4e17e0e3a5758d0b2cafb7f3aab61a7b。
  ['src/pages/profile/me/printOrders/paymentCopy.ts', 'e7737e8cc24952dc69e2d6a38aa46e556fa8accc5145da043a415e35dc9f2cc7'],
  ['src/pages/profile/me/printOrders/statusRefresh.ts', '61c86d39d8a4c576ec9b9c2ca2b92d08ee463a6874737cc4a7df70e36103ad8f'],
  // 2026-10-10：首页续办条不再显示文件名，保护公共屏隐私。
  // 冻结契约不放宽，仍逐字节校验，只是基线随已评审的有意改动前移。
  // 旧哈希 d9fc437e98a25e9734494bbd6dece4d0c3649ea5fa616d57d4e97451c111eff3。
  ['src/pages/home/components/ContinuePanel.tsx', 'd4441ee3011eb7efa7560da14ea308adac223de65a41de48d228d108a83dda9b'],
  ['src/pages/home/components/kioskAppLaunch.ts', '5bb684513182d680b91c6f086d17d27e26caed8b6cf616eba79ea1fa3c0a3b6b'],
  ['src/pages/home/components/ToolboxLaunchModals.tsx', 'bb79f207e4e1fbb22cdfc33239dbefc58cbdcd18f7df89adf08e4061354fe99c'],
  // 2026-08-18 重新冻结（PR #598 手机扫码上传公共界面收口）：刷新二维码时先 await 撤销
  // 旧会话再签发新码（旧码此前刷新后仍可被旁人用来上传），且「手机端已上传」状态下刷新
  // 按钮不可点（此前一次误触即丢弃已上传文件）。冻结契约不放宽，仍逐字节校验；新行为由
  // verify:resume-phone-upload-ui 的两条 AST 断言反向钉死。
  // 旧哈希 c7757306daa80f82ce58adb188dce73b68ea9840e9cff8312f54a2af63b72f50。
  // 2026-09-29 重新冻结：确认使用这份简历后面板卸载，原先只在依赖变化时上报忙碌，
  // 卸载不补 onBusyChange(false)，来源页一直停在「接收中」，开始诊断和更换文件一直不可点。
  // 卸载时补报不忙。刷新仍先撤销旧会话，已上传时刷新按钮仍不可点。
  // 冻结契约不放宽，仍逐字节校验。卸载清理由 verify:resume-phone-upload-ui 断言。
  // 旧哈希 6e9fdb90b7a2876583598258f6e266f00acc093ec784ad794f5b2c9239f3f3c0。
  // 2026-10-10 8-7 重新冻结：独立等待锁、到期提醒、真实卸载作废；新内容断言在哈希检查之前。
  // 2026-09-29 重新冻结（W-81）：简历来源页传入 busyWhen="received"，等人扫、还没收到文件时不报忙；
  // 手机已传上或正在确认才报忙。其它调用方不传该参数，仍按会话还在（含等人扫）报忙。卸载仍补报不忙。
  // 旧哈希 1a825bc768c4dde9329542396c19766e2a1742b1103d353fccb7af6ca140b02f。
  ['src/pages/upload/components/UploadSessionQrPanel.tsx', '68c6b0182a8b32fe68a2d37e0954d0a2f43f007c4a7ce2d3748cffbbdce94c40'],
])

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text
  return null
}

function directStringProperty(object, name) {
  const property = object.properties.find(
    (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  return property && ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)
    ? property.initializer.text
    : null
}

function extractRoutes(source) {
  const file = ts.createSourceFile('routes.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const paths = []
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createBrowserRouter'
      && node.arguments[0]
      && ts.isArrayLiteralExpression(node.arguments[0])) {
      const collect = (array) => {
        for (const element of array.elements) {
          if (!ts.isObjectLiteralExpression(element)) continue
          const path = directStringProperty(element, 'path')
          if (path !== null) paths.push(path === '' ? '/' : path.startsWith('/') ? path : `/${path}`)
          const children = element.properties.find(
            (candidate) => ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === 'children',
          )
          if (children && ts.isPropertyAssignment(children) && ts.isArrayLiteralExpression(children.initializer)) {
            collect(children.initializer)
          }
        }
      }
      collect(node.arguments[0])
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return paths
}

function regularFiles(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory()) return regularFiles(path)
    return entry.isFile() ? [path] : []
  })
}

const routes = extractRoutes(read('src/routes/index.tsx'))
const owned = W5_ROUTES_EXPANDED.filter((route) => routes.includes(route))
assert.deepEqual(owned, W5_ROUTES_EXPANDED, 'W5 must own exactly the ordered route patterns (incl. self-assessment v1)')
assert.equal(new Set(owned).size, W5_ROUTES_EXPANDED.length, 'W5 route inventory must be unique')

for (const [path, expected] of FROZEN) {
  assert.equal(sha256(path), expected, `frozen W5 dependency changed: ${path}`)
}
assert.doesNotMatch(read('src/pages/home/components/ContinuePanel.tsx'), /fileName/, '首页续办条不得读取文件名：公共屏上的文件名常带真名，明细应进入「我的 → 打印订单」由本人查看')

const notifications = read('src/pages/placeholders/NotificationsPage.tsx')
const activityDetail = read('src/pages/placeholders/MeActivityDetailPage.tsx')
const meShell = read('src/pages/profile/me/MeListShell.tsx')
const detailCss = read('src/pages/profile/me/me-detail-inkpaper.css')
const benefitActivityDetailCss = read('src/pages/activities/activities-detail-inkpaper.css')
const benefitActivityDetail = read('src/pages/activities/BenefitActivityDetailPage.tsx')
const mobileQrCss = read('src/pages/auth/mobile-qr-service-desk.css')
const phoneUploadCss = read('src/pages/upload/phone-upload-service-desk.css')
const legalDoc = read('src/pages/legal/LegalDocPage.tsx')
const legalDocCss = read('src/pages/legal/legal-service-desk.css')
const toolbox = read('src/pages/toolbox/ToolboxZonePage.tsx')
const toolboxCss = read('src/pages/toolbox/toolbox-zone.css')
const profileCss = [
  read('src/pages/profile/profile-lightflow-shell.css'),
  read('src/pages/profile/profile-lightflow-directory.css'),
  read('src/pages/profile/profile-lightflow-state.css'),
].join('\n')

function assertSharedPageShell(source, path) {
  assert.match(source, /<KioskPageFrame\b/, `${path} uses the shared KioskPageFrame`)
  assert.match(source, /<KioskPageHeader\b/, `${path} uses the shared KioskPageHeader`)
}

function assertSinglePaddingNeutralizer(source, path, scopePattern, wrapperSelector = '.ui-kiosk-page-content') {
  const blocks = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].includes(wrapperSelector))
  assert.equal(blocks.length, 1, `${path} declares exactly one shared-content padding neutralizer`)
  assert.match(blocks[0][1], scopePattern, `${path} scopes the shared-content padding neutralizer to its page`)
  assert.match(blocks[0][2], /\bpadding:\s*0(?:px)?\s*;/, `${path} neutralizes the shared content padding`)
}

assert.match(notifications, /MyNotificationsPage/, '/notifications reuses the canonical member capability')
assert.doesNotMatch(notifications, /services\//, '/notifications adds no second data source')
assert.match(activityDetail, /getMyBrowseLogs/, 'activity detail reads the member browse feed')
assert.match(activityDetail, /getMyJumpLogs/, 'activity detail reads the member jump feed')
assert.match(activityDetail, /nextCursor/, 'activity detail follows cursor pagination')
assert.doesNotMatch(activityDetail, /benefitActivities|claimBenefitActivity/, 'activity detail stays separate from benefits')
assert.match(meShell, /KioskPageFrame/, 'member list shell uses the frozen W1 frame')
assert.match(meShell, /KioskStatePanel/, 'member list shell uses the frozen W1 state panel')
assert.match(meShell, /<section data-kiosk-domain="profile" data-kiosk-screen="member-list" className="flex min-h-0 flex-1 flex-col px-6">/, 'member list content keeps its exact neutral wrapper')
assert.doesNotMatch(meShell, /<\/?main\b/, 'member list shell leaves the main landmark to KioskLayout')
/* 2026-09-08 青序流光迁移：`data-kiosk-domain` / `data-kiosk-screen` 由外层壳
 * `QxMeChrome`（QxMeChrome.tsx:84-85）按 `screen` prop 统一渲染，页面不再自己写一份。
 * 内层 section 只剩滚动容器。原来那条按 V6 内层写法逐字匹配的断言因此过时——
 * 而且**页面确实不该再写**：两处同时带 `data-kiosk-screen="activity-detail"` 会让
 * `locator('[data-kiosk-screen="activity-detail"]')` 命中两个元素，
 * kiosk-privacy-timeout 的 activity detail 用例因此 strict mode 违规。
 * 换成三条同等含义的断言（标识仍在 + 容器仍中性 + 不抢 main 地标），1 → 3，只增不减。 */
assert.match(activityDetail, /screen="activity-detail"/, 'activity detail still declares its screen id to the shell')
assert.match(activityDetail, /<section className="me-detail-scroll">/, 'activity detail keeps its neutral scroll wrapper')
assert.doesNotMatch(activityDetail, /<\/?main\b/, 'activity detail leaves the main landmark to the shell')
assert.doesNotMatch(activityDetail, /<\/?main\b/, 'activity detail leaves the main landmark to KioskLayout')
/* 2026-10-06 稿 31 活动详情迁入青序流光，同强度替换页壳断言：
 * KioskPageFrame / KioskPageHeader → QxPageFrame，并断言已退出 V6 壳。
 * 下面的屏标、滚动容器 class、领取分支字符串保持原断言，不删。 */
assert.match(benefitActivityDetail, /<QxPageFrame\b/, 'BenefitActivityDetailPage uses the Qingxu page frame')
assert.doesNotMatch(benefitActivityDetail, /KioskPageFrame|KioskPageHeader/, 'BenefitActivityDetailPage has left the V6 frame')
assert.match(
  benefitActivityDetail,
  /<section\b(?=[^>]*\bdata-kiosk-domain="profile")(?=[^>]*\bdata-kiosk-screen="activity-detail")(?=[^>]*\bclassName="k8-act-scroll")[^>]*>/,
  'benefit activity detail keeps its profile/activity-detail marker on the real scroll section',
)
for (const marker of [
  'getBenefitActivity(id, getToken())',
  "state === 'loading'",
  "state === 'error' || !item",
  'claimBenefitActivity(id, getToken())',
  'BenefitActivitiesApiError',
  'message &&',
]) {
  assert.match(benefitActivityDetail, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `benefit activity detail keeps real branch ${marker}`)
}
assertSharedPageShell(toolbox, 'ToolboxZonePage')
assert.match(
  toolbox,
  /<section\b(?=[^>]*\bdata-kiosk-screen="toolbox")(?=[^>]*\bclassName="tb-content")[^>]*>/,
  'toolbox keeps its stable screen marker on the real content section',
)
for (const marker of ['config.enabled', 'items.length > 0', '<QrLaunchModal', '<ExternalLaunchModal']) {
  assert.match(toolbox, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `toolbox keeps real branch/modal ${marker}`)
}
assert.doesNotMatch(toolbox, /<\/?main\b/, 'toolbox leaves the main landmark to KioskLayout')
/* 2026-09-25 稿 08-legal 迁入青序流光，同强度替换三条：
 * ① 页壳 KioskPageFrame/KioskPageHeader → QxPageFrame（并断言已退出 V6 壳）；
 * ② 旧页用 `apiContent ? ( … )` / `!apiContent && ( … )` 两支表达「服务端正文 / 本机留存文本」，
 *    新页拆成显式视图：ready 只渲染服务端正文分出的章节，fallback 渲染本机留存文本且必须挂「不作为正式版本」标注；
 * ③ 内容区留白中和器从旧壳的 .ui-kiosk-page-content 换到青序壳的 .qx-body（稿自带 44px 页边）。 */
assert.match(legalDoc, /<QxPageFrame\b/, 'LegalDocPage uses the Qingxu page frame')
assert.doesNotMatch(legalDoc, /KioskPageFrame|KioskPageHeader/, 'LegalDocPage has left the V6 frame')
assert.match(legalDoc, /data-kiosk-screen="legal-doc"/, 'legal document keeps its stable screen marker')
assert.match(
  legalDoc,
  /docLoad\?\.status === 'ready' \? splitLegalSections\(docLoad\.content\)/,
  'legal document keeps the real API-content branch (served text is what the reader shows)',
)
assert.match(
  legalDoc,
  /view === 'fallback'[\s\S]{0,1600}?data-testid="legal-doc-fallback-warning"[\s\S]{0,400}?不作为正式版本/,
  'legal document keeps the audited fallback branch and labels it as not the official version',
)
/* 离线页的健康探测必须走与其它接口相同的 API_BASE_URL（与 useApiReadiness 同源）：写死 '/api/v1/health' 时，
 * VITE_API_BASE_URL 指向别的源就永远探测失败，一体机卡在离线页。浏览器夹具的基址恰好也是 /api/v1，测不出这一条。 */
const errorOffline = read('src/pages/placeholders/ErrorOfflinePage.tsx')
assert.match(errorOffline, /fetch\(`\$\{API_BASE_URL\}\/health`/, 'offline page probes /health through API_BASE_URL')
assert.doesNotMatch(errorOffline, /fetch\(\s*['"`]\/api\//, 'offline page hard-codes no /api path in its probes')
assertSinglePaddingNeutralizer(
  benefitActivityDetailCss,
  'activities-detail-inkpaper.css',
  /\.k8-act-detail\b/,
)
assertSinglePaddingNeutralizer(legalDocCss, 'legal-service-desk.css', /\.k1-legal-doc\b/, '.qx-body')
assert.doesNotMatch(legalDocCss, /\.ui-kiosk-page-content/, 'legal-service-desk.css carries no dead selector for the retired V6 content wrapper')
assertSinglePaddingNeutralizer(toolboxCss, 'toolbox-zone.css', /\.kpv1\.ktoolbox\b/)
assert.match(
  profileCss,
  /\.fusion-w5--profile-entry\s*>\s*\.ui-kiosk-page-content\s*\{[^}]*padding:\s*0;/,
  'profile entry neutralizes shared content padding so prototype 48px gutters are not doubled',
)
assert.match(
  mobileQrCss,
  /\.k1-mobile-qr-login \.k1-mobile-qr-content\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/,
  'mobile QR shell includes padding and can shrink inside the 390px viewport width',
)
assert.match(
  mobileQrCss,
  /\.k1-mobile-qr-login \.k1-mobile-qr-input\s*\{[^}]*?min-height:\s*48px;/,
  'mobile QR inputs keep a 48px direct touch target',
)
assert.match(
  phoneUploadCss,
  /\.k1-phone-upload \.k1-phone-upload-content\s*\{[\s\S]*?box-sizing:\s*border-box;[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/,
  'phone upload shell includes padding and can shrink inside the 390px viewport width',
)
assert.match(
  phoneUploadCss,
  /\.k1-phone-upload \.ph-up-remove\s*\{[^}]*?width:\s*48px;[^}]*?height:\s*48px;/,
  'phone upload remove action keeps a 48px direct touch target',
)

for (const leaf of [
  'me-detail-base.css', 'me-assets.css', 'me-orders.css', 'me-records.css', 'me-settings-feedback.css',
]) {
  assert.match(detailCss, new RegExp(`@import ['"]\\./styles/${leaf.replace('.', '\\.')}['"]`), `detail CSS imports ${leaf}`)
}

const productionFiles = regularFiles(join(ROOT, 'src/pages'))
  .filter((path) => ['.ts', '.tsx'].includes(extname(path)))
for (const path of productionFiles) {
  const source = readFileSync(path, 'utf8')
  const label = relative(ROOT, path)
  assert.doesNotMatch(source, /\b(mock|demo)(Data|Items|Records|User)\b/i, `production placeholder identifier in ${label}`)
  assert.doesNotMatch(source, /一键投递|立即投递/, `forbidden recruitment copy in ${label}`)
}

const concretePages = [
  'src/pages/profile/ProfilePage.tsx',
  'src/pages/profile/me/MyBenefitsPage.tsx',
  'src/pages/profile/me/MyFeedbackPage.tsx',
  'src/pages/profile/me/MyPrivacyRequestsPage.tsx',
  'src/pages/auth/LoginPage.tsx',
  'src/pages/auth/MobileQrLoginPage.tsx',
  'src/pages/upload/PhoneUploadPage.tsx',
  'src/pages/legal/LegalDocPage.tsx',
  'src/pages/screensaver/ScreensaverPage.tsx',
  'src/pages/placeholders/SessionTimeoutPage.tsx',
  'src/pages/placeholders/ErrorOfflinePage.tsx',
  'src/pages/help/HelpCenterPage.tsx',
  'src/pages/activities/BenefitActivitiesPage.tsx',
  'src/pages/activities/BenefitActivityDetailPage.tsx',
  'src/pages/toolbox/ToolboxZonePage.tsx',
]
for (const path of concretePages) {
  const source = read(path)
  assert.match(source, /fusion-w5|data-kiosk-presentation=["']fusion-youth["']|MeListShell/, `${path} exposes W5 fusion scope`)
}

const qxMePages = [
  'src/pages/profile/me/MyResumesPage.tsx',
  'src/pages/profile/me/MyFavoritesPage.tsx',
  'src/pages/profile/me/MyAiRecordsPage.tsx',
  'src/pages/profile/me/MyActivityPage.tsx',
  'src/pages/profile/me/MyNotificationsPage.tsx',
  'src/pages/placeholders/MeActivityDetailPage.tsx',
  // 稿 38-member-assets（2026-09-23）：文档与打印订单从旧 MeListShell 迁入青序记录壳。
  // 上面 concretePages 只认 `fusion-w5|MeListShell` 字样，迁走后移到这里按青序壳断言。
  'src/pages/profile/me/MyDocumentsPage.tsx',
  'src/pages/profile/me/MyPrintOrdersPage.tsx',
  // 稿 30 ?screen=settings（2026-09-23）：账号设置从墨青纸感 KioskPageFrame 迁入青序会员壳的 settings 视图。
  'src/pages/profile/me/MySettingsPage.tsx',
]
for (const path of qxMePages) {
  const source = read(path)
  assert.match(source, path.endsWith('/MySettingsPage.tsx') ? /<QxPageFrame/ : /QxMePage/, `${path} uses its Qingxu page frame`)
  assert.doesNotMatch(source, /KioskPageFrame/, `${path} has left the V6 frame`)
  assert.doesNotMatch(source, /className="qx-nav-item"/, `${path} does not inline navbar items`)
}
const qxMeChrome = read('src/pages/profile/me/qx/QxMeChrome.tsx')
assert.match(qxMeChrome, /QxPageFrame/, 'member chrome uses Qingxu page frame')
assert.match(qxMeChrome, /QxAppNavbar/, 'member chrome uses shared QxAppNavbar')
assert.match(qxMeChrome, /current="profile"/, 'member chrome marks 我的 as the current nav item')
assert.doesNotMatch(qxMeChrome, /KioskPageFrame/, 'member chrome has left the V6 frame')
const qxNavbar = read('src/components/qingxu/QxAppNavbar.tsx')
assert.match(qxNavbar, /aria-current=\{current === 'profile' \? 'page' : undefined\}/, 'shared navbar can mark 我的 as current')
const kioskRootSrc = read('src/layouts/KioskRoot.tsx')
assert.match(kioskRootSrc, /['"]\/me\/notifications['"]/, '/me/notifications is registered as a Qingxu migrated route')
assert.match(kioskRootSrc, /['"]\/notifications['"]/, '/notifications is registered as a Qingxu migrated route')
assert.match(kioskRootSrc, /['"]\/me\/resumes['"]/, '/me/resumes is registered as a Qingxu migrated route')
assert.match(kioskRootSrc, /['"]\/me\/favorites['"]/, '/me/favorites is registered as a Qingxu migrated route')
assert.match(kioskRootSrc, /['"]\/me\/ai-records['"]/, '/me/ai-records is registered as a Qingxu migrated route')
assert.match(kioskRootSrc, /['"]\/me\/activity['"]/, '/me/activity is registered as a Qingxu migrated route')
assert.match(kioskRootSrc, /['"]\/me\/activity\/['"]/, '/me/activity/:id uses a precise prefix')
assert.match(kioskRootSrc, /['"]\/activities['"]/, '/activities is registered in QX_MIGRATED_ROUTES (exact set, not a prefix)')
assert.match(kioskRootSrc, /\/\^\\\/activities\\\/\[\^\/\]\+\$\//, '/activities/:id uses an exact pattern, not a wide prefix')
const benefitActivitiesPage = read('src/pages/activities/BenefitActivitiesPage.tsx')
assert.match(benefitActivitiesPage, /<QxPageFrame\b/, 'BenefitActivitiesPage uses the Qingxu page frame')
assert.doesNotMatch(benefitActivitiesPage, /KioskPageFrame|KioskPageHeader/, 'BenefitActivitiesPage has left the V6 frame')
assert.match(benefitActivitiesPage, /data-kiosk-screen="activities"/, 'activities list keeps its stable screen marker')
/* 文档与打印订单同属稿 38，是「文件资产 → 打印订单」这条跨端主链的两屏：
 * 页面换成青序壳却漏登记，KioskLayout 会在青序页上再叠一层旧顶栏和底栏（两套 chrome 同屏）。
 * 所以这里同时钉三件事：进了精确集合、页面不再挂旧壳、页面声明的分域视图就是这两张 Tab。 */
const qxMigratedSet = kioskRootSrc.match(/const QX_MIGRATED_ROUTES = new Set<string>\(\[([\s\S]*?)\]\)/)?.[1] ?? ''
for (const [route, file, view] of [
  ['/me/documents', 'src/pages/profile/me/MyDocumentsPage.tsx', 'documents'],
  ['/me/print-orders', 'src/pages/profile/me/MyPrintOrdersPage.tsx', 'orders'],
  ['/me/settings', 'src/pages/profile/me/MySettingsPage.tsx', 'settings'],
]) {
  assert.match(qxMigratedSet, new RegExp(`['"]${route.replace(/\//g, '\\/')}['"]`), `${route} is registered in QX_MIGRATED_ROUTES (exact set, not a prefix)`)
  const source = read(file)
  assert.doesNotMatch(source, /MeListShell|me-detail-inkpaper|useInkRipple|me-inkdetail/, `${file} has left the legacy InkPaper member shell`)
  assert.match(source, new RegExp(`view="${view}"`), `${file} renders the ${view} asset view of the Qingxu member chrome`)
}
assert.match(qxMeChrome, /key: 'documents'[^\n]*to: '\/me\/documents'/, 'member chrome exposes the 我的文档 asset tab')
assert.match(qxMeChrome, /key: 'orders'[^\n]*to: '\/me\/print-orders'/, 'member chrome exposes the 打印订单 asset tab')
/* 账号设置迁入同一青序会员壳：视图要在共享壳里声明、测试作用域独立，且不挂记录分类 Tab
 * （设置不是记录，也不是资产分域）。页面自身仍须保留 member-settings 屏标，visual 用例与 W6 路由扫描都按它定位。 */
assert.match(qxMeChrome, /\| 'settings'/, 'member chrome declares the settings view')
assert.match(qxMeChrome, /'member-settings'/, 'member chrome exposes the member-settings screen and test scope')
assert.match(qxMeChrome, /view === 'notifications' \|\| isSettingsView \? \[\]/, 'settings view renders no record-category tabs')
const settingsPageQx = read('src/pages/profile/me/MySettingsPage.tsx')
assert.match(settingsPageQx, /data-kiosk-screen="member-settings"/, 'MySettingsPage keeps the member-settings screen marker on the Qingxu chrome')
assert.doesNotMatch(kioskRootSrc, /QX_MIGRATED_PREFIXES = \[[^\]]*['"]\/me\/['"]/, 'does not use a wide /me/ prefix')
const profilePageQx = read('src/pages/profile/ProfilePage.tsx')
const benefitsPageQx = read('src/pages/profile/me/MyBenefitsPage.tsx')
const feedbackPageQx = read('src/pages/profile/me/MyFeedbackPage.tsx')
const privacyPageQx = read('src/pages/profile/me/MyPrivacyRequestsPage.tsx')
assert.match(profilePageQx, /QxPageFrame/, 'ProfilePage uses Qingxu page frame')
assert.doesNotMatch(profilePageQx, /KioskPageFrame/, 'ProfilePage has left the V6 frame')
assert.match(benefitsPageQx, /QxPageFrame/, 'MyBenefitsPage uses Qingxu page frame')
assert.doesNotMatch(benefitsPageQx, /KioskPageFrame/, 'MyBenefitsPage has left the V6 frame')
assert.match(feedbackPageQx, /QxPageFrame/, 'MyFeedbackPage uses Qingxu page frame')
assert.doesNotMatch(feedbackPageQx, /KioskPageFrame/, 'MyFeedbackPage has left the V6 frame')
assert.match(privacyPageQx, /QxPageFrame/, 'MyPrivacyRequestsPage uses Qingxu page frame')
assert.doesNotMatch(privacyPageQx, /KioskPageFrame/, 'MyPrivacyRequestsPage has left the V6 frame')
assert.match(profilePageQx, /getPendingTasks/, 'ProfilePage reads /me/pending-tasks instead of inventing continue-todo')
assert.doesNotMatch(profilePageQx, /一键投递|立即投递|平台投递|投递简历/, 'ProfilePage stays inside the recruitment copy whitelist')
assert.doesNotMatch(benefitsPageQx, /立即支付|去支付|确认核销|核销成功|办理成功/, 'MyBenefitsPage does not add payment or redemption success copy')
assert.doesNotMatch(feedbackPageQx, /一键投递|立即投递|平台投递|投递简历/, 'MyFeedbackPage stays inside the recruitment copy whitelist')
assert.doesNotMatch(privacyPageQx, /全部个人数据已删除|账号注销成功/, 'MyPrivacyRequestsPage does not claim account deletion')

/* 2026-09-30 青序 2.0 A 批（合规文案）：稿 v2 README 规则 4 / 规则 5。
 * 眉题一律中文、照同号稿写；屏上不出现「原型」「元数据」、模型名与任务编号；
 * 机器状态第 8 项按托管 a 叫「机构官方渠道」。18（SCAN VIA PANEL）归 B 批，不在此列。 */
const A_BATCH_EYEBROWS = [
  ['src/pages/legal/LegalDocPage.tsx', ["eyebrow: '你和这台机器'", "eyebrow: '你的信息'"]],
  ['src/pages/print-scan/ConvertImagesView.tsx', ['>图片转 PDF<']],
  ['src/pages/print-scan/sign-stamp/SignStampPickView.tsx', ['>签名<']],
  ['src/pages/resume/SelfAssessmentFlow.tsx', ["SA_EYEBROW = '自我探索'"]],
  ['src/pages/profile/me/MyNotificationsPage.tsx', ['eyebrow="消息通知"']],
  ['src/pages/profile/me/MyDocumentsPage.tsx', ['eyebrow="我的文档和订单"']],
  ['src/pages/profile/me/MyPrintOrdersPage.tsx', ['eyebrow="我的文档和订单"']],
  ['src/pages/profile/me/MyResumesPage.tsx', ['eyebrow="我的简历"']],
  ['src/pages/profile/me/MyFavoritesPage.tsx', ['eyebrow="我的收藏"']],
  ['src/pages/profile/me/MyAiRecordsPage.tsx', ['eyebrow="AI 服务记录"']],
  ['src/pages/profile/me/MyActivityPage.tsx', ['eyebrow="我的足迹"']],
  ['src/pages/placeholders/MeActivityDetailPage.tsx', ['eyebrow="记录详情"']],
  ['src/pages/profile/me/MyFeedbackPage.tsx', ['>意见反馈<']],
]
for (const [path, expected] of A_BATCH_EYEBROWS) {
  const source = read(path)
  for (const snippet of expected) assert.ok(source.includes(snippet), `${path} eyebrow follows the v2 draft: ${snippet}`)
  assert.doesNotMatch(
    source,
    /(eyebrow[=:]\s*["'`]|eyebrow["'`]?>|SA_EYEBROW = ')[A-Z][A-Z &;]{3,}/,
    `${path} has no English eyebrow`,
  )
}
assert.doesNotMatch(read('src/pages/print-scan/SignStampPage.tsx'), /固定原型数据|<b>演示<\/b>/, 'sign page sample bar says 示例, never 原型/演示')
assert.doesNotMatch(read('src/pages/print-scan/sign-stamp/useSignStampFlow.ts'), /合成演示/, 'sign page CTA reasons do not say 合成演示')
assert.match(
  read('src/pages/print-scan/sign-stamp/constants.ts'),
  /我确认本人拥有该本人手写签名的使用授权，仅用于本人材料的版式整理/,
  'sign authorization sentence follows the v2 draft',
)
assert.match(read('src/pages/print-scan/SignStampPage.tsx'), /问小青：签名放在哪一页/, 'sign page asks 小青 where to place the signature')
assert.doesNotMatch(
  read('src/pages/print-scan/SignStampPage.tsx'),
  /purpose="signature_image"/,
  'sign page does not create a signature_image upload session',
)
assert.doesNotMatch(qxMeChrome, /服务元数据/, 'member record tab hint does not say 元数据')
assert.doesNotMatch(read('src/pages/profile/me/MockInterviewRecords.tsx'), /元数据/, 'mock interview legal line does not say 元数据')
for (const path of ['src/pages/profile/me/MyResumesPage.tsx', 'src/pages/profile/me/MyAiRecordsPage.tsx', 'src/pages/profile/me/JobAiSessionRecords.tsx']) {
  const source = read(path)
  assert.doesNotMatch(source, /\$\{item(\.session)?\.provider/, `${path} does not print the model/provider name`)
  assert.doesNotMatch(source, /任务 \$\{|简历任务 \$\{/, `${path} does not print the task id`)
}
const errorOfflineSrc = read('src/pages/placeholders/ErrorOfflinePage.tsx')
assert.match(errorOfflineSrc, /key: 'jobs'[^\n]*name: '机构官方渠道'/, 'system state item 8 is 机构官方渠道 (hosting a)')
assert.doesNotMatch(errorOfflineSrc, /name: '岗位与招聘会信息'|AI、岗位信息没有/, 'system state no longer lists recruitment info')

console.log('ALL PASS fusion W5 route, boundary, and presentation contract')
