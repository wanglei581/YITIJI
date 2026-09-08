import type { Page } from '@playwright/test'

export const W2_FILE = {
  fileId: 'w2-file-001',
  fileUrl: '/w2-fixtures/sample-visible.pdf',
  fileMd5: 'a'.repeat(64),
  name: 'w2-sample.pdf',
  size: '128 KB',
  pages: 2,
  mimeType: 'application/pdf',
} as const

export const W2_PRINT_PARAMS = {
  copies: 1,
  colorMode: 'black_white',
  duplex: 'simplex',
  paperSize: 'A4',
  pageRange: 'all',
  orientation: 'auto',
  quality: 'standard',
  scale: 'fit',
  pagesPerSheet: 1,
} as const

export const W2_ORDER = {
  orderId: 'w2-order-001',
  orderNo: 'W2-ORDER-001',
  amountCents: 200,
  paymentSessionToken: 'fixture-payment-session',
  taskId: 'w2-task-001',
} as const

const MATERIAL_SESSION_KEY = 'ai-job-print:current-print-material-check'

export async function setReactRouterState(page: Page, path: string, usr: unknown): Promise<void> {
  await page.evaluate(
    ({ nextPath, state }) => {
      window.history.replaceState({ usr: state, key: 'w2-fixture', idx: 0 }, '', nextPath)
    },
    { nextPath: path, state: usr },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
}

const MATERIAL_SESSION_VALUE = {
  file: W2_FILE,
  source: 'document' as const,
  materialCheck: {
    inspectionTaskId: 'w2-inspection-001',
    normalizeTaskId: 'w2-normalize-001',
    piiTaskId: 'w2-pii-001',
    piiRedactTaskId: 'w2-pii-redact-001',
    checkedAt: '2026-07-24T00:00:00.000Z',
    findingCount: 0,
    redactedCount: 0,
    keptCount: 0,
    redaction: {
      claim: 'nothing_to_redact' as const,
      redactedFileId: null,
      appliedRedactedCount: 0,
      failedNoPositionCount: 0,
      keptCount: 0,
      reverifyRemainingCount: null,
      reverifyRan: false,
    },
    mode: 'checked' as const,
  },
  printParams: W2_PRINT_PARAMS,
  updatedAt: '2026-07-24T00:00:00.000Z',
}

/** Writes the print material session once on the current origin. Does not re-apply on reload. */
export async function writeMaterialSession(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    },
    { key: MATERIAL_SESSION_KEY, value: MATERIAL_SESSION_VALUE },
  )
}

export async function seedMaterialSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    },
    { key: MATERIAL_SESSION_KEY, value: MATERIAL_SESSION_VALUE },
  )
}
