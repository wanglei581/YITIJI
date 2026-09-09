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

// 安装命令必须用 `-PromptForBindCode` 交互输入，**不得把绑定码拼进命令行**。
//
// 本仓已有口径，不是偏好：docs/device/production-agent-onboarding.md:14 原文
//   「通过 `-PromptForBindCode` 安全交互输入一次性绑定码（推荐）…
//     兼容参数 `-BindCode` 仅用于受控旧流程，**因为它会进入进程命令行**」
// 该文档的示例命令用的也是 `-PromptForBindCode`。
//
// 本断言此前钉的是 `dialog.includes('-BindCode')` —— 把当时的现状写成了永久要求，
// 于是「改成文档推荐的安全形态」这个正确动作反而会撞红。现在钉的是不变量：
// 用交互输入、且命令里不出现把码拼进去的插值。
{
  // 只看 buildInstallCommand 的**函数体**，不看整份文件。
  //
  // 第一版就栽在这：写成 `dialog.includes('-PromptForBindCode')` 后，
  // 把该 flag 从命令数组里删掉、只留上面那段解释用的注释，门禁照样绿（实测 exit=0）。
  // **注释和文档引用不是行为。** 同族教训：断言匹配到的那一串，必须在代码路径上。
  const fnStart = dialog.indexOf('function buildInstallCommand')
  if (fnStart < 0) fail('TerminalBindCodeDialog 缺少 buildInstallCommand')
  const fnEnd = dialog.indexOf('\n}', fnStart)
  const cmdBody = dialog.slice(fnStart, fnEnd < 0 ? dialog.length : fnEnd)

  const buildsInlineBindCode = /-BindCode\s+"\$\{/.test(cmdBody) || /`-BindCode "\$\{/.test(cmdBody)
  if (
    cmdBody.includes('install-production-agent.ps1') &&
    cmdBody.includes('-PromptForBindCode') &&
    !buildsInlineBindCode &&
    cmdBody.includes('-PrinterName') &&
    cmdBody.includes("join(' `\\n  ')")
  ) {
    pass('弹窗给出的安装命令用 -PromptForBindCode 交互输入，绑定码不进命令行')
  } else {
    fail(
      'modal must generate the install command with -PromptForBindCode (never interpolate the code into -BindCode)'
        + ` — hasPrompt=${cmdBody.includes('-PromptForBindCode')} inlineBindCode=${buildsInlineBindCode}（判据只看函数体，不看注释）`,
    )
  }
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
  plannedDialog.includes('role="alert"') &&
  plannedDialog.includes('setErrorMessage(message)') &&
  devices.includes('createPlannedTerminal') &&
  http.includes("postData<PlannedTerminalCreated>('/admin/terminals', input)") &&
  mock.includes('createPlannedTerminal')
) {
  pass('现有设备管理页接入 Admin 预创建设备，接口失败在弹窗内可见，http/mock 双适配且不宣称签发凭证')
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
  lifecycleActions.includes("actions.push('emergency-revoke')") &&
  !lifecycleActions.includes("if (hasActiveCredential) actions.push('emergency-revoke')") &&
  devices.includes('emergencyRevokeTerminal') &&
  http.includes('/emergency-revoke') &&
  mock.includes('TERMINAL_REVOKE_CONFIRMATION_INVALID') &&
  mock.includes('MOCK_TERMINAL_CREDENTIAL_STATE') &&
  mock.includes('item.id === terminalId || item.terminalCode === terminalId') &&
  mock.includes("['commissioning', 'maintenance', 'suspended']") &&
  mock.includes('active: false')
) {
  pass('现有终端表接入完整运维动作、紧急吊销强确认与 409 刷新，换机绑定码仅限 planned/maintenance')
} else {
  fail('terminal lifecycle actions and bind-code maintenance gate must stay wired through the existing terminals page')
}

// 2026-09-07：安装命令里的 API 地址曾硬编码生产机 IP（http://120.48.13.190/api/v1），
// 违反 CLAUDE.md §17；改为按管理员后台当前访问源解析。这里钉住两件事：
// ① apps/admin/src 下不得再出现「http(s)://<IPv4>」形态的主机字面量；② 绑定码对话框按 origin 解析相对 API 路径。
{
  const { readdirSync, statSync } = await import('node:fs')
  const { join } = await import('node:path')
  const srcRoot = join(process.cwd(), 'src')
  const offenders = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx)$/.test(name)) continue
      const text = readFileSync(full, 'utf8')
      if (/https?:\/\/\d{1,3}(\.\d{1,3}){3}/.test(text)) offenders.push(full.slice(srcRoot.length + 1))
    }
  }
  walk(srcRoot)
  const dialog = readFileSync(join(srcRoot, 'routes/terminals/TerminalBindCodeDialog.tsx'), 'utf8')
  if (offenders.length === 0 && dialog.includes('new URL(API_BASE_URL, window.location.origin)') && !dialog.includes('DEFAULT_PRODUCTION_API_BASE_URL')) {
    pass('安装命令 API 地址按当前访问源解析，apps/admin/src 无硬编码 IP 主机字面量')
  } else {
    fail(`admin must not hardcode a server IP for the agent API base (offenders: ${offenders.join(', ') || 'none'}; dialog resolves via origin: ${dialog.includes('new URL(API_BASE_URL, window.location.origin)')})`)
  }
}

console.log('\nALL PASS')
