/**
 * 试点免费（两行价目都是 0）时，打印与材料包链路不出现任何钱的字眼。
 * 依据：2026-09-30 产品负责人拍板「小程序首版不出现任何价格或购买引导」「试点免费，两行价目都是 0 元」。
 * 价目大于 0 时显示金额的那些分支**原样保留**，本测试不拦它们，只要求它们挂在「已报出大于 0 的金额」下。
 *
 * 静态判据（读源码，不跑页面）：
 *   ① WXML：凡含钱字眼的字符串字面量，必须落在本页 PAID_GUARD 条件的真分支里；
 *      模板正文、属性值里直接写钱字眼一律不行（那样免费时也会显示）。
 *   ② JS：凡含钱字眼的字符串字面量，必须在 JS_ALLOW 里点名，并写明它为什么只在收费时出现。
 *   ③ 免费时换用的两句材料包说明本身不含钱字眼。
 *
 * 由 `verify:price-confirmation` 拉起，串在 verify:static 里。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MINIAPP, rel), 'utf8')

const MONEY = /报价|单价|金额|核价|计价|计费|价格|价目|应付|付款|支付|预估|费用|收费|¥|￥|dollar|credit-card/

// 每页「服务端已报出大于 0 的金额」这个条件的原文。钱字眼只许出现在它的真分支里。
const PAID_GUARD = {
  'pages/print-upload/print-upload.wxml': "priceStatus === 'ready' && amountCents > 0",
  'pages/print-preview/print-preview.wxml': 'hasQuote && !isFree',
  'pages/print-store/print-store.wxml': 'q.total && !isFreeOrder',
  'pages/print-pay/print-pay.wxml': "quoteState === 'ready' && !isFreeOrder",
  'pages/package-create/package-create.wxml': null,
  'pages/package-confirm/package-confirm.wxml': "quoteState === 'ready' && !quoteFree",
  'pages/package-code/package-code.wxml': 'paidOrder',
}

// 模板正文里允许的钱字眼：只有服务端 409 PRICE_CHANGED（价目真的变了）才会渲染。
const WXML_TEXT_ALLOW = {
  'pages/print-pay/print-pay.wxml': ['价格已更新'],
}

// 值里含钱字眼的 data 字段：模板里引用它们也必须挂在 PAID_GUARD 的真分支下
const MONEY_VARS = {
  'pages/package-confirm/package-confirm.wxml': ['onsiteNotice', 'noCancelNotice'],
}

/** 从 `?` 之后找同一层的 `:`（跳过字符串、括号和嵌套三元）。 */
function matchColon(expr, q) {
  let depth = 0
  let nest = 0
  for (let i = q + 1; i < expr.length; i += 1) {
    const ch = expr[i]
    if (ch === "'" || ch === '"') {
      const end = expr.indexOf(ch, i + 1)
      i = end < 0 ? expr.length : end
    } else if (ch === '(' || ch === '[') depth += 1
    else if (ch === ')' || ch === ']') depth -= 1
    else if (depth === 0 && ch === '?') nest += 1
    else if (depth === 0 && ch === ':') {
      if (nest === 0) return i
      nest -= 1
    }
  }
  return -1
}

/** 字面量 [start, end) 是否落在 guard 某一次出现的真分支里。 */
function insidePaidBranch(expr, start, guard) {
  if (!guard) return false
  let from = 0
  for (;;) {
    const at = expr.indexOf(guard, from)
    if (at < 0) return false
    from = at + 1
    const before = expr.slice(0, at).trimEnd()
    // guard 必须是整个条件：前面只能是表达式开头、左括号或上一层三元的 ? / :
    if (before && !/[(?:]$/.test(before)) continue
    const after = expr.slice(at + guard.length)
    const q = at + guard.length + (after.length - after.trimStart().length)
    if (expr[q] !== '?') continue
    const colon = matchColon(expr, q)
    if (colon > 0 && start > q && start < colon) return true
  }
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length
}

/** WXML 里所有钱字眼的违例（去掉注释后逐段看）。 */
function wxmlViolations(rel) {
  const raw = read(rel)
  // 注释换成等长空白，保证行号不变
  const src = raw.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  const guard = PAID_GUARD[rel]
  const allowText = WXML_TEXT_ALLOW[rel] || []
  const out = []
  const re = /\{\{([\s\S]*?)\}\}/g
  let last = 0
  let m
  const checkText = (text, offset) => {
    if (!MONEY.test(text)) return
    const bare = allowText.reduce((acc, a) => acc.split(a).join(''), text)
    if (MONEY.test(bare)) out.push(`${rel}:${lineOf(src, offset)} 正文/属性里直接写了钱字眼：${text.trim().slice(0, 40)}`)
  }
  while ((m = re.exec(src))) {
    checkText(src.slice(last, m.index), last)
    const expr = m[1]
    const lit = /'[^']*'|"[^"]*"/g
    let l
    while ((l = lit.exec(expr))) {
      if (!MONEY.test(l[0])) continue
      if (!insidePaidBranch(expr, l.index, guard)) {
        out.push(`${rel}:${lineOf(src, m.index)} 钱字眼不在「${guard || '（本页不许出现）'}」的真分支里：${l[0]}`)
      }
    }
    for (const name of MONEY_VARS[rel] || []) {
      const ref = new RegExp(`\\b${name}\\b`, 'g')
      let r
      while ((r = ref.exec(expr))) {
        if (!insidePaidBranch(expr, r.index, guard)) {
          out.push(`${rel}:${lineOf(src, m.index)} 含钱字眼的字段 ${name} 不在「${guard}」的真分支里`)
        }
      }
    }
    last = m.index + m[0].length
  }
  checkText(src.slice(last), last)
  return out
}

// JS 里允许的含钱字面量：每一条都只在服务端报出大于 0 的金额、或价目真的变了时才出现。
const JS_ALLOW = {
  'pages/print-upload/print-upload.js': [],
  'pages/print-preview/print-preview.js': [],
  'pages/print-store/print-store.js': [],
  // amountTextOf：0 元走「免费」，'¥' 只拼大于 0 的金额（给 409 PRICE_CHANGED 那句话用）
  'pages/print-pay/print-pay.js': ['¥'],
  'pages/package-create/package-create.js': [],
  // _storedAmountNote：原单 0 元时提前 return ''，这句只在原单金额大于 0 时拼出来
  'pages/package-confirm/package-confirm.js': ['原订单金额：'],
  'pages/package-code/package-code.js': [],
}

/** 取 JS 里的字符串字面量（跳过注释）。模板字符串按整段取。 */
function jsLiterals(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue }
    if (ch === '/' && next === '*') { i = src.indexOf('*/', i + 2); if (i < 0) break; i += 2; continue }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1
      out.push({ text: src.slice(i + 1, j), index: i })
      i = j + 1
      continue
    }
    i += 1
  }
  return out
}

function jsViolations(rel) {
  const src = read(rel)
  const allow = JS_ALLOW[rel] || []
  return jsLiterals(src)
    .filter((l) => MONEY.test(l.text) && !allow.some((a) => l.text.includes(a)))
    .map((l) => `${rel}:${lineOf(src, l.index)} 含钱字眼的字面量没有登记：${l.text.slice(0, 50)}`)
}

test('WXML：钱字眼只出现在「已报出大于 0 的金额」的分支里', () => {
  const v = Object.keys(PAID_GUARD).flatMap(wxmlViolations)
  assert.deepEqual(v, [])
})

test('JS：含钱字眼的字面量都已登记为只在收费时出现', () => {
  const v = Object.keys(JS_ALLOW).flatMap(jsViolations)
  assert.deepEqual(v, [])
})

test('材料包免费时的两句说明不含钱字眼', () => {
  const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
  const pkg = requireMiniapp('../utils/package-order.js')
  for (const s of [pkg.PACKAGE_ONSITE_NOTICE_FREE, pkg.PACKAGE_NO_CANCEL_NOTICE_FREE]) {
    assert.equal(typeof s, 'string')
    assert.ok(s.length > 10)
    assert.doesNotMatch(s, MONEY)
  }
  // MONEY_VARS 登记的两句收费说明确实含钱字眼（登记没过期）
  for (const s of [pkg.PACKAGE_ONSITE_NOTICE, pkg.PACKAGE_NO_CANCEL_NOTICE]) assert.match(s, MONEY)
})

test('判据自检：guard 真分支放行，假分支、正文、换了条件都要报', () => {
  const g = 'paidOrder'
  const e1 = "paidOrder ? '到机应付' : '本次打印'"
  assert.equal(insidePaidBranch(e1, e1.indexOf("'到机应付'"), g), true)
  const e2 = "paidOrder ? '本次打印' : '到机应付'"
  assert.equal(insidePaidBranch(e2, e2.indexOf("'到机应付'"), g), false)
  const e3 = "a || paidOrder ? '到机应付' : ''"
  assert.equal(insidePaidBranch(e3, e3.indexOf("'到机应付'"), g), false)
  const e4 = "x ? '免费' : (paidOrder ? (y ? '¥1' : '¥2') : '—')"
  assert.equal(insidePaidBranch(e4, e4.indexOf("'¥2'"), g), true)
  assert.equal(insidePaidBranch(e4, e4.indexOf("'—'"), g), false)
})

test('打印参数页：没选文件时底栏只剩「请先选择文件」按钮', () => {
  const src = read('pages/print-upload/print-upload.wxml')
  const bar = src.slice(src.indexOf('<view class="actionbar">'))
  const label = bar.match(/class="ab-label">\{\{([\s\S]*?)\}\}</)[1]
  const dashIf = bar.match(/wx:(?:if|elif)="\{\{([^}]*)\}\}" class="ab-amt pending"/)[1]
  const run = (expr, data) => new Function(...Object.keys(data), `return (${expr})`)(...Object.values(data))
  const idle = { priceStatus: 'idle', amountCents: null, hasFile: false }
  assert.equal(run(label, idle), '')
  assert.equal(Boolean(run(dashIf, idle)), false)
  assert.match(bar, /\{\{!hasFile \? '请先选择文件'/)
})

test('材料包状态：0 元订单各状态都不提付款，大于 0 的原样说付款', () => {
  const requireMiniapp = createRequire(path.join(MINIAPP, 'utils', 'entry.js'))
  const pkg = requireMiniapp('../utils/package-order.js')
  const now = Date.parse('2026-10-08T10:00:00+08:00')
  const later = '2026-10-09T10:00:00+08:00'
  // 服务端对 0 元材料包建单即记为已付（paymentSource: free）
  const states = [
    { pickupStatus: 'pending', payStatus: 'paid', taskStatus: '', expiresAt: later },
    { pickupStatus: 'claimed', payStatus: 'paid', taskStatus: '' },
    { pickupStatus: 'used', payStatus: 'paid', taskStatus: 'queued' },
  ]
  for (const st of states) {
    const free = { ...st, amountCents: 0 }
    assert.doesNotMatch(pkg.resolvePackageStatus(free, now).label, MONEY, JSON.stringify(st))
    assert.doesNotMatch(pkg.statusDetail(free), MONEY, JSON.stringify(st))
    const paid = { ...st, amountCents: 150 }
    assert.match(pkg.resolvePackageStatus(paid, now).label + pkg.statusDetail(paid), /付款/, JSON.stringify(st))
  }
})
