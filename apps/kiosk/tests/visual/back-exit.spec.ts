import { expect, test } from '../fixtures/kiosk-test'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { sweepCases } from './route-sweep-cases'

/**
 * 「从这一页怎么回上一步」—— 对 productionRoutePatterns 逐条断言。
 *
 * ## 为什么要这条
 *
 * 2026-09-08：青序流光迁移过程中，**15 个已迁页面同时丢了返回键**，收银台丢了「退出支付」。
 * 全部靠人工走查发现 —— 既有门禁一条都没抓到，因为它们查的是「页面有没有说错话」，
 * 不查「用户能不能离开这一页」。迁移窗口把它立成了人工检查项（#970），
 * 但人工检查项挡不住下一次迁移，所以在这里变成机制。
 *
 * ## 判据（由迁移窗口定义语义，本文件实现）
 *
 * 「能不能在**不完成流程**的情况下离开这一页」。两种形态任一即可：
 *   - 顶栏返回键（`.qx-topbar-back`，青序流光 `QxPageFrame` 的 back 槽）
 *   - CTA 条上的次级按钮（收银台的「退出支付」是这一类）
 *
 * 底部主导航（首页 / AI 顾问 / 我的）**不算**：它回的是首页，不是上一步。
 * 只认它等于每一页都自动通过，这条门禁就成了摆设。
 *
 * ## 豁免必须是闭合白名单
 *
 * 新增路由默认落进「必须能离开」。否则下一次迁移又会悄悄漏掉一批 —— 这正是上次的形态。
 */

/** 顶栏返回键 / CTA 次级出口。刻意不含底部主导航。 */
const EXIT_SELECTOR = [
  '.qx-topbar-back',
  '[data-qx-back]',
  'button[aria-label*="返回"]',
  'button[aria-label*="上一步"]',
  'a[aria-label*="返回"]',
].join(', ')

/** 文案型出口：CTA 条上的次级按钮。 */
const EXIT_TEXT = /^(返回|返回上一步|上一步|退出支付|返回确认页|取消|放弃|重新选择|关闭)/

/**
 * 免于「必须能离开」的路由。每条都要写清**为什么这一页不该有返回**。
 * 只许减不许增；新增路由默认进入受检集合。
 */
const EXEMPT = new Map<string, string>([
  ['/', '首页本身就是所有返回的终点。'],
  ['/assistant', '底部主导航的三个目的地之一：主导航就是它们之间的横向切换，没有“上一步”。'],
  ['/profile', '同上：底部主导航的三个目的地之一，主导航即其横向切换。'],
  ['/screensaver', '待机宣传屏：全屏无壳，任意触摸即唤醒。'],
  ['/print/done', '终态页：出口是它自己的主行动（返回首页）。再放返回键会让人以为能退回去改已完成的单。'],
  ['/session-timeout', '会话超时是 fail-closed 终态，唯一出口是回首页重来。'],
])

/**
 * **未裁定的欠账**：这些页用了青序流光壳却没填 back 槽。
 *
 * 它们是不是缺陷，取决于「这一页算不算流程中段」—— 那是页面语义，归迁移窗口裁定，
 * 测试不替产品做决定。挂在这里的意义是：**门禁现在就生效**，能挡住**新增**的漏填，
 * 同时把存量债务显式化并**封顶**（下面的 LIMIT 只许降不许升）。
 *
 * 裁定后每一条要么补上返回槽（从这里删），要么进 EXEMPT 并写清为什么不是流程中段。
 */
const UNDECIDED = new Map<string, string>([
  ['/jobs', '从首页进来的一级业务页。底部主导航能回首页，但回不到“上一步”。'],
  ['/ai/plan', '同上：一级 AI 服务页。'],
  ['/scan/start', '扫描流程第一步。是入口还是中段，取决于它上面还有没有 Hub。'],
  ['/scan/settings', '扫描流程中段，按语义应当能退回上一步。'],
  ['/scan/progress', '进行中态：退出是否等于取消扫描任务，需要产品定。'],
  ['/print/cashier', '付款页已有 CTA 次级出口「退出支付」，但没有顶栏返回槽 —— 两者是否都要，需裁定。'],
  ['/print/progress', '打印进行中：同 /scan/progress，退出语义未定。'],
])
/** 只许降不许升。升它等于给新的漏填开口子。 */
const UNDECIDED_LIMIT = 7

test.describe('每一页都要能回上一步 @kiosk', () => {
  test('未裁定欠账不得增长 @kiosk', () => {
    expect(
      UNDECIDED.size,
      `未裁定条目从 ${UNDECIDED_LIMIT} 涨到了 ${UNDECIDED.size}。`
        + '新页漏填返回槽不该往这里加 —— 要么补上，要么连同理由进 EXEMPT。',
    ).toBeLessThanOrEqual(UNDECIDED_LIMIT)
    const patterns = new Set(sweepCases.map((c) => c.pattern))
    for (const [route, reason] of UNDECIDED) {
      expect(reason.trim().length, `未裁定项「${route}」必须写清为什么还没定`).toBeGreaterThan(12)
      // 路由被合并或改名后，这条欠账会变成指向不存在路由的死条目 —— 它永远不会再被执行，
      // 也就永远不会自退休。#984 把 /scan/{start,settings,progress} 合成 /scan 就是这种情况。
      expect(
        patterns.has(route as never),
        `未裁定项「${route}」不在 productionRoutePatterns 里（路由被合并/改名？），应清理`,
      ).toBe(true)
    }
  })

  test('豁免清单闭合：每条豁免都指向真实路由且写了理由 @kiosk', () => {
    const patterns = new Set(sweepCases.map((c) => c.pattern))
    for (const [route, reason] of EXEMPT) {
      expect(patterns.has(route as never), `豁免「${route}」不在 productionRoutePatterns 里，应清理`).toBe(true)
      expect(reason.trim().length, `豁免「${route}」理由太短`).toBeGreaterThan(12)
    }
  })

  for (const route of sweepCases) {
    const why = EXEMPT.get(route.pattern)
    test(`${route.pattern} ${why ? '按豁免不要求出口' : '必须提供离开这一页的出口'} @kiosk`, async ({ page, api }) => {
      registerW6Api(api)
      await page.goto(route.url, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL((url) => url.pathname === route.landedPath, { timeout: 15_000 })
      await page.waitForTimeout(300)

      // 只对**真正渲染了青序流光壳**的页面提要求。
      //
      // 路由扫描是冷开每条 URL 的，很多流程页在没有前序状态时会落到 fail-closed 守卫态
      // （实测：/print/cashier 冷开只剩「我的打印订单 / 重新发起打印」，那不是收银台本体；
      //  /contract-review 冷开直接渲染首页内容）。对守卫态要求返回键是问错了对象。
      //
      // 而「迁进青序流光却忘了填 back 槽」正是 2026-09 那批缺陷的形态 ——
      // QxPageFrame 的 back 是可选 prop，不传就没有返回键，且不会有任何报错。
      // 所以判据钉在这里：**用了这个壳，就必须填 back 槽**。
      const framed = await page.locator('[data-qx-frame="true"]').count()
      if (framed === 0 && !why) {
        test.skip(true, `${route.pattern} 冷开未渲染青序流光壳（多为 fail-closed 守卫态），不在本条判据范围内`)
      }

      const bySelector = await page.locator(EXIT_SELECTOR).count()
      const byText = await page.evaluate((src) => {
        const rx = new RegExp(src)
        return [...document.querySelectorAll('button:not([disabled]), a[href]')]
          .map((el) => (el as HTMLElement).innerText.replace(/\s+/g, '').trim())
          .filter((t) => rx.test(t)).length
      }, EXIT_TEXT.source)
      const total = bySelector + byText

      if (why) {
        // 豁免不是「随便」：如果这一页其实**有**出口，说明豁免过期了，应当移出清单。
        // 反向断言只钉**顶栏返回槽**，不钉「有没有任何返回类控件」——
        // 终态页的主行动本来就叫「返回首页」，把它算成出口会让豁免永远自相矛盾。
        expect(
          bySelector,
          `「${route.pattern}」已豁免（${why}）却渲染了顶栏返回槽，豁免已过期，请移出 EXEMPT`,
        ).toBe(0)
        return
      }
      const pending = UNDECIDED.get(route.pattern)
      if (pending) {
        // 欠账**自退休**：这一页一旦补上返回槽，就必须从 UNDECIDED 里删掉，否则它会变成
        // 「已经修好、却仍被豁免」的陈账 —— 下次这一页再丢返回键，门禁不会红。
        //
        // 这是 EXEMPT 那条反向断言的同一件事：**豁免清单必须会过期**。
        // 只写「不让它红」的欠账清单，用不了多久就变成永久免死金牌。
        expect(
          bySelector,
          `「${route.pattern}」已经有顶栏返回槽了，请从 UNDECIDED 删掉这一条`
            + `（登记时的疑问：${pending}）。留着它等于给这一页发永久免死金牌。`,
        ).toBe(0)
        console.log(`  [未裁定] ${route.pattern} 仍无顶栏返回槽（${pending}）；其它出口计数=${total - bySelector}`)
        return
      }
      expect(
        total,
        `「${route.pattern}」没有任何离开这一页的出口。`
          + `底部主导航不算（它回首页不是回上一步）。`
          + `请补顶栏返回键（QxPageFrame 的 back 槽）或 CTA 条次级按钮；`
          + `若这一页确实不该有，请连同理由加进本文件的 EXEMPT。`,
      ).toBeGreaterThan(0)
    })
  }
})
