import { createBrowserRouter } from 'react-router-dom'
import { KioskRoot } from '../layouts/KioskRoot'
import { AssistantPage } from '../pages/assistant/AssistantPage'
import { JobFairsPage } from '../pages/job-fairs/JobFairsPage'
import { JobFairDetailPage } from '../pages/job-fairs/JobFairDetailPage'
import { FairCompaniesPage } from '../pages/job-fairs/FairCompaniesPage'
import { FairCompanyDetailPage } from '../pages/job-fairs/FairCompanyDetailPage'
import { FairMapPage } from '../pages/job-fairs/FairMapPage'
import { FairMaterialsPage } from '../pages/job-fairs/FairMaterialsPage'
import { FairStatsPage } from '../pages/job-fairs/FairStatsPage'
import { JobsPage } from '../pages/jobs/JobsPage'
import { JobDetailPage } from '../pages/jobs/JobDetailPage'
import { PolicyPage } from '../pages/policy/PolicyPage'
import { ScanStartPage } from '../pages/scan/ScanStartPage'
import { ScanSettingsPage } from '../pages/scan/ScanSettingsPage'
import { ScanProgressPage } from '../pages/scan/ScanProgressPage'
import { ScanResultPage } from '../pages/scan/ScanResultPage'
import { PrintUploadPage } from '../pages/print/PrintUploadPage'
import { PrintPreviewPage } from '../pages/print/PrintPreviewPage'
import { PrintConfirmPage } from '../pages/print/PrintConfirmPage'
import { PrintProgressPage } from '../pages/print/PrintProgressPage'
import { PrintDonePage } from '../pages/print/PrintDonePage'
import { ProfilePage } from '../pages/profile/ProfilePage'
import { ResumeUploadPage } from '../pages/resume/ResumeUploadPage'
import { ResumeSourcePage } from '../pages/resume/ResumeSourcePage'
import { ResumeParsePage } from '../pages/resume/ResumeParsePage'
import { ResumeReportPage } from '../pages/resume/ResumeReportPage'
import { ResumeOptimizePage } from '../pages/resume/ResumeOptimizePage'
import { ResumeExportPage } from '../pages/resume/ResumeExportPage'
import { HomePage } from '../pages/home/HomePage'
import { RenshiPage } from '../pages/renshi/RenshiPage'

export const kioskRouter = createBrowserRouter([
  {
    path: '/',
    element: <KioskRoot />,
    children: [
      { index: true,               element: <HomePage /> },
      { path: 'assistant',         element: <AssistantPage /> },
      { path: 'profile',           element: <ProfilePage /> },
      { path: 'policy',            element: <PolicyPage /> },
      { path: 'renshi',            element: <RenshiPage /> },
      // 打印扫描流程（Phase 3）
      { path: 'print/upload',      element: <PrintUploadPage /> },
      { path: 'print/preview',     element: <PrintPreviewPage /> },
      { path: 'print/confirm',     element: <PrintConfirmPage /> },
      { path: 'print/progress',    element: <PrintProgressPage /> },
      { path: 'print/done',        element: <PrintDonePage /> },
      // AI简历服务（Phase 3）
      { path: 'resume/upload',     element: <ResumeUploadPage /> },
      { path: 'resume/source',     element: <ResumeSourcePage /> },
      { path: 'resume/parse',      element: <ResumeParsePage /> },
      { path: 'resume/report',     element: <ResumeReportPage /> },
      { path: 'resume/optimize',   element: <ResumeOptimizePage /> },
      { path: 'resume/export',     element: <ResumeExportPage /> },
      // 扫描流程（Phase 3）
      { path: 'scan/start',        element: <ScanStartPage /> },
      { path: 'scan/settings',     element: <ScanSettingsPage /> },
      { path: 'scan/progress',     element: <ScanProgressPage /> },
      { path: 'scan/result',       element: <ScanResultPage /> },
      // 岗位 / 招聘会（Phase 4）
      { path: 'jobs',                                  element: <JobsPage /> },
      { path: 'jobs/:id',                              element: <JobDetailPage /> },
      { path: 'job-fairs',                             element: <JobFairsPage /> },
      { path: 'job-fairs/:id',                         element: <JobFairDetailPage /> },
      // 招聘会现场服务（Phase 招聘会数字化）
      { path: 'job-fairs/:id/companies',               element: <FairCompaniesPage /> },
      { path: 'job-fairs/:id/companies/:companyId',    element: <FairCompanyDetailPage /> },
      { path: 'job-fairs/:id/map',                     element: <FairMapPage /> },
      { path: 'job-fairs/:id/materials',               element: <FairMaterialsPage /> },
      { path: 'job-fairs/:id/stats',                   element: <FairStatsPage /> },
    ],
  },
])
