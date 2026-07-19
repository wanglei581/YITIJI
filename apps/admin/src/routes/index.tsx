import { Navigate, createBrowserRouter } from 'react-router-dom'
import { AdminLayoutWrapper } from '../layouts/AdminLayoutWrapper'
import LoginPage from './login'

import DashboardPage from './dashboard'
import DevicesPage from './devices'
import OrdersPage from './orders'
import PrintScanOpsPage from './print-scan'
import BillingPage from './billing'
import FilesPage from './files'
import AiServicesPage from './ai-services'
import AiConfigPage from './ai-config'
import JobSourcesPage from './job-sources'
import FairSourcesPage from './fair-sources'
import PolicySourcesPage from './policy-sources'
import FairsPage from './fairs'
import CompaniesPage from './companies'
import PartnersPage from './partners'
import UsersPage from './users'
import MemberBenefitsPage from './member-benefits'
import BenefitActivitiesPage from './benefit-activities'
import MemberFeedbackPage from './member-feedback'
import MemberNotificationsPage from './member-notifications'
import AlertsPage from './alerts'
import PermissionsPage from './permissions'
import AuditPage from './audit'
import ImportBatchesPage from './import-batches'
import SyncSourcesPage from './sync-sources'
import ScreensaverPage from './screensaver'
import ToolboxPage from './toolbox'
import SmartCampusPage from './smart-campus'
import JobMaterialsPage from './job-materials'
import AccountSettingsPage from './account-settings'
import OfflineAgenciesPage from './offline-agencies'
import LegalDocsPage from './legal-docs'

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
      { path: 'print-scan',   element: <PrintScanOpsPage /> },
      { path: 'billing',      element: <BillingPage /> },
      { path: 'files',        element: <FilesPage /> },
      { path: 'job-materials', element: <JobMaterialsPage /> },
      { path: 'ai-services',  element: <AiServicesPage /> },
      { path: 'ai-config',    element: <AiConfigPage /> },
      { path: 'job-sources',  element: <JobSourcesPage /> },
      { path: 'fair-sources', element: <FairSourcesPage /> },
      { path: 'policy-sources', element: <PolicySourcesPage /> },
      { path: 'fairs',        element: <FairsPage /> },
      { path: 'companies',    element: <CompaniesPage /> },
      { path: 'partners',     element: <PartnersPage /> },
      { path: 'users',        element: <UsersPage /> },
      { path: 'benefit-activities', element: <BenefitActivitiesPage /> },
      { path: 'member-benefits', element: <MemberBenefitsPage /> },
      { path: 'member-feedback', element: <MemberFeedbackPage /> },
      { path: 'member-notifications', element: <MemberNotificationsPage /> },
      { path: 'alerts',       element: <AlertsPage /> },
      { path: 'permissions',     element: <PermissionsPage /> },
      { path: 'audit',           element: <AuditPage /> },
      { path: 'import-batches',  element: <ImportBatchesPage /> },
      { path: 'sync-sources',    element: <SyncSourcesPage /> },
      { path: 'screensaver',     element: <ScreensaverPage /> },
      { path: 'toolbox',         element: <ToolboxPage /> },
      { path: 'smart-campus',    element: <SmartCampusPage /> },
      { path: 'account-settings', element: <AccountSettingsPage /> },
      { path: 'offline-agencies', element: <OfflineAgenciesPage /> },
      { path: 'legal-docs',       element: <LegalDocsPage /> },
    ],
  },
])
