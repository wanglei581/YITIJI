// 青序并排截图 · 51 手机接力。扫码登录 16 态、手机上传 13 态各自走真实回执。
// 手机号 13812346627 脱敏成 138****6627。不写票据、令牌，也不编服务电话。
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import type { QingxuPairTarget, RuntimePlan } from './qingxu-pair-targets'

export interface RelayPagesPlan {
  plan: RuntimePlan
  reason: string | null
  marker: string | null
  runtimePath: string | null
}

const PLAN: RuntimePlan = { kind: 'relay-pages' }

const PHONE = '13812346627'
const TICKET = 'relay51qr0123456789abcdef'
const SESSION = 'upl51haichuan'
const TOKEN = 'tok51haichuan'
const STATUS = `/api/v1/member/auth/qr/${TICKET}/status`
const CONFIRM = `/api/v1/member/auth/qr/${TICKET}/confirm`
const SMS = '/api/v1/member/auth/sms-code'
const FILES_PATH = `/api/v1/upload-sessions/${SESSION}/files`
const DEVICE = '大厅里的这台机器'

export const QR_STATES = [
  'missing-ticket', 'checking', 'status-error', 'ticket-expired', 'ready', 'device-missing',
  'send-loading', 'send-error', 'send-limited', 'code-sent', 'confirming',
  'confirm-code-invalid', 'confirm-code-expired', 'confirm-code-locked', 'confirm-unknown', 'confirmed',
] as const

export const UPLOAD_STATES = [
  'invalid', 'idle', 'uploading', 'upload-in-progress', 'outcome-unknown', 'empty-error', 'too-large',
  'type-error', 'content-type-error', 'service-error', 'session-expired', 'success', 'signature-blocked',
] as const

function hang(): Promise<never> {
  return new Promise(() => undefined)
}

function fail(status: number, code: string, message: string) {
  return { status, json: { success: false, error: { code, message } } }
}

function pending(remain: number, device: string | null) {
  return {
    status: 200,
    json: {
      success: true,
      data: {
        status: 'pending' as const,
        ...(device ? { deviceLabel: device } : {}),
        returnTo: '/',
        expiresInSeconds: remain,
      },
    },
  }
}

const SMS_OK = { status: 200, json: { success: true, data: { sent: true, cooldownSeconds: 60, expiresInSeconds: 300 } } }

function pdf(name: string, bytes: number) {
  const buffer = Buffer.alloc(bytes, 0x20)
  if (bytes >= 8) buffer.write('%PDF-1.4')
  return { name, mimeType: 'application/pdf', buffer }
}

const PICK: Record<string, { name: string; mimeType: string; buffer: Buffer }> = {
  uploading: pdf('周宁-产品运营简历.pdf', 1_887_437),
  'upload-in-progress': pdf('海川路服务点-岗位说明.pdf', 655_360),
  'outcome-unknown': pdf('劳动合同（待审）.pdf', 2_516_582),
  'empty-error': { name: '空白页.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) },
  'too-large': pdf('周宁-作品集扫描件.pdf', 11_953_767),
  'type-error': { name: '周宁-作品集.heic', mimeType: 'image/heic', buffer: Buffer.from('heic-fixture') },
  'content-type-error': { name: '周宁-证件照.png', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-photo') },
  'service-error': pdf('录用通知书.pdf', 428_032),
  'session-expired': { name: '周宁-学历证明.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(1_048_576, 0xff) },
  success: pdf('周宁-产品运营简历.pdf', 1_887_437),
}

const UPLOAD_PURPOSE: Record<string, string> = {
  idle: 'resume_upload',
  uploading: 'print_doc',
  'upload-in-progress': 'contract_upload',
  'outcome-unknown': 'print_doc',
  'empty-error': 'resume_upload',
  'too-large': 'print_doc',
  'type-error': 'resume_upload',
  'content-type-error': 'contract_upload',
  'service-error': 'print_doc',
  'session-expired': 'resume_upload',
  success: 'resume_upload',
}

function uploadUrl(state: string): string {
  if (state === 'invalid') return '/upload/phone'
  if (state === 'signature-blocked') {
    return `/upload/phone#sessionId=${SESSION}&token=${TOKEN}&purpose=signature_image`
  }
  const purpose = UPLOAD_PURPOSE[state] ?? 'resume_upload'
  return `/upload/phone#sessionId=${SESSION}&token=${TOKEN}&purpose=${purpose}`
}

async function open(page: Page, url: string): Promise<void> {
  const contact = page.waitForResponse((response) => response.url().includes('/api/v1/public/support-contact'), { timeout: 15_000 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await contact.catch(() => undefined)
}

async function sendCode(page: Page): Promise<void> {
  await page.locator('main[data-mobile-qr-state="ready"], main[data-mobile-qr-state="device-missing"]').first().waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByLabel('手机号，11 位数字').fill(PHONE)
  await page.getByRole('button', { name: '获取短信验证码' }).click()
}

async function confirmCode(page: Page, code: string): Promise<void> {
  await page.locator('main[data-mobile-qr-state="code-sent"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByLabel('短信验证码，6 位数字').fill(code)
  await page.getByRole('button', { name: '确认本次一体机登录请求' }).click()
}

async function prepareQr(page: Page, api: ApiRouter, state: string): Promise<void> {
  const url = state === 'missing-ticket' ? '/member/qr-login' : `/member/qr-login?ticketId=${TICKET}`
  if (state === 'checking') api.respondWith('GET', STATUS, hang)
  else if (state === 'status-error') api.respond('GET', STATUS, fail(500, 'UPSTREAM', '请求失败（500）'))
  else if (state === 'ticket-expired') {
    api.respond('GET', STATUS, {
      status: 200,
      json: { success: true, data: { status: 'confirmed', deviceLabel: DEVICE, returnTo: '/', expiresInSeconds: 0 } },
    })
  } else if (state === 'device-missing') api.respond('GET', STATUS, pending(94, null))
  else if (state === 'ready') api.respond('GET', STATUS, pending(126, DEVICE))
  else if (state === 'send-loading') {
    api.respond('GET', STATUS, pending(168, DEVICE))
    api.respondWith('POST', SMS, hang)
  } else if (state === 'send-error') {
    api.respond('GET', STATUS, pending(73, DEVICE))
    api.respond('POST', SMS, fail(502, 'SMS_SEND_FAILED', 'SMS_SEND_FAILED'))
  } else if (state === 'send-limited') {
    api.respond('GET', STATUS, pending(41, DEVICE))
    api.respond('POST', SMS, fail(429, 'SMS_TOO_FREQUENT', '请求失败（429）'))
  } else if (state === 'code-sent') {
    api.respond('GET', STATUS, pending(155, DEVICE))
    api.respond('POST', SMS, SMS_OK)
  } else if (state === 'confirming') {
    api.respond('GET', STATUS, pending(88, DEVICE))
    api.respond('POST', SMS, SMS_OK)
    api.respondWith('POST', CONFIRM, hang)
  } else if (state === 'confirm-code-invalid') {
    api.respond('GET', STATUS, pending(112, DEVICE))
    api.respond('POST', SMS, SMS_OK)
    api.respond('POST', CONFIRM, fail(401, 'SMS_CODE_INVALID', '验证码不正确'))
  } else if (state === 'confirm-code-expired') {
    api.respond('GET', STATUS, pending(67, DEVICE))
    api.respond('POST', SMS, SMS_OK)
    api.respond('POST', CONFIRM, fail(401, 'SMS_CODE_EXPIRED', '验证码已过期'))
  } else if (state === 'confirm-code-locked') {
    api.respond('GET', STATUS, pending(39, DEVICE))
    api.respond('POST', SMS, SMS_OK)
    api.respond('POST', CONFIRM, fail(401, 'SMS_CODE_LOCKED', '验证码已锁定'))
  } else if (state === 'confirm-unknown') {
    api.respond('GET', STATUS, pending(146, DEVICE))
    api.respond('POST', SMS, SMS_OK)
    api.abort('POST', CONFIRM, 'internetdisconnected')
  } else if (state === 'confirmed') {
    api.respond('GET', STATUS, pending(118, DEVICE))
    api.respond('POST', SMS, SMS_OK)
    api.respond('POST', CONFIRM, { status: 200, json: { success: true, data: { status: 'confirmed' } } })
  }
  await open(page, url)
  if (state === 'send-loading' || state === 'send-error' || state === 'send-limited') await sendCode(page)
  else if (state === 'code-sent') await sendCode(page)
  else if (state === 'confirming') {
    await sendCode(page)
    await confirmCode(page, '648213')
  } else if (state === 'confirm-code-invalid') {
    await sendCode(page)
    await confirmCode(page, '204816')
  } else if (state === 'confirm-code-expired' || state === 'confirm-code-locked') {
    await sendCode(page)
    await confirmCode(page, '572046')
  } else if (state === 'confirm-unknown') {
    await sendCode(page)
    await confirmCode(page, '390218')
  } else if (state === 'confirmed') {
    await sendCode(page)
    await confirmCode(page, '816204')
  }
}

function receipt(purpose: string) {
  return {
    status: 200,
    json: {
      success: true,
      data: {
        sessionId: SESSION,
        status: 'uploaded',
        purpose,
        mode: 'temporary',
        file: {
          fileId: 'file-zhou-ning-resume',
          filename: '周宁-产品运营简历.pdf',
          sizeBytes: 1_887_437,
          mimeType: 'application/pdf',
          sha256: 'c'.repeat(64),
          fileExpiresAt: null,
        },
        requiresKioskConfirmation: true,
        expiresAt: '2026-10-06T09:40:00.000Z',
      },
    },
  }
}

async function prepareUpload(page: Page, api: ApiRouter, state: string): Promise<void> {
  if (state === 'uploading') api.respondWith('POST', FILES_PATH, hang)
  else if (state === 'upload-in-progress') api.respond('POST', FILES_PATH, fail(409, 'UPLOAD_SESSION_UPLOAD_IN_PROGRESS', '文件正在上传，请稍候。'))
  else if (state === 'outcome-unknown') api.abort('POST', FILES_PATH, 'internetdisconnected')
  else if (state === 'service-error') api.respond('POST', FILES_PATH, fail(422, 'FILE_REJECTED', '请求失败（422）'))
  else if (state === 'session-expired') api.respond('POST', FILES_PATH, fail(410, 'UPLOAD_SESSION_EXPIRED', '二维码已失效或已使用，请回到一体机刷新二维码。'))
  else if (state === 'success') api.respond('POST', FILES_PATH, receipt('resume_upload'))
  await open(page, uploadUrl(state))
  const file = PICK[state]
  if (!file) return
  await page.locator('main[data-phone-upload-state="idle"]').waitFor({ state: 'visible', timeout: 15_000 })
  await page.getByLabel('选择要上传的文件').setInputFiles(file)
}

export function relayPagesPlan(file: string, screen: string, state: string): RelayPagesPlan | null {
  if (!file.startsWith('51-')) return null
  if (screen === 'qr-login' && (QR_STATES as readonly string[]).includes(state)) {
    const runtimePath = state === 'missing-ticket' ? '/member/qr-login' : `/member/qr-login?ticketId=${TICKET}`
    return { plan: PLAN, reason: null, marker: `main[data-mobile-qr-state="${state}"]`, runtimePath }
  }
  if (screen === 'phone-upload' && (UPLOAD_STATES as readonly string[]).includes(state)) {
    return { plan: PLAN, reason: null, marker: `main[data-phone-upload-state="${state}"]`, runtimePath: uploadUrl(state) }
  }
  return null
}

export async function prepareRelayPages(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  if (!target.runtimeUrl) throw new Error(`51 ${target.screen}/${target.state} 没有运行地址`)
  if (target.screen === 'qr-login') await prepareQr(page, api, target.state)
  else await prepareUpload(page, api, target.state)
  const attr = target.screen === 'qr-login' ? 'data-mobile-qr-state' : 'data-phone-upload-state'
  const root = page.locator('main').first()
  try {
    // 发码、确认、选文件之后状态要等回执落定。点下去的瞬间还是 loading，不能当时就读。
    await page.locator(`main[${attr}="${target.state}"]`).waitFor({ state: 'visible', timeout: 15_000 })
  } catch (error) {
    const landed = await root.getAttribute(attr).catch(() => null)
    throw new Error(`51 ${target.screen} 截到「${landed ?? '无'}」，要的是「${target.state}」`, { cause: error })
  }
}
