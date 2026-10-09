import { useEffect, useRef, useState } from 'react'
import { getAdvisorAvailability } from '../../services/api/advisor'
import type { TabKey } from './shared'

/** 本次进入只读一次，与政策列表独立；切走后的订阅不再写状态。 */
export function usePolicyAdvisorAvailability(activeTab: TabKey): boolean | undefined {
  const [available, setAvailable] = useState<boolean>()
  const pending = useRef<Promise<boolean | undefined> | null>(null)
  useEffect(() => {
    pending.current ??= getAdvisorAvailability().catch(() => undefined)
    if (activeTab !== 'policy') return
    let cancelled = false
    void pending.current.then((result) => {
      if (cancelled) return
      setAvailable(result)
    })
    return () => { cancelled = true }
  }, [activeTab])
  return available
}
