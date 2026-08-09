import { expect, type Page } from '@playwright/test'

const FIXTURE_PATH = '/w2-fixtures/sample-visible.pdf'

function buildVisiblePdf(): string {
  const stream = '0 0 0 rg\n30 30 140 140 re f\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'))
    pdf += object
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

export const VISIBLE_PDF = buildVisiblePdf()

export class FusionW2BinaryRoute {
  readonly #page: Page
  #completed = false
  readonly #unhandled = new Set<string>()

  constructor(page: Page) {
    this.#page = page
  }

  async install(): Promise<void> {
    this.#page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.pathname === FIXTURE_PATH && response.status() === 200) this.#completed = true
    })
    await this.#page.route('**/w2-fixtures/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path !== FIXTURE_PATH) {
        this.#unhandled.add(path)
        await route.abort('blockedbyclient')
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: VISIBLE_PDF })
    })
  }

  assertPdfCompleted(): void {
    expect(this.#completed, 'synthetic preview PDF must complete with HTTP 200').toBe(true)
    expect([...this.#unhandled], 'unexpected W2 binary fixture requests').toEqual([])
    expect(VISIBLE_PDF, 'fixture PDF must contain a visible filled rectangle').toContain('140 140 re f')
  }
}
