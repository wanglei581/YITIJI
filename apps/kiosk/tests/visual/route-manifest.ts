export const productionRoutePatterns = [
  '/', '/login', '/member/qr-login', '/upload/phone', '/legal/:doc',
  '/resume/job-fit', '/resume/job-fit/actions', '/resume/career-plan', '/interview/setup',
  '/interview/session', '/interview/report', '/interview/tips',
  '/interview/reports', '/screensaver', '/session-timeout', '/error-offline',
  '/assistant', '/profile', '/me/resumes', '/me/print-orders', '/me/documents',
  '/me/favorites', '/me/ai-records', '/me/benefits', '/me/activity',
  '/me/activity/:id', '/me/notifications', '/me/feedback', '/me/settings',
  '/me/privacy-requests',
  '/help', '/activities', '/activities/:id', '/renshi', '/campus',
  '/campus/welcome', '/campus/freshman-insights', '/toolbox', '/smart-campus',
  '/smart-campus/welcome', '/smart-campus/freshman-insights',
  '/smart-campus/service/:key', '/print-scan', '/print-scan/feature/:key',
  '/print-scan/convert', '/print-scan/sign', '/print/scan-convert',
  '/print/scan-sign', '/print/scan-feature', '/print/upload',
  '/print/desk', '/print/material-check', '/print/preview', '/print/params', '/print/confirm',
  '/print/cashier', '/print/progress', '/print/done', '/resume',
  '/resume/upload', '/resume/source', '/resume/generate',
  '/resume/generate/preview', '/resume/parse', '/resume/report',
  '/resume/optimize', '/resume/optimize/compare', '/resume/export', '/resume/templates', '/resume/materials', '/resume-service',
  '/scan', '/scan/start', '/scan/settings', '/scan/progress', '/scan/result', '/jobs',
  '/jobs/:id', '/jobs/:id/offline', '/offline-agencies', '/offline-agencies/:id', '/jobs-service', '/notifications',
  '/companies', '/companies/:id', '/job-fairs', '/job-fairs/checkin',
  '/job-fairs/:id', '/job-fairs/:id/companies', '/fairs-service',
  '/job-fairs/:id/companies/:companyId', '/job-fairs/:id/map',
  '/job-fairs/:id/materials', '/job-fairs/:id/visit-plan',
  '/job-fairs/:id/stats',
  // v1：自我探索 · 倾向参考（PR ③）
  '/resume/self-assessment/intro',
  '/resume/self-assessment/questions',
  '/resume/self-assessment/result',
  '/resume/self-assessment/history', '/interview-service',
  // 打印取件认领
  '/print/pickup-claim',
  // PR #496 (AI OS 三新路由)
  '/ai/plan',
  '/session-resume',
  '/jobs/online-platforms',
  // PR #499 合同审查
  '/contract-review',
  '/contract-review/processing',
  '/contract-review/result',
  '/policy-service',
] as const // 108 routes (was 107; 2026-09-08 扫描工作台合并新增 /scan)

export const compatibilityRedirects = {
  '/print/scan-convert': '/print-scan/convert',
  '/print/scan-sign': '/print-scan/sign',
  '/print/scan-feature': '/print-scan/feature/id-photo',
  // 2026-08-18：打印参数页下线（控件与预览阶段完全重复且全站零导航），
  // 2026-09-08 起随预览一并进入打印台。
  '/print/params': '/print/desk?step=preview',
  '/print/material-check': '/print/desk?step=check',
  '/print/preview': '/print/desk?step=preview',
  '/resume': '/resume/source',
  '/resume/upload': '/resume/source',
  // AI-07：/resume/export 孤儿占位页下线，真实导出在优化页。
  '/resume/export': '/resume/optimize',
  // 2026-09-08：青序流光 18-scan-workbench 把四页合成 /scan 工作台。
  '/scan/start': '/scan?stage=start',
  '/scan/settings': '/scan?stage=settings',
  '/scan/progress': '/scan?stage=progress',
  '/scan/result': '/scan?stage=result',
} as const
