// Task 10 — Admin 打印扫描运维页静态防线。
//
// 断言口径：
//   1. 页面/服务只暴露白名单动作（retry/cancel），不出现强制释放、改支付状态等越权写操作。
//   2. 未上线任务类型必须如实展示"未上线"，不得出现伪造行数据的 mock 常量。
//   3. 能力开关 fail-closed 语义文案在页（只有 available 对用户开放）。
//   4. 商业化控制不伪造补贴标签/退款工作流配置项，复用 billing/benefit 入口。
//   5. 路由与导航已注册。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pagePath = join(root, 'src/routes/print-scan/index.tsx')
const retryButtonPath = join(root, 'src/routes/print-scan/PrintRetryButton.tsx')
// 「设备能力」板块 2026-09-29 从 index.tsx 原样拆到独立文件；能力开关相关断言改读这里，强度不变。
const capabilityPath = join(root, 'src/routes/print-scan/CapabilityCenter.tsx')
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
if (!existsSync(capabilityPath)) fail('print-scan capability center is missing')
if (!existsSync(retryButtonPath)) fail('print retry button is missing')
const page = readFileSync(pagePath, 'utf8')
const retryUi = readFileSync(retryButtonPath, 'utf8')
const cap = readFileSync(capabilityPath, 'utf8')
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
if (
  page.includes("detail.errorCode === 'PRINT_JOB_UNCONFIRMED'") &&
  page.includes("detail.status === 'failed' && !isUnconfirmed") &&
  page.includes('打印结果未确认，禁止重试，避免重复出纸') &&
  page.includes('已核查·已出纸') &&
  page.includes('已完成现场核查，仍禁止重新排队') &&
  page.includes('<Link to="/orders"') &&
  service.includes("item.errorCode === 'PRINT_JOB_UNCONFIRMED'") &&
  service.includes("'PRINT_RETRY_UNCONFIRMED_FORBIDDEN'")
) {
  pass('unconfirmed print tasks hide retry, guide to orders, and mock mode mirrors the backend hard rejection')
} else {
  fail('PRINT_JOB_UNCONFIRMED retry suppression and orders guidance must stay aligned')
}
// 旧前缀已由服务端改成 PRINT_RETRY_。这里拆开拼，避免本文件自己带上那段连续旧前缀。
const retiredRetryCode = ['PRINT', 'SCAN', 'RETRY', ''].join('_')
const retiredRetryHits = []
const skipScanDirs = new Set(['node_modules', 'dist', 'coverage', 'test-results', 'playwright-report', 'blob-report'])
function scanRetiredRetryCode(dir) {
  for (const name of readdirSync(dir)) {
    if (skipScanDirs.has(name)) continue
    const full = join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) {
      scanRetiredRetryCode(full)
      continue
    }
    if (!info.isFile() || info.size > 2_000_000) continue
    const text = readFileSync(full, 'utf8')
    if (text.includes(retiredRetryCode)) retiredRetryHits.push(full.slice(root.length + 1))
  }
}
scanRetiredRetryCode(root)
if (retiredRetryHits.length === 0) {
  pass('apps/admin source no longer contains the retired retry code prefix')
} else {
  fail(`apps/admin source still contains the retired retry code prefix: ${retiredRetryHits.join(', ')}`)
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
if (page.includes('该任务类型尚未上线') && page.includes('该能力尚未开放，目前没有可查看的真实任务。')) {
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

// 3. 能力开关 fail-closed 文案（板块在 CapabilityCenter.tsx，页面必须真的挂载它）
if (
  page.includes("import { CapabilityCenter } from './CapabilityCenter'") &&
  page.includes("{section === 'capabilities' && <CapabilityCenter />}") &&
  cap.includes('export function CapabilityCenter()')
) {
  pass('print-scan page mounts the extracted capability center')
} else {
  fail('print-scan page must import and render CapabilityCenter from ./CapabilityCenter')
}
if (cap.includes('只有标为「可用」的能力对用户开放') && cap.includes('「测试中」只给运维使用') && cap.includes('没有登记的能力一律不开放')) {
  pass('capability center states that only 可用 is open to users')
} else {
  fail('capability center must state that only 可用 is open to users, 测试中 is ops-only, and unregistered capabilities stay closed')
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
  page.includes("const queryKey = [taskType, status, String(page), String(pageSize)].join('\\u0000')") &&
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
if (!page.includes('const [pageSize, setPageSize] = useState(20)') ||
    !page.includes('pageSize={pageSize}') || !page.includes('onPageSizeChange={setPageSize}') ||
    !page.includes('page, pageSize }') || !page.includes('[taskType, status, page, pageSize, queryKey]')) fail('统一分页器每页条数必须接入请求和竞态保护')

// 7. 保存请求必须同时绑定 sequence + terminal：A 的 success/catch/finally 都不得污染切到 B 后的 UI。
if (
  cap.includes('const saveSeq = useRef(0)') &&
  cap.includes('saveSeq.current += 1') &&
  cap.includes('const requestSeq = ++saveSeq.current') &&
  cap.includes('const requestedTerminalId = terminalId') &&
  cap.includes('updateCapability(requestedTerminalId, key') &&
  cap.includes('const isCurrentSaveRequest = () =>') &&
  cap.includes('saveSeq.current === requestSeq') &&
  cap.includes('terminalIdRef.current === requestedTerminalId') &&
  cap.includes('if (!isCurrentSaveRequest()) return') &&
  (cap.match(/if \(isCurrentSaveRequest\(\)\) \{/g)?.length ?? 0) >= 2 &&
  cap.includes('setSavingKey(null)') &&
  cap.includes('setSaveError(null)')
) {
  pass('capability save invalidates old terminal requests and guards success/catch/finally')
} else {
  fail('capability save must use sequence + terminal guards for success/catch/finally')
}

// 8. 用户切换终端的同一事件帧必须清空 A 的保存/能力 UI、失效旧加载请求并更新 ref，再更新 terminalId。
const switchTerminalBlock = cap.match(/const switchTerminal = \(nextTerminalId: string\) => \{[\s\S]*?\n  \}\n\n  const save/)?.[0] ?? ''
if (
  switchTerminalBlock.includes('saveSeq.current += 1') &&
  switchTerminalBlock.includes('capSeq.current += 1') &&
  switchTerminalBlock.includes('terminalIdRef.current = nextTerminalId') &&
  switchTerminalBlock.includes('setSavingKey(null)') &&
  switchTerminalBlock.includes('setSaveError(null)') &&
  switchTerminalBlock.includes('setCapabilities(null)') &&
  switchTerminalBlock.includes('setLoading(true)') &&
  switchTerminalBlock.includes('setTerminalId(nextTerminalId)') &&
  cap.includes('onChange={(e) => switchTerminal(e.target.value)}')
) {
  pass('terminal selection synchronously invalidates old save/load/UI state before terminalId changes')
} else {
  fail('terminal selection must invalidate old save/load/UI state before changing terminalId')
}

// 9. 重试按钮事先显示能不能点：只看服务端 retryBlockedReason，不在前端推断。
if (service.includes('retryBlockedReason?: string | null')) {
  pass('print task type carries optional retryBlockedReason')
} else {
  fail('print task type must declare retryBlockedReason?: string | null')
}
if ((page.match(/<PrintRetryButton/g) ?? []).length === 2 && page.includes('legacyVisible={canRetry}') && page.includes('legacyVisible={false}')) {
  pass('list and detail both render the shared retry button; missing field keeps the old list hidden')
} else {
  fail('list and detail must both render PrintRetryButton, detail legacyVisible={canRetry}, list legacyVisible={false}')
}
const disabledAttr = retryUi.match(/(^|\n)[ \t]*disabled=\{busy \|\| retryBlocked\}/)
const ariaDisabledAttr = retryUi.match(/(^|\n)[ \t]*aria-disabled=\{busy \|\| retryBlocked\}/)
if (
  retryUi.includes("const retryBlocked = typeof retryBlockedReason === 'string'") &&
  disabledAttr &&
  ariaDisabledAttr &&
  retryUi.includes('if (retryBlockedReason === undefined && !legacyVisible) return null') &&
  !/disabled=\{[^}]*retryBlockedReason == null/.test(retryUi) &&
  !/disabled=\{[^}]*!retryBlockedReason/.test(retryUi) &&
  !/disabled=\{[^}]*(status|errorCode|canRetry)/.test(retryUi)
) {
  pass('retry button disables only when retryBlockedReason is a string; a missing field is not greyed out')
} else {
  fail('retry disabled must be exactly busy || retryBlocked, and retryBlocked must be typeof retryBlockedReason === \'string\'')
}
if (/<p [^>]*>\{retryBlockedReason\}<\/p>/.test(retryUi) && !/title=\{retryBlockedReason\}/.test(retryUi)) {
  pass('blocked reason is rendered as text under the button')
} else {
  fail('retryBlockedReason must be rendered in a paragraph, not only as a title tooltip')
}
const forceReprintNote = '后台不提供强制重打；需要补打请让用户另下新单。'
const forceReprintCount = page.split(forceReprintNote).length - 1
if (forceReprintCount === 1 && !retryUi.includes(forceReprintNote)) {
  pass('force reprint note is written once on the page')
} else {
  fail(`force reprint note must appear once on the page and not inside each button, found ${forceReprintCount}`)
}
if (page.includes("setActionError(e instanceof Error ? e.message : '操作失败')")) {
  pass('rejected retry keeps the server message')
} else {
  fail('retry failure must surface the server error message')
}

// 10. 未登记行的「调整为」不预选 cap.status。列表对缺行固定回 not_verified，
// 直接登记会把仍跟随部署设置（managed 下放行）的能力写成关闭。
const capabilityRow = cap.slice(cap.indexOf('function CapabilityRow('), cap.indexOf('function SignatureCapabilityRow('))
if (!capabilityRow.includes('function CapabilityRow(')) fail('CapabilityRow source block is missing')
const blankInitial = "useState<PrintScanCapabilityStatus | ''>(cap.configured ? cap.status : '')"
const blankReset = "setStatus(cap.configured ? cap.status : '')"
if (
  capabilityRow.includes(blankInitial) &&
  capabilityRow.includes(blankReset) &&
  !/useState<[^>\n]+>\(\s*cap\.status\s*\)/.test(capabilityRow) &&
  !/setStatus\(\s*cap\.status\s*\)/.test(capabilityRow) &&
  !cap.includes('未登记的行允许不改任何内容、原样登记')
) {
  pass('unconfigured rows start blank; configured rows still start from the saved status')
} else {
  fail('unconfigured rows must initialize and reset to empty string; configured rows must keep cap.status; the old “原样登记” note must be gone')
}
const placeholder = `{!cap.configured && (
            <option value="" disabled>
              请选择
            </option>
          )}`
if (capabilityRow.includes(placeholder)) {
  pass('unconfigured rows show a disabled 请选择 placeholder and configured rows do not')
} else {
  fail('unconfigured rows must render a disabled placeholder option 请选择, gated by !cap.configured')
}
if (
  capabilityRow.includes("const savable = cap.configured ? dirty : status !== ''") &&
  capabilityRow.includes('disabled={!savable || saving}') &&
  capabilityRow.includes("if (status === '') return") &&
  capabilityRow.includes("{!cap.configured && status === '' && <span className=\"whitespace-nowrap\">请先选择要登记的状态</span>}") &&
  !capabilityRow.includes('dirty || !cap.configured')
) {
  pass('register stays disabled with a hint until a status is chosen; a chosen status can be registered')
} else {
  fail('unconfigured register must stay disabled until status !== \'\', show 请先选择要登记的状态, and become savable once a status is chosen')
}

console.log('\nverify-admin-print-scan-ui: ok')
