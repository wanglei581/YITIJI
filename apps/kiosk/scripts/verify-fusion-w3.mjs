import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const sha256 = (path) => createHash('sha256').update(read(path)).digest('hex')
let failures = 0
const check = (condition, message) => {
  if (condition) console.log(`PASS ${message}`)
  else { failures += 1; console.error(`FAIL ${message}`) }
}
const includes = (path, marker, message) => check(read(path).includes(marker), `${message}: ${marker}`)

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function splitSelectorList(source) {
  const selectors = []
  let current = ''
  let quote = ''
  let escaped = false
  let parens = 0
  let brackets = 0
  for (const char of source) {
    if (escaped) { escaped = false; current += char; continue }
    if (char === '\\') { escaped = true; current += char; continue }
    if (quote) { if (char === quote) quote = ''; current += char; continue }
    if (char === '"' || char === "'") { quote = char; current += char; continue }
    if (char === '(') parens += 1
    else if (char === ')') parens = Math.max(0, parens - 1)
    else if (char === '[') brackets += 1
    else if (char === ']') brackets = Math.max(0, brackets - 1)
    if (char === ',' && parens === 0 && brackets === 0) {
      if (current.trim()) selectors.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) selectors.push(current.trim())
  return selectors
}

function collectCssSelectors(source) {
  const css = stripCssComments(source)
  const selectors = []
  let preamble = ''
  let quote = ''
  let escaped = false
  let keyframeDepth = -1
  let depth = 0
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (escaped) { escaped = false; preamble += char; continue }
    if (char === '\\') { escaped = true; preamble += char; continue }
    if (quote) { if (char === quote) quote = ''; preamble += char; continue }
    if (char === '"' || char === "'") { quote = char; preamble += char; continue }
    if (char === ';' && depth === 0) { preamble = ''; continue }
    if (char === '{') {
      const head = preamble.trim()
      const isAtRule = head.startsWith('@')
      const isKeyframes = /^@(?:-\w+-)?keyframes\b/i.test(head)
      if (isKeyframes) keyframeDepth = depth + 1
      else if (!isAtRule && keyframeDepth < 0 && head) {
        selectors.push(...splitSelectorList(head))
      }
      depth += 1
      preamble = ''
      continue
    }
    if (char === '}') {
      if (keyframeDepth === depth) keyframeDepth = -1
      depth = Math.max(0, depth - 1)
      preamble = ''
      continue
    }
    preamble += char
  }
  check(depth === 0 && !quote, 'CSS scanner ends with balanced braces and strings')
  return selectors
}

const routes = [
  '/resume', '/resume/upload', '/resume/source', '/resume/generate',
  '/resume/generate/preview', '/resume/parse', '/resume/report',
  '/resume/optimize', '/resume/export', '/resume/templates',
  '/resume/materials', '/resume/job-fit', '/resume/career-plan',
  '/assistant', '/interview/setup', '/interview/session',
  '/interview/report', '/interview/tips', '/interview/reports',
]
check(routes.length === 19 && new Set(routes).size === 19, 'W3 route inventory is exactly 19 unique patterns')
const manifest = read('tests/visual/route-manifest.ts')
for (const route of routes) check(manifest.includes(`'${route}'`), `manifest retains ${route}`)

const frozen = {
  'src/pages/upload/components/UploadSessionQrPanel.tsx': '0c1606a0cab8bfe63fedeaa6dfa39676e80b9f5d4cf3c320ef27d629d5f885db',
  'src/pages/resume/aiResumeSession.ts': '5d023ee2388ecb12a3ba84a6b2b28c21e54ad65dece16eccc019f9dc43b5b164',
  'src/pages/resume/jobMaterialDraft.ts': '4a2404627c392c55cd39a6f525c522ce27cfec669f91d3b6ad5bb79f0de358ce',
  'src/pages/resume/hooks/useResumeLayout.ts': '2ef1c554e949344ce9d66430c521b986f5419db8627c4fcde1ef78d5927555e7',
  'src/pages/interview/session/types.ts': 'f3139d5375df69db492fc9428a3b4d99cc2ab389c081b50093418f71d3d0f369',
  'src/hooks/useAiAdvisorCallSession.ts': '2b3f721231a5559e258634afdfe4649a868eebcc420dca94fbfdf8ce396ada5e',
}
for (const [path, hash] of Object.entries(frozen)) check(sha256(path) === hash, `${path} remains frozen`)

const cssFiles = [
  'src/pages/resume/styles/resume-fusion-common.css',
  'src/pages/resume/styles/resume-fusion-diagnosis.css',
  'src/pages/resume/styles/resume-fusion-authoring.css',
  'src/pages/resume/styles/resume-fusion-library.css',
  'src/pages/resume/styles/resume-fusion-job-fit.css',
]
for (const path of cssFiles) check(existsSync(join(ROOT, path)), `${path} exists`)
const selectorOwners = new Map()
for (const path of cssFiles) {
  const source = read(path)
  check(!/@import\s/.test(source), `${path} does not import a peer leaf`)
  for (const selector of collectCssSelectors(source)) {
    const owners = selectorOwners.get(selector) ?? new Set()
    owners.add(path)
    selectorOwners.set(selector, owners)
  }
}
for (const [selector, owners] of selectorOwners) check(owners.size === 1, `selector has one owner: ${selector}`)
const jobFitSelectors = collectCssSelectors(read('src/pages/resume/styles/resume-fusion-job-fit.css'))
check(jobFitSelectors.every((selector) => selector.startsWith('.job-fit-inkpaper')), 'job-fit selectors are fully scoped')
check(read('src/pages/resume/resume-fusion-youth.css') === "@import './styles/resume-fusion-common.css';\n@import './styles/resume-fusion-diagnosis.css';\n@import './styles/resume-fusion-authoring.css';\n@import './styles/resume-fusion-library.css';\n", 'resume compatibility entrypoint is import-only')
check(read('src/pages/resume/jobFit-inkpaper.css') === "@import './styles/resume-fusion-job-fit.css';\n", 'job-fit compatibility entrypoint is import-only')

const screens = new Map([
  ['src/pages/resume/ResumeSourcePage.tsx', 'resume-source'],
  ['src/pages/resume/ResumeParsePage.tsx', 'resume-parse'],
  ['src/pages/resume/ResumeReportPage.tsx', 'resume-report'],
  ['src/pages/resume/ResumeGeneratePage.tsx', 'resume-generate'],
  ['src/pages/resume/ResumeGeneratePreviewPage.tsx', 'resume-generate-preview'],
  ['src/pages/resume/ResumeOptimizePage.tsx', 'resume-optimize'],
  ['src/pages/resume/ResumeExportPage.tsx', 'resume-export'],
  ['src/pages/resume/ResumeTemplateLibraryPage.tsx', 'resume-templates'],
  ['src/pages/resume/JobMaterialLibraryPage.tsx', 'resume-materials'],
  ['src/pages/resume/JobFitPage.tsx', 'resume-job-fit'],
  ['src/pages/resume/CareerPlanPage.tsx', 'resume-career-plan'],
  ['src/pages/assistant/AssistantPage.tsx', 'assistant'],
  ['src/pages/interview/InterviewSetupPage.tsx', 'interview-setup'],
  ['src/pages/interview/InterviewSessionPage.tsx', 'interview-session'],
  ['src/pages/interview/InterviewReportPage.tsx', 'interview-report'],
  ['src/pages/interview/InterviewTipsPage.tsx', 'interview-tips'],
  ['src/pages/interview/InterviewReportsPage.tsx', 'interview-reports'],
])
for (const [path, screen] of screens) {
  includes(path, 'KioskPageFrame', `${screen} consumes the frozen W1 frame`)
  includes(path, `data-kiosk-screen="${screen}"`, `${screen} exposes its stable landmark`)
}

includes('src/pages/resume/ResumeSourcePage.tsx', 'UploadSessionQrPanel', 'resume source keeps the shared upload session')
includes('src/pages/resume/ResumeParsePage.tsx', 'submitResumeParse(', 'resume parse keeps the real AI/OCR request')
includes('src/pages/resume/ResumeReportPage.tsx', 'extractionNotice', 'resume report keeps OCR provenance')
includes('src/pages/assistant/AssistantPage.tsx', 'chatWithAssistant({', 'assistant keeps the real text request')
includes('src/pages/assistant/AssistantPage.tsx', "import('./AssistantCallPanel')", 'assistant keeps TRTC lazy loading')
includes('src/pages/interview/InterviewSessionPage.tsx', 'transcribeAnswer(', 'interview keeps real ASR review')
includes('src/pages/interview/InterviewSessionPage.tsx', 'answerInterview(', 'interview keeps question progression')
includes('src/pages/resume/ResumeSourcePage.tsx', 'useBusyLock(uploading || phoneBusy)', 'upload busy lock remains')
includes('src/pages/resume/ResumeSourcePage.tsx', "navigate('/resume/parse'", 'source keeps parse handoff')
includes('src/pages/resume/ResumeParsePage.tsx', 'saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })', 'anonymous session remains minimal')
includes('src/pages/resume/ResumeReportPage.tsx', 'getResumeRecord(taskId, { token: getToken(), accessToken })', 'report read remains credential gated')
includes('src/pages/resume/ResumeReportPage.tsx', 'extractionNotice.warnings', 'OCR warnings remain visible')
includes('src/pages/resume/ResumeGeneratePage.tsx', 'submitResumeGenerate(input, getToken())', 'generation keeps real submission')
includes('src/pages/resume/ResumeGeneratePreviewPage.tsx', 'exported?.printFileUrl', 'preview prints only a real file URL')
includes('src/pages/resume/ResumeOptimizePage.tsx', 'confirmLeave', 'optimization keeps dirty-leave protection')
includes('src/pages/resume/ResumeOptimizePage.tsx', 'useBusyLock(exporting || printNavigating || Boolean(adjusting))', 'optimization keeps busy lock')
includes('src/pages/resume/ResumeOptimizePage.tsx', 'setExported(null)', 'content/layout changes invalidate stale export')
includes('src/pages/resume/ResumeExportPage.tsx', '当前流程尚未生成可导出的真实文件', 'export keeps honest no-context state')
includes('src/pages/resume/ResumeTemplateLibraryPage.tsx', 'getResumeTemplates()', 'templates keep real loading')
includes('src/pages/resume/JobMaterialLibraryPage.tsx', 'readJobMaterialDraft()', 'materials keep draft recovery')
includes('src/pages/resume/JobMaterialLibraryPage.tsx', 'generated.printFileUrl', 'materials print only real output')
includes('src/pages/resume/JobFitPage.tsx', 'analyzeJobFit(', 'job-fit keeps real analysis')
includes('src/pages/resume/JobFitPage.tsx', 'getLatestJobFit(', 'job-fit keeps refresh recovery')
includes('src/pages/resume/JobFitPage.tsx', 'printJobFit(', 'job-fit keeps real PDF output')
includes('src/pages/resume/CareerPlanPage.tsx', 'generateCareerPlan(', 'career plan keeps real generation')
includes('src/pages/resume/CareerPlanPage.tsx', 'printCareerPlan(', 'career plan keeps real print output')
includes('src/pages/assistant/AssistantPage.tsx', 'requestTokenRef.current', 'assistant ignores stale responses')
includes('src/pages/assistant/AssistantPage.tsx', 'sessionIdRef.current = newSessionId()', 'assistant resets shared-terminal sessions')
includes('src/pages/assistant/AssistantPage.tsx', 'safeActions', 'assistant filters returned actions')
includes('src/pages/assistant/AssistantPage.tsx', 'ASSISTANT_USER_MESSAGE_MAX_LENGTH', 'assistant retains input limit')
includes('src/pages/assistant/AssistantCallPanel.tsx', 'data-kiosk-screen="assistant-call"', 'assistant call exposes its sub-state landmark')
for (const marker of ['startCall', 'resumePlay', 'toggleMute', 'endCall', 'needResume', 'micBlocked']) includes('src/pages/assistant/AssistantCallPanel.tsx', marker, `assistant call retains ${marker}`)
includes('src/pages/interview/InterviewReportPage.tsx', '练习结果仅供本人复盘，不会发送给任何企业。', 'interview report keeps the user-only privacy boundary')
const jobGuidancePresentation = `${read('src/pages/resume/JobFitPage.tsx')}\n${read('src/pages/resume/CareerPlanPage.tsx')}`
for (const forbidden of ['录用概率', '保证录用', '一键投递', '立即投递']) check(!jobGuidancePresentation.includes(forbidden), `job guidance rejects ${forbidden}`)
for (const forbidden of ['localStorage', 'sessionStorage']) check(!read('src/pages/assistant/AssistantPage.tsx').includes(forbidden), `assistant avoids ${forbidden}`)

if (existsSync(join(ROOT, 'playwright.w3.config.ts'))) {
  const config = read('playwright.w3.config.ts')
  const spec = read('tests/visual/fusion-w3.spec.ts')
  includes('playwright.w3.config.ts', 'testMatch: /fusion-w3\\.spec\\.ts$/', 'W3 browser config collects only its spec')
  includes('playwright.w3.config.ts', "port 4183 --strictPort", 'W3 browser config owns port 4183')
  for (const env of ['VITE_API_MODE=http', 'VITE_API_BASE_URL=/api/v1', 'VITE_USE_TRTC_CALL=true', 'VITE_ALLOW_TEXT_ONLY_ASSISTANT=false', 'VITE_TERMINAL_ID=KSK-001']) check(config.includes(env), `W3 browser build pins ${env}`)
  for (const name of ['resume upload → parse → OCR report', 'resume parse failure remains honest', 'assistant filters actions and survives service failure', 'TRTC explicit gate fails back to text safely', 'interview setup → text answer → report']) check(spec.includes(name), `W3 browser scenario exists: ${name}`)
  for (const forbidden of ['addInitScript', 'localStorage', 'sessionStorage', 'waitForTimeout']) check(!spec.includes(forbidden), `W3 browser spec avoids ${forbidden}`)
}

if (failures) process.exit(1)
console.log('ALL PASS W3 fusion contract')
