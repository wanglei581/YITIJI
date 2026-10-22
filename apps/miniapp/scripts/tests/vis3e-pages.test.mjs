/**
 * VIS3e（10/17，冻结前最后一批已登记项）：
 *   - 44 个注册页的交互控件用微信认的 aria-role（官方 aria-component 文档；「部分 role 在移动端可能无效」，
 *     读屏实际效果另列真机待验）；
 *   - 首页把「语音说简历」挪到常用服务下面（实图 03：小青、语音、四宫格三块连着，首屏挤）；
 *   - 职业规划空态说明拆成两句（实图 12：一整句折行剩孤字）；
 *   - 求职材料所有字段放进同一张卡（实图 27b：每个字段一张大卡）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
const app = JSON.parse(read('app.json'))
const ROUTES = [...app.pages, ...(app.subpackages || app.subPackages || []).flatMap((p) => p.pages.map((n) => `${p.root}/${n}`))]

test('注册页：交互控件的角色都写成 aria-role，不再有微信不认的单独 role 属性', () => {
  const allowed = new Set(['button', 'link', 'checkbox', 'radio', 'radiogroup', 'alert', 'status'])
  let ariaRoles = 0
  for (const route of ROUTES) {
    const wxml = stripComments(read(`${route}.wxml`))
    assert.doesNotMatch(wxml, /(?<![-\w])role="/, `${route} 还有单独的 role 属性`)
    for (const m of wxml.matchAll(/aria-role="([^"]*)"/g)) {
      ariaRoles += 1
      assert.ok(allowed.has(m[1]), `${route}：aria-role="${m[1]}" 不在已用的取值里`)
    }
  }
  assert.ok(ariaRoles > 0)
})

test('首页：语音说简历在常用服务四宫格之后、打印横幅之前；其余顺序和去处不变', () => {
  const wxml = stripComments(read('pages/home/home.wxml'))
  const at = (needle) => {
    const i = wxml.indexOf(needle)
    assert.ok(i >= 0, needle)
    return i
  }
  const pickup = at('class="pickup-card"')
  const qing = at('class="qing-bar tap"')
  const grid = at('class="service-grid"')
  const voice = at('data-url="/pages/resume-voice/resume-voice"')
  const banner = at('class="print-banner tap"')
  assert.ok(pickup < qing && qing < grid && grid < voice && voice < banner, '待取件 → 小青 → 常用服务 → 语音说简历 → 打印横幅')
  assert.equal((wxml.match(/data-url="\/pages\/resume-voice\/resume-voice"/g) || []).length, 1, '语音入口只有一个')
})

test('职业规划：无简历空态说明拆成两句，不再是一整句', () => {
  const wxml = stripComments(read('pages/career-plan/career-plan.wxml'))
  assert.match(wxml, /<view class="rs-sub">职业规划完全基于你的简历原文生成。<\/view>\s*<view class="rs-sub">请先上传并解析一份简历。<\/view>/)
  assert.doesNotMatch(wxml, /职业规划完全基于你的简历原文生成,需要先上传/)
})

test('求职材料：所有字段在同一张卡里，字段之间用分隔线；输入绑定不变', () => {
  const wxml = stripComments(read('pages/job-materials/job-materials.wxml'))
  assert.match(wxml, /<view class="card rise-d2" wx:if="\{\{picked\.fields && picked\.fields\.length\}\}">\s*<view class="jm-field" wx:for="\{\{picked\.fields\}\}" wx:key="key">/)
  assert.doesNotMatch(wxml, /<view class="card[^"]*" wx:for="\{\{picked\.fields\}\}"/, '不能再每个字段一张卡')
  assert.equal((wxml.match(/data-key="\{\{item\.key\}\}" bindinput="onInput"/g) || []).length, 2, '多行和单行两种输入都还绑着 onInput')
  const css = read('pages/job-materials/job-materials.wxss')
  assert.match(css, /\.jm-field \+ \.jm-field \{[^}]*border-top:\s*1rpx solid var\(--line-faint\)/)
})
