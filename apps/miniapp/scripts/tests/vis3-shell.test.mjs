/**
 * VIS3a（10/17）：公共壳层——页头钉在顶部、胶囊不压内容、返回键可读屏、扫码登录回到小程序现有配色。
 *
 * 守的是 10/16–10/17 开发者工具实际截图里看到的事：
 *   - AI 工具、意见反馈、打印 Tab 滚动后，内容跑到状态栏和微信胶囊下面，页头跟着滚走；
 *   - 今日提醒右上角的日期被胶囊盖住；
 *   - 多数返回键没有无障碍名称（微信用 aria-role / aria-label，见 aria-component 文档，基础库 2.7.1 起），
 *     诊断、订单详情、简历上传、消息通知、我的简历、关于这几页的返回箭头稳定看不见（根因未定位，
 *     只换了返回图标的画法）；
 *   - 扫码登录页突然换成深绿奶油，深绿底上黑色状态栏字难读。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const exists = (rel) => fs.existsSync(path.join(MINIAPP, rel))
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))

const app = JSON.parse(read('app.json'))
const ROUTES = [...app.pages, ...(app.subpackages || app.subPackages || []).flatMap((p) => p.pages.map((n) => `${p.root}/${n}`))]
const name = (route) => route.split('/').pop()
const stripComments = (src) => src.replace(/<!--[\s\S]*?-->/g, '')
const SPACER = '<view style="height:{{statusBarHeight}}px"></view>'
const FLAT = /<view style="height:\{\{statusBarHeight\}\}px"><\/view>\s*<view class="navbar">/

/** 这几页不转 col：内容在 scroll-view 里、整页不滚，或者自带一套 .navbar 样式。 */
const FLAT_KEPT = {
  'package-create': 'page 是 overflow:hidden，内容在 scroll-view 里，页头本来就不动',
  'store-select': '内容在 scroll-view 里，且自带一套 .navbar 样式',
  'resume-parse': '内容在 scroll-view 里',
  'kiosk-send': '自带一套 .navbar 样式',
}
/** 整页滚动、页头会钉住的页：21 个转换页 + 12 个原本就是 col 的整页滚动页。 */
const STICKY = ['ai', 'print', 'print-upload', 'print-store', 'print-pay', 'print-pickup', 'resume-build', 'resume-voice',
  'resume-upload', 'resume-diagnose', 'resume-optimize', 'interview-entry', 'interview-qa', 'interview-result',
  'career-plan', 'self-explore', 'job-fit', 'print-preview', 'usb-import', 'job-materials', 'daily-report',
  'resumes', 'documents', 'orders', 'order-detail', 'ai-records', 'settings', 'privacy', 'help', 'about', 'legal',
  'notifications', 'feedback']

/** 粗解析 wxss：去注释后按「选择器 { 声明 }」切开。够这几条断言用。 */
function cssRules(src) {
  const out = []
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    out.push({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] })
  }
  return out
}
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body)
  return m ? m[1].trim() : ''
}

test('返回键：所有注册页的返回键都有 aria-role="button" 和 aria-label，不再用微信不认的 role', () => {
  let count = 0
  for (const route of ROUTES) {
    const wxml = stripComments(read(`${route}.wxml`))
    for (const m of wxml.matchAll(/<view class="nav-back[^"]*"[^>]*>/g)) {
      count += 1
      const tag = m[0]
      assert.match(tag, /\saria-role="button"/, `${name(route)}：${tag}`)
      assert.match(tag, /\saria-label="[^"]+"/, `${name(route)}：${tag}`)
      assert.doesNotMatch(tag, /\srole="/, `${name(route)}：${tag}`)
    }
  }
  assert.equal(count, 38, '注册页里的返回键个数变了，确认新页面也补了无障碍属性')
})

test('页头：扁平写法只剩名单里那几页（各有理由），其余整页滚动的页都用 col 写法', () => {
  const flat = ROUTES.filter((r) => FLAT.test(stripComments(read(`${r}.wxml`)))).map(name).sort()
  assert.deepEqual(flat, Object.keys(FLAT_KEPT).sort())
  for (const page of STICKY) {
    const route = ROUTES.find((r) => name(r) === page)
    assert.ok(route, `${page} 不是注册页`)
    const wxml = stripComments(read(`${route}.wxml`))
    const at = wxml.indexOf('<view class="navbar col">')
    assert.ok(at >= 0, `${page} 不是 col 页头`)
    const head = wxml.slice(at, at + 400)
    assert.ok(head.indexOf(SPACER) > 0, `${page}：状态栏占位要在 col 页头里`)
    if (!['package-confirm', 'package-code'].includes(page)) assert.match(head, /<view class="nav-inner">/, page)
  }
})

test('页头钉住：.navbar.col 是 sticky、top 0、z-index 50', () => {
  const rule = cssRules(read('app.wxss')).find((r) => r.selectors.includes('.navbar.col'))
  assert.ok(rule)
  assert.equal(decl(rule.body, 'position'), 'sticky')
  assert.equal(decl(rule.body, 'top'), '0')
  assert.equal(decl(rule.body, 'z-index'), '50')
})

test('页头钉住：会钉住的页，page 和根容器上都没有 overflow（否则 sticky 静默失效）', () => {
  const appRules = cssRules(read('app.wxss'))
  for (const page of STICKY) {
    const route = ROUTES.find((r) => name(r) === page)
    const wxml = stripComments(read(`${route}.wxml`))
    const root = /<view class="([^"]+)"/.exec(wxml)[1]
    const targets = ['page', ...root.split(/\s+/).map((c) => `.${c}`)]
    const pageCss = exists(`${route}.wxss`) ? cssRules(read(`${route}.wxss`)) : []
    for (const rule of [...pageCss, ...appRules]) {
      if (!rule.selectors.some((s) => targets.includes(s))) continue
      assert.doesNotMatch(rule.body, /overflow(?:-[xy])?\s*:\s*(hidden|auto|scroll|clip)/, `${page}：${rule.selectors.join(',')}`)
    }
  }
})

test('页头钉住：全屏固定遮罩的 z-index 都高于页头的 50', () => {
  const full = (body) => {
    const v = (p) => decl(body, p)
    const tall = (h) => h === '100%' || h === '100vh'
    return (v('top') === '0' && v('bottom') === '0') || v('inset') === '0' ||
      (v('top') === '0' && tall(v('height'))) || (v('width') === '100%' && tall(v('height')))
  }
  let masks = 0
  for (const rel of ['app.wxss', ...ROUTES.map((r) => `${r}.wxss`).filter(exists)]) {
    for (const rule of cssRules(read(rel))) {
      if (decl(rule.body, 'position') !== 'fixed' || !full(rule.body)) continue
      masks += 1
      const z = Number(decl(rule.body, 'z-index') || 0)
      assert.ok(z > 50, `${rel} ${rule.selectors.join(',')} z-index ${z} 不高于 50，会被钉住的页头盖住`)
    }
  }
  assert.ok(masks >= 2, '至少应扫到隐私页和简历优化页的两个全屏遮罩')
})

test('胶囊：注册页的页头里，标题后面不再放任何内容；今日提醒的日期在内容区第一行', () => {
  for (const route of ROUTES) {
    const wxml = stripComments(read(`${route}.wxml`))
    const at = wxml.indexOf('<view class="navbar')
    if (at < 0) continue
    const head = wxml.slice(at, wxml.indexOf('</view>\n  </view>', at) > 0 ? wxml.indexOf('</view>\n  </view>', at) : at + 600)
    const afterTitle = head.split(/class="nav-title[^"]*">[^<]*<\/view>/)[1] || ''
    const visible = afterTitle.replace(/<view class="nav-right"><\/view>/g, '').replace(/<\/?view[^>]*>/g, '').trim()
    assert.equal(visible, '', `${name(route)}：页头标题后面还有内容，会落进胶囊`)
  }
  const daily = stripComments(read('pages/daily-report/daily-report.wxml'))
  assert.doesNotMatch(daily, /nav-date/)
  const content = daily.slice(daily.indexOf('<view class="content">') + '<view class="content">'.length)
  assert.match(content.trimStart(), /^<view class="dr-date" wx:if="\{\{dateStr\}\}">\{\{dateStr\}\}<\/view>/)
  const rule = cssRules(read('pages/daily-report/daily-report.wxss')).find((r) => r.selectors.includes('.dr-date'))
  assert.ok(rule)
  assert.equal(decl(rule.body, 'padding'), '12px 16px 0')
})

test('返回图标：只给返回键换成边框画的 chevron，不再翻转 mask 图；可点区域不变', () => {
  const rules = cssRules(read('app.wxss'))
  const ic = rules.find((r) => r.selectors.includes('.navbar .nav-back .nav-back-ic'))
  assert.ok(ic)
  assert.equal(decl(ic.body, 'background'), 'transparent')
  assert.equal(decl(ic.body, '-webkit-mask-image'), 'none')
  assert.equal(decl(ic.body, 'mask-image'), 'none')
  assert.equal(decl(ic.body, 'border-left'), '2px solid currentColor')
  assert.equal(decl(ic.body, 'border-bottom'), '2px solid currentColor')
  assert.match(decl(ic.body, 'transform'), /rotate\(45deg\)/)
  assert.doesNotMatch(read('app.wxss'), /rotate\(180deg\)/)
  const back = rules.find((r) => r.selectors.includes('.navbar .nav-back'))
  assert.equal(decl(back.body, 'width'), '48px')
  assert.equal(decl(back.body, 'height'), '48px')
})

test('扫码登录：局部变量全部指向小程序现有变量，深色接力条钉住，状态栏字白色', () => {
  const css = read('pages/kiosk-login/kiosk-login.wxss')
  const relay = cssRules(css).find((r) => r.selectors.includes('.relay'))
  const locals = [...relay.body.matchAll(/(--q-[\w-]+)\s*:\s*([^;]+);/g)]
  assert.equal(locals.length, 18)
  for (const [, key, value] of locals) assert.match(value.trim(), /^var\(--[a-z-]+\)$/, key)
  const hex = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual(hex, ['#fff'], '只允许和全局 .btn.primary 相同的 #fff')
  assert.doesNotMatch(css, /rgba\(46,230,168|rgba\(242,239,228|rgba\(31,158,134/)
  const bar = cssRules(css).find((r) => r.selectors.includes('.relaybar'))
  assert.equal(decl(bar.body, 'position'), 'sticky')
  assert.equal(decl(bar.body, 'top'), '0')
  const json = JSON.parse(read('pages/kiosk-login/kiosk-login.json'))
  assert.equal(json.navigationBarTextStyle, 'white')
  assert.equal(json.backgroundColor, '#f5f7fa')
})

test('事实核对：滚到编辑区那一项时让出钉住的页头（状态栏 + 52px）', () => {
  const factCheck = requireMiniapp('../pages/resume-optimize/fact-check.js')
  const calls = []
  const saved = globalThis.wx
  globalThis.wx = { pageScrollTo: (o) => calls.push(o), showToast() {} }
  try {
    const items = factCheck.toViewItems([{ path: 'experience[0].company', kind: 'company', value: '某公司', foundInOriginal: false }])
    const page = {
      data: { statusBarHeight: 44, factPanel: { items } },
      setData(patch, cb) { if (cb) cb() },
    }
    factCheck.runRemove(page, {}, items[0].key)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].selector, '#edit-exp-0')
    assert.equal(calls[0].offsetTop, -(44 + 52))
  } finally {
    globalThis.wx = saved
  }
})
