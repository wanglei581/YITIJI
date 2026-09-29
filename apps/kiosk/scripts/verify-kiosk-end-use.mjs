#!/usr/bin/env node
/**
 * verify:kiosk-end-use —— 一体机「统一清场」（隐私 P0，走查 W-42 / W-43 / W-75 / W-64 / B-12；
 * 产品负责人 9/29 拍板「两处都堵，30 秒」）。
 *
 * 根因：以前每个离场出口各清各的（「我的」退出清一套、完成页到点只收起预览、换号只管跳登录页），
 * 总有一条路漏一样东西，下一位就看得到上一位的文件、订单或登录。这里钉三件事：
 *
 *   A. 所有离场出口都经 endKioskUse(reason)：结束使用、换号、闲置到点、完成页到点、「不是我」 /
 *      「结束上一位的使用」。页面不许自己 logout / 清本机数据 / 另起清场。
 *      （四步顺序由 scripts/tests/kiosk-end-use.test.mjs 真跑断言，这里不重复。）
 *   B. 首页登录态不露个人信息：不显示手机号（打码的也不显示）、不叫名字，只说「有人登录着」，
 *      并给「结束上一位的使用」；不放「进入我的」直达入口。
 *   C. 进个人资产页先问「还是你吗？」：距上次触屏超过 30 秒（KIOSK_HANDOVER_CONFIRM_MS），
 *      我的、我的文档、打印订单、AI 服务记录、我的简历……全部路由都包在 KioskHandoverGate 下，
 *      确认层出现时不挂载资产页（先确认、后读取）。
 *
 * 全部读源码文本（先剥注释），不 import、不连网。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '../..')
let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => { failures += 1; console.error(`  FAIL ${m}`) }
const check = (ok, m) => (ok ? pass(m) : fail(m))

const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')
/** 剥注释：注释里写「以前这里直接 logout()」不算回退。 */
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

console.log('\n=== 一体机统一清场（endKioskUse）===')

// ── A. 统一出口 ─────────────────────────────────────────────
const endUse = code('src/auth/kioskEndUse.ts')
const reasons = endUse.match(/KIOSK_END_USE_REASONS = \[([\s\S]*?)\] as const/)
check(
  reasons && [...reasons[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).join(',') === 'end_use,switch_account,idle_timeout,print_done_timeout,handover',
  '离场原因只有五种：end_use / switch_account / idle_timeout / print_done_timeout / handover',
)
check(
  /export function runEndKioskUse[\s\S]*?attempt\(\(\) => steps\.endVisit\(END_USE_VISIT_REASON\[reason\]\)\)\s*attempt\(steps\.clearLocal\)\s*attempt\(steps\.logout\)\s*steps\.leave\(endUseDestination\(reason, options\)\)/.test(endUse),
  'runEndKioskUse 四步：结束人次 → 清本机 → 退出登录 → 离开（单测另外真跑）',
)

const guard = code('src/auth/KioskPrivacyGuard.tsx')
check(
  /const endKioskUse = useCallback\(\(reason: KioskClearReason, options\?: KioskEndUseOptions\) => \{[\s\S]*?runEndKioskUse\(reason, \{[\s\S]*?endVisit: endKioskVisit,[\s\S]*?clearLocal: \(\) => clearKioskSensitiveSession\(getToken\(\)\),\s*logout: \(\) => logout\(\),\s*leave:/.test(guard),
  '守卫的 endKioskUse 把四步交给 runEndKioskUse（人次 / 清本机带令牌 / 退出登录 / 离开）',
)
check(
  /const hardClear = useCallback\(\(reason: KioskClearReason = 'privacy_fallback'\) => \{\s*endKioskUse\(reason\)/.test(guard),
  '兜底清场 hardClear 也经 endKioskUse',
)
check(
  /const clearToScreensaver = useCallback[\s\S]*?runEndKioskUse\('idle_timeout', \{/.test(guard),
  '闲置到点进屏保也经 runEndKioskUse(idle_timeout)',
)
check(/endKioskUse: endKioskUseFromPage/.test(guard), '页面拿到的 endKioskUse 只开放五种原因')
// 守卫里 clearKioskSensitiveSession / logout 只许出现在 runEndKioskUse 的步骤里（两处：endKioskUse、屏保）。
check(
  (guard.match(/clearKioskSensitiveSession\(/g) ?? []).length === 2 &&
    (guard.match(/\blogout\(\)/g) ?? []).length === 2,
  '守卫里清本机与退出登录各只出现两次（都在 runEndKioskUse 的步骤里），没有半清的旁路',
)
check(!/clearSessionFor|clearSessionTo/.test(guard + code('src/auth/KioskSessionControlContext.tsx')), '旧的 clearSessionTo / clearSessionFor 已收掉，页面没有第二个入口')

// 每个离场出口都经 endKioskUse。
const exits = [
  ['src/pages/profile/ProfilePage.tsx', /onEnd=\{\(\) => endKioskUse\('end_use'\)\}/, '「我的」结束使用'],
  ['src/pages/profile/me/MySettingsPage.tsx', /const handleLogout = [\s\S]{0,200}endKioskUse\('end_use'\)/, '账号设置「结束使用并退出登录」'],
  ['src/pages/profile/me/MySettingsPage.tsx', /const handleSwitch = [\s\S]{0,200}endKioskUse\('switch_account'\)/, '换号登录（W-64：先完整清场再进登录）'],
  ['src/pages/profile/me/MySettingsPage.tsx', /const handleRebindDone = [\s\S]{0,120}endKioskUse\('switch_account', \{ loginHint:/, '换绑成功重新登录'],
  ['src/pages/print/PrintDonePage.tsx', /const endOnTimeout = useCallback\(\(\) => \{\s*endKioskUse\('print_done_timeout'\)/, '打印完成页 60 秒到点（W-43）'],
  ['src/pages/print/PrintDonePage.tsx', /if \(endArmed\) \{\s*endKioskUse\('end_use'\)/, '打印完成页「我拿走了，结束使用」'],
  ['src/pages/home/HomePage.tsx', /onEndPrevious=\{\(\) => endKioskUse\('handover'\)\}/, '首页「结束上一位的使用」'],
  ['src/auth/KioskHandoverGate.tsx', /onCancel=\{\(\) => endKioskUse\('handover'\)\}/, '「还是你吗？」答「不是我」'],
  ['src/pages/placeholders/SessionTimeoutPage.tsx', /onClick=\{hardClear\}/, '超时提醒页结束按钮（hardClearFromWarning → endKioskUse）'],
]
for (const [rel, pattern, label] of exits) check(pattern.test(code(rel)), `${label} 经 endKioskUse`)
check(
  /hardClear\(pendingWarning !== null && Date\.now\(\) >= pendingWarning\.deadlineAt \? 'idle_timeout' : 'end_use'\)/.test(guard),
  '超时提醒页：到点算 idle_timeout，到点前按结束算 end_use',
)

// 页面不许自己退出登录 / 清本机数据。基础设施与两处有记录的例外之外，一处都不许有。
const ALLOWED = new Map([
  ['src/auth/AuthContext.tsx', 'logout 本体与 401 过期出口'],
  ['src/auth/KioskPrivacyGuard.tsx', 'endKioskUse 的执行者（上面已单独核对只在步骤里出现）'],
  ['src/auth/kioskSensitiveSession.ts', '清单本体'],
  ['src/auth/kioskClearScope.ts', '只判断是否空操作'],
  ['src/auth/memberSessionExpiryExit.ts', '401 过期不是离场出口，是令牌失效后的收尾'],
  ['src/pages/screensaver/ScreensaverPage.tsx', '屏保落地页再扫一遍（到这里之前已经走过 endKioskUse），纵深防御'],
  ['src/services/terminalAuth.ts', '终端身份换了，不是用户离场'],
])
const offenders = []
const stack = [join(kioskRoot, 'src')]
while (stack.length) {
  const dir = stack.pop()
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { stack.push(full); continue }
    if (!/\.(ts|tsx)$/.test(name)) continue
    const rel = relative(kioskRoot, full).split('\\').join('/')
    if (ALLOWED.has(rel)) continue
    const text = code(rel)
    if (/\blogout\s*\(|\{[^}]*\blogout\b[^}]*\}\s*=\s*useAuth\(\)|clearKioskSensitiveSession\s*\(|clearKioskSharedDeviceResidue\s*\(|clearSessionTo\b/.test(text)) offenders.push(rel)
  }
}
check(offenders.length === 0, `页面不自己 logout / 清本机数据（另起清场）${offenders.length ? '：' + offenders.join('、') : ''}`)
check(!/clearPrintMaterialSession\s*\(/.test(code('src/pages/print/PrintDonePage.tsx')), '打印完成页不再自己只清打印材料（半清）')

// ── B. 首页登录态 ───────────────────────────────────────────
const homeView = code('src/pages/home/components/QxHomeView.tsx')
const identity = code('src/pages/home/components/HomeIdentityActions.tsx')
const homePage = code('src/pages/home/HomePage.tsx')
check(
  !/displayName|phoneMasked|nickname|maskPhone|\buser\b/.test(homeView + identity) && !/displayName=/.test(homePage),
  '首页不读、不传登录人的名字或手机号（打码的也不显示）',
)
check(/const hello = greeting\b/.test(homeView), '首页问候不带名字')
check(
  /<span>有人登录着<\/span>/.test(identity) && /data-testid="home-end-previous"[\s\S]{0,80}结束上一位的使用/.test(identity),
  '登录态只写「有人登录着」，并给「结束上一位的使用」',
)
check(!/进入我的/.test(homeView + identity), '首页不放「进入我的」直达入口（进个人区走底部「我的」）')
check(
  /isLoggedIn \? 'true' : undefined/.test(homeView) && /data-member='true'/.test(read('src/pages/home/styles/home-qx.css')),
  '登录态那一行按稿 01 ?state=member 收起副标题、不折行',
)
const draft = readFileSync(join(repoRoot, 'docs/design/kiosk-redesign-2026-08-v2/01-home.html'), 'utf8')
check(
  /有人登录着<\/em><a class="end-prev"[^>]*>结束上一位的使用<\/a>/.test(draft) && /requested==='member'/.test(draft),
  '2.0 稿 01 首页有登录态 ?state=member（产品负责人 9/29 同意，FROZEN.json 已更新）',
)
// 空闲说明仍来自 kioskIdleTiming 单一来源（保留，不在本次改动范围内削弱）。
check(/homeStandbyNote\(/.test(homeView) && /publicIdleLogoutLabel\(\)/.test(homeView), '首页空闲说明仍读 kioskIdleTiming')

// ── C. 进个人资产页先问「还是你吗？」 ───────────────────────
const timing = code('src/auth/kioskIdleTiming.ts')
check(/export const KIOSK_HANDOVER_CONFIRM_MS = 30_000/.test(timing), 'KIOSK_HANDOVER_CONFIRM_MS = 30 秒（和空闲时长放一起）')
const presence = code('src/auth/kioskPresence.ts')
check(
  /return idleBeforeEntryMs\(now\) > KIOSK_HANDOVER_CONFIRM_MS/.test(presence),
  '判据：进来之前空了超过 30 秒（行为由单测真跑）',
)
const gate = code('src/auth/KioskHandoverGate.tsx')
check(
  /if \(!isLoggedIn \|\| !current\.ask\) return <Outlet \/>/.test(gate) && (gate.match(/<Outlet/g) ?? []).length === 1,
  '确认层出现时不挂载资产页（先确认、后读取）',
)
check(/ask: needsHandoverConfirm\(\)/.test(gate) && /decision\.key !== location\.key/.test(gate), '每换一次地址（含后退、深链）重新判一次')
check(
  /title="还是你吗？"/.test(gate) && /confirmLabel="是我，继续"/.test(gate) && /cancelLabel="不是我"/.test(gate) && /<SettingsConfirm/.test(gate),
  '确认层复用 2.0 确认弹层：「还是你吗？」「是我，继续」「不是我」',
)
check(/markKioskPresenceConfirmed\(\)/.test(code('src/auth/AuthContext.tsx')), '登录成功算本人刚确认过（扫码登录后直接进「我的」不再多问）')

const routes = code('src/routes/index.tsx')
const gateBlock = routes.match(/element: <KioskHandoverGate \/>,\s*children: \[([\s\S]*?)\n\s{8}\],/)
if (!gateBlock) fail('路由里找不到 KioskHandoverGate 包裹块')
else {
  const inside = [...gateBlock[1].matchAll(/path: '([^']+)'/g)].map((m) => m[1])
  const outside = [...routes.replace(gateBlock[0], '').matchAll(/path: '((?:profile|me\/)[^']*)'/g)].map((m) => m[1])
  const required = ['profile', 'me/documents', 'me/print-orders', 'me/ai-records', 'me/resumes']
  check(required.every((p) => inside.includes(p)), `我的、我的文档、打印订单、AI 服务记录、我的简历都在确认层下（共 ${inside.length} 个）`)
  check(outside.length === 0, `没有个人资产路由漏在确认层外${outside.length ? '：' + outside.join('、') : ''}`)
}

// ── 接线 ────────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'))
check(
  pkg.scripts['verify:kiosk-end-use'] === 'node scripts/verify-kiosk-end-use.mjs && node --test scripts/tests/kiosk-end-use.test.mjs',
  'package.json 注册 verify:kiosk-end-use（含单测）',
)
check(/pnpm --filter @ai-job-print\/kiosk verify:kiosk-end-use/.test(readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')), 'CI 一体机静态门禁步跑 verify:kiosk-end-use')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 一体机仍有离场出口没走统一清场，或首页 / 个人资产页会露出上一位\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS — 所有离场出口经 endKioskUse；首页不露登录人；个人资产页先问「还是你吗？」\n')
