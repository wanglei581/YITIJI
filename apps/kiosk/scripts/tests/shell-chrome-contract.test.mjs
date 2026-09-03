// 壳层遮蔽契约的自测。
//
// 这条断言是 2026-09-02 从「字面量精确匹配」换过来的。换断言天然有放宽的嫌疑，
// 所以下面每一条 reject 用例都是故障注入：把真实可能写出来的绕过写法喂进去，
// 证明它们被拦住。只有 accept 用例的门禁等于没有门禁。

import assert from 'node:assert/strict'
import test from 'node:test'
import { checkShellChromeProp, readJsxBooleanProp } from '../lib/shell-chrome-contract.mjs'

/** 真实 KioskRoot 的骨架，各用例在此基础上替换。 */
const REAL = `
  const QX_MIGRATED_ROUTES = new Set<string>([
    '/print/pickup-claim',
  ])
  const isQxRoute = QX_MIGRATED_ROUTES.has(pathname)
  const isCampusZone = pathname === '/campus'
  const usesPageActionbar = routeUsesPageActionbar(pathname)
  return <KioskPageFrame hideHeader={isCampusZone || isQxRoute} hideBottomNav={isCampusZone || isQxRoute || usesPageActionbar} />
`

test('接受当前真实写法：campus + 青序流光迁移路由 + actionbar 路由', () => {
  const header = checkShellChromeProp(REAL, 'hideHeader')
  assert.equal(header.ok, true, header.reason)
  assert.deepEqual(header.disjuncts, ['isCampusZone', 'isQxRoute'])

  const nav = checkShellChromeProp(REAL, 'hideBottomNav')
  assert.equal(nav.ok, true, nav.reason)
  assert.deepEqual(nav.disjuncts, ['isCampusZone', 'isQxRoute', 'usesPageActionbar'])
})

test('路由集合增删不需要动门禁 —— 那是数据不是决定', () => {
  const grown = REAL.replace("'/print/pickup-claim',", "'/print/pickup-claim',\n    '/print/preview',")
  assert.equal(checkShellChromeProp(grown, 'hideHeader').ok, true)
})

// ---- 故障注入：以下每一条都必须被拒 ----

const REJECTED = [
  {
    label: '直接写 true —— 全站藏掉顶栏',
    source: REAL.replace('hideHeader={isCampusZone || isQxRoute}', 'hideHeader={true}'),
    prop: 'hideHeader',
  },
  {
    label: '内联取反 —— 除首页外全藏',
    source: REAL.replace('hideHeader={isCampusZone || isQxRoute}', "hideHeader={pathname !== '/'}"),
    prop: 'hideHeader',
  },
  {
    label: '外部传入的布尔 —— 页面自己能开的口子',
    source: REAL.replace('hideHeader={isCampusZone || isQxRoute}', 'hideHeader={props.chromeless}'),
    prop: 'hideHeader',
  },
  {
    label: '具名但初始化式全站命中 —— 伪装成 isCampusZone 的形状',
    source: REAL
      .replace('const isCampusZone', 'const isAnyRoute = pathname.length > 0\n  const isCampusZone')
      .replace('hideHeader={isCampusZone || isQxRoute}', 'hideHeader={isAnyRoute}'),
    prop: 'hideHeader',
  },
  {
    label: '具名但不在本文件声明',
    source: REAL.replace('hideHeader={isCampusZone || isQxRoute}', 'hideHeader={isChromelessRoute}'),
    prop: 'hideHeader',
  },
  {
    label: 'Set 不是字面量构造 —— new Set(allRoutes) 等于全放行',
    source: REAL.replace(
      /const QX_MIGRATED_ROUTES = new Set<string>\(\[[\s\S]*?\]\)/,
      'const QX_MIGRATED_ROUTES = new Set<string>(allKioskRoutes)',
    ),
    prop: 'hideHeader',
  },
  {
    label: '底部导航漏掉 actionbar 判据以外的合法性同样受检',
    source: REAL.replace('hideBottomNav={isCampusZone || isQxRoute || usesPageActionbar}', 'hideBottomNav={1 === 1}'),
    prop: 'hideBottomNav',
  },
]

for (const { label, source, prop } of REJECTED) {
  test(`拒绝：${label}`, () => {
    const result = checkShellChromeProp(source, prop)
    assert.equal(result.ok, false, `这种写法必须被拦住，但它通过了：${label}`)
    assert.ok(result.reason.length > 0, '拒绝时必须说清违反了什么，而不是只说正则没匹配上')
  })
}

test('字面量 true 的拒绝理由必须说到点子上，不能把人引去声明 const', () => {
  const result = checkShellChromeProp(REAL.replace('hideHeader={isCampusZone || isQxRoute}', 'hideHeader={true}'), 'hideHeader')
  assert.equal(result.ok, false)
  assert.match(result.reason, /字面量/, '报错应指出这是字面量，而不是说"不是本文件内的 const"')
})

test('属性缺失按拒绝处理（fail-closed），不是静默跳过', () => {
  const result = checkShellChromeProp('const x = 1', 'hideHeader')
  assert.equal(result.ok, false)
})

test('readJsxBooleanProp 能处理嵌套花括号，不会在第一个 } 处截断', () => {
  assert.equal(readJsxBooleanProp('<A hideHeader={cond ? {a:1} : null} />', 'hideHeader'), 'cond ? {a:1} : null')
})
