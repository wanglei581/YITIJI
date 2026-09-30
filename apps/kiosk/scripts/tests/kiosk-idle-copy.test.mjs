import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

function loadModule(rel) {
  const source = readFileSync(join(kioskRoot, rel), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(js)}`
  return import(dataUrl)
}

function read(rel) {
  return readFileSync(join(kioskRoot, rel), 'utf8')
}

test('idle labels come from the same durations the timers use', async () => {
  const m = await loadModule('src/auth/kioskIdleTiming.ts')
  assert.equal(m.DEFAULT_LOGOUT_IDLE_SEC, 180)
  assert.equal(m.DEFAULT_RESULT_IDLE_SEC, 90)
  assert.equal(m.RESULT_WARNING_SEC, 15)
  assert.equal(m.formatIdleDuration(180_000), '3 分钟')
  assert.equal(m.formatIdleDuration(90_000), '1 分 30 秒')
  assert.equal(m.formatIdleDuration(45_000), '45 秒')
  assert.deepEqual(m.resolveWarningWindow(90_000, 15), { triggerMs: 75_000, warningMs: 15_000 })
  assert.deepEqual(m.resolveWarningWindow(180_000, 30), { triggerMs: 150_000, warningMs: 30_000 })

  const timing = read('src/auth/kioskIdleTiming.ts')
  assert.match(timing, /import\.meta\.env\.VITE_KIOSK_LOGOUT_IDLE_SEC/)
  assert.match(timing, /import\.meta\.env\.VITE_KIOSK_RESULT_IDLE_SEC/)
  assert.match(timing, /import\.meta\.env\.VITE_KIOSK_SESSION_WARNING_SEC/)
  assert.doesNotMatch(timing, /import\.meta\.env\[/)
})

test('previous-user promise only when the machine is actually clean', async () => {
  const m = await loadModule('src/auth/kioskIdleTiming.ts')
  const clean = m.homeStandbyNote(
    { isLoggedIn: false, guestMode: false, hasSensitiveSession: false },
    '3 分钟',
  )
  assert.match(clean, /不会显示上一位使用者的资料/)

  const loggedIn = m.homeStandbyNote(
    { isLoggedIn: true, guestMode: false, hasSensitiveSession: false },
    '3 分钟',
  )
  assert.doesNotMatch(loggedIn, /不会显示上一位/)
  assert.match(loggedIn, /离开前请点结束使用/)
  assert.match(loggedIn, /3 分钟/)

  const guest = m.homeStandbyNote(
    { isLoggedIn: false, guestMode: true, hasSensitiveSession: false },
    '3 分钟',
  )
  assert.doesNotMatch(guest, /不会显示上一位/)
  assert.match(guest, /还留着这次使用的内容/)

  const sensitive = m.homeStandbyNote(
    { isLoggedIn: false, guestMode: false, hasSensitiveSession: true },
    '3 分钟',
  )
  assert.doesNotMatch(sensitive, /不会显示上一位/)
})

test('documents copy uses the result-page duration and names 结束使用', async () => {
  const m = await loadModule('src/auth/kioskIdleTiming.ts')
  const truth = m.documentsLoggedInTruth('1 分 30 秒')
  assert.match(truth, /1 分 30 秒/)
  assert.match(truth, /结束使用/)
  assert.match(truth, /当前仍登录/)
  assert.doesNotMatch(truth, /不会显示上一位/)
  assert.doesNotMatch(truth, /3 分钟/)
  assert.doesNotMatch(truth, /隐私已清除/)
})

test('documents idle still opens the existing 还在用吗 page', () => {
  const idle = read('src/auth/useIdleLogout.ts')
  assert.match(idle, /from '\.\/kioskIdleTiming'/)
  assert.match(idle, /pathname === '\/me\/documents'/)
  assert.match(idle, /resolveResultIdleMs\(\)/)
  assert.match(idle, /RESULT_WARNING_SEC/)

  const guard = read('src/auth/KioskPrivacyGuard.tsx')
  assert.match(guard, /navigate\('\/session-timeout'\)/)

  const reminder = read('src/pages/session-guard/SessionGuardView.tsx')
  assert.match(reminder, /还在用吗/)
  const timeout = read('src/pages/placeholders/SessionTimeoutPage.tsx')
  assert.match(timeout, /我还在，继续使用/)
  assert.match(timeout, /continueSession/)
})
