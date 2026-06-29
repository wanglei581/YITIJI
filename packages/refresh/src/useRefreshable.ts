import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useRefreshContext } from './RefreshProvider'
import type {
  RefreshFailPolicy,
  RefreshMergeFn,
  RefreshResourceKey,
  RefreshStatus,
} from './store'

export interface UseRefreshableOptions<T> {
  intervalMs: number
  merge: RefreshMergeFn<T>
  failPolicy?: RefreshFailPolicy
  resetValue?: T
  refetchOnFocus?: boolean
}

interface UseRefreshableConfig<T> {
  fetcher: () => Promise<T>
  options: UseRefreshableOptions<T>
}

export interface UseRefreshableResult<T> {
  data: T | undefined
  status: RefreshStatus
  error: unknown
  hasPending: boolean
  refresh: () => Promise<void>
}

export function useRefreshable<T>(
  key: RefreshResourceKey,
  fetcher: () => Promise<T>,
  options: UseRefreshableOptions<T>,
): UseRefreshableResult<T> {
  const { store } = useRefreshContext()
  const configRef = useRef<UseRefreshableConfig<T>>({ fetcher, options })
  configRef.current = { fetcher, options }

  const snapshot = useSyncExternalStore(
    (callback) => store.subscribe(key, callback),
    () => store.getSnapshot<T>(key),
    () => store.getSnapshot<T>(key),
  )

  const refresh = useCallback(() => {
    return store.refresh<T>(key)
  }, [key, store])

  useEffect(() => {
    const unregister = store.register<T>({
      key,
      fetcher: () => configRef.current.fetcher(),
      get intervalMs() {
        return configRef.current.options.intervalMs
      },
      merge: (current, incoming) => configRef.current.options.merge(current, incoming),
      get failPolicy() {
        return configRef.current.options.failPolicy ?? 'keep-last'
      },
      get resetValue() {
        return configRef.current.options.resetValue
      },
      get refetchOnFocus() {
        return configRef.current.options.refetchOnFocus ?? true
      },
    })
    return unregister
  }, [key, store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    data: snapshot?.data,
    status: snapshot?.status ?? 'idle',
    error: snapshot?.error ?? null,
    hasPending: snapshot?.pending !== undefined,
    refresh,
  }
}
