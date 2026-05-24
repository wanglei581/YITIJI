import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { FileTextIcon } from 'lucide-react'

export default function OrdersPage() {
  return (
    <Page title="订单管理" subtitle="打印订单列表与退款处理">
      <EmptyState
        icon={FileTextIcon}
        title="暂无打印订单"
        description="用户提交打印任务后将显示订单列表"
      />
    </Page>
  )
}
