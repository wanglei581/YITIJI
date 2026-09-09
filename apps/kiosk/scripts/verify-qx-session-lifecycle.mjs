import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')

const files = {
  root: read('src/layouts/KioskRoot.tsx'),
  standbyPage: read('src/pages/screensaver/ScreensaverPage.tsx'),
  standbyView: read('src/pages/screensaver/StandbyView.tsx'),
  standbyModel: read('src/pages/screensaver/standbyModel.ts'),
  loginPage: read('src/pages/auth/LoginPage.tsx'),
  loginModel: read('src/pages/auth/loginGateModel.ts'),
  loginFields: read('src/pages/auth/components/LoginGatePhoneFields.tsx'),
  sessionPage: read('src/pages/placeholders/SessionTimeoutPage.tsx'),
  sessionView: read('src/pages/session-guard/SessionGuardView.tsx'),
  sessionModel: read('src/pages/session-guard/sessionGuardModel.ts'),
  overlay: read('src/auth/KioskPrivacyGuard.tsx'),
  sensitive: read('src/auth/kioskSensitiveSession.ts'),
  resumePage: read('src/pages/session-resume/SessionResumePage.tsx'),
  resumeView: read('src/pages/session-resume/SessionResumeView.tsx'),
  resumeModel: read('src/pages/session-resume/sessionResumeModel.ts'),
}

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

for (const route of ['/screensaver', '/login', '/session-timeout', '/session-resume']) {
  check(`QX_MIGRATED_ROUTES registers ${route}`, () => {
    assert.match(files.root, new RegExp(`['"]${route}['"]`))
  })
}

check('standby wakes to home and clears via kioskSensitiveSession', () => {
  assert.match(files.standbyPage, /clearKioskSensitiveSession\(\)/)
  assert.match(files.standbyPage, /logout\(\)/)
  assert.match(files.standbyView, /data-testid="standby-primary"/)
  assert.match(files.standbyPage, /navigate\('\/'/)
  assert.doesNotMatch(files.standbyPage, /useEffect\(\s*\(\)\s*=>\s*\{\s*return\s*\(\)\s*=>\s*clearKioskSensitiveSession/)
})

check('standby empty playlist still exits home and does not invent media', () => {
  assert.match(files.standbyPage, /if\s*\(\s*!p\.enabled\s*\|\|\s*p\.items\.length\s*===\s*0\s*\)\s*\{\s*exit\(\)/)
  assert.match(files.standbyModel, /standbyShouldExitHome/)
  assert.doesNotMatch(files.standbyPage, /demoPlaylist|fakePlaylist|mockPlaylist/)
})

check('login gate has a leave-without-login exit and no 已登录 overlay', () => {
  assert.match(files.loginPage, /QxPageFrame/)
  assert.match(files.loginPage, /back=\{\{\s*label:\s*'返回首页'/)
  assert.match(files.loginPage, /不登录，继续使用/)
  assert.match(files.loginPage, /useMemberPhoneLogin\(/)
  assert.match(files.loginPage, /phoneLogin\.paneProps/)
  assert.match(files.loginPage, /<MemberAgreement/)
  assert.doesNotMatch(files.loginPage, /登录成功，正在进入/)
  assert.doesNotMatch(files.loginPage, /successVisible/)
  const loginCopy = `${files.loginPage}\n${files.loginModel}`.replace(/不显示「已登录」/g, '')
  assert.doesNotMatch(loginCopy, /已登录/)
})

check('login keypad remains on-page and agreement-gated', () => {
  assert.match(files.loginFields, /data-testid="login-gate-keypad"/)
  assert.match(files.loginFields, /const canSend = agreed && phone\.length === MEMBER_PHONE_LENGTH/)
  assert.match(files.loginPage, /aria-disabled=\{!canConfirm\}/)
})

check('session guard continue is fail-closed and clearing overlay still blocks', () => {
  assert.match(files.sessionPage, /continueSession/)
  assert.match(files.sessionPage, /hardClear/)
  assert.match(files.sessionPage, /结束并清除本机会话/)
  assert.match(files.sessionPage, /我还在，继续使用/)
  assert.match(files.overlay, /data-kiosk-privacy-clearing="true"/)
  assert.match(files.overlay, /正在清除本机会话/)
  assert.match(files.overlay, /clearKioskSensitiveSession\(\)/)
  assert.doesNotMatch(files.sessionPage, /onClick=\{canContinue \? continueSession : hardClear\}/)
})

check('session resume maps only cashier/progress and fail-closes invalid rows', () => {
  assert.match(files.resumePage, /getPendingTasks\(token\)/)
  assert.match(files.resumePage, /navigate\('\/login'/)
  assert.match(files.resumePage, /navigate\('\/print\/cashier'/)
  assert.match(files.resumePage, /navigate\('\/print\/progress'/)
  assert.match(files.resumeModel, /status === 'pending'/)
  assert.match(files.resumeModel, /status === 'claimed'/)
  assert.match(files.resumeModel, /status === 'printing'/)
  assert.match(files.resumeView, /继续（暂不可用）/)
  assert.doesNotMatch(files.resumeView, /已支付，等待终端领取任务/)
  assert.match(files.resumePage, /back=\{\{\s*label:\s*'返回首页'/)
})

check('centralized sensitive session cleanup is unchanged', () => {
  assert.match(files.sensitive, /export function clearKioskSensitiveSession/)
  assert.match(files.standbyPage, /from '\.\.\/\.\.\/auth\/kioskSensitiveSession'/)
  assert.match(files.overlay, /from '\.\/kioskSensitiveSession'/)
})

if (failures) {
  console.error(`\n${failures} FAIL qx session lifecycle`)
  process.exit(1)
}
console.log('\nALL PASS qx session lifecycle')
