import { expect, type Page } from '@playwright/test'

/** 通用诊断可以直接继续，但目标行业、经验、场景不得替本人填入。 */
export async function expectResumeDirectionUnselected(page: Page): Promise<void> {
  await expect(page.getByText('没选方向，按通用标准看', { exact: true })).toBeVisible()
  await expect(page.getByTestId('resume-direction-scope')).toHaveText('通用诊断 · 暂不指定')
  await expect(page.getByTestId('resume-direction-dims')).toHaveText('暂不指定')
  await expect(page.getByTestId('resume-direction-target')).toHaveText('暂不指定')
}

export async function chooseGenericResumeDirection(page: Page): Promise<void> {
  const screen = page.locator('[data-kiosk-screen="resume-source"]')
  await expect(screen).toBeVisible()
  // 确认屏（已有文件）不再放「改回通用诊断」。进到这一屏时默认就是通用诊断，
  // 方向按钮只在来源屏。这里核对三行，避免扫描交接后再去点一个不存在的按钮。
  if (await screen.getAttribute('data-screen') === 'summary') {
    await expect(page.getByTestId('resume-direction-scope')).toHaveText('通用诊断 · 暂不指定')
    await expect(page.getByTestId('resume-direction-dims')).toHaveText('暂不指定')
    await expect(page.getByTestId('resume-direction-target')).toHaveText('暂不指定')
    return
  }
  const stay = page.getByRole('button', { name: '先不设方向，按通用诊断' })
  const back = page.getByRole('button', { name: '改回通用诊断' })
  await expect(stay.or(back).first()).toBeVisible()
  if (await stay.count()) {
    await stay.click()
    await expectResumeDirectionUnselected(page)
    return
  }
  await back.click()
  await expect(page.getByTestId('resume-direction-scope')).toHaveText('通用诊断 · 暂不指定')
  await expect(page.getByTestId('resume-direction-dims')).toHaveText('暂不指定')
  await expect(page.getByTestId('resume-direction-target')).toHaveText('暂不指定')
}

export async function chooseTargetedResumeDirection(page: Page): Promise<void> {
  await expectResumeDirectionUnselected(page)
  await page.getByRole('button', { name: '设置诊断方向与目标背景' }).click()
  await page.getByRole('button', { name: /^定向诊断/ }).click()
  await page.getByRole('button', { name: '下一步：设目标岗位与背景' }).click()
  await page.getByRole('button', { name: '制造业', exact: true }).click()
  const experience = page.getByRole('group', { name: '经验' })
  await experience.getByRole('button', { name: '1年以内', exact: true }).click()
  await expect(experience.getByRole('button', { name: '1年以内', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '用这些设置，去取文件' }).click()
  await expect(page.getByTestId('resume-direction-target')).toContainText('制造业')
  await expect(page.getByTestId('resume-direction-target')).toContainText('1年以内')
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
