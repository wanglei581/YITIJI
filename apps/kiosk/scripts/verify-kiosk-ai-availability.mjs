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

const setup = read('src/pages/interview/InterviewSetupPage.tsx')
const interviewHook = read('src/pages/interview/useMockInterviewAvailability.ts')
const interviewPure = read('src/pages/interview/interviewStartControl.ts')
assert.match(setup, /useMockInterviewAvailability\(\)/, '设置页必须先读开场探针')
assert.match(setup, /interviewStartControl\(opening\)/, '开始键必须按探针判定')
assert.match(setup, /control\.mode === 'sheet'/, '不能用时主按钮走题目单，不亮开场')
assert.match(setup, /打印通用题目单/, '不能用时给出打印题目单')
assert.match(setup, /先看面试技巧/, '不能用时仍可看技巧')
assert.match(setup, /INTERVIEW_DOWN_NOTE/, '不能用时用稿上的现成句')
assert.match(setup, /control\.mode === 'wait'/, '还没确认时开始键不亮')
assert.match(setup, /control\.mode === 'start'\) void handleStart\(\)/, '只有确认能用才开场')
assert.doesNotMatch(setup, /handleOpenSheet[\s\S]{0,800}startInterview\(/, '题目单这条路不得开场')
assert.match(interviewHook, /\/mock-interviews\/availability/, '探针打到开场只读接口')
assert.match(interviewHook, /setProbe\('unconfirmed'\)/, '网络失败记成没确认')
assert.doesNotMatch(interviewHook, /setProbe\('up'\)|setProbe\('down'\)/, '钩子不得把失败或成功写死')
assert.match(interviewPure, /题目单不经模型，不含点评、评分或通过率。/, '说明用稿上的现成句')
console.log('  PASS 面试设置页：不能用时开始键不亮，两条出路在；探不到不说正常')

const interviewJs = ts.transpileModule(interviewPure, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText
const interviewDir = mkdtempSync(join(tmpdir(), 'q22-kiosk-interview-'))
const interviewFile = join(interviewDir, 'interview.mjs')
writeFileSync(interviewFile, interviewJs)
const { interviewProbeFromBody, interviewStartControl } = await import(pathToFileURL(interviewFile).href)
const interviewCases = [
  [{ success: true, data: { available: false } }, 'down', 'sheet', 'off', '包装后的 false'],
  [{ available: false }, 'down', 'sheet', 'off', '裸 false'],
  [{ success: true, data: { available: true } }, 'up', 'start', 'available', '可用'],
  [{ success: true, data: {} }, 'unconfirmed', 'wait', 'unconfirmed', '没有 available'],
  [null, 'unconfirmed', 'wait', 'unconfirmed', '空体'],
  [{ success: false, error: { code: 'AI_NOT_CONFIGURED' } }, 'unconfirmed', 'wait', 'unconfirmed', '失败体不当成不能用'],
  ['nope', 'unconfirmed', 'wait', 'unconfirmed', '不是对象'],
]
for (const [body, probe, mode, pill, label] of interviewCases) {
  assert.equal(interviewProbeFromBody(body), probe, label)
  assert.deepEqual(interviewStartControl(probe), { mode, pill }, label)
}
assert.deepEqual(interviewStartControl('checking'), { mode: 'wait', pill: 'checking' }, '确认中不说正常也不说不能用')
console.log('  PASS 面试判定函数：只有明确不能用才改走题目单')
rmSync(interviewDir, { recursive: true, force: true })
console.log('\n=== ALL PASS ===')
