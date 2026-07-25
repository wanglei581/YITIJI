// Admin 终端绑定码 UI 防回退验证（静态门禁，不连服务）。
// 锁以下 5 点：
// 1. devices 出口已暴露 createTerminalBindCode；
// 2. http / mock 适配器都接好了 createTerminalBindCode；
// 3. 终端页存在「生成绑定码」按钮和弹窗入口；
// 4. 弹窗展示 bindCode 明文 + 倒计时 + 复制按钮；
// 5. 弹窗包含 install-production-agent.ps1 命令示例。

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function pass(message) {
  console.log(`  PASS ${message}`)
}

function fail(message) {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

const required = [
  'src/routes/terminals/index.tsx',
  'src/routes/terminals/TerminalBindCodeDialog.tsx',
  'src/routes/terminals/CreatePlannedTerminalDialog.tsx',
  'src/routes/terminals/TerminalLifecycleActions.tsx',
  'src/services/api/devices.ts',
  'src/services/api/adminHttpAdapter.ts',
  'src/services/api/adminMockAdapter.ts',
  'src/services/api/types.ts',
]

console.log('\n=== Admin 终端一次性绑定码 UI verification ===')
const loaded = {}
for (const rel of required) {
  const abs = join(root, rel)
  if (!existsSync(abs)) fail(`Missing required file: ${rel}`)
  loaded[rel] = readFileSync(abs, 'utf8')
}

const { 'src/routes/terminals/index.tsx': page } = loaded
const { 'src/routes/terminals/TerminalBindCodeDialog.tsx': dialog } = loaded
const { 'src/routes/terminals/CreatePlannedTerminalDialog.tsx': plannedDialog } = loaded
const { 'src/routes/terminals/TerminalLifecycleActions.tsx': lifecycleActions } = loaded
const { 'src/services/api/devices.ts': devices } = loaded
const { 'src/services/api/adminHttpAdapter.ts': http } = loaded
const { 'src/services/api/adminMockAdapter.ts': mock } = loaded
const { 'src/services/api/types.ts': types } = loaded

if (
  devices.includes('createTerminalBindCode') &&
  devices.includes('TerminalBindCodeCreated') &&
  devices.includes('生成一次性终端绑定码')
) {
  pass('devices 出口暴露 createTerminalBindCode 并 reexport TerminalBindCodeCreated')
} else {
  fail('devices service must export createTerminalBindCode + TerminalBindCodeCreated')
}

if (
  types.includes('interface TerminalBindCodeCreated') &&
  types.includes('bindCode') &&
  types.includes('expiresAt')
) {
  pass('types 定义 TerminalBindCodeCreated（不含明文持久化字段）')
} else {
  fail('types must define TerminalBindCodeCreated with bindCode + expiresAt')
}

if (
  http.includes("/admin/terminals/${encodeURIComponent(terminalId)}/bind-code") &&
  http.includes('createTerminalBindCode') &&
  mock.includes('createTerminalBindCode') &&
  mock.includes('mockBindCode')
) {
  pass('http + mock 适配器都实现 createTerminalBindCode')
} else {
  fail('adminHttpAdapter and adminMockAdapter must both implement createTerminalBindCode')
}

if (
  page.includes('生成绑定码') &&
  page.includes('openBindCodeModal') &&
  page.includes('bindCodeTerminal') &&
  page.includes('TerminalBindCodeDialog')
) {
  pass('终端页含「生成绑定码」按钮和弹窗状态')
} else {
  fail('admin terminals page must contain 生成绑定码 entry + modal state')
}

if (
  dialog.includes('install-production-agent.ps1') &&
  dialog.includes('-BindCode') &&
  dialog.includes('-PrinterName') &&
  dialog.includes("join(' `\\n  ')")
) {
  pass('弹窗展示 PowerShell install-production-agent.ps1 命令示例（包含 -BindCode/-PrinterName 和反引号续行）')
} else {
  fail('modal must surface PowerShell install-production-agent.ps1 command sample with -BindCode + -PrinterName')
}

if (
  dialog.includes('formatCountdown') &&
  dialog.includes('bindCodeCountdown') &&
  dialog.includes('CopyIcon')
) {
  pass('弹窗含倒计时 + 复制按钮')
} else {
  fail('modal must include countdown + copy entry')
}

// 不能在日志字段、审计、payload 或静态资产中继续暴露 bindCode 明文
// （这一步防止后续误把 bindCode 直接写进 audit payload）。
const suspect = ['AuditLog', 'audit', 'payload', 'console.log', 'console.error']
for (const token of suspect) {
  // 这条规则不强制 0 命中；只在明确把 bindCode 拼进审计字符串时报错
  const re = new RegExp(`${token}[^\\n]{0,80}bindCode[^\\n]{0,80}`, 'g')
  const matches = `${page}\n${dialog}`.match(re) ?? []
  const realLeak = matches.filter(
    (m) => !m.includes('TerminalBindCodeCreated') && !m.includes('bindCodeTerminal'),
  )
  if (realLeak.length > 0) {
    fail(`page references bindCode near ${token}; do not log/audit plaintext bindCode:\n${realLeak.join('\n')}`)
  }
}
pass('页面对 plaintext bindCode 没有出现日志或审计旁路')

if (
  page.includes('预创建设备') &&
  page.includes('CreatePlannedTerminalDialog') &&
  plannedDialog.includes('createPlannedTerminal') &&
  plannedDialog.includes('这里只创建设备资产，不签发凭证') &&
  devices.includes('createPlannedTerminal') &&
  http.includes("postData<PlannedTerminalCreated>('/admin/terminals', input)") &&
  mock.includes('createPlannedTerminal')
) {
  pass('现有设备管理页接入 Admin 预创建设备，http/mock 双适配且不宣称签发凭证')
} else {
  fail('Admin terminals page must expose planned-device creation through existing device management entry')
}

if (
  page.includes('TerminalLifecycleActions') &&
  page.includes("t.lifecycleStatus === 'planned' || t.lifecycleStatus === 'maintenance'") &&
  page.includes('换机前请先进入维护') &&
  lifecycleActions.includes('updateTerminalLifecycle') &&
  lifecycleActions.includes('进入维护') &&
  lifecycleActions.includes('恢复运行') &&
  lifecycleActions.includes('操作原因（必填）') &&
  lifecycleActions.includes('normalizedReason.length >= 8') &&
  lifecycleActions.includes('expectedVersion: terminal.lifecycleVersion') &&
  lifecycleActions.includes('请填写 8–500 个字符') &&
  devices.includes('updateTerminalLifecycle') &&
  http.includes('patchData<UpdateTerminalLifecycleResult>') &&
  http.includes('/lifecycle') &&
  mock.includes('TERMINAL_LIFECYCLE_TRANSITION_INVALID') &&
  mock.includes('TERMINAL_MAINTENANCE_REQUIRED') &&
  mock.includes('normalizedReason.length < 8') &&
  lifecycleActions.includes("status === 'suspended'") &&
  lifecycleActions.includes("'retired'") &&
  lifecycleActions.includes('`吊销 ${terminal.terminalCode}`') &&
  lifecycleActions.includes('不可逆操作') &&
  lifecycleActions.includes('error.status === 409') &&
  lifecycleActions.includes('expectedCredentialGeneration: terminal.credentialGeneration') &&
  devices.includes('emergencyRevokeTerminal') &&
  http.includes('/emergency-revoke') &&
  mock.includes('TERMINAL_REVOKE_CONFIRMATION_INVALID') &&
  mock.includes('MOCK_TERMINAL_CREDENTIAL_STATE') &&
  mock.includes('active: false')
) {
  pass('现有终端表接入完整运维动作、紧急吊销强确认与 409 刷新，换机绑定码仅限 planned/maintenance')
} else {
  fail('terminal lifecycle actions and bind-code maintenance gate must stay wired through the existing terminals page')
}

console.log('\nALL PASS')
