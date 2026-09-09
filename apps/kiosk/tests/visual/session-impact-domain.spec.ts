import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { productionRoutePatterns } from './route-manifest'

/**
 * 会话超时页的「这次清场影响什么」必须按**域**判，域根和子路径不能分到两类。
 *
 * ## 为什么要这条
 *
 * 2026-09-09 实测缺陷：`SessionTimeoutPage` 用 `sourcePath.startsWith('/interview/')`
 * 判「AI 工作类」。面试五页合成工作台 `/interview` 之后，域根**带不上那个斜杠**，
 * 一条都判不中，于是落到通用文案「登录状态和本机临时会话将清除」——
 * 而工作台上正握着用户没保存的练习内容。`/print` `/scan` `/resume` 同一个写法、同一个坑。
 *
 * 它为什么没被现成用例抓到，值得单独记：`kiosk-session-warning.spec.ts` 里有 9 条用例
 * 走过 `/interview/tips`，路由合并后它们的 pathname 会变成 `/interview`、旧谓词当场失配 ——
 * **但那 9 条一条都不会红**，因为没有一条断言那条路径决定的影响文案。
 * 用例走到了那条路径，却没有断言那条路径决定的东西：**覆盖率有，判别力是零。**
 *
 * ## 判据：钉映射，不钉散文
 *
 * 只比较两次渲染的结果是否**相等**，不把中文文案抄进断言。理由是文案会按稿打磨，
 * 把当时的实现文案钉进门禁 = 禁止改文案（本仓已为此红过多次）。
 * 另加一条反向断言 `域根 !== 通用`，堵住「两边都掉进通用文案」时的空断言。
 *
 * ## 域清单从路由表现算，不硬编码
 *
 * 域根是不是真路由会随迁移变化（`/interview` 与 `/scan` 是合并后才出现的，
 * `/print` 至今没有域根）。硬编码域清单会让门禁在**路由还没合并时**红，
 * 而红的原因与被测的不变量无关 —— 那是「撞红的不是缺陷是进度」。
 */

/** `SessionTimeoutPage` 的 `sessionImpact` 落点。 */
const IMPACT = '.k8-timeout-description strong'

/** 谓词里出现过的域根。是不是真路由由下面现算，这里只是候选。 */
const DOMAIN_ROOTS = ['/print', '/scan', '/resume', '/interview', '/assistant'] as const

const patterns = new Set<string>(productionRoutePatterns)

function firstPlainSubRoute(root: string): string | undefined {
  return productionRoutePatterns.find((p) => p.startsWith(`${root}/`) && !p.includes(':'))
}

/** 4 秒空闲即告警：终端配置里的 idleTimeoutSec 由夹具给。 */
function registerShell(api: ApiRouter): void {
  registerW6Api(api)
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 4, items: [] },
  })
}

interface Landed {
  /** 空闲告警触发前，页面真正停在的 pathname —— 判据看的是它，不是我们输入的地址。 */
  path: string
  impact: string
}

async function impactAt(page: Page, target: string): Promise<Landed> {
  await page.goto(target, { waitUntil: 'domcontentloaded' })
  // 先读落地 pathname 再等空闲：冷开可能被 fail-closed 送到别处，
  // 那时 sourcePath 是落地页而不是我们输入的地址，断言必须知道这件事。
  await page.waitForTimeout(800)
  const path = new URL(page.url()).pathname
  await expect(page, `${target} 未在空闲后进入会话超时页`).toHaveURL(/\/session-timeout$/, { timeout: 15_000 })
  const impact = (await page.locator(IMPACT).first().innerText()).replace(/\s+/g, '')
  return { path, impact }
}

test.describe('会话清场影响文案必须按域判 @warning-kiosk', () => {
  for (const root of DOMAIN_ROOTS) {
    test(`${root}：域根与子路径必须判成同一类 @warning-kiosk`, async ({ page, api }) => {
      if (!patterns.has(root)) {
        // 域根还不是注册路由（未迁移 / 未合并）。跳过而不是红 —— 红的原因会与不变量无关。
        test.skip(true, `${root} 当前不是 productionRoutePatterns 里的路由，不在判据范围内`)
      }
      const sub = firstPlainSubRoute(root)
      if (!sub) test.skip(true, `${root} 当前没有无参子路由可作对照`)

      registerShell(api)
      const rootLanded = await impactAt(page, root)
      if (rootLanded.path !== root) {
        // 域根冷开就被送走了 —— 用户不会停在它上面，这条不变量对它不适用。
        // 不跳过的话本条会「通过」，但通过的是落地页，不是域根：那是假绿。
        test.skip(true, `${root} 冷开被送到 ${rootLanded.path}，用户不会停在域根上，不在判据范围内`)
      }
      const subLanded = await impactAt(page, sub as string)
      const generic = await impactAt(page, '/policy-service')
      const rootImpact = rootLanded.impact
      const subImpact = subLanded.impact
      const genericImpact = generic.impact

      expect(
        rootImpact,
        `「${root}」与「${sub}」被判成了两类影响。域根往往漏在 startsWith('${root}/') 这种`
          + `带斜杠的谓词外面 —— 页面合并后域根不再带斜杠，一条都判不中，`
          + `于是落到通用清场文案，而这一屏上可能正握着用户没保存的东西。`,
      ).toBe(subImpact)

      expect(
        rootImpact,
        `「${root}」的影响文案与通用文案相同，本条断言因此没有判别力：`
          + `两边都掉进通用分支时，上面那句相等断言恒真。`,
      ).not.toBe(genericImpact)
    })
  }

  test('候选域根里至少有一个是真路由（否则整条门禁空转）@warning-kiosk', () => {
    const live = DOMAIN_ROOTS.filter((r) => patterns.has(r))
    expect(
      live.length,
      '没有任何候选域根是注册路由，本门禁此刻一条也判不了 —— 说明域清单或路由表其一已经漂移。',
    ).toBeGreaterThan(0)
  })
})
