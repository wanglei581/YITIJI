import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')

const files = {
  page: read('src/pages/resume/ResumeReportPage.tsx'),
  model: read('src/pages/resume/resume-report-model.ts'),
  fixture: read('src/pages/resume/resume-report-fixture.ts'),
  css: read('src/pages/resume/resume-report-qx.css'),
  body: read('src/pages/resume/components/resume-report/ResumeReportBody.tsx'),
  issues: read('src/pages/resume/components/resume-report/ResumeReportIssues.tsx'),
  scores: read('src/pages/resume/components/resume-report/ResumeReportScores.tsx'),
  states: read('src/pages/resume/components/resume-report/ResumeReportStates.tsx'),
  actions: read('src/pages/resume/components/resume-report/ResumeReportActions.tsx'),
  chrome: read('src/pages/resume/components/resume-report/ResumeReportChrome.tsx'),
  root: read('src/layouts/KioskRoot.tsx'),
}
const all = Object.values(files).join('\n')

const failures = []
const assert = (ok, msg) => { if (!ok) failures.push(msg); else console.log(`PASS ${msg}`) }
const has = (src, marker) => src.includes(marker)

assert(has(files.root, "'/resume/report'"), 'KioskRoot QX_MIGRATED_ROUTES registers /resume/report')
assert(has(files.page, 'QxPageFrame'), 'report page uses QxPageFrame')
assert(has(files.page, "import './resume-report-qx.css'"), 'report page imports Qingxu CSS')
assert(has(files.page, 'data-kiosk-screen="resume-report"'), 'report keeps stable screen landmark')
assert(has(files.css, 'var(--qx-ink)'), 'page CSS uses Qingxu tokens')
assert(has(files.css, '--qx-tap-min'), 'page CSS keeps 48px touch floor token')

const statesLiteral = /export const REPORT_STATES = \[([\s\S]*?)\]/.exec(files.model)?.[1] ?? ''
for (const state of ['loading', 'report', 'report-empty', 'report-minimal', 'diagnose-failed', 'read-error', 'no-context', 'unavailable', 'illegal']) {
  assert(statesLiteral.includes(`'${state}'`), `state ${state} has a real corresponding branch`)
}

assert(has(files.issues, 'issue.evidence'), 'issues render original-quote evidence')
assert(has(files.issues, 'issue.impact'), 'issues render impact')
assert(has(files.issues, 'issue.fixIt'), 'issues render fix-it')
assert(has(files.issues, 'sevOf'), 'severity is derived from dimension scores')
assert(has(files.body, 'report.contentBlocks'), 'contentBlocks seven-block structure is rendered')
assert(has(files.body, '先改这几处'), 'first-screen priorities heading exists')
assert(has(files.scores, '每维一句人话'), 'each dimension has a human sentence')
assert(has(files.body, '这不是录取分'), 'page states this is not an admission score')
assert(has(files.page, 'truncatedInput'), 'truncation banner is wired')
assert(has(files.page, 'image_ocr'), 'OCR banner is gated on real OCR source')
assert(has(files.body, '不求和') && has(files.body, '不出总分'), 'empty or any report does not invent a total score')
assert(has(files.page, 'res.targetContext'), 'refresh recovers targetContext from the server record')
assert(has(all, '报告导出端点上线后开放'), 'print/export/QR honest reason is present')
assert(has(files.actions, 'aria-disabled="true"'), 'export actions use aria-disabled, not native disabled')
assert(!/<(button|input)[^>]*\sdisabled(\s|=|>)/.test(files.actions), 'export actions must not use native disabled')
assert(has(files.page, 'capture') || has(files.model, 'capture'), 'capture=1 fixture gate exists')
assert(has(files.page, '合成演示'), 'fixture data is labelled as synthetic')
assert(!has(all, '一键投递') && !has(all, '立即投递') && !has(all, '平台投递'), 'compliance: no platform apply copy')
assert(!has(all, '录用概率'), 'compliance: no hiring-probability percentage')
assert(has(files.page, '<ResumeDiagnosisFailExits'), 'diagnose-failed keeps non-AI exits')
assert(has(files.page, 'getResumeRecord(taskId, { token: getToken(), accessToken })'), 'record read stays credential-gated')

if (failures.length) {
  console.error('verify-resume-report-qx failed:')
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
console.log(`verify-resume-report-qx passed (${Object.keys(files).length} files)`)
