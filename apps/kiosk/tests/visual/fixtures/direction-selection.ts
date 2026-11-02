import { expect, type Page } from '@playwright/test'

/** 诊断方向在来源页的第二步。没有文件时主按钮停在「请先上传简历文件」，这里不代传文件。文件刚选上、上传还没画完时，等到「下一步」可点再进。 */
export async function openResumeDirection(page: Page): Promise<void> {
  const start = page.getByRole('button', { name: '开始 AI 诊断', exact: true })
  const optimize = page.getByRole('button', { name: '上传并生成优化建议', exact: true })
  const next = page.getByRole('button', { name: '下一步：诊断方向', exact: true })
  const empty = page.getByRole('button', { name: '请先上传简历文件', exact: true })
  await expect(async () => {
    const ready = await start.isVisible().catch(() => false)
      || await optimize.isVisible().catch(() => false)
      || await next.isVisible().catch(() => false)
      || await empty.isVisible().catch(() => false)
    expect(ready).toBe(true)
  }).toPass()
  if (await start.isVisible().catch(() => false) || await optimize.isVisible().catch(() => false)) return
  const queued = await page.getByLabel('选择本机简历文件').evaluate((el: HTMLInputElement) => (el.files?.length ?? 0) > 0).catch(() => false)
  if (queued) {
    await expect(next).toBeEnabled()
    await next.click()
    await expect(page.locator('[data-kiosk-screen="resume-source"][data-resume-step="direction"]')).toBeVisible()
    return
  }
  if (await empty.isVisible().catch(() => false)) return
  if (!(await next.isEnabled().catch(() => false))) return
  await next.click()
  await expect(page.locator('[data-kiosk-screen="resume-source"][data-resume-step="direction"]')).toBeVisible()
}

export async function startResumeDiagnosis(page: Page): Promise<void> {
  await openResumeDirection(page)
  await page.getByRole('button', { name: '开始 AI 诊断', exact: true }).click()
}

export async function startResumeOptimize(page: Page): Promise<void> {
  await openResumeDirection(page)
  await page.getByRole('button', { name: '上传并生成优化建议', exact: true }).click()
}

/** 通用诊断可以直接继续，但目标行业、经验、场景不得替本人填入。查完停在方向步。 */
export async function expectResumeDirectionUnselected(page: Page): Promise<void> {
  await openResumeDirection(page)
  const settings = page.locator('[data-qx-page="resume-direction"]')
  await expect(page.getByText('按通用标准看，可以吗？', { exact: true })).toBeVisible()
  await expect(settings.getByRole('button', { name: /^通用诊断/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(settings.getByRole('button', { name: /^定向诊断/ })).toHaveAttribute('aria-pressed', 'false')
  await settings.getByRole('button', { name: /^定向诊断/ }).click()
  await expect(settings.getByRole('group', { name: /重点关注维度/ }).getByRole('button', { pressed: true })).toHaveCount(3)
  await expect(settings.getByRole('textbox', { name: '目标岗位' })).toHaveValue('')
  // 诊断页的空值文案是「暂不指定」，面试页才叫「尚未选择」。
  await expect(settings.getByRole('button', { name: '选择行业方向' })).toContainText('暂不指定')
  await page.getByRole('button', { name: '更多条件（可不填）' }).click()
  for (const label of ['经历', '场景']) {
    const group = page.getByRole('group', { name: label })
    await expect(group.getByRole('button', { name: '暂不指定', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(group.locator('button:not([data-mute="true"])[aria-pressed="true"]')).toHaveCount(0)
  }
  await page.getByRole('button', { name: '好了，回去开始诊断', exact: true }).click()
  await expect(page.locator('[data-kiosk-screen="resume-source"][data-resume-step="direction"]')).toBeVisible()
  await page.getByRole('button', { name: /^通用诊断/ }).click()
  await expect(page.getByText('按通用标准看，可以吗？', { exact: true })).toBeVisible()
}

/** 选完通用诊断后回到「简历在哪里」，U 盘和预览仍能看见文件区。没有文件时主按钮是「请先上传简历文件」，这一步还不存在，不能代传。刚从别的页换过来时按钮还没画上，先等到它出现再判断。 */
export async function chooseGenericResumeDirection(page: Page): Promise<void> {
  const empty = page.getByRole('button', { name: '请先上传简历文件', exact: true })
  const next = page.getByRole('button', { name: '下一步：诊断方向', exact: true })
  const start = page.getByRole('button', { name: '开始 AI 诊断', exact: true })
  const optimize = page.getByRole('button', { name: '上传并生成优化建议', exact: true })
  await expect(async () => {
    const ready = await empty.isVisible().catch(() => false)
      || await next.isVisible().catch(() => false)
      || await start.isVisible().catch(() => false)
      || await optimize.isVisible().catch(() => false)
    expect(ready).toBe(true)
  }).toPass()
  if (await empty.isVisible().catch(() => false)) return
  if (await next.isVisible().catch(() => false) && await next.isDisabled().catch(() => false)) return
  await expectResumeDirectionUnselected(page)
  await page.getByRole('button', { name: /^通用诊断/ }).click()
  await page.locator('.qxt-dock').getByRole('button', { name: '返回', exact: true }).click()
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
  await page.getByRole('button', { name: '更多条件（可不填）' }).click()
  const experience = page.getByRole('group', { name: '经历' })
  await experience.getByRole('button', { name: '1年以内', exact: true }).click()
  await expect(experience.getByRole('button', { name: '1年以内', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '好了，回去开始诊断', exact: true }).click()
  await page.locator('.qxt-dock').getByRole('button', { name: '返回', exact: true }).click()
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

/** 触屏版设置分三步。岗位、行业、经验在第 1 步；面试官在第 2 步；「创建并开始练习」在第 3 步。 */
export async function advanceInterviewSetupToStart(page: Page): Promise<void> {
  const next = page.getByRole('button', { name: '下一步', exact: true })
  await next.click()
  await expect(page.getByRole('button', { name: 'HR 面试', exact: true })).toBeVisible()
  await expect(page.getByText('HR 初筛')).toHaveCount(0)
  await next.click()
  await expect(page.getByRole('button', { name: '创建并开始练习' })).toBeVisible()
}

export async function chooseInterviewExperience(page: Page): Promise<void> {
  const experience = page.locator('.iv-choice').filter({ hasText: '经验（必选）' })
  await expect(experience.locator('.iv-hint')).toHaveText('尚未选择，请按自己的实际情况选择。')
  await expect(experience.getByRole('button', { pressed: true })).toHaveCount(0)
  await experience.getByRole('button', { name: '1-3 年', exact: true }).click()
  await expect(experience.getByRole('button', { name: '1-3 年', exact: true })).toHaveAttribute('aria-pressed', 'true')
}
