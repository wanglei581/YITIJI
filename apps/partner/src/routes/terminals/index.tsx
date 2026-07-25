import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { MonitorIcon } from 'lucide-react'

export default function TerminalsPage() {
  return (
    <Page title="终端数据" subtitle="机构关联终端的使用数据">
      <EmptyState
        icon={MonitorIcon}
        title="终端明细暂由平台统一运营"
        description="合作机构侧暂不开放逐台终端数据面板。关联终端的在线与打印状态由管理员后台维护；本页不展示演示指标或伪状态。"
      />
    </Page>
  )
}
