import { expect, type Page } from '@playwright/test'

/** 通用诊断可以直接继续，但目标行业、经验、场景不得替本人填入。 */
export async function expectResumeDirectionUnselected(page: Page): Promise<void> {
  const settings = page.locator('.qx-rt-settings')
  await settings.locator('summary').click()
  await expect(settings).toHaveAttribute('open', '')
  await expect(page.getByText('没选方向，按通用标准看', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: /^通用诊断/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(settings.getByRole('button', { name: /^定向诊断/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(settings.getByRole('group', { name: /重点关注维度/ }).getByRole('button', { pressed: true })).toHaveCount(0)
  await expect(settings.getByRole('textbox', { name: '目标岗位' })).toHaveValue('')
  // 诊断页的空值文案是「暂不指定」，面试页才叫「尚未选择」。
  await expect(settings.getByRole('button', { name: '选择行业方向' })).toContainText('暂不指定')
  for (const label of ['经验级别', '求职场景']) {
    const group = settings.getByRole('group', { name: label })
    await expect(group.getByRole('button', { name: '暂不指定', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(group.locator('button:not([data-mute="true"])[aria-pressed="true"]')).toHaveCount(0)
  }
}

export async function chooseGenericResumeDirection(page: Page): Promise<void> {
  await expectResumeDirectionUnselected(page)
  await page.getByRole('button', { name: /^通用诊断/ }).click()
  await page.locator('.qx-rt-settings > summary').click()
}

export async function chooseTargetedResumeDirection(page: Page): Promise<void> {
  await expectResumeDirectionUnselected(page)
  await page.getByRole('button', { name: /^定向诊断/ }).click()
  await page.getByRole('button', { name: '选择行业方向' }).click()
  const dialog = page.getByRole('dialog', { name: '选择行业门类' })
  await expect(dialog.getByText('当前：暂不指定', { exact: true })).toBeVisible()
  await expect(dialog.locator('button[aria-pressed="true"]')).toHaveText('暂不指定')
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '制造业', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: '完成' }).click()
  const experience = page.getByRole('group', { name: '经验级别' })
  await experience.getByRole('button', { name: '1年以内', exact: true }).click()
  await expect(experience.getByRole('button', { name: '1年以内', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.qx-rt-settings > summary').click()
}

export async function expectInterviewDirectionUnselected(page: Page): Promise<void> {
  const setup = page.locator('[data-kiosk-screen="interview-setup"]')
  await expect(setup.locator('.iv-field').filter({ hasText: '行业（必填' }).locator('b')).toHaveText('尚未选择')
  await expect(setup.getByPlaceholder(/输入目标岗位/)).toHaveValue('')
  const experience = setup.locator('.iv-choice').filter({ hasText: '经验（必选）' })
  await expect(experience.locator('.iv-hint')).toHaveText('尚未选择，请按自己的实际情况选择。')
  await expect(experience.getByRole('button')).toHaveCount(6)
  await expect(experience.getByRole('button', { pressed: true })).toHaveCount(0)
}

export async function chooseInterviewExperience(page: Page): Promise<void> {
  const experience = page.locator('.iv-choice').filter({ hasText: '经验（必选）' })
  await expect(experience.locator('.iv-hint')).toHaveText('尚未选择，请按自己的实际情况选择。')
  await expect(experience.getByRole('button', { pressed: true })).toHaveCount(0)
  await experience.getByRole('button', { name: '1-3 年', exact: true }).click()
  await expect(experience.getByRole('button', { name: '1-3 年', exact: true })).toHaveAttribute('aria-pressed', 'true')
}
