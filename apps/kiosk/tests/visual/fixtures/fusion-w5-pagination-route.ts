import type { Page, Route } from '@playwright/test'

const OWNED_PATHS = new Set([
  '/api/v1/me/browse-logs',
  '/api/v1/me/external-jump-logs',
])

export interface FusionW5PageEnvelope<T = unknown> {
  items: T[]
  nextCursor: string | null
  total: number
}

interface PaginationResponse {
  pathname: string
  cursor: string | null
  page: FusionW5PageEnvelope
}

export class FusionW5PaginationRoute {
  readonly #page: Page
  readonly #responses = new Map<string, FusionW5PageEnvelope>()
  readonly #unhandled = new Set<string>()
  #installed = false

  constructor(page: Page, responses: PaginationResponse[]) {
    this.#page = page
    for (const response of responses) {
      if (!OWNED_PATHS.has(response.pathname)) {
        throw new Error(`FusionW5PaginationRoute does not own ${response.pathname}`)
      }
      this.#responses.set(responseKey(response.pathname, response.cursor), response.page)
    }
  }

  async install(): Promise<void> {
    if (this.#installed) throw new Error('FusionW5PaginationRoute.install() may only be called once')
    this.#installed = true
    await this.#page.route(/\/api\/v1\/me\/(?:browse-logs|external-jump-logs)(?:\?.*)?$/, async (route) => {
      await this.#handle(route)
    })
  }

  assertNoUnhandledRequests(): void {
    if (this.#unhandled.size === 0) return
    throw new Error(`Unhandled W5 pagination requests:\n${[...this.#unhandled].sort().map((key) => `- ${key}`).join('\n')}`)
  }

  async #handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    if (!OWNED_PATHS.has(url.pathname)) {
      await route.fallback()
      return
    }

    const cursor = url.searchParams.get('cursor')
    const pageSizeValues = url.searchParams.getAll('pageSize')
    const cursorValues = url.searchParams.getAll('cursor')
    const allowedKeys = [...url.searchParams.keys()].every((key) => key === 'cursor' || key === 'pageSize')
    const validQuery = (
      request.method() === 'GET' &&
      allowedKeys &&
      pageSizeValues.length === 1 &&
      pageSizeValues[0] === '50' &&
      cursorValues.length <= 1 &&
      (cursor === null || cursor.length > 0)
    )
    const key = responseKey(url.pathname, cursor)
    const page = validQuery ? this.#responses.get(key) : undefined
    if (!page) {
      this.#unhandled.add(`${request.method()} ${url.pathname}${url.search}`)
      await route.abort('internetdisconnected')
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: page }),
    })
  }
}

function responseKey(pathname: string, cursor: string | null): string {
  return `${pathname} cursor=${cursor ?? '<first>'}`
}
