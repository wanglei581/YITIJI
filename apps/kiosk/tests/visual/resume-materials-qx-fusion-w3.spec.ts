import { test, expect } from '../fixtures/kiosk-test'
import { registerTouchShell } from './fixtures/touch-pair-shell'

// 2026-11-08 产品负责人只留四核心；源码保留。页内流程用例已删，重新开放时从 10a063775 的本文件取回（那一版含 B8 ① 的改动，比 42e945e76 新）。
test('/resume/materials 旧地址回首页 @w3-kiosk', async ({ page, api }) => {
  registerTouchShell(api)
  await page.goto('/resume/materials?old=1#saved')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('qx-home')).toBeVisible()
})
