import { test, expect } from '../fixtures/kiosk-test'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../fixtures/api-router'
import { interviewCreated, interviewStarted, interviewAnswered, interviewReport } from './fixtures/fusion-w3-states'
import { expectInterviewDirectionUnselected, chooseInterviewExperience } from './fixtures/direction-selection'

const clockTime = new Date('2026-10-10T00:00:00.000Z')
const sessionPath = '/api/v1/mock-interviews/interview-w3-public-fixture'
const timing = {
  startedAt: '2026-10-10T00:00:30.000Z',
  serverNow: '2026-10-10T00:00:30.000Z',
  deadlineAt: '2026-10-10T00:03:20.000Z',
  timeUp: false,
}

function baseline(api: ApiRouter, startTiming = {}, detailTiming = {}): void {
  api.respond('GET', '/api/v1/health', { status: 200, json: { status: 'ok' } })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200, json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('POST', '/api/v1/mock-interviews', { status: 200, json: interviewCreated })
  api.respond('POST', `${sessionPath}/start`, {
    status: 200, json: { data: { ...interviewStarted.data, ...startTiming } },
  })
  api.respond('GET', sessionPath, { status: 200, json: { data: { sessionId: interviewCreated.data.sessionId, ...detailTiming } } })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200, json: { data: { asrEnabled: false, ttsEnabled: false } },
  })
}

async function startThreeMinutes(page: Page, voice = false): Promise<void> {
  // 固定并暂停页面时钟，创建过程和断言都不消耗真实等待时间。
  await page.clock.install({ time: clockTime })
  // 装上时钟到暂停之间真实时间会走几毫秒，暂停点留一秒余量，免得「往回拨」报错。
  await page.clock.pauseAt(new Date(clockTime.getTime() + 1_000))
  await page.goto('/interview/setup')
  await expectInterviewDirectionUnselected(page)
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await chooseInterviewExperience(page)
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  if (voice) await page.getByRole('button', { name: '语音回合（文字兜底）', exact: true }).click()
  await page.getByRole('button', { name: '3 分钟', exact: true }).click()
  await page.getByRole('button', { name: '创建并开始练习' }).click()
  await page.waitForURL(/\/interview\?stage=session/)
}

/**
 * 推进页面时钟。一体机普通页 180 秒没人碰就会出「还在用吗」并清场，
 * 一口气快进三分钟撞上的是那条闲置计时，不是面试截止。这里每段不超过 60 秒，
 * 段前按一下键代表人还在；各段加起来与入参一毫秒不差。
 */
async function advance(page: Page, ms: number): Promise<void> {
  let left = ms
  while (left > 0) {
    const step = Math.min(left, 60_000)
    await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })) })
    await page.clock.fastForward(step)
    left -= step
  }
}

function remainingCell(page: Page) {
  return page.getByRole('region', { name: '本场作答状态' }).locator('div').filter({
    has: page.getByText('剩余时间', { exact: true }),
  })
}

test('按截止时刻走，跳过六十五秒后屏上为 1:55 @mic-kiosk', async ({ page, api }) => {
  baseline(api)
  await startThreeMinutes(page)
  await expect(remainingCell(page)).toContainText('3:00')
  await advance(page, 65_000)
  await expect(remainingCell(page)).toContainText('1:55')
})

test('离开四十秒再进作答页，屏上为 1:15 @mic-kiosk', async ({ page, api }) => {
  baseline(api)
  await startThreeMinutes(page)
  await advance(page, 65_000)
  await expect(remainingCell(page)).toContainText('1:55')
  await page.goto('/interview?stage=tips')
  await expect(page.locator('[data-interview-stage="tips"]')).toBeVisible()
  await advance(page, 40_000)
  await page.goto('/interview?stage=session')
  await expect(remainingCell(page)).toContainText('1:15')
})

test('start 使用服务端剩余时长，钟快三十秒仍显示 2:50 @mic-kiosk', async ({ page, api }) => {
  // 详情接口不带时间，避免 start 没读时间却被挂载后的校准掩盖。
  baseline(api, timing)
  await startThreeMinutes(page)
  await expect(remainingCell(page)).toContainText('2:50')
})

test('挂载后详情接口可静默校准本机截止时刻 @mic-kiosk', async ({ page, api }) => {
  baseline(api, {}, timing)
  await startThreeMinutes(page)
  await expect(remainingCell(page)).toContainText('2:50')
  await advance(page, 65_000)
  await expect(remainingCell(page)).toContainText('1:45')
})

test('详情接口失败保留本机场次倒计时 @mic-kiosk', async ({ page, api }) => {
  baseline(api)
  api.respond('GET', sessionPath, { status: 503, json: { error: { code: 'UNAVAILABLE' } } })
  await startThreeMinutes(page)
  await advance(page, 65_000)
  await expect(remainingCell(page)).toContainText('1:55')
  await expect(page.getByRole('textbox')).toBeVisible()
})

const deadlineNotice = '练习时间到了，这一场已自动结束。报告只算到点前已经提交的回答。'
const warning = '还剩不到 1 分钟。到点会自动结束这一场，没提交的回答不算进报告。'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function reportBaseline(api: ApiRouter) {
  baseline(api)
  api.respond('POST', `${sessionPath}/answer`, { status: 200, json: interviewAnswered })
  api.respond('GET', `${sessionPath}/report`, { status: 200, json: interviewReport })
  const end = deferred<{ status: number; json: unknown }>()
  api.respondWith('POST', `${sessionPath}/end`, () => end.promise)
  return end
}

async function submitOne(page: Page, api: ApiRouter) {
  await page.getByRole('textbox', { name: '本题回答' }).fill('我完成了真实项目并复核结果。')
  await page.locator('.interview-session__text-grid').getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.getByText(interviewAnswered.data.question, { exact: true }).first()).toBeVisible()
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(1)
}

async function expectPending(page: Page, api: ApiRouter, answerCount: number, endCount = 1) {
  await expect(page.getByRole('heading', { name: '本场结束后，正在生成报告。' })).toBeVisible()
  await expect(page.getByText(deadlineNotice, { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(answerCount)
  await expect.poll(() => api.requestCount('POST', `${sessionPath}/end`)).toBe(endCount)
}

async function releaseReport(page: Page, end: ReturnType<typeof reportBaseline>) {
  end.resolve({ status: 200, json: interviewReport })
  await page.waitForURL(/stage=report/)
  await expect(page.getByText(interviewReport.data.report.overall.summary, { exact: true }).first()).toBeVisible()
}

async function fakeRecording(page: Page, api: ApiRouter, delayPermission = false) {
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200, json: { data: { asrEnabled: true, ttsEnabled: false } },
  })
  // 沿用 mic-capability 的 navigator.mediaDevices 覆写；补 AudioContext 让真实 WAV 录音器走完。
  await page.addInitScript((delayPermission) => {
    const local = window as unknown as { __grantMic: () => void; __micStops: number }
    local.__micStops = 0
    const stream = { getTracks: () => [{ stop() { local.__micStops += 1 } }] }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'fake', label: 'fake', groupId: 'fake' }],
      getUserMedia: () => delayPermission
        ? new Promise((resolve) => { local.__grantMic = () => resolve(stream) })
        : Promise.resolve(stream),
      addEventListener() {}, removeEventListener() {},
    } })
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } })
    class FakeAudioContext {
      sampleRate = 16000
      destination = {}
      createMediaStreamSource() { return { connect() {}, disconnect() {} } }
      createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null } }
      close() { return Promise.resolve() }
    }
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
  }, delayPermission)
}

async function beginRecording(page: Page) {
  await page.getByRole('button', { name: '开始回答（语音）', exact: true }).click()
  await expect(page.getByText('作答中 · 语音录制', { exact: true })).toBeVisible()
}

test('A2-1 已提交回答空闲到点，自动出报告 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await startThreeMinutes(page)
  await submitOne(page, api)
  await advance(page, 180_000)
  await expectPending(page, api, 1)
  await releaseReport(page, end)
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(1)
})

test('A2-2 未提交草稿到点不发送 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await startThreeMinutes(page)
  await submitOne(page, api)
  await page.getByRole('textbox', { name: '本题回答' }).fill('这段草稿不能被提交')
  await advance(page, 180_000)
  await expectPending(page, api, 1)
  await releaseReport(page, end)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(1)
})

test('A2-3 录音到点直接丢弃，不转写 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await fakeRecording(page, api)
  await startThreeMinutes(page, true)
  await advance(page, 170_000)
  await beginRecording(page)
  await advance(page, 10_000)
  await expectPending(page, api, 0)
  expect(api.requestCount('POST', `${sessionPath}/transcribe`)).toBe(0)
  // 到点那一刻就要松开麦克风：收尾屏盖着页面，录音还开着的话用户看不出来。
  expect(await page.evaluate(() => (window as unknown as { __micStops: number }).__micStops)).toBe(1)
  await releaseReport(page, end)
  expect(api.requestCount('POST', `${sessionPath}/transcribe`)).toBe(0)
})

for (const failed of [false, true]) {
  test(`A2-4 转写挂起时到点，迟到${failed ? '失败' : '成功'}不进确认框 @mic-kiosk`, async ({ page, api }) => {
    const end = reportBaseline(api)
    const transcript = deferred<{ status: number; json: unknown }>()
    const settled = deferred<void>()
    await fakeRecording(page, api)
    api.respondWith('POST', `${sessionPath}/transcribe`, async () => {
      const result = await transcript.promise
      settled.resolve()
      return result
    })
    await startThreeMinutes(page, true)
    await beginRecording(page)
    await page.getByRole('button', { name: /^结束回答并转写/ }).click()
    await expect(page.getByText('作答中 · 语音回答', { exact: true })).toBeVisible()
    await expect.poll(() => api.requestCount('POST', `${sessionPath}/transcribe`)).toBe(1)
    await advance(page, 180_000)
    await expectPending(page, api, 0)
    const response = page.waitForResponse(`${sessionPath}/transcribe`)
    transcript.resolve(failed ? { status: 503, json: { error: { code: 'ASR_FAILED', message: '迟到转写失败' } } } : { status: 200, json: { data: { text: '迟到转写内容' } } })
    await settled.promise
    await response
    await expectPending(page, api, 0)
    await expect(page.getByText('转写结果（可编辑，确认后提交）')).toHaveCount(0)
    await expect(page.getByText('迟到转写失败', { exact: true })).toHaveCount(0)
    await releaseReport(page, end)
    expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(0)
  })
}

test('A2-5 转写确认框到点不提交 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await fakeRecording(page, api)
  api.respond('POST', `${sessionPath}/transcribe`, { status: 200, json: { data: { text: '尚未确认的文字' } } })
  await startThreeMinutes(page, true)
  await beginRecording(page)
  await page.getByRole('button', { name: /^结束回答并转写/ }).click()
  await expect(page.getByText('转写结果（可编辑，确认后提交）')).toBeVisible()
  await advance(page, 180_000)
  await expectPending(page, api, 0)
  expect(api.requestCount('POST', `${sessionPath}/transcribe`)).toBe(1)
  await releaseReport(page, end)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(0)
})

for (const failed of [false, true]) {
  test(`A2-6 回答挂起到点，等${failed ? '失败' : '下一题'}回包后才 end @mic-kiosk`, async ({ page, api }) => {
    const end = reportBaseline(api)
    const answer = deferred<{ status: number; json: unknown }>()
    const order: string[] = []
    api.respondWith('POST', `${sessionPath}/answer`, async () => {
      order.push('answer-request')
      const result = await answer.promise
      order.push('answer-reply')
      return result
    })
    api.respondWith('POST', `${sessionPath}/end`, () => { order.push('end-request'); return end.promise })
    await startThreeMinutes(page)
    await page.getByRole('textbox', { name: '本题回答' }).fill('在到点之前提交的回答')
    await page.locator('.interview-session__text-grid').getByRole('button', { name: '提交回答', exact: true }).click()
    await expect.poll(() => api.requestCount('POST', `${sessionPath}/answer`)).toBe(1)
    await advance(page, 180_000)
    await expectPending(page, api, 1, 0)
    answer.resolve(failed ? { status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } } : { status: 200, json: interviewAnswered })
    await expect.poll(() => order).toEqual(['answer-request', 'answer-reply', 'end-request'])
    await expectPending(page, api, 1)
    await expect(page.getByText(interviewAnswered.data.question, { exact: true })).toHaveCount(0)
    await expect(page.getByText('提交失败', { exact: false })).toHaveCount(0)
    await releaseReport(page, end)
  })
}

test('A2-7 零回答到点只有说明，重新练习回设置 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await startThreeMinutes(page)
  await advance(page, 180_000)
  await expectPending(page, api, 0)
  end.resolve({ status: 400, json: { error: { code: 'INTERVIEW_NO_ANSWERS' } } })
  await expect(page.getByRole('heading', { name: '练习时间到了，这一场没有记下回答。' })).toBeVisible()
  await expect(page.getByText('没有记下的回答就没有报告。可以再练一场，或直接离开。').first()).toBeVisible()
  await expect(page.getByTestId('interview-time-up')).toHaveAttribute('data-time-up-variant', 'no-answers')
  await expect(page.getByRole('button', { name: '继续答题' })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  const restart = page.getByRole('button', { name: '再练一场', exact: true })
  expect((await restart.boundingBox())!.height).toBeGreaterThanOrEqual(56)
  await restart.click()
  await page.waitForURL(/stage=setup/)
  await expect(page.getByPlaceholder(/输入目标岗位/)).toBeVisible()
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(1)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(0)
})

for (const saved of [false, true]) {
  test(`A2-8 报告失败可重试，已保存提示${saved ? '有' : '无'} @mic-kiosk`, async ({ page, api }) => {
    const end = reportBaseline(api)
    await startThreeMinutes(page)
    if (saved) await submitOne(page, api)
    await advance(page, 180_000)
    await expectPending(page, api, saved ? 1 : 0)
    end.resolve({ status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
    await expect(page.getByRole('heading', { name: '练习时间到了，报告还没生成。' })).toBeVisible()
    const copy = saved ? '这一场已结束。报告现在生成不了，你的回答已保存，可以再试一次。' : '这一场已结束。报告现在生成不了，可以再试一次。'
    await expect(page.getByText(copy, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '继续答题' })).toHaveCount(0)
    const retry = deferred<{ status: number; json: unknown }>()
    api.respondWith('POST', `${sessionPath}/end`, () => retry.promise)
    await page.getByRole('button', { name: '再试一次生成报告', exact: true }).click()
    await expectPending(page, api, saved ? 1 : 0, 2)
    await releaseReport(page, retry)
    expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(2)
  })
}

test('A2-9 61 秒无提醒、60 秒提醒及警示样式 @mic-kiosk', async ({ page, api }) => {
  reportBaseline(api)
  await startThreeMinutes(page)
  await advance(page, 119_000)
  await expect(remainingCell(page)).toContainText('1:01')
  await expect(page.getByText(warning, { exact: true })).toHaveCount(0)
  await advance(page, 1000)
  await expect(page.getByText(warning, { exact: true })).toBeVisible()
  // 提醒要在第一屏里：排到页面下方、得往上滑才看得到的提醒等于没提醒。
  await expect(page.getByTestId('interview-deadline-warning')).toBeInViewport({ ratio: 1 })
  await expect(remainingCell(page).locator('b')).toHaveClass('off')
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(0)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(0)
})

test('A2-10 过点重进直接收尾，不闪作答框 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await startThreeMinutes(page)
  await page.goto('/interview?stage=tips')
  await expect(page.locator('[data-interview-stage="tips"]')).toBeVisible()
  await advance(page, 181_000)
  await page.addInitScript(() => {
    // 从首个 DOM mutation 开始记输入框，避免仅检查最终状态漏掉闪现。
    let seen = false
    Object.defineProperty(window, '__sawAnswerBox', { get: () => seen })
    new MutationObserver(() => { if (document.querySelector('textarea[aria-label="本题回答"]')) seen = true }).observe(document, { childList: true, subtree: true })
  })
  await page.goto('/interview?stage=session')
  await expectPending(page, api, 0)
  expect(await page.evaluate(() => (window as unknown as { __sawAnswerBox: boolean }).__sawAnswerBox)).toBe(false)
  await releaseReport(page, end)
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(1)
})

for (const timeUp of [false, true]) {
  test(`A2-11 服务端${timeUp ? '收下回答并回 timeUp' : '409 到点错误'}先于本机到点 @mic-kiosk`, async ({ page, api }) => {
    const end = reportBaseline(api)
    api.respond('POST', `${sessionPath}/answer`, timeUp
      // 约定第 6 条：过点那条回答后端只存不出题，回 done 加 timeUp，没有 question。
      ? { status: 200, json: { data: { done: true, timeUp: true, questionIndex: 1, questionTarget: interviewAnswered.data.questionTarget } } }
      : { status: 409, json: { error: { code: 'INTERVIEW_DEADLINE_REACHED', message: '提交失败' } } })
    await startThreeMinutes(page)
    await expect(remainingCell(page)).toContainText('3:00')
    await page.getByRole('textbox', { name: '本题回答' }).fill('在本机到点之前提交')
    await page.locator('.interview-session__text-grid').getByRole('button', { name: '提交回答', exact: true }).click()
    await expectPending(page, api, 1)
    await expect(page.getByText('提交失败', { exact: false })).toHaveCount(0)
    await expect(page.getByText(interviewAnswered.data.question, { exact: true })).toHaveCount(0)
    await releaseReport(page, end)
    expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(1)
  })
}

test('A2-12 手动结束保留原屏，无到点说明 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await startThreeMinutes(page)
  await submitOne(page, api)
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本场结束后，正在生成报告。' })).toBeVisible()
  await expect(page.getByText(deadlineNotice, { exact: true })).toHaveCount(0)
  await expect(page.getByText('生成失败时会回到作答页并写明原因。这里不展示固定评分，也不承诺报告已经保存。', { exact: true })).toBeVisible()
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(1)
  await releaseReport(page, end)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(1)
})

test('A2-补1 回答最多等 12 秒，超时封住迟到下一题且 end 只有一次 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  const answer = deferred<{ status: number; json: unknown }>()
  api.respondWith('POST', `${sessionPath}/answer`, () => answer.promise)
  await startThreeMinutes(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill('到点前已经提交')
  await page.locator('.interview-session__text-grid').getByRole('button', { name: '提交回答', exact: true }).click()
  await expect.poll(() => api.requestCount('POST', `${sessionPath}/answer`)).toBe(1)
  await advance(page, 180_000)
  await expectPending(page, api, 1, 0)
  await advance(page, 11_999)
  await expectPending(page, api, 1, 0)
  await advance(page, 1)
  await expectPending(page, api, 1)
  const reply = page.waitForResponse(`${sessionPath}/answer`)
  answer.resolve({ status: 200, json: interviewAnswered })
  await reply
  await advance(page, 30_000)
  await expectPending(page, api, 1)
  await expect(page.getByText(interviewAnswered.data.question, { exact: true })).toHaveCount(0)
  await releaseReport(page, end)
})

test('A2-补2 手动结束请求跨过截止不重复 end，失败也不能续答 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await startThreeMinutes(page)
  await page.getByRole('button', { name: '结束本场练习', exact: true }).click()
  await expect(page.getByRole('heading', { name: '本场结束后，正在生成报告。' })).toBeVisible()
  await expect(page.getByText(deadlineNotice, { exact: true })).toHaveCount(0)
  await advance(page, 180_000)
  await expectPending(page, api, 0)
  end.resolve({ status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
  await expect(page.getByRole('heading', { name: '练习时间到了，报告还没生成。' })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '继续答题' })).toHaveCount(0)
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(1)
})

test('A2-补3 申请麦克风时到点，迟到授权立即取消 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await fakeRecording(page, api, true)
  await startThreeMinutes(page, true)
  await advance(page, 179_000)
  await page.getByRole('button', { name: '开始回答（语音）', exact: true }).click()
  await expect(page.getByRole('button', { name: '正在请求麦克风权限…', exact: true }).first()).toBeVisible()
  await advance(page, 1000)
  await expectPending(page, api, 0)
  await page.evaluate(() => (window as unknown as { __grantMic: () => void }).__grantMic())
  await expect.poll(() => page.evaluate(() => (window as unknown as { __micStops: number }).__micStops)).toBe(1)
  await expectPending(page, api, 0)
  expect(api.requestCount('POST', `${sessionPath}/transcribe`)).toBe(0)
  await releaseReport(page, end)
})

for (const signal of [false, true]) {
  test(`A2-补4 题目语音${signal ? '返回到点错误' : '到点后才返回'}不播放 @mic-kiosk`, async ({ page, api }) => {
    const end = reportBaseline(api)
    const audio = deferred<{ status: number; json: unknown }>()
    await fakeRecording(page, api)
    api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', { status: 200, json: { data: { asrEnabled: true, ttsEnabled: true } } })
    api.respondWith('POST', `${sessionPath}/turns/0/audio`, () => audio.promise)
    await page.addInitScript(() => {
      const local = window as unknown as { __plays: number }
      local.__plays = 0
      HTMLMediaElement.prototype.play = function () { local.__plays += 1; return Promise.resolve() }
    })
    await startThreeMinutes(page, true)
    await expect.poll(() => api.requestCount('POST', `${sessionPath}/turns/0/audio`)).toBe(1)
    if (!signal) {
      await advance(page, 180_000)
      await expectPending(page, api, 0)
    }
    const reply = page.waitForResponse(`${sessionPath}/turns/0/audio`)
    audio.resolve(signal
      ? { status: 409, json: { error: { code: 'INTERVIEW_DEADLINE_REACHED', message: '普通语音错误' } } }
      : { status: 200, json: { data: { audio: 'Zml4dHVyZQ==', format: 'mp3' } } })
    await reply
    await expectPending(page, api, 0)
    expect(await page.evaluate(() => (window as unknown as { __plays: number }).__plays)).toBe(0)
    await expect(page.getByText('普通语音错误', { exact: false })).toHaveCount(0)
    await releaseReport(page, end)
  })
}

test('A2-补5 转写返回服务端到点错误立即收尾 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  await fakeRecording(page, api)
  api.respond('POST', `${sessionPath}/transcribe`, { status: 409, json: { error: { code: 'INTERVIEW_DEADLINE_REACHED', message: '普通转写错误' } } })
  await startThreeMinutes(page, true)
  await beginRecording(page)
  await page.getByRole('button', { name: /^结束回答并转写/ }).click()
  await expectPending(page, api, 0)
  expect(api.requestCount('POST', `${sessionPath}/transcribe`)).toBe(1)
  await expect(page.getByText('普通转写错误', { exact: false })).toHaveCount(0)
  await releaseReport(page, end)
})

test('开场请求带限时标记，后端才会按时长封场 @mic-kiosk', async ({ page, api }) => {
  baseline(api)
  const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith(`${sessionPath}/start`))
  await startThreeMinutes(page)
  expect((await sent).postDataJSON()).toEqual({ hardDeadline: true })
})

test('A2-补7 进作答页时读会话已过点，直接收尾 @mic-kiosk', async ({ page, api }) => {
  const end = reportBaseline(api)
  // 本机钟还有三分钟，但服务端说这一场已经过点：以服务端为准。
  api.respond('GET', sessionPath, { status: 200, json: { data: {
    sessionId: interviewCreated.data.sessionId,
    serverNow: '2026-10-10T00:10:00.000Z', deadlineAt: '2026-10-10T00:09:00.000Z', timeUp: true,
  } } })
  await startThreeMinutes(page)
  await expectPending(page, api, 0)
  await releaseReport(page, end)
})

test('A2-补6 服务端提早到点后离开再进也不能续答 @mic-kiosk', async ({ page, api }) => {
  reportBaseline(api)
  api.respond('POST', `${sessionPath}/answer`, { status: 409, json: { error: { code: 'INTERVIEW_DEADLINE_REACHED' } } })
  api.respond('POST', `${sessionPath}/end`, { status: 503, json: { error: { code: 'AI_UNAVAILABLE' } } })
  await startThreeMinutes(page)
  await page.getByRole('textbox', { name: '本题回答' }).fill('本机钟还剩三分钟')
  await page.locator('.interview-session__text-grid').getByRole('button', { name: '提交回答', exact: true }).click()
  await expect(page.getByRole('heading', { name: '练习时间到了，报告还没生成。' })).toBeVisible()
  await page.goto('/interview?stage=tips')
  await page.goto('/interview?stage=session')
  await expect(page.getByRole('heading', { name: '练习时间到了，报告还没生成。' })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  expect(api.requestCount('POST', `${sessionPath}/answer`)).toBe(1)
  expect(api.requestCount('POST', `${sessionPath}/end`)).toBe(2)
})
