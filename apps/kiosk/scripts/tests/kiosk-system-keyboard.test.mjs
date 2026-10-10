import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

async function load(file) {
  const source = readFileSync(new URL(`../../src/system-keyboard/${file}`, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  return import(`data:text/javascript,${encodeURIComponent(js)}`)
}
const logic = await load('logic.ts')
const domSource = readFileSync(new URL('../../src/system-keyboard/dom.ts', import.meta.url), 'utf8')
const domJS = ts.transpileModule(domSource.replace("import { classifyKeyboardField } from './logic.ts'", `const classifyKeyboardField = ${logic.classifyKeyboardField.toString()}`), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const dom = await import(`data:text/javascript,${encodeURIComponent(domJS)}`)

const rect = (top, bottom, left = 0, right = 1080) => ({ top, bottom, left, right, height: bottom - top })
const keyboard = rect(1320, 1920)

test('模式：缺省和非法值回 push，四个合法模式逐一保留', () => {
  for (const value of [undefined, '', 'bad', 'PUSH', null, 1]) assert.equal(logic.parseKeyboardAvoidMode(value), 'push')
  for (const mode of ['push', 'shrink', 'scroll', 'off']) assert.equal(logic.parseKeyboardAvoidMode(mode), mode)
})
test('高度回退：须可编辑聚焦，差值含 offsetTop，严格超过 120', () => {
  assert.equal(logic.inferKeyboardHeight(1920, 1300, 20, true), 600)
  assert.equal(logic.inferKeyboardHeight(1920, 1800, 0, true), 0)
  assert.equal(logic.inferKeyboardHeight(1920, 1799, 0, true), 121)
  assert.equal(logic.inferKeyboardHeight(1920, 1300, 20, false), 0)
  assert.equal(logic.inferKeyboardHeight(1920, 2000, 0, true), 0)
  assert.equal(logic.inferKeyboardHeight(1920, NaN, 0, true), 0)
})
test('上推：24 设计像素余量、按比例、上限键盘高度、无遮挡不动', () => {
  assert.equal(logic.calculatePush(rect(1500, 1600), keyboard, 1), 304)
  assert.equal(logic.calculatePush(rect(1200, 1320), keyboard, 0.5), 12)
  assert.equal(logic.calculatePush(rect(1800, 1900), keyboard, 2), 600)
  assert.equal(logic.calculatePush(rect(1000, 1100), keyboard, 1), 0)
  assert.equal(logic.calculatePush(rect(1500, 1600, 1100, 1200), keyboard, 1), 0)
  assert.equal(logic.calculatePush(rect(1920, 2000), keyboard, 1), 0)
  assert.equal(logic.calculatePush(rect(1500, 1600), rect(1920, 1920), 1), 0)
})
test('视口：push／scroll 固定基准，shrink 扣一次，off 原样，收起恢复五次无累积', () => {
  const baseline = { width: 1080, height: 1920 }, reduced = { width: 1080, height: 1320 }
  for (let i = 0; i < 5; i++) {
    for (const mode of ['push', 'scroll']) assert.deepEqual(logic.keyboardViewport(mode, reduced, baseline, 600), baseline)
    assert.deepEqual(logic.keyboardViewport('shrink', reduced, baseline, 600), reduced)
    assert.deepEqual(logic.keyboardViewport('off', reduced, baseline, 600), reduced)
    assert.deepEqual(logic.keyboardViewport('shrink', baseline, baseline, 0), baseline)
  }
  assert.equal(logic.keyboardViewport('shrink', reduced, baseline, 3000).height, 1)
})
test('认格子：全部文字类型／textarea；排除只读、禁用、非文字；page 优先于 system', () => {
  const field = { tag: 'INPUT', readOnly: false, disabled: false, pageKeyboard: false }
  for (const type of [undefined, '', 'text', 'tel', 'email', 'search', 'url', 'number', 'password']) assert.equal(logic.classifyKeyboardField({ ...field, type }), 'system')
  assert.equal(logic.classifyKeyboardField({ ...field, tag: 'textarea' }), 'system')
  for (const type of ['file', 'checkbox', 'radio', 'range', 'hidden', 'date', 'button']) assert.equal(logic.classifyKeyboardField({ ...field, type }), null)
  assert.equal(logic.classifyKeyboardField({ ...field, tag: 'div' }), null)
  assert.equal(logic.classifyKeyboardField({ ...field, pageKeyboard: true }), 'page')
  assert.equal(logic.classifyKeyboardField({ ...field, readOnly: true, pageKeyboard: true }), null)
  assert.equal(logic.classifyKeyboardField({ ...field, disabled: true }), null)
})
test('补属性：只补缺失值；page 强制 manual／none', () => {
  const attributes = new Map([['autocomplete', 'new-password'], ['spellcheck', 'true']])
  const field = { dataset: {}, hasAttribute: (key) => attributes.has(key), getAttribute: (key) => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value) }
  dom.prepareKeyboardField(field)
  assert.deepEqual(Object.fromEntries(attributes), { autocomplete: 'new-password', spellcheck: 'true', autocapitalize: 'off', autocorrect: 'off' })
  field.dataset.kioskKeyboard = 'page'; attributes.set('inputmode', 'numeric')
  dom.prepareKeyboardField(field)
  assert.equal(attributes.get('virtualkeyboardpolicy'), 'manual')
  assert.equal(attributes.get('inputmode'), 'none')
})
test('页面自己声明 inputmode="none" 的格子也算自带键盘：补 manual，不补系统键盘那组属性', () => {
  const attributes = new Map([['inputmode', 'none']])
  const field = { dataset: {}, hasAttribute: (key) => attributes.has(key), getAttribute: (key) => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value) }
  assert.equal(dom.usesPageKeyboard(field), true)
  dom.prepareKeyboardField(field)
  assert.deepEqual(Object.fromEntries(attributes), { inputmode: 'none', virtualkeyboardpolicy: 'manual' })
  attributes.set('inputmode', 'numeric'); attributes.delete('virtualkeyboardpolicy')
  assert.equal(dom.usesPageKeyboard(field), false)
})
test('上推样式：零值无写入；五次撤销无残留，原有 transform 和 translate 保留', () => {
  const properties = new Map(), attributes = new Map()
  const layer = {
    style: { getPropertyValue: (key) => properties.get(key) ?? '', getPropertyPriority: () => '',
      setProperty: (key, value) => properties.set(key, value), removeProperty: (key) => properties.delete(key), get length() { return properties.size } },
    getAttribute: (key) => attributes.get(key) ?? null, hasAttribute: (key) => attributes.has(key),
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key),
  }
  dom.pushLayer(layer, 0)(); assert.equal(properties.size, 0); assert.equal(attributes.size, 0)
  for (let i = 0; i < 5; i++) {
    dom.pushLayer(layer, 304)(); assert.equal(properties.size, 0); assert.equal(attributes.size, 0)
  }
  properties.set('transform', 'scale(1)'); properties.set('translate', '2px 3px'); attributes.set('style', '')
  dom.pushLayer(layer, 304)()
  assert.equal(properties.get('transform'), 'scale(1)'); assert.equal(properties.get('translate'), '2px 3px')
})

test('off 启动及清理均不得访问键盘接口和 DOM', async () => {
  const source = readFileSync(new URL('../../src/system-keyboard/controller.ts', import.meta.url), 'utf8')
    .replace(/^import .*$/gm, '')
  const js = ts.transpileModule(`const keyboardMode = () => 'off'; const virtualKeyboard = () => { throw new Error('不得访问键盘接口') };\n${source}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const controller = await import(`data:text/javascript,${encodeURIComponent(js)}`)
  assert.doesNotThrow(() => controller.startSystemKeyboard(() => false)())
})
