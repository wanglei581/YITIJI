import { EmptyState } from '@ai-job-print/ui'
import { CableIcon } from 'lucide-react'

export default function PeripheralsPage() {
  return (
    <EmptyState
      icon={CableIcon}
      title="暂无外设数据"
      description="连接终端外设后将显示设备列表"
    />
  )
}
