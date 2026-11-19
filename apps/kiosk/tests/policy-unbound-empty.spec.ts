import { test, expect } from './fixtures/kiosk-test'
import { registerW4Api } from './fixtures/fusion-w4-api'

const emptyList = {
  success: true,
  data: [],
  pagination: { page: 1, pageSize: 200, total: 0, totalPages: 1 },
}

test('没绑定机构时政策空态写本机还没有运营机构发布的政策 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/policies', { status: 200, json: { ...emptyList, scope: 'unbound' } })
  await page.goto('/renshi')
  await expect(page).toHaveURL((url) => url.pathname === '/policy-service')
  await expect(page.getByRole('heading', { level: 1, name: '本机还没有运营机构发布的政策' })).toBeVisible()
  await expect(page.getByText('本机不自己编写政策，也不拿别处的内容顶替')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '这里还没有发布的政策' })).toHaveCount(0)
})

test('范围缺省的空列表仍用原来的政策空态 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/policies', { status: 200, json: emptyList })
  await page.goto('/renshi')
  await expect(page.getByRole('heading', { level: 1, name: '这里还没有发布的政策' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: '本机还没有运营机构发布的政策' })).toHaveCount(0)
})

test('认不出终端时政策空态同样写本机还没有运营机构发布的政策 @kiosk', async ({ page, api }) => {
  registerW4Api(api)
  api.respond('GET', '/api/v1/policies', { status: 200, json: { ...emptyList, scope: 'missing' } })
  await page.goto('/renshi')
  await expect(page.getByRole('heading', { level: 1, name: '本机还没有运营机构发布的政策' })).toBeVisible()
})
