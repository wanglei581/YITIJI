import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function read(path) {
  const full = join(root, path)
  if (!existsSync(full)) fail(`Missing required file: ${path}`)
  return readFileSync(full, 'utf8')
}

function assertContains(path, pattern, message) {
  const content = read(path)
  const ok = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
  if (!ok) fail(`${message} (${path})`)
  pass(message)
}

function assertNotContains(path, patterns, message) {
  const content = read(path)
  for (const pattern of patterns) {
    const hit = pattern instanceof RegExp ? pattern.test(content) : content.includes(pattern)
    if (hit) fail(`${message} (${path})`)
  }
  pass(message)
}

console.log('\n=== Kiosk job material library UI verification ===')

const homeServicesPath = 'src/pages/home/serviceGroups.ts'

assertContains('package.json', '"verify:job-material-library-ui"', 'Kiosk package exposes job material UI verifier')
assertContains('src/services/api/index.ts', './jobMaterials', 'Kiosk API exports jobMaterials service')
assertContains('src/services/api/jobMaterials.ts', 'generateJobMaterial', 'Kiosk service can generate job material')
assertContains('src/services/api/jobMaterials.ts', 'getResumeTemplates', 'Kiosk service exposes resume template loader')
assertContains('src/services/api/jobMaterials.ts', 'isJobMaterialDocumentTemplate', 'Kiosk service separates resume templates from generated job materials')
assertContains(homeServicesPath, "title: '简历素材库'", 'Homepage keeps existing resume material tile')
assertContains(homeServicesPath, "title: '求职材料'", 'Homepage keeps existing job material tile')
assertContains(homeServicesPath, "to: '/resume/templates'", 'Homepage routes resume template tile to resume template library')
assertContains(homeServicesPath, "to: '/resume/materials'", 'Homepage routes job material tile to job material library')
assertNotContains(
  homeServicesPath,
  [/title:\s*'简历素材库'[^}]*disabled:\s*true/s, /title:\s*'求职材料'[^}]*disabled:\s*true/s],
  'Homepage job material tiles are no longer disabled',
)
assertContains('src/routes/index.tsx', 'JobMaterialLibraryPage', 'Kiosk routes job material library as a standalone page')
assertContains('src/routes/index.tsx', /path:\s*'resume\/templates'[\s\S]*?<ResumeTemplateLibraryPage \/>/, 'Kiosk keeps /resume/templates mapped to resume template library')
assertContains('src/routes/index.tsx', "path: 'resume/materials'", 'Kiosk exposes standalone /resume/materials route')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', '简历素材库', 'Resume template page is positioned as resume material library')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', "navigate('/resume/materials'", 'Legacy ?tab=materials URL redirects to job material library')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', "searchParams.get('tab') === 'materials'", 'Legacy redirect is gated by tab=materials')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'legacyMaterialsTab', 'Resume template page names the legacy materials redirect condition')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'if (legacyMaterialsTab)', 'Resume template page skips template loading for legacy materials redirect')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'getResumeTemplates', 'Resume template page only loads resume templates')
assertContains('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'handleUseResumeTemplate', 'Resume template page links to resume optimization flow')
assertNotContains(
  'src/pages/resume/ResumeTemplateLibraryPage.tsx',
  ['generateJobMaterial', '生成可打印版', '登录后生成', "navigate('/print/confirm'", '求职信', '感谢信', '作品集封面', '材料清单'],
  'Resume template page does not expose job material generation flow',
)
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', '求职材料库', 'Job material page is positioned as job material library')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', 'getJobMaterialTemplates', 'Job material page loads generated-material templates')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', 'generateJobMaterial', 'Job material page calls real generation API')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'JOB_MATERIAL_DRAFT_KEY', 'Job material draft helper uses a scoped draft key')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'sessionStorage.setItem', 'Job material page preserves draft before login redirect')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'sessionStorage.getItem', 'Job material page restores draft after login redirect')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'sessionStorage.removeItem', 'Job material page clears draft after successful generation')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'JOB_MATERIAL_DRAFT_TTL_MS', 'Job material login draft expires if abandoned')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'savedAt', 'Job material login draft stores a save timestamp')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'Date.now()', 'Job material login draft expiration uses current time')
assertContains('src/pages/resume/jobMaterialDraft.ts', 'export function clearJobMaterialDraft', 'Job material draft cleanup is reusable by kiosk reset guards')
assertContains('src/auth/kioskSensitiveSession.ts', 'clearKioskSensitiveSession', 'Kiosk exposes one sensitive session cleanup helper')
assertContains('src/auth/kioskSensitiveSession.ts', 'clearPrintMaterialSession()', 'Sensitive session cleanup clears print material session')
assertContains('src/auth/kioskSensitiveSession.ts', 'clearAiResumeSession()', 'Sensitive session cleanup clears AI resume session')
assertContains('src/auth/kioskSensitiveSession.ts', 'clearJobMaterialDraft()', 'Sensitive session cleanup clears job material draft')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', 'saveJobMaterialDraft', 'Job material page saves login draft through helper')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', 'readJobMaterialDraft', 'Job material page restores login draft through helper')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', 'clearJobMaterialDraft', 'Job material page clears login draft after generation')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', /items\.some\(\(item\) => item\.id === prev\)/, 'Job material page drops stale draft template selections')
assertContains('src/auth/AuthContext.tsx', 'clearKioskSensitiveSession', 'Auth logout clears sensitive sessions for all manual logout callers')
assertContains('src/auth/useIdleLogout.ts', 'clearKioskSensitiveSession', 'Idle logout uses unified sensitive session cleanup')
assertContains('src/hooks/useScreensaverController.ts', 'clearKioskSensitiveSession', 'Screensaver idle controller uses unified sensitive session cleanup')
assertContains('src/pages/screensaver/ScreensaverPage.tsx', 'clearKioskSensitiveSession', 'Screensaver page mount uses unified sensitive session cleanup')
assertContains('src/pages/auth/LoginPage.tsx', 'useIdleTimer', 'Login page has its own idle guard outside KioskRoot')
assertContains('src/pages/auth/LoginPage.tsx', 'clearKioskSensitiveSession', 'Login page idle guard clears sensitive sessions')
assertContains('src/pages/resume/JobMaterialLibraryPage.tsx', "navigate('/print/confirm'", 'Job material page can enter print confirm with generated file')
assertNotContains(
  'src/pages/resume/JobMaterialLibraryPage.tsx',
  ['用于简历优化', 'getResumeTemplates', '清爽通用简历模板'],
  'Job material page does not expose resume template optimization flow',
)
assertContains('src/pages/profile/me/MyDocumentsPage.tsx', 'name="printer"', 'MyDocuments exposes print action')
assertContains('src/pages/profile/me/MyDocumentsPage.tsx', "navigate('/print/confirm'", 'MyDocuments reuses print confirm route')
assertNotContains(
  'src/pages/resume/JobMaterialLibraryPage.tsx',
  ['MATERIALS:', '打印(待接入)', /disabled\s*title="模板真实渲染链路接入后开放打印"/],
  'Job material page no longer exposes local placeholder or disabled print CTA',
)
for (const page of ['src/pages/resume/ResumeTemplateLibraryPage.tsx', 'src/pages/resume/JobMaterialLibraryPage.tsx']) {
  assertContains(page, '系统不收取求职者简历给企业', `${page} keeps no-resume-collection compliance copy`)
  assertNotContains(
    page,
    ['一键投递', '立即投递', '平台投递', '发送给企业'],
    `${page} avoids forbidden recruiting flow wording`,
  )
}

console.log('\nALL PASS')
