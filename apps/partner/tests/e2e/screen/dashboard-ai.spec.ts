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
})

test('工作台 AI 服务：切片不可用可重试；请求失败也可重试', async ({ page }) => {
  let attempt = 0
  await serve(page, () => {
    attempt += 1
    if (attempt === 1) return bare(snapshot({ available: false, reason: 'source_query_failed' }))
    if (attempt === 2) return { status: 500, body: {} }
    return bare(snapshot(value(0, 5)))
  })
  await page.goto('/')
  const section = page.getByRole('region', { name: '近 7 天终端运营（截至昨天）' })
  await expect(section.getByText('AI 服务情况这次没读到')).toBeVisible()
  const retry = section.getByRole('button', { name: '重试' }).last()
  const size = await retry.boundingBox()
  expect(size && size.width >= 44 && size.height >= 44).toBeTruthy()
  await retry.click()
  await expect(section.getByText('AI 服务情况这次没读到')).toBeVisible()
  await retry.click()
  await expect(section.getByText('AI 模拟面试：5 场')).toBeVisible()
  await expect(section.getByText(/只统计本机构终端上成功完成/)).toBeVisible()
})
