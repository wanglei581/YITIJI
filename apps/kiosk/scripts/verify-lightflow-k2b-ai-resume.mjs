import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
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

function expectCssContract(path, routeRoots) {
  const source = read(path)
  const lines = source.split(/\r?\n/).length
  expect(source.length > 0, `${path} exists`)
  expect(lines < 300, `${path} stays below 300 lines`)
  expectIncludes(source, '.resume-lightflow', `${path} scopes styles to resume-lightflow`)
  expectIncludes(source, '@media (prefers-reduced-motion: reduce)', `${path} supports reduced motion`)
  for (const routeRoot of routeRoots) {
    expectIncludes(source, `.${routeRoot}`, `${path} scopes styles to ${routeRoot}`)
  }
  expect(
    /:is\([^)]*\)(?:\.resume-lightflow|:where\(\.resume-lightflow\))/.test(source),
    `${path} binds the shared namespace to its route root on the same element`,
  )
  expect(
    !/^\s*\.resume-lightflow(?:__|\s|\{|:)/m.test(source),
    `${path} never starts a selector from the shared resume-lightflow namespace`,
  )
  for (const forbiddenSelector of ['html', 'body', ':root']) {
    expectNotIncludes(source, `${forbiddenSelector} {`, `${path} does not override ${forbiddenSelector}`)
  }
}

console.log('\n=== K2b AI 简历青序 LightFlow 静态合同 ===')

const packageJson = read('package.json')
const kioskShell = read('src/layouts/KioskRoot.tsx')
const source = read('src/pages/resume/ResumeSourcePage.tsx')
const parse = read('src/pages/resume/ResumeParsePage.tsx')
const report = read('src/pages/resume/ResumeReportPage.tsx')
const generate = read('src/pages/resume/ResumeGeneratePage.tsx')
const preview = read('src/pages/resume/ResumeGeneratePreviewPage.tsx')
const optimize = read('src/pages/resume/ResumeOptimizePage.tsx')
const templates = read('src/pages/resume/ResumeTemplateLibraryPage.tsx')
const materials = read('src/pages/resume/JobMaterialLibraryPage.tsx')
const exportPage = read('src/pages/resume/ResumeExportPage.tsx')

expectIncludes(
  packageJson,
  '"verify:lightflow-k2b-ai-resume": "node scripts/verify-lightflow-k2b-ai-resume.mjs"',
  'package registers the K2b visual contract',
)

expectIncludes(kioskShell, 'const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [', 'Kiosk shell declares exact LightFlow route list')
expectIncludes(kioskShell, 'SERVICE_DESK_EXACT_ROUTES.includes(pathname)', 'Kiosk shell uses exact LightFlow route matching')
expectNotIncludes(kioskShell, "startsWith('/resume')", 'Kiosk shell never broad-matches resume routes')
const serviceDeskRouteList = kioskShell.split('const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [')[1]?.split(']')[0] ?? ''
const expectedServiceDeskRoutes = [
  '/',
  '/help',
  '/assistant',
  '/profile',
  '/resume/source',
  '/resume/parse',
  '/resume/report',
  '/resume/generate',
  '/resume/generate/preview',
  '/resume/optimize',
  '/resume/templates',
  '/resume/materials',
  '/resume/export',
]
const serviceDeskRoutes = [...serviceDeskRouteList.matchAll(/['\"]([^'\"]+)['\"]/g)].map((match) => match[1])
expect(
  serviceDeskRoutes.length === expectedServiceDeskRoutes.length
    && new Set(serviceDeskRoutes).size === expectedServiceDeskRoutes.length
    && expectedServiceDeskRoutes.every((route) => serviceDeskRoutes.includes(route)),
  'Kiosk shell route whitelist is exactly the approved 13 LightFlow routes including profile',
)
for (const route of expectedServiceDeskRoutes) {
  expectIncludes(serviceDeskRouteList, `'${route}'`, `Kiosk shell whitelists ${route}`)
}
expect(serviceDeskRoutes.every((route) => !route.startsWith('/me')), 'Kiosk shell keeps every /me detail route out of LightFlow')

for (const [page, sourceCode, rootClass, cssPath] of [
  ['source', source, 'resume-source-lightflow', './resume-diagnosis-lightflow.css'],
  ['parse', parse, 'resume-parse-lightflow', './resume-diagnosis-lightflow.css'],
  ['report', report, 'resume-report-lightflow', './resume-diagnosis-lightflow.css'],
  ['generate', generate, 'resume-generate-lightflow', './resume-authoring-lightflow.css'],
  ['generate preview', preview, 'resume-generate-preview-lightflow', './resume-authoring-lightflow.css'],
  ['optimize', optimize, 'resume-optimize-lightflow', './resume-authoring-lightflow.css'],
  ['templates', templates, 'resume-templates-lightflow', './resume-library-lightflow.css'],
  ['materials', materials, 'resume-materials-lightflow', './resume-library-lightflow.css'],
  ['export', exportPage, 'resume-export-lightflow', './resume-library-lightflow.css'],
]) {
  expectIncludes(sourceCode, `import '${cssPath}'`, `${page} imports its local LightFlow CSS`)
  expectIncludes(sourceCode, 'resume-lightflow', `${page} uses shared local LightFlow namespace`)
  expectIncludes(sourceCode, rootClass, `${page} uses its route-specific LightFlow root`)
}

expectCssContract('src/pages/resume/resume-diagnosis-lightflow.css', [
  'resume-source-lightflow',
  'resume-parse-lightflow',
  'resume-report-lightflow',
])
expectCssContract('src/pages/resume/resume-authoring-lightflow.css', [
  'resume-generate-lightflow',
  'resume-generate-preview-lightflow',
  'resume-optimize-lightflow',
])
expectCssContract('src/pages/resume/resume-library-lightflow.css', [
  'resume-templates-lightflow',
  'resume-materials-lightflow',
  'resume-export-lightflow',
])

for (const [sourceCode, marker, label] of [
  [source, 'useBusyLock(uploading || phoneBusy)', 'source keeps upload busy lock'],
  [source, 'UploadSessionQrPanel', 'source keeps phone upload session'],
  [parse, 'submitResumeParse(', 'parse keeps real resume parse request'],
  [parse, 'saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })', 'parse keeps minimal session only'],
  [report, 'getResumeRecord(taskId, { token: getToken(), accessToken })', 'report keeps token-gated record read'],
  [report, "navigate('/resume/optimize'", 'report keeps optimize handoff'],
  [generate, 'useBusyLock(generating)', 'generate keeps busy lock'],
  [generate, 'submitResumeGenerate(input, getToken())', 'generate keeps wrapper submission'],
  [preview, 'exportGeneratedResume(resume, result.taskId, getToken())', 'preview keeps real export wrapper'],
  [preview, 'exported?.printFileUrl', 'preview only enables real print URL'],
  [optimize, 'confirmLeave', 'optimize keeps dirty-leave guard'],
  [optimize, 'useBusyLock(exporting || printNavigating || Boolean(adjusting))', 'optimize keeps busy lock'],
  [optimize, 'exported?.printFileUrl', 'optimize only enables real print URL'],
  [templates, 'getResumeTemplates()', 'templates keep real template read'],
  [templates, 'aria-pressed={selected?.id === template.id}', 'templates expose actual selection state'],
  [materials, 'readJobMaterialDraft()', 'materials keep draft recovery'],
  [materials, 'file.printFileUrl', 'materials print only real file URL'],
  [exportPage, 'disabled', 'export does not enable a fake print action'],
]) {
  expectIncludes(sourceCode, marker, label)
}

for (const marker of ['我的简历.pdf', '248 KB', 'savedResume:', 'savedKind:', 'new Date().toISOString()']) {
  expectNotIncludes(exportPage, marker, `export does not fabricate ${marker}`)
}
expectIncludes(exportPage, '当前流程尚未生成可导出的真实文件', 'export explains the honest no-context state')
expectIncludes(exportPage, "navigate('/resume/source'", 'export returns users to the real resume flow')

if (failures > 0) {
  console.error(`\n${failures} K2b LightFlow contract checks failed`)
  process.exit(1)
}

console.log('\nALL PASS K2b AI 简历青序 LightFlow 静态合同')
