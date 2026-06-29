export type RefreshResourceKey = string
export type RefreshStatus = 'idle' | 'loading' | 'ready' | 'error'
export type RefreshFailPolicy = 'keep-last' | 'reset'
export type RefreshLockMode = 'hard' | 'soft'
export type RefreshMergeFn<T> = (current: T | undefined, incoming: T) => T

interface RefreshLockState {
  hard: number
  soft: number
}

export interface RefreshEntry<T> {
  key: RefreshResourceKey
  status: RefreshStatus
  data: T | undefined
  pending: T | undefined
  error: unknown
  lastFetchedAt: number
  nextFetchAt: number
  inFlight: Promise<void> | null
  subscribers: Set<() => void>
}

export interface RefreshResourceOptions<T> {
  key: RefreshResourceKey
  fetcher: () => Promise<T>
  intervalMs: number
  merge: RefreshMergeFn<T>
  failPolicy: RefreshFailPolicy
  resetValue?: T
  refetchOnFocus?: boolean
}

export class RefreshStore {
  private readonly entries = new Map<RefreshResourceKey, RefreshEntry<unknown>>()
  private readonly resources = new Map<RefreshResourceKey, RefreshResourceOptions<unknown>>()
  private readonly locks = new Map<RefreshResourceKey, RefreshLockState>()
  private lastUserActivityAt = Date.now()
  private idleMs = 15_000
  private paused = false

  setIdleMs(idleMs: number): void {
    this.idleMs = idleMs
  }

  markUserActivity(now = Date.now()): void {
    this.lastUserActivityAt = now
  }

  isIdle(now = Date.now()): boolean {
    return now - this.lastUserActivityAt >= this.idleMs
  }

  setPaused(paused: boolean): void {
    this.paused = paused
  }

  isPaused(): boolean {
    return this.paused
  }

  lock(key: RefreshResourceKey, mode: RefreshLockMode = 'hard'): () => void {
    const state = this.locks.get(key) ?? { hard: 0, soft: 0 }
    const nextState = { ...state, [mode]: state[mode] + 1 }
    this.locks.set(key, nextState)
    let released = false
    return () => {
      if (released) return
      released = true
      const current = this.locks.get(key) ?? { hard: 0, soft: 0 }
      const releasedState = { ...current, [mode]: Math.max(0, current[mode] - 1) }
      if (releasedState.hard === 0 && releasedState.soft === 0) this.locks.delete(key)
      else this.locks.set(key, releasedState)

      if (!this.locks.has(key)) {
        this.applyPending(key)
        this.cleanupIfOrphan(key)
      }
    }
  }

  getSnapshot<T>(key: RefreshResourceKey): RefreshEntry<T> | undefined {
    return this.entries.get(key) as RefreshEntry<T> | undefined
  }

  subscribe(key: RefreshResourceKey, callback: () => void): () => void {
    const entry = this.ensureEntry<unknown>(key)
    entry.subscribers.add(callback)
    return () => {
      entry.subscribers.delete(callback)
      this.cleanupIfOrphan(key)
    }
  }

  register<T>(options: RefreshResourceOptions<T>): () => void {
    const normalized = options as RefreshResourceOptions<unknown>
    this.resources.set(options.key, normalized)
    this.ensureEntry<T>(options.key)
    return () => {
      if (this.resources.get(options.key) === normalized) this.resources.delete(options.key)
      this.cleanupIfOrphan(options.key)
    }
  }

  async refresh<T>(key: RefreshResourceKey): Promise<void> {
    const options = this.resources.get(key) as RefreshResourceOptions<T> | undefined
    if (!options) return
    const entry = this.ensureEntry<T>(key)
    if (entry.inFlight) return entry.inFlight
    const inFlight = this.runRefresh(key, options)
    const shouldEmitLoading = entry.data === undefined
    this.replaceEntry<T>(key, (current) => ({
      ...current,
      status: shouldEmitLoading ? 'loading' : current.status,
      inFlight,
    }))
    if (shouldEmitLoading) this.emit(key)
    return inFlight
  }

  tick(now: number): void {
    if (this.paused || !this.isIdle(now)) return
    this.resources.forEach((_options, key) => {
      const entry = this.ensureEntry<unknown>(key)
      if (entry.inFlight === null && now >= entry.nextFetchAt) void this.refresh(key)
    })
  }

  refreshOnFocus(): void {
    const now = Date.now()
    if (this.paused || !this.isIdle(now)) return
    Array.from(this.resources.entries()).forEach(([key, options], index) => {
      if (options.refetchOnFocus === false) return
      const entry = this.ensureEntry<unknown>(key)
      if (entry.inFlight !== null || now < entry.nextFetchAt) return
      globalThis.setTimeout(() => {
        const latest = this.ensureEntry<unknown>(key)
        if (this.paused || !this.isIdle() || latest.inFlight !== null || Date.now() < latest.nextFetchAt) return
        void this.refresh(key)
      }, index * 150)
    })
  }

  private async runRefresh<T>(key: RefreshResourceKey, options: RefreshResourceOptions<T>): Promise<void> {
    let shouldEmit = true
    try {
      const incoming = await options.fetcher()
      const now = Date.now()
      const entry = this.ensureEntry<T>(key)
      const merged = options.merge(entry.data, incoming)
      const lockMode = this.getLockMode(options.key)
      this.replaceEntry<T>(key, (current) => ({
        ...current,
        data: lockMode ? current.data : merged,
        pending: lockMode ? merged : current.pending,
        error: null,
        status: 'ready',
        lastFetchedAt: now,
        nextFetchAt: now + options.intervalMs,
      }))
      shouldEmit = lockMode !== 'hard'
    } catch (error) {
      const entry = this.ensureEntry<T>(key)
      const data = entry.data === undefined && options.failPolicy === 'reset' ? options.resetValue : entry.data
      this.replaceEntry<T>(key, (current) => ({
        ...current,
        data,
        error,
        status: data === undefined ? 'error' : 'ready',
        nextFetchAt: Date.now() + Math.max(5000, Math.min(options.intervalMs, 30_000)),
      }))
    } finally {
      this.replaceEntry<T>(key, (current) => ({
        ...current,
        inFlight: null,
      }))
      if (shouldEmit) this.emit(options.key)
      this.cleanupIfOrphan(options.key)
    }
  }

  private applyPending(key: RefreshResourceKey): void {
    const entry = this.entries.get(key)
    if (entry?.pending === undefined) return
    this.replaceEntry(key, (current) => ({
      ...current,
      data: current.pending,
      pending: undefined,
    }))
    this.emit(key)
  }

  private getLockMode(key: RefreshResourceKey): RefreshLockMode | null {
    const state = this.locks.get(key)
    if (!state) return null
    if (state.hard > 0) return 'hard'
    if (state.soft > 0) return 'soft'
    return null
  }

  private ensureEntry<T>(key: RefreshResourceKey): RefreshEntry<T> {
    const existing = this.entries.get(key)
    if (existing) return existing as RefreshEntry<T>
    const created: RefreshEntry<T> = {
      key,
      status: 'idle',
      data: undefined,
      pending: undefined,
      error: null,
      lastFetchedAt: 0,
      nextFetchAt: 0,
      inFlight: null,
      subscribers: new Set(),
    }
    this.entries.set(key, created as RefreshEntry<unknown>)
    return created
  }

  private replaceEntry<T>(
    key: RefreshResourceKey,
    update: (entry: RefreshEntry<T>) => RefreshEntry<T>,
  ): RefreshEntry<T> {
    const current = this.ensureEntry<T>(key)
    const next = update(current)
    this.entries.set(key, next as RefreshEntry<unknown>)
    return next
  }

  private cleanupIfOrphan(key: RefreshResourceKey): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (this.resources.has(key) || entry.subscribers.size > 0 || entry.inFlight !== null || this.locks.has(key)) return
    this.entries.delete(key)
  }

  private emit(key: RefreshResourceKey): void {
    const entry = this.entries.get(key)
    if (!entry) return
    entry.subscribers.forEach((callback) => callback())
  }
}
