/**
 * 模拟面试结果的合规口径（合规窗口 9/29 裁定，C9 于 9/28 拍板）：真跑页面与 normalize。
 *
 * 钉住的是：
 *   - 练习表现等级整个不显示（任何分档叫法都不出现在页面数据与模板里），服务端 level 原样留在数据里；
 *   - 「岗位相关性 / 岗位契合」改为「和目标岗位要求的对照」；
 *   - 结果页固定显示那一句免责说明，一字不差，且不在任何 wx:if 之下（不折叠、不因数据缺失消失）。
 * 反向变异（改回去必须红）见文件末尾。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WXML = path.join(MINIAPP, 'pages/interview-result/interview-result.wxml')
const DISCLAIMER = '模拟练习结果，仅供练习参考，不代表任何用人单位的评价或录用意见。'
// 旧的两套分档叫法（页面四档 + normalize 四档），一个都不许回来。
const LEVEL_WORDS = ['需要加强', '基本合格', '表现良好', '表现出色', '仍需打磨', '基本达标']

const DTO = {
  position: '测试·行政助理',
  interviewerLabel: 'HR 面试',
  endedAt: '2026-09-29T10:00:00Z',
  report: {
    overall: { level: 'excellent', summary: '结构清楚。' },
    expression: ['表达清楚'],
    positionFit: ['提到了排班经验'],
  },
}

function renderPage(wxmlSource) {
  const def = loadPageDefinition('pages/interview-result/interview-result.js', {
    wx: {}, modules: { api: {}, storage: { get: () => null, set: () => true, KEYS: {} } },
  })
  const page = instantiate(def)
  page._render(DTO)
  return { page, wxml: wxmlSource }
}

export function checkPage(wxmlSource = fs.readFileSync(WXML, 'utf8')) {
  const { page, wxml } = renderPage(wxmlSource)
  const data = JSON.stringify(page.data)
  for (const w of LEVEL_WORDS) assert.ok(!data.includes(w), `页面数据不应出现等级叫法「${w}」`)
  assert.equal(page.data.overallLevel, 'excellent', '服务端 level 原样留在数据里')
  const fit = page.data.sections.find((s) => s.key === 'positionFit')
  assert.equal(fit && fit.title, '和目标岗位要求的对照')
  assert.ok(!/岗位相关性/.test(wxml + data))
  // 模板：不渲染任何等级字段；免责说明一字不差，且外层没有 wx:if 以外的条件（只随报告块出现）。
  assert.ok(!/overallLabel|overallLevel|rh-level/.test(wxml), '模板不渲染等级')
  for (const w of LEVEL_WORDS) assert.ok(!wxml.includes(w), `模板不应写死「${w}」`)
  const idx = wxml.indexOf(DISCLAIMER)
  assert.ok(idx > 0, '固定免责说明一字不差地在模板里')
  const line = wxml.slice(wxml.lastIndexOf('<view', idx), idx)
  assert.ok(!/wx:(if|elif|else)/.test(line), '免责说明本身不加条件，不折叠')
}

test('结果页：不显示等级、改标题、固定免责说明', () => checkPage())

test('normalize.interviewReport：不再产出等级叫法，岗位一栏用新标题', () => {
  const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
  const N = requireMiniapp('./normalize.js')
  const out = N.interviewReport({ ...DTO, report: { ...DTO.report } })
  const json = JSON.stringify(out)
  for (const w of LEVEL_WORDS) assert.ok(!json.includes(w), `normalize 不应产出「${w}」`)
  assert.ok(!('levelLabel' in out) && !('levelTone' in out), '不再给展示用的等级字段')
  assert.equal(out.level, 'excellent', '原始 level 照旧透传')
  const fit = out.dims.find((d) => d.key === 'positionFit')
  assert.equal(fit && fit.label, '和目标岗位要求的对照')
})

// ── 反向变异：把改掉的东西放回去，上面的断言必须红（红在断言，不在崩溃）──────────
test('变异：模板重新渲染等级 → 判红', () => {
  const src = fs.readFileSync(WXML, 'utf8').replace(
    '<view class="ri-hero">',
    '<view class="ri-hero">\n        <view class="rh-level">{{overallLabel}}</view>',
  )
  assert.throws(() => checkPage(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异：删掉免责说明 → 判红', () => {
  const src = fs.readFileSync(WXML, 'utf8').replace(DISCLAIMER, '')
  assert.throws(() => checkPage(src), (e) => e.code === 'ERR_ASSERTION')
})

test('变异：免责说明被收进条件里 → 判红', () => {
  const src = fs.readFileSync(WXML, 'utf8').replace(
    `<text>${DISCLAIMER}</text>`,
    `<text wx:if="{{showDisc}}">${DISCLAIMER}</text>`,
  )
  assert.throws(() => checkPage(src), (e) => e.code === 'ERR_ASSERTION')
})
