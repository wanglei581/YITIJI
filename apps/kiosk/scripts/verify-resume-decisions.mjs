import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(new URL('../src/pages/resume/components/resume-deliver/resumeDecisions.ts', import.meta.url), 'utf8')

assert.doesNotMatch(src, /split\(from\)\.join\(to\)/, 'replaceResumeText must not globally replace every occurrence')
assert.match(src, /let replaced = false/, 'replaceResumeText stops after the first string-field hit')
assert.match(src, /value\.indexOf\(from\)/, 'replaceResumeText finds the first hit with indexOf')
assert.match(src, /value\.slice\(0, index\) \+ to \+ value\.slice\(index \+ from\.length\)/, 'replaceResumeText rewrites only the first occurrence in that field')

function extractFunction(source, name) {
  const start = source.indexOf(`export function ${name}`)
  if (start < 0) throw new Error(`missing ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unclosed ${name}`)
}

function stripTypes(ts) {
  return ts
    .replace(/export function/, 'function')
    .replace(/ as GeneratedResume/g, '')
    .replace(/ as Record<string, unknown>/g, '')
    .replace(/: Record<string, unknown>/g, '')
    .replace(/: GeneratedResume/g, '')
    .replace(/: unknown/g, '')
    .replace(/: string/g, '')
}

const replaceResumeText = new Function(`${stripTypes(extractFunction(src, 'replaceResumeText'))}; return replaceResumeText;`)()

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
