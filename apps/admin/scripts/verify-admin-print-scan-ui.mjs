// Task 10 — Admin 打印扫描运维页静态防线。
//
// 断言口径：
//   1. 页面/服务只暴露白名单动作（retry/cancel），不出现强制释放、改支付状态等越权写操作。
//   2. 未上线任务类型必须如实展示"未上线"，不得出现伪造行数据的 mock 常量。
//   3. 能力开关 fail-closed 语义文案在页（只有 available 对用户开放）。
//   4. 商业化控制不伪造补贴标签/退款工作流配置项，复用 billing/benefit 入口。
//   5. 路由与导航已注册。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pagePath = join(root, 'src/routes/print-scan/index.tsx')
const servicePath = join(root, 'src/services/api/printScan.ts')
const closeFormPath = join(root, 'src/routes/print-scan/CloseUnpaidPrintTaskForm.tsx')
const routesPath = join(root, 'src/routes/index.tsx')
const layoutPath = join(root, 'src/layouts/AdminLayoutWrapper.tsx')

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

console.log('\n=== Admin print-scan ops UI verification ===')

if (!existsSync(pagePath)) fail('print-scan page is missing')
if (!existsSync(servicePath)) fail('printScan service is missing')
if (!existsSync(closeFormPath)) fail('controlled unpaid-print close form is missing')
const page = readFileSync(pagePath, 'utf8')
const service = readFileSync(servicePath, 'utf8')
const closeForm = readFileSync(closeFormPath, 'utf8')
const routes = readFileSync(routesPath, 'utf8')
const layout = readFileSync(layoutPath, 'utf8')

// 1. 动作白名单
if (service.includes('/admin/print-scan/tasks') && service.includes('applyTaskAction')) {
  pass('service exposes unified task center endpoints')
} else {
  fail('service must call /admin/print-scan/tasks endpoints')
}
for (const forbidden of ['release', 'forceRelease', '强制释放', '标记已支付', '标记退款', 'DELETE']) {
  if (service.includes(forbidden)) fail(`service contains forbidden operation: ${forbidden}`)
}
if (/action: 'retry' \| 'cancel'|AdminPrintScanAction = 'retry' \| 'cancel'/.test(service)) {
  pass('service action union is limited to retry/cancel')
} else {
  fail('service action union must be limited to retry/cancel')
}
if (
  service.includes('/admin/print-scan/tasks/print/${encodeURIComponent(taskId)}/close-unpaid') &&
  service.includes("closeUnpaidEligible: boolean") &&
  service.includes("ADMIN_UNPAID_CLOSE_NOT_ELIGIBLE") &&
  page.includes('closeUnpaidEligible === true') &&
  page.includes('closeUnpaidBlockReason') &&
  page.includes('CLOSE_UNPAID_BLOCK_REASON_LABELS') &&
  closeForm.includes('取消原因（10–500 字）') &&
  closeForm.includes('确认取消任务')
) {
  pass('controlled unpaid-print close endpoint, eligibility and confirmation form stay aligned')
} else {
  fail('controlled unpaid-print close endpoint, eligibility and confirmation form must stay aligned')
}

// 2. 未上线类型诚实展示
if (page.includes('未上线') && page.includes('implemented: false')) {
  pass('page marks unimplemented task types honestly')
} else {
  fail('page must mark photo/copy/material_pack/format_conversion/signature_stamp as 未上线')
}
if (page.includes('该任务类型尚未上线') && page.includes('不展示占位数据')) {
  pass('unimplemented types render an honest empty state, not fabricated rows')
} else {
  fail('unimplemented types must render an honest empty state')
}
for (const key of ["type: 'photo'", "type: 'copy'", "type: 'material_pack'"]) {
  if (service.includes(`${key},`) && service.includes('MOCK') && new RegExp(`MOCK_[A-Z_]*\\s*[:=][^]*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(service)) {
    fail(`mock adapter must not fabricate rows for unimplemented type: ${key}`)
  }
}
pass('mock adapter does not fabricate rows for unimplemented task types')

// 3. 能力开关 fail-closed 文案
if (page.includes('fail-closed') && page.includes('只有「可用」状态对普通用户开放')) {
  pass('capability center states the fail-closed rule')
} else {
  fail('capability center must state the fail-closed rule (only available is user-facing)')
}

// 4. 商业化控制诚实标注
if (page.includes('尚未建设') && page.includes('补贴标签') && page.includes('/billing')) {
  pass('commercial controls reuse billing entry and mark missing features honestly')
} else {
  fail('commercial controls must link /billing and honestly mark 补贴标签/退款工作流 as not built')
}
for (const forbidden of ['补贴标签配置', '新建补贴标签', '退款工作流配置']) {
  if (page.includes(forbidden)) fail(`commercial controls must not fake config entry: ${forbidden}`)
}

// 5. 路由与导航注册
if (routes.includes("path: 'print-scan'") && routes.includes('PrintScanOpsPage')) {
  pass('route /print-scan is registered')
} else {
  fail('route /print-scan must be registered in routes/index.tsx')
}
if (layout.includes("'/print-scan'") && layout.includes('打印扫描运维')) {
  pass('sidebar nav entry is registered')
} else {
  fail('sidebar nav entry 打印扫描运维 must be registered')
}

console.log('\nverify-admin-print-scan-ui: ok')
