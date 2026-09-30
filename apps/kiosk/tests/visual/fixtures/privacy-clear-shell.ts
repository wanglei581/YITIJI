import type { Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import type { ApiRouter } from '../../fixtures/api-router'
import { expect } from '../../fixtures/kiosk-test'
import { RECRUITMENT_HOSTING_OFF, terminalConfigWithHosting } from '../../fixtures/recruitment-hosting'

/**
 * 清场类正式构建走查（playwright.privacy-clear.config.ts）共用的外壳：终端配置、健康检查、
 * 服务人次上报、终端票、会员发码与登录、「我的」各列表的空应答。
 * 登录与「我的文档」按人应答的用例自己在 page.route 上覆盖。
 */
export const PRIVACY_CLEAR_TASK_ID = 'privacy-clear-task-001'
const BOOT_TICKET = 'a'.repeat(40)

export function registerPrivacyShell(api: ApiRouter): void {
  api.respond('GET', '/api/v1/terminals/KSK-001/config', {
    status: 200,
    json: terminalConfigWithHosting(RECRUITMENT_HOSTING_OFF, 'privacy-clear-fixture'),
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/screensaver', {
    status: 200,
    json: { enabled: false, idleTimeoutSec: 180, items: [] },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/printer-status', {
    status: 200,
    json: { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true },
  })
  api.respond('GET', '/api/v1/terminals/KSK-001/capabilities', {
    status: 200,
    json: { capabilities: [] },
  })
  api.respond('GET', '/api/v1/health', { status: 200, json: { success: true, data: { status: 'ok' } } })
  api.respond('GET', '/api/v1/jobs', {
    status: 200,
    json: { data: [], pagination: { page: 1, pageSize: 1, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/job-fairs', {
    status: 200,
    json: { success: true, data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
  })
  api.respond('GET', '/api/v1/mock-interviews/capabilities/voice', {
    status: 200,
    json: { asrEnabled: false, ttsEnabled: false },
  })
  for (const docType of ['terms_of_service', 'privacy_policy']) {
    api.respond('GET', `/api/v1/kiosk/legal/${docType}`, {
      status: 200,
      json: { success: true, data: { version: '2026-09-01', title: docType, status: 'active' } },
    })
  }
  for (const endpoint of ['start', 'heartbeat', 'end']) {
    api.respond('POST', `/api/v1/kiosk/session/${endpoint}`, {
      status: 200,
      json: { success: true },
    })
  }
  api.respond('POST', '/api/v1/terminals/session-token', {
    status: 200,
    json: { sessionToken: 'privacy-clear-terminal-session-token' },
  })
  // 本页刷新后若 sessionStorage 里已有终端票，启动会先续这一张票。
  api.respond('POST', '/api/v1/terminals/session-token/refresh', {
    status: 200,
    json: { sessionToken: 'privacy-clear-terminal-session-token' },
  })
  api.respond('POST', '/api/v1/member/auth/sms-code', {
    status: 200,
    json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } },
  })
  api.respond('POST', '/api/v1/member/auth/logout', { status: 200, json: { success: true } })
  const emptyPage = { success: true, data: { items: [], nextCursor: null, total: 0 } }
  for (const path of [
    '/api/v1/me/favorites',
    '/api/v1/me/print-orders',
    '/api/v1/me/resumes',
    '/api/v1/me/benefits',
  ]) {
    api.respond('GET', path, { status: 200, json: emptyPage })
  }
  api.respond('GET', '/api/v1/me/ai-records', {
    status: 200,
    json: {
      success: true,
      data: { items: [], nextCursor: null, total: 0, qaRecords: [], qaNextCursor: null, qaTotal: 0 },
    },
  })
  api.respond('GET', '/api/v1/me/pending-tasks', {
    status: 200,
    json: { success: true, data: [] },
  })
  api.respond('GET', '/api/v1/me/ai-consents/status', {
    status: 200,
    json: { success: true, data: [{ scope: 'job_ai', granted: false }] },
  })
  api.respond('GET', `/api/v1/print/jobs/${PRIVACY_CLEAR_TASK_ID}`, {
    status: 200,
    json: { taskId: PRIVACY_CLEAR_TASK_ID, status: 'completed', completedAt: '2026-09-29T00:00:00.000Z' },
  })
}

/** 一份「我的文档」条目。文件名就是用例要找 / 要确认不在屏上的那个字符串。 */
export function memberDocument(id: string, filename: string) {
  return {
    id,
    filename,
    mimeType: 'application/pdf',
    sizeBytes: 245760,
    purpose: 'print_doc',
    sensitiveLevel: 'normal',
    assetCategory: 'original',
    retentionPolicy: 'months_3',
    allowedRetentionPolicies: ['months_3', 'months_6', 'long_term'],
    createdAt: '2026-09-01T08:00:00.000Z',
    expiresAt: '2099-03-01T00:00:00.000Z',
    downloadUrlPath: `/files/${id}/download-url`,
    previewUrlPath: `/files/${id}/preview-url`,
  }
}

export async function allowLocalBootTicket(page: Page): Promise<void> {
  await page.route('http://127.0.0.1:9527/local/terminal-boot-ticket', async (route) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'X-Local-Bridge-Token, Accept, Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    }
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({ data: { bootTicket: BOOT_TICKET } }),
    })
  })
}

export async function shotTo(dir: string, page: Page, name: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: `${dir}/${name}`, fullPage: false })
}

/** 在登录页上用屏上数字键盘走一遍手机号登录。 */
export async function fillPhoneLogin(page: Page, phone: string, code = '123456'): Promise<void> {
  await page.getByRole('checkbox', { name: /我已阅读并同意/ }).click()
  await page.getByRole('button', { name: '手机号（11 位本人号码）', exact: true }).click()
  for (const digit of phone) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await page.getByRole('button', { name: '短信验证码', exact: true }).click()
  for (const digit of code) {
    await page.getByRole('button', { name: digit, exact: true }).click()
  }
  await page.getByRole('button', { name: '收起键盘', exact: true }).click()
  await page.getByRole('button', { name: '确认登录', exact: true }).click()
}

export async function loginThroughVisibleUi(page: Page, returnTo: string, phone: string): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(returnTo)}`)
  await fillPhoneLogin(page, phone)
  await page.waitForURL((url) => url.pathname === returnTo)
  await expect(page.getByTestId('session-guard-state-clearing')).toHaveCount(0)
}
