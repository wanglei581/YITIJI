import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(kioskRoot, 'src/pages/resume/components/resume-deliver/resumeDecisions.ts'), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
new Function('exports', 'module', output)(module.exports, module)
const { isModuleSwitchable, moduleSwitchBlock, toggleModuleDecision, applyDecisionChanges, applyResumeDecisionsWithStatus, compareDecisionChanges } = module.exports

const makeResume = (text) => ({
  basic: { name: '求职者', phone: '', city: '' }, intention: { position: '', city: '' }, summary: text,
  education: [], experience: [], projects: [], skills: [], certificates: [],
})
const moduleOf = (before, after, title = '经历') => ({ title, before, after, category: 'summary' })

test('isModuleSwitchable respects the loaded base resume and empty after text', () => {
  const item = moduleOf('原文', '优化句')
  assert.equal(isModuleSwitchable(null, item), true)
  assert.equal(isModuleSwitchable(makeResume('含有优化句的正文'), item), true)
  assert.equal(isModuleSwitchable(makeResume('没有这句话'), item), false)
  assert.equal(isModuleSwitchable(makeResume('优化句'), moduleOf('原文', '')), false)
})

 test('正常切换来回会真实改正文并报告 applied', () => {
  const item = moduleOf('原来的话', '更好的话')
  const first = toggleModuleDecision(makeResume(item.after), item, 'optimized', 'original')
  assert.equal(first.applied, true)
  assert.equal(first.resume.summary, item.before)
  const second = toggleModuleDecision(first.resume, item, 'original', 'optimized')
  assert.equal(second.applied, true)
  assert.equal(second.resume.summary, item.after)
})

test('原文为空时删掉改写后不能假装切回改写', () => {
  const item = moduleOf('', '新增的一句')
  const removed = toggleModuleDecision(makeResume(item.after), item, 'optimized', 'original')
  assert.equal(removed.applied, true)
  assert.equal(removed.resume.summary, '')
  const blocked = toggleModuleDecision(removed.resume, item, 'original', 'optimized')
  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'original-empty')
  assert.equal(blocked.resume.summary, '')
})

test('用户改过正文后找不到来源时保持原文并报告 edited', () => {
  const item = moduleOf('原来的话', '更好的话')
  const blocked = toggleModuleDecision(makeResume('用户自己改过'), item, 'optimized', 'original')
  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'edited')
  assert.equal(blocked.resume.summary, '用户自己改过')
})

test('批量切换只更新真正换成的条目', () => {
  const first = moduleOf('原文一', '改写一', '一')
  const second = moduleOf('原文二', '改写二', '二')
  const result = applyDecisionChanges(
    { ...makeResume('改写一；用户改过二'), summary: '改写一；用户改过二' },
    [first, second],
    { 'm0:一': 'optimized', 'm1:二': 'optimized' },
    [['m0:一', 'original'], ['m1:二', 'original']],
  )
  assert.equal(result.resume.summary, '原文一；用户改过二')
  assert.equal(result.decisions['m0:一'], 'original')
  assert.equal(result.decisions['m1:二'], 'optimized')
  assert.deepEqual(result.failures.map((failure) => failure.key), ['m1:二'])
})

test('导出组装把已经保留原文的正文视为已对齐，只报告编辑后两版都找不到', () => {
  const item = moduleOf('原文', '改写', '一')
  const aligned = applyResumeDecisionsWithStatus(makeResume('原文'), [item], { 'm0:一': 'original' })
  assert.deepEqual(aligned.failures, [])
  const mismatch = applyResumeDecisionsWithStatus(makeResume('用户改过'), [item], { 'm0:一': 'original' })
  assert.deepEqual(mismatch.failures.map((failure) => failure.reason), ['edited'])
})

test('带基准稿的批量切换跳过不可切换条目并保留选择', () => {
  const first = moduleOf('原文一', '改写一', '一')
  const second = moduleOf('原文二', '建议改为二', '二')
  const base = { ...makeResume('改写一'), summary: '改写一' }
  const result = applyDecisionChanges(
    { ...base, summary: '改写一' }, [first, second], { 'm0:一': 'optimized', 'm1:二': 'optimized' },
    [['m0:一', 'original'], ['m1:二', 'original']], base,
  )
  assert.equal(result.resume.summary, '原文一')
  assert.equal(result.decisions['m0:一'], 'original')
  assert.equal(result.decisions['m1:二'], 'optimized')
  assert.deepEqual(result.failures, [{ key: 'm1:二', reason: 'not-found' }])
})

test('带基准稿的单条切换对优化句不在正文的条目报告 not-found', () => {
  const item = moduleOf('原文', '建议改为原文')
  const base = makeResume('正文里没有建议句')
  const result = toggleModuleDecision(base, item, 'optimized', 'original', base)
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'not-found')
  assert.equal(result.resume.summary, base.summary)
})

test('原文为空的新增句按基准稿判为只能手改，两个方向都不切换', () => {
  const item = moduleOf('', '新加的一句')
  const base = makeResume('新加的一句')
  assert.equal(moduleSwitchBlock(base, item), 'original-empty')
  assert.equal(isModuleSwitchable(base, item), false)
  const toOriginal = toggleModuleDecision(base, item, 'optimized', 'original', base)
  assert.deepEqual([toOriginal.applied, toOriginal.reason, toOriginal.resume.summary], [false, 'original-empty', '新加的一句'])
  const toOptimized = toggleModuleDecision(base, item, 'original', 'optimized', base)
  assert.deepEqual([toOptimized.applied, toOptimized.reason, toOptimized.resume.summary], [false, 'original-empty', '新加的一句'])
})

test('找不到改写优先于原文为空：两种都算只能手改，原因取 not-found', () => {
  assert.equal(moduleSwitchBlock(makeResume('正文'), moduleOf('', '不在正文的一句')), 'not-found')
  assert.equal(moduleSwitchBlock(makeResume('正文'), moduleOf('原文', '正文')), null)
  assert.equal(moduleSwitchBlock(null, moduleOf('', '')), null)
})

test('选了用改写但改写不在稿里时不标记已应用，正文不变', () => {
  const item = moduleOf('带领班组完成设备调试', '写清本人承担的环节与实际结果')
  const resume = makeResume('带领班组完成设备调试')
  const sameChoice = toggleModuleDecision(resume, item, 'optimized', 'optimized', resume)
  assert.equal(sameChoice.applied, false)
  assert.equal(sameChoice.reason, 'not-found')
  assert.equal(sameChoice.resume.summary, resume.summary)
  const applied = applyDecisionChanges(resume, [item], {}, [['m0:经历', 'optimized']], resume)
  assert.equal(applied.resume.summary, resume.summary)
  assert.equal(applied.decisions['m0:经历'], undefined)
  assert.deepEqual(applied.failures, [{ key: 'm0:经历', reason: 'not-found' }])
})

test('改写已经在稿里时，再次选择用改写仍算已应用', () => {
  const item = moduleOf('原来的话', '更好的话')
  const resume = makeResume('更好的话')
  const result = toggleModuleDecision(resume, item, 'optimized', 'optimized', resume)
  assert.equal(result.applied, true)
  assert.equal(result.reason, undefined)
  assert.equal(result.resume.summary, '更好的话')
})

test('对照页带回的用改写，改写不在稿里时仍进入待应用，已经写进稿里的不重复应用', () => {
  const missing = moduleOf('原文一', '建议改为不在稿里的一句', '一')
  const present = moduleOf('原文二', '改写二', '二')
  const resume = makeResume('改写二')
  const changes = compareDecisionChanges(
    resume,
    [missing, present],
    {},
    { 'm0:一': 'optimized', 'm1:二': 'optimized' },
  )
  assert.deepEqual(changes, [['m0:一', 'optimized']])
})

test('编辑区改过、但改写在基准稿里的条目仍报 edited，不报 not-found', () => {
  const item = moduleOf('原来的话', '更好的话')
  const base = makeResume('更好的话')
  const result = toggleModuleDecision(makeResume('用户自己改过'), item, 'optimized', 'original', base)
  assert.deepEqual([result.applied, result.reason], [false, 'edited'])
})
