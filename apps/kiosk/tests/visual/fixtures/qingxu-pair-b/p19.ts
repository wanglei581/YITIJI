// 稿 19：图片转 PDF。只给能在运行页上对上的五态配地址，其余仍不截运行页。
import { deflateSync } from 'node:zlib'
import { expect, type Page } from '@playwright/test'
import type { ApiRouter } from '../../../fixtures/api-router'
import type { QingxuPairTarget } from '../qingxu-pair-targets'
import type { ResumePageFixture } from './types'

const PAIRED = new Set(['empty', 'ready-three', 'merging', 'completed-auth', 'known-failed'])

type Rgb = [number, number, number]

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const body = Buffer.concat([head.subarray(4), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head, data, tail])
}

function png(width: number, height: number, paint: (x: number, y: number) => Rgb): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y)
      const i = row + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function inside(x: number, y: number, left: number, top: number, width: number, height: number): boolean {
  return x >= left && y >= top && x < left + width && y < top + height
}

function paperLines(x: number, y: number, ink: Rgb, paper: Rgb): Rgb {
  if (y > 70 && y < 250 && y % 28 < 3 && x > 28 && x < 200) return ink
  return paper
}

const idFront = png(240, 320, (x, y) => {
  if (y < 56) return [18, 74, 138]
  if (inside(x, y, 18, 78, 78, 96)) return [186, 204, 224]
  if (inside(x, y, 36, 96, 42, 52)) return [90, 112, 132]
  return paperLines(x, y, [28, 58, 96], [244, 247, 252])
})

const diploma = png(240, 320, (x, y) => {
  if (x < 14 || y < 14 || x > 225 || y > 305) return [156, 42, 36]
  if (inside(x, y, 78, 210, 84, 84) && (x - 120) ** 2 + (y - 252) ** 2 < 34 ** 2) return [168, 48, 42]
  if (y > 48 && y < 78) return [120, 36, 32]
  return paperLines(x, y, [90, 62, 40], [255, 248, 236])
})

const transcript = png(240, 320, (x, y) => {
  if (y < 48) return [20, 90, 70]
  if (y > 64 && (y - 64) % 36 < 2) return [180, 190, 186]
  if (x > 24 && x < 216 && x % 64 < 2 && y > 64 && y < 280) return [180, 190, 186]
  return [252, 252, 248]
})

const DOCS = [
  { name: '身份证-正面.jpg', fileId: 'pair19-id-front', url: '/pair19/id-front.png', bytes: idFront, mb: 1.2 },
  { name: '毕业证-正面.jpg', fileId: 'pair19-diploma', url: '/pair19/diploma.png', bytes: diploma, mb: 2.1 },
  { name: '成绩单-第1页.jpg', fileId: 'pair19-score-1', url: '/pair19/score-1.png', bytes: transcript, mb: 1.6 },
]

async function routeThumbs(page: Page): Promise<void> {
  for (const doc of DOCS) {
    await page.route(`**${doc.url}`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: doc.bytes }),
    )
  }
}

function registerUploads(api: ApiRouter): void {
  let next = 0
  api.respondWith('POST', '/api/v1/files/kiosk-upload', () => {
    const doc = DOCS[Math.min(next, DOCS.length - 1)]!
    next += 1
    return {
      status: 200,
      json: {
        success: true,
        data: {
          fileId: doc.fileId,
          filename: doc.name,
          sizeBytes: Math.round(doc.mb * 1024 * 1024),
          mimeType: 'image/jpeg',
          sha256: 'a'.repeat(64),
          signedUrl: doc.url,
          signedUrlExpiresAt: '2026-10-07T00:10:00.000Z',
          fileExpiresAt: '2026-10-08T00:00:00.000Z',
        },
      },
    }
  })
}

async function uploadThree(page: Page): Promise<void> {
  const input = page.locator('input[type="file"]')
  for (const doc of DOCS) {
    await input.setInputFiles({ name: doc.name, mimeType: 'image/png', buffer: doc.bytes })
    await expect(page.getByText(doc.name, { exact: true })).toBeVisible()
  }
  const thumb = page.getByRole('img', { name: '身份证-正面.jpg 缩略图' })
  await expect(thumb).toBeVisible()
  await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
}

async function openConvert(page: Page): Promise<void> {
  await page.goto('/print-scan/convert', { waitUntil: 'load' })
  await expect(page.locator('[data-w2-page="print-scan-convert"]')).toBeVisible()
}

export const page19: ResumePageFixture = {
  prefix: '19-',
  plan(screen, state) {
    if (screen !== 'main' || !PAIRED.has(state)) return null
    return {
      plan: { kind: 'resume-pages' },
      reason: null,
      marker: '[data-w2-page="print-scan-convert"]',
      runtimePath: '/print-scan/convert',
    }
  },
  async prepare(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
    await routeThumbs(page)
    if (target.state === 'empty') {
      await openConvert(page)
      await expect(page.locator('[data-state="empty"]')).toBeVisible()
      await expect(page.getByText('带走一份按顺序排好的 PDF').first()).toBeVisible()
      return
    }

    registerUploads(api)
    if (target.state === 'merging') {
      api.respondWith(
        'POST',
        '/api/v1/print/convert/images-to-pdf',
        () => new Promise<{ status: number; json: unknown }>(() => undefined),
      )
    } else if (target.state === 'completed-auth') {
      api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
        status: 200,
        json: {
          success: true,
          data: {
            fileId: 'pair19-pdf-auth',
            printFileUrl: '/pair19/out.pdf',
            fileMd5: 'b'.repeat(32),
            sizeBytes: Math.round(2.4 * 1024 * 1024),
            pages: 3,
            hasEndUser: true,
          },
        },
      })
    } else if (target.state === 'known-failed') {
      api.respond('POST', '/api/v1/print/convert/images-to-pdf', {
        status: 422,
        json: { success: false, error: { code: 'CONVERT_FAILED', message: 'PDF 生成校验失败，请重试' } },
      })
    }

    await openConvert(page)
    await uploadThree(page)
    await expect(page.locator('[data-state="edit"]')).toBeVisible()
    if (target.state === 'ready-three') return

    await page.getByRole('button', { name: /合成 3 张为一份 PDF/ }).click()
    if (target.state === 'merging') {
      await expect(page.locator('[data-state="converting"]')).toBeVisible()
      await expect(page.getByText('正在合成').first()).toBeVisible()
      return
    }
    if (target.state === 'completed-auth') {
      await expect(page.locator('[data-state="completed"]')).toBeVisible()
      await expect(page.getByText('PDF 已生成').first()).toBeVisible()
      return
    }
    await expect(page.getByText('PDF 生成校验失败，请重试', { exact: true })).toBeVisible()
    await expect(page.getByText('明确失败 · 可原样重试')).toBeVisible()
  },
}
