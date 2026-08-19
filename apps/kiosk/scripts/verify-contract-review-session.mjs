import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

const store = read('src/pages/contract-review/contractReviewSession.ts')
const notice = read('src/pages/contract-review/ContractReviewSessionNotice.tsx')
const home = read('src/pages/contract-review/ContractReviewHomePage.tsx')
const processing = read('src/pages/contract-review/ContractReviewProcessingPage.tsx')
const result = read('src/pages/contract-review/ContractReviewResultPage.tsx')
const cleanup = read('src/auth/kioskSensitiveSession.ts')
const auth = read('src/auth/AuthContext.tsx')

assert.match(store, /let activeSession: ContractReviewSession \| null = null/)
assert.match(store, /ownerMemberId !== currentMemberId[\s\S]*activeSession = null/)
assert.match(store, /export function clearContractReviewSession\(\): void/)
assert.doesNotMatch(store, /localStorage|sessionStorage|indexedDB|document\.cookie|history\./)

assert.match(cleanup, /clearContractReviewSession\(\)/)
assert.match(
  auth,
  /const login = useCallback\([\s\S]*?clearKioskSensitiveSession\(\)[\s\S]*?setUser\(next\)/,
)

assert.match(home, /startContractReviewSession\(\{/)
assert.match(home, /navigate\('\/contract-review\/processing'\)/)
assert.doesNotMatch(home, /navigate\('\/contract-review\/processing',[\s\S]{0,160}?state:/)

assert.match(processing, /readContractReviewSession\(user\?\.id \?\? null\)/)
assert.match(processing, /updateContractReviewSession\(t\)/)
assert.match(processing, /navigate\('\/contract-review\/result', \{ replace: true \}\)/)
assert.doesNotMatch(processing, /useLocation|location\.state|state:\s*\{[^}]*accessToken/)

assert.match(result, /readContractReviewSession\(user\?\.id \?\? null\)/)
assert.match(result, /clearContractReviewSession\(\)/)
assert.doesNotMatch(result, /useLocation|location\.state/)
assert.match(result, /报告打印暂未开放/)

assert.match(notice, /刷新、关闭页面或切换用户会结束本次查看/)
assert.match(notice, /当前合同和结果无法从此终端恢复/)
assert.match(processing, /<ContractReviewSessionNotice expiresAt=\{session\.expiresAt\}/)
assert.match(result, /<ContractReviewSessionNotice expiresAt=\{session\.expiresAt\}/)

// ── consent-scope 形状必须与服务端一致 ───────────────────────────────────────
// 服务端 `ContractReviewPublicConsentScope` 只返回嵌套的 `disclaimer.version`，
// 没有平铺的 `disclaimerVersion`。此前 kiosk 侧类型和 mock 各自多出一个平铺字段：
// http 模式下它恒为 undefined，`POST /contract-reviews` 必然 400
// （disclaimerVersion should not be empty），而 mock 伪造了该字段，
// 于是三条 mock Playwright 用例全绿、真实后端 100% 失败。
// 这里同时钉住「类型不得有平铺字段」「mock 不得伪造该字段」「调用点走嵌套版本」，
// 保证 mock 不能再遮蔽同类前后端契约漂移。
const contractApi = read('src/services/api/contractReview.ts')
const consentScopeType = contractApi.match(/export interface ConsentScope \{[\s\S]*?\n\}/)?.[0] ?? ''
assert.ok(consentScopeType, 'ConsentScope 接口必须存在')
assert.doesNotMatch(consentScopeType, /disclaimerVersion/)
const mockScope = contractApi.match(/function mockConsentScope\(\)[\s\S]*?\n\}\n/)?.[0] ?? ''
assert.ok(mockScope, 'mockConsentScope 必须存在')
assert.doesNotMatch(mockScope, /disclaimerVersion/)
assert.match(home, /disclaimerVersion:\s*consentScope\.disclaimer\.version/)
assert.match(home, /UploadSessionQrPanel/)
assert.match(home, /purpose="contract_upload"/)
assert.match(home, /createContractReviewFromSource/)
assert.match(home, /本机文件（桌面验证）/)
assert.match(contractApi, /export async function createContractReviewFromSource/)
assert.doesNotMatch(home, /不超过 20MB/)

console.log('PASS contract review volatile session contract')
