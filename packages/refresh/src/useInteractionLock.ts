import { useEffect } from 'react'
import { useRefreshContext } from './RefreshProvider'
import type { RefreshLockMode, RefreshResourceKey } from './store'

export function useInteractionLock(
  active: boolean,
  keys: RefreshResourceKey[],
  mode: RefreshLockMode = 'hard',
): void {
  const { store } = useRefreshContext()
  const keySignature = keys.join('\u0000')

  useEffect(() => {
    if (!active || keySignature.length === 0) return
    const lockKeys = keySignature.split('\u0000')
    const releases = lockKeys.map((key) => store.lock(key, mode))
    return () => {
      releases.forEach((release) => release())
    }
  }, [active, keySignature, mode, store])
}
