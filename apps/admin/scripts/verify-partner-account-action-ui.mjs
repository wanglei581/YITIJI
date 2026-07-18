import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function read(relativePath) {
  const path = resolve(root, relativePath)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function expect(condition, message) {
  if (!condition) failures.push(message)
}

function expectContains(source, fragment, message) {
  expect(source.includes(fragment), message)
}

const api = read('src/services/api/orgsAdmin.ts')
const auth = read('src/services/auth/index.ts')
const manager = read('src/routes/partners/PartnerAccountManager.tsx')
const hook = read('src/routes/partners/usePartnerAccountAction.ts')
const dialog = read('src/routes/partners/PartnerAccountActionDialog.tsx')
const stepsDir = resolve(root, 'src/routes/partners/partner-account-action-steps')
const steps = existsSync(stepsDir)
  ? readdirSync(stepsDir)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => read(`src/routes/partners/partner-account-action-steps/${name}`))
      .join('\n')
  : ''
const credentialSteps = read('src/routes/partners/partner-account-action-steps/ActionCredentialSteps.tsx')
const rebindSteps = read('src/routes/partners/partner-account-action-steps/PhoneRebindSteps.tsx')
const uiSources = `${manager}\n${hook}\n${dialog}\n${steps}`

console.log('\n=== Partner account verified action UI verification ===')

expectContains(api, 'availableActionVerificationMethods', '账号 DTO 必须只暴露可用验证方式')
expectContains(api, "'X-Account-Action-Ticket'", 'action ticket 必须通过 X-Account-Action-Ticket header')
expectContains(api, "'X-Phone-Rebind-Ticket'", 'rebind ticket 必须通过 X-Phone-Rebind-Ticket header')
expect(!api.includes('actionTicket='), 'action ticket 不得进入 URL')
expect(!api.includes('rebindTicket='), 'rebind ticket 不得进入 URL')

expectContains(hook, 'reducePartnerAccountAction', '副作用 hook 必须复用纯状态机')
expectContains(hook, 'AbortController', '请求必须支持 AbortController 取消')
expectContains(hook, 'operationIdRef', '迟到响应必须按 operationId 隔离')
expectContains(hook, 'revokeActionTicket', '迟到 action ticket 必须静默撤销')
expectContains(hook, 'revokePhoneRebindTicket', '迟到 rebind ticket 必须静默撤销')
expectContains(hook, 'Date.now()', '倒计时必须基于绝对截止时间')
expectContains(hook, 'resendNewPhoneCode', '新手机号验证码必须支持冷却后重发')
expectContains(hook, 'onChanged', '成功和收敛路径必须刷新机构详情')

expectContains(dialog, 'role="dialog"', '长流程必须使用稳定的 dialog shell')
expectContains(dialog, 'aria-busy={state.busy}', 'dialog 必须向辅助技术暴露忙碌状态')
expectContains(dialog, "event.key === 'Tab'", 'dialog 必须约束 Tab / Shift+Tab 焦点')
expectContains(dialog, "event.key === 'Escape'", 'dialog 必须处理 Escape')
expectContains(dialog, 'triggerElementRef', '关闭后必须恢复触发点焦点')
expectContains(dialog, 'open, state.step', '步骤切换时必须把焦点移动到新步骤的自动聚焦元素')
expectContains(hook, 'shouldExpirePartnerAccountResource(snapshot', '请求忙碌期间不得因客户端倒计时中止并卡死状态机')
expectContains(hook, 'if (operationId !== operationIdRef.current) return', '异步撤销后必须复核 operationId，防止快速切换方式串线')
expectContains(hook, "snapshot.step !== 'new_phone_sms_verify'", '新手机号验证副作用必须校验精确步骤')
expectContains(credentialSteps, "data-autofocus={methods.includes('sms') ? '' : undefined}", '短信可用时才允许短信按钮成为自动聚焦目标')
expectContains(credentialSteps, "data-autofocus={!methods.includes('sms') && methods.includes('password') ? '' : undefined}", '短信不可用时必须回退聚焦到可用的密码验证按钮')
expectContains(steps, 'role="alertdialog"', '最终删除确认必须独立挂载 alertdialog')
expectContains(steps, 'aria-busy={busy}', '最终删除确认提交中必须暴露忙碌状态')
expectContains(steps, 'tabIndex={-1}', '最终删除确认无可用按钮时必须由 alertdialog 容器承接焦点')
expectContains(steps, '删除后不可直接恢复', '最终删除确认必须复述不可恢复后果')
expectContains(steps, 'account.name', '最终删除确认必须复述机构账号姓名')
expectContains(steps, 'account.username', '最终删除确认必须复述账号名')
expectContains(steps, 'autoComplete="one-time-code"', 'OTP 输入必须支持 one-time-code')
expectContains(steps, 'inputMode="numeric"', 'OTP 输入必须使用数字键盘')
expectContains(steps, '剩余', '票据或验证码必须展示剩余时间')
expectContains(steps, '重新发送', '验证码必须提供重发入口')
expectContains(credentialSteps, 'lastAutoSubmittedCodeRef', '原手机号验证码必须防止同一 code 重复自动提交')
expectContains(rebindSteps, 'lastAutoSubmittedCodeRef', '新手机号验证码必须防止同一 code 重复自动提交')
expect(credentialSteps.includes('code.length === 6') || credentialSteps.includes('code.length !== 6'), '原手机号验证码输入满 6 位必须自动提交')
expect(rebindSteps.includes('code.length === 6') || rebindSteps.includes('code.length !== 6'), '新手机号验证码输入满 6 位必须自动提交')
expectContains(steps, '管理员本人密码', '必须明确区分管理员本人密码')
expectContains(credentialSteps, 'adminPassword.length === 0', '管理员当前密码必须兼容既有短密码')
expectContains(steps, '目标机构账号当前密码', '必须明确区分目标账号密码')

expectContains(manager, 'availableActionVerificationMethods.length === 0', '空方法账号必须禁用安全操作')
expectContains(manager, '独立线下核验', '空方法账号必须说明线下核验且无管理员绕过')
expectContains(manager, '换绑手机号', '现有账号列表必须提供换绑入口')
expectContains(manager, '删除账号', '账号行危险按钮必须明确写删除账号')
expectContains(steps, '确认删除账号', '最终危险按钮必须明确写确认删除账号')
expectContains(manager, '重置密码', '必须保留重置密码入口')
expectContains(manager, 'await reloadAccounts()', '重置密码后必须刷新可用验证方式')
expectContains(manager, '新增账号', '必须保留新增账号入口')
expectContains(manager, 'TwoStepButton', '必须保留启停入口')
expect(!existsSync(resolve(root, 'src/routes/partners/PartnerAccountDeletionDialog.tsx')), '旧删除弹窗必须移除')

for (const forbidden of ['localStorage', 'sessionStorage', 'console.log', 'console.error', 'data-ticket']) {
  expect(!`${hook}\n${dialog}\n${steps}`.includes(forbidden), `敏感操作 UI 不得使用 ${forbidden}`)
}
expectContains(auth, "fetch(`${API_BASE_URL}/auth/logout`", '登出必须 best-effort 调用服务端撤销近期验证')
expectContains(auth, 'const token = getToken()', '登出必须先捕获当前 bearer token')
expectContains(auth, 'clearAuth()', '登出必须立即清理本地会话')

if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}

console.log('  PASS API header、状态机、副作用隔离、无障碍、倒计时、敏感数据与退出契约完整')
