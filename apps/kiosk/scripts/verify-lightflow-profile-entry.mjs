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

  expect(
    selectors.every((selector) => selector.startsWith('.kprofile.kprofile-lightflow')),
    `${relativePath} scopes every selector from .kprofile.kprofile-lightflow`,
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
const serviceDeskRouteList = kioskRootSource.split('const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [')[1]?.split(']')[0] ?? ''

expectIncludes(
  packageJson,
  '"verify:lightflow-profile-entry": "node scripts/verify-lightflow-profile-entry.mjs"',
  'package registers the LightFlow profile contract',
)

expectNotIncludes(profile, 'ReferenceServiceNav', 'ProfilePage removes the homepage-only reference navigation')
expectIncludes(profile, 'className="kprofile kprofile-lightflow"', 'ProfilePage binds the LightFlow root on its page shell')
expectIncludes(profile, '<h1 className="kprofile-sr-only">我的</h1>', 'ProfilePage keeps an accessible-only page heading without visible 我的 copy')
expectIncludes(profile, 'className="kp-service-directory"', 'ProfilePage groups existing entries in the compact service directory')
expectIncludes(profile, 'SECTIONS.map((section) =>', 'ProfilePage renders all five real sections from the existing entry configuration')
expectNotIncludes(profile, 'lf-reference-', 'ProfilePage does not reuse homepage service-card primitives')
expectNotIncludes(header, 'lf-reference-', 'ProfileHeader does not reuse homepage service-card primitives')
expectNotIncludes(section, 'lf-reference-', 'ProfileEntrySection does not reuse homepage service-card primitives')
expectNotIncludes(sessionRecords, 'lf-reference-', 'ProfileSessionRecords does not reuse homepage service-card primitives')
expectNotIncludes(header, '<h1>我的', 'ProfileHeader does not render a visible 我的 page title')
expectIncludes(serviceDeskRouteList, "'/profile'", 'KioskRoot opts the /profile landing page into the LightFlow shell')
expectNotIncludes(serviceDeskRouteList, "'/me'", 'KioskRoot does not opt /me/* detail routes into LightFlow')

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
  'className="kp-profile-boundary"',
  'className="p-stats"',
]) {
  expectIncludes(header, marker, `ProfileHeader preserves ${marker}`)
}
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
  ['AI助手', '/assistant'],
  ['浏览记录', '/me/activity'],
  ['外部跳转记录', '/me/activity?tab=jump'],
  ['权益活动', '/activities?source=fair'],
  ['权益活动', '/activities'],
  ['政策补贴指引', '/renshi?tab=policy'],
  ['消息通知', '/me/notifications'],
  ['账号设置', '/me/settings'],
  ['身份切换', '/me/settings'],
  ['帮助中心', '/help'],
  ['意见反馈', '/me/feedback'],
]

expect(countMatches(entries, /\blabel:\s*'/g) === 27, 'Profile entries retain exactly 27 real labels')
for (const [label, route] of expectedEntries) {
  expectMatches(
    entries,
    new RegExp(`label:\\s*'${escapeRegexp(label)}'[\\s\\S]{0,180}?route:\\s*'${escapeRegexp(route)}'`),
    `Profile entries retain ${label} -> ${route}`,
  )
}
for (const label of ['招聘会扫码凭证', '求职打印套餐', 'AI服务套餐']) {
  expectMatches(
    entries,
    new RegExp(`label:\\s*'${escapeRegexp(label)}'[\\s\\S]{0,180}?tag:\\s*'建设中'`),
    `Profile entries retain ${label} as a construction-state entry`,
  )
}
expect(countMatches(entries, /tag:\s*'建设中'/g) === 3, 'Profile entries retain exactly three construction-state tags')
for (const title of ['我的资产', '常用服务', '招聘会与活动', '权益活动与服务套餐', '账户与支持']) {
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
expectIncludes(combinedProfileCss, '--lf-blue:', 'Profile CSS defines the single bright-blue action token')
expectIncludes(combinedProfileCss, '--lf-ink:', 'Profile CSS defines the deep navy text token')
expectIncludes(combinedProfileCss, 'min-block-size: 56px;', 'Profile CSS retains 56px primary touch targets')
expectIncludes(combinedProfileCss, 'min-block-size: 48px;', 'Profile CSS retains 48px secondary touch targets')
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
expectNotIncludes(combinedProfileCss, 'box-shadow:', 'Profile CSS does not restore large panel shadows')

for (const marker of [
  '--paper:',
  '--serif:',
  '#f4f1e8',
  '#fffdf8',
  '#10302b',
  '#1f9e86',
  'Noto Serif',
  'Source Han Serif',
  'Songti',
  'SimSun',
  'repeating-linear-gradient(0deg',
  'mask-image:',
]) {
  expectNotIncludes(combinedProfileCss, marker, `Profile CSS removes InkPaper marker ${marker}`)
}

const forbiddenMeChanges = changedFiles().filter((path) => path.startsWith('apps/kiosk/src/pages/profile/me/'))
expect(forbiddenMeChanges.length === 0, `candidate change set does not touch /me/* (${forbiddenMeChanges.join(', ') || 'none'})`)

if (failures > 0) {
  console.error(`\n${failures} LightFlow /profile contract checks failed`)
  process.exit(1)
}

console.log('\nALL PASS LightFlow /profile 主入口静态合同')
