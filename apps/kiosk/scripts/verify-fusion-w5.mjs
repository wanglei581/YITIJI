import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex')

const W5_ROUTES = [
  '/member/qr-login', '/upload/phone', '/login', '/legal/:doc',
  // 2026-10-29 一体机手机码短链的网页中转（兑换或校验后 replace 到上面两个手机页）。
  '/k/u/:scene', '/k/l/:ticketId',
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
  ['src/pages/profile/profileEntries.ts', 'c3eab9286546efab60ec8e3e5dfe9f1a4724c0e17e27f09e159a541ac4ef83e3'],
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
  // 2026-10-04 打印主线 0 元口径：新增 isFreeMemberOrder（已有支付状态，且金额为 0 或来源为 free）。
  // 没有支付状态的历史订单仍不算免费。原有导出、实付不推算、待退款常量都没改。
  // 冻结契约不放宽，仍逐字节校验，只是基线随有意改动前移。
  // 旧哈希 50f3278ee897efe7c10b90990d4aacab4e17e0e3a5758d0b2cafb7f3aab61a7b。
  // 2026-10-29 触屏版集成后修复：PENDING_REFUND_EXPLANATION 的「退款由工作人员处理」改成稿里的说法「退款会按支付渠道处理」
  // （docs/design/kiosk-touch-2026-10 的 fix-me.js 待退款说明；现场无人值守，屏上不写由工作人员处理）。
  // 只改这一句，原有导出、实付不推算、不承诺到账天数都没动；求助句由详单在说明后面按标准句 1 加（服务电话）。
  // 冻结契约不放宽，仍逐字节校验，只是基线随有意改动前移。
  // 旧哈希 e7737e8cc24952dc69e2d6a38aa46e556fa8accc5145da043a415e35dc9f2cc7。
  ['src/pages/profile/me/printOrders/paymentCopy.ts', '9b16f46cfdfd247e76963eb2ff2fb74571698499c76ab684d42bd12c03c714a9'],
  ['src/pages/profile/me/printOrders/statusRefresh.ts', '61c86d39d8a4c576ec9b9c2ca2b92d08ee463a6874737cc4a7df70e36103ad8f'],
  ['src/pages/home/components/ContinuePanel.tsx', 'd9fc437e98a25e9734494bbd6dece4d0c3649ea5fa616d57d4e97451c111eff3'],
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
  // 2026-09-29 重新冻结（W-81）：简历来源页传入 busyWhen="received"，等人扫、还没收到文件时不报忙；
  // 手机已传上或正在确认才报忙。其它调用方不传该参数，仍按会话还在（含等人扫）报忙。卸载仍补报不忙。
  // 旧哈希 1a825bc768c4dde9329542396c19766e2a1742b1103d353fccb7af6ca140b02f。
  // 2026-10-28 重新冻结（触屏版简历三条主路）：新增三个可选属性 onCancelled / onReceivedChange / confirmRef，
  // 供简历来源页在自己的版面里画「已取消」说明、文件卡和底栏「确认使用这份文件」；
  // 不传时行为与此前逐字节同一（取消、确认、报忙、刷新先撤销旧会话、已上传时刷新不可点都不变）。
  // 冻结契约不放宽，仍逐字节校验；手机上传的既有行为由 verify:resume-phone-upload-ui 的 AST 断言继续钉住。
  // 旧哈希 9a3c4e09d4acc5c7912de7bf56ccb4ef9da6b0d8cb24fd6f39f44ee1203242bb。
  // 2026-10-28 再次重新冻结（简历三条主路返工）：confirmRef 换成 onConfirmReady。原先把确认函数在渲染期写进 ref，
  // 确认一开始父页不重渲染，页面读到的还是确认前的旧闭包，底栏仍写「确认使用这份文件」、没禁用，双击会把
  // /confirm 发两遍。现在面板在 effect 里把确认函数交给页面（有文件且不在确认中才交，确认中与卸载交 null），
  // 页面放进 state，底栏随之写「正在确认…」并禁用；面板里另加不随渲染变的在途标记，同一帧内的两次点击也只发一次。
  // 仍是可选属性，不传时行为不变。冻结契约不放宽，仍逐字节校验；既有行为由 verify:resume-phone-upload-ui 继续钉住，
  // 新行为由它新加的几条断言和 W3 的手机确认用例钉住。
  // 旧哈希 97a46d6d5dc1ef8aaafdc1ff99de267d673bb992bac1de6a7ebfa64be8453c82。
  // 2026-10-29 重新冻结（一体机手机码改短链）：出码调用从 buildPhoneUploadUrl 换成 buildPhoneUploadQrUrl
  // （回执带合格场景码出 /k/u/<场景码>，否则照旧出带 fragment 的长链），import 同步换名；面板其余逐字未动。
  // 旧哈希 9a3c4e09d4acc5c7912de7bf56ccb4ef9da6b0d8cb24fd6f39f44ee1203242bb。
  // 2026-10-29 重新冻结（触屏版集成：并入第一包新头里 #1519 的出码调用换名）：触屏版简历三条主路（上面 10/28 两次）和 #1519
  // （一体机手机码改短链，上一条）各自改了这个文件，改动互不相交——前者加可选属性与 onConfirmReady，后者只换 import 与一处出码调用；
  // 合并后的文件就是两者之和，没有别的改动。冻结契约不放宽，仍逐字节校验。
  // 旧哈希 cc895ab96ceea8b511bbbb638c669e38dd0414cb9e8a53636258229806a3b32a（第四包终稿）、1e0e0b9256304a822d4b075394ed3aa855f47689594a391be7fa6d057a3ff56f（#1519）。
  // 2026-10-29 重新冻结（#1519 留给触屏版第四包的面板接线）：码旁说明、手机传来文件后的来源与提醒三处文案都从
  // copy/miniappLinkCopy.ts 取（phoneUploadScanHint(contact) 非空串时换掉原句「请用手机微信或浏览器扫码」，空串＝小程序未发布或读不到联系方式，
  // 保持原句；已收到文件后在文件名下加 uploadedFileSourceLine(文件来源)（读不到来源不写）与 notYourFileHint()）。联系方式用 useSupportContact()。
  // 只多两行 import、一行 hook、三行取句子、两行 JSX，二维码、轮询、取消、确认、报忙、刷新先撤销旧会话、已上传时刷新不可点都逐字未动。
  // 冻结契约不放宽，仍逐字节校验；新行为由 scripts/tests/miniapp-link-copy.test.mjs 的接线断言和 fusion-w3 / fusion-w2 的浏览器用例钉住。
  // 旧哈希 98691610ccd48ff766ff7d28256ed8814afb024ad454305f9de6345c0639db14。
  // 2026-10-29 重新冻结（触屏版走查 I-14，B 路）：签名图（signature_image）确认后只留系统短期、不进「我的文档」，面板里「会员文件确认后归档」对它不成立；
  // 只在那一处条件上加 purpose !== 'signature_image'，二维码、轮询、取消、确认、刷新先撤销旧会话等都逐字未动。冻结契约不放宽，仍逐字节校验。
  // 旧哈希 7f0cacce1e2b505548a4a141e2b63c71517c8ec5fe5d47fc827732a461f3e524。
  ['src/pages/upload/components/UploadSessionQrPanel.tsx', '412de307d662c81adde91f45f2e77357a74f14f69d95abbc3953048bba98f357'],
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
assert.match(benefitActivityDetail, /<MeTouchShell\b/, 'BenefitActivityDetailPage uses the touch screen shell')
assert.doesNotMatch(benefitActivityDetail, /<KioskPageFrame\b|<KioskPageHeader\b/, 'BenefitActivityDetailPage has left the V6 frame')
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
assert.match(toolbox, /<QxTouchScreen\b/, 'ToolboxZonePage uses the touch screen')
assert.match(toolbox, /<QxTouchBand\b/, 'ToolboxZonePage uses the touch band')
assert.doesNotMatch(toolbox, /<KioskPageFrame\b|<KioskPageHeader\b/, 'ToolboxZonePage has left the shared Kiosk page frame')
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
 * ① 页壳 KioskPageFrame/KioskPageHeader → 触屏 PublicTouchFrame（并断言已退出 V6 壳）；
 * ② 旧页用 `apiContent ? ( … )` / `!apiContent && ( … )` 两支表达「服务端正文 / 本机留存文本」，
 *    新页拆成显式视图：ready 只渲染服务端正文分出的章节，fallback 渲染本机留存文本且必须挂「不作为正式版本」标注；
 * ③ 内容区留白中和器从旧壳的 .ui-kiosk-page-content 换到触屏壳的 .qxt-body（稿自带 40px 页边，由 .legal-doc-scroll 自己给）。 */
assert.match(legalDoc, /<PublicTouchFrame\b/, 'LegalDocPage uses the Qingxu touch page frame')
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
assertSinglePaddingNeutralizer(legalDocCss, 'legal-service-desk.css', /\.k1-legal-doc\b/, '.qxt-body')
assert.doesNotMatch(legalDocCss, /\.ui-kiosk-page-content/, 'legal-service-desk.css carries no dead selector for the retired V6 content wrapper')
assert.doesNotMatch(toolboxCss, /\.ui-kiosk-page-content/, 'toolbox-zone.css carries no dead selector for the shared page content wrapper (the toolbox page left KioskPageFrame and never renders it)')
/* 触屏页不得再用「贴左边的整列色条」遮空白：绝对定位、贴左、上下拉满、定宽的 ::before。
 * 空白检查从 x=80 取样，色条正好盖住那一列，卡里再空也量不到（10/27 审出的做法）。
 * 稿的大卡是带图标的 210 宽图标列，不是空色条。 */
for (const path of [
  'src/pages/toolbox/toolbox-zone.css',
  'src/pages/smart-campus/smart-campus-touch.css',
  'src/auth/capability-gate-touch.css',
  'src/pages/contract-review/contract-review-touch.css',
  'src/pages/contract-review/contract-review.css',
  'src/pages/service-hubs/policy-touch.css',
  'src/pages/renshi/renshi-touch.css',
]) {
  for (const match of read(path).matchAll(/([^{}]+)::before\s*\{([^}]*)\}/g)) {
    const body = match[2]
    const edgeStrip =
      /position:\s*absolute/.test(body) &&
      /\btop:\s*0\b/.test(body) &&
      /\bbottom:\s*0\b/.test(body) &&
      /\bleft:\s*0\b/.test(body) &&
      /\bwidth:\s*\d+px/.test(body)
    assert.ok(!edgeStrip, `${path}: ${match[1].trim()}::before 是贴左边的整列色条，空白检查会被它遮住，请改成按稿的图标列或去掉`)
  }
}
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
  assert.match(source, path.endsWith('/MySettingsPage.tsx') ? /<MeTouchShell/ : /QxMePage/, `${path} uses its touch or member page frame`)
  assert.doesNotMatch(source, /KioskPageFrame/, `${path} has left the V6 frame`)
  assert.doesNotMatch(source, /className="qx-nav-item"/, `${path} does not inline navbar items`)
}
const qxMeChrome = read('src/pages/profile/me/qx/QxMeChrome.tsx')
assert.match(qxMeChrome, /MeTouchShell/, 'member chrome uses the touch screen shell')
const touchShell = read('src/pages/profile/touch/MeTouchShell.tsx')
assert.match(touchShell, /QxTouchNav/, 'touch shell uses QxTouchNav')
assert.match(touchShell, /current="profile"/, 'touch shell marks 我的 as the current nav item')
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
assert.match(profilePageQx, /MeTouchShell/, 'ProfilePage uses the touch screen shell')
assert.doesNotMatch(profilePageQx, /KioskPageFrame/, 'ProfilePage has left the V6 frame')
assert.match(benefitsPageQx, /MeTouchShell/, 'MyBenefitsPage uses the touch screen shell')
assert.doesNotMatch(benefitsPageQx, /KioskPageFrame/, 'MyBenefitsPage has left the V6 frame')
assert.match(feedbackPageQx, /MeTouchShell/, 'MyFeedbackPage uses the touch screen shell')
assert.doesNotMatch(feedbackPageQx, /KioskPageFrame/, 'MyFeedbackPage has left the V6 frame')
assert.match(privacyPageQx, /MeTouchShell/, 'MyPrivacyRequestsPage uses the touch screen shell')
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
  /* 触屏版（稿 18）：眉题在意图带里，由页面传给 TouchToolScreen；空态标题仍是「图片转 PDF」（h1 锚点与路由巡检按这个名字找）。 */
  ['src/pages/print-scan/ConvertImagesPage.tsx', ['eyebrow="照片合成 PDF"']],
  ['src/pages/print-scan/convert-images-model.ts', ["title: '图片转 PDF'"]],
  /* 触屏版（稿 20）：眉题在意图带里，由页面传给 TouchToolScreen，每一屏都是「签名」。 */
  ['src/pages/print-scan/SignStampPage.tsx', ['eyebrow="签名"']],
  ['src/pages/resume/SelfAssessmentFlow.tsx', ["SA_EYEBROW = '改简历 · 自我探索'"]],
  // 证据锚点随稿换字，判据不变：眉题仍是中文、照稿，屏上不出现英文眉题。
  ['src/pages/profile/me/MyNotificationsPage.tsx', ['eyebrow="我的 · 消息"']],
  ['src/pages/profile/me/MyDocumentsPage.tsx', ['eyebrow="我的 · 文档"']],
  ['src/pages/profile/me/MyPrintOrdersPage.tsx', ['eyebrow="我的 · 打印订单"']],
  ['src/pages/profile/me/MyResumesPage.tsx', ['eyebrow="我的 · 简历"']],
  ['src/pages/profile/me/MyFavoritesPage.tsx', ['eyebrow="我的 · 收藏"']],
  ['src/pages/profile/me/MyAiRecordsPage.tsx', ['eyebrow="我的 · AI 服务记录"']],
  ['src/pages/profile/me/MyActivityPage.tsx', ['eyebrow="我的 · 浏览记录"']],
  ['src/pages/placeholders/MeActivityDetailPage.tsx', ['eyebrow="记录详情"']],
  // 证据锚点随稿换字，判据不变：眉题仍是中文、照稿，屏上不出现英文眉题。
  ['src/pages/profile/me/MyFeedbackPage.tsx', ['eyebrow="我的 · 意见反馈"']],
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

/* 触屏版第 5 包（2026-10-28）：稿上的小标题、问答标题在读屏里仍是标题层级，不是 <p> / <b>。
 * 画面由 .qxp-k / .qxp-note 类名保持（1080 宽改前改后逐像素比对一致），所以这里只钉标签。
 * 对照旧版页内标题数：帮助 7、机器状态 6、登录 2、协议 5、闲置提醒 4，改版曾把它们都压成了 0 或 1。 */
const publicBlocksSrc = read('src/pages/public-touch/PublicBlocks.tsx')
assert.match(publicBlocksSrc, /export function K\(\{ children, as: Tag = 'p', id \}/, 'K：小标题标签可选，默认仍是 p，老调用不变')
assert.match(publicBlocksSrc, /export function SrHeading\(/, 'SrHeading：稿上没有字的那一组内容，给读屏一个标题')
const helpSrc = read('src/pages/help/HelpCenterPage.tsx')
assert.match(helpSrc, /<h2 className="qxp-note" id=\{`\$\{answerId\}-q`\}><b>\{item\.q\}<\/b><\/h2>/, '帮助页：每条问答的问题是 h2')
assert.match(helpSrc, /<K as="h2">卡住了，先自己试这三步<\/K>/, '帮助页：自助三步的小标题是 h2')
assert.match(helpSrc, /<K as="h2">直接去办<\/K>/, '帮助页：直接去办的小标题是 h2')
assert.match(
  errorOfflineSrc,
  /<SrHeading id="of-list-title">这台机器的八项状态<\/SrHeading>\s*<ul className="of-list"[^>]*aria-labelledby="of-list-title"/,
  '机器状态页：八项状态清单有 h2 标题，清单用它命名',
)
const loginSrc = read('src/pages/auth/LoginPage.tsx')
assert.ok((loginSrc.match(/<K as="h3">/g) ?? []).length >= 4, '登录页：四张「记在哪」卡的标题是 h3')
assert.match(loginSrc, /<h2 className="t">不登录也能办<\/h2>/, '登录页：「不登录也能办」是 h2')
assert.match(loginSrc, /<SrHeading id="lg-facts-title">登录之后记在哪<\/SrHeading>/, '登录页：四张卡这一组有 h2 标题')
const legalViewsSrc = read('src/pages/legal/LegalDocViews.tsx')
assert.match(legalViewsSrc, /<h2 className="legal-doc-toc-title">章节目录<\/h2>/, '协议页：章节目录有 h2 标题')
assert.match(legalViewsSrc, /<h3>\{section\.title\}<\/h3>/, '协议页：章节标题仍是 h3（用例按 .legal-doc-body h3 取）')
const guardViewSrc = read('src/pages/session-guard/SessionGuardView.tsx')
assert.match(guardViewSrc, /<K as="h3">\{card\.title\}<\/K>/, '闲置提醒：两张清单卡的标题是 h3')
assert.match(guardViewSrc, /<h3>\{ask\.title\}<\/h3>/, '闲置提醒：常问的问题（10/29 走查 I-07 起只留「纸还在机器上」一条）标题是 h3')

/* 触屏版第 5 包（2026-10-28）：改版时被删掉的说明句，稿上没画，按「稿上没画的也保留」放回。
 * 登录步骤、身份说明只给读屏（默认态一屏放不下可见的字）；帮助与机器状态的说明是小字，运行页没有它们就是少了一条交代。 */
assert.match(
  loginSrc,
  /<ol className="qxp-sr-h" aria-label="登录步骤"><li>01 选择登录方式<\/li><li>02 核对本人身份<\/li><li>03 回到刚才的办理<\/li><\/ol>/,
  '登录页：三步（选择登录方式、核对本人身份、回到刚才的办理）留给读屏的有序列表',
)
assert.match(loginSrc, /这台机器不生成、也不代填。这一步不用 AI 核对是不是你。/, '登录页：验证码来源与「不用 AI 核对」的说明还在')
assert.match(helpSrc, /data-testid="help-truth"[\s\S]{0,120}?只写本机已经上线的做法；帮助内容随应用一起发布，不是实时服务状态。/, '帮助页：「这页写的是什么」还在')
assert.ok((helpSrc.match(/<HelpTruth \/>/g) ?? []).length >= 4, '帮助页：弹层与三个分支的插画卡里都放着「这页写的是什么」')
assert.match(
  errorOfflineSrc,
  /data-testid="system-state-truth"[\s\S]{0,200}?八项状态一项不少地列出来；只有能真检测的才给结果，其余照实写未检测或随请求确认，不会默认写成正常。/,
  '机器状态页：「怎么判断」还在',
)
const resumeViewSrc = read('src/pages/session-resume/SessionResumeView.tsx')
assert.match(resumeViewSrc, /const RESUME_BOUNDARY = '这一页不重新建单，也不删除系统里的订单或文件。'/, '继续打印页：边界那一句还在')
assert.strictEqual((resumeViewSrc.match(/\{RESUME_BOUNDARY\}/g) ?? []).length, 3, '继续打印页：空、读不到、列表三种结论卡都带着边界那一句')

/* 点击区与插画（同一包）：协议行那颗勾选框原来只有 48，登录页四张「记在哪」卡的插画原来被压成一条缝。 */
const loginCss = read('src/pages/auth/login-touch.css')
assert.match(
  loginCss,
  /\.k-agree \.k-agree-check,\s*\n[^\n]*\.k-agree \.doclink \{[^}]*min-height: 64px;[^}]*min-width: 64px;/,
  '登录页：协议勾选框和两个协议链接的可点区不小于 64×64',
)
assert.match(loginCss, /\.lg-fact \.qxp-artbox \{ min-height: 96px; \}/, '登录页：四张「记在哪」卡的插画保底 96 高，放不下由页面滚动，不压插画')
assert.match(loginCss, /\.lg-fact \{ min-height: 224px; overflow: hidden; \}/, '登录页：「记在哪」卡保底 224 高')

console.log('ALL PASS fusion W5 route, boundary, and presentation contract')
