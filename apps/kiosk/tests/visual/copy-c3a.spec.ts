import { expect, test } from '../fixtures/kiosk-test'
import { COPY_CONTROL, copyFixture } from './fixtures/copy-c3a'

const legal = '不得复印伪造的证件、印章、票据。只能复印本人的真实证件和票据。'
const fine = '原件几页，扫完才知道；扫完会给你核对'
const clickable = '.cc-way:enabled, .cc-source:enabled, .cc-step button:enabled, .cc-segment button:enabled, .qxt-dock button:enabled'

for (const [stage, title, count] of [
  ['', '怎么复印？', 4], ['set', '放好原件，选份数', 13], ['off', '这台机器暂时只能在打印机面板上复印', 4],
] as const) {
  test(`${stage || 'how'} title, actions, touch sizes and draft screenshot @w2`, async ({ page, api }) => {
    const f = await copyFixture(page, api)
    await f.goto(stage)
    const screen = page.getByTestId(`copy-${stage || 'how'}`)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    if (stage === 'set') {
      await expect(page.getByTestId('copy-primary')).toBeEnabled()
      await page.getByRole('button', { name: '多一份', exact: true }).click()
      await expect(page.getByText(fine, { exact: true })).toBeVisible()
    }
    await expect(screen.locator(clickable)).toHaveCount(count)
    if (!stage) {
      await expect(screen.locator('.cc-way').first()).toContainText('在打印机面板上快速复印')
      await expect(page.getByText(legal, { exact: true })).toBeVisible()
      await expect(page.getByTestId('copy-primary')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '问小青：怎么复印更合适', exact: true })).toBeVisible()
    }
    if (stage === 'off') {
      await expect(page.getByTestId('copy-primary')).toHaveText('怎么在打印机上复印')
      await expect(screen.locator('.cc-way').first()).toBeDisabled()
      await expect(page.getByRole('button', { name: '问小青：面板上怎么复印', exact: true })).toBeVisible()
    }
    for (const button of await screen.locator('button:enabled').all()) {
      const box = await button.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(48)
      expect(box!.width).toBeGreaterThanOrEqual(48)
      expect(await button.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(20)
    }
    if (stage) expect((await page.getByTestId('copy-primary').boundingBox())!.height).toBeGreaterThanOrEqual(56)
    await page.screenshot({ path: `test-results/copy-c3a-${stage || 'how'}.png` })
    expect(f.calls).toHaveLength(0)
  })
}

test('hub enters how; first card retains the existing illustrated panel guide @w2', async ({ page, api }) => {
  await copyFixture(page, api)
  await page.goto('/print-scan')
  await page.getByTestId('print-hub-copy-note').click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy-screen$/)
  await page.locator('.cc-way').first().click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
  await expect(page.getByTestId('print-hub-copy-steps')).toBeVisible()
})
for (const button of ['card', 'primary']) test(`off ${button} opens the panel guide @w2`, async ({ page, api }) => {
  const f = await copyFixture(page, api)
  await f.goto('off')
  await (button === 'card' ? page.locator('.cc-way').last() : page.getByTestId('copy-primary')).click()
  await expect(page).toHaveURL(/\/print-scan\/feature\/copy$/)
})
for (const key of ['copy', 'scan'] as const) test(`${key} closed disables how and rejects a set deep link to off @w2`, async ({ page, api }) => {
  const f = await copyFixture(page, api, { [key]: false })
  await f.goto()
  await expect(page.locator('.cc-way').last()).toBeDisabled()
  await expect(page.locator('.cc-way').last()).toContainText('这台机器还没开通屏上复印')
  await f.goto('set')
  await expect(page.getByTestId('copy-off')).toBeVisible()
  expect(f.calls).toHaveLength(0)
})
test('unopened color and duplex are grey and explain why; defaults stay black-white simplex @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api, { color: false, duplex: false })
  await f.goto('set')
  for (const label of ['彩色', '双面']) {
    const option = page.getByRole('button', { name: new RegExp(`${label}.*本机暂未开通`) })
    await expect(option).toBeDisabled()
  }
  await page.getByTestId('copy-primary').click()
  await expect.poll(() => f.calls.length).toBe(1)
  expect(f.calls[0].body).toMatchObject({ colorMode: 'black_white', duplex: 'simplex' })
})
test('stepper clamps 1–99 and disables the two outward steps @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api)
  await f.goto('set')
  for (const name of ['少十份', '少一份']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '多十份', exact: true }).click()
  await expect(page.getByTestId('copy-count')).toHaveText('99份')
  for (const name of ['多十份', '多一份']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '少十份', exact: true }).click()
  await expect(page.getByTestId('copy-count')).toHaveText('1份')
})
test('create sends real DTO, terminal auth, no member required; secrets never persist or enter URL @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api)
  await f.goto('set')
  await page.getByRole('button', { name: /^进纸器/ }).click()
  await page.getByRole('button', { name: '多一份', exact: true }).click()
  await page.getByRole('button', { name: '彩色', exact: true }).click()
  await page.getByRole('button', { name: '双面', exact: true }).click()
  await page.getByTestId('copy-primary').dblclick()
  await expect(page.getByTestId('copy-c3b-entry')).toBeVisible()
  expect(f.calls).toHaveLength(1)
  const call = f.calls[0]
  expect(call.path).toBe('/api/v1/copy/jobs')
  expect(call.body).toEqual({ terminalId: 'KSK-001', requestKey: expect.stringMatching(/^[\w-]{16,128}$/), source: 'feeder', copies: 2, colorMode: 'color', duplex: 'duplex_long_edge' })
  expect(call.headers['x-terminal-id']).toBe('KSK-001')
  expect(call.headers['x-terminal-session-token']).toBe('playwright-terminal-session-fixture')
  expect(call.headers.authorization).toBeUndefined()
  expect(call.headers['x-copy-control']).toBeUndefined()
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }))).not.toContain(COPY_CONTROL)
  await expect(page.getByText('正在扫原件', { exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('copy-how')).toBeVisible()
  expect(f.calls).toHaveLength(1)
})
for (const fail of [409, 413] as const) test(`create ${fail} uses off or the standard limit sentence @w2`, async ({ page, api }) => {
  const f = await copyFixture(page, api, { fail })
  await f.goto('set')
  await page.getByTestId('copy-primary').click()
  await expect(page.getByTestId(fail === 409 ? 'copy-off' : 'copy-set')).toBeVisible()
  if (fail === 413) await expect(page.locator('.cc-note[role="status"]')).toHaveText('这一次超过了这台机器能收的大小。这次先停在这里。')
  expect(f.calls).toHaveLength(1)
})
test('missing one-time token blocks a second create @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api, { missingToken: true })
  await f.goto('set')
  await page.getByTestId('copy-primary').click()
  await expect(page.getByText(/没能确认复印能否继续/)).toBeVisible()
  await expect(page.getByTestId('copy-primary')).toBeDisabled()
  expect(f.calls).toHaveLength(1)
})
for (const mode of ['leave', 'idle', 'logout'] as const) test(`${mode} clears the in-memory session and token @w2`, async ({ page, api }) => {
  // 闲置提醒的计时器在进页面时就建立，登出这一支要在进页面之前装好假时钟，runFor 才推得动它。
  if (mode === 'logout') await page.clock.install()
  const f = await copyFixture(page, api)
  await f.goto('set')
  await page.getByTestId('copy-primary').click()
  await expect(page.getByTestId('copy-c3b-entry')).toBeVisible()
  if (mode === 'idle') {
    await page.clock.install()
    await page.clock.fastForward(181_000)
  } else if (mode === 'logout') {
    // 通过真实闲置提醒结束游客使用；全局清令牌行为另由 Node 测试直接验证。
    // 结束使用后回到首页会拉岗位与招聘会面板，本夹具不关心内容，给空表。
    api.respondWith('GET', '/api/v1/job-fairs', () => ({ status: 200, json: { success: true, data: { items: [], total: 0 } } }))
    api.respondWith('GET', '/api/v1/jobs', () => ({ status: 200, json: { success: true, data: { items: [], total: 0 } } }))
    await page.clock.runFor(151_000)
    await page.getByTestId('session-guard-clear').click()
  } else await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByTestId('copy-c3b-entry')).toHaveCount(0)
  if (mode !== 'logout') {
    // 登出这一支在假时钟下回到首页，再进复印区由离开、闲置两支覆盖；它只核会话与令牌已清。
    await page.goto('/print-scan/feature/copy-screen?stage=scan')
    await expect(page.getByTestId('copy-how')).toBeVisible()
    await expect(page.getByTestId('copy-c3b-entry')).toHaveCount(0)
  }
  expect(f.calls).toHaveLength(1)
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(COPY_CONTROL)
})
test('unknown create retries with the same requestKey and settings @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api)
  api.respondWith('POST', '/api/v1/copy/jobs', (n) => n === 1 ? { abort: 'connectionrefused' } : { status: 200, json: { success: true, data: f.receipt } })
  await f.goto('set')
  await page.getByTestId('copy-primary').click()
  await expect(page.getByText(/这一步的结果还没确认/)).toBeVisible()
  await page.getByTestId('copy-primary').click()
  await expect(page.getByTestId('copy-c3b-entry')).toBeVisible()
  expect(f.calls).toHaveLength(2)
  expect(f.calls[1].body).toEqual(f.calls[0].body)
})

for (const options of [{ printer: 'offline' }, { probe: 'busy' }, { probe: 'unknown' }]) {
  test(`unready printer or probe blocks start ${JSON.stringify(options)} @w2`, async ({ page, api }) => {
    const f = await copyFixture(page, api, options)
    await f.goto('set')
    await expect(page.getByTestId('copy-primary')).toBeDisabled()
    if (options.printer) await expect(page.getByTestId('copy-primary')).toHaveText('打印机离线')
    await expect(page.locator('.cc-note[role="status"]')).toContainText(/离线|状态|正忙|正在检查/)
    expect(f.calls).toHaveLength(0)
  })
}
test('capability read failure stays fail-closed without claiming it was confirmed unopened @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api)
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', { status: 503, json: {} })
  await f.goto()
  await expect(page.locator('.cc-way').last()).toBeDisabled()
  await expect(page.locator('.cc-way').last()).toContainText('屏上复印能力暂时无法确认，请先用面板复印')
  expect(f.calls).toHaveLength(0)
})
test('without a service phone off does not invent a number or say panel works when offline @w2', async ({ page, api }) => {
  const f = await copyFixture(page, api, { noPhone: true, printer: 'offline' })
  await f.goto('off')
  await expect(page.getByTestId('service-phone-line')).toHaveCount(0)
  await expect(page.getByText('面板上的复印、身份证复印、票据复印都能用。', { exact: true })).toHaveCount(0)
})
