import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function verifyPrivacyCopy({ runFile, textOf, shared, ui, hooks, common, adminRoot, repoRoot, fail, failures, actions, labels }) {
console.log('\n=== 第四批实际渲染：审计与账号隐私 ===')
const auditLabels = labels
const { getAuditActionLabel } = labels
const orderHonesty = runFile('apps/admin/src/routes/orders/orderHonestyCopy.ts', { '@ai-job-print/shared': shared })
const orderDisplay = runFile('apps/admin/src/routes/orders/orderDisplay.ts', { '@ai-job-print/shared': shared, './orderHonestyCopy': orderHonesty })
const partnerTypes = runFile('packages/shared/src/types/partner.ts')
const adminTypes = runFile('packages/shared/src/types/admin.ts')
const auditPresentation = runFile('apps/admin/src/routes/audit/auditPresentation.ts', {
  './auditPayloadLabels': runFile('apps/admin/src/routes/audit/auditPayloadLabels.ts', {
    '@ai-job-print/shared': { ...shared, ...partnerTypes, ...adminTypes },
  }),
  '../../lib/auditActionLabels': auditLabels,
  '../users/userPresentation': runFile('apps/admin/src/routes/users/userPresentation.ts'),
  '../screen/metricLabels': runFile('apps/admin/src/routes/screen/metricLabels.ts', { '@ai-job-print/shared': shared, '@ai-job-print/ui': ui }),
  '../orders/orderDisplay': orderDisplay,
})
const auditTable = runFile('apps/admin/src/routes/audit/auditColumns.tsx', {
  '@ai-job-print/shared': shared, '@ai-job-print/ui': ui,
  '../../lib/auditActionLabels': auditLabels, './auditPresentation': auditPresentation,
})
const auditDrawer = runFile('apps/admin/src/routes/audit/AuditDetailDrawer.tsx', {
  '@ai-job-print/shared': shared, '@ai-job-print/ui': ui,
  '../../lib/auditActionLabels': auditLabels, './auditPresentation': auditPresentation,
})
const auditRecord = { id: 'log_fixture_123456', actorId: 'cmumb2kp40000m7yb1l6p0ssy', actorRole: 'admin', action: 'admin.user.detail.view', targetType: 'EndUser', targetId: 'cmu_fixture_654321', ipAddress: '::ffff:127.0.0.1', createdAt: '2026-09-30T04:00:00Z', requestId: 'request-long-value', userAgent: 'browser-test', payloadJson: '{}' }
const columns4 = auditTable.auditColumns(() => {})
if (columns4.map((c) => c.id).join(',') !== 'time,actor,role,action,target,ip') fail('审计列表须为六列，长字段进详情')
const auditExtraActions = ['admin.user.detail.view', 'job_ai_session.cleanup_expired', 'ai_resume_result.cleanup_expired', 'print_job.create', 'order.mark_paid', 'resume.diagnosis_exported']
for (const action of [...actions, ...auditExtraActions]) {
  const visible = textOf(columns4.map((c) => c.cell({ ...auditRecord, action })))
  if (!visible.includes(getAuditActionLabel(action)) || visible.includes(action)) fail(`审计列表显示原始动作码 ${action}`)
  if (!visible.includes('管理员 · 尾号 6p0ssy') || visible.includes(auditRecord.actorId)) fail('审计列表应显示角色和尾号，完整 actorId 只在悬停')
  if (visible.includes('::ffff:') || !visible.includes('127.0.0.1')) fail('审计 IP 展示应去 IPv4 映射前缀')
  if (visible.includes('EndUser') || visible.includes(auditRecord.targetId) || !visible.includes('用户 · 尾号 654321')) fail('审计对象应显示中文和尾号')
}
for (const [role, label] of [['system', '系统'], ['system-cli', '系统'], ['enduser', '用户'], ['partner', '合作机构']]) {
  const visible = auditPresentation.auditActorText({ ...auditRecord, actorRole: role })
  if (!visible.startsWith(label) || (label === '系统' && visible !== '系统')) fail(`操作人角色 ${role} 未中文化`)
}
// 真实抽屉：编号优先，只有内部 ID 时显示尾号，完整原值仅保留悬停。
for (const numbered of [true, false]) {
  const internalId = 'terminal-private-123456'
  const payloadJson = JSON.stringify({ terminalId: internalId, ...(numbered ? { terminalCode: 'WALK-003' } : {}), billablePages: 12, terminalIds: [internalId], ...(numbered ? { terminalCodes: ['WALK-003'] } : {}) })
  const record = { ...auditRecord, targetType: 'terminal', targetId: internalId, payloadJson }
  const tree = auditDrawer.AuditDetailDrawer({ record, onClose: () => {} })
  const visible = textOf(tree)
  const expected = numbered ? 'WALK-003' : '终端（尾号 123456）'
  if (!visible.includes(expected) || visible.includes(internalId) || !visible.includes('计费页数') || !visible.includes('终端编号')) fail('审计终端编号、尾号与字段标签未按真实 payload 显示')
  if (!findTree(tree, (node) => node.props?.title === internalId)) fail('审计完整终端 ID 应保留在悬停')
  if (auditPresentation.auditTargetText(record) !== expected) fail('审计目标对象应使用同样终端编号规则')
}
const sensitiveKeys = ['phone', 'contactPhone', 'mobile', 'telephone', 'email', 'password', 'passwd', 'pwd', 'access_token', 'refreshToken', 'apiKey', 'secret', 'private_key', 'credential', 'authorization', 'cookie', '手机号', '邮箱', '密码', '令牌', '密钥']
for (const key of sensitiveKeys) {
  const payloadJson = JSON.stringify({ reason: '测试原因', nested: [{ [key]: 'sensitive-value' }], unknown_key: 7, second_unknown: '第二个字段' })
  const visible = textOf(auditDrawer.AuditDetailDrawer({ record: { ...auditRecord, payloadJson }, onClose: () => {} }))
  if (!visible.includes('已隐藏') || visible.includes('sensitive-value')) fail(`抽屉敏感键 ${key} 必须显示已隐藏`)
  if (!visible.includes('原因') || !visible.includes('测试原因') || !visible.includes('未登记字段') || !visible.includes('unknown_key') || !visible.includes('second_unknown') || !visible.includes('第二个字段') || !visible.includes('7')) fail('详情应翻译已知键并保留未知键和值')
  if (!visible.includes('request-long-value') || !visible.includes('browser-test')) fail('请求 ID 与浏览器标识必须在详情显示')
}
// r2：执行真实函数及抽屉，覆盖宽匹配误伤、嵌套字符串、签名与失败关闭。
for (const key of ['token', 'authToken', 'apiKey', 'APIKey', 'secret_key', 'accessKey', 'privateKey', 'sign_key', 'encryptionKey', 'signature', 'sign', 'x-amz-signature', 'x-oss-signature', 'q-signature', 'tel', 'mail', '联系电话']) {
  if (!auditPresentation.isSensitiveAuditKey(key) || auditPresentation.sanitizeAuditValue('private-value', key) !== '已隐藏') fail(`敏感整词应隐藏：${key}`)
}
for (const key of ['unknown_key', 'cacheKey', 'hotel', 'mailbox', 'key', 'monkey', 'tokenizer']) {
  if (auditPresentation.isSensitiveAuditKey(key) || auditPresentation.sanitizeAuditValue('public-value', key) !== 'public-value') fail(`非敏感键应保留原值：${key}`)
}
for (const value of ['token=opaque', 'password:opaque', 'prefix "pwd":"opaque"', 'https://example.com/a?Signature=opaque', 'https://example.com/a?X-Amz-Signature=opaque', 'https://example.com/a?X-OSS-Signature=opaque', 'https://example.com/a?Q-Signature=opaque', 'https://example.com/a?sign=opaque', '+86 139 1234 5678', '139-1234-5678', '13912345678', 'test@example.com', 'Bearer opaque']) {
  if (auditPresentation.safeAuditText(value) !== '已隐藏') fail(`敏感文本或整段签名 URL 应隐藏：${value}`)
}
for (const value of ['hotel:青岛', 'mailbox=已登记', 'cacheKey:public', 'https://example.com/a?unknown_key=public', '普通说明']) {
  if (auditPresentation.safeAuditText(value) !== value) fail(`非敏感文本应保留：${value}`)
}
for (const value of ['{"password":"embedded-secret","cacheKey":"可见"}', '[{"apiKey":"embedded-secret","hotel":"可见"}]', '{"nested":"{\\"token\\":\\"embedded-secret\\"}"}']) {
  const safe = auditPresentation.safeAuditText(value)
  if (!safe.includes('已隐藏') || safe.includes('embedded-secret') || safe.includes('详情无法解析')) fail('字符串 JSON 必须递归脱敏且可解析')
}
for (const payloadJson of ['bad-json', '{"password":"secret-raw"', '{"unknown":"bad-json-secret"', '["unrecognized-private-value"']) {
  const parsed = auditPresentation.parseAuditPayload(payloadJson)
  const visible = textOf(auditDrawer.AuditDetailDrawer({ record: { ...auditRecord, payloadJson }, onClose: () => {} }))
  if (!parsed.invalid || parsed.length !== payloadJson.length || 'raw' in parsed || JSON.stringify(parsed).includes(payloadJson)) fail('坏 JSON 的解析结果不得携带原文')
  if (!visible.includes(`详情无法解析（原始记录约 ${payloadJson.length} 个字符，需要时请联系技术人员从服务器查看）`) || /查看原文|敏感内容已隐藏/.test(visible) || visible.includes(payloadJson)) fail('坏 JSON 只展示长度及服务器查阅说明，不出原文')
  if (auditPresentation.safeAuditText('{'+payloadJson).includes(payloadJson)) fail('嵌入字符串的坏 JSON 也不回显')
}
const translated = textOf(auditDrawer.AuditDetailDrawer({ record: { ...auditRecord, payloadJson: JSON.stringify({ sections: ['summary', 'stats', 'recent_activity', 'unknown_section'], fromStatus: 'active', toStatus: 'disabled', status: 'printing', result: 'unknown_result' }) }, onClose: () => {} }))
for (const word of ['概要', '统计', '最近动态', 'unknown_section', '正常', '已停用', '打印中', 'unknown_result']) if (!translated.includes(word)) fail(`详情中文与未知值回落缺少 ${word}`)
for (const key of ['sections', 'fromStatus', 'toStatus', 'status', 'result']) for (const value of ['constructor', '__proto__', 'toString']) if (auditPresentation.sanitizeAuditValue(value, key) !== value) fail('未知范围/状态值不得命中对象原型')
if (translated.includes('浏览器标识（User-Agent）')) fail('浏览器标识标签不能显示英文协议词')
const auditPage = readFileSync(join(adminRoot, 'src/routes/audit/index.tsx'), 'utf8')
if (!auditPage.includes('getAuditActionLabel(value)') || !auditPage.includes('auditColumns(setSelected)') || !auditPage.includes('record={selected}')) fail('审计页必须挂接中文筛选、可打开的列定义和详情抽屉')
if (!auditPage.includes('lang="zh-CN"') || !auditPage.includes('年/月/日 时:分') || !auditPage.includes('d.toISOString()')) fail('审计日期筛选需中文区域与格式提示，保持 ISO 查询')
// 真实页面的捕获事件覆盖单元格按钮，选中后阻止冒泡；清除选区正常放行。
let selectionText = ''
const browserGlobals = { window: { getSelection: () => ({ toString: () => selectionText }) } }
const auditPageModule = runFile('apps/admin/src/routes/audit/index.tsx', {
  ...common, react: hooks([null, '', '', '', [auditRecord], 1, false, false]),
  '../components/DataTable': { useTableState: () => ({ page: 1, pageSize: 20 }) },
  '../../services/api/audit': {}, './auditColumns': auditTable, './AuditDetailDrawer': auditDrawer,
  '../../lib/auditActionLabels': auditLabels, '../../services/api/client': { API_MODE: 'http' },
}, '', browserGlobals)
function findTree(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) return node.map((item) => findTree(item, predicate)).find(Boolean) ?? null
  return predicate(node) ? node : findTree(node.props?.children, predicate)
}
const privacyStates = ['', '', undefined, [], [], null, 'ready', null, null, false, null]
const privacyPageModule = runFile('apps/admin/src/routes/privacy-requests/index.tsx', {
  ...common, react: hooks(privacyStates), '../../services/api/adminPrivacyRequests': {},
}, '', browserGlobals)
const privacyEmptyTree = privacyPageModule.default()
const privacyPopulatedModule = runFile('apps/admin/src/routes/privacy-requests/index.tsx', {
  ...common, react: hooks(['', '', undefined, [], [{ id: 'ticket', status: 'pending', requestType: 'export', phoneMasked: '138****5678' }], null, 'ready', null, null, false, null]),
  '../../services/api/adminPrivacyRequests': {},
}, '', browserGlobals)
if (!textOf(privacyPopulatedModule.default()).replace(/\s+/g, '').includes('当前页1条')) fail('隐私请求有数据时保留原游标栏')
if (textOf(privacyEmptyTree).includes('当前页')) fail('隐私请求空列表不得显示游标栏')
for (const tree of [auditPageModule.default(), privacyEmptyTree]) {
  const wrapper = findTree(tree, (node) => typeof node.props?.onClickCapture === 'function')
  if (!wrapper) { fail('审计及隐私表格须捕获点击，保护选中的文字'); continue }
  for (const selected of ['', '所选文字']) {
    selectionText = selected
    let prevented = false, stopped = false
    wrapper.props.onClickCapture({ preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true } })
    if (prevented !== Boolean(selected) || stopped !== Boolean(selected)) fail('选中文字阻止按钮/行点击，未选中时正常放行')
  }
}
const partnerConsts = runFile('packages/shared/src/types/partner.ts')
const restrictions = runFile('apps/partner/src/routes/profile/ComplianceRestrictions.tsx', { '@ai-job-print/shared': partnerConsts })
const restrictionText = textOf(restrictions.ComplianceRestrictions())
for (const code of partnerConsts.PROHIBITED_MODULES) if (restrictionText.includes(code)) fail(`合规限制可见文字不得出现 ${code}`)
for (const label of ['禁止在平台内投递', '禁止管理候选人', '禁止向企业推送简历', '禁止向求职者发出企业面试邀约', '禁止管理企业录用通知']) if (!restrictionText.includes(label)) fail(`合规限制缺中文说明 ${label}`)
if (!readFileSync(join(repoRoot, 'apps/partner/src/routes/profile/index.tsx'), 'utf8').includes('<ComplianceRestrictions />')) fail('机构资料必须渲染中文合规限制')
const account = runFile('apps/partner/src/routes/account/index.tsx', {
  react: hooks(['', '', '', null, false, false]), '@ai-job-print/ui': { ...ui, Button: ({ children }) => children },
  'lucide-react': { LockKeyholeIcon: () => null, UserCogIcon: () => null },
  '../Page': { Page: ({ children }) => children, FRONTEND_HINT: { none: '' }, withFrontendHint: (value) => value },
  '../../services/auth': {},
})
const accountText = textOf(account.default())
if (/RBAC|UTF-8|字节/.test(accountText) || !accountText.includes('最长约 24 个汉字或 72 个英文字符') || !accountText.includes('如需增删机构账号或调整权限，请联系平台运营。')) fail('机构账号页密码长度与权限说明必须使用通俗文案')
const accountSource = readFileSync(join(repoRoot, 'apps/partner/src/routes/account/index.tsx'), 'utf8')
for (const phrase of ['utf8ByteLength(newPassword) > 72', 'unicodeCharacterLength(newPassword) < 12', 'passwordCategoryCount(newPassword) < 3']) if (!accountSource.includes(phrase)) fail(`机构密码校验不可更改 ${phrase}`)
const orgView = runFile('apps/admin/src/routes/partners/orgPresentation.ts', { '@ai-job-print/shared': partnerConsts })
for (const key of ['job_info', 'job_fair', 'external_apply_redirect']) {
  if (!orgView.moduleLabel(key, false).includes('暂不开放') || orgView.moduleLabel(key, true).includes('暂不开放')) fail('招聘模块标签应随托管闸门标暂不开放，仅改显示')
}
const partnerPhoneView = runFile('apps/partner/src/routes/profile/index.tsx', {
  react: hooks([]), '@ai-job-print/shared': partnerConsts, '@ai-job-print/ui': ui,
  './ComplianceRestrictions': restrictions, '../Page': {}, 'lucide-react': {},
  '../../services/api/orgSelf': {}, './OfficialChannelsSection': {}, '../../services/capabilities': {},
}, '\nexport { contactPhoneText }\n')
for (const view of [orgView, partnerPhoneView]) {
  for (const [phone, expected] of [[null, '—'], ['', '—'], ['  ', '—'], ['123456', '已登记'], ['未知', '已登记'], ['1234567', '123**67'], ['13812345678', '138****5678'], ['138 1234 5678', '138****5678'], ['138-1234-5678', '138****5678'], ['+86 138-1234-5678', '861********78'], ['010-88888888', '010******88'], ['010-88888888 转 123', '010*********23'], ['138****5678', '138****5678']]) {
    if (view.contactPhoneText(phone) !== expected) fail(`电话格式 ${phone} 应显示 ${expected}`)
  }
}
if (!readFileSync(join(repoRoot, 'apps/partner/src/routes/profile/index.tsx'), 'utf8').includes('value={contactPhoneText(profile.contactPhone)}')) fail('机构资料展示必须调用统一电话规则')
if (orgView.contactPhoneText('13812345678') !== '138****5678' || orgView.contactPhoneText('138****5678') !== '138****5678') fail('机构联系人手机不能显示明文，也不能破坏已有掩码')
const trustCell = runFile('apps/admin/src/routes/partners/ContentTrustCell.tsx', { '@ai-job-print/ui': ui, './contentTrustRules': runFile('apps/admin/src/routes/partners/contentTrustRules.ts') })
const orgParts = runFile('apps/admin/src/routes/partners/orgFormParts.tsx', { react: hooks([]), '@ai-job-print/shared': partnerConsts, './orgPresentation': orgView })
const orgTable = runFile('apps/admin/src/routes/partners/PartnerTable.tsx', {
  './ContentTrustCell': trustCell, '@ai-job-print/shared': { ...partnerConsts, ...shared, formatDate: () => '2026-09-30' },
  '@ai-job-print/ui': ui, './orgPresentation': orgView, './orgFormParts': orgParts,
})
const orgColumns = orgTable.PartnerTable({ items: [], showRecruitment: false }).props.columns
const confirmButton = orgColumns.find((c) => c.id === 'actions').cell({ id: 'org-stable-identity', enabled: true }).props.children[1]
if (confirmButton.key !== 'org-stable-identity') fail('机构两步确认必须以机构 id 为 key，筛选后不能继承另一家机构的确认态')
if (!failures.length) console.log('  PASS 审计六列、动作中文、ID 尾号、IP、递归脱敏、坏 JSON、账号说明与合规限制')

}
