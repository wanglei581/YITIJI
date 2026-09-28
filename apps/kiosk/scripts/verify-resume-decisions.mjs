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

console.log('PASS replaceResumeText first-hit only')
