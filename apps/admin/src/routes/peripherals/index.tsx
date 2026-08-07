import { EmptyState } from '@ai-job-print/ui'
import { CableIcon } from 'lucide-react'

export default function PeripheralsPage() {
  return (
    <EmptyState
      icon={CableIcon}
      title="本阶段不开放外设独立管理"
      description="U 盘、打印机与面板扫描（扫描到本机目录）由 Windows Terminal Agent 提供；摄像头与扫码枪状态当前不上报。请在「设备 / 打印机」查看已接入能力。本页不做单独外设配置，避免与 Agent 真相源分裂。"
    />
  )
}
