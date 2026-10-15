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
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
  // SES-12 第二批（2026-09-07）：残留原样渲染 err.message 的页面
  'apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx',
  'apps/kiosk/src/pages/activities/BenefitActivityDetailPage.tsx',
  'apps/kiosk/src/pages/interview/InterviewReportPage.tsx',
  'apps/kiosk/src/pages/interview/InterviewSetupPage.tsx',
  'apps/kiosk/src/pages/job-fairs/FairCompanyDetailPage.tsx',
  'apps/kiosk/src/pages/job-fairs/FairMaterialsPage.tsx',
  'apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx',
  'apps/kiosk/src/pages/resume/components/ResumeUsbImportPanel.tsx',
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
  'apps/admin/src/routes/orders/orderColumns.tsx',
  'apps/admin/src/routes/orders/orderDisplay.ts',
  'apps/admin/src/routes/orders/useOrderDetail.ts',
  'apps/admin/src/routes/orders/OrderDetailDrawer.tsx',
  'apps/admin/src/routes/orders/OrderAftercare.tsx',
  'apps/admin/src/routes/orders/OrderPaymentActions.tsx',
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

// F. 两个后台的页面与组件不得把 *.message 直接放进 JSX 或 set*Error / setMessage / toast。
//    经 userMessageOf(...) 包一层的不算。下面每条允许都写明为什么不是给人看的异常原文。
const MESSAGE_ALLOW = [
  {
    rel: 'apps/admin/src/routes/users/UserClosureDialog.tsx',
    ok: (line) => line.includes('failure.message'),
    why: 'failure 来自 userClosurePresentation.ts 的 closureFailure：已登记的注销错误码走中文码表（合规定稿），其余经 userMessageOf，不含异常原文。',
  },
  {
    rel: 'apps/partner/src/routes/screen/screenView.tsx',
    ok: (line) => line.includes('result.message'),
    why: 'result 来自 consoleScreen.ts 的 ScreenFetchResult，message 已由 readableMessage 按大屏专用码表转成中文（如「当前账号没有查看机构数据大屏的权限」），比通用码表更具体。',
  },
  {
    rel: 'apps/admin/src/routes/ai-services/AiAccessSwitchesPanel.tsx',
    ok: (line) => line.includes('reasonProblem.message'),
    why: '本页自己的中文校验文案（请填写切换事由 / 长度限制），不是异常原文。',
  },
  {
    rel: 'apps/admin/src/routes/member-benefits/grantFormModel.ts',
    ok: (line) => line.includes('http.message') || line.includes('record.message'),
    why: '解析 ApiHttpError 交给 grantErrorMessage，页面不渲染这段原文。',
  },
  {
    rel: 'apps/admin/src/routes/sync-sources/syncSourcesApi.ts',
    ok: (line) => line.includes('body.error?.message'),
    why: '解析响应体后抛出，页面不直接渲染。',
  },
  {
    rel: 'apps/admin/src/routes/toolbox/toolboxActionState.ts',
    ok: (line) => line.includes('candidate.message'),
    why: '只用来对照拦截原因码后缀（BLOCK_REASON_LABELS），对不上则交给 userMessageOf，不把英文原文返回页面。',
  },
]

function walkTs(dir, out) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkTs(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
}

function maskUserMessageOf(source) {
  const token = 'userMessageOf('
  let out = ''
  let i = 0
  while (i < source.length) {
    const idx = source.indexOf(token, i)
    if (idx < 0) {
      out += source.slice(i)
      break
    }
    out += source.slice(i, idx) + 'userMessageOf()'
    let depth = 1
    let j = idx + token.length
    let quote = ''
    while (j < source.length && depth > 0) {
      const ch = source[j]
      if (quote) {
        if (ch === quote && source[j - 1] !== '\\') quote = ''
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
      else if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
      j += 1
    }
    i = j
  }
  return out
}

{
  const scanDirs = [
    'apps/admin/src/routes',
    'apps/admin/src/components',
    'apps/partner/src/routes',
    'apps/partner/src/components',
  ]
  let rawHits = 0
  for (const relDir of scanDirs) {
    const files = []
    walkTs(join(repoRoot, relDir), files)
    for (const full of files) {
      const rel = relative(repoRoot, full)
      const lines = maskUserMessageOf(stripComments(read(rel))).split('\n')
      lines.forEach((line, index) => {
        if (!/\.message\b/.test(line)) return
        const allow = MESSAGE_ALLOW.find((item) => item.rel === rel && item.ok(line))
        if (allow) return
        rawHits += 1
        fail(`${rel}:${index + 1} 把 .message 直接放进页面或状态：${line.trim()}`)
      })
    }
  }
  if (rawHits === 0) {
    pass(`页面与组件的 .message 只出现在 userMessageOf 内，或 ${MESSAGE_ALLOW.length} 条已写明理由的允许项`)
  }
}

{
  const probe = [
    "import assert from 'node:assert/strict'",
    "import { userMessageOf as adminOf } from '../../apps/admin/src/services/api/userErrorMessage.ts'",
    "import { userMessageOf as partnerOf } from '../../apps/partner/src/services/api/userErrorMessage.ts'",
    'function httpError(code, message, status = 400) {',
    '  const error = new Error(message)',
    "  error.name = 'ApiHttpError'",
    '  return Object.assign(error, { code, status })',
    '}',
    'const pageType = new TypeError("Cannot read properties of undefined (reading \'items\')")',
    "assert.equal(adminOf(pageType, '加载失败，请稍后重试'), '加载失败，请稍后重试')",
    "assert.equal(partnerOf(pageType, '加载失败，请稍后重试'), '加载失败，请稍后重试')",
    "assert.equal(adminOf(new TypeError('Failed to fetch'), '加载失败，请稍后重试'), '网络连接失败，请检查网络后重试')",
    "assert.equal(partnerOf(new TypeError('Failed to fetch'), '加载失败，请稍后重试'), '网络连接失败，请检查网络后重试')",
    "assert.equal(adminOf(new Error('socket hang up'), '保存失败，请检查后重试'), '保存失败，请检查后重试')",
    "assert.equal(partnerOf(new Error('socket hang up'), '保存失败，请检查后重试'), '保存失败，请检查后重试')",
    "assert.equal(adminOf(new Error('请先选择终端'), '保存失败，请检查后重试'), '请先选择终端')",
    "assert.equal(partnerOf(httpError('SOME_NEW_CODE', '该终端正在维护，请稍后再改'), '保存失败，请稍后重试'), '该终端正在维护，请稍后再改')",
    "assert.equal(adminOf(httpError('ORDER_NOT_FOUND', 'missing'), '加载订单失败，请稍后重试'), '订单不存在')",
    "assert.equal(partnerOf(httpError('ORG_REQUIRED', 'missing'), '加载失败，请稍后重试'), '当前账号未绑定机构，无法查看本机构数据')",
    "console.log('userMessageOf runtime ok')",
  ].join('\n')
  const result = spawnSync(
    'pnpm',
    ['--filter', '@ai-job-print/api', 'exec', 'node', '--import', 'tsx', '--input-type=module', '-e', probe],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    fail(`userMessageOf 运行时断言失败（exit ${result.status}）\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  } else if (!String(result.stdout).includes('userMessageOf runtime ok')) {
    fail(`userMessageOf 运行时没有打印成功\n${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  } else {
    pass('userMessageOf 运行时：页面 TypeError 用兜底，断网才算网络，无中文 Error 用兜底，中文与已登记码按规则')
  }
}

if (failures > 0) {
  console.error(`\n❌ verify:no-raw-error-render  ${failures} 项失败`)
  process.exit(1)
}
console.log('\n✅ verify:no-raw-error-render  ALL PASS')
