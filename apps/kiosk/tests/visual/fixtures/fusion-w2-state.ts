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

/** 打印交接上下文（打印材料会话 v2）在 sessionStorage 里的键；清场清单按这个键判断。 */
export const PRINT_HANDOFF_KEY = 'ai-job-print:current-print-material-check'

export async function setReactRouterState(page: Page, path: string, usr: unknown): Promise<void> {
  await page.evaluate(
    ({ nextPath, state }) => {
      window.history.replaceState({ usr: state, key: 'w2-fixture', idx: 0 }, '', nextPath)
    },
    { nextPath: path, state: usr },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
}

/** 一份检查齐全、无需遮挡的材料检查结论（打印台放行预览的最低条件）。 */
export const W2_MATERIAL_CHECK = {
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
}

/**
 * 写一份打印交接上下文（v2）时可以覆盖的字段。
 *
 * 时间一律在**浏览器里**按「现在」算：createdAt = now − ageMs，expiresAt = createdAt + 30 分钟。
 * 写死一个日期的话，过了有效期那天所有用例会一起红。
 * `materialCheck: null` / `printParams: null` 表示不写这一项。
 */
export interface PrintHandoffSeed {
  contextId?: string
  origin?: string
  source?: 'resume' | 'document'
  file?: Record<string, unknown>
  checkPolicy?: 'required' | 'exempt'
  materialCheck?: Record<string, unknown> | null
  printParams?: Record<string, unknown> | null
  paramsSuggestion?: Record<string, unknown>
  owner?: { kind: 'guest' } | { kind: 'member'; mark: string }
  returnPath?: string
  ageMs?: number
  /** 直接写这一份（测旧结构、坏结构用）；给了就原样写，不再拼 v2 字段。 */
  raw?: unknown
}

const HANDOFF_TTL_MS = 30 * 60 * 1000

const HANDOFF_DEFAULTS: Record<string, unknown> = {
  contextId: 'w2ctx-000000000001',
  origin: 'upload',
  source: 'document',
  file: W2_FILE,
  checkPolicy: 'required',
  materialCheck: W2_MATERIAL_CHECK,
  printParams: W2_PRINT_PARAMS,
}

type HandoffWriteArgs = { key: string; seed: PrintHandoffSeed; defaults: Record<string, unknown>; ttlMs: number }

/** 在浏览器里执行：按 seed 拼出一份 v2 上下文并写进 sessionStorage。必须自包含（会被序列化进页面）。 */
function writeHandoffInBrowser({ key, seed, defaults, ttlMs }: HandoffWriteArgs): void {
  if (seed.raw !== undefined) {
    window.sessionStorage.setItem(key, typeof seed.raw === 'string' ? seed.raw : JSON.stringify(seed.raw))
    return
  }
  const createdAtMs = Date.now() - (seed.ageMs ?? 0)
  const value: Record<string, unknown> = {
    v: 2,
    contextId: seed.contextId ?? defaults['contextId'],
    origin: seed.origin ?? defaults['origin'],
    source: seed.source ?? defaults['source'],
    file: seed.file ?? defaults['file'],
    fileUrlExpiresAt: null,
    owner: seed.owner ?? { kind: 'guest' },
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
    checkPolicy: seed.checkPolicy ?? defaults['checkPolicy'],
    updatedAt: new Date(createdAtMs).toISOString(),
  }
  if (seed.returnPath) value['returnPath'] = seed.returnPath
  if (seed.paramsSuggestion) value['paramsSuggestion'] = seed.paramsSuggestion
  const materialCheck = seed.materialCheck === undefined ? defaults['materialCheck'] : seed.materialCheck
  if (materialCheck) value['materialCheck'] = materialCheck
  const printParams = seed.printParams === undefined ? defaults['printParams'] : seed.printParams
  if (printParams) value['printParams'] = printParams
  window.sessionStorage.setItem(key, JSON.stringify(value))
}

function handoffArgs(seed: PrintHandoffSeed): HandoffWriteArgs {
  return { key: PRINT_HANDOFF_KEY, seed, defaults: HANDOFF_DEFAULTS, ttlMs: HANDOFF_TTL_MS }
}

/** 在当前页面写一次打印交接上下文；之后的 reload 不会重写。 */
export async function writePrintHandoff(page: Page, seed: PrintHandoffSeed = {}): Promise<void> {
  await page.evaluate(writeHandoffInBrowser, handoffArgs(seed))
}

/** 每次文档加载前都写一次（addInitScript）：适合「打开页面就要有上下文」的用例。 */
export async function seedPrintHandoff(page: Page, seed: PrintHandoffSeed = {}): Promise<void> {
  await page.addInitScript(writeHandoffInBrowser, handoffArgs(seed))
}

/** Writes the print handoff context (checked W2 file, guest owner) once on the current origin. Does not re-apply on reload. */
export async function writeMaterialSession(page: Page): Promise<void> {
  await writePrintHandoff(page)
}

/** Seeds the same checked W2 handoff context before every document load. */
export async function seedMaterialSession(page: Page): Promise<void> {
  await seedPrintHandoff(page)
}

/** 读回当前的打印交接上下文（原样 JSON），给断言用。 */
export async function readPrintHandoffRaw(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => JSON.parse(window.sessionStorage.getItem(key) ?? 'null') as Record<string, unknown> | null, PRINT_HANDOFF_KEY)
}

export const SCAN_WORKBENCH_SESSION_KEY = 'ai-job-print:current-scan-workbench'

export async function writeScanWorkbenchSession(
  page: Page,
  session: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ key, value }) => {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    },
    { key: SCAN_WORKBENCH_SESSION_KEY, value: session },
  )
}
