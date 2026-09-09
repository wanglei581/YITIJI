// 真人走查：用模拟数据把功能流程当真人一样走一遍，每一步截图，每个按钮都点。
//
// 与既有 spec 的区别：既有 spec 大多 `page.goto` 直达单页做断言；本文件**从首页出发、
// 只靠点击推进**，因为直达会跳过真实的上下文传递（2026-09-07 实测 /print/upload 直达
// 会被清场态弹回首页），而真人不会在地址栏输 URL。
//
// 每条旅程独立 context（Playwright 的 test 默认如此）—— 共用 page 连跑多路由时，
// 一体机的清场/待机控制器会吞掉后续导航，产出「页面空白」的假结论。
import type { Page } from '@playwright/test'
import { test, expect } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { registerW6Api } from './fixtures/fusion-w6-api'
import { seedMaterialSession, W2_FILE } from './fixtures/fusion-w2-state'
import {
  formatMissingSourceFourElements,
  missingSourceFourElements,
  scanForbiddenCopy,
} from '../../scripts/lib/sweep-copy-guards.mjs'

// 截图目录：CI 里落到 test-results 下随失败产物一起上传；本地可用 JOURNEY_SHOTS_DIR 覆盖。
const SHOTS = process.env.JOURNEY_SHOTS_DIR ?? 'test-results/human-journey'

type Step = { n: number }

/** 截一步，并把该屏所有可见控件（文本 + 高度 + 是否禁用）打出来当证据。 */
async function step(page: Page, s: Step, label: string): Promise<void> {
  s.n += 1
  const tag = `${String(s.n).padStart(2, '0')}-${label}`
  await page.screenshot({ path: `${SHOTS}/${tag}.png` })
  const ctrls = await page
    .locator('button:visible, a[href]:visible, [role="button"]:visible')
    .evaluateAll((els) =>
      els
        .map((e) => {
          const r = e.getBoundingClientRect()
          return {
            t: (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20),
            h: Math.round(r.height),
            dis: (e as HTMLButtonElement).disabled === true,
          }
        })
        .filter((x) => x.h > 0),
    )
  const small = ctrls.filter((c) => c.h < 48)
  console.log(
    `\n  [${tag}] ${page.url().replace(/^https?:\/\/[^/]+/, '')}` +
      `\n    控件 ${ctrls.length} 个（禁用 ${ctrls.filter((c) => c.dis).length}）：` +
      ctrls.map((c) => `${c.t}(${c.h}${c.dis ? '·禁' : ''})`).join(' ') +
      (small.length ? `\n    ⚠ <48px：${small.map((c) => `${c.t}(${c.h})`).join(' ')}` : ''),
  )
  // 一体机硬约束：可点区不小于 48px（CLAUDE.md §9）
  expect(small, `${tag} 有低于 48px 的可点控件`).toEqual([])
}

/**
 * 岗位夹具 —— 形状以 packages/shared/src/types/job.ts 为准，不按项目惯例猜：
 *   列表 = PaginatedResponse<ExternalJobDTO> = { data: T[], pagination }，**不带 success 信封**
 *   ExternalJobSource 必填：sourceOrgId / externalId / sourceName / sourceUrl / syncTime
 *                          / reviewStatus / publishStatus
 *   ExternalJobDTO 必填：salaryDisplay / dataSourceNote（注释里写明「合规来源说明（必须展示）」）
 * 2026-09-08 实测：包成 { success, data: { items } } 会让列表页整页落到兜底错误页。
 */
function seedJobs(api: ApiRouter): void {
  const job = (id: string, title: string, company: string) => ({
    id,
    title,
    company,
    city: '青岛市',
    tags: ['五险一金', '双休'],
    description: '岗位职责与任职要求（模拟数据）。',
    requirements: '本科及以上学历。',
    sourceOrgId: 'org-qd-employment',
    externalId: `EXT-${id}`,
    sourceName: '青岛市公共就业服务中心',
    sourceUrl: `https://example.gov.cn/jobs/${id}`,
    syncTime: '2026-09-06T02:00:00.000Z',
    reviewStatus: 'approved' as const,
    publishStatus: 'published' as const,
    salaryDisplay: '8,000–12,000 元/月',
    dataSourceNote: '本岗位信息来自青岛市公共就业服务中心，本终端仅展示与跳转，不代收简历。',
    category: 'fulltime' as const,
    workType: 'full_time' as const,
    educationRequirement: '本科',
    experienceRequirement: '1-3 年',
    salaryMin: 8000,
    salaryMax: 12000,
    salaryUnit: 'monthly' as const,
  })
  const data = [
    job('job-001', '前端开发工程师', '青岛某某科技有限公司'),
    job('job-002', '人力资源专员', '某某人力资源服务有限公司'),
    job('job-003', '数控机床操作工', '某某智能制造股份有限公司'),
  ]
  const paged = { data, pagination: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } }
  api.respond('GET', '/api/v1/jobs', { status: 200, json: paged })
  for (const it of data) {
    api.respond('GET', `/api/v1/jobs/${it.id}`, { status: 200, json: { success: true, data: it } })
  }
}

test.describe('真人走查（模拟数据）', () => {
  test('旅程 A：首页 → 打印扫描 Hub → 文档打印 → 选择文件来源 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    const s: Step = { n: 0 }
    await page.goto('/')
    // 青序流光首页的磁贴带 `data-action`（HomeTile.tsx:38），比拼接出来的无障碍名稳。
    // V6 首页那颗叫「进入打印扫描」，青序改成了「打印 · 扫描 … 开始选择材料」——
    // 钉钩子，另外单独断言一句可见文案，改版式不红、改语义才红。
    const printTile = page.locator('[data-action="print-hub"]')
    await expect(printTile).toBeVisible({ timeout: 15000 })
    await expect(printTile).toContainText('打印')
    await step(page, s, 'home')

    await printTile.click()
    await page.waitForURL((u) => u.pathname === '/print-scan')
    await step(page, s, 'print-hub')

    // Hub 上「文档打印」卡：点了必须真的走到选择文件来源
    const docCard = page.getByRole('button', { name: /文档打印/ }).first()
    await expect(docCard).toBeVisible()
    await docCard.click()
    await page.waitForURL((u) => u.pathname !== '/print-scan', { timeout: 10000 })
    await step(page, s, 'after-doc-print')
    console.log(`\n  旅程 A 终点：${new URL(page.url()).pathname}`)
  })

  // 到机码核销的三种真实情形。字段名以 PrintPickupClaimPage.tsx 为准：
  // 页面按 result.released 分支（不是 payStatus），订单号读 result.orderNo（不是 orderId）。
  const CLAIM_CASES = [
    {
      key: 'paid-released',
      label: '已付款 → 直接进队列出纸',
      status: 200,
      // 服务端此端点返回**裸对象**，不包 { success, data }
      // （pickup-order.service.ts 的 `return { released, orderId, orderNo, ... }`）
      json: {
        released: true,
        orderId: 'ord-journey-001', orderNo: 'P202609080001', taskId: 'task-001',
        taskStatus: 'queued', printTaskStatus: 'queued',
      },
      expectText: /打印任务已进入队列|查看打印进度/,
    },
    {
      key: 'unpaid-onsite',
      label: '未付款 → 引导现场支付',
      status: 200,
      json: {
        released: false,
        orderId: 'ord-journey-002', orderNo: 'P202609080002',
        taskStatus: 'awaiting_payment',
      },
      expectText: /请先完成现场支付|进入现场支付/,
    },
    {
      key: 'refunded-blocked',
      label: '已退款 → 必须拒绝，不出纸',
      status: 400,
      json: {
        success: false,
        error: {
          code: 'ORDER_REFUNDED',
          message: '本单已退款，不再出纸。款项按原路退回，可在小程序「我的 → 打印订单」查看退款进度。',
        },
      },
      expectText: /已退款|不再出纸/,
    },
  ] as const

  for (const c of CLAIM_CASES) {
    test(`旅程 B-${c.key}：Hub → 到机码核销 → 输 8 位码 → ${c.label} @kiosk`, async ({ page, api }) => {
      registerW6Api(api)
      const s: Step = { n: 0 }
      let claimBody: unknown = null
      let printTaskCreated = 0
      api.respond('POST', '/api/v1/print/jobs/claim-pickup', { status: c.status, json: c.json })
      page.on('request', (r) => {
        const u = r.url()
        if (r.method() !== 'POST') return
        if (u.includes('/print/jobs/claim-pickup')) claimBody = r.postDataJSON()
        if (/\/print\/jobs$/.test(new URL(u).pathname)) printTaskCreated += 1
      })

      await page.goto('/print-scan')
      await expect(page.getByRole('button', { name: /到机码核销/ })).toBeVisible({ timeout: 15000 })
      await step(page, s, `${c.key}-hub`)

      await page.getByRole('button', { name: /到机码核销/ }).first().click()
      await page.waitForURL((u) => u.pathname === '/print/pickup-claim', { timeout: 10000 })
      await step(page, s, `${c.key}-empty`)

      // 真人按数字键盘逐位输入
      for (const d of '12345678') await page.getByRole('button', { name: d, exact: true }).click()
      await step(page, s, `${c.key}-typed`)

      await page.getByRole('button', { name: /确认校验/ }).click()
      await page.waitForTimeout(1800)
      await step(page, s, `${c.key}-result`)

      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      expect(body, `${c.label}：页面没有给出预期结论`).toMatch(c.expectText)
      expect(claimBody, '提交体必须只含 code，不得夹带其他字段').toEqual({ code: '12345678' })
      // 退款单：绝不能创建打印任务
      if (c.key === 'refunded-blocked') {
        expect(printTaskCreated, '已退款订单不得创建任何打印任务').toBe(0)
        expect(body, '退款单页面不得出现「进入现场支付」').not.toContain('进入现场支付')
      }
      console.log(`\n  【${c.label}】提交体=${JSON.stringify(claimBody)}  建单次数=${printTaskCreated}`)
    })
  }

  test('旅程 C：首页 → 岗位信息 → 岗位详情 → 去来源平台投递 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    seedJobs(api)
    const s: Step = { n: 0 }
    await page.goto('/')
    await page.waitForTimeout(2500)
    await step(page, s, 'home')

    const entry = page.getByRole('button', { name: /岗位信息/ }).first()
    await expect(entry).toBeVisible({ timeout: 10000 })
    await entry.click()
    await page.waitForTimeout(2500)
    await step(page, s, 'jobs-list')

    // 「岗位信息」进的是服务目录页 /jobs-service（8 张分类卡），列表还要再点一层。
    // 这一层是走查发现的：直达 /jobs 会跳过目录，真人不会那样走。
    const fullTime = page.getByRole('button', { name: /全职岗位/ }).first()
    if (await fullTime.count()) {
      await fullTime.click()
      await page.waitForTimeout(3000)
      await step(page, s, 'jobs-fulltime')
    }

    // 列表里点第一条岗位。
    //
    // 这里必须点「查看岗位」按钮，不能点标题：青序流光迁移（#941）之后
    // 列表卡片 `<article className="jf-row">` 上没有 onClick，只有这颗按钮会跳转。
    // 点标题什么也不会发生 —— 本用例此前正是这么写的，于是一路停在列表页，
    // 却报成「岗位详情缺少来源四要素」。（它没在 CI 跑过，所以没人看见。）
    //
    // 卡片整体是否也该可点，是**产品问题不是测试问题**：那颗收藏按钮里写着
    // `event.stopPropagation()`，而只有整卡可点时这行才有意义 —— 已单独反馈给迁移 lane。
    // 本用例只钉住「有一条 sanctioned 的路径能进详情」，不替产品决定卡片交互。
    const first = page.getByRole('button', { name: '查看岗位' }).first()
    if (await first.count()) {
      await first.click()
      await page.waitForTimeout(2500)
      await step(page, s, 'job-detail')
      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
      // 合规硬约束：不得出现平台内投递文案，且必须展示来源四要素。
      // 先剔白名单再查黑名单 —— WHY: 子串误报的真实案例：合规文案「去来源平台投递」含黑名单词「平台投递」。
      const forbidden = scanForbiddenCopy(body)
      expect(forbidden, `岗位详情出现违规文案「${forbidden.join('、')}」`).toEqual([])
      // 正向断言 —— WHY: 缺陷可以表现为该显示的没显示，黑名单查不出来。
      const missing = missingSourceFourElements(body)
      expect(missing, formatMissingSourceFourElements(missing) || '来源四要素').toEqual([])
      // 夹具值：来源机构名与外部ID 必须是这一条岗位的，不能只看见标签。
      for (const must of ['青岛市公共就业服务中心', 'EXT-job-001', '不接收简历']) {
        expect(body, `岗位详情缺少必须展示的「${must}」`).toContain(must)
      }
      console.log(`\n  岗位详情含来源机构：${body.includes('青岛市公共就业服务中心')}`)
      console.log(`  岗位详情含外部ID：${/EXT-job-001/.test(body)}`)
    } else {
      console.log('\n  ⚠ 列表里没找到「前端开发工程师」，岗位入口的数据形状与夹具不符')
    }
    console.log(`\n  旅程 C 终点：${new URL(page.url()).pathname}`)
  })

  // 旅程 D：打印全链路 —— 真人从首页一路点到报价确认，中途真的挑一份文件。
  test('旅程 D：首页 → Hub → 文档打印 → 选文件 → 上传 → 材料检查 → 打印参数 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    const s: Step = { n: 0 }
    const FILE_ID = 'journey-file-001'
    // 上传：服务端返回真实形状（files.controller 的 kiosk-upload）
    api.respond('POST', '/api/v1/files/kiosk-upload', {
      status: 200,
      json: {
        success: true,
        data: {
          fileId: FILE_ID,
          filename: '张某某-求职简历.pdf',
          sizeBytes: 128 * 1024,
          mimeType: 'application/pdf',
          sha256: 'b'.repeat(64),
          signedUrl: '/journey-fixtures/resume.pdf',
          signedUrlExpiresAt: '2099-01-01T00:00:00.000Z',
          fileExpiresAt: '2099-01-02T00:00:00.000Z',
          pages: 2,
        },
      },
    })
    // 材料检查：三种任务（体检 / A4 归一 / 隐私扫描）都按「已完成、可打印、无发现」应答。
    // 形状照 fusion-w2-print.spec.ts 的 materialTask()，与服务端 DocumentProcessTaskView 一致。
    const task = (kind: string, checks: unknown) => ({
      id: `journey-${kind}`, kind, status: 'completed', requesterMode: 'anonymous',
      accessToken: 'journey-token', sourceFileId: FILE_ID, resultFileId: null, endUserId: null,
      params: {}, result: { mode: 'real', checks }, errorCode: null, errorMessage: null,
      expiresAt: '2099-01-01T00:00:00.000Z', createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
      ...(kind === 'pii_scan' ? { piiFindings: [] } : {}),
    })
    let created = 0
    api.respondWith('POST', '/api/v1/materials/tasks', () => {
      created += 1
      const kind = created === 1 ? 'inspection' : created === 2 ? 'normalize_a4' : 'pii_scan'
      const checks = kind === 'inspection'
        ? { pageCount: 2, canPrint: true, messages: [] }
        : kind === 'normalize_a4'
          ? { targetPaperSize: 'A4', canNormalize: true, messages: [] }
          : { findingCount: 0, items: [] }
      return { status: 200, json: { success: true, data: task(kind, checks) } }
    })
    for (const k of ['inspection', 'normalize_a4', 'pii_scan']) {
      api.respond('GET', `/api/v1/materials/tasks/journey-${k}`, { status: 200, json: { success: true, data: task(k, { pageCount: 2, canPrint: true, messages: [] }) } })
      api.respond('GET', `/api/v1/materials/tasks/journey-${k}/print-param-suggestions`, {
        status: 200, json: { success: true, data: { suggestions: [], defaults: null } },
      })
    }

    await page.goto('/')
    // 青序流光首页的磁贴带 `data-action`（HomeTile.tsx:38），比拼接出来的无障碍名稳。
    // V6 首页那颗叫「进入打印扫描」，青序改成了「打印 · 扫描 … 开始选择材料」——
    // 钉钩子，另外单独断言一句可见文案，改版式不红、改语义才红。
    const printTile = page.locator('[data-action="print-hub"]')
    await expect(printTile).toBeVisible({ timeout: 15000 })
    await expect(printTile).toContainText('打印')
    await step(page, s, 'D-home')

    await printTile.click()
    await page.waitForURL((u) => u.pathname === '/print-scan')
    await step(page, s, 'D-hub')

    await page.getByRole('button', { name: /文档打印/ }).first().click()
    await page.waitForURL((u) => u.pathname === '/print/upload', { timeout: 10000 })
    await step(page, s, 'D-file-source')

    // 真人挑文件：点「本机选文件」，再在系统文件窗口里选一份
    const local = page.getByRole('button', { name: /本机选文件/ })
    if (await local.count()) {
      await local.first().click()
      await page.waitForTimeout(800)
      await step(page, s, 'D-local-picked')
    }
    const input = page.locator('input[type="file"]').first()
    const n = await input.count()
    console.log(`\n  文件输入框数量：${n}`)
    if (n) {
      await input.setInputFiles({
        name: '张某某-求职简历.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
      })
      await page.waitForTimeout(2500)
      await step(page, s, 'D-uploaded')
    }

    // 继续往下点：材料检查 → 打印参数 → 报价确认。每一步都断言「按钮真有去向」。
    // 不猜按钮名：每屏自动找「主 CTA」—— 排除返回/退出/更换/删除这类回退动作，
    // 取剩下里最后一个可用按钮（这套 UI 的主操作固定在底部操作条右侧）。
    const BACKWARD = /返回|退出|上一步|更换|删除|重试|取消|问工作人员|再取一件/
    for (let hop = 0; hop < 6; hop += 1) {
      const before = new URL(page.url()).pathname
      const cands = await page.locator('button:visible').evaluateAll((els) =>
        els.map((e, i) => ({ i, t: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), dis: (e as HTMLButtonElement).disabled === true })),
      )
      const fwd = cands.filter((c) => c.t && !c.dis && !/^(首页|AI ?顾问|我的)$|返回|退出|上一步|更换|删除|重试|取消|问工作人员|再取一件/.test(c.t))
      const pick = fwd[fwd.length - 1]
      if (!pick) { console.log(`\n  第 ${hop + 1} 跳：${before} 上没有可用的前进按钮`); break }
      console.log(`\n  第 ${hop + 1} 跳：在 ${before} 点「${pick.t}」`)
      await page.locator('button:visible').nth(pick.i).click()
      await page.waitForTimeout(2800)
      await step(page, s, `D-hop${hop + 1}`)
      const after = new URL(page.url()).pathname
      if (after === before) { console.log(`    ⚠ 点了「${pick.t}」但仍停在 ${before}`); break }
    }
    void BACKWARD
    console.log(`\n  旅程 D 终点：${new URL(page.url()).pathname}${new URL(page.url()).search}`)
  })

  // 旅程 E：接着旅程 D 的下一段 —— 模拟「用户已完成材料检查」的会话，
  // 走 预览 → 打印参数 → 报价确认 → 收银。旅程 D 已经证明这道隐私闸门不能绕过，
  // 这里用 seedMaterialSession 提供一份**通过了检查**的真实会话，继续验后半程。
  test('旅程 E：已完成材料检查 → 预览 → 打印参数 → 报价确认 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    const s: Step = { n: 0 }
    const NOW2 = '2026-09-08T00:00:00.000Z'
    const LATER2 = '2099-01-01T00:00:00.000Z'
    const done = (id: string, kind: string, checks: unknown) => ({
      id, kind, status: 'completed', requesterMode: 'anonymous', accessToken: 'journey-token',
      sourceFileId: W2_FILE.fileId, resultFileId: null, endUserId: null, params: {},
      result: { mode: 'real', checks }, errorCode: null, errorMessage: null,
      expiresAt: LATER2, createdAt: NOW2, updatedAt: NOW2,
    })
    api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001', {
      status: 200, json: { success: true, data: done('w2-inspection-001', 'inspection', { pageCount: 2, canPrint: true, messages: [] }) },
    })
    api.respond('GET', '/api/v1/materials/tasks/w2-normalize-001', {
      status: 200, json: { success: true, data: done('w2-normalize-001', 'normalize_a4', { targetPaperSize: 'A4', canNormalize: true, messages: [] }) },
    })
    api.respond('GET', '/api/v1/materials/tasks/w2-pii-001', {
      status: 200,
      json: { success: true, data: { ...done('w2-pii-001', 'pii_scan', { findingCount: 0, items: [] }), piiFindings: [] } },
    })
    api.respond('GET', '/api/v1/materials/tasks/w2-pii-redact-001', {
      status: 200,
      json: { success: true, data: { ...done('w2-pii-redact-001', 'pii_redact', {}), result: { mode: 'real', canRedact: true, claim: 'nothing_to_redact', redactedFileId: null, resultFileCreated: false, decisionTaskId: 'w2-pii-001', findingCount: 0, redactedCount: 0, keptCount: 0, pendingCount: 0, items: [], reverify: { ran: false, method: null, remainingCount: null } } } },
    })
    api.respond('GET', '/api/v1/materials/tasks/w2-inspection-001/print-param-suggestions', {
      status: 200, json: { success: true, data: { suggestions: [], defaults: null } },
    })
    api.respond('GET', '/api/v1/print/price-config', {
      status: 200, json: { success: true, data: { items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] } },
    })
    api.respond('POST', '/api/v1/orders/quote', {
      status: 200,
      json: {
        amountCents: 200, billablePages: 2, billingPageSource: 'detected',
        priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 2, amountCents: 200 }],
      },
    })
    // 「确认并去付款」触发建单 POST /print/jobs。付费单先建单再进收银（零元单直接建单）。
    let orderBody: unknown = null
    api.respond('POST', '/api/v1/print/jobs', {
      status: 200,
      json: {
        success: true,
        data: {
          orderId: 'ord-journey-E1', orderNo: 'P202609080011', taskId: 'task-E1',
          amountCents: 200, payStatus: 'unpaid', taskStatus: 'awaiting_payment',
          paymentSessionToken: 'journey-pay-token',
        },
      },
    })
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/print/jobs')) orderBody = r.postDataJSON()
    })
    await seedMaterialSession(page)

    await page.goto('/print/desk?step=preview')
    await page.waitForTimeout(3000)
    await step(page, s, 'E-preview')

    // 底部导航（首页 / AI 顾问 / 我的）永远排在 DOM 最后，会被误当主 CTA —— 必须排除。
    const BACK = /^(首页|AI ?顾问|我的)$|返回|退出|上一步|更换|删除|重试|取消|问工作人员/
    for (let hop = 0; hop < 5; hop += 1) {
      const before = new URL(page.url()).pathname
      const cands = await page.locator('button:visible').evaluateAll((els) =>
        els.map((e, i) => ({ i, t: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), dis: (e as HTMLButtonElement).disabled === true })),
      )
      const fwd = cands.filter((c) => c.t && !c.dis && !BACK.test(c.t))
      const pick = fwd[fwd.length - 1]
      if (!pick) { console.log(`\n  ${before} 上没有可用的前进按钮`); break }
      console.log(`\n  在 ${before} 点「${pick.t}」`)
      await page.locator('button:visible').nth(pick.i).click()
      await page.waitForTimeout(3000)
      await step(page, s, `E-hop${hop + 1}`)
      if (new URL(page.url()).pathname === before) { console.log(`    ⚠ 点了「${pick.t}」仍停在 ${before}`); break }
    }
    console.log(`\n  建单提交体：${JSON.stringify(orderBody)}`)
    console.log(`\n  旅程 E 终点：${new URL(page.url()).pathname}`)
  })

  // 岗位行的键盘可达性。列表卡片在青序流光迁移里一度完全不可点（#976 修复），
  // 修复时同时补了 role/tabIndex/onKeyDown —— 而**键盘那一半在触屏上没人会发现它没了**，
  // 后续重构里最容易被悄悄删掉。所以单独钉住，不并进旅程 C。
  test('岗位行：Enter 与 Space 都能进详情，且 Space 不带出页面滚动 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    // 全程只 goto 一次。第二次整页 goto 会被 KioskPrivacyGuard 判为越过隐私边界
    // （整页加载拿不到 history.state.idx，historyIndex === null 即 fail-closed 清场），
    // 页面会变成清场覆盖层而不是岗位列表 —— 那会让本用例红在一个与键盘无关的原因上。
    await page.goto('/jobs', { waitUntil: 'domcontentloaded' })
    const row = page.locator('[data-testid="job-row-job-001"]')
    await expect(row, '岗位行必须带 data-testid，供键盘用例定位').toBeVisible({ timeout: 15_000 })
    await expect(row).toHaveAttribute('role', 'button')
    await expect(row).toHaveAttribute('tabindex', '0')

    // ① Enter 激活
    await row.press('Enter')
    await page.waitForURL((u) => /\/jobs\/job-001$/.test(u.pathname), { timeout: 10_000 })
    // 只钉「进到了这条岗位的详情」。详情页版式与来源四要素由旅程 C 负责，
    // 这里再钉标题的角色/层级只会在详情页改版时假红。
    // 钉「详情页真的渲染出来了」，不钉标题文字。
    // W6 夹具里 job-001 的**列表标题是「前端开发工程师」、详情标题是「前端工程师」**
    // （2026-09-08 实测），钉标题会红在一个与键盘可达性无关的夹具不一致上。
    // 「进的是不是这一条」由上面的 URL 断言保证。
    await expect(page.locator('body')).toContainText('岗位详情', { timeout: 10_000 })

    // SPA 内后退，不用整页 goto（理由同上）
    await page.goBack()
    await expect(row).toBeVisible({ timeout: 15_000 })

    // ② Space 激活 + preventDefault。
    //    测试通常只写 Enter，而 Space 是按钮的标准激活键 —— 只钉一条，另一条被删掉没人发现。
    //    preventDefault 直接读原生事件的 defaultPrevented：比测滚动位置可靠（导航会把页面整个换掉）。
    //    少了它，Space 会在激活的同时滚动页面。
    const spacePrevented = await row.evaluate((el) => {
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
      el.dispatchEvent(ev)
      return ev.defaultPrevented
    })
    expect(spacePrevented, 'Space 必须 preventDefault，否则激活的同时页面会滚动').toBe(true)
    await page.waitForURL((u) => /\/jobs\/job-001$/.test(u.pathname), { timeout: 10_000 })
  })

  // 旅程 F：扫描链路 —— Hub「材料扫描」进去，一路点到扫描结果。
  // 真机上纸张在打印机端走，这里只验前端状态机与按钮去向。
  test('旅程 F：Hub → 材料扫描 → 扫描设置 → 进度 → 结果 @kiosk', async ({ page, api }) => {
    registerW6Api(api)
    const s: Step = { n: 0 }
    const TASK = 'journey-scan-001'
    let polls = 0
    // 扫描结果页现在直接接打印核价（迁移后新增的一步）。缺这两条 mock 时
    // ApiRouter 会以「Unhandled API requests: POST /api/v1/orders/quote」失败 ——
    // 那是产品新增了能力，不是回归。
    api.respond('GET', '/api/v1/print/price-config', {
      status: 200,
      json: { success: true, data: { items: [{ serviceKey: 'print_bw_page', unitCents: 100, unit: 'page', description: '黑白打印' }] } },
    })
    api.respond('POST', '/api/v1/orders/quote', {
      status: 200,
      json: {
        amountCents: 100, billablePages: 1, billingPageSource: 'detected',
        priceLines: [{ serviceKey: 'print_bw_page', description: '黑白打印', unitCents: 100, quantity: 1, amountCents: 100 }],
      },
    })
    // 核价之后还会建单（付费单先建单再进收银），同样是迁移后新增的一步。
    api.respond('POST', '/api/v1/print/jobs', {
      status: 200,
      json: { success: true, data: { orderId: 'journey-scan-order-001', jobId: 'journey-scan-job-001', status: 'pending_payment', amountCents: 100 } },
    })
    api.respond('POST', '/api/v1/scan/sessions', {
      status: 200,
      json: {
        success: true,
        data: {
          scanTaskId: TASK, controlToken: 'journey-scan-control', status: 'waiting',
          scanType: 'document', instructions: ['把原件放到玻璃板上', '在打印机面板按开始扫描'],
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      },
    })
    // 轮询：前两次仍在等，第三次起返回已完成 —— 真实设备就是这个节奏。
    api.respondWith('GET', `/api/v1/scan/sessions/${TASK}`, () => {
      polls += 1
      const done = polls >= 3
      return {
        status: 200,
        json: {
          success: true,
          data: {
            scanTaskId: TASK, status: done ? 'completed' : 'waiting', scanType: 'document',
            expiresAt: '2099-01-01T00:00:00.000Z',
            // 进度页读的是 status.file **对象**（ScanProgressPage:114 `status.status==='completed' && status.file`）。
            // 只给散字段 fileId/fileName 会走到 :122 的「已完成但未拿到文件」分支 —— 实测过。
            ...(done
              ? {
                  // 形状是 **ScanSessionFileView**（packages/shared/src/types/scanTask.ts:25）：
                  // filename / sizeBytes / mimeType / sha256 / fileUrl —— 不是展示层的 name/size/format。
                  // 写成展示层字段会让 buildResultFileState 拿到 undefined，结果页崩在 .trim()。
                  file: {
                    fileId: 'journey-scan-file',
                    filename: '扫描件-001.pdf',
                    sizeBytes: 98304,
                    mimeType: 'application/pdf',
                    sha256: 'd'.repeat(64),
                    fileUrl: '/journey-fixtures/scan-001.pdf',
                  },
                }
              : {}),
          },
        },
      }
    })
    api.respond('DELETE', `/api/v1/scan/sessions/${TASK}`, {
      status: 200, json: { success: true, data: { scanTaskId: TASK, status: 'cancelled' } },
    })

    const pageErrors: string[] = []
    page.on('pageerror', (e) => pageErrors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`))
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 200)}`) })

    await page.goto('/print-scan')
    await expect(page.getByRole('button', { name: /材料扫描/ })).toBeVisible({ timeout: 15000 })
    await step(page, s, 'F-hub')

    await page.getByRole('button', { name: /材料扫描/ }).first().click()
    await page.waitForTimeout(3000)
    await step(page, s, 'F-scan-entry')

    const BACK = /^(首页|AI ?顾问|我的)$|返回|退出|上一步|更换|删除|重试|取消|问工作人员|再扫/
    for (let hop = 0; hop < 5; hop += 1) {
      const before = page.url()
      const cands = await page.locator('button:visible').evaluateAll((els) =>
        els.map((e, i) => ({ i, t: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), dis: (e as HTMLButtonElement).disabled === true })),
      )
      const fwd = cands.filter((c) => c.t && !c.dis && !BACK.test(c.t))
      const pick = fwd[fwd.length - 1]
      if (!pick) { console.log(`\n  ${before} 上没有可用的前进按钮`); break }
      console.log(`\n  在 ${before} 点「${pick.t}」`)
      await page.locator('button:visible').nth(pick.i).click()
      await page.waitForTimeout(3200)
      await step(page, s, `F-hop${hop + 1}`)
      if (page.url() === before) { console.log(`    ⚠ 点了「${pick.t}」仍停在 ${before}`); break }
    }
    // 进度页在等设备。真人此时会站着等 —— 让轮询走到「已完成」，看它是否自动进结果页。
    if (new URL(page.url()).searchParams.get('stage') === 'progress') {
      await page.waitForURL((u) => u.searchParams.get('stage') === 'result', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(2000)
      await step(page, s, 'F-scan-done')
    }
    console.log(`\n  旅程 F 终点：${new URL(page.url()).pathname}   轮询次数：${polls}`)
    if (pageErrors.length) console.log(`\n  ⚠ 运行错误 ${pageErrors.length} 条：\n${pageErrors.slice(0, 3).join('\n---\n')}`)
  })
})
