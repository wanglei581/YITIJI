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
