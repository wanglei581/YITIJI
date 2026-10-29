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
assert.match(cleanup, /clearSelfAssessmentSession\(\)/)
assert.match(cleanup, /SELF_ASSESSMENT_SESSION_KEY/)
assert.match(cleanup, /clearKioskSharedDeviceResidue/)
assert.match(cleanup, /hasLocalFavorites\(\)/)
assert.match(
  auth,
  // 换人清场必须带**上一位**的令牌（current.token）：服务端按 endUserId 校验扫描任务
  // 取消权限，用新登录这位的令牌只会 403，旧任务原地存活等着收下一次面板扫描。
  /const login = useCallback\([\s\S]*?clearKioskSensitiveSession\(current\.token\)[\s\S]*?setUser\(next\)/,
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
assert.match(result, /保存到我的文档/)
assert.doesNotMatch(result, /打印风险提示报告|报告打印暂未开放/)

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

// ── AI 停用（稿 contract / contract-result）─────────────────────────────────
// 首页在请求前就按终端配置的 ai.paused 停用分析并写原因；读不到只算没确认，不说停用也不说可用（有超时，不挂死）。
// 停用时：开始分析不可用、问小青换停用态、出口是「去打印扫描」。结果页每条风险卡默认可见「AI 生成，仅供参考」。
assert.match(home, /getKioskTerminalConfig\(terminalId\)/)
assert.match(home, /config\.ai\?\.paused === true/)
assert.match(home, /AI_STATUS_CHECK_TIMEOUT_MS/)
assert.match(home, /const canSubmit = [^\n]*!aiDown && !checkingAi/)
assert.match(home, /if \(aiDown \|\| checkingAi \|\|/)
assert.match(home, /ask=\{aiDown \? \{ label: '小青暂时不可用，可先打印', disabled: true \}/)
assert.match(home, /title="去打印扫描"[\s\S]{0,160}navigate\('\/print-scan'\)/)
assert.match(home, /availability: aiDown \? 'unavailable' : submitting \? 'available' : 'unknown', pending: submitting/)
const findingCard = result.match(/function FindingCard\([\s\S]*?\n\}\n/)?.[0] ?? ''
assert.ok(findingCard, 'FindingCard 必须存在')
assert.ok(
  findingCard.indexOf('AI_LABEL_COPY.BASE') > -1 &&
    findingCard.indexOf('AI_LABEL_COPY.BASE') < findingCard.indexOf('{expanded && ('),
  '每条风险卡的「AI 生成，仅供参考」必须在折叠之外默认可见',
)
assert.ok(
  findingCard.indexOf('cr-finding-excerpt') < findingCard.indexOf('{expanded && (') &&
    findingCard.indexOf('cr-finding-question') < findingCard.indexOf('{expanded && ('),
  '原文摘录与核对追问必须在折叠之外默认可见',
)

console.log('PASS contract review volatile session contract')
