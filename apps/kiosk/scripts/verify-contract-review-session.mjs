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

console.log('PASS contract review volatile session contract')
