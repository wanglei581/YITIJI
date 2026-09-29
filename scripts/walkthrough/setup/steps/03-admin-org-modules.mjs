// A1 续：机构详情 → 机构档案 → 启用模块勾选「政策服务」→ 保存档案。
// 用法：WALK_ORG=<机构名> WALK_MODULE=政策服务 node run.mjs steps/03-... admin
const ORG = process.env.WALK_ORG ?? '测试·青岛理工大学就业指导中心（走查）'
const MODULE = process.env.WALK_MODULE ?? '政策服务'

export default async ({ page, h }) => {
  await h.goto('/partners')
  await page.locator('tr').filter({ hasText: ORG }).getByRole('button', { name: '详情/账号' }).click()
  const drawer = page.locator('[role=dialog]').filter({ hasText: '机构详情' }).last()
  await drawer.waitFor()
  await h.settle(800)
  const box = drawer.locator('label').filter({ hasText: new RegExp(`^\\s*${MODULE}\\s*$`) }).locator('input[type=checkbox]').first()
  const before = await box.isChecked()
  if (!before) await box.check()
  h.clearNet()
  await drawer.getByRole('button', { name: '保存档案' }).click()
  await h.settle(1200)
  const shot = await h.shot('org-modules-saved')
  const patch = h.net().find((n) => ['PATCH', 'PUT'].includes(n.method))
  await h.log({ action: `机构档案 → 勾选启用模块「${MODULE}」→ 保存档案`, input: ORG, result: `保存前已勾选=${before}；保存请求 ${patch ? patch.method + ' ' + patch.status : '未发出'}；网络错误=${JSON.stringify(h.netErrors())}；页面提示：${(await drawer.innerText()).replace(/\s+/g, ' ').match(/已保存[^。]*|保存失败[^。]*/)?.[0] ?? '无明显提示'}`, screenshot: shot })
}
