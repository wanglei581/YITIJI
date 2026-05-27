import { createBrowserRouter } from 'react-router-dom'
import { AdminLayoutWrapper } from '../layouts/AdminLayoutWrapper'

import DashboardPage from './dashboard'
import TerminalsPage from './terminals'
import PrintersPage from './printers'
import PeripheralsPage from './peripherals'
import OrdersPage from './orders'
import FilesPage from './files'
import AiServicesPage from './ai-services'
import JobSourcesPage from './job-sources'
import FairSourcesPage from './fair-sources'
import FairsPage from './fairs'
import PartnersPage from './partners'
import UsersPage from './users'
import AlertsPage from './alerts'
import PermissionsPage from './permissions'
import AuditPage from './audit'

export const adminRouter = createBrowserRouter([
  {
    path: '/',
    element: <AdminLayoutWrapper />,
    children: [
      { index: true,          element: <DashboardPage /> },
      { path: 'terminals',    element: <TerminalsPage /> },
      { path: 'printers',     element: <PrintersPage /> },
      { path: 'peripherals',  element: <PeripheralsPage /> },
      { path: 'orders',       element: <OrdersPage /> },
      { path: 'files',        element: <FilesPage /> },
      { path: 'ai-services',  element: <AiServicesPage /> },
      { path: 'job-sources',  element: <JobSourcesPage /> },
      { path: 'fair-sources', element: <FairSourcesPage /> },
      { path: 'fairs',        element: <FairsPage /> },
      { path: 'partners',     element: <PartnersPage /> },
      { path: 'users',        element: <UsersPage /> },
      { path: 'alerts',       element: <AlertsPage /> },
      { path: 'permissions',  element: <PermissionsPage /> },
      { path: 'audit',        element: <AuditPage /> },
    ],
  },
])
