// ============================================================
// 麦克风能力三态浏览器套件。
//
// 守的是一句具体的假话：修复前页面用 `!!navigator.mediaDevices?.getUserMedia`
// 判断麦克风，在没有麦克风的机器上恒为 true —— 界面显示「语音回答可用」，
// 点录音才抛 NotFoundError，还被说成「请检查浏览器权限」。
//
// 真机上无法拔掉内置麦克风，所以这里用 addInitScript 覆写
// navigator.mediaDevices 来构造三种设备情形。覆写的是浏览器 API 表面，
// 页面代码走的是完全真实的路径（detectMicCapability → 状态胶囊 / 门禁 / 文案）。
// ============================================================

import { test, expect, type Page } from '../fixtures/kiosk-test'
import type { ApiRouter } from '../fixtures/api-router'
import { interviewCreated, interviewStarted } from './fixtures/fusion-w3-states'

function terminalBaseline(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: { smartCampus: { enabled: false, modules: {}, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'mic', refreshIntervalMs: 300000, serverTime: '2026-08-16T00:00:00.000Z' },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', { status: 200, json: { enabled: false, idleTimeoutSec: 180, items: [] } })
}

function interviewBaseline(api: ApiRouter): void {
  terminalBaseline(api)
  api.respond('POST', '/api/v1/mock-interviews', { status: 200, json: interviewCreated })
  api.respond('POST', '/api/v1/mock-interviews/interview-w3-public-fixture/start', { status: 200, json: interviewStarted })
  // ASR 已启用 —— 这样「能不能语音」只取决于本机硬件，正是要测的那一维
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { data: { asrEnabled: true, ttsEnabled: false } },
  })
}

type MicScenario = 'no-device' | 'permission-denied' | 'available'

/** 在页面加载前构造设备情形。 */
async function stubMic(page: Page, scenario: MicScenario): Promise<void> {
  await page.addInitScript((mode: MicScenario) => {
    const devices: MediaDeviceInfo[] = []
    if (mode !== 'no-device') {
      // 未授权时真实 Chrome 也是这样：kind 在，label/deviceId 被置空
      devices.push({
        deviceId: '', groupId: '', kind: 'audioinput', label: '',
        toJSON() { return this },
      } as MediaDeviceInfo)
    }
    const md = {
      enumerateDevices: async () => devices,
      getUserMedia: async () => {
        const error = mode === 'no-device'
          ? new DOMException('Requested device not found', 'NotFoundError')
          : new DOMException('Permission denied', 'NotAllowedError')
        if (mode === 'available') return new MediaStream()
        throw error
      },
      addEventListener() { /* noop */ },
      removeEventListener() { /* noop */ },
    }
    Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true })
    Object.defineProperty(navigator, 'permissions', {
      value: {
        query: async () => ({ state: mode === 'permission-denied' ? 'denied' : 'prompt' }),
      },
      configurable: true,
    })
  }, scenario)
}

async function gotoSession(page: Page): Promise<void> {
  await page.goto('/interview/setup')
  await page.getByRole('button', { name: '选择行业 (20)' }).click()
  const dialog = page.getByRole('dialog', { name: '选择面试行业' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '制造业', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()
  await page.getByPlaceholder(/输入目标岗位/).fill('前端开发工程师')
  await page.getByRole('button', { name: '开始模拟面试' }).click()
  await page.waitForURL('/interview/session')
}

// ── ① 没有音频输入设备时，绝不显示「语音可用」──────────────────────────
test('无音频输入设备时不显示「语音回答可用」 @mic-kiosk', async ({ page, api }) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  interviewBaseline(api)
  await stubMic(page, 'no-device')
  await gotoSession(page)

  // 这是修复前会失败的断言：旧代码此时显示「语音回答可用」并自动进语音模式
  await expect(page.getByText('语音回答可用')).toHaveCount(0)
  // 状态胶囊直述硬件事实
  await expect(page.getByText('本机没有麦克风', { exact: true })).toBeVisible()
  // 常显原因也要说的是设备，不是权限
  await expect(page.locator('[data-mic-reason]')).toContainText('本机没有麦克风')
  // 保持在文字模式，不得自动切到语音
  await expect(page.getByRole('textbox')).toBeVisible()
  expect(runtimeErrors).toEqual([])
})

// ── ② 「没有设备」与「有设备无权限」必须给出不同提示 ────────────────────
test('无设备与无权限两种提示不同 @mic-kiosk', async ({ page, api }) => {
  interviewBaseline(api)
  await stubMic(page, 'no-device')
  await gotoSession(page)
  const noDeviceReason = await page.locator('[data-mic-reason]').innerText()

  await page.context().clearCookies()
  await stubMic(page, 'permission-denied')
  interviewBaseline(api)
  await gotoSession(page)
  const deniedReason = await page.locator('[data-mic-reason]').innerText()

  expect(noDeviceReason).not.toEqual(deniedReason)
  // 没有麦克风时不得把用户支使去翻浏览器权限设置 —— 那里什么都查不出来
  expect(noDeviceReason).toContain('本机没有麦克风')
  expect(noDeviceReason).not.toContain('权限')
  // 有设备无权限时才谈权限，并且要给出可执行的下一步
  expect(deniedReason).toContain('权限')
  expect(deniedReason).toMatch(/允许麦克风|权限图标/)
})

// ── ③ 能力门禁用 aria-disabled + 常显原因，且点击被 handler 内短路 ──────
test('语音入口置灰而非消失，原因常显且点击无效 @mic-kiosk', async ({ page, api }) => {
  interviewBaseline(api)
  await stubMic(page, 'no-device')
  await gotoSession(page)

  const voiceEntry = page.getByRole('button', { name: '改用语音回答' })
  // 不得整个隐藏：用户可能后插一个 USB 麦克风
  await expect(voiceEntry).toBeVisible()
  await expect(voiceEntry).toHaveAttribute('aria-disabled', 'true')
  // 触屏没有 hover：原因必须常显，不能塞在 title 里
  await expect(page.locator('[data-mic-reason]')).toBeVisible()
  await expect(voiceEntry).not.toHaveAttribute('title', /.+/)

  // aria-disabled 只是语义，浏览器不会阻止事件（原生 disabled 才会，而这里
  // 刻意不用原生 disabled，好让入口在后插麦克风后能恢复）。Playwright 的
  // actionability 会尊重 aria-disabled，所以用 force 模拟一次真实触屏点击 ——
  // 这正是「去掉原生 disabled 就真能点」的场景，短路守卫必须在 handler 内。
  await voiceEntry.click({ force: true })
  await expect(page.getByRole('textbox')).toBeVisible()
  await expect(page.getByRole('button', { name: /开始回答（语音）/ })).toHaveCount(0)

  // 「重新检测麦克风」入口必须在（改权限 / 插设备后可恢复）
  await expect(page.getByRole('button', { name: '重新检测麦克风' })).toBeVisible()
})

// ── ④ 有设备有权限时，语音入口正常放行 ────────────────────────────────
test('有可用麦克风时进入语音模式 @mic-kiosk', async ({ page, api }) => {
  interviewBaseline(api)
  await stubMic(page, 'available')
  await gotoSession(page)

  await expect(page.getByText('语音回答可用')).toBeVisible()
  await expect(page.locator('[data-mic-reason]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /开始回答（语音）/ })).toBeVisible()
})
