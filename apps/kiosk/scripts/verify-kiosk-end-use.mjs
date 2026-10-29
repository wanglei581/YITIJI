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
 *      确认层出现时不挂载资产页（先确认、后读取）。弹出了没回答就一直是「待确认」（粘性标记，
 *      只在内存里）：确认层一弹出就记下，判断时先看它，本人答「是我」、清场退出登录、新的一位登录成功才解除；
 *      否则交接页一旦有出口（问小青、浏览器后退），下一位隔几秒再点「我的」就直接进了上一位的资料。
 *      空档一到判据时长就**当时**记待确认（不等进页、不等确认层）：定时器到点就记，下一下触碰发现空档早已超时
 *      也在这一下之前补记，之后任何触碰都解除不了；否则下一位先碰屏上别处、隔几秒再点「我的」，进页前只空了几秒，
 *      确认层从没弹过，也就从没记过标记，照样直接进了上一位的资料。
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
// W-64：换号后登录成功 replace 跳走，不能被当成「边界之前的旧历史」把下一位清回游客首页。
check(
  /const historyMatchesRoute = typeof historyState\.key !== 'string' \|\| historyState\.key === locationKey/.test(guard) &&
    /const isStaleHistoryEntry =\s*historyMatchesRoute &&\s*navigationType === 'POP' &&/.test(guard) &&
    /useLayoutEffect\(\(\) => \{[\s\S]{0,200}navigationType === 'POP'\) return[\s\S]{0,300}window\.history\.replaceState\(/.test(guard),
  '换号后登录 replace 跳走不被判成旧历史（只在 POP 且路由与浏览器记录对上时判旧，并给新记录补边界记号）',
)

// 每个离场出口都经 endKioskUse。
const exits = [
  ['src/pages/profile/ProfilePage.tsx', /const onEnd = \(\) => endKioskUse\('end_use'\)/, '「我的」结束使用'],
  ['src/pages/profile/me/MySettingsPage.tsx', /const handleLogout = [\s\S]{0,200}endKioskUse\('end_use'\)/, '账号设置「结束使用并退出登录」'],
  ['src/pages/profile/me/MySettingsPage.tsx', /const handleSwitch = [\s\S]{0,200}endKioskUse\('switch_account'\)/, '换号登录（W-64：先完整清场再进登录）'],
  ['src/pages/profile/me/MySettingsPage.tsx', /const handleRebindDone = [\s\S]{0,120}endKioskUse\('switch_account', \{ loginHint:/, '换绑成功重新登录'],
  ['src/pages/print/PrintDonePage.tsx', /const endOnTimeout = useCallback\(\(\) => \{\s*endKioskUse\('print_done_timeout'\)/, '打印完成页 60 秒到点（W-43）'],
  ['src/pages/print/PrintDonePage.tsx', /onClick=\{\(\) => \{\s*endKioskUse\('end_use'\)/, '打印完成页「我拿走了，结束使用」按一下就结束'],
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
const homeView = code('src/pages/home/components/HomeTouchView.tsx')
const identity = code('src/pages/home/components/HomeIdentityActions.tsx')
const homePage = code('src/pages/home/HomePage.tsx')
check(
  !/displayName|phoneMasked|nickname|maskPhone|\buser\b/.test(homeView + identity) && !/displayName=/.test(homePage),
  '首页不读、不传登录人的名字或手机号（打码的也不显示）',
)
check(
  /const greeting = greetingWord\(/.test(homeView) &&
    /eyebrow=\{greeting\}/.test(homeView) &&
    /title="我是小青"/.test(homeView) &&
    !/title=\{`\$\{greeting\}/.test(homeView),
  '眉题等于 greetingWord，标题只有「我是小青」',
)
check(
  /<span>有人登录着<\/span>/.test(identity) && /data-testid="home-end-previous"[\s\S]{0,80}结束上一位的使用/.test(identity),
  '登录态只写「有人登录着」，并给「结束上一位的使用」',
)
check(!/进入我的/.test(homeView + identity), '首页不放「进入我的」直达入口（进个人区走底部「我的」）')
check(
  /isLoggedIn \? 'true' : undefined/.test(homeView) && /data-member='true'/.test(read('src/pages/home/styles/home-touch.css')),
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
// 弹出了没回答就是「待确认」：判断先看这个标记，空多久、从哪条路进来都先问（行为由单测与浏览器用例真跑）。
check(
  /export function needsHandoverConfirm\(now: number = Date\.now\(\)\): boolean \{\s*if \(handoverPending\) return true\s*return idleBeforeEntryMs\(now\) > KIOSK_HANDOVER_CONFIRM_MS/.test(presence),
  '判据先看「待确认」标记（弹出了没回答就一直要问），再看进来之前空了多久',
)
check(
  /export function markKioskPresenceConfirmed\(at: number = Date\.now\(\)\): void \{\s*handoverPending = false/.test(presence) &&
    /export function clearHandoverPending\(\): void \{\s*handoverPending = false/.test(presence) &&
    /export function markHandoverPending\(\): void \{\s*handoverPending = true/.test(presence) &&
    (presence.match(/handoverPending = true/g) ?? []).length === 3 &&
    (presence.match(/handoverPending = false/g) ?? []).length === 4,
  '待确认只在这几处写：记下三处（确认层弹出、空档到点的定时器、下一下触碰发现空档早已超时）；解除只有答「是我」/ 新的一位登录成功、清场退出登录两处（再加初值与测试复位）',
)
// 空档一到判据时长就当时记（不等进页、不等确认层）：定时器时长就是判据时长，每一次触碰与本人刚确认都让它重新计，
// 触碰本身绝不解除标记；下一下触碰发现空档早已超时（定时器被挂起或晚到）就在这一下之前补记。行为由单测（mock 计时器）与浏览器用例真跑。
check(
  /idleMarkTimer = setTimeout\(\(\) => \{\s*idleMarkTimer = null\s*handoverPending = true\s*\}, KIOSK_HANDOVER_CONFIRM_MS\)/.test(presence),
  '空档计时的时长就是判据时长（KIOSK_HANDOVER_CONFIRM_MS），到点就记待确认',
)
{
  const touchBody = presence.match(/export function recordKioskTouch\(at: number = Date\.now\(\)\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
  const confirmedBody = presence.match(/export function markKioskPresenceConfirmed\(at: number = Date\.now\(\)\): void \{[\s\S]*?\n\}/)?.[0] ?? ''
  check(
    /armIdleMark\(\)/.test(touchBody) && /armIdleMark\(\)/.test(confirmedBody),
    '每一次触碰、本人刚确认过（登录成功、答「是我」）都让空档重新计：在场一直有操作不误弹，旧定时器不会把刚确认的人又记成待确认',
  )
  check(
    /if \(lastTouchAt !== null && at - lastTouchAt > KIOSK_HANDOVER_CONFIRM_MS\) handoverPending = true/.test(touchBody) && !/handoverPending = false/.test(touchBody),
    '下一下触碰发现空档早已超过判据时长就在这一下之前补记待确认；触碰本身绝不解除它',
  )
}
check(
  !/localStorage|sessionStorage|indexedDB|\bcookie\b|\bhistory\b|\blocation\b/.test(presence),
  '待确认标记只在内存里：kioskPresence 不碰 localStorage / sessionStorage / cookie / history / 地址（清场与重载让它当场消失）',
)
const gate = code('src/auth/KioskHandoverGate.tsx')
check(
  /const showConfirm = isLoggedIn && current\.ask/.test(gate) && /if \(!showConfirm\) return <Outlet \/>/.test(gate) && (gate.match(/<Outlet/g) ?? []).length === 1,
  '确认层出现时不挂载资产页（先确认、后读取）',
)
check(
  /useLayoutEffect\(\(\) => \{\s*if \(showConfirm\) markHandoverPending\(\)\s*\}, \[showConfirm\]\)/.test(gate),
  '确认层一弹出就记「待确认」（和确认层同一次提交，没有「画出来了、标记还没记」的间隙）',
)
check(/ask: needsHandoverConfirm\(\)/.test(gate) && /decision\.key !== location\.key/.test(gate), '每换一次地址（含后退、深链）重新判一次')
check(
  /title="还是你吗？"/.test(gate) && /confirmLabel="是我，继续"/.test(gate) && /cancelLabel="不是我，结束上一位的使用"/.test(gate) && /<SettingsConfirm/.test(gate) && /back=\{false\}/.test(gate) && /nav=\{false\}/.test(gate),
  '确认层复用卡片确认：「还是你吗？」「是我，继续」「不是我，结束上一位的使用」，且没有返回和底导航',
)
// 稿上这一屏的底栏「问小青」（AI 是驱动层，label 与 draft 照稿）。它是能离开这一屏的出口，
// 所以必须和上面的「待确认」粘性标记同在：离开再回来仍先问（浏览器用例 W-75 sticky 真跑）。
check(
  /ask=\{\{ label: '问小青：这一页是什么意思？', draft: '这一页是什么意思？' \}\}/.test(gate) && /markHandoverPending\(\)/.test(gate),
  '确认层底栏有稿上的「问小青：这一页是什么意思？」，并和「待确认」粘性标记同在（出口不会绕过确认）',
)
// 「不是我」那张卡配一叠纸（清掉这台机器上这一次的临时信息，同触屏稿「本机会清除」那张卡的用图），
// 不是手机 + 「上传」按钮的插画（10/29 本机走查 I-06：与「结束上一位的使用」的意思不搭）。「是我」仍配简历。
const settingsConfirm = code('src/pages/profile/me/components/SettingsConfirm.tsx')
check(
  /data-art="resume"><MeArt name="resume"/.test(settingsConfirm) && /data-art="stack"><MeArt name="stack"/.test(settingsConfirm) && !/MeArt name="phone"/.test(settingsConfirm),
  '确认层两张答案卡：「是我」配简历、「不是我」配一叠纸，不再用手机 + 上传的插画',
)
const authContext = code('src/auth/AuthContext.tsx')
check(/markKioskPresenceConfirmed\(\)/.test(authContext), '登录成功算本人刚确认过（扫码登录后直接进「我的」不再多问）')
check(
  /const logout = useCallback\(\(\) => \{[\s\S]*?clearHandoverPending\(\)[\s\S]*?\}, \[\]\)/.test(authContext),
  '退出登录（结束使用、「不是我」、闲置到点、401 过期都走这里）一并解除待确认，不留给下一位',
)

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
