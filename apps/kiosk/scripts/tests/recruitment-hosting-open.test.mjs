/**
 * recruitmentHostingOpen：缺 recruitmentHosting 按关，不看 jobBoard。
 * 转译真实源码来跑，不另抄一份判定。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = join(kioskRoot, 'src/hooks/recruitmentHostingModel.ts')
const js = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText
const leftover = [...js.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
assert.deepEqual(leftover, [], `还有运行时依赖：${leftover.join(', ')}`)

const { recruitmentHostingOpen } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
)

test('缺 recruitmentHosting 这一项按关', () => {
  assert.equal(recruitmentHostingOpen({}), false)
  assert.equal(recruitmentHostingOpen({ jobBoard: { enabled: false } }), false)
})

test('缺这一项且 jobBoard.enabled 为 true 仍按关', () => {
  assert.equal(recruitmentHostingOpen({ jobBoard: { enabled: true } }), false)
})

test('有 recruitmentHosting 且 enabled === true 才开', () => {
  assert.equal(recruitmentHostingOpen({ recruitmentHosting: { enabled: true } }), true)
  assert.equal(
    recruitmentHostingOpen({ recruitmentHosting: { enabled: true }, jobBoard: { enabled: false } }),
    true,
  )
})

test('有这一项且 enabled 为 false 按关', () => {
  assert.equal(recruitmentHostingOpen({ recruitmentHosting: { enabled: false } }), false)
  assert.equal(
    recruitmentHostingOpen({ recruitmentHosting: { enabled: false }, jobBoard: { enabled: true } }),
    false,
  )
})

test('配置不是对象，或这一项不是对象，按关', () => {
  assert.equal(recruitmentHostingOpen(null), false)
  assert.equal(recruitmentHostingOpen(undefined), false)
  assert.equal(recruitmentHostingOpen([]), false)
  assert.equal(recruitmentHostingOpen('true'), false)
  assert.equal(recruitmentHostingOpen({ recruitmentHosting: 'true' }), false)
  assert.equal(recruitmentHostingOpen({ recruitmentHosting: null }), false)
  assert.equal(recruitmentHostingOpen({ recruitmentHosting: true }), false)
})
