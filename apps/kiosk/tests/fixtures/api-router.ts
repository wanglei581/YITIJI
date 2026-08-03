import type { Page, Route } from '@playwright/test'

type AbortErrorCode = Parameters<Route['abort']>[0]

type JsonResponse = {
  status: number
  json: unknown
}

type ApiHandler =
  | { kind: 'response'; response: JsonResponse }
  | { kind: 'abort'; errorCode: AbortErrorCode }

export class ApiRouter {
  readonly #page: Page
  readonly #handlers = new Map<string, ApiHandler>()
  readonly #unhandledRequests = new Set<string>()
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
