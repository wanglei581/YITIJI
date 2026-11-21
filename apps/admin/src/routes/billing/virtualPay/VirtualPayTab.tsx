import { VirtualPayOrdersSection } from './VirtualPayOrdersSection'
import { VirtualPaySettingsCard } from './VirtualPaySettingsCard'

export function VirtualPayTab() {
  return (
    <div className="space-y-4">
      <VirtualPaySettingsCard />
      <VirtualPayOrdersSection />
    </div>
  )
}
