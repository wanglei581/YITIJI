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
  }

  async install(): Promise<void> {
    if (this.#installed) {
      throw new Error('ApiRouter.install() may only be called once per page')
    }

    this.#installed = true
    await this.#page.route('**/api/v1/**', async (route) => {
      const request = route.request()
      const key = requestKey(request.method(), new URL(request.url()).pathname)
      const requestNumber = (this.#requestCounts.get(key) ?? 0) + 1
      this.#requestCounts.set(key, requestNumber)
      const handler = this.#handlers.get(key)

      if (!handler) {
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
