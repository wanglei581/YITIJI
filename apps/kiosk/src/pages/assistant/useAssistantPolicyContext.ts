import { useEffect, useState } from 'react'
import { takeAssistantPolicyContext, type AssistantPolicyContext } from '../../services/assistantDraft'
import { subscribeKioskSensitiveSessionClear } from '../../auth/kioskSensitiveSession'

/** effect 重放时只接纳读到的值；不把第二次空读覆盖回 state。离页后没有持久副本。 */
export function useAssistantPolicyContext(): [AssistantPolicyContext | null, () => void] {
  const [context, setContext] = useState<AssistantPolicyContext | null>(null)
  useEffect(() => {
    const policy = takeAssistantPolicyContext()
    if (policy) setContext(policy)
    return subscribeKioskSensitiveSessionClear(() => setContext(null))
  }, [])
  return [context, () => setContext(null)]
}
