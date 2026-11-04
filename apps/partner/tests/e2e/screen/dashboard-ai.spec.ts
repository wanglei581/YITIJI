import { test, expect } from '@playwright/test'
import { bare, failure, serve } from './helpers'

const snapshot = (metric: unknown) => ({ audience: 'partner', generatedAt: new Date().toISOString(), metrics: { partnerAiServices: metric } })
const value = (resumeOptimize: number | null, mockInterview: number | null) => ({ available: true, source: 'AiServiceFact', window: '7d', value: { resumeOptimize, mockInterview } })

test('工作台 AI 服务：加载、小样本、零与正常计数', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const calls = await serve(page, async () => { await pending; return bare(snapshot(value(null, 0))) })
  await page.goto('/')
  await expect(page.getByText('正在读取 AI 服务情况')).toBeVisible()
  release()
  await expect(page.getByText('AI 简历优化：少于 5 次，暂不显示具体数字')).toBeVisible()
  await expect(page.getByText('AI 模拟面试：0 场')).toBeVisible()
  expect(calls.urls).toContain('/api/v1/partner/screen/usage?range=7d')
  await serve(page, () => bare(snapshot(value(5, 8))))
  await page.reload()
  await expect(page.getByText('AI 简历优化：5 次')).toBeVisible()
  await expect(page.getByText('AI 模拟面试：8 场')).toBeVisible()
  // 被隐藏时量词跟着服务走：模拟面试写「场」
  await serve(page, () => bare(snapshot(value(0, null))))
  await page.reload()
  await expect(page.getByText('AI 简历优化：0 次')).toBeVisible()
  await expect(page.getByText('AI 模拟面试：少于 5 场，暂不显示具体数字')).toBeVisible()
})

test('工作台 AI 服务：切片不可用可重试；请求失败也可重试', async ({ page }) => {
  // 每次重试都要走完「点 AI 那块的重试 → 请求真的发出 → 正在读取、旧提示撤下 → 放行回话 → 看结果」，
  // 才点下一次。回话按用例阶段给、不按第几次请求给；重试的回话先扣住，看到「正在读取」再放行，
  // 这样看到的提示一定是这一次重试的结果。重试按钮只在 AI 那块的提示里找：同一区域里终端运营、
  // 服务项目读失败时也各有「重试」，AI 那块读取中自己的按钮暂时不在，按位置取最后一个会点到别的模块。
  // 旧写法两处都踩了：点完重试马上断言「没读到」，看到的是残留的旧提示；下一次点击落到了服务项目的「重试」上。
  const USAGE = '/api/v1/partner/screen/usage?range=7d'
  let phase: 'unavailable' | 'error' | 'ok' = 'unavailable'
  let gate: Promise<void> = Promise.resolve()
  let release: () => void = () => {}
  const hold = () => { gate = new Promise<void>((resolve) => { release = () => resolve() }) }
  const calls = await serve(page, async (url) => {
    if (url.pathname + url.search !== USAGE) return failure(404, 'NOT_FOUND', '没有这个大屏接口')
    if (phase === 'unavailable') return bare(snapshot({ available: false, reason: 'source_query_failed' }))
    await gate
    if (phase === 'error') return { status: 500, body: {} }
    return bare(snapshot(value(0, 5)))
  })
  const usageCalls = () => calls.urls.filter((url) => url === USAGE).length
  await page.goto('/')
  const section = page.getByRole('region', { name: '近 7 天终端运营（截至昨天）' })
  const aiAlert = section.getByRole('alert').filter({ hasText: 'AI 服务情况这次没读到' })
  const aiRetry = aiAlert.getByRole('button', { name: '重试' })
  const loading = section.getByText('正在读取 AI 服务情况')
  const counts = section.getByText(/^AI (简历优化|模拟面试)：/)

  // 切片不可用：只说这次没读到并给重试，不当成 0
  await expect(aiAlert).toBeVisible()
  await expect(counts).toHaveCount(0)
  const size = await aiRetry.boundingBox()
  expect(size && size.width >= 44 && size.height >= 44).toBeTruthy()
  const initial = usageCalls()

  const retryOnce = async (next: 'error' | 'ok') => {
    const before = usageCalls()
    phase = next
    hold()
    await aiRetry.click()
    await expect.poll(usageCalls, '点重试要再发一次 AI 服务请求').toBeGreaterThan(before)
    await expect(loading).toBeVisible()
    await expect(aiAlert).toHaveCount(0)
    release()
    await expect(loading).toHaveCount(0)
  }

  // 请求失败（500）：同样只说这次没读到、还能再重试，不当成 0
  await retryOnce('error')
  await expect(aiAlert).toBeVisible()
  await expect(counts).toHaveCount(0)

  await retryOnce('ok')
  await expect(section.getByText('AI 简历优化：0 次')).toBeVisible()
  await expect(section.getByText('AI 模拟面试：5 场')).toBeVisible()
  await expect(aiAlert).toHaveCount(0)
  await expect(section.getByText(/只统计本机构终端上成功完成/)).toBeVisible()
  expect(usageCalls(), '每点一次重试只再读一次').toBe(initial + 2)
})
