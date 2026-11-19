import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { builtinCjkFontCandidates, selectLoadableCjkFont } from '../cjk-font'
import { pdfjsPresetDataOptions } from '../pdfjs-document'

// 随依赖安装的真字体。不依赖本机是否有苹方或文泉驿。
// 字体目录从唯一的 PDF.js 接入点取（verify:pdfjs-engine 不许别处直接引用那个包；
// 顶层也不能自建名为 require 的变量，带产物 tsc 报 TS2441）。
const LOADABLE = path.join(pdfjsPresetDataOptions().standardFontDataUrl, 'LiberationSans-Regular.ttf')

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
