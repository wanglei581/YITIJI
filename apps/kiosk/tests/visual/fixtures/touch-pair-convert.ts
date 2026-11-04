import { expect, type Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import { W2_FILE } from './fusion-w2-state'
import { registerTouchShell, routeVisiblePdf, terminalReady } from './touch-pair-shell'

export type ConvertState = 'edit' | 'composing' | 'result' | 'unknown' | 'conflict' | 'closed' | 'usb'
const CONVERT = '/api/v1/print/convert/images-to-pdf'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

/**
 * 手机确认沿用 fusion-w2-tools「signature step 2」的 UploadSessionQrPanel 应答，
 * purpose/按钮读 ConvertImagesView 的现有配置（print_doc）；合成答复沿用同 spec 的 conversion payload order。
 * 不启用桌面本机文件框，不写 React 状态。
 */
async function addPhoneImage(page: Page, api: ApiRouter): Promise<void> {
  const sessionId = 'pair-convert-phone'
  // 屏上倒计时按有效期算；写 2099 年会显示成几千万分钟。照现场二维码 10 分钟有效。
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  const file = {
    fileId: 'w2-image-001', filename: 'w2-image.png', sizeBytes: 1024,
    mimeType: 'image/png', sha256: 'c'.repeat(64), fileExpiresAt: expiresAt,
    fileUrl: '/w2-fixtures/image.png',
  }
  api.respond('POST', '/api/v1/upload-sessions', { status: 201, json: { success: true, data: {
    sessionId, uploadUrl: '/upload/phone', uploadToken: 'pair-image-upload', controlToken: 'pair-image-control', expiresAt,
  } } })
  api.respond('GET', `/api/v1/upload-sessions/${sessionId}`, { status: 200, json: { success: true, data: {
    sessionId, status: 'uploaded', purpose: 'print_doc', mode: 'temporary', file, requiresKioskConfirmation: true, expiresAt,
  } } })
  api.respond('POST', `/api/v1/upload-sessions/${sessionId}/confirm`, { status: 201, json: { success: true, data: {
    sessionId, status: 'confirmed', file,
  } } })
  api.respond('DELETE', `/api/v1/upload-sessions/${sessionId}`, { status: 200, json: { success: true, data: { sessionId, status: 'cancelled' } } })
  await page.route('**/w2-fixtures/image.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
  await page.getByTestId('img2pdf-add-phone').click()
  const layer = page.getByTestId('img2pdf-qr-layer')
  await layer.getByRole('button', { name: '确认加入待合并列表', exact: true }).click()
  await expect(layer).toHaveCount(0)
  await expect(page.getByTestId('img2pdf-list')).toHaveAttribute('data-count', '1')
  const image = page.getByRole('img', { name: 'w2-image.png 缩略图' })
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
}

export async function openConvert(page: Page, api: ApiRouter, state: ConvertState): Promise<void> {
  registerTouchShell(api)
  await routeVisiblePdf(page)
  await page.goto('/print-scan/convert')
  await terminalReady(page)
  if (state === 'usb') {
    await page.getByTestId('img2pdf-add-usb').click()
    await expect(page.getByRole('heading', { name: 'U 盘图片还没接到这里', exact: true })).toBeVisible()
    return
  }
  await addPhoneImage(page, api)
  if (state === 'edit') {
    await expect(page.getByRole('heading', { name: '排好顺序再合成', exact: true })).toBeVisible()
    return
  }
  if (state === 'composing') {
    api.respondWith('POST', CONVERT, () => new Promise(() => undefined))
  } else if (state === 'unknown') {
    // ApiRouter 的既有断网造法；classifyConvertError 的 NETWORK_ERROR → result-unknown。
    api.abort('POST', CONVERT, 'internetdisconnected')
  } else if (state === 'conflict' || state === 'closed') {
    // convert-images-model / 服务端转换幂等与能力闸门的真实业务码，不新增接口。
    api.respond('POST', CONVERT, { status: state === 'conflict' ? 409 : 403, json: { success: false, error: {
      code: state === 'conflict' ? 'IDEMPOTENCY_KEY_REUSED' : 'CAPABILITY_NOT_CONFIGURED',
      message: state === 'conflict' ? '该请求标识已用于另一批图片，请更换标识重试' : '该终端此服务尚未完成验收配置，请咨询现场工作人员',
    } } })
  } else {
    api.respond('POST', CONVERT, { status: 200, json: { success: true, data: {
      fileId: 'w2-pdf-001', printFileUrl: W2_FILE.fileUrl, fileMd5: 'd'.repeat(32), sizeBytes: 4096, pages: 1,
      // 服务端转换响应恒带这两项（print-conversion.types.ts）；并排图拍的是未登录游客合成完的样子。
      hasEndUser: false, savedToDocuments: false,
    } } })
  }
  await page.getByRole('button', { name: '合成', exact: true }).click()
  const title = {
    composing: '正在合成', result: 'PDF 已经合成', unknown: '这一次的结果没有确认',
    conflict: '这个标记和上一次撞了', closed: '图片转 PDF：本机暂未开通',
  }[state]
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
}
