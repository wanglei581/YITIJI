import { createBrowserRouter } from 'react-router-dom'
import { KioskRoot } from '../layouts/KioskRoot'
import { AssistantPage } from '../pages/assistant/AssistantPage'
import { JobFairsPage } from '../pages/job-fairs/JobFairsPage'
import { JobsPage } from '../pages/jobs/JobsPage'
import { PrintUploadPage } from '../pages/print/PrintUploadPage'
import { ProfilePage } from '../pages/profile/ProfilePage'
import { ResumeUploadPage } from '../pages/resume/ResumeUploadPage'
import { HomePage } from '../pages/home/HomePage'

export const kioskRouter = createBrowserRouter([
  {
    path: '/',
    element: <KioskRoot />,
    children: [
      { index: true,              element: <HomePage /> },
      { path: 'assistant',        element: <AssistantPage /> },
      { path: 'profile',          element: <ProfilePage /> },
      // AI简历服务（Phase 3）
      { path: 'resume/upload',    element: <ResumeUploadPage /> },
      // 打印扫描（Phase 3）
      { path: 'print/upload',     element: <PrintUploadPage /> },
      // 岗位 / 招聘会（Phase 4）
      { path: 'jobs',             element: <JobsPage /> },
      { path: 'job-fairs',        element: <JobFairsPage /> },
    ],
  },
])
