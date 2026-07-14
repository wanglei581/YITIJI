import { createBrowserRouter } from 'react-router-dom'
import { PartnerLayoutWrapper } from '../layouts/PartnerLayoutWrapper'
import LoginPage from './login'

import DashboardPage from './dashboard'
import ProfilePage from './profile'
import JobsPage from './jobs'
import CompaniesPage from './companies'
import FairsPage from './fairs'
import SmartCampusPage from './smart-campus'
import PolicyPage from './policy'
import TerminalsPage from './terminals'
import StatsPage from './stats'
import SourcesPage from './sources'
import SyncLogsPage from './sync-logs'
import AccountPage from './account'
import AccountSettingsPage from './account-settings'

export const partnerRouter = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <PartnerLayoutWrapper />,
    children: [
      { index: true,        element: <DashboardPage /> },
      { path: 'profile',    element: <ProfilePage /> },
      { path: 'jobs',       element: <JobsPage /> },
      { path: 'companies',  element: <CompaniesPage /> },
      { path: 'fairs',      element: <FairsPage /> },
      { path: 'smart-campus', element: <SmartCampusPage /> },
      { path: 'policy',     element: <PolicyPage /> },
      { path: 'terminals',  element: <TerminalsPage /> },
      { path: 'stats',      element: <StatsPage /> },
      { path: 'sources',    element: <SourcesPage /> },
      { path: 'sync-logs',  element: <SyncLogsPage /> },
      { path: 'account',    element: <AccountPage /> },
      { path: 'account-settings', element: <AccountSettingsPage /> },
    ],
  },
])
