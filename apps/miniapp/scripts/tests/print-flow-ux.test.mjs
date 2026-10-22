/**
 * 打印闭环第一批（B1，10/16）：取件页与订单页的用语、主次按钮、信息卡和返回路径。
 * 真跑 utils/print-params.js 与 pages/print-pickup/pickup-state.js；页面级的行为用例在
 * page-lifecycle.test.mjs 的「B1」几条（那边有取件页、订单页的身份与请求替身）。
 *
 * 守的是 10/16 真机验收时看到的几件事：
 *   - 码还没用时底部按钮写「完成」，会让人以为这一单已经结束；
 *   - 「作废换新码」和「复制」「分享」一样显眼，容易误点让码失效；
 *   - 取件页看不到文件名，彩色单选错文件（BIZ-PAPER 当成 BIZ-COLOR）直到出纸才发现；
 *   - 下完单点返回会回到「选终端」，再走一遍就是第二张单；
 *   - 订单规格不写单双面；服务端没记录的颜色被写成「黑白」。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
const printParams = requireMiniapp('./print-params.js')
const pickupState = requireMiniapp('../pages/print-pickup/pickup-state.js')

test('规格：参数照服务端原样翻译，含单双面；没记录的项不写，不回落成「单面」「黑白」', () => {
  assert.equal(
    printParams.displaySpec({ paperSize: 'a4', colorMode: 'black_white', duplex: 'duplex_long_edge', copies: 1, billablePages: 2 }),
    'A4 · 黑白 · 双面（长边翻页） · 1 份 · 共 2 页',
  )
  assert.equal(printParams.displaySpec({ colorMode: 'color', duplex: 'simplex', copies: 3 }), '彩色 · 单面 · 3 份')
  // 一体机发起的短边单也要照实写，不能因为小程序不开放短边就写错或抛错
  assert.equal(printParams.displaySpec({ duplex: 'duplex_short_edge' }), '双面（短边翻页）')
  assert.equal(printParams.displaySpec({ paperSize: 'A4', colorMode: null, duplex: null, copies: 2 }), 'A4 · 2 份')
  assert.equal(printParams.displaySpec({ colorMode: 'sepia', duplex: 'both', copies: 0, billablePages: '2' }), '', '认不出的值一律不写')
  assert.equal(printParams.displaySpec(null), '')
  assert.equal(printParams.displaySpec(undefined), '')
})

test('规格：展示函数不改动下单用的 normalize / labels 口径', () => {
  // 下单侧仍然只开放长边；展示侧能显示短边，但不能借此把短边放进下单参数
  assert.throws(() => printParams.normalize({ duplex: 'duplex_short_edge' }), /短边翻页未开放/)
  assert.equal(printParams.labels({ duplex: 'duplex_long_edge' }).duplexLabel, '双面（长边翻页）')
})

test('底部主按钮：只有打印完成才写「完成」', () => {
  assert.equal(pickupState.bottomActionLabel('completed'), '完成')
  for (const key of ['pending', 'awaiting_payment', 'awaiting_release', 'queued', 'printing', 'failed', 'abandoned', 'expired', 'cancelled', '']) {
    assert.equal(pickupState.bottomActionLabel(key), '返回首页', key)
  }
})

test('信息卡：文件名常见长度全量显示，选错文件的两份能一眼分清', () => {
  const color = pickupState.orderSummary({ fileName: 'ZYD-20261016-BIZ-COLOR-D93A.pdf' }).fileName
  const paper = pickupState.orderSummary({ fileName: 'ZYD-20261016-BIZ-PAPER-D93A.pdf' }).fileName
  assert.equal(color, 'ZYD-20261016-BIZ-COLOR-D93A.pdf')
  assert.equal(paper, 'ZYD-20261016-BIZ-PAPER-D93A.pdf')
  assert.notEqual(color, paper)
  const sixty = `${'甲'.repeat(56)}.pdf`
  assert.equal(pickupState.orderSummary({ fileName: sixty }).fileName, sixty, '60 个字以内不截')
})

test('信息卡：超过 60 个字才截，保留开头和扩展名', () => {
  const long = `${'简历'.repeat(40)}-最终版.docx`
  const shown = pickupState.orderSummary({ fileName: long }).fileName
  assert.equal(shown.length, 60)
  assert.ok(shown.startsWith('简历简历'), shown)
  assert.ok(shown.endsWith('-最终版.docx'), shown)
  assert.ok(shown.includes('…'))
})

test('信息卡：终端名与位置合成一行、重复不写两遍；缺的项为空字符串（模板据此不显示）', () => {
  assert.equal(pickupState.orderSummary({ terminalName: '大厅一体机', locationLabel: '一楼服务区' }).store, '大厅一体机 · 一楼服务区')
  assert.equal(pickupState.orderSummary({ terminalName: '大厅一体机', locationLabel: ' 大厅一体机 ' }).store, '大厅一体机')
  assert.equal(pickupState.orderSummary({ locationLabel: '一楼服务区' }).store, '一楼服务区')
  const empty = pickupState.orderSummary({})
  assert.equal(empty.fileName, '')
  assert.equal(empty.store, '')
  assert.equal(empty.spec, '')
})

test('返回：跳过「上传参数 / 预览 / 选终端 / 确认」这些下单流程页', () => {
  const back = pickupState.backDeltaPastOrderFlow
  const PICKUP = 'pages/print-pickup/print-pickup'
  // 我的文档 → 上传参数 → 选终端 → 取件（确认页 redirectTo 掉了）：退 3 页回到我的文档
  assert.equal(back(['pages/home/home', 'pages/documents/documents', 'pages/print-upload/print-upload', 'pages/print-store/print-store', PICKUP]), 3)
  // 中途看过预览也一并跳过
  assert.equal(back(['pages/documents/documents', 'pages/print-upload/print-upload', 'pages/print-preview/print-preview', 'pages/print-store/print-store', PICKUP]), 4)
  // 从订单列表进来：上一页不是下单流程，只退一页
  assert.equal(back(['pages/me/me', 'pages/orders/orders', PICKUP]), 1)
  // 栈里只剩下单流程：回首页（0）
  assert.equal(back(['pages/print-upload/print-upload', 'pages/print-store/print-store', PICKUP]), 0)
  assert.equal(back([PICKUP]), 0)
  assert.equal(back([]), 0)
  assert.equal(back(null), 0)
})

test('模板：复制、分享并排；「作废换新码」降为说明下面的次级按钮', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/print-pickup/print-pickup.wxml'), 'utf8')
  const acts = wxml.match(/<view class="ph-acts">([\s\S]*?)<\/view>\s*<text class="ph-share-note">/)
  assert.ok(acts, '「复制」「分享」那一排后面紧跟说明')
  assert.match(acts[1], /bindtap="copyCode"/)
  assert.match(acts[1], /bindtap="shareCode"/)
  assert.doesNotMatch(acts[1], /reissueCode/, '作废换新码不能和复制、分享一样显眼')
  const afterNote = wxml.slice(wxml.indexOf('class="ph-share-note"'))
  assert.match(afterNote, /class="btn-retry-sub tap"[^>]*bindtap="reissueCode"/)
})

test('模板：信息卡有文件、终端、规格三行；底部按钮文字由状态决定', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/print-pickup/print-pickup.wxml'), 'utf8')
  for (const [field, key] of [['fileName', '文件'], ['store', '终端'], ['spec', '规格']]) {
    assert.match(wxml, new RegExp(`wx:if="\\{\\{${field}\\}\\}">\\s*<text class="info-key"[^>]*>${key}</text>\\s*<text class="info-val"[^>]*>\\{\\{${field}\\}\\}</text>`))
  }
  assert.match(wxml, /bindtap="home">\{\{doneLabel\}\}<\/view>/)
  assert.doesNotMatch(wxml, /bindtap="home">完成<\/view>/, '不能再写死「完成」')
})

test('B2 模板：订单详情按钮写实际去处；确认页第 3 步与上传页、选终端页同叫「确认提交」（FLOW1a：到机核验在第 4 步）', () => {
  const detail = fs.readFileSync(path.join(MINIAPP, 'pages/order-detail/order-detail.wxml'), 'utf8')
  assert.match(detail, /bindtap="toPrint">去我的文档打印<\/button>/)
  assert.doesNotMatch(detail, /再打印一份/)
  for (const rel of ['pages/print-upload/print-upload.wxml', 'pages/print-store/print-store.wxml', 'pages/print-pay/print-pay.wxml']) {
    const wxml = fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
    assert.match(wxml, /<text class="n">3<\/text><text class="nl">确认提交<\/text>/, rel)
    assert.doesNotMatch(wxml, /<text class="nl">到机核验<\/text>/, `${rel}：步骤条不能再把「到机核验」放在手机上的步骤里`)
  }
})

test('B2 模板：信息卡三行的标签不被挤扁、值可断行；换码进行中置灰', () => {
  const wxml = fs.readFileSync(path.join(MINIAPP, 'pages/print-pickup/print-pickup.wxml'), 'utf8')
  for (const [field, key] of [['fileName', '文件'], ['store', '终端'], ['spec', '规格']]) {
    const row = new RegExp(`wx:if="\\{\\{${field}\\}\\}">\\s*<text class="info-key" style="flex-shrink: 0;">${key}</text>\\s*<text class="info-val" style="min-width: 0; word-break: break-all;">`)
    assert.match(wxml, row, `${key}这一行要有换行保护：连续长串文件名不能把标签挤扁或撑出卡片`)
  }
  assert.match(wxml, /class="btn-retry-sub tap" style="\{\{reissuing \? 'opacity: \.5;' : ''\}\}"[^>]*bindtap="reissueCode"/)
})
