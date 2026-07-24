import { expect, type Page } from '@playwright/test'

const FIXTURE_PATH = '/w2-fixtures/sample-visible.pdf'
const MINIMAL_PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj
xref
0 4
${'0000000000 65535 f '}
${'0000000009 00000 n '}
${'0000000052 00000 n '}
${'0000000101 00000 n '}
trailer<</Size 4/Root 1 0 R>>
startxref
162
%%EOF`

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
      await route.fulfill({ status: 200, contentType: 'application/pdf', body: MINIMAL_PDF })
    })
  }

  assertPdfCompleted(): void {
    expect(this.#completed, 'synthetic preview PDF must complete with HTTP 200').toBe(true)
    expect([...this.#unhandled], 'unexpected W2 binary fixture requests').toEqual([])
  }
}
