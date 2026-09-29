/**
 * 自我探索知情同意里的年龄要求（合规窗口 9/29 裁定，一字不差）。真跑页面，看用户在同意页上
 * 实际看到的条目（data.consentItems，模板按它逐条渲染），并确认模板确实渲染 consentItems。
 * 反向变异：把这句从页面源码里删掉，断言必须红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REL = 'pages/self-explore/self-explore.js'
const AGE_LINE = '本工具面向年满 14 周岁的用户；未满 14 周岁的，请在监护人同意并陪同下使用。'
const MODULES = { api: {}, auth: { isLoggedIn: () => false, getUser: () => null }, storage: { get: () => null, set: () => true, KEYS: {} } }

function checkItems(items, wxml) {
  assert.ok(Array.isArray(items) || (items && typeof items.length === 'number'), 'consentItems 是列表')
  assert.ok(Array.from(items).includes(AGE_LINE), '同意条目里有年龄要求这一句，一字不差')
  assert.match(wxml, /wx:for="\{\{consentItems\}\}"/, '模板逐条渲染 consentItems')
}

test('自我探索同意页写明年龄要求', () => {
  const page = instantiate(loadPageDefinition(REL, { wx: {}, modules: MODULES }))
  checkItems(page.data.consentItems, fs.readFileSync(path.join(MINIAPP, 'pages/self-explore/self-explore.wxml'), 'utf8'))
})

test('变异：删掉年龄要求 → 判红', () => {
  const src = fs.readFileSync(path.join(MINIAPP, REL), 'utf8').replace(`'${AGE_LINE}',`, '')
  assert.ok(!src.includes(AGE_LINE), '变异确实删掉了这句')
  let def = null
  const sandbox = {
    console, wx: {}, getApp: () => ({ globalData: {} }), Page: (d) => { def = d },
    require: (id) => {
      const name = id.replace(/^.*\//, '').replace(/\.js$/, '')
      if (MODULES[name]) return MODULES[name]
      return { RADAR_COLORS: {}, DIM_COUNT_EXPECTED: 5 }
    },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox)
  assert.throws(() => checkItems(def.data.consentItems, 'wx:for="{{consentItems}}"'), (e) => e.code === 'ERR_ASSERTION')
})
