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

// 6. 动作后的 refresh 必须区分 failed/stale：旧 A 闭包不能覆盖切换后的 B 查询，也不能把 stale 误报成失败。
if (
  page.includes("const queryKey = [taskType, status, String(page)].join('\\u0000')") &&
  page.includes('const queryKeyRef = useRef(queryKey)') &&
  page.includes('queryKeyRef.current = queryKey') &&
  page.includes("Promise<'success' | 'failed' | 'stale'>") &&
  page.includes('const requestQueryKey = queryKey') &&
  page.includes("return 'stale'") &&
  page.includes('const actionQueryKey = queryKeyRef.current') &&
  page.includes('if (actionQueryKey !== queryKeyRef.current) return') &&
  page.includes("if (refreshResult === 'failed')") &&
  page.includes('操作已执行成功，但页面刷新失败，请手动刷新查看最新状态')
) {
  pass('task action treats stale refresh as neutral and only reports real refresh failures')
} else {
  fail('task action must guard old query closures and distinguish failed from stale refresh')
}

// 7. 保存请求必须同时绑定 sequence + terminal：A 的 success/catch/finally 都不得污染切到 B 后的 UI。
if (
  page.includes('const saveSeq = useRef(0)') &&
  page.includes('saveSeq.current += 1') &&
  page.includes('const requestSeq = ++saveSeq.current') &&
  page.includes('const requestedTerminalId = terminalId') &&
  page.includes('updateCapability(requestedTerminalId, key') &&
  page.includes('const isCurrentSaveRequest = () =>') &&
  page.includes('saveSeq.current === requestSeq') &&
  page.includes('terminalIdRef.current === requestedTerminalId') &&
  page.includes('if (!isCurrentSaveRequest()) return') &&
  (page.match(/if \(isCurrentSaveRequest\(\)\) \{/g)?.length ?? 0) >= 2 &&
  page.includes('setSavingKey(null)') &&
  page.includes('setSaveError(null)')
) {
  pass('capability save invalidates old terminal requests and guards success/catch/finally')
} else {
  fail('capability save must use sequence + terminal guards for success/catch/finally')
}

// 8. 用户切换终端的同一事件帧必须清空 A 的保存/能力 UI、失效旧加载请求并更新 ref，再更新 terminalId。
const switchTerminalBlock = page.match(/const switchTerminal = \(nextTerminalId: string\) => \{[\s\S]*?\n  \}\n\n  const save/)?.[0] ?? ''
if (
  switchTerminalBlock.includes('saveSeq.current += 1') &&
  switchTerminalBlock.includes('capSeq.current += 1') &&
  switchTerminalBlock.includes('terminalIdRef.current = nextTerminalId') &&
  switchTerminalBlock.includes('setSavingKey(null)') &&
  switchTerminalBlock.includes('setSaveError(null)') &&
  switchTerminalBlock.includes('setCapabilities(null)') &&
  switchTerminalBlock.includes('setLoading(true)') &&
  switchTerminalBlock.includes('setTerminalId(nextTerminalId)') &&
  page.includes('onChange={(e) => switchTerminal(e.target.value)}')
) {
  pass('terminal selection synchronously invalidates old save/load/UI state before terminalId changes')
} else {
  fail('terminal selection must invalidate old save/load/UI state before changing terminalId')
}

console.log('\nverify-admin-print-scan-ui: ok')
