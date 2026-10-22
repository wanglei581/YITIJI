export const CONTENT_CHECK_INTERVAL_MS = 5 * 60_000
export const CONTENT_UPDATE_IDLE_MS = 60_000

export interface ContentRelease {
  version: string
  assets: string[]
}

export function readContentRelease(document: Document, baseUrl: string): ContentRelease | null {
  const version = document.querySelector<HTMLMetaElement>(
    'meta[name="kiosk-content-version"]'
  )?.content
  if (!version || !/^[a-f0-9-]{36}$/.test(version) || !document.getElementById('root')) return null
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
  if (scripts.length === 0) return null
  const paths = [
    ...scripts.map((script) => script.getAttribute('src')!),
    ...[...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')].map(
      (link) => link.getAttribute('href')!
    ),
  ]
  const base = new URL(baseUrl)
  const assets = paths.map((path) => new URL(path, base).href)
  if (assets.some((asset) => new URL(asset).origin !== base.origin)) return null
  return { version, assets: [...new Set(assets)] }
}

export async function fetchContentRelease(
  indexUrl: string,
  verifyAssets: boolean,
  signal: AbortSignal
): Promise<ContentRelease | null> {
  const options: RequestInit = { cache: 'no-store', credentials: 'omit', redirect: 'error', signal }
  const response = await fetch(indexUrl, options)
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null
  const release = readContentRelease(
    new DOMParser().parseFromString(await response.text(), 'text/html'),
    indexUrl
  )
  if (!release || !verifyAssets) return release
  // An SPA fallback returning HTML for a missing JS/CSS asset is not a usable release.
  for (const asset of release.assets) {
    const probe = await fetch(asset, { ...options, method: 'HEAD' })
    const type = probe.headers.get('content-type') ?? ''
    if (
      !probe.ok ||
      !/^(?:text\/css|(?:text|application)\/(?:javascript|ecmascript))(?:;|$)/i.test(type)
    ) {
      throw new Error('Content asset unavailable')
    }
  }
  return release
}

interface ContentUpdateOptions {
  currentVersion: string
  readPublished: (verifyAssets: boolean, signal: AbortSignal) => Promise<ContentRelease | null>
  canReload: () => boolean
  reload: () => void
  now?: () => number
}

export class ContentUpdateController {
  private readonly now: () => number
  private lastActivityAt: number
  private safeSince: number | null = null
  private nextCheckAt = 0
  private retryAt = 0
  private pending: string | null = null
  private request: AbortController | null = null
  private stopped = false
  private reloaded = false

  constructor(private readonly options: ContentUpdateOptions) {
    this.now = options.now ?? Date.now
    this.lastActivityAt = this.now()
  }

  markActivity(): void {
    this.lastActivityAt = this.now()
    this.safeSince = null
  }

  private idleAndSafe(): boolean {
    if (!this.options.canReload()) {
      this.safeSince = null
      return false
    }
    this.safeSince ??= this.now()
    return this.now() - Math.max(this.lastActivityAt, this.safeSince) >= CONTENT_UPDATE_IDLE_MS
  }

  async tick(): Promise<void> {
    if (this.stopped || this.reloaded) return
    const safe = this.idleAndSafe()
    if (this.now() >= this.nextCheckAt || (this.pending && safe && this.now() >= this.retryAt)) {
      await this.check(Boolean(this.pending && safe))
    }
  }

  async check(allowReload = false): Promise<void> {
    if (this.stopped || this.reloaded || this.request) return
    const request = new AbortController()
    this.request = request
    this.nextCheckAt = this.now() + CONTENT_CHECK_INTERVAL_MS
    const timeout = setTimeout(() => request.abort(), 10_000)
    try {
      const release = await this.options.readPublished(allowReload, request.signal)
      if (this.stopped || request.signal.aborted) return
      this.pending =
        release && release.version !== this.options.currentVersion ? release.version : null
      if (this.pending && allowReload && this.idleAndSafe()) {
        this.reloaded = true
        this.options.reload()
      }
    } catch {
      this.retryAt = this.now() + CONTENT_CHECK_INTERVAL_MS
    } finally {
      clearTimeout(timeout)
      if (this.request === request) this.request = null
    }
  }

  stop(): void {
    this.stopped = true
    this.request?.abort()
  }
}
