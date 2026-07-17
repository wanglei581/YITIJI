import { createBrowserRouter, Navigate } from 'react-router-dom'
import { KioskRoot } from '../layouts/KioskRoot'
import { LoginPage } from '../pages/auth/LoginPage'
import { MobileQrLoginPage } from '../pages/auth/MobileQrLoginPage'
import { PhoneUploadPage } from '../pages/upload/PhoneUploadPage'
import { LegalDocPage } from '../pages/legal/LegalDocPage'
import { JobFitPage } from '../pages/resume/JobFitPage'
import { CareerPlanPage } from '../pages/resume/CareerPlanPage'
import { InterviewSetupPage } from '../pages/interview/InterviewSetupPage'
import { InterviewSessionPage } from '../pages/interview/InterviewSessionPage'
import { InterviewReportPage } from '../pages/interview/InterviewReportPage'
import { InterviewTipsPage } from '../pages/interview/InterviewTipsPage'
import { InterviewReportsPage } from '../pages/interview/InterviewReportsPage'
import { AssistantPage } from '../pages/assistant/AssistantPage'
import { JobFairsPage } from '../pages/job-fairs/JobFairsPage'
import { JobFairCheckinPage } from '../pages/job-fairs/JobFairCheckinPage'
import { JobFairDetailPage } from '../pages/job-fairs/JobFairDetailPage'
import { FairCompaniesPage } from '../pages/job-fairs/FairCompaniesPage'
import { FairCompanyDetailPage } from '../pages/job-fairs/FairCompanyDetailPage'
import { FairMapPage } from '../pages/job-fairs/FairMapPage'
import { FairMaterialsPage } from '../pages/job-fairs/FairMaterialsPage'
import { FairVisitPlanPage } from '../pages/job-fairs/FairVisitPlanPage'
import { FairStatsPage } from '../pages/job-fairs/FairStatsPage'
import { JobsPage } from '../pages/jobs/JobsPage'
import { CompaniesPage } from '../pages/companies/CompaniesPage'
import { CompanyDetailPage } from '../pages/companies/CompanyDetailPage'
import { JobDetailPage } from '../pages/jobs/JobDetailPage'
import { ScanStartPage } from '../pages/scan/ScanStartPage'
import { ScanSettingsPage } from '../pages/scan/ScanSettingsPage'
import { ScanProgressPage } from '../pages/scan/ScanProgressPage'
import { ScanResultPage } from '../pages/scan/ScanResultPage'
import { PrintUploadPage } from '../pages/print/PrintUploadPage'
import { PrintMaterialCheckPage } from '../pages/print/PrintMaterialCheckPage'
import { PrintPreviewPage } from '../pages/print/PrintPreviewPage'
import { PrintConfirmPage } from '../pages/print/PrintConfirmPage'
import { PrintCashierPage } from '../pages/print/PrintCashierPage'
import { PrintProgressPage } from '../pages/print/PrintProgressPage'
import { PrintDonePage } from '../pages/print/PrintDonePage'
import { ProfilePage } from '../pages/profile/ProfilePage'
import { MyPrintOrdersPage } from '../pages/profile/me/MyPrintOrdersPage'
import { MyResumesPage } from '../pages/profile/me/MyResumesPage'
import { MyDocumentsPage } from '../pages/profile/me/MyDocumentsPage'
import { MyFavoritesPage } from '../pages/profile/me/MyFavoritesPage'
import { MyActivityPage } from '../pages/profile/me/MyActivityPage'
import { MyBenefitsPage } from '../pages/profile/me/MyBenefitsPage'
import { MyAiRecordsPage } from '../pages/profile/me/MyAiRecordsPage'
import { MySettingsPage } from '../pages/profile/me/MySettingsPage'
import { MyNotificationsPage } from '../pages/profile/me/MyNotificationsPage'
import { MyFeedbackPage } from '../pages/profile/me/MyFeedbackPage'
import { HelpCenterPage } from '../pages/help/HelpCenterPage'
import { BenefitActivitiesPage } from '../pages/activities/BenefitActivitiesPage'
import { BenefitActivityDetailPage } from '../pages/activities/BenefitActivityDetailPage'
import { PrintScanHomePage } from '../pages/print-scan/PrintScanHomePage'
import { PrintScanFeatureInfoPage } from '../pages/print-scan/PrintScanFeatureInfoPage'
import { ConvertImagesPage } from '../pages/print-scan/ConvertImagesPage'
import { SignStampPage } from '../pages/print-scan/SignStampPage'
import { ResumeSourcePage } from '../pages/resume/ResumeSourcePage'
import { ResumeGeneratePage } from '../pages/resume/ResumeGeneratePage'
import { ResumeGeneratePreviewPage } from '../pages/resume/ResumeGeneratePreviewPage'
import { ResumeParsePage } from '../pages/resume/ResumeParsePage'
import { ResumeReportPage } from '../pages/resume/ResumeReportPage'
import { ResumeOptimizePage } from '../pages/resume/ResumeOptimizePage'
import { ResumeExportPage } from '../pages/resume/ResumeExportPage'
import { ResumeTemplateLibraryPage } from '../pages/resume/ResumeTemplateLibraryPage'
import { JobMaterialLibraryPage } from '../pages/resume/JobMaterialLibraryPage'
import { HomePage } from '../pages/home/HomePage'
import { RenshiPage } from '../pages/renshi/RenshiPage'
import { CampusPage } from '../pages/campus/CampusPage'
import { ScreensaverPage } from '../pages/screensaver/ScreensaverPage'
import { SmartCampusHomePage } from '../pages/smart-campus/SmartCampusHomePage'
import { SmartCampusWelcomePage } from '../pages/smart-campus/SmartCampusWelcomePage'
import { SmartCampusServicePage } from '../pages/smart-campus/SmartCampusServicePage'
import { FreshmanInsightsPage } from '../pages/smart-campus/FreshmanInsightsPage'

export const kioskRouter = createBrowserRouter([
  // 顶级全屏路由——不嵌套在 KioskRoot，无 header/footer/nav（L2-4B）
  { path: '/login', element: <LoginPage /> },
  { path: '/member/qr-login', element: <MobileQrLoginPage /> },
  { path: '/upload/phone', element: <PhoneUploadPage /> },
  { path: '/legal/:doc', element: <LegalDocPage /> },
  { path: '/resume/job-fit', element: <JobFitPage /> },
  { path: '/resume/career-plan', element: <CareerPlanPage /> },
  { path: '/interview/setup', element: <InterviewSetupPage /> },
  { path: '/interview/session', element: <InterviewSessionPage /> },
  { path: '/interview/report', element: <InterviewReportPage /> },
  { path: '/interview/tips', element: <InterviewTipsPage /> },
  { path: '/interview/reports', element: <InterviewReportsPage /> },
  // 待机宣传屏:顶级路由,全屏渲染(不套 KioskLayout 头部/底部导航)
  { path: '/screensaver', element: <ScreensaverPage /> },
  {
    path: '/session-timeout',
    lazy: async () => ({ Component: (await import('../pages/placeholders/SessionTimeoutPage')).default }),
  },
  {
    path: '/error-offline',
    lazy: async () => ({ Component: (await import('../pages/placeholders/ErrorOfflinePage')).default }),
  },
  {
    path: '/',
    element: <KioskRoot />,
    children: [
      { index: true,               element: <HomePage /> },
      { path: 'assistant',         element: <AssistantPage /> },
      { path: 'profile',           element: <ProfilePage /> },
      // 「我的」明细页（本人 /me/* 真实数据；未登录引导登录，空态诚实，不造假数据）
      { path: 'me/resumes',        element: <MyResumesPage /> },
      { path: 'me/print-orders',   element: <MyPrintOrdersPage /> },
      { path: 'me/documents',      element: <MyDocumentsPage /> },
      { path: 'me/favorites',      element: <MyFavoritesPage /> },
      { path: 'me/ai-records',     element: <MyAiRecordsPage /> },
      { path: 'me/benefits',       element: <MyBenefitsPage /> },
      { path: 'me/activity',       element: <MyActivityPage /> },
      {
        path: 'me/activity/:id',
        lazy: async () => ({ Component: (await import('../pages/placeholders/MeActivityDetailPage')).default }),
      },
      { path: 'me/notifications',  element: <MyNotificationsPage /> },
      { path: 'me/feedback',       element: <MyFeedbackPage /> },
      // 账号设置轻量版（只读状态 + 协议入口 + 退出/切换账号；不做换绑/注销）
      { path: 'me/settings',       element: <MySettingsPage /> },
      // 帮助中心（静态 FAQ；仅描述已上线能力）
      { path: 'help',              element: <HelpCenterPage /> },
      // 权益活动中心（活动领取后生成 BenefitGrant，进入 /me/benefits；不含支付/套餐购买/招聘会凭证）
      { path: 'activities',         element: <BenefitActivitiesPage /> },
      { path: 'activities/:id',     element: <BenefitActivityDetailPage /> },
      { path: 'renshi',            element: <RenshiPage /> },
      { path: 'campus',            element: <CampusPage /> },
      {
        path: 'campus/welcome',
        lazy: async () => ({ Component: (await import('../pages/placeholders/CampusWelcomePage')).default }),
      },
      {
        path: 'campus/freshman-insights',
        lazy: async () => ({ Component: (await import('../pages/placeholders/FreshmanInsightsPage')).default }),
      },
      // 智慧校园（按学校/终端后台开关显示首页入口；路由本身保留直接访问容错）
      { path: 'smart-campus',                    element: <SmartCampusHomePage /> },
      { path: 'smart-campus/welcome',            element: <SmartCampusWelcomePage /> },
      { path: 'smart-campus/freshman-insights',  element: <FreshmanInsightsPage /> },
      { path: 'smart-campus/service/:key',       element: <SmartCampusServicePage /> },
      // 打印扫描服务中心
      { path: 'print-scan',              element: <PrintScanHomePage /> },
      { path: 'print-scan/feature/:key', element: <PrintScanFeatureInfoPage /> },
      { path: 'print-scan/convert',      element: <ConvertImagesPage /> },
      { path: 'print-scan/sign',         element: <SignStampPage /> },
      {
        path: 'print/scan-convert',
        lazy: async () => ({ Component: (await import('../pages/placeholders/PrintScanConvertPage')).default }),
      },
      {
        path: 'print/scan-sign',
        lazy: async () => ({ Component: (await import('../pages/placeholders/PrintScanSignPage')).default }),
      },
      {
        path: 'print/scan-feature',
        lazy: async () => ({ Component: (await import('../pages/placeholders/PrintScanFeaturePage')).default }),
      },
      // 打印扫描流程（Phase 3）
      { path: 'print/upload',      element: <PrintUploadPage /> },
      { path: 'print/material-check', element: <PrintMaterialCheckPage /> },
      { path: 'print/preview',     element: <PrintPreviewPage /> },
      { path: 'print/confirm',     element: <PrintConfirmPage /> },
      { path: 'print/cashier',     element: <PrintCashierPage /> },
      { path: 'print/progress',    element: <PrintProgressPage /> },
      { path: 'print/done',        element: <PrintDonePage /> },
      // AI简历服务（Phase 3）：服务中心中间页（ResumeHomePage）已移除，首页瓦片直达各功能。
      // /resume 与 /resume/upload 均保留为旧入口兼容，重定向到上传页 /resume/source，不再出现二次选择页。
      { path: 'resume',            element: <Navigate to="/resume/source" replace /> },
      { path: 'resume/upload',     element: <Navigate to="/resume/source" replace /> },
      { path: 'resume/source',     element: <ResumeSourcePage /> },
      { path: 'resume/generate',         element: <ResumeGeneratePage /> },
      { path: 'resume/generate/preview', element: <ResumeGeneratePreviewPage /> },
      { path: 'resume/parse',      element: <ResumeParsePage /> },
      { path: 'resume/report',     element: <ResumeReportPage /> },
      { path: 'resume/optimize',   element: <ResumeOptimizePage /> },
      { path: 'resume/export',     element: <ResumeExportPage /> },
      { path: 'resume/templates',  element: <ResumeTemplateLibraryPage /> },
      { path: 'resume/materials',   element: <JobMaterialLibraryPage /> },
      // 扫描流程（Phase 3）
      { path: 'scan/start',        element: <ScanStartPage /> },
      { path: 'scan/settings',     element: <ScanSettingsPage /> },
      { path: 'scan/progress',     element: <ScanProgressPage /> },
      { path: 'scan/result',       element: <ScanResultPage /> },
      // 岗位 / 招聘会（Phase 4）
      { path: 'jobs',                                  element: <JobsPage /> },
      { path: 'jobs/:id',                              element: <JobDetailPage /> },
      {
        path: 'jobs/:id/offline',
        lazy: async () => ({ Component: (await import('../pages/placeholders/OfflineJobDetailPage')).default }),
      },
      {
        path: 'offline-agencies',
        lazy: async () => ({ Component: (await import('../pages/placeholders/OfflineAgenciesPage')).default }),
      },
      {
        path: 'notifications',
        lazy: async () => ({ Component: (await import('../pages/placeholders/NotificationsPage')).default }),
      },
      { path: 'companies',                             element: <CompaniesPage /> },
      { path: 'companies/:id',                         element: <CompanyDetailPage /> },
      { path: 'job-fairs',                             element: <JobFairsPage /> },
      { path: 'job-fairs/checkin',                     element: <JobFairCheckinPage /> },
      { path: 'job-fairs/:id',                         element: <JobFairDetailPage /> },
      // 招聘会现场服务（Phase 招聘会数字化）
      { path: 'job-fairs/:id/companies',               element: <FairCompaniesPage /> },
      { path: 'job-fairs/:id/companies/:companyId',    element: <FairCompanyDetailPage /> },
      { path: 'job-fairs/:id/map',                     element: <FairMapPage /> },
      { path: 'job-fairs/:id/materials',               element: <FairMaterialsPage /> },
      { path: 'job-fairs/:id/visit-plan',              element: <FairVisitPlanPage /> },
      { path: 'job-fairs/:id/stats',                   element: <FairStatsPage /> },
    ],
  },
])
