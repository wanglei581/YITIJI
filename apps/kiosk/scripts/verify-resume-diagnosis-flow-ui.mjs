import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function readOptional(path) {
  try {
    return read(path)
  } catch {
    return ''
  }
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
const layoutControls = readOptional('src/pages/resume/components/ResumeLayoutControls.tsx')
const optimizedEditor = readOptional('src/pages/resume/components/OptimizedResumeEditor.tsx')
const layoutHook = readOptional('src/pages/resume/hooks/useResumeLayout.ts')
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

// ── Wave1 Task 8:目标维度(专业/学历)输入 + 优化版多格式导出入口 ──────────
const httpAdapter = read('src/services/api/aiHttpAdapter.ts')

assertIncludes(source, 'targetMajor', 'source page tracks major input')
assertIncludes(source, 'targetDegree', 'source page tracks degree input')
assertIncludes(source, 'major: targetMajor', 'source page merges major into target context')
assertIncludes(source, 'degree: targetDegree', 'source page merges degree into target context')

assertIncludes(report, "navigate('/resume/optimize'", 'report page navigates to optimize page')
assertIncludes(report, 'targetContext: state.targetContext', 'report page forwards targetContext into optimize navigate state')

assertIncludes(optimize, "'pdf'", 'optimize page offers pdf export format')
assertIncludes(optimize, "'docx'", 'optimize page offers docx export format')
assertIncludes(optimize, "'txt'", 'optimize page offers txt export format')
assertIncludes(optimize, "'md'", 'optimize page offers md export format')
assertIncludes(optimize, 'Word', 'optimize page labels docx as Word')
assertIncludes(optimize, 'Markdown', 'optimize page labels md as Markdown')
assertIncludes(optimize, 'exportFormat', 'optimize page tracks selected export format state')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout)', 'optimize page exports with selected format and layout')
assertNotIncludes(optimize, '¥', 'optimize page shows no pricing copy')
assertNotIncludes(optimize, '付费', 'optimize page shows no paywall copy')
assertNotIncludes(optimize, '元/', 'optimize page shows no per-unit pricing copy')

assertIncludes(httpAdapter, 'format?: ResumeExportFormat', 'http adapter accepts optional export format')
assertIncludes(httpAdapter, 'layout?: ResumeLayoutSettings', 'http adapter accepts optional layout')
assertIncludes(httpAdapter, 'format ?? ', 'http adapter defaults export format to pdf when omitted')
assertIncludes(httpAdapter, '...(layout ? { layout } : {})', 'http adapter sends layout only when provided')

// ── Wave1 wrapper-consistency fix:导出格式必须走统一 API wrapper,不直连 adapter ──
const aiWrapper = read('src/services/api/ai.ts')

assertNotIncludes(optimize, "from '../../services/api/aiHttpAdapter'", 'optimize page does not import http adapter directly')
assertNotIncludes(optimize, "from '../../services/api/aiMockAdapter'", 'optimize page does not import mock adapter directly')
assertIncludes(optimize, "import { exportGeneratedResume, getResumeOptimize } from '../../services/api'", 'optimize page imports exportGeneratedResume from the api wrapper barrel')

assertIncludes(aiWrapper, 'format?: ResumeExportFormat', 'api wrapper exportGeneratedResume accepts optional export format')
assertIncludes(aiWrapper, 'layout?: ResumeLayoutSettings', 'api wrapper exportGeneratedResume accepts optional layout')
assertIncludes(aiWrapper, 'adapter.exportGeneratedResume(resume, taskId, token, format, layout)', 'api wrapper delegates format and layout to the selected adapter')

// ── Wave2 Task 3:优化页拆分 + 受控排版参数 + PDF layout 导出 ────────────────
assertIncludes(optimize, 'ResumeLayoutControls', 'optimize page renders layout controls component')
assertIncludes(optimize, 'OptimizedResumeEditor', 'optimize page renders extracted structured resume editor')
assertIncludes(optimize, 'useResumeLayout', 'optimize page uses layout hook')
assertIncludes(layoutHook, 'DEFAULT_RESUME_LAYOUT', 'layout hook defines default resume layout')
assertIncludes(layoutHook, 'fontScale', 'layout hook tracks font scale')
assertIncludes(layoutHook, 'lineSpacing', 'layout hook tracks line spacing')
assertIncludes(layoutHook, 'margin', 'layout hook tracks margin')
assertIncludes(layoutHook, 'columns', 'layout hook tracks columns')
assertIncludes(layoutHook, 'accent', 'layout hook tracks accent')
assertIncludes(layoutControls, '字号', 'layout controls expose font scale choices')
assertIncludes(layoutControls, '行距', 'layout controls expose line spacing choices')
assertIncludes(layoutControls, '页边距', 'layout controls expose margin choices')
assertIncludes(layoutControls, '主色', 'layout controls expose accent choices')
assertIncludes(layoutControls, '单栏', 'layout controls expose single column choice')
assertIncludes(layoutControls, '双栏', 'layout controls expose double column choice')
assertIncludes(optimizedEditor, 'GeneratedResume', 'optimized resume editor is typed around GeneratedResume')
assertIncludes(optimize, 'exportGeneratedResume(optimizedResume, taskId, getToken(), exportFormat, layout)', 'optimize page exports with selected layout')
assertIncludes(optimize, 'setExported(null)', 'optimize page clears stale export when layout/content changes')
assertIncludes(optimize, 'printFileUrl', 'optimize page still uses printFileUrl for PDF print path')
assertNotIncludes(optimize, 'signedUrl || exported.printFileUrl', 'optimize page must not fall back from printFileUrl to signedUrl for printing')

console.log('PASS resume diagnosis flow UI verification')
