import { test, expect } from '@playwright/test'
import { bare, serve } from './helpers'

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
  // 回话按用例所处阶段给，不按第几次请求给：开发版构建在 StrictMode 下挂载时会请求两次，
  // 页面上其它块的请求时序也会变，按计数回话会让「第几次」错位（CI 上慢机器尤其明显）。
  let phase: 'unavailable' | 'error' | 'ok' = 'unavailable'
  const served = { unavailable: 0, error: 0, ok: 0 }
  await serve(page, () => {
    served[phase] += 1
    if (phase === 'unavailable') return bare(snapshot({ available: false, reason: 'source_query_failed' }))
    if (phase === 'error') return { status: 500, body: {} }
    return bare(snapshot(value(0, 5)))
  })
  await page.goto('/')
  const section = page.getByRole('region', { name: '近 7 天终端运营（截至昨天）' })
  // 重试按钮只在 AI 服务那一块的提示里找：同一区域里终端运营、首单概况读失败时也各有「重试」
  const aiAlert = section.getByRole('alert').filter({ hasText: 'AI 服务情况这次没读到' })
  const loading = section.getByText('正在读取 AI 服务情况')
  await expect(aiAlert).toBeVisible()
  const size = await aiAlert.getByRole('button', { name: '重试' }).boundingBox()
  expect(size && size.width >= 44 && size.height >= 44).toBeTruthy()

  phase = 'error'
  await aiAlert.getByRole('button', { name: '重试' }).click()
  await expect.poll(() => served.error).toBeGreaterThan(0)
  await expect(loading).toHaveCount(0)
  await expect(aiAlert).toBeVisible()

  phase = 'ok'
  await aiAlert.getByRole('button', { name: '重试' }).click()
  await expect.poll(() => served.ok).toBeGreaterThan(0)
  await expect(section.getByText('AI 模拟面试：5 场')).toBeVisible()
  await expect(section.getByText(/只统计本机构终端上成功完成/)).toBeVisible()
})
