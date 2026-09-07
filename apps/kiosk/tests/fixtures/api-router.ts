import type { Page, Route } from '@playwright/test'

export type AbortErrorCode = Parameters<Route['abort']>[0]

export type JsonResponse = {
  status: number
  json: unknown
}

export type DynamicResult = JsonResponse | { abort: AbortErrorCode }
type DynamicResponder = (requestNumber: number) => DynamicResult | Promise<DynamicResult>

type ApiHandler =
  | { kind: 'response'; response: JsonResponse }
  | { kind: 'abort'; errorCode: AbortErrorCode }
  | { kind: 'dynamic'; responder: DynamicResponder }

export class ApiRouter {
  readonly #page: Page
  readonly #handlers = new Map<string, ApiHandler>()
  readonly #unhandledRequests = new Set<string>()
  readonly #requestCounts = new Map<string, number>()
  #installed = false

  constructor(page: Page) {
    this.#page = page
    // 包 F：优化 / 生成预览 / 导出页挂载时都会读导出收费口径（GET /resume/export/pricing）。
    // 默认按「免费」应答，让所有既有用例不因这条新请求中断；收费 / 未开放态的用例自行 respond 覆盖。
    this.respond('GET', '/api/v1/resume/export/pricing', {
      status: 200,
      json: { mode: 'free', unitCents: 0, unit: '份', benefit: null, label: '免费导出' },
    })
    // 包 K2：上传 / 预览页挂载时都会探测文档转换能力（GET /document-conversion/capabilities）。
    // 默认按「引擎未配置」应答，让所有既有用例保持 Word 入口置灰、不中断；需要开放态的用例自行 respond 覆盖。
    this.respond('GET', '/api/v1/document-conversion/capabilities', {
      status: 200,
      json: { data: { wordToPdf: false, engine: 'none', cjkFonts: false, reason: '服务端未配置转换引擎' } },
    })
    // 生成预览 / 优化页挂载时都会读模板列表。默认空列表，不伪造模板；需要模板的用例自行覆盖。
    this.respond('GET', '/api/v1/job-materials/templates', {
      status: 200,
      json: { success: true, data: [] },
    })
  }

  async install(): Promise<void> {
    if (this.#installed) {
      throw new Error('ApiRouter.install() may only be called once per page')
    }

    this.#installed = true
    await this.#page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const pathname = new URL(request.url()).pathname
      const key = requestKey(request.method(), pathname)
      const requestNumber = (this.#requestCounts.get(key) ?? 0) + 1
      this.#requestCounts.set(key, requestNumber)
      const handler = this.#handlers.get(key)

      if (!handler) {
        if (isAnonymousDraftOrVersions(request.method(), pathname)) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请先提交简历解析' },
            }),
          })
          return
        }
        this.#unhandledRequests.add(key)
        await route.abort('internetdisconnected')
        return
      }

      if (handler.kind === 'abort') {
        await route.abort(handler.errorCode)
        return
      }

      if (handler.kind === 'dynamic') {
        const result = await handler.responder(requestNumber)
        if ('abort' in result) {
          await route.abort(result.abort)
          return
        }
        await route.fulfill({
          status: result.status,
          contentType: 'application/json',
          body: JSON.stringify(result.json),
        })
        return
      }

      await route.fulfill({
        status: handler.response.status,
        contentType: 'application/json',
        body: JSON.stringify(handler.response.json),
      })
    })
  }

  respond(method: string, path: string, response: JsonResponse): void {
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new Error(`Invalid HTTP status for ApiRouter response: ${response.status}`)
    }

    this.#handlers.set(requestKey(method, path), { kind: 'response', response })
  }

  abort(method: string, path: string, errorCode: AbortErrorCode): void {
    this.#handlers.set(requestKey(method, path), { kind: 'abort', errorCode })
  }

  respondWith(method: string, path: string, responder: DynamicResponder): void {
    this.#handlers.set(requestKey(method, path), { kind: 'dynamic', responder })
  }

  requestCount(method: string, path: string): number {
    return this.#requestCounts.get(requestKey(method, path)) ?? 0
  }

  assertNoUnhandledRequests(): void {
    if (this.#unhandledRequests.size === 0) return

    const requests = [...this.#unhandledRequests].sort()
    throw new Error(`Unhandled API requests:\n${requests.map((key) => `- ${key}`).join('\n')}`)
  }
}

function isAnonymousDraftOrVersions(method: string, path: string): boolean {
  const normalized = method.trim().toUpperCase()
  if (!/^\/api\/v1\/resume\/records\/[^/]+\/(draft|versions)$/.test(path)) return false
  return normalized === 'GET' || normalized === 'PUT'
}

function requestKey(method: string, path: string): string {
  const normalizedMethod = method.trim().toUpperCase()
  if (!normalizedMethod) {
    throw new Error('ApiRouter method must not be empty')
  }
  if (!path.startsWith('/api/v1/')) {
    throw new Error(`ApiRouter path must start with /api/v1/: ${path}`)
  }
  if (path.includes('?') || path.includes('#')) {
    throw new Error(`ApiRouter path must not include a query string or fragment: ${path}`)
  }

  return `${normalizedMethod} ${path}`
}
