import { createBrowserRouter } from 'react-router-dom'
import { PartnerLayoutWrapper } from '../layouts/PartnerLayoutWrapper'

import DashboardPage from './dashboard'
import ProfilePage from './profile'
import JobsPage from './jobs'
import FairsPage from './fairs'
import PolicyPage from './policy'
import TerminalsPage from './terminals'
import StatsPage from './stats'
import SourcesPage from './sources'
import SyncLogsPage from './sync-logs'
import AccountPage from './account'

export const partnerRouter = createBrowserRouter([
  {
    path: '/',
    element: <PartnerLayoutWrapper />,
    children: [
      { index: true,        element: <DashboardPage /> },
      { path: 'profile',    element: <ProfilePage /> },
      { path: 'jobs',       element: <JobsPage /> },
      { path: 'fairs',      element: <FairsPage /> },
      { path: 'policy',     element: <PolicyPage /> },
      { path: 'terminals',  element: <TerminalsPage /> },
      { path: 'stats',      element: <StatsPage /> },
      { path: 'sources',    element: <SourcesPage /> },
      { path: 'sync-logs',  element: <SyncLogsPage /> },
      { path: 'account',    element: <AccountPage /> },
    ],
  },
])
