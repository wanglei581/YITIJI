// 稿 18：材料扫描。稿里已有的态仍走 openScan；运行页多出来的态在这里造。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import { writeScanWorkbenchSession } from '../fusion-w2-state'
import { loginThroughVisibleUi, registerAuthenticatedMemberApis, registerMemberLogin } from '../kiosk-p1-evidence-capture-api'
import type { ResumePageFixture } from './types'

const LATER = '2099-01-01T00:00:00.000Z'
const SCAN_ID = 'pair-scan-ack'
const HOLD_ID = 'pair-hold-001'

/** 与 qingxu-pair-seeds 的 SCAN_NONE 同一句：这九态没有停留屏。 */
const NONE: Record<string, string> = {
  'session-lost': '扫描运行时没有 session-lost 屏，缺会话时直接回到开始',
  'cancel-failed': '取消失败会离开进度页回到开始，没有单独停留屏',
  cancelled: '服务端回 cancelled 后进度页直接回开始，不停留',
  'cancel-race': '取消与完成赛跑被收成回开始或完成结果，没有单独的 cancel-race 屏',
  'cancel-conflict': '取消冲突没有单独停留屏，页面按最新一次状态查询离开进度',
  'cancel-recheck': '取消后的补查没有单独停留屏',
  'cancel-race-unknown': '取消后补查失败没有单独停留屏',
  'preview-loading': '扫描结果预览没有单独的加载屏，内容区直接挂签名链接',
  'preview-failed': '预览打不开只在内容区留一句，不改判完成，也没有单独的 preview-failed 屏',
}

const PRIORITY: Record<string, { marker: string; path: string }> = {
  setup: { marker: '[data-state="setup"]', path: '/scan?stage=start' },
  blocked: { marker: '[data-state="blocked"]', path: '/scan?stage=start' },
  'usb-panel': { marker: '[data-state="usb-panel"]', path: '/scan?stage=start&mode=usb-panel' },
  'create-loading': { marker: '[data-state="create-loading"]', path: '/scan?stage=settings' },
  'create-failed': { marker: '[data-state="create-failed"]', path: '/scan?stage=settings' },
  'waiting-delivery': { marker: '[data-state="waiting-delivery"]', path: '/scan?stage=progress' },
  polling: { marker: '[data-state="polling"]', path: '/scan?stage=progress' },
  'poll-failed': { marker: '[data-state="poll-failed"]', path: '/scan?stage=progress' },
  cancelling: { marker: '[data-state="cancelling"]', path: '/scan?stage=progress' },
  failed: { marker: '[data-w2-page="scan-result"], [data-state]', path: '/scan?stage=result' },
  expired: { marker: '[data-w2-page="scan-result"], [data-state]', path: '/scan?stage=result' },
  completed: { marker: '[data-w2-page="scan-result"], [data-state]', path: '/scan?stage=result' },
  'preview-ready': { marker: '[data-w2-page="scan-result"], [data-state]', path: '/scan?stage=result' },
  'completed-no-file': { marker: '[data-w2-page="scan-result"], [data-state]', path: '/scan?stage=result' },
}

const EXTRA: Record<string, { marker: string; path: string }> = {
  loading: { marker: '[data-state="loading"]', path: '/scan?stage=start' },
  unknown: { marker: '[data-state="unknown"]', path: '/scan?stage=start' },
  invalid: { marker: '[data-state="invalid"]', path: '/scan?stage=settings' },
  'awaiting-ack': { marker: '[data-state="awaiting-ack"]', path: '/scan?stage=settings' },
  'cleanup-holding': { marker: '[data-state="cleanup-holding"]', path: '/scan?stage=settings' },
}

function hang(): Promise<never> {
  return new Promise(() => {})
}

function see(page: Page, marker: string): Promise<void> {
  return page.locator(marker).first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => undefined)
}

export const page18: ResumePageFixture = {
  prefix: '18-',
  plan(_screen, state) {
    const missing = NONE[state]
    if (missing) return { plan: { kind: 'none' }, reason: missing, marker: null, runtimePath: null }
    if (state === 'panel-instruction') {
      return {
        plan: { kind: 'resume-pages' },
        reason: null,
        marker: '[data-state="panel-instruction"]',
        runtimePath: '/scan?stage=settings',
      }
    }
    const hit = PRIORITY[state]
    if (hit) return { plan: { kind: 'priority' }, reason: null, marker: hit.marker, runtimePath: hit.path }
    const extra = EXTRA[state]
    if (extra) return { plan: { kind: 'resume-pages' }, reason: null, marker: extra.marker, runtimePath: extra.path }
    return null
  },
  extraPairs() {
    return [
      { screen: 'start', state: 'loading', route: '/scan?stage=start', protoQuery: '?capture=1&flat=1' },
      { screen: 'start', state: 'unknown', route: '/scan?stage=start', protoQuery: '?capture=1&flat=1&not-a-real-param=1' },
      { screen: 'settings', state: 'invalid', route: '/scan?stage=settings', protoQuery: '?capture=1&flat=1&fx=create-busy' },
      { screen: 'settings', state: 'awaiting-ack', route: '/scan?stage=settings', protoQuery: '?capture=1&flat=1&fx=create-busy' },
      { screen: 'settings', state: 'cleanup-holding', route: '/scan?stage=settings', protoQuery: '?capture=1&flat=1&fx=create-busy' },
    ]
  },
  async prepare(page, api, target) {
    if (target.state === 'loading') {
      api.respondWith('GET', '/api/v1/terminals/KSK-001/capabilities', () => hang())
      await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
      await see(page, '[data-state="loading"]')
      return
    }
    if (target.state === 'unknown') {
      api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
        status: 503,
        json: { error: { code: 'CAPABILITY_UNAVAILABLE', message: '能力状态暂不可用' } },
      })
      await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
      await see(page, '[data-state="unknown"]')
      return
    }
    if (target.state === 'invalid') {
      await page.goto('/scan?stage=settings', { waitUntil: 'domcontentloaded' })
      await see(page, '[data-state="invalid"]')
      return
    }
    if (target.state === 'panel-instruction') {
      await preparePanelInstruction(page, api)
      return
    }
    if (target.state === 'awaiting-ack') {
      api.respond('POST', '/api/v1/scan/sessions', {
        status: 200,
        json: {
          success: true,
          data: {
            scanTaskId: SCAN_ID,
            controlToken: 'pair-scan-token',
            expiresAt: LATER,
            instructions: ['把简历朝下放入稿台'],
          },
        },
      })
      api.respondWith('POST', `/api/v1/scan/sessions/${SCAN_ID}/ack`, () => hang())
      await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
      await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'resume' })
      await page.goto('/scan?stage=settings', { waitUntil: 'domcontentloaded' })
      await see(page, '[data-state="awaiting-ack"]')
      return
    }
    if (target.state === 'cleanup-holding') {
      await prepareCleanupHolding(page, api)
    }
  },
}

/** 简历扫描的四步原文，和服务端 SCAN_TYPE_INSTRUCTIONS.resume 一致。一步夹具会把右列撑出大片空白。 */
const RESUME_PANEL_STEPS = [
  '将简历原件正面朝上放入自动进纸器，或正面朝下对齐玻璃板左上角',
  '在打印机操作面板点击「扫描」',
  '选择「扫描到 SMB」（本机已配置的接收目录）；简历建议黑白，文字更清晰',
  '按「开始」扫描；完成后回到本屏幕等待自动识别，请勿关闭页面',
]

async function preparePanelInstruction(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: ['color_print', 'duplex_print', 'scan'].map((capabilityKey) => ({
        capabilityKey,
        status: 'available',
        note: null,
        configured: true,
        updatedAt: '2026-07-24T00:00:00.000Z',
      })),
    },
  })
  api.respond('POST', '/api/v1/scan/sessions', {
    status: 200,
    json: {
      success: true,
      data: {
        scanTaskId: 'pair-scan-001',
        controlToken: 'pair-scan-control',
        expiresAt: LATER,
        instructions: RESUME_PANEL_STEPS,
      },
    },
  })
  api.respond('POST', '/api/v1/scan/sessions/pair-scan-001/ack', {
    status: 200,
    json: {
      success: true,
      data: { scanTaskId: 'pair-scan-001', deliveryAckedAt: '2026-07-24T00:00:01.000Z' },
    },
  })
  await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
  await writeScanWorkbenchSession(page, { stage: 'settings', scanType: 'resume' })
  await page.goto('/scan?stage=settings', { waitUntil: 'domcontentloaded' })
  await see(page, '[data-state="panel-instruction"]')
}

async function prepareCleanupHolding(page: Page, api: ApiRouter): Promise<void> {
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: {
      capabilities: [{
        capabilityKey: 'scan',
        status: 'available',
        note: null,
        configured: true,
        updatedAt: '2026-07-24T00:00:00.000Z',
      }],
    },
  })
  registerMemberLogin(api)
  registerAuthenticatedMemberApis(api)
  await page.route(`**/api/v1/scan/sessions/${HOLD_ID}`, async (route) => {
    if (route.request().method() !== 'DELETE') {
      await route.fallback()
      return
    }
    await hang()
  })
  await page.goto('/scan', { waitUntil: 'domcontentloaded' })
  await writeScanWorkbenchSession(page, {
    stage: 'progress',
    scanType: 'resume',
    live: {
      scanTaskId: HOLD_ID,
      controlToken: 'pair-hold-token',
      instructions: ['把简历朝下放入稿台'],
      expiresAt: LATER,
    },
  })
  await loginThroughVisibleUi(page, '/scan/start')
  await page.getByRole('radio', { name: '选择扫描类型：简历扫描' }).click()
  await page.getByRole('button', { name: '开始这次扫描', exact: true }).click()
  await see(page, '[data-state="cleanup-holding"]')
}
