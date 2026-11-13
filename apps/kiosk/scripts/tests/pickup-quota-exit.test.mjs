/**
 * 到机码认领被免费额度拒绝时，哪些错误码给「去登录」。
 * 判据在 pickupQuotaExit.ts，这里转译真实源码，不另抄一份。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(absolutePath) {
  const out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  assert.deepEqual(leftover, [], `${absolutePath} 不应有运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
  }
}

const quotaUrl = transpile(join(kioskRoot, 'src/pages/print/pickupQuotaExit.ts'))
const resumeUrl = transpile(join(kioskRoot, 'src/pages/print/pickupClaimResume.ts'))
const returnUrl = transpile(join(kioskRoot, 'src/auth/returnPath.ts'))

test('只有游客单次额度给去登录；机器日额度与会员日额度只等恢复', async () => {
  const { pickupQuotaExit, pickupQuotaOffersLogin } = await import(quotaUrl)
  assert.equal(pickupQuotaOffersLogin('PRINT_GUEST_ORDER_QUOTA_EXCEEDED'), true)
  assert.equal(pickupQuotaExit('PRINT_GUEST_ORDER_QUOTA_EXCEEDED'), 'login')
  for (const code of ['PRINT_TERMINAL_DAILY_QUOTA_REACHED', 'PRINT_MEMBER_DAILY_QUOTA_REACHED']) {
    assert.equal(pickupQuotaOffersLogin(code), false, code)
    assert.equal(pickupQuotaExit(code), 'wait', code)
  }
  for (const code of ['PICKUP_CODE_INVALID', 'RATE_LIMITED', '', null, undefined]) {
    assert.equal(pickupQuotaOffersLogin(code), false, String(code))
    assert.equal(pickupQuotaExit(code), null, String(code))
  }
})

test('到机码只进 sessionStorage，登录回跳地址里没有这串码', async () => {
  const storage = memoryStorage()
  globalThis.sessionStorage = storage
  const { rememberPickupClaimCode, readPickupClaimCode, clearPickupClaimCode, PICKUP_CLAIM_RESUME_KEY } = await import(resumeUrl)
  const code = '12345678'
  rememberPickupClaimCode(code)
  assert.equal(readPickupClaimCode(), code)
  assert.equal(storage.getItem(PICKUP_CLAIM_RESUME_KEY), code)
  assert.equal(PICKUP_CLAIM_RESUME_KEY, 'ai-job-print:pickup-claim-resume')

  const { loginPathForPrintStep } = await import(returnUrl)
  const path = loginPathForPrintStep('pickup')
  assert.equal(path, `/login?from=${encodeURIComponent('/print/pickup-claim')}`)
  assert.equal(path.includes(code), false)
  assert.equal(decodeURIComponent(path).includes(code), false)

  clearPickupClaimCode()
  assert.equal(readPickupClaimCode(), null)
  assert.equal(storage.getItem(PICKUP_CLAIM_RESUME_KEY), null)
})
