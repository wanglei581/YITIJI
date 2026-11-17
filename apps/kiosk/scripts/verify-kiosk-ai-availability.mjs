/**
 * 一体机「能不能用」与页面降级。
 *
 * 当前段只守小青文字对话：
 *   探针明确 available false 才锁输入；网络失败、读不懂、available true 都不改状态。
 *   锁死时仍用页面现成的句子和手动出路。
 *
 * 纯读源码，并把无依赖的判定函数编译后真跑。不连网、不连库。
 * 运行：pnpm --filter @ai-job-print/kiosk verify:kiosk-ai-availability
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const page = read('src/pages/assistant/AssistantPage.tsx')
const hook = read('src/pages/assistant/useAssistantChatLock.ts')
const pure = read('src/pages/assistant/assistantLockFromProbe.ts')

assert.match(page, /useAssistantChatLock\(setAiAvailability, assistantProbeNonce\)/, '问小青页必须读对话探针')
assert.match(page, /setAssistantProbeNonce\(\(nonce\) => nonce \+ 1\)/, '重新检查必须再探一次')
assert.match(page, /小青这会儿没有接上。下面这些事不用问也能办。/, '锁死句必须仍是页面现成的那句')
assert.match(page, /<AdvisorManualEntries \/>/, '锁死时仍给出手动出路')
assert.doesNotMatch(hook, /setAvailability\('available'\)/, '探针不得把状态写成可用')
assert.match(hook, /assistantLockFromProbe\(body\) === 'lock'\) setAvailability\('unavailable'\)/, '只有判定为 lock 才锁输入')
assert.match(hook, /\.catch\(\(\) => undefined\)/, '网络失败不得改状态')
assert.match(pure, /row\.available === false/, '只有 available 为 false 才锁')
console.log('  PASS 小青页面：探针不能用才锁输入，句子与出路仍在')

const js = ts.transpileModule(pure, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const dir = mkdtempSync(join(tmpdir(), 'q22-kiosk-lock-'))
const file = join(dir, 'lock.mjs')
writeFileSync(file, js)
const { assistantLockFromProbe } = await import(pathToFileURL(file).href)

const cases = [
  [{ success: true, data: { available: false } }, 'lock', '包装后的 false'],
  [{ available: false }, 'lock', '裸 false'],
  [{ success: true, data: { available: true } }, 'keep', '可用'],
  [{ success: true, data: {} }, 'keep', '没有 available'],
  [null, 'keep', '空体'],
  [{ success: false }, 'keep', '失败体'],
  ['nope', 'keep', '不是对象'],
]
for (const [body, expect, label] of cases) {
  assert.equal(assistantLockFromProbe(body), expect, label)
}
console.log('  PASS 小青判定函数：只有明确不能用才锁，其余保持原状')
rmSync(dir, { recursive: true, force: true })
console.log('\n=== ALL PASS ===')
