import { Navigate, createBrowserRouter } from 'react-router-dom'
import { AdminLayoutWrapper } from '../layouts/AdminLayoutWrapper'
import LoginPage from './login'

import DashboardPage from './dashboard'
import DevicesPage from './devices'
import OrdersPage from './orders'
import FilesPage from './files'
import AiServicesPage from './ai-services'
import AiConfigPage from './ai-config'
import JobSourcesPage from './job-sources'
import FairSourcesPage from './fair-sources'
import FairsPage from './fairs'
import PartnersPage from './partners'
import UsersPage from './users'
import AlertsPage from './alerts'
import PermissionsPage from './permissions'
import AuditPage from './audit'
import ImportBatchesPage from './import-batches'
import SyncSourcesPage from './sync-sources'
import ScreensaverPage from './screensaver'
import SmartCampusPage from './smart-campus'

export const adminRouter = createBrowserRouter([
  // /login 在 AdminLayoutWrapper 之外,不走 boot 鉴权;
  // 自身在已登录时会自动跳 /
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AdminLayoutWrapper />,
    children: [
      { index: true,          element: <DashboardPage /> },
      { path: 'devices',      element: <DevicesPage /> },
      // 历史路径重定向到合并后的设备管理 Tab
      { path: 'terminals',    element: <Navigate to="/devices?tab=terminals"   replace /> },
      { path: 'printers',     element: <Navigate to="/devices?tab=printers"    replace /> },
      { path: 'peripherals',  element: <Navigate to="/devices?tab=peripherals" replace /> },
      { path: 'orders',       element: <OrdersPage /> },
      { path: 'files',        element: <FilesPage /> },
      { path: 'ai-services',  element: <AiServicesPage /> },
      { path: 'ai-config',    element: <AiConfigPage /> },
      { path: 'job-sources',  element: <JobSourcesPage /> },
      { path: 'fair-sources', element: <FairSourcesPage /> },
      { path: 'fairs',        element: <FairsPage /> },
      { path: 'partners',     element: <PartnersPage /> },
      { path: 'users',        element: <UsersPage /> },
      { path: 'alerts',       element: <AlertsPage /> },
      { path: 'permissions',     element: <PermissionsPage /> },
      { path: 'audit',           element: <AuditPage /> },
      { path: 'import-batches',  element: <ImportBatchesPage /> },
      { path: 'sync-sources',    element: <SyncSourcesPage /> },
      { path: 'screensaver',     element: <ScreensaverPage /> },
      { path: 'smart-campus',    element: <SmartCampusPage /> },
    ],
  },
])
