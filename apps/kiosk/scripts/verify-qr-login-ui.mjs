import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const appRoot = join(root, '..')

function read(relativePath) {
  return readFileSync(join(appRoot, relativePath), 'utf-8')
}

const loginPage = read('src/pages/auth/LoginPage.tsx')
const scanPanel = read('src/pages/auth/ScanQrLoginPanel.tsx')
const mobilePage = read('src/pages/auth/MobileQrLoginPage.tsx')
const qrApi = read('src/services/auth/memberQrLoginApi.ts')
const routes = read('src/routes/index.tsx')

assert.match(loginPage, /<ScanQrLoginPanel[\s\S]*onLoginSuccess=\{handleQrLoginSuccess\}/)
assert.doesNotMatch(loginPage, /微信扫码|支付宝扫码|ai-job-print:\/\/member-login/)

assert.match(scanPanel, /useRef\(false\)/)
assert.match(scanPanel, /claimingRef\.current = true/)
assert.match(scanPanel, /if \(claimingRef\.current\) return/)
assert.match(scanPanel, /claimingRef\.current = true[\s\S]*claimQrLoginViaLocalAgent/)
assert.match(scanPanel, /本机扫码登录服务未连接，请使用手机号登录/)
assert.match(scanPanel, /扫码登录服务不可用，请使用手机号登录/)

assert.match(mobilePage, /重新检查二维码/)
assert.doesNotMatch(mobilePage, /getMemberAuthDeviceId/)
assert.match(mobilePage, /confirmQrLogin\(ticketId, phone, code\)/)

assert.match(qrApi, /const configuredLocalAgentBaseUrl =/)
assert.match(qrApi, /candidate\.origin === base\.origin/)
assert.match(qrApi, /new URL\(`\$\{candidate\.pathname\}\$\{candidate\.search\}\$\{candidate\.hash\}`, base\)/)
assert.match(qrApi, /function parseQrLoginPublicBase/)
assert.match(qrApi, /catch \{[\s\S]*window\.location\.origin/)
assert.match(qrApi, /claimQrLoginViaLocalAgent\(ticketId: string\): Promise<LoginResult>/)

assert.match(routes, /path: '\/member\/qr-login'/)

console.log('verify-qr-login-ui: ok')
