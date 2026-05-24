import { Page } from '../Page'
import { EmptyState } from '@ai-job-print/ui'
import { CalendarIcon } from 'lucide-react'

export default function FairsPage() {
  return (
    <Page title="招聘会管理" subtitle="发布与管理招聘会活动信息">
      <EmptyState
        icon={CalendarIcon}
        title="暂无招聘会数据"
        description="创建或同步招聘会活动信息"
      />
    </Page>
  )
}
