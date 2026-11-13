export const productionRoutePatterns = [
  '/', '/login', '/member/qr-login', '/upload/phone', '/legal/:doc',
  // 2026-10-29 一体机手机码短链的网页中转（上传 / 登录），兑换或校验后 replace 到上面两个手机页。
  '/k/u/:scene', '/k/l/:ticketId',
  '/resume/job-fit/*', '/resume/career-plan/*', '/interview',
  '/interview/setup',
  '/interview/session', '/interview/report', '/interview/tips',
  '/interview/reports', '/screensaver', '/session-timeout', '/error-offline',
  '/assistant', '/profile', '/me/resumes', '/me/print-orders', '/me/documents',
  '/me/favorites', '/me/ai-records', '/me/benefits', '/me/activity',
  '/me/activity/:id', '/me/notifications', '/me/feedback', '/me/settings',
  '/me/privacy-requests',
  '/help', '/activities/*', '/renshi', '/campus',
  '/campus/welcome', '/campus/freshman-insights',
  // 2026-11-04 产品负责人定停放：百宝箱、智慧校园不再是在用页面，旧链跳回首页。
  '/toolbox/*', '/smart-campus/*',
  '/print-scan', '/print-scan/feature/:key',
  '/print-scan/convert', '/print-scan/sign/*', '/print/scan-convert',
  '/print/scan-sign', '/print/scan-sign/*', '/print/scan-feature', '/print/upload',
  '/print/desk', '/print/material-check', '/print/preview', '/print/params', '/print/confirm',
  '/print/cashier', '/print/progress', '/print/done', '/resume',
  '/resume/upload', '/resume/source', '/resume/generate',
  '/resume/generate/preview', '/resume/parse', '/resume/report',
  '/resume/optimize', '/resume/optimize/compare', '/resume/export', '/resume/templates/*', '/resume/materials/*', '/resume-service',
  '/scan', '/scan/start', '/scan/settings', '/scan/progress', '/scan/result', '/jobs',
  '/jobs/:id', '/jobs/:id/offline', '/offline-agencies', '/offline-agencies/:id', '/jobs-service', '/notifications',
  '/companies', '/companies/:id', '/job-fairs', '/job-fairs/checkin',
  '/job-fairs/:id', '/job-fairs/:id/companies', '/fairs-service',
  '/job-fairs/:id/companies/:companyId', '/job-fairs/:id/map',
  '/job-fairs/:id/materials', '/job-fairs/:id/visit-plan',
  '/job-fairs/:id/stats',
  // v1：自我探索 · 倾向参考（PR ③）
  '/resume/self-assessment/*',
  '/interview-service',
  // 打印取件认领
  '/print/pickup-claim',
  // PR #496 (AI OS 三新路由)
  '/ai/plan',
  '/session-resume',
  '/jobs/online-platforms',
  // 3.14 本机构官方渠道（稿 45 的运行时宿主；/jobs/online-platforms 改为重定向到这里）
  '/official-channels',
  // PR #499 合同审查
  '/contract-review',
  '/contract-review/processing',
  '/contract-review/result',
  '/policy-service',
  // 触屏版第一包：开发样板（非业务屏）。生产构建不挂载，直接访问回到首页。
  '/dev/touch-gallery',
] as const // 2026-11-08：四核心收口，停放路径保留 splat 重定向。

export const compatibilityRedirects = {
  '/print/scan-convert': '/print-scan/convert',
  '/print/scan-sign': '/',
  // 2026-11-04 证件照停放：旧地址回打印扫描。此前目标是 /print-scan/feature/id-photo。
  '/print/scan-feature': '/print-scan',
  // 2026-08-18：打印参数页下线（控件与预览阶段完全重复且全站零导航），
  // 2026-09-08 起随预览一并进入打印台。
  '/print/params': '/print/desk?step=preview',
  '/print/material-check': '/print/desk?step=check',
  '/print/preview': '/print/desk?step=preview',
  '/resume': '/resume/source',
  '/resume/upload': '/resume/source',
  // AI-07：/resume/export 孤儿占位页下线，真实导出在优化页。
  '/resume/export': '/resume/optimize',
  // 2026-09-08：青序流光 29-interview-training 把五页合成 /interview 工作台。
  '/interview/setup': '/interview?stage=setup',
  '/interview/session': '/interview?stage=session',
  '/interview/report': '/interview?stage=report',
  '/interview/tips': '/interview?stage=tips',
  '/interview/reports': '/interview?stage=reports',
  // 2026-09-08：青序流光 18-scan-workbench 把四页合成 /scan 工作台。
  '/scan/start': '/scan?stage=start',
  '/scan/settings': '/scan?stage=settings',
  '/scan/progress': '/scan?stage=progress',
  '/scan/result': '/scan?stage=result',
  // 2026-09-27（3.14）：线上招聘平台目录并入本机构官方渠道，两种托管状态都转过去。
  '/jobs/online-platforms': '/official-channels',
  // 2026-11-04 产品负责人定停放：旧百宝箱、智慧校园链接回首页。
  '/resume/career-plan/*': '/',
  '/resume/self-assessment/*': '/',
  '/resume/job-fit/*': '/',
  '/resume/materials/*': '/',
  '/resume/templates/*': '/',
  '/activities/*': '/',
  '/print-scan/sign/*': '/',
  '/print/scan-sign/*': '/',
  '/toolbox/*': '/',
  '/smart-campus/*': '/',
} as const
