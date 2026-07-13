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

console.log('\n=== LightFlow /profile 主入口静态合同 ===')

const packageJson = read('package.json')
const profile = read('src/pages/profile/ProfilePage.tsx')
const entries = read('src/pages/profile/profileEntries.ts')
const css = read('src/pages/profile/profile-inkpaper.css')
const kioskRootSource = read('src/layouts/KioskRoot.tsx')
const serviceDeskRouteList = kioskRootSource.split('const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [')[1]?.split(']')[0] ?? ''

expectIncludes(
  packageJson,
  '"verify:lightflow-profile-entry": "node scripts/verify-lightflow-profile-entry.mjs"',
  'package registers the LightFlow profile contract',
)

expectIncludes(profile, 'className="kprofile kprofile-lightflow"', 'ProfilePage binds the LightFlow root on its page shell')
expectIncludes(profile, 'className="kp-service-directory"', 'ProfilePage groups existing entries in the compact service directory')
expectIncludes(serviceDeskRouteList, "'/profile'", 'KioskRoot opts the /profile landing page into the LightFlow shell')
expectNotIncludes(serviceDeskRouteList, "'/me'", 'KioskRoot does not opt /me/* detail routes into LightFlow')

for (const marker of [
  'useAuth()',
  'useMemberProfileOverview(isLoggedIn, getToken)',
  '<ProfileHeader',
  '<PendingTaskBanner',
  '<ProfileSessionRecords',
  'SECTIONS.map',
  'const goLogin = () => navigate(\'/login\', { state: { from: location.pathname } })',
  "navigate('/me/settings')",
  "navigate('/me/notifications')",
  "navigate('/print/preview'",
]) {
  expectIncludes(profile, marker, `ProfilePage preserves ${marker}`)
}

for (const route of [
  '/me/resumes',
  '/me/documents',
  '/me/ai-records',
  '/me/print-orders',
  '/me/favorites',
  '/me/benefits',
  '/resume/source',
  '/resume/templates',
  '/print/upload',
  '/print-scan',
  '/scan/start',
  '/jobs',
  '/job-fairs',
  '/assistant',
  '/me/activity',
  '/activities',
  '/renshi?tab=policy',
  '/me/notifications',
  '/me/settings',
  '/help',
  '/me/feedback',
]) {
  expectIncludes(entries, route, `Profile entries retain ${route}`)
}

expectIncludes(css, '.kprofile.kprofile-lightflow', 'Profile CSS scopes every LightFlow rule to the profile landing root')
expect(
  !/^\s*\.kprofile(?!\.kprofile-lightflow\b)/m.test(css),
  'Profile CSS never starts a rule from the unscoped kprofile namespace',
)
expect(!/^\s*(?:html|body|:root)\b/m.test(css), 'Profile CSS never overrides a global root selector')
expectIncludes(css, '--lf-canvas:', 'Profile CSS defines the LightFlow ice-blue canvas token')
expectIncludes(css, '--lf-blue:', 'Profile CSS defines the single bright-blue action token')
expectIncludes(css, '--lf-ink:', 'Profile CSS defines the deep navy text token')
expectIncludes(css, 'grid-template-columns: repeat(2, minmax(0, 1fr));', 'Profile CSS uses compact two-column service cards')
expectIncludes(css, 'min-height: 56px;', 'Profile CSS retains 56px primary touch targets')
expectIncludes(css, 'min-width: 48px;', 'Profile CSS retains 48px secondary touch targets')
expectIncludes(css, '@media (prefers-reduced-motion: reduce)', 'Profile CSS keeps reduced-motion support')

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
  expectNotIncludes(css, marker, `Profile CSS removes InkPaper marker ${marker}`)
}

const forbiddenMeChanges = changedFiles().filter((path) => path.startsWith('apps/kiosk/src/pages/profile/me/'))
expect(forbiddenMeChanges.length === 0, `candidate change set does not touch /me/* (${forbiddenMeChanges.join(', ') || 'none'})`)

if (failures > 0) {
  console.error(`\n${failures} LightFlow /profile contract checks failed`)
  process.exit(1)
}

console.log('\nALL PASS LightFlow /profile 主入口静态合同')
