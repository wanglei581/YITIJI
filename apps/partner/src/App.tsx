import { createBrowserRouter, RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { PartnerLayout, type NavItem } from '@ai-job-print/ui'
import { useState } from 'react'
import {
  BarChart2Icon,
  BriefcaseIcon,
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  LayoutDashboardIcon,
} from 'lucide-react'

// Pages
import DashboardPage from './routes/dashboard'
import JobsPage from './routes/jobs'
import FairsPage from './routes/fairs'
import PolicyPage from './routes/policy'
import SourcesPage from './routes/sources'
import StatsPage from './routes/stats'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboardIcon },
  { key: 'jobs', label: '岗位信息管理', icon: BriefcaseIcon },
  { key: 'fairs', label: '招聘会管理', icon: CalendarIcon },
  { key: 'policy', label: '政策公告', icon: FileTextIcon },
  { key: 'sources', label: '数据源管理', icon: DatabaseIcon },
  { key: 'stats', label: '数据统计', icon: BarChart2Icon },
]

const ROUTE_KEY_MAP: Record<string, string> = {
  '/': 'dashboard',
  '/jobs': 'jobs',
  '/fairs': 'fairs',
  '/policy': 'policy',
  '/sources': 'sources',
  '/stats': 'stats',
}

function PartnerLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const activeKey = ROUTE_KEY_MAP[location.pathname] ?? 'dashboard'

  const handleNavChange = (key: string) => {
    const routeMap: Record<string, string> = {
      dashboard: '/',
      jobs: '/jobs',
      fairs: '/fairs',
      policy: '/policy',
      sources: '/sources',
      stats: '/stats',
    }
    navigate(routeMap[key] ?? '/')
  }

  return (
    <PartnerLayout
      orgName="合作机构"
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={handleNavChange}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
    >
      <Outlet />
    </PartnerLayout>
  )
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <PartnerLayoutWrapper />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'jobs', element: <JobsPage /> },
      { path: 'fairs', element: <FairsPage /> },
      { path: 'policy', element: <PolicyPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'stats', element: <StatsPage /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
