import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertIncludes(src, marker, label) {
  if (!src.includes(marker)) throw new Error(`${label}: missing ${marker}`)
  console.log(`PASS ${label}`)
}

function assertNotIncludes(src, marker, label) {
  if (src.includes(marker)) throw new Error(`${label}: unexpected ${marker}`)
  console.log(`PASS ${label}`)
}

const source = read('src/pages/resume/ResumeSourcePage.tsx')
const diagnosisForm = read('src/pages/resume/components/DiagnosisDirectionForm.tsx')
const parse = read('src/pages/resume/ResumeParsePage.tsx')
const report = read('src/pages/resume/ResumeReportPage.tsx')
const optimize = read('src/pages/resume/ResumeOptimizePage.tsx')
const mockAdapter = read('src/services/api/aiMockAdapter.ts')

assertIncludes(source, 'selectedDimensions', 'source page tracks diagnosis focus dimensions')
assertIncludes(source, 'targetContext', 'source page builds target context')
assertIncludes(source, 'DiagnosisDirectionForm', 'source page extracts diagnosis direction form')
assertIncludes(source, 'targetContext:', 'source page passes target context to parse')
assertIncludes(source, 'selectedDimensions:', 'source page passes selected dimensions to parse')
assertIncludes(source, 'useBusyLock(uploading || phoneBusy)', 'source page prevents standby during upload')
assertNotIncludes(source, 'Windows Agent 盘符直达待真机接入', 'source page removes internal usb implementation copy')
assertNotIncludes(source, '不直接连接第三方网盘', 'source page removes internal cloud implementation copy')

assertIncludes(diagnosisForm, 'RESUME_SCORING_DIMENSIONS', 'diagnosis form uses shared six dimensions')
assertIncludes(diagnosisForm, '通用诊断', 'diagnosis form supports generic diagnosis')
assertIncludes(diagnosisForm, '目标岗位', 'diagnosis form collects target job')
assertIncludes(diagnosisForm, 'aria-pressed', 'diagnosis dimension buttons expose pressed state')

assertIncludes(parse, 'selectedDimensions', 'parse page sends selected dimensions')
assertIncludes(parse, 'targetContext', 'parse page sends target context')
assertIncludes(parse, 'RESUME_SCORING_DIMENSIONS', 'parse page uses shared six dimensions')
assertIncludes(parse, 'MIN_STEP_MS', 'parse page gives visible dwell time to early steps')
assertIncludes(parse, 'DIMENSION_PROGRESS_BY_STEP', 'parse page maps processing steps to all six dimensions')
assertIncludes(parse, 'role="status"', 'parse page exposes processing status to assistive tech')
assertIncludes(parse, 'if (!fileId)', 'parse page blocks missing fileId')
assertNotIncludes(parse, 'local-${Date.now()}', 'parse page does not fabricate local file id')
assertNotIncludes(parse, 'duration:', 'parse page does not use fake timed step durations')

assertIncludes(report, 'targetContext', 'report keeps target context summary')
assertIncludes(report, '目标方向', 'report displays target direction summary')
assertIncludes(report, 'ReportNoticePanel', 'report page consolidates top notices')
assertIncludes(report, 'role="progressbar"', 'report section bars expose progressbar semantics')
assertIncludes(report, 'aria-valuenow', 'report section bars expose current score')

assertNotIncludes(optimize, 'estimateUplift', 'optimize page removes fake uplift estimator')
assertNotIncludes(optimize, '综合评分提升', 'optimize page removes fake numeric score uplift card')
assertIncludes(optimize, '表达调整参考', 'optimize page uses qualitative improvement language')
assertIncludes(optimize, 'useBusyLock(exporting || printNavigating)', 'optimize page prevents standby during export or print navigation')
assertIncludes(optimize, 'printNavigating', 'optimize page locks repeated print navigation')
assertIncludes(optimize, 'confirmLeave', 'optimize page protects edited resume content before leaving')
assertIncludes(optimize, 'splitView={false}', 'optimize diff uses touch-safe inline comparison')
assertIncludes(optimize, "confirmLeave ? 'overflow-hidden'", 'optimize page locks background scroll behind leave dialog')
assertIncludes(optimize, '[&_pre]:whitespace-pre-wrap', 'optimize diff wraps long lines on touch screens')

assertIncludes(mockAdapter, "key: 'objective'", 'mock adapter uses objective dimension')
assertIncludes(mockAdapter, "key: 'quantification'", 'mock adapter uses quantification dimension')
assertIncludes(mockAdapter, "key: 'readability'", 'mock adapter uses readability dimension')
assertNotIncludes(mockAdapter, "key: 'education'", 'mock adapter no longer returns old education dimension')
assertNotIncludes(mockAdapter, "key: 'layout'", 'mock adapter no longer returns old layout dimension')

console.log('PASS resume diagnosis flow UI verification')
