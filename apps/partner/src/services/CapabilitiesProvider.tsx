import { useEffect, useState, type ReactNode } from 'react'
import { getDataSourceCapabilities } from './api'
import { PartnerCapabilitiesContext, type PartnerCapabilitiesState } from './capabilities'

/** 机构能力单次拉取 + 全控制台共享。语义与 fail-open 约定见 ./capabilities.ts。 */
export function PartnerCapabilitiesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PartnerCapabilitiesState>({ status: 'loading', capabilities: null })

  useEffect(() => {
    let mounted = true
    getDataSourceCapabilities()
      .then((capabilities) => {
        if (mounted) setState({ status: 'ready', capabilities })
      })
      .catch(() => {
        // 静默降级：不弹错误。能力未知 = 全部按可用渲染，服务端仍会拒写。
        if (mounted) setState({ status: 'error', capabilities: null })
      })
    return () => { mounted = false }
  }, [])

  return (
    <PartnerCapabilitiesContext.Provider value={state}>
      {children}
    </PartnerCapabilitiesContext.Provider>
  )
}
