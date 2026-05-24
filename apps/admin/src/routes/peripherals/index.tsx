import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { CableIcon } from 'lucide-react'

export default function PeripheralsPage() {
  return (
    <Page title="外设管理" subtitle="扫码器、摄像头、U盘读取等外设">
      <EmptyState
        icon={CableIcon}
        title="暂无外设数据"
        description="连接终端外设后将显示设备列表"
      />
    </Page>
  )
}
