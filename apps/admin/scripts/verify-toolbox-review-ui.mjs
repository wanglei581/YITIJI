import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(process.cwd(), '../..')
const adminRoot = process.cwd()
const apiRoot = join(repoRoot, 'services/api')

let failed = 0

function pass(message) {
  console.log(`PASS ${message}`)
}

function fail(message) {
  failed += 1
  console.error(`FAIL ${message}`)
}

function readFrom(root, rel) {
  const full = join(root, rel)
  if (!existsSync(full)) {
    fail(`missing ${rel}`)
    return ''
  }
  return readFileSync(full, 'utf8')
}

function mustContain(root, rel, tokens, message) {
  const text = readFrom(root, rel)
  const missing = tokens.filter((token) => !text.includes(token))
  if (missing.length) fail(`${message}; missing=${missing.join(' | ')}`)
  else pass(message)
}

function mustNotContain(root, rel, tokens, message) {
  const text = readFrom(root, rel)
  const found = tokens.filter((token) => text.includes(token))
  if (found.length) fail(`${message}; found=${found.join(' | ')}`)
  else pass(message)
}

function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) collectFiles(full, out)
    else if (/\.(tsx?|mjs)$/.test(name)) out.push(full)
  }
  return out
}

function mustFileUnderLines(root, rel, maxLines) {
  const text = readFrom(root, rel)
  const lines = text ? text.split('\n').length : 0
  if (lines > maxLines) fail(`${rel} 行数 ${lines} 超过 ${maxLines}`)
  else pass(`${rel} 行数 ${lines}/${maxLines}`)
}

const blockedReasons = [
  'app_not_approved',
  'app_suspended',
  'app_archived',
  'self_review',
  'host_required',
  'host_not_allowed',
  'host_not_active',
  'host_expired',
  'host_suspended',
  'host_local_or_private',
  'content_blocked',
  'missing_disclaimer',
  'forbidden_capability',
  'external_url_disabled',
  'invalid_target_url',
]

console.log('\n=== Admin 百宝箱审核发布 UI 门禁 ===')

mustContain(adminRoot, 'package.json', ['"verify:toolbox-review-ui"'], 'Admin package 注册百宝箱审核发布 UI 门禁')

mustContain(apiRoot, 'src/terminals/admin-toolbox.controller.ts', [
  '@Get(\'admin/toolbox/apps\')',
  '@Get(\'admin/toolbox/apps/:appKey/versions\')',
  '@Get(\'admin/toolbox/allowed-hosts\')',
], '后端 Admin 控制器提供审核台只读列表接口')
mustContain(apiRoot, 'src/terminals/toolbox-governance.service.ts', [
  'listApps',
  'listVersions',
  'listAllowedHostsForAdmin',
  'snapshot: parseSnapshot',
  'rejectionReason',
], '后端治理 service 返回应用、版本和允许域名视图')
mustNotContain(apiRoot, 'src/terminals/toolbox-governance.service.ts', ['take: 500'], '治理列表接口不得静默截断')

mustContain(adminRoot, 'src/services/api/client.ts', [
  'class ApiHttpError',
  'reason?: string',
], 'Admin API 通用错误类型支持发布门禁 reason')
mustContain(adminRoot, 'src/services/api/toolbox.ts', [
  'listApps',
  'listVersions',
  'listAllowedHosts',
  'createApp',
  'createVersion',
  'submitVersion',
  'approveVersion',
  'rejectVersion',
  'publishVersion',
  'suspendApp',
  'upsertAllowedHost',
  'reviewAllowedHost',
  '/admin/toolbox/apps',
  '/admin/toolbox/allowed-hosts',
  'API_MODE === \'http\' ? httpAdapter : mockAdapter',
], 'Admin toolbox service 覆盖审核发布 API、reason 透出和 mock/http 切换')

mustContain(adminRoot, 'src/routes/toolbox/index.tsx', [
  'ToolboxGovernancePanel',
  'TerminalToolboxPanel',
  'activeTab',
  '微应用审核发布',
  '终端投放配置',
], 'Toolbox 页面拆成审核发布与终端投放两个分段')
for (const rel of [
  'src/routes/toolbox/constants.ts',
  'src/routes/toolbox/components/ToolboxLaunchSummaryCard.tsx',
  'src/routes/toolbox/components/TerminalToolboxPanel.tsx',
  'src/routes/toolbox/components/TerminalToolboxRow.tsx',
  'src/routes/toolbox/components/ToolboxGovernancePanel.tsx',
  'src/routes/toolbox/components/ToolboxAllowedHostPanel.tsx',
]) {
  if (existsSync(join(adminRoot, rel))) pass(`${rel} 存在`)
  else fail(`${rel} 缺失`)
}

mustContain(adminRoot, 'src/routes/toolbox/constants.ts', blockedReasons, 'blocked reason 中文映射覆盖全部发布门禁原因')
mustContain(adminRoot, 'src/routes/toolbox/components/ToolboxGovernancePanel.tsx', [
  '不执行第三方代码',
  '不桥接第三方设备',
  '免责声明',
  'BLOCK_REASON_LABELS',
  'publishVersion',
  'shortDescription: versionForm.shortDescription',
  'requiresHostAllowlist: false',
], '审核发布面板展示安全边界、免责声明和发布 blocked reason')
mustContain(adminRoot, 'src/routes/toolbox/components/ToolboxGovernancePanel.tsx', [
  'qrImageUrl: versionForm.qrImageUrl',
  'qrTargetUrl: versionForm.qrTargetUrl',
  '二维码图片地址，用于终端展示二维码图片',
  '扫码目标地址，用于合规审计和运营声明',
], '审核发布面板分离二维码图片地址与扫码目标地址')
mustNotContain(adminRoot, 'src/routes/toolbox/components/ToolboxGovernancePanel.tsx', [
  'qrImageUrl: target, qrTargetUrl: target',
  '二维码图片或 assistant intent',
], '审核发布面板不得把二维码图片和扫码目标共用同一输入')
mustContain(adminRoot, 'src/routes/toolbox/components/ToolboxAllowedHostPanel.tsx', [
  'DB 审核表',
  '环境白名单',
  'TOOLBOX_ALLOW_EXTERNAL_URL',
  'KIOSK_EXTERNAL_APP_ALLOWED_HOSTS',
  'KIOSK_QR_TARGET_ALLOWED_HOSTS',
], '允许域名面板展示 DB 与环境变量双白名单口径')
mustContain(adminRoot, 'src/routes/toolbox/components/TerminalToolboxRow.tsx', [
  'isGovernedItem',
  'app:',
  '治理发布',
  'disabled={isGovernedItem',
], '终端配置对治理投影 app:* 项做只读保护')
mustContain(adminRoot, 'src/routes/toolbox/components/TerminalToolboxRow.tsx', [
  'item.qrTargetUrl ?? \'\'',
  'patchItem(index, { qrTargetUrl: value })',
  '扫码目标地址',
  '图片地址和扫码目标分离保存',
], '终端手工配置保留二维码扫码目标地址编辑入口')
mustContain(apiRoot, 'src/terminals/terminal-toolbox.service.ts', [
  'mergeGovernedProjectionItems',
  'item.key.startsWith(\'app:\')',
], '后端保存终端配置时保留治理投影 app:* 项')

const toolboxFiles = collectFiles(join(adminRoot, 'src/routes/toolbox'))
const joinedToolbox = toolboxFiles.map((file) => readFileSync(file, 'utf8')).join('\n')
const dangerousTokens = [
  'eval(',
  'new Function(',
  'dangerouslySetInnerHTML',
  'third_party_code_execution',
  'third_party_device_bridge',
  '一键投递',
  '立即投递',
  '平台投递',
  '候选人筛选',
  '面试邀约',
  'Offer 管理',
]
const dangerousFound = dangerousTokens.filter((token) => joinedToolbox.includes(token))
if (dangerousFound.length) fail(`百宝箱 Admin UI 不得出现危险执行或招聘闭环文案: ${dangerousFound.join(' | ')}`)
else pass('百宝箱 Admin UI 不出现危险执行或招聘闭环文案')

for (const rel of [
  'src/routes/toolbox/index.tsx',
  'src/routes/toolbox/components/ToolboxGovernancePanel.tsx',
  'src/routes/toolbox/components/ToolboxAllowedHostPanel.tsx',
  'src/routes/toolbox/components/TerminalToolboxRow.tsx',
]) {
  mustFileUnderLines(adminRoot, rel, 360)
}

if (failed > 0) {
  console.error(`\nverify-toolbox-review-ui failed: ${failed}`)
  process.exit(1)
}

console.log('\nverify-toolbox-review-ui passed')
