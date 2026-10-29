import { expect, test, type Page } from '@playwright/test'
import { openAuthed, settleAdminPage } from './helpers/open'

async function section(page: Page, id = 'org-mock-2') {
  const guards = await openAuthed(page, `/partners?org=${id}`)
  await settleAdminPage(page, guards)
  const area = page.getByRole('region', { name: '软件使用授权' })
  await expect(area).toBeVisible()
  return area
}
function future(days: number) { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

test('演示机构显示宽限和连续有效期', async ({ page }) => {
  const area = await section(page, 'org-mock-1')
  await expect(area).toContainText('宽限期还剩 3 天')
  await expect(area.getByText(/有效期：\d{4}-\d{2}-\d{2} 至 \d{4}-\d{2}-\d{2}（北京时间，含当天）/)).toBeVisible()
  await page.goto('/partners?org=org-mock-2')
  await expect(area).toContainText('当前状态：正常')
  await expect(area).toContainText('连续有效至')
})

test('新建授权校验信用代码并保存', async ({ page }) => {
  const area = await section(page)
  await area.getByRole('button', { name: '新建授权' }).click()
  const form = area.getByRole('form', { name: '新建授权' })
  await form.getByLabel('被授权企业名称').fill('青岛蓝谷数字科技有限公司')
  await form.getByLabel('合同编号').fill('NEW-2028')
  await form.getByLabel('生效日', { exact: true }).fill(future(500))
  await form.getByLabel('最后有效日（含当天）').fill(future(600))
  await form.getByRole('button', { name: '提交' }).click()
  await expect(form.getByText('请填写校验位正确的统一社会信用代码')).toBeVisible()
  await form.getByLabel('统一社会信用代码').fill('91370212MA3T8K2P4X')
  await form.getByRole('button', { name: '提交' }).click()
  await expect(form.getByText('请填写校验位正确的统一社会信用代码')).toBeVisible()
  await expect(form).toBeVisible()
  await expect(area.getByRole('article', { name: '授权 NEW-2028' })).toHaveCount(0)
  await form.getByLabel('统一社会信用代码').fill('91370212MA3T8K2P4T')
  await form.getByRole('button', { name: '提交' }).click()
  await expect(area.getByRole('article', { name: '授权 NEW-2028' }).locator('strong')).toHaveText('待生效')
})

test('续期默认接续并带出企业信息', async ({ page }) => {
  const area = await section(page)
  await area.getByRole('article').first().getByRole('button', { name: '续期' }).click()
  const form = area.getByRole('form', { name: '续期' })
  await expect(form.getByLabel('被授权企业名称')).toHaveValue('青岛蓝谷数字科技有限公司')
  await expect(form.getByLabel('统一社会信用代码')).toHaveValue('91370212MA3T8K2P4T')
  await expect(form.getByText('从原最后有效日的次日起接续')).toBeVisible()
  await form.getByLabel('合同编号').fill('RENEW-2028')
  await form.getByLabel('最后有效日（含当天）').fill(future(360))
  await form.getByRole('button', { name: '提交' }).click()
  await expect(area).toContainText('已录入后续授权')
})

test('暂停校验理由和工单并二次确认，恢复需要理由', async ({ page }) => {
  const area = await section(page)
  await area.getByRole('article').first().getByRole('button', { name: '暂停' }).click()
  const dialog = area.getByRole('dialog', { name: '暂停授权' })
  await dialog.getByLabel('理由').fill('短')
  await dialog.getByLabel('审批工单号').fill('BAD 123')
  await dialog.getByRole('button', { name: '提交' }).click()
  await expect(dialog.getByText('理由须为 2 至 200 字')).toBeVisible()
  await expect(dialog.getByText(/审批工单号须为/)).toBeVisible()
  await dialog.getByLabel('理由').fill('合同核查')
  await dialog.getByLabel('审批工单号').fill('SP-123')
  await dialog.getByRole('button', { name: '提交' }).click()
  await expect(dialog.getByText('请确认暂停这条授权。')).toBeVisible()
  await dialog.getByRole('button', { name: '确认暂停' }).click()
  await expect(area).toContainText('当前状态：已暂停')
  await expect(area.getByRole('article').first()).toContainText('合同核查；审批工单号：SP-123')
  await area.getByRole('article').first().getByRole('button', { name: '恢复' }).click()
  const resume = area.getByRole('dialog', { name: '恢复授权' })
  await resume.getByRole('button', { name: '提交' }).click()
  await expect(resume.getByText('理由须为 2 至 200 字')).toBeVisible()
  await resume.getByLabel('理由').fill('核查完成')
  await resume.getByRole('button', { name: '提交' }).click()
  await expect(area).not.toContainText('当前状态：已暂停')
})

async function revoke(page: Page) {
  const area = page.getByRole('region', { name: '软件使用授权' })
  const row = area.getByRole('article').first()
  await row.getByRole('button', { name: '吊销' }).click()
  const dialog = area.getByRole('dialog', { name: '吊销授权' })
  await expect(dialog.getByText('吊销后不能恢复，也不能再续期或修改')).toBeVisible()
  await dialog.getByLabel('理由').fill('合同终止')
  await dialog.getByLabel('审批工单号').fill('REVOKE-1')
  await dialog.getByRole('button', { name: '提交' }).click()
  await dialog.getByRole('button', { name: '确认吊销' }).click()
  await expect(row).toContainText('已吊销')
  for (const name of ['更正信息', '续期', '暂停', '恢复']) await expect(row.getByRole('button', { name })).toHaveCount(0)
}
test('吊销后不能恢复、续期或更正', async ({ page }) => { await section(page); await revoke(page) })

test('切换授权方式停用确认可取消或继续', async ({ page }) => {
  const area = await section(page)
  await area.getByRole('button', { name: '切换授权方式' }).click()
  let dialog = area.getByRole('dialog', { name: '切换授权方式' })
  await dialog.getByLabel('理由').fill('暂不管控')
  await dialog.getByRole('button', { name: '提交' }).click()
  await revoke(page)
  for (const button of ['取消', '仍要立即停用']) {
    await area.getByRole('button', { name: '切换授权方式' }).click()
    dialog = area.getByRole('dialog', { name: '切换授权方式' })
    await dialog.getByLabel('理由').fill('合同到期')
    await dialog.getByRole('button', { name: '提交' }).click()
    await expect(dialog.getByRole('button', { name: '仍要立即停用' })).toBeVisible()
    await dialog.getByRole('button', { name: button }).click()
    await expect(area).toContainText(button === '取消' ? '授权方式：不管控' : '授权方式：需要授权')
  }
})
