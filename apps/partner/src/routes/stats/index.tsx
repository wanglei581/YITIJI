// Partner 数据统计页 — /stats
//
// 口径：统计报表本阶段不开放，诚实告知用户。
// 真实数据请在「数据源 / 同步日志 / 工作台」查看。

import { EmptyState } from '@ai-job-print/ui'
import { BarChart2Icon } from 'lucide-react'
import { Page } from '../Page'

export default function StatsPage() {
  return (
    <Page title="数据统计" subtitle="岗位与招聘会数据统计">
      <EmptyState
        icon={BarChart2Icon}
        title="统计报表本阶段不开放"
        description="岗位与招聘会请在「数据源 / 同步日志 / 工作台」查看真实业务数据。本页不做假报表或演示图表。"
      />
    </Page>
  )
}
