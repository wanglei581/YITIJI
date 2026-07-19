/**
 * Wave 2 账号换绑 + 资产一致性 — 静态契约验证。
 *
 * 覆盖内容：
 *   1. 换绑双验证：phone_rebind 已加入 MEMBER_STEP_UP_ACTIONS allowlist（shared + api 两份同步）
 *   2. 冲突拒绝：PHONE_CONFLICT 错误码已在服务实现中注册
 *   3. 审计日志：换绑成功写 'member.phone.rebind' action
 *   4. 会话踢出：调用 revokeMemberSessions（不残留旧会话）
 *   5. 资产删除端点：/me/resumes/:id DELETE 端点已注册
 *   6. 审计日志：简历删除写 'member.resume_delete' action
 *
 * 只做静态 import + 值检查；不起真实 HTTP 服务器，不需要 Redis/DB。
 * 运行：npx ts-node -r tsconfig-paths/register scripts/verify-wave2-account-rebind.ts
 */
import { MEMBER_STEP_UP_ACTIONS as SHARED_ACTIONS } from '../../../packages/shared/src/types/member-privacy'
import { MEMBER_STEP_UP_ACTIONS as API_ACTIONS } from '../src/member-auth/member-step-up.types'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  PASS  ${label}`)
    passed++
  } else {
    console.error(`  FAIL  ${label}`)
    failed++
  }
}

console.log('\n=== Wave 2 账号换绑契约验证 ===\n')

// ── 1. phone_rebind 在 allowlist 中 ──────────────────────────────
console.log('[1] MEMBER_STEP_UP_ACTIONS allowlist 同步')
assert(
  (SHARED_ACTIONS as readonly string[]).includes('phone_rebind'),
  'shared: phone_rebind in MEMBER_STEP_UP_ACTIONS',
)
assert(
  (API_ACTIONS as readonly string[]).includes('phone_rebind'),
  'api:    phone_rebind in MEMBER_STEP_UP_ACTIONS',
)
assert(
  JSON.stringify(SHARED_ACTIONS) === JSON.stringify(API_ACTIONS),
  'shared 与 api allowlist 完全一致',
)

// ── 2. 换绑服务文件存在 + 包含冲突拒绝、审计、会话踢出 ───────────
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = resolve(__dirname, '..')

function readSrc(rel: string): string {
  return readFileSync(resolve(BASE, rel), 'utf8')
}

console.log('\n[2] 换绑服务实现')
const rebindSvc = readSrc('src/member-auth/member-phone-rebind.service.ts')
assert(rebindSvc.includes('PHONE_CONFLICT'), "换绑服务包含 PHONE_CONFLICT 冲突错误码")
assert(rebindSvc.includes("'member.phone.rebind'"), "换绑服务写 'member.phone.rebind' 审计动作")
assert(rebindSvc.includes('revokeMemberSessions'), "换绑服务调用 revokeMemberSessions 踢出旧会话")
assert(rebindSvc.includes("'phone_rebind'"), "换绑服务 consumeGrant 绑定 'phone_rebind' 动作")

// ── 3. 换绑端点已挂载 ────────────────────────────────────────────
console.log('\n[3] 换绑端点注册')
const authCtrl = readSrc('src/member-auth/member-auth.controller.ts')
assert(authCtrl.includes("'phone/rebind'"), "controller 挂载 POST 'phone/rebind'")
assert(authCtrl.includes('PhoneRebindDto'), "controller 引用 PhoneRebindDto")
assert(authCtrl.includes('MemberPhoneRebindService'), "controller 注入 MemberPhoneRebindService")

const authModule = readSrc('src/member-auth/member-auth.module.ts')
assert(authModule.includes('MemberPhoneRebindService'), "module 注册 MemberPhoneRebindService provider")

// ── 4. 资产简历删除端点 ────────────────────────────────────────────
console.log('\n[4] 简历删除端点注册')
const assetsCtrl = readSrc('src/member-assets/member-assets.controller.ts')
assert(assetsCtrl.includes("'resumes/:id'") && assetsCtrl.includes('@Delete'), "controller 挂载 DELETE 'resumes/:id'")
assert(assetsCtrl.includes("'member.resume_delete'"), "controller 写 'member.resume_delete' 审计动作")

const assetsSvc = readSrc('src/member-assets/member-assets.service.ts')
assert(assetsSvc.includes('async deleteResume'), "service 实现 deleteResume 方法")
assert(assetsSvc.includes("kind: { in: ['parse', 'generate'] }"), "deleteResume 限定 parse/generate kind")

// ── 5. Kiosk 前端 API 函数 ────────────────────────────────────────
console.log('\n[5] Kiosk 换绑 API 函数')
const BASE_KIOSK = resolve(BASE, '../../apps/kiosk/src')
function readKiosk(rel: string): string {
  return readFileSync(resolve(BASE_KIOSK, rel), 'utf8')
}
const memberAuthApi = readKiosk('services/auth/memberAuthApi.ts')
assert(memberAuthApi.includes('sendPhoneRebindStepUpCode'), "kiosk: 导出 sendPhoneRebindStepUpCode")
assert(memberAuthApi.includes('verifyPhoneRebindStepUp'), "kiosk: 导出 verifyPhoneRebindStepUp")
assert(memberAuthApi.includes('submitPhoneRebind'), "kiosk: 导出 submitPhoneRebind")
assert(memberAuthApi.includes("'/member/phone/rebind'"), "kiosk: API 路径指向 /member/phone/rebind")

// ── 6. Kiosk 设置页集成 ───────────────────────────────────────────
console.log('\n[6] Kiosk 设置页集成')
const settingsPage = readKiosk('pages/profile/me/MySettingsPage.tsx')
assert(settingsPage.includes('PhoneRebindOverlay'), "MySettingsPage 包含 PhoneRebindOverlay 组件")
assert(settingsPage.includes('showRebind'), "MySettingsPage 含 showRebind 状态")
assert(settingsPage.includes('handleRebindDone'), "MySettingsPage 含 handleRebindDone 换绑完成处理")
assert(settingsPage.includes('换绑手机号'), "MySettingsPage 可见文案「换绑手机号」")

// ── 结果汇总 ──────────────────────────────────────────────────────
console.log(`\n结果: ${passed} PASS, ${failed} FAIL`)
if (failed > 0) {
  console.error('\n验证未通过，请修复上述 FAIL 项后重新运行。')
  process.exit(1)
}
console.log('全部通过。')
