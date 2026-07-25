import { EmptyState } from '@ai-job-print/ui'
import { CableIcon } from 'lucide-react'

export default function PeripheralsPage() {
  return (
    <EmptyState
      icon={CableIcon}
      title="本阶段不开放外设独立管理"
      description="扫码器、摄像头、U 盘等外设状态由 Windows Terminal Agent 上报，请在「设备 / 打印机」查看。本页不做单独外设配置，避免与 Agent 真相源分裂。"
    />
  )
}
