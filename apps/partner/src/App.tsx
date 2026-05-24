import { useState } from 'react'
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  PartnerLayout,
  StatusBadge,
  type NavItem,
} from '@ai-job-print/ui'
import type { JobReviewStatus } from '@ai-job-print/shared'
import {
  BarChart2Icon,
  BriefcaseIcon,
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  LayoutDashboardIcon,
} from 'lucide-react'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台',     icon: LayoutDashboardIcon },
  { key: 'jobs',      label: '岗位信息管理', icon: BriefcaseIcon },
  { key: 'fairs',     label: '招聘会管理',  icon: CalendarIcon },
  { key: 'policy',    label: '政策公告',   icon: FileTextIcon },
  { key: 'sources',   label: '数据源管理',  icon: DatabaseIcon },
  { key: 'stats',     label: '数据统计',   icon: BarChart2Icon },
]

export default function App() {
  const [activeKey, setActiveKey] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [reviewStatus] = useState<JobReviewStatus>('pending')

  return (
    <PartnerLayout
      orgName="合作机构"
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={setActiveKey}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      headerActions={
        <>
          <StatusBadge
            status={reviewStatus === 'published' ? 'success' : reviewStatus === 'rejected' ? 'error' : 'warning'}
            label={reviewStatus}
          />
          <Button size="sm" variant="outline">机构账号</Button>
        </>
      }
    >
      <PageHeader
        title="工作台"
        subtitle="Partner Portal · Port 5175"
        actions={<Button size="sm">同步数据</Button>}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">招聘会信息</h2>
          <p className="mt-2 text-sm text-gray-500">发布招聘会活动信息</p>
          <Button className="mt-4" size="md">发布活动</Button>
        </Card>
        <Card padding="none">
          <EmptyState
            icon={BriefcaseIcon}
            title="暂无岗位数据"
            description="从数据源同步或手动上传岗位信息"
            action={<Button size="md" variant="outline">去来源平台</Button>}
          />
        </Card>
      </div>
    </PartnerLayout>
  )
}
