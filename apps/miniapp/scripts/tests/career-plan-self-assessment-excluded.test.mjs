/**
 * 职业规划：自我探索因说明更新没纳入时如实说（合规 9/29「不许悄悄不纳入」，后端 #1119 的
 * selfAssessmentExcluded）。只认 'consent_outdated'；null / 缺字段 / 其他值什么都不显示。
 * 页面依据栏给一句说明和一个去自我探索的入口。各配反向变异。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NORMALIZE = path.join(MINIAPP, 'utils/normalize.js')
const NORMALIZE_SRC = fs.readFileSync(NORMALIZE, 'utf8')
const WXML = fs.readFileSync(path.join(MINIAPP, 'pages/career-plan/career-plan.wxml'), 'utf8')
const HINT = '你之前的自我探索结果因说明已更新，这次没有纳入；重新确认说明后可以纳入。'

function compileNormalize(src) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', src)(mod, mod.exports, createRequire(NORMALIZE))
  return mod.exports
}

const BASE = { taskId: 't1', status: 'completed', summary: '夹具总体说明', basedOn: { resume: true, jobFit: null, interview: null } }

function checkFlag(N) {
  assert.equal(N.careerPlan({ ...BASE, selfAssessmentExcluded: 'consent_outdated' }).selfAssessmentOutdated, true, 'consent_outdated → 显示')
  for (const v of [null, undefined, '', 'other_reason']) {
    assert.equal(N.careerPlan({ ...BASE, selfAssessmentExcluded: v }).selfAssessmentOutdated, false, `${JSON.stringify(v)} → 不显示`)
  }
}

test('只有 consent_outdated 才标出没纳入', () => checkFlag(compileNormalize(NORMALIZE_SRC)))

test('变异：不看服务端字段、一律显示 → 判红', () => {
  const from = "selfAssessmentOutdated: raw.selfAssessmentExcluded === 'consent_outdated',"
  assert.ok(NORMALIZE_SRC.includes(from))
  assert.throws(() => checkFlag(compileNormalize(NORMALIZE_SRC.replace(from, 'selfAssessmentOutdated: true,'))), (e) => e.code === 'ERR_ASSERTION')
})

test('变异：有值就显示（把 null 以外都当没纳入）→ 判红', () => {
  const from = "selfAssessmentOutdated: raw.selfAssessmentExcluded === 'consent_outdated',"
  assert.throws(() => checkFlag(compileNormalize(NORMALIZE_SRC.replace(from, 'selfAssessmentOutdated: raw.selfAssessmentExcluded != null,'))), (e) => e.code === 'ERR_ASSERTION')
})

test('依据栏：按标记显示原话，并给去自我探索的入口', () => {
  const block = WXML.match(/<block wx:if="\{\{plan\.selfAssessmentOutdated\}\}">([\s\S]*?)<\/block>/)
  assert.ok(block, '有按 selfAssessmentOutdated 条件显示的块')
  assert.ok(block[1].includes(HINT), '说明原话一字不差')
  assert.match(block[1], /bindtap="goSelfExplore"/, '有入口')
  const basedAt = WXML.indexOf('class="cp-based"')
  assert.ok(basedAt >= 0 && WXML.indexOf(block[0]) > basedAt, '放在「本次生成依据」栏里')
})

test('入口打开自我探索', () => {
  const nav = []
  const wx = { navigateTo: (o) => { nav.push(o.url) }, redirectTo: () => {} }
  const modules = { api: {}, auth: { isLoggedIn: () => false }, storage: { get: () => null, KEYS: {} } }
  const page = instantiate(loadPageDefinition('pages/career-plan/career-plan.js', { wx, modules }))
  page.goSelfExplore()
  assert.deepEqual(nav, ['/pages/self-explore/self-explore'])
})
