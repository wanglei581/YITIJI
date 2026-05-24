import { createBrowserRouter, RouterProvider, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AdminLayout, type NavItem } from '@ai-job-print/ui'
import { useState } from 'react'
import {
  AlertTriangleIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  PrinterIcon,
  SettingsIcon,
} from 'lucide-react'

// Pages
import DashboardPage from './routes/dashboard'
import TerminalsPage from './routes/terminals'
import PrintersPage from './routes/printers'
import OrdersPage from './routes/orders'
import AlertsPage from './routes/alerts'
import SettingsPage from './routes/settings'

const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboardIcon },
  { key: 'terminals', label: '终端管理', icon: MonitorIcon },
  { key: 'printers', label: '打印机管理', icon: PrinterIcon },
  { key: 'orders', label: '订单管理', icon: FileTextIcon },
  { key: 'alerts', label: '告警中心', icon: AlertTriangleIcon },
  { key: 'settings', label: '系统设置', icon: SettingsIcon },
]

const ROUTE_KEY_MAP: Record<string, string> = {
  '/': 'dashboard',
  '/terminals': 'terminals',
  '/printers': 'printers',
  '/orders': 'orders',
  '/alerts': 'alerts',
  '/settings': 'settings',
}

function AdminLayoutWrapper() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const activeKey = ROUTE_KEY_MAP[location.pathname] ?? 'dashboard'

  const handleNavChange = (key: string) => {
    const routeMap: Record<string, string> = {
      dashboard: '/',
      terminals: '/terminals',
      printers: '/printers',
      orders: '/orders',
      alerts: '/alerts',
      settings: '/settings',
    }
    navigate(routeMap[key] ?? '/')
  }

  return (
    <AdminLayout
      navItems={NAV_ITEMS}
      activeKey={activeKey}
      onNavChange={handleNavChange}
      collapsed={collapsed}
      onCollapseChange={setCollapsed}
      appName="管理后台"
    >
      <Outlet />
    </AdminLayout>
  )
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayoutWrapper />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'terminals', element: <TerminalsPage /> },
      { path: 'printers', element: <PrintersPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
