import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '..', '..')
const read = (relativePath) => {
  const absolutePath = join(kioskRoot, relativePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

let failures = 0

function expect(condition, message) {
  if (condition) console.log(`PASS ${message}`)
  else {
    failures += 1
    console.error(`FAIL ${message}`)
  }
}

function expectIncludes(source, marker, message) {
  expect(source.includes(marker), `${message}${source.includes(marker) ? '' : ` — missing ${marker}`}`)
}

function expectNotIncludes(source, marker, message) {
  expect(!source.includes(marker), `${message}${source.includes(marker) ? ` — unexpected ${marker}` : ''}`)
}

function expectMatches(source, pattern, message) {
  expect(pattern.test(source), `${message}${pattern.test(source) ? '' : ` — missing ${pattern}`}`)
}

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function canResolveGitRef(ref) {
  try {
    git(['rev-parse', '--verify', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

function ensureMergeBase(baseRef) {
  try {
    git(['merge-base', baseRef, 'HEAD'])
  } catch {
    git(['fetch', '--no-tags', '--deepen=50', 'origin'])
    git(['merge-base', baseRef, 'HEAD'])
  }
}

function resolveDiffBase() {
  const githubBaseRef = process.env.GITHUB_BASE_REF?.trim()
  if (githubBaseRef) {
    const githubBase = `origin/${githubBaseRef}`
    if (!canResolveGitRef(githubBase)) {
      git(['fetch', '--no-tags', '--depth=1', 'origin', `${githubBaseRef}:refs/remotes/origin/${githubBaseRef}`])
    }
    if (canResolveGitRef(githubBase)) return githubBase
  }

  if (canResolveGitRef('origin/main')) return 'origin/main'
  throw new Error('无法解析 diff base：origin/main 不存在，且 GITHUB_BASE_REF 未提供或无法获取')
}

function changedFiles() {
  const diffBase = resolveDiffBase()
  ensureMergeBase(diffBase)
  const collect = (args) => git(args).split('\n').filter(Boolean)
  return [...new Set([
    ...collect(['diff', '--name-only', `${diffBase}...HEAD`]),
    ...collect(['diff', '--name-only']),
    ...collect(['diff', '--cached', '--name-only']),
    ...collect(['ls-files', '--others', '--exclude-standard']),
  ])]
}

function escapeRegexp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length
}

function assertProfileCssScope(relativePath, source) {
  expect(source.length > 0, `${relativePath} exists for the split Profile stylesheet`)
  expect(!/^\s*(?:html|body|:root)\b/m.test(source), `${relativePath} never overrides a global root selector`)
  expect(!/\.me-inkdetail\b/.test(source), `${relativePath} never touches /me detail styling`)

  const selectors = [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((selector) => selector && !selector.startsWith('@'))
    .flatMap((selector) => selector.split(',').map((part) => part.trim()))

  const allowedFrameSelector = "[data-kiosk-presentation='fusion-youth'] .fusion-w5--profile-entry > .ui-kiosk-page-content"
  expect(
    selectors.every((selector) => selector.startsWith('.kprofile.kprofile-lightflow') || selector === allowedFrameSelector),
    `${relativePath} scopes every selector to the profile entry surface`,
  )
}

console.log('\n=== LightFlow /profile 主入口静态合同 ===')

const packageJson = read('package.json')
const profile = read('src/pages/profile/ProfilePage.tsx')
const header = read('src/pages/profile/components/ProfileHeader.tsx')
const section = read('src/pages/profile/components/ProfileEntrySection.tsx')
const sessionRecords = read('src/pages/profile/components/ProfileSessionRecords.tsx')
const entries = read('src/pages/profile/profileEntries.ts')
const cssEntry = read('src/pages/profile/profile-inkpaper.css')
const profileCssFiles = [
  'src/pages/profile/profile-inkpaper.css',
  'src/pages/profile/profile-lightflow-shell.css',
  'src/pages/profile/profile-lightflow-directory.css',
  'src/pages/profile/profile-lightflow-state.css',
]
const profileCss = profileCssFiles.map((path) => read(path))
const combinedProfileCss = profileCss.join('\n')
const kioskRootSource = read('src/layouts/KioskRoot.tsx')
expectIncludes(
  packageJson,
  '"verify:lightflow-profile-entry": "node scripts/verify-lightflow-profile-entry.mjs"',
  'package registers the LightFlow profile contract',
)

expectNotIncludes(profile, 'ReferenceServiceNav', 'ProfilePage removes the homepage-only reference navigation')
expectMatches(
  profile,
  /className="[^"]*\bkprofile\s+kprofile-lightflow\b[^"]*"/,
  'ProfilePage binds the LightFlow root on its page shell',
)
expectMatches(
  profile,
  /<KioskPageFrame\b[^>]*className="[^"]*\bfusion-w5--profile-entry\b[^"]*"/,
  'ProfilePage exposes a dedicated frame class for exact prototype gutter control',
)
expectIncludes(profile, '<h1 className="kprofile-sr-only">我的</h1>', 'ProfilePage keeps an accessible-only page heading without visible 我的 copy')
expectIncludes(profile, 'className="kp-service-directory"', 'ProfilePage groups existing entries in the compact service directory')
expectIncludes(profile, 'SECTIONS.map((section) =>', 'ProfilePage renders all five real sections from the existing entry configuration')
expectNotIncludes(profile, 'lf-reference-', 'ProfilePage does not reuse homepage service-card primitives')
expectNotIncludes(header, 'lf-reference-', 'ProfileHeader does not reuse homepage service-card primitives')
expectNotIncludes(section, 'lf-reference-', 'ProfileEntrySection does not reuse homepage service-card primitives')
expectNotIncludes(sessionRecords, 'lf-reference-', 'ProfileSessionRecords does not reuse homepage service-card primitives')
expectNotIncludes(header, '<h1>我的', 'ProfileHeader does not render a visible 我的 page title')
expectIncludes(kioskRootSource, 'visualTheme="service-desk"', 'KioskRoot keeps /profile on the unified service-desk shell')
expectIncludes(kioskRootSource, 'presentation="fusion-youth"', 'KioskRoot keeps fusion-youth presentation for profile')
expectNotIncludes(kioskRootSource, 'SERVICE_DESK_EXACT_ROUTES', 'KioskRoot no longer maintains a LightFlow route whitelist')

const profileHeaderMountIndex = profile.indexOf('<ProfileHeader')
const pendingTaskMountIndex = profile.indexOf('{isLoggedIn && hasSessionRecords && <PendingTaskBanner')
const toastMountIndex = profile.indexOf('{toastMsg && (')
const sessionRecordsMountIndex = profile.indexOf('{hasSessionRecords && (\n          <ProfileSessionRecords')
const serviceDirectoryIndex = profile.indexOf('<div className="kp-service-directory">')
expect(
  [
    profileHeaderMountIndex,
    pendingTaskMountIndex,
    toastMountIndex,
    sessionRecordsMountIndex,
    serviceDirectoryIndex,
  ].every((index) => index !== -1)
    && profileHeaderMountIndex < pendingTaskMountIndex
    && pendingTaskMountIndex < toastMountIndex
    && toastMountIndex < sessionRecordsMountIndex
    && sessionRecordsMountIndex < serviceDirectoryIndex,
  'ProfileHeader, pending task, toast, session records, and five-section directory mount in the required strict order',
)

for (const marker of [
  'useAuth()',
  'useMemberProfileOverview(isLoggedIn, getToken)',
  '<ProfileHeader',
  '<PendingTaskBanner',
  '<ProfileSessionRecords',
  'hasSessionRecords &&',
  "const goLogin = () => navigate('/login', { state: { from: location.pathname } })",
  "navigate('/me/settings')",
  "navigate('/me/notifications')",
  "navigate('/print/preview'",
]) {
  expectIncludes(profile, marker, `ProfilePage preserves ${marker}`)
}

for (const marker of [
  'reserveBannerSpace',
  'onLogin',
  'onLogout',
  'onOpenSettings',
  'onOpenNotifications',
  'className="kp-profile-header',
  'className="kp-profile-main"',
  'className="p-stats"',
]) {
  expectIncludes(header, marker, `ProfileHeader preserves ${marker}`)
}
expectNotIncludes(header, 'kp-profile-boundary', 'ProfileHeader removes the non-prototype boundary panel')
expectNotIncludes(header, 'p-hero', 'ProfileHeader removes the old p-hero visual shell')

for (const marker of [
  'className="kp-section"',
  'className="kp-section-head"',
  'className={`kp-entry-grid kp-entry-grid--${section.layout}`}',
  'section.entries.map((entry, index)',
  "const disabled = entry.tag === '建设中'",
  'disabled={disabled}',
]) {
  expectIncludes(section, marker, `ProfileEntrySection uses ${marker}`)
}
expectNotIncludes(section, 'primaryEntry', 'ProfileEntrySection keeps every entry visually equal')
expectNotIncludes(section, 'sec-head', 'ProfileEntrySection removes the old sec-head visual shell')

for (const marker of [
  'className="kp-session-records"',
  'className="kp-section-head"',
  'className="kp-session-row"',
  'onPrintFile',
  'onDeleteResume',
  'onDeleteScan',
  'onDeleteAiRecord',
]) {
  expectIncludes(sessionRecords, marker, `ProfileSessionRecords preserves ${marker}`)
}

const expectedEntries = [
  ['我的简历', '/me/resumes'],
  ['我的文档', '/me/documents'],
  ['AI服务记录', '/me/ai-records'],
  ['打印订单', '/me/print-orders'],
  ['我的收藏', '/me/favorites'],
  ['我的权益', '/me/benefits'],
  ['AI简历服务', '/resume/source'],
  ['简历模板', '/resume/templates'],
  ['文档打印', '/print/upload'],
  ['打印扫描', '/print-scan'],
  ['扫描文件', '/scan/start'],
  ['岗位信息', '/jobs'],
  ['招聘会', '/job-fairs'],
  ['AI顾问', '/assistant'],
  ['浏览记录', '/me/activity'],
  ['外部跳转记录', '/me/activity?tab=jump'],
  ['权益活动', '/activities'],
  ['政策补贴指引', '/renshi?tab=policy'],
  ['消息通知', '/me/notifications'],
  ['账号设置', '/me/settings'],
  ['帮助中心', '/help'],
  ['意见反馈', '/me/feedback'],
]

expect(countMatches(entries, /\blabel:\s*'/g) === 22, 'Profile entries retain exactly 22 real destinations')
for (const [label, route] of expectedEntries) {
  expectMatches(
    entries,
    new RegExp(`label:\\s*'${escapeRegexp(label)}'[\\s\\S]{0,180}?route:\\s*'${escapeRegexp(route)}'`),
    `Profile entries retain ${label} -> ${route}`,
  )
}
expectNotIncludes(entries, '招聘会扫码凭证', 'Profile removes the unavailable job-fair credential placeholder')
expectNotIncludes(entries, '招聘会权益活动', 'Profile removes the duplicate fair-scoped activity destination')
expectNotIncludes(entries, '求职打印套餐', 'Profile removes the unavailable print package placeholder')
expectNotIncludes(entries, 'AI服务套餐', 'Profile removes the unavailable AI package placeholder')
expectNotIncludes(entries, '/activities?source=fair', 'Profile keeps a single real activities destination')
expect(countMatches(entries, /tag:\s*'建设中'/g) === 0, 'Profile contains no construction-state tags')
expectNotIncludes(entries, "label: '身份切换'", 'Profile does not duplicate the account settings destination')
for (const title of ['我的资产', '常用服务', '招聘会与活动', '权益与政策', '账户与支持']) {
  expect(countMatches(entries, new RegExp(`title:\\s*'${title}'`, 'g')) === 1, `Profile entry grouping retains ${title} exactly once`)
}
expectNotIncludes(entries, 'entries: [...FAIRS, ...BENEFITS]', 'Profile entry grouping does not collapse the two prototype sections')
expectNotIncludes(entries, '一键投递', 'Profile entries do not add a recruitment closed-loop label')
expectNotIncludes(entries, '立即投递', 'Profile entries do not add a recruitment closed-loop label')
expectNotIncludes(entries, '平台投递', 'Profile entries do not add a recruitment closed-loop label')

expect(
  cssEntry.trim() === [
    "@import './profile-lightflow-shell.css';",
    "@import './profile-lightflow-directory.css';",
    "@import './profile-lightflow-state.css';",
  ].join('\n'),
  'Profile CSS entrypoint only aggregates the three local LightFlow slices',
)
for (let index = 0; index < profileCssFiles.length; index += 1) {
  assertProfileCssScope(profileCssFiles[index], profileCss[index])
}
expectIncludes(combinedProfileCss, '--lf-canvas:', 'Profile CSS defines the LightFlow ice-blue canvas token')
expectIncludes(combinedProfileCss, '--lf-paper:', 'Profile CSS exposes the prototype paper token through the current theme')
expectIncludes(combinedProfileCss, '--lf-serif:', 'Profile CSS exposes the prototype display-font stack')
expectIncludes(combinedProfileCss, '--lf-blue:', 'Profile CSS defines the single bright-blue action token')
expectIncludes(combinedProfileCss, '--lf-ink:', 'Profile CSS defines the deep navy text token')
expectMatches(
  combinedProfileCss,
  /\.fusion-w5--profile-entry\s*>\s*\.ui-kiosk-page-content\s*\{[^}]*padding:\s*0;/,
  'Profile frame neutralizes the shared 48px inset exactly once',
)
expectMatches(
  combinedProfileCss,
  /\.kp-inner\s*\{[\s\S]*?width:\s*min\(984px,\s*calc\(100%\s*-\s*96px\)\);[\s\S]*?gap:\s*18px;[\s\S]*?margin:\s*26px auto 0;/,
  'Profile content matches prototype 14 at 984px width, 48px gutters, 18px rhythm, and 26px top inset',
)
expectMatches(
  combinedProfileCss,
  /\.kp-profile-header\s*\{[^}]*border-top:\s*4px solid var\(--lf-blue\);[^}]*border-radius:\s*18px;[^}]*box-shadow:\s*0 3px 14px/,
  'Profile identity header restores the prototype accented card treatment',
)
expectMatches(
  combinedProfileCss,
  /\.kp-section\s*\{[^}]*border:\s*1px solid var\(--lf-line\);[^}]*border-radius:\s*18px;[^}]*box-shadow:\s*0 3px 14px/,
  'Profile five sections restore the prototype card treatment',
)
expectMatches(
  combinedProfileCss,
  /\.kp-section-head h2\s*\{[^}]*font-family:\s*var\(--lf-serif\);[^}]*font-size:\s*26px;/,
  'Profile section headings match prototype 14 display typography',
)
expectIncludes(combinedProfileCss, 'min-block-size: 56px;', 'Profile CSS retains 56px primary touch targets')
expectMatches(
  combinedProfileCss,
  /\.p-iconbtn\s*\{[^}]*min-inline-size:\s*56px;[^}]*min-block-size:\s*56px;/,
  'Profile icon actions exceed the 48px secondary touch-target minimum',
)
expectIncludes(header, "className={`p-actions ${isLoggedIn ? 'p-actions--member' : 'p-actions--guest'}`}", 'ProfileHeader distinguishes guest/member action layouts')
expectMatches(
  combinedProfileCss,
  /\.p-actions--guest\s*\{[^}]*display:\s*flex;[^}]*margin-inline-start:\s*0;/,
  'Profile guest login CTA owns a flexible 176px action track without clipping at 1080px',
)
expectMatches(
  combinedProfileCss,
  /\.p-actions--member \.p-btn\.ghost\s*\{[^}]*padding-inline:\s*16px;/,
  'Profile member logout CTA fits the fixed 122px action grid across Chinese font stacks',
)
expectIncludes(combinedProfileCss, 'var(--color-plum-deep, var(--color-plum))', 'Profile plum/rose icons keep a defined category-color fallback')
expectIncludes(combinedProfileCss, 'var(--color-wheat-deep, var(--color-wheat-fg))', 'Profile wheat icons keep a defined category-color fallback')
expectIncludes(combinedProfileCss, 'min-block-size: 92px;', 'Profile CSS gives every directory entry the same 92px desktop height')
expectMatches(
  combinedProfileCss,
  /@media\s*\(max-width:\s*520px\)[\s\S]*?\.kprofile\.kprofile-lightflow \.kp-entry-grid[\s\S]*?grid-template-columns:\s*1fr;/,
  'Profile CSS collapses the equal entry grid to one column at 520px',
)
expectIncludes(combinedProfileCss, '@media (prefers-reduced-motion: reduce)', 'Profile CSS keeps reduced-motion support')
expectNotIncludes(combinedProfileCss, 'lf-reference-', 'Profile CSS removes homepage service-card selectors')
expectNotIncludes(combinedProfileCss, 'p-hero', 'Profile CSS removes the old p-hero visual shell')
expectNotIncludes(combinedProfileCss, 'sec-head', 'Profile CSS removes the old sec-head visual shell')

for (const marker of [
  '#f4f1e8',
  '#fffdf8',
  '#10302b',
  '#1f9e86',
  'repeating-linear-gradient(0deg',
  'mask-image:',
]) {
  expectNotIncludes(combinedProfileCss, marker, `Profile CSS keeps raw prototype token ${marker} out of page-local styles`)
}

// W5 keeps the LightFlow profile landing contract while migrating the owned /me/*
// presentation surfaces to the shared fusion frame. Keep this allowlist explicit so
// unrelated member pages still fail closed.
const allowedMeChanges = new Set([
  'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MeListShell.tsx',
  'apps/kiosk/src/pages/profile/me/MyActivityPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyResumesPage.tsx',
  // W22：系统通知页迁共享壳 + 诚实空态（仍复用 /me/notifications 真实路由）
  'apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx',
  // 2026-09-03 补全（只加不减，不动任何断言逻辑）：
  //
  // 这四条是本名单**意外遗漏**的，不是被刻意排除的。证据：
  //   本守卫引入于 afc7f4a38（2026-07-14）；而 MyPrintOrdersPage 与 MyFeedbackPage
  //   在 main 上的最后一次改动分别是 3a588d09e / 2028fcd92，都在 2026-07-04 ——
  //   比守卫早十天。也就是说守卫落地时这两页恰好无人改动，此后再没被碰过，
  //   于是从未有人做出「把它们排除在外」的决定。13 个 /me 页面里另外 11 个都在名单内。
  //
  // 触发点：2026-09-03 的分支同时修了「打印订单显示单双面 / 优惠额 / 退款额」与
  //   「意见反馈页游客说明槽」，成为第一个撞上这条无条件守卫的分支。
  //   不补名单的代价是丢弃这两处已完成并验证过的修复。
  'apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/OrderPaymentSummary.tsx',
  'apps/kiosk/src/pages/profile/me/printOrders/PickupCodePanel.tsx',
  'apps/kiosk/src/pages/profile/me/me-detail-inkpaper.css',
  'apps/kiosk/src/pages/profile/me/activityPresentation.ts',
  'apps/kiosk/src/pages/profile/me/styles/me-assets.css',
  'apps/kiosk/src/pages/profile/me/styles/me-detail-base.css',
  'apps/kiosk/src/pages/profile/me/styles/me-orders.css',
  'apps/kiosk/src/pages/profile/me/styles/me-records.css',
  'apps/kiosk/src/pages/profile/me/styles/me-settings-feedback.css',
])
const forbiddenMeChanges = changedFiles().filter(
  (path) => path.startsWith('apps/kiosk/src/pages/profile/me/') && !allowedMeChanges.has(path),
)
expect(forbiddenMeChanges.length === 0, `candidate change set does not touch /me/* (${forbiddenMeChanges.join(', ') || 'none'})`)

if (failures > 0) {
  console.error(`\n${failures} LightFlow /profile contract checks failed`)
  process.exit(1)
}

console.log('\nALL PASS LightFlow /profile 主入口静态合同')
