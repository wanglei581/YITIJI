import { EmptyState } from '@ai-job-print/ui'
import { CableIcon } from 'lucide-react'

export default function PeripheralsPage() {
  return (
    <EmptyState
      icon={CableIcon}
      title="功能建设中"
      description="该模块正在开发中，上线前暂不开放，敬请期待。"
    />
  )
}
