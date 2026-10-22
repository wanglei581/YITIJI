/**
 * VIS1（10/16）订单页、诊断页的布局结构。WXML 在 node 里渲染不出来，这里只核结构与样式规则，
 * 作为开发者工具实际模拟器截图、手机复验之外的补充。诊断页 js 未动；订单页 js 只加了一个复用触底路径的方法。
 *
 * 守的是 10/16 截图里看到的问题：
 *   - 订单页：材料包 0 笔的大空卡挤走真实订单；到机码三列挤压，8 位码和标签断行；卡里套卡、字太小。
 *   - 诊断页：没有报告也显示整块禁用导出卡；两个按钮并排右侧越屏；空态与主按钮之间大片空白。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')
const ordersWxml = read('pages/orders/orders.wxml')
const ordersWxss = read('pages/orders/orders.wxss')
const diagWxml = read('pages/resume-diagnose/resume-diagnose.wxml')
const diagWxss = read('pages/resume-diagnose/resume-diagnose.wxss')

/** 取某个 CSS 规则块（选择器完全一致）。 */
function rule(css, selector) {
  const at = css.indexOf(`${selector} {`)
  assert.ok(at >= 0, `缺少样式规则 ${selector}`)
  return css.slice(at, css.indexOf('}', at) + 1)
}

test('订单页：单件打印订单分区在前，材料包订单分区在后', () => {
  const single = ordersWxml.indexOf('<view class="sh-t">单件打印订单</view>')
  const pkg = ordersWxml.indexOf('<view class="sh-t">材料包订单</view>')
  assert.ok(single > 0 && pkg > 0)
  assert.ok(single < pkg, '真实订单最多的单件分区要先出现')
})

test('订单页：两个分区各自保留加载、列表、失败、筛选为空、从没有过五种分支', () => {
  const pkgPart = ordersWxml.slice(ordersWxml.indexOf('<view class="sh-t">材料包订单</view>'))
  const singlePart = ordersWxml.slice(ordersWxml.indexOf('<view class="sh-t">单件打印订单</view>'), ordersWxml.indexOf('<view class="sh-t">材料包订单</view>'))
  for (const needle of ['正在加载材料包订单', "pkgState === 'error'", '当前筛选下没有材料包订单', '还没有材料包订单', 'pkgLoadingMore', 'loadMorePackages']) {
    assert.ok(pkgPart.includes(needle), `材料包分区缺：${needle}`)
  }
  for (const needle of ['正在加载打印订单', '打印订单加载失败', '当前筛选下没有单件打印订单', '暂无单件打印订单', 'loadingMore']) {
    assert.ok(singlePart.includes(needle), `单件分区缺：${needle}`)
  }
})

test('订单页：「从没有过」的空态压成一行，材料包创建入口仍在这一行里', () => {
  const pkgEmpty = ordersWxml.match(/<view class="empty-row" wx:else>\s*<text class="ficon i-folder er-ic"><\/text>\s*<view class="er-t">还没有材料包订单<\/view>\s*<view class="er-act tap"[^>]*bindtap="toPackageCreate">创建材料包<\/view>/)
  assert.ok(pkgEmpty, '材料包空态应是一行，并带「创建材料包」')
  assert.match(ordersWxml, /<view class="empty-row" wx:else>\s*<text class="ficon i-printer er-ic"><\/text>/)
  assert.doesNotMatch(ordersWxml, /es-t">还没有材料包订单/, '不能再用整张空卡')
  assert.doesNotMatch(ordersWxml, /es-t">暂无单件打印订单/, '不能再用整张空卡')
  const act = rule(ordersWxss, '.er-act')
  assert.match(act, /min-height: 48px/, '创建入口保持 48px 触控')
})

test('订单页：到机码条两行——标签与码同一行且都不折行，说明另起一行；不再卡里套卡', () => {
  const strips = ordersWxml.match(/<view class="pk-strip"[\s\S]*?<view class="pk-hint">/g) || []
  assert.equal(strips.length, 2, '材料包卡、单件卡各一处')
  for (const strip of strips) {
    assert.match(strip, /<view class="pk-row">\s*<text class="pk-label">到机码<\/text>\s*<text class="pk-code">/)
    assert.match(strip, /<\/view>\s*<view class="pk-hint">$/, '说明在 pk-row 外面，单独一行')
  }
  const s = rule(ordersWxss, '.pk-strip')
  assert.match(s, /flex-direction: column/)
  assert.doesNotMatch(s, /border:/, '卡片已有边框，这一条只用浅底')
  for (const sel of ['.pk-label', '.pk-code']) {
    const r = rule(ordersWxss, sel)
    assert.match(r, /white-space: nowrap/, `${sel} 不折行`)
    assert.match(r, /flex-shrink: 0/, `${sel} 不被挤压`)
  }
})

test('订单页：文件名最多两行可断行；问题区字号都在字阶上', () => {
  const t = rule(ordersWxss, '.oc-title')
  assert.match(t, /-webkit-line-clamp: 2/)
  assert.match(t, /word-break: break-all/)
  assert.doesNotMatch(t, /white-space: nowrap/)
  for (const sel of ['.oi-title', '.oi-sub', '.pk-label', '.pk-hint', '.oc-spec', '.es-d']) {
    assert.match(rule(ordersWxss, sel), /font-size: var\(--fs-/, `${sel} 用字阶令牌`)
  }
})

test('诊断页：没有结果就不能导出——导出控件只在完成态内容块里，其余状态一个都不放', () => {
  assert.doesNotMatch(diagWxml, /state-export-disabled/, '不再用禁用导出卡占位')
  assert.doesNotMatch(diagWxml, /status !== 'done'/)
  const doneAt = diagWxml.indexOf(`<view wx:if="{{status === 'done'}}" class="content has-bar">`)
  const barsAt = diagWxml.indexOf('<!-- 操作栏 -->')
  assert.ok(doneAt > 0 && barsAt > doneAt, '完成态内容显式按 done 判断，不挂在别的块的 else 上')
  assert.doesNotMatch(diagWxml, /<view wx:else class="content has-bar">/)
  const exportAts = [...diagWxml.matchAll(/data-kind="(?:diagnosis_report|change_list)"|bindtap="exportReport"/g)].map((m) => m.index)
  assert.ok(exportAts.length >= 2)
  for (const at of exportAts) assert.ok(at > doneAt && at < barsAt, '导出控件只在完成态内容块里')
})

test('诊断页：失败态先给原因和「重新上传简历」，「重试诊断」仍在固定栏', () => {
  const failed = diagWxml.match(/<view wx:elif="\{\{status === 'failed'\}\}" class="running-state">([\s\S]*?)\n  <\/view>/)
  assert.ok(failed, '取得到失败态块')
  assert.ok(failed[1].indexOf('{{failMsg}}') < failed[1].indexOf('重新上传简历'), '原因在前，操作在后')
  assert.match(failed[1], /<view class="btn ghost block tap state-cta"[^>]*bindtap="toUpload">重新上传简历<\/view>/)
  const bars = diagWxml.slice(diagWxml.indexOf('<!-- 操作栏 -->'))
  assert.match(bars, /bindtap="retryDiagnosis">重试诊断<\/view>/)
})

test('诊断页：空态的主按钮紧跟说明，空态不再有底部固定栏', () => {
  const empty = diagWxml.match(/<view wx:elif="\{\{status === 'empty'\}\}" class="running-state">([\s\S]*?)\n  <\/view>/)
  assert.ok(empty, '取得到空态块')
  assert.match(empty[1], /<view class="btn primary block tap state-cta"[^>]*bindtap="toUpload">上传简历开始诊断<\/view>/)
  assert.ok(empty[1].indexOf('state-cta') < empty[1].indexOf('saved-tip'), '主按钮在「查看上一次的诊断」之前')
  const bars = diagWxml.slice(diagWxml.indexOf('<!-- 操作栏 -->'))
  assert.doesNotMatch(bars, /status === 'empty'/, '空态不再有固定栏')
  assert.match(bars, /status === 'done'\}\}" class="actionbar"/)
  assert.match(bars, /status === 'failed'\}\}" class="actionbar"/)
})

test('诊断页：网格里的原生按钮由网格定宽、可折行，修的是根因不是遮盖', () => {
  assert.match(diagWxss, /\.report-export-actions \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(diagWxss, /\.export-result-actions \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.match(diagWxss, /\.report-export-actions button\.btn,\s*\n\.export-result-actions button\.btn \{ width: auto; margin: 0; white-space: normal; \}/)
  assert.doesNotMatch(diagWxss, /report-export-actions[^}]*overflow:\s*hidden/, '不能用 overflow:hidden 盖住越界')
})

test('订单页：单件区末尾有明确的「加载更多 / 重试」，走与触底同一个方法，不碰材料包游标', () => {
  const singlePart = ordersWxml.slice(ordersWxml.indexOf('<view class="sh-t">单件打印订单</view>'), ordersWxml.indexOf('<view class="sh-t">材料包订单</view>'))
  assert.match(singlePart, /wx:if="\{\{nextCursor && !error\}\}"[\s\S]*?bindtap="loadMoreOrders"[\s\S]*?加载更多单件打印订单/)
  assert.match(singlePart, /<text wx:if="\{\{nextCursor\}\}" class="lf-retry tap"[^>]*bindtap="loadMoreOrders">重试<\/text>/)
  assert.doesNotMatch(singlePart, /loadMorePackages|pkgCursor/, '单件区不碰材料包的游标')
})
