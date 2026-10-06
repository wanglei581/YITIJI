import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const src = readFileSync(new URL('../src/pages/resume/components/resume-deliver/resumeDecisions.ts', import.meta.url), 'utf8')

assert.doesNotMatch(src, /split\(from\)\.join\(to\)/, 'replaceResumeText must not globally replace every occurrence')
assert.match(src, /let replaced = false/, 'replaceResumeText stops after the first string-field hit')
assert.match(src, /value\.indexOf\(from\)/, 'replaceResumeText finds the first hit with indexOf')
assert.match(src, /value\.slice\(0, index\) \+ to \+ value\.slice\(index \+ from\.length\)/, 'replaceResumeText rewrites only the first occurrence in that field')

const transpiled = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const runtimeModule = { exports: {} }
new Function('exports', 'module', transpiled)(runtimeModule.exports, runtimeModule)
const { replaceResumeText } = runtimeModule.exports

const sample = {
  basic: { name: 'hello', phone: '13800000000', city: '青岛' },
  intention: { position: '运营', city: '青岛' },
  summary: 'hello world hello',
  education: [],
  experience: [{ company: '对照公司', role: '专员', period: '2023-2024', description: 'hello there' }],
  projects: [],
  skills: ['hello'],
  certificates: [],
}

const firstField = replaceResumeText(sample, 'hello', 'hi')
assert.equal(firstField.basic.name, 'hi', 'first string field in object order is replaced')
assert.equal(firstField.summary, 'hello world hello', 'later fields that also contain the text stay unchanged')
assert.equal(firstField.experience[0].description, 'hello there', 'later nested strings stay unchanged')
assert.equal(firstField.skills[0], 'hello', 'later array strings stay unchanged')

const sameField = {
  ...sample,
  basic: { name: '对照样本', phone: '13800000000', city: '青岛' },
}
const onceInField = replaceResumeText(sameField, 'hello', 'hi')
assert.equal(onceInField.summary, 'hi world hello', 'only the first occurrence inside the hit field is replaced')
assert.equal(onceInField.experience[0].description, 'hello there')

assert.equal(replaceResumeText(sample, '', 'x'), sample)
assert.equal(replaceResumeText(sample, 'hello', 'hello'), sample)

const hook = readFileSync(new URL('../src/pages/resume/components/resume-deliver/useCompareDecisionsReturn.ts', import.meta.url), 'utf8')
assert.match(hook, /compareDecisionChanges\(/, 'compare return must include a chosen rewrite that is not already in the draft')
const page = readFileSync(new URL('../src/pages/resume/ResumeOptimizePage.tsx', import.meta.url), 'utf8')
assert.match(page, /第 \$\{number\} 条改写没能自动放进稿里，请在编辑区手动改。/, 'unplaced rewrite tells the user to edit by hand')

// W-116：运行文案函数，确保技术字段只转换成受控中文，不把服务端原话甩给用户。
const copySrc = readFileSync(new URL('../src/pages/resume/components/resume-deliver/optimizeStateCopy.ts', import.meta.url), 'utf8')
const copyModule = { exports: {} }
const { outputText: copyJs } = ts.transpileModule(copySrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const fallback = '原有非校验错误文案'
new Function('exports', 'module', 'require', copyJs)(copyModule.exports, copyModule, () => ({
  errorCodeOf: (error) => error.code,
  userMessageOf: () => fallback,
}))
const validation = (message) => Object.assign(new Error(message), { code: 'VALIDATION_FAILED' })
const { optimizeExportErrorMessage } = copyModule.exports
assert.match(optimizeExportErrorMessage(validation('basic.name should not be empty')), /姓名还没填写.*不能在本页修改.*重新上传并诊断/)
assert.match(optimizeExportErrorMessage(validation('summary must be shorter than or equal to 600 characters')), /个人简介.*600 字以内/)
// R-6（2026-10-04）：优化页可以改经历的公司、职务和教育的学校、专业。
// 这两条原先要求「不能在本页修改」。现在导出被拒要请用户回编辑区改，不再说不能改。
// 姓名断言保持原样：姓名仍然不能在本页修改。
assert.match(optimizeExportErrorMessage(validation('experience.0.role should not be empty')), /工作经历第 1 条的职务还没填写，请在编辑区补上后再导出。/)
assert.match(optimizeExportErrorMessage(validation('experience[0].role: role should not be empty')), /工作经历第 1 条的职务还没填写，请在编辑区补上后再导出。/)
assert.match(optimizeExportErrorMessage(validation('experience.0.company must be shorter than or equal to 100 characters')), /工作经历第 1 条的公司太长了，请在编辑区缩短到 100 字以内后再导出。/)
assert.match(optimizeExportErrorMessage(validation('education.0.school should not be empty')), /教育经历第 1 条的学校还没填写，请在编辑区补上后再导出。/)
assert.match(optimizeExportErrorMessage(validation('projects.0.role should not be empty')), /项目经历第 1 条的职务.*不能在本页修改.*重新上传并诊断/)
assert.match(optimizeExportErrorMessage(validation('education.0.degree should not be empty')), /教育经历第 1 条的学历.*不能在本页修改.*重新上传并诊断/)
assert.match(optimizeExportErrorMessage(validation('experience[0].description: description must be shorter than or equal to 1000 characters')), /工作经历第 1 条的描述.*编辑区.*1000 字以内/)
assert.match(optimizeExportErrorMessage(validation('intention.position should not be empty')), /求职意向可以留空.*现场工作人员.*修改清单/)
assert.doesNotMatch(optimizeExportErrorMessage(validation('unknown.field secret technical payload')), /unknown|secret|technical/)
assert.equal(optimizeExportErrorMessage({ code: 'NETWORK_ERROR' }), fallback)
assert.match(page, /setExportError\(optimizeExportErrorMessage\(err\)\)/, '优化稿导出接入专用错误文案')
assert.match(page, /setExportError\(userMessageOf\(err, '修改清单导出失败，请稍后重试'\)\)/, '修改清单沿用原来的错误文案')

// 就地校验与导出拒绝文案同一套边界：公司、学校、职务不能空，专业可以空；超长按字数拦住。
const titlesSrc = readFileSync(new URL('../src/pages/resume/components/resume-deliver/resumeEntryTitles.ts', import.meta.url), 'utf8')
const titlesModule = { exports: {} }
const { outputText: titlesJs } = ts.transpileModule(titlesSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
new Function('exports', 'module', titlesJs)(titlesModule.exports, titlesModule)
const { resumeTitleIssues } = titlesModule.exports
const titled = (experience, education) => ({
  basic: { name: '甲' },
  intention: {},
  summary: '',
  education,
  experience,
  projects: [{ name: '项目名'.repeat(40), role: '角色'.repeat(40), description: '' }],
  skills: [],
  certificates: [],
})
const messages = (resume) => resumeTitleIssues(resume).map((issue) => issue.message)
assert.deepEqual(messages(titled([{ company: '  ', role: '店员' }], [{ school: '青岛大学', major: '' }])), ['公司名不能空'])
assert.deepEqual(messages(titled([{ company: '青序', role: '  ' }], [{ school: '青岛大学' }])), ['职务不能空'])
assert.deepEqual(messages(titled([{ company: '司'.repeat(101), role: '店员' }], [{ school: '青岛大学', major: '管' }])), ['公司名最多 100 字'])
assert.deepEqual(messages(titled([{ company: '青序', role: '店员' }], [{ school: '  ', major: '专'.repeat(61) }])), ['学校名不能空', '专业最多 60 字'])
assert.deepEqual(messages(titled([{ company: '司'.repeat(100), role: '职'.repeat(60) }], [{ school: '校'.repeat(100), major: '' }])), [])
assert.deepEqual(messages(titled([{ company: '青序', role: '职'.repeat(61) }], [{ school: '校'.repeat(101), major: '专'.repeat(60) }])), ['职务最多 60 字', '学校名最多 100 字'])

console.log('PASS replaceResumeText first-hit only; W-116 优化稿导出字段错误文案')
