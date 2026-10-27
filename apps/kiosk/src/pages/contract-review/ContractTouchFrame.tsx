import type { ReactNode } from 'react'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import './contract-review-touch.css'

/** 合同三页在 KioskRoot 之外，舞台缩放和整屏高度都靠这层壳。 */
export function ContractTouchFrame({ children }: { children: ReactNode }) {
  return (
    <KioskFullscreenShell hideTopbar className="cr-touch-shell">
      <div data-qx-page="contract-review" className="cr-touch-fill">
        {children}
      </div>
    </KioskFullscreenShell>
  )
}
