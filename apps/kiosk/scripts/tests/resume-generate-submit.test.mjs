/**
 * 「AI 帮你生成」输入表单提交规则：只写公司没写职务的经历照样提交，职务留空（10/6 总指挥定，不编造也不丢）。
 * 跑 resumeGenerateSubmit.ts 的真实源码。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = join(kioskRoot, 'src/pages/resume/resumeGenerateSubmit.ts')
const out = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const mod = await import(`data:text/javascript;base64,${Buffer.from(out).toString('base64')}`)

test('只写公司没写职务的经历照样提交，职务如实留空', () => {
  const submitted = mod.toSubmittedExperience([
    { company: ' 青序门店 ', role: '  ', period: '', description: ' 负责门店日常运营。 ' },
  ])
  assert.deepEqual(submitted, [{ company: '青序门店', role: '', period: undefined, description: '负责门店日常运营。' }])
})

test('公司没填的经历不提交；公司、职务都填的照旧', () => {
  const submitted = mod.toSubmittedExperience([
    { company: '  ', role: '店员', description: '只写了职务' },
    { company: '青岛某连锁超市', role: '收银员', period: '2023-2024', description: '' },
  ])
  assert.deepEqual(submitted.map((item) => [item.company, item.role]), [['青岛某连锁超市', '收银员']])
})

test('确认页计数与提交同一条规则', () => {
  assert.equal(mod.isSubmittableExperience({ company: '青序门店' }), true)
  assert.equal(mod.isSubmittableExperience({ company: ' ' }), false)
})

test('经历步骤的计数与状态和提交同一条规则，不再把职务当必填', () => {
  // 24 号页重做（#1315）后，经历步骤自己又写了一遍「公司且职务」；和提交规则对不上时，
  // 这一步显示「0/1、缺公司或职务」，实际却会提交，或者反过来。
  for (const rel of [
    'src/pages/resume/components/ResumeGenerateHistoryStep.tsx',
    'src/pages/resume/components/ResumeGenerateReview.tsx',
    'src/pages/resume/ResumeGeneratePage.tsx',
  ]) {
    const text = readFileSync(join(kioskRoot, rel), 'utf8')
    assert.doesNotMatch(text, /company\.trim\(\)\s*&&\s*\w+\.role\.trim\(\)/, `${rel} 仍把职务当必填`)
    assert.match(text, /isSubmittableExperience|toSubmittedExperience/, `${rel} 没有走 resumeGenerateSubmit`)
  }
})
