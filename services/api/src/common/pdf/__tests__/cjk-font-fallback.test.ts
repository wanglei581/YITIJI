import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { builtinCjkFontCandidates, selectLoadableCjkFont } from '../cjk-font'

const require = createRequire(__filename)
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
// 随依赖安装的真字体。不依赖本机是否有苹方或文泉驿。
const LOADABLE = path.join(pdfjsRoot, 'standard_fonts', 'LiberationSans-Regular.ttf')

test('文泉驿候选用 PostScript 名 WenQuanYiMicroHei', () => {
  const wqy = builtinCjkFontCandidates('linux').find((item) => item.path.endsWith('wqy-microhei.ttc'))
  assert.ok(wqy)
  assert.equal(wqy.family, 'WenQuanYiMicroHei')
})

test('第一个候选真加载失败时改用第二个', () => {
  const first = { path: LOADABLE, family: 'NotARealPostScriptName' }
  const second = { path: LOADABLE }
  const chosen = selectLoadableCjkFont([first, second])
  assert.equal(chosen, second)
})
