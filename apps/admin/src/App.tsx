import { useState } from 'react'
import {
  AdminLayout,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  type NavItem,
} from '@ai-job-print/ui'
import type { PrintTaskStatus } from '@ai-job-print/shared'
import {
  AlertTriangleIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  PrinterIcon,
  SettingsIcon,
  UsersIcon,
} from 'lucide-react'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard',  label: '工作台',   icon: LayoutDashboardIcon },
  { key: 'terminals',  label: '终端管理', icon: MonitorIcon },
  { key: 'printers',   label: '打印机管理', icon: PrinterIcon },
  { key: 'orders',     label: '订单管理', icon: FileTextIcon, badge: 3 },
  { key: 'users',      label: '用户管理', icon: UsersIcon },
  { key: 'alerts',     label: '告警中心', icon: AlertTriangleIcon, badge: '!' },
  { key: 'settings',   label: '系统设置', icon: SettingsIcon },
]

export default function App() {
  const [activeKey, setActiveKey] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [taskStatus] = useState<PrintTaskStatus>('pending')

  return (
    <AdminLayout
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={setActiveKey}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      headerActions={
        <>
          <StatusBadge
            status={taskStatus === 'completed' ? 'success' : taskStatus === 'failed' ? 'error' : 'info'}
            label={taskStatus}
          />
          <Button size="sm" variant="outline">管理员</Button>
        </>
      }
    >
      <PageHeader
        title="工作台"
        subtitle="Admin Dashboard · Port 5174"
        actions={<Button size="sm">刷新数据</Button>}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">打印任务队列</h2>
          <p className="mt-2 text-sm text-gray-500">当前等待任务：0</p>
          <Button className="mt-4" size="md" variant="secondary">刷新队列</Button>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold text-gray-900">设备管理</h2>
          <p className="mt-2 text-sm text-gray-500">已连接打印机：0 台</p>
          <Button className="mt-4" size="md" variant="danger">重启设备</Button>
        </Card>
        <Card padding="none">
          <EmptyState
            icon={AlertTriangleIcon}
            title="暂无告警"
            description="所有终端运行正常"
          />
        </Card>
      </div>
    </AdminLayout>
  )
}
