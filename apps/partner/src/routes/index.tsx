import { createBrowserRouter } from 'react-router-dom'
import { PartnerLayoutWrapper } from '../layouts/PartnerLayoutWrapper'
import LoginPage from './login'

import DashboardPage from './dashboard'
import ScreenPage from './screen'
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
import { RecruitmentHostingGate } from './RecruitmentHostingGate'

export const partnerRouter = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <PartnerLayoutWrapper />,
    children: [
      { index: true,        element: <DashboardPage /> },
      { path: 'screen',     element: <ScreenPage /> },
      { path: 'profile',    element: <ProfilePage /> },
      // 招聘内容托管关闭（3.13）时这五页整块下线，直接打开地址时给如实说明，见 RecruitmentHostingGate。
      { path: 'jobs',       element: <RecruitmentHostingGate page="jobs"><JobsPage /></RecruitmentHostingGate> },
      { path: 'companies',  element: <RecruitmentHostingGate page="companies"><CompaniesPage /></RecruitmentHostingGate> },
      { path: 'fairs',      element: <RecruitmentHostingGate page="fairs"><FairsPage /></RecruitmentHostingGate> },
      { path: 'smart-campus', element: <SmartCampusPage /> },
      { path: 'policy',     element: <PolicyPage /> },
      { path: 'terminals',  element: <TerminalsPage /> },
      { path: 'stats',      element: <StatsPage /> },
      { path: 'sources',    element: <RecruitmentHostingGate page="sources"><SourcesPage /></RecruitmentHostingGate> },
      { path: 'sync-logs',  element: <RecruitmentHostingGate page="sync-logs"><SyncLogsPage /></RecruitmentHostingGate> },
      { path: 'account',    element: <AccountPage /> },
    ],
  },
])
