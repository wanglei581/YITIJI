#!/usr/bin/env node
/**
 * verify:no-raw-error-render —— 三端适配器错误不得把英文技术串直接甩到页面。
 *
 * 挡的是 launch-audit-2026-09-05 包 3：
 *   SES-02 / PRT-01 / SES-12 / AI-03 / MSC-02 / PTR-07
 *   ADM-C3 / ADM-C5 / ADM-C10 / ADM-M1 / ADM-M13 / ADM-A9 / ADM-A24 / OPS-03 / SES-09
 *
 * 断言：
 *   A. 本包收口的页面不得再写 `instanceof Error ? *.message` 进 setError / 渲染
 *   B. 打印/支付适配器抛 ApiHttpError，不再 `throw new Error('...failed: 400')`
 *   C. 带会员 Bearer 的 6 个模块 401 触发会话重置（kioskFeedback 匿名、不带 Bearer）
 *   D. Admin main.tsx 有 unhandledrejection 全局提示
 *   E. 确认页/收银页/扫描设置/来源创建走 userMessageOf 或码表，文案含下一步
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  const full = join(repoRoot, rel)
  if (!existsSync(full)) throw new Error(`missing ${rel}`)
  return readFileSync(full, 'utf8')
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let failures = 0
function fail(message) {
  console.error(`  ❌ ${message}`)
  failures += 1
}
function pass(message) {
  console.log(`  ✅ ${message}`)
}

const RAW_MESSAGE = /(\b\w+)\s+instanceof\s+Error\s*\?\s*\1\.message/
const AS_ERROR_MESSAGE = /\(\s*\w+\s+as\s+Error\s*\)\s*\?\.?\s*message/

const PACKET_PAGES = [
  'apps/kiosk/src/pages/print/PrintConfirmPage.tsx',
  'apps/kiosk/src/pages/print/PrintCashierPage.tsx',
  'apps/kiosk/src/pages/print/PrintUploadPage.tsx',
  'apps/kiosk/src/pages/print/PrintMaterialCheckPage.tsx',
  'apps/kiosk/src/pages/print-scan/SignStampPage.tsx',
  'apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx',
  'apps/kiosk/src/pages/scan/ScanProgressPage.tsx',
  'apps/kiosk/src/pages/scan/ScanSettingsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MySettingsPage.tsx',
  'apps/kiosk/src/pages/profile/me/MyPrivacyRequestsPage.tsx',
  'apps/kiosk/src/pages/resume/ResumeGeneratePage.tsx',
  'apps/kiosk/src/pages/resume/JobMaterialLibraryPage.tsx',
  'apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx',
  'apps/admin/src/routes/job-sources/index.tsx',
  'apps/admin/src/routes/fair-sources/index.tsx',
  'apps/admin/src/routes/policy-sources/index.tsx',
  'apps/admin/src/routes/sync-sources/index.tsx',
  'apps/admin/src/routes/fairs/components/CompaniesTab.tsx',
  'apps/admin/src/routes/fairs/components/ZonesTab.tsx',
  'apps/admin/src/routes/fairs/components/MaterialsTab.tsx',
  'apps/admin/src/routes/partners/index.tsx',
  'apps/admin/src/routes/offline-agencies/JobsDrawer.tsx',
  'apps/admin/src/routes/screensaver/index.tsx',
  'apps/admin/src/routes/login/index.tsx',
  'apps/admin/src/routes/orders/index.tsx',
  'apps/admin/src/main.tsx',
  'apps/admin/src/UnhandledRejectionBanner.tsx',
  'apps/partner/src/routes/sources/index.tsx',
]

{
  const sampleBad = 'setError(err instanceof Error ? err.message : "x")'
  const sampleOk = 'setError(userMessageOf(err, "x"))'
  if (!RAW_MESSAGE.test(sampleBad) || RAW_MESSAGE.test(sampleOk)) {
    fail('RAW_MESSAGE 正则自检失败')
  } else {
    pass('反模式正则能抓住 instanceof Error ? *.message')
  }
}

for (const rel of PACKET_PAGES) {
  const source = stripComments(read(rel))
  const raw = RAW_MESSAGE.exec(source)
  if (raw) fail(`${rel}: 仍有 ${raw[0]} 直接进渲染`)
  const asErr = AS_ERROR_MESSAGE.exec(source)
  if (asErr) fail(`${rel}: 仍有 ${asErr[0]} 直接进渲染`)
}
if (failures === 0) pass(`本包 ${PACKET_PAGES.length} 个页面/入口不再把 Error.message 原样上屏`)

{
  const printJobs = read('apps/kiosk/src/services/print/printJobsApi.ts')
  const payment = read('apps/kiosk/src/services/print/paymentApi.ts')
  if (/throw new Error\(/.test(printJobs) || /createPrintJob failed:/.test(printJobs)) {
    fail('printJobsApi.ts 仍抛裸 Error / failed: 技术串')
  }
  if (/throw new Error\(/.test(payment) || /failed: \$\{/.test(payment)) {
    fail('paymentApi.ts 仍抛裸 Error / failed: 技术串')
  }
  if (!printJobs.includes('ApiHttpError') || !printJobs.includes('TERMINAL_NOT_READY')) {
    fail('printJobsApi.ts 缺少 ApiHttpError(TERMINAL_NOT_READY)')
  }
  if (!payment.includes('ApiHttpError') || !payment.includes('throwHttpError')) {
    fail('paymentApi.ts 未走 throwHttpError / ApiHttpError')
  }
  if (!printJobs.includes('throwHttpError')) {
    fail('printJobsApi.ts 401 未接入会话重置')
  }
  pass('打印/支付适配器抛 ApiHttpError 且缺终端身份映射中文')
}

{
  const bearerModules = [
    'apps/kiosk/src/services/print/printJobsApi.ts',
    'apps/kiosk/src/services/files/usbImportApi.ts',
    'apps/kiosk/src/services/api/printConversion.ts',
    'apps/kiosk/src/services/api/scanTasks.ts',
    'apps/kiosk/src/services/api/printSign.ts',
    'apps/kiosk/src/services/api/aiHttpAdapter.ts',
  ]
  for (const rel of bearerModules) {
    const source = read(rel)
    if (
      !source.includes('notifyMemberSessionExpired')
      && !source.includes('notifySessionIfInvalid')
      && !source.includes('throwHttpError')
    ) {
      fail(`${relative(repoRoot, join(repoRoot, rel))}: 401 未触发会话重置`)
    }
  }
  const feedback = read('apps/kiosk/src/services/api/kioskFeedback.ts')
  if (/Authorization/.test(feedback) && !/不捎带/.test(feedback)) {
    fail('kioskFeedback.ts 不应携带会员 Authorization')
  }
  pass('6 个 Bearer 模块 401 触发会话重置；匿名反馈不带 Bearer')
}

{
  const main = read('apps/admin/src/main.tsx')
  const banner = read('apps/admin/src/UnhandledRejectionBanner.tsx')
  if (!main.includes('UnhandledRejectionBanner') || !banner.includes('unhandledrejection') || !banner.includes('userMessageOf')) {
    fail('admin 缺少 unhandledrejection + userMessageOf 全局提示')
  } else {
    pass('Admin 全局 unhandledrejection 提示已接入')
  }
}

{
  const confirm = read('apps/kiosk/src/pages/print/PrintConfirmPage.tsx')
  const cashier = read('apps/kiosk/src/pages/print/PrintCashierPage.tsx')
  const scan = read('apps/kiosk/src/pages/scan/ScanSettingsPage.tsx')
  const partner = read('apps/partner/src/routes/sources/index.tsx')
  const userMsg = read('apps/kiosk/src/services/api/userErrorMessage.ts')
  if (!confirm.includes('userMessageOf') || !cashier.includes('userMessageOf') || !scan.includes('userMessageOf')) {
    fail('确认页/收银页/扫描设置页未走 userMessageOf')
  }
  if (!partner.includes('createSourceErrorMessage') || !partner.includes('WEBHOOK_SECRET_LOW_ENTROPY')) {
    fail('Partner 来源创建未按 code 映射文案')
  }
  const requiredCodes = [
    'NETWORK_ERROR',
    'TERMINAL_NOT_READY',
    'ONLINE_PAYMENT_DISABLED',
    'SCAN_TERMINAL_BUSY',
    'PRINTER_UNAVAILABLE',
  ]
  for (const code of requiredCodes) {
    if (!userMsg.includes(`${code}:`)) fail(`userErrorMessage.ts 缺少 ${code} 中文映射`)
  }
  const nextStepRe = /重试|联系现场|返回/
  if (!nextStepRe.test(userMsg) || !nextStepRe.test(scan) || !nextStepRe.test(partner)) {
    fail('故障文案缺少下一步（重试 / 联系现场 / 返回）')
  }
  pass('确认页/收银页/扫描设置/来源创建：中文映射且含下一步')
}

{
  const ai = read('apps/kiosk/src/services/api/aiHttpAdapter.ts')
  const materials = read('apps/kiosk/src/services/api/jobMaterials.ts')
  if (!ai.includes('networkError') || !materials.includes('networkError')) {
    fail('AI / 求职材料适配器未把断网包成 NETWORK_ERROR')
  } else {
    pass('断网 TypeError 在 AI / 材料适配器包成 NETWORK_ERROR')
  }
}

if (failures > 0) {
  console.error(`\n❌ verify:no-raw-error-render  ${failures} 项失败`)
  process.exit(1)
}
console.log('\n✅ verify:no-raw-error-render  ALL PASS')
