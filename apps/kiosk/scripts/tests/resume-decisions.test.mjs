import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cache = new Map()
const loadTs = (absPath) => {
  if (cache.has(absPath)) return cache.get(absPath)
  const output = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  cache.set(absPath, loaded)
  const dir = dirname(absPath)
  const localRequire = (id) => {
    if (!id.startsWith('.')) throw new Error(`unexpected require ${id}`)
    return loadTs(join(dir, id.endsWith('.ts') ? id : `${id}.ts`)).exports
  }
  new Function('exports', 'module', 'require', output)(loaded.exports, loaded, localRequire)
  return loaded
}
const module = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/resumeDecisions.ts'))
const {
  isModuleSwitchable, moduleSwitchBlock, moduleBaseState, moduleKeyOf, defaultModuleDecision,
  toggleModuleDecision, applyDecisionChanges, applyResumeDecisionsWithStatus, compareDecisionChanges,
  isNoActionModule,
} = module.exports
const compareModule = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-compare/resumeCompareModel.ts'))
const factsModule = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/facts.ts'))
const titlesModule = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/resumeEntryTitles.ts'))
const { buildCompareItems, adoptEligible, adoptEligibleBatchNote, visibleCompareIndices, focusToVisiblePosition } = compareModule.exports
const { detectUnconfirmedTextAdditions } = factsModule.exports
const { findResumeOriginalField, RESUME_EDIT_LIMITS } = titlesModule.exports

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
  // 有基准稿、改写恰好一处时，A 类两个方向都换这一处。
  // 没有基准稿时不猜第一处，见文末「没有基准稿」两条。
  const item = moduleOf('原来的话', '更好的话')
  const base = makeResume(item.after)
  const first = toggleModuleDecision(makeResume(item.after), item, 'optimized', 'original', base)
  assert.equal(first.applied, true)
  assert.equal(first.resume.summary, item.before)
  const second = toggleModuleDecision(first.resume, item, 'original', 'optimized', base)
  assert.equal(second.applied, true)
  assert.equal(second.resume.summary, item.after)
})

test('没有基准稿时原文为空也不猜，正文不动并报告 edited', () => {
  // 没有基准稿分不出该删哪一处。两个方向都报 edited，正文保持调用前的样子。
  // 有基准稿时原文为空仍是 original-empty，见「原文为空的新增句按基准稿判为只能手改」。
  const item = moduleOf('', '新增的一句')
  const removed = toggleModuleDecision(makeResume(item.after), item, 'optimized', 'original')
  assert.equal(removed.applied, false)
  assert.equal(removed.reason, 'edited')
  assert.equal(removed.resume.summary, '新增的一句')
  const blocked = toggleModuleDecision(makeResume(''), item, 'original', 'optimized')
  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'edited')
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
  // 补上基准稿：第一条改写在稿里恰好一处，仍换成原文。
  // 没有基准稿时两条都会停住，见文末「没有基准稿」两条。
  const first = moduleOf('原文一', '改写一', '一')
  const second = moduleOf('原文二', '改写二', '二')
  const base = makeResume('改写一；用户改过二')
  const result = applyDecisionChanges(
    { ...makeResume('改写一；用户改过二'), summary: '改写一；用户改过二' },
    [first, second],
    { 'm0:一': 'optimized', 'm1:二': 'optimized' },
    [['m0:一', 'original'], ['m1:二', 'original']],
    base,
  )
  assert.equal(result.resume.summary, '原文一；用户改过二')
  assert.equal(result.decisions['m0:一'], 'original')
  assert.equal(result.decisions['m1:二'], 'optimized')
  assert.deepEqual(result.failures.map((failure) => failure.key), ['m1:二'])
})

test('改写是原句的一部分时，保留原文后导出仍是原句一次', () => {
  const before = '主要负责门店排班和订货。'
  const after = '负责门店排班和订货。'
  const item = moduleOf(before, after, '去掉虚词')
  const base = makeResume(after)
  const key = moduleKeyOf(item, 0)
  const toggled = toggleModuleDecision(makeResume(after), item, 'optimized', 'original', base, {
    modules: [item], decisions: {}, index: 0,
  })
  assert.equal(toggled.applied, true)
  assert.equal(toggled.resume.summary, before)
  const assembled = applyResumeDecisionsWithStatus(toggled.resume, [item], { [key]: 'original' })
  assert.equal(assembled.resume.summary, before)
  assert.equal(assembled.resume.summary.split(before).length - 1, 1)
  assert.deepEqual(assembled.failures, [])
  const fromRewrite = applyResumeDecisionsWithStatus(makeResume(after), [item], { [key]: 'original' })
  assert.equal(fromRewrite.resume.summary, before)
  assert.deepEqual(fromRewrite.failures, [])
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

test('原文在稿里唯一时选用改写会换上并记为已应用', () => {
  const item = moduleOf('带领班组完成设备调试', '写清本人承担的环节与实际结果')
  const resume = makeResume('带领班组完成设备调试')
  assert.equal(moduleBaseState(resume, item).kind, 'B')
  const sameChoice = toggleModuleDecision(resume, item, 'optimized', 'optimized', resume)
  assert.equal(sameChoice.applied, true)
  assert.equal(sameChoice.reason, undefined)
  assert.equal(sameChoice.resume.summary, item.after)
  const applied = applyDecisionChanges(resume, [item], {}, [['m0:经历', 'optimized']], resume)
  assert.equal(applied.resume.summary, item.after)
  assert.equal(applied.decisions['m0:经历'], 'optimized')
  assert.deepEqual(applied.failures, [])
})

test('原文和改写都不在稿里时选用改写不应用，正文不变，原因 not-found', () => {
  const item = moduleOf('带领班组完成设备调试', '写清本人承担的环节与实际结果')
  const resume = makeResume('稿里是另一句话')
  assert.equal(moduleBaseState(resume, item).kind, 'D')
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

const job = (description) => ({ company: '示例公司', role: '职员', period: '2020-2021', description })

function sampleOne() {
  const sentences = [
    '个人优势第一句原文。',
    '个人优势第二句原文。',
    '个人优势第三句被截掉的后半。',
    '项目描述第四条原文。',
    '经历第五条原文。',
    '经历第六条原文。',
    '经历第七条原文。',
    '经历第八条原文。',
  ]
  const afters = sentences.map((sentence, index) => (
    index === 1 ? '个人优势第二句由我主导推进。' : sentence.replace('原文', '改写')
  ))
  const resume = {
    ...makeResume(`${sentences[0]}\n${sentences[1]}`),
    experience: [
      job(sentences[4]),
      job(sentences[5]),
      job('无关经历，不对应任何一条建议。'),
      job(sentences[6]),
      job(sentences[7]),
    ],
    projects: [{ name: '示例项目', role: '', description: sentences[3] }],
  }
  const modules = sentences.map((before, index) => moduleOf(before, afters[index], `第${index + 1}条`))
  return { resume, modules, sentences, afters }
}

function fieldText(resume, index) {
  if (index === 0 || index === 1) return resume.summary
  if (index === 3) return resume.projects[0].description
  if (index === 4) return resume.experience[0].description
  if (index === 5) return resume.experience[1].description
  if (index === 6) return resume.experience[3].description
  if (index === 7) return resume.experience[4].description
  return resume.summary
}

test('样本 1：对照页带回的用改写里，同文的第 3 条不产生变更也不失败，6 条 B 换上，第 2 条不动', () => {
  const { resume, modules, sentences, afters } = sampleOne()
  assert.deepEqual(modules.map((item) => moduleBaseState(resume, item).kind), ['B', 'C', 'D', 'B', 'B', 'B', 'B', 'B'])
  // 第 3 条句子里没有「原文」二字，改写与原文逐字相同，虽按基准稿是 D，但是无需操作。
  assert.equal(isNoActionModule(modules[2]), true)
  const incoming = {}
  modules.forEach((item, index) => {
    if (index === 1) return
    incoming[moduleKeyOf(item, index)] = 'optimized'
  })
  const changes = compareDecisionChanges(resume, modules, {}, incoming, resume)
  assert.equal(changes.some(([key]) => key === moduleKeyOf(modules[2], 2)), false)
  const applied = applyDecisionChanges(resume, modules, {}, changes, resume)
  assert.deepEqual(applied.failures, [])
  for (const index of [0, 3, 4, 5, 6, 7]) {
    const text = fieldText(applied.resume, index)
    assert.equal(text.includes(afters[index]), true, `第 ${index + 1} 条应换上改写`)
    assert.equal(text.includes(sentences[index]), false, `第 ${index + 1} 条不应再留原文`)
  }
  assert.equal(applied.resume.summary.includes(sentences[1]), true)
  assert.equal(applied.resume.summary.includes(afters[1]), false)
  assert.equal(applied.resume.experience[2].description, '无关经历，不对应任何一条建议。')
  assert.equal(applied.decisions[moduleKeyOf(modules[1], 1)], undefined)
})

test('样本 1：第 2 条经对照页确认后换上，能切换；换回原文后又不能切换', () => {
  const { resume, modules } = sampleOne()
  const item = modules[1]
  const key = moduleKeyOf(item, 1)
  assert.equal(moduleSwitchBlock(resume, item), 'not-found')
  assert.equal(isModuleSwitchable(resume, item), false)
  const changes = compareDecisionChanges(resume, modules, {}, { [key]: 'optimized' }, resume)
  const applied = applyDecisionChanges(resume, modules, {}, changes, resume)
  assert.deepEqual(applied.failures, [])
  assert.equal(applied.resume.summary.includes(item.after), true)
  assert.equal(applied.resume.summary.includes(item.before.trim()), false)
  assert.equal(applied.decisions[key], 'optimized')
  assert.equal(moduleSwitchBlock(resume, item, applied.decisions[key]), null)
  assert.equal(isModuleSwitchable(resume, item, 'optimized'), true)
  const reverted = toggleModuleDecision(applied.resume, item, 'optimized', 'original', resume)
  assert.equal(reverted.applied, true)
  assert.equal(reverted.resume.summary.includes(item.before.trim()), true)
  assert.equal(reverted.resume.summary.includes(item.after), false)
  assert.equal(moduleSwitchBlock(resume, item, 'original'), 'not-found')
  assert.equal(isModuleSwitchable(resume, item, 'original'), false)
})

test('同一句原文出现两次归 D 类，不换任何一处', () => {
  const sentence = '完成门店日结并核对收银。'
  const item = moduleOf(sentence, '改写后的日结句子。')
  const base = {
    ...makeResume(''),
    experience: [job(sentence), job(sentence)],
  }
  assert.equal(moduleBaseState(base, item).kind, 'D')
  assert.equal(moduleSwitchBlock(base, item), 'not-found')
  const result = toggleModuleDecision(base, item, 'original', 'optimized', base)
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'not-found')
  assert.equal(result.resume.experience[0].description, sentence)
  assert.equal(result.resume.experience[1].description, sentence)
})

test('基准稿里唯一、编辑区又粘了一份时选用改写报 edited，正文不变', () => {
  const sentence = '完成门店日结并核对收银。'
  const item = moduleOf(sentence, '改写后的日结句子。')
  const base = makeResume(sentence)
  const edited = makeResume(`${sentence}\n${sentence}`)
  assert.equal(moduleBaseState(base, item).kind, 'B')
  const result = toggleModuleDecision(edited, item, 'original', 'optimized', base)
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'edited')
  assert.equal(result.resume.summary, edited.summary)
})

test('K 类任何选择都不会把原文换成保持原文的说明句', () => {
  const before = '教育经历原文这一句。'
  const note = '这一段没有改动，保留原文'
  const item = moduleOf(before, note, '教育（保持原文）')
  const base = makeResume(`前缀${before}后缀`)
  assert.equal(moduleBaseState(base, item).kind, 'K')
  assert.equal(moduleSwitchBlock(base, item), 'not-found')
  for (const current of ['optimized', 'original']) {
    for (const next of ['optimized', 'original']) {
      const result = toggleModuleDecision(base, item, current, next, base)
      assert.equal(result.resume.summary, base.summary)
      assert.equal(result.resume.summary.includes(note), false)
    }
  }
  const applied = applyDecisionChanges(base, [item], {}, [[moduleKeyOf(item, 0), 'optimized']], base)
  assert.equal(applied.resume.summary, base.summary)
  assert.equal(applied.decisions[moduleKeyOf(item, 0)], undefined)
})

test('B 类来回切换三次正文都对，before 带首尾空白同样成立', () => {
  for (const before of ['原来的话', '  原来的话\n', '\n原来的话  ']) {
    const item = moduleOf(before, '更好的话')
    const base = makeResume(before.trim())
    const first = toggleModuleDecision(base, item, 'original', 'optimized', base)
    assert.equal(first.applied, true)
    assert.equal(first.resume.summary, '更好的话')
    const second = toggleModuleDecision(first.resume, item, 'optimized', 'original', base)
    assert.equal(second.applied, true)
    assert.equal(second.resume.summary, before.trim())
    const third = toggleModuleDecision(second.resume, item, 'original', 'optimized', base)
    assert.equal(third.applied, true)
    assert.equal(third.resume.summary, '更好的话')
  }
})

test('默认选择：A 用改写，B 和 C 保留原文，D 和 K 仍是用改写', () => {
  const plain = moduleOf('原来的话', '更好的话')
  const withDuty = moduleOf('原来的话', '更好的话由我主导')
  const absent = moduleOf('不在稿里的原文', '也不在稿里的改写')
  const note = moduleOf('原来的话', '这一段没有改动，保留原文')
  const baseOriginal = makeResume('原来的话')
  const baseRewrite = makeResume('更好的话')
  assert.equal(moduleBaseState(baseRewrite, plain).kind, 'A')
  assert.equal(moduleBaseState(baseRewrite, plain).defaultDecision, 'optimized')
  assert.equal(moduleBaseState(baseOriginal, plain).kind, 'B')
  assert.equal(moduleBaseState(baseOriginal, plain).defaultDecision, 'original')
  assert.equal(moduleBaseState(baseOriginal, withDuty).kind, 'C')
  assert.equal(moduleBaseState(baseOriginal, withDuty).defaultDecision, 'original')
  assert.equal(moduleBaseState(baseOriginal, absent).kind, 'D')
  assert.equal(moduleBaseState(baseOriginal, absent).defaultDecision, 'optimized')
  assert.equal(moduleBaseState(baseOriginal, note).kind, 'K')
  assert.equal(moduleBaseState(baseOriginal, note).defaultDecision, 'optimized')
  assert.equal(moduleBaseState(null, plain).defaultDecision, 'optimized')
})

test('B 类选了保留原文且 before 带首尾空白时，导出组装不报失败，结果仍是原文', () => {
  const before = ' \n原来的话\n '
  const item = moduleOf(before, '更好的话', '一')
  const resume = makeResume(before.trim())
  const kept = applyResumeDecisionsWithStatus(resume, [item], { 'm0:一': 'original' })
  assert.deepEqual(kept.failures, [])
  assert.equal(kept.resume.summary, before.trim())
  const unselected = applyResumeDecisionsWithStatus(resume, [item], {})
  assert.deepEqual(unselected.failures, [])
  assert.equal(unselected.resume.summary, before.trim())
  const rewritten = applyResumeDecisionsWithStatus(makeResume('更好的话'), [item], { 'm0:一': 'optimized' })
  assert.deepEqual(rewritten.failures, [])
  assert.equal(rewritten.resume.summary, '更好的话')
})

function assertSameTextStays(before, after, draftText) {
  const item = moduleOf(before, after, '同文')
  const base = makeResume(draftText)
  const key = moduleKeyOf(item, 0)
  assert.equal(moduleBaseState(base, item).kind, 'A')
  assert.equal(moduleBaseState(base, item).defaultDecision, 'optimized')
  assert.equal(isModuleSwitchable(base, item), true)
  let resume = base
  let decision = 'original'
  for (const next of ['optimized', 'original', 'optimized']) {
    const result = toggleModuleDecision(resume, item, decision, next, base)
    assert.equal(result.applied, true)
    assert.equal(result.reason, undefined)
    assert.equal(result.resume.summary, draftText)
    resume = result.resume
    decision = next
  }
  for (const [current, next] of [['optimized', 'original'], ['original', 'optimized']]) {
    const applied = applyDecisionChanges(base, [item], { [key]: current }, [[key, next]], base)
    assert.deepEqual(applied.failures, [])
    assert.equal(applied.resume.summary, draftText)
    assert.equal(applied.decisions[key], next)
  }
  const brought = compareDecisionChanges(base, [item], {}, { [key]: 'original' }, base)
  const broughtApplied = applyDecisionChanges(base, [item], {}, brought, base)
  assert.deepEqual(broughtApplied.failures, [])
  assert.equal(broughtApplied.resume.summary, draftText)
  const exported = applyResumeDecisionsWithStatus(base, [item], { [key]: 'original' })
  assert.deepEqual(exported.failures, [])
  assert.equal(exported.resume.summary, draftText)
}

test('S 类改写与原文逐字相同：来回切换、批量、对照页带回和导出组装都不改字也不失败', () => {
  const sentence = '完成门店日结并核对收银。'
  assertSameTextStays(sentence, sentence, sentence)
})

test('S 类只差首尾空白：来回切换、批量、对照页带回和导出组装都不增减空白', () => {
  const sentence = '完成门店日结并核对收银。'
  assertSameTextStays(`  ${sentence}  `, sentence, sentence)
  assertSameTextStays(`\n${sentence}\n`, sentence, sentence)
})

test('S 类原文已从编辑区删掉后再切换不算成功，正文不变', () => {
  const sentence = '完成门店日结并核对收银。'
  const removed = makeResume('本人删掉了这句')
  for (const before of [sentence, `  ${sentence}  `, `\n${sentence}\n`]) {
    const item = moduleOf(before, sentence, '同文')
    const base = makeResume(sentence)
    for (const [current, next] of [['optimized', 'original'], ['original', 'optimized']]) {
      const blocked = toggleModuleDecision(removed, item, current, next, base)
      assert.equal(blocked.applied, false)
      assert.equal(blocked.resume.summary, removed.summary)
    }
    const exported = applyResumeDecisionsWithStatus(removed, [item], { [moduleKeyOf(item, 0)]: 'original' })
    assert.deepEqual(exported.failures, [{ key: moduleKeyOf(item, 0), reason: 'edited' }])
    assert.equal(exported.resume.summary, removed.summary)
  }
})

test('K 类从对照页带回用改写或保留原文都不产生变更也不失败', () => {
  const note = '这一段没有改动，保留原文'
  const kBefore = '教育经历原文这一句。'
  const bBefore = '带领班组完成设备调试'
  const bAfter = '写清本人承担的环节与实际结果'
  const kItem = moduleOf(kBefore, note, '教育')
  const bItem = moduleOf(bBefore, bAfter, '经历')
  const modules = [kItem, bItem]
  const base = makeResume(`${kBefore}\n${bBefore}`)
  const kKey = moduleKeyOf(kItem, 0)
  const bKey = moduleKeyOf(bItem, 1)
  assert.equal(moduleBaseState(base, kItem).kind, 'K')
  assert.equal(moduleBaseState(base, bItem).kind, 'B')
  const picked = adoptEligible(buildCompareItems(modules), {}, {}, base)
  assert.equal(picked.next[kKey], undefined)
  assert.equal(picked.adopted, 1)
  assert.equal(picked.skipped, 0)
  assert.equal(picked.next[bKey], 'optimized')
  const changes = compareDecisionChanges(base, modules, {}, picked.next, base)
  assert.equal(changes.some(([key]) => key === kKey), false)
  assert.deepEqual(changes, [[bKey, 'optimized']])
  const applied = applyDecisionChanges(base, modules, {}, changes, base)
  assert.deepEqual(applied.failures, [])
  assert.equal(applied.resume.summary.includes(kBefore), true)
  assert.equal(applied.resume.summary.includes(note), false)
  assert.equal(applied.resume.summary.includes(bAfter), true)
  assert.equal(applied.resume.summary.includes(bBefore), false)
  const keptChanges = compareDecisionChanges(base, modules, {}, { [kKey]: 'original' }, base)
  assert.deepEqual(keptChanges, [])
  const kept = applyDecisionChanges(base, modules, {}, keptChanges, base)
  assert.deepEqual(kept.failures, [])
  assert.equal(kept.resume.summary, base.summary)
  assert.equal(kept.resume.summary.includes(note), false)
})

test('样本 1：对照页不确认时采纳 6 条、只跳过待确认的第 2 条，同文的第 3 条不写选择，应用后 6 条 B 换上', () => {
  const { resume, modules, sentences, afters } = sampleOne()
  const picked = adoptEligible(buildCompareItems(modules), {}, {}, resume)
  assert.equal(picked.adopted, 6)
  assert.equal(picked.skipped, 1)
  assert.notEqual(picked.next[moduleKeyOf(modules[1], 1)], 'optimized')
  assert.equal(picked.next[moduleKeyOf(modules[2], 2)], undefined)
  const changes = compareDecisionChanges(resume, modules, {}, picked.next, resume)
  const applied = applyDecisionChanges(resume, modules, {}, changes, resume)
  assert.deepEqual(applied.failures, [])
  for (const index of [0, 3, 4, 5, 6, 7]) {
    const text = fieldText(applied.resume, index)
    assert.equal(text.includes(afters[index]), true, `第 ${index + 1} 条应换上改写`)
    assert.equal(text.includes(sentences[index].trim()), false, `第 ${index + 1} 条不应再留原文`)
  }
  assert.equal(applied.resume.summary.includes(sentences[1]), true)
  assert.equal(applied.resume.summary.includes(afters[1]), false)
  assert.equal(applied.resume.experience[2].description, '无关经历，不对应任何一条建议。')
})

test('样本 1：对照页确认第 2 条全部新增事实后采纳 7 条，同文的第 3 条仍不写选择，第 2 条换上', () => {
  const { resume, modules, sentences, afters } = sampleOne()
  const second = modules[1]
  const secondKey = moduleKeyOf(second, 1)
  const additions = detectUnconfirmedTextAdditions(second.after, second.before)
  const picked = adoptEligible(buildCompareItems(modules), { [secondKey]: additions }, {}, resume)
  assert.equal(picked.adopted, 7)
  assert.equal(picked.skipped, 0)
  modules.forEach((item, index) => {
    const key = moduleKeyOf(item, index)
    if (index === 2) assert.equal(picked.next[key], undefined)
    else assert.equal(picked.next[key], 'optimized')
  })
  const changes = compareDecisionChanges(resume, modules, {}, picked.next, resume)
  const applied = applyDecisionChanges(resume, modules, {}, changes, resume)
  assert.deepEqual(applied.failures, [])
  const secondText = fieldText(applied.resume, 1)
  assert.equal(secondText.includes(afters[1]), true)
  assert.equal(secondText.includes(sentences[1].trim()), false)
  for (const index of [0, 3, 4, 5, 6, 7]) {
    const text = fieldText(applied.resume, index)
    assert.equal(text.includes(afters[index]), true, `第 ${index + 1} 条应换上改写`)
    assert.equal(text.includes(sentences[index].trim()), false, `第 ${index + 1} 条不应再留原文`)
  }
  assert.equal(applied.resume.experience[2].description, '无关经历，不对应任何一条建议。')
})

const F7_BEFORE_1 = '负责学院公众号的选题和排版。'
const F7_AFTER_1 = '负责学院公众号的选题和排版，协助组织迎新志愿服务。'
const F7_BEFORE_2 = '协助组织迎新志愿服务。'
const F7_AFTER_2 = '协助完成迎新志愿服务的签到。'
const F7_BASE_TEXT = `${F7_BEFORE_1}${F7_BEFORE_2}`
const F7_BOTH_TEXT = `${F7_AFTER_1}${F7_AFTER_2}`

function f7Modules() {
  return [moduleOf(F7_BEFORE_1, F7_AFTER_1, '公众号'), moduleOf(F7_BEFORE_2, F7_AFTER_2, '迎新')]
}

function f7Changes(modules, next) {
  return modules.map((item, index) => [moduleKeyOf(item, index), next])
}

function toggleInOrder(resume, modules, decisions, base, order, next) {
  let currentResume = resume
  let currentDecisions = { ...decisions }
  const failures = []
  for (const index of order) {
    const item = modules[index]
    const key = moduleKeyOf(item, index)
    const current = currentDecisions[key] ?? defaultModuleDecision(base, item)
    const result = toggleModuleDecision(currentResume, item, current, next, base, {
      modules, decisions: currentDecisions, index,
    })
    currentResume = result.resume
    if (result.applied) currentDecisions = { ...currentDecisions, [key]: next }
    else if (result.reason) failures.push({ key, reason: result.reason })
  }
  return { resume: currentResume, decisions: currentDecisions, failures }
}

test('F7：前一条改写含有后一条原句时，两条都换在自己原来的位置', () => {
  assert.equal(F7_AFTER_1.includes(F7_BEFORE_2), true)
  const modules = f7Modules()
  const base = makeResume(F7_BASE_TEXT)
  assert.equal(moduleBaseState(base, modules[0]).kind, 'B')
  assert.equal(moduleBaseState(base, modules[1]).kind, 'B')
  const batched = applyDecisionChanges(base, modules, {}, f7Changes(modules, 'optimized'), base)
  assert.deepEqual(batched.failures, [])
  assert.equal(batched.resume.summary, F7_BOTH_TEXT)
  for (const order of [[0, 1], [1, 0]]) {
    const stepped = toggleInOrder(base, modules, {}, base, order, 'optimized')
    assert.deepEqual(stepped.failures, [], `顺序 ${order.join('→')} 不应失败`)
    assert.equal(stepped.resume.summary, F7_BOTH_TEXT, `顺序 ${order.join('→')} 应与批量相同`)
    const back = toggleInOrder(stepped.resume, modules, stepped.decisions, base, order, 'original')
    assert.deepEqual(back.failures, [], `切回顺序 ${order.join('→')} 不应失败`)
    assert.equal(back.resume.summary, F7_BASE_TEXT)
  }
  const batchedBack = applyDecisionChanges(
    batched.resume, modules, batched.decisions, f7Changes(modules, 'original'), base,
  )
  assert.deepEqual(batchedBack.failures, [])
  assert.equal(batchedBack.resume.summary, F7_BASE_TEXT)
})

test('F7：编辑区另有一处相同原句、且不在任何条目占着的文字里时不换', () => {
  const modules = f7Modules()
  const base = makeResume(F7_BASE_TEXT)
  const edited = makeResume(`${F7_BASE_TEXT}${F7_BEFORE_2}`)
  const result = toggleModuleDecision(edited, modules[1], 'original', 'optimized', base, {
    modules, decisions: {}, index: 1,
  })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'edited')
  assert.equal(result.resume.summary, edited.summary)
  const batched = applyDecisionChanges(edited, modules, {}, [[moduleKeyOf(modules[1], 1), 'optimized']], base)
  assert.deepEqual(batched.failures, [{ key: moduleKeyOf(modules[1], 1), reason: 'edited' }])
  assert.equal(batched.resume.summary, edited.summary)
})

test('F7：前一条换上后把后一条原句吃掉时，后一条不换、也不改前一条的改写', () => {
  const before1 = '负责活动物料清点，并完成签到统计。'
  const after1 = '已完成活动物料清点，并完成签到统计。'
  const before2 = '并完成签到统计。'
  const after2 = '签到统计已核对。'
  assert.equal(before1.includes(before2), true)
  assert.equal(after1.includes(before2), true)
  const modules = [moduleOf(before1, after1, '物料'), moduleOf(before2, after2, '签到')]
  const base = makeResume(before1)
  assert.equal(moduleBaseState(base, modules[0]).kind, 'B')
  assert.equal(moduleBaseState(base, modules[1]).kind, 'B')
  const applied = applyDecisionChanges(base, modules, {}, f7Changes(modules, 'optimized'), base)
  assert.deepEqual(applied.failures, [{ key: moduleKeyOf(modules[1], 1), reason: 'edited' }])
  assert.equal(applied.resume.summary, after1)
  assert.equal(applied.resume.summary.includes(after2), false)
  assert.equal(applied.resume.summary.includes(before2), true)
  assert.equal(applied.decisions[moduleKeyOf(modules[0], 0)], 'optimized')
  assert.notEqual(applied.decisions[moduleKeyOf(modules[1], 1)], 'optimized')
})

test('K 类和同文条目是无需操作，其余不是', () => {
  const note = '这一段没有改动，保留原文'
  assert.equal(isNoActionModule(moduleOf('教育经历原文这一句。', note, '教育')), true)
  assert.equal(isNoActionModule(moduleOf('', note, '空原文')), true)
  assert.equal(isNoActionModule(moduleOf('完成门店日结并核对收银。', '完成门店日结并核对收银。', '同文')), true)
  assert.equal(isNoActionModule(moduleOf('  完成门店日结并核对收银。  ', '完成门店日结并核对收银。', '只差空白')), true)
  assert.equal(isNoActionModule(moduleOf('\n完成门店日结并核对收银。\n', '完成门店日结并核对收银。', '只差换行')), true)
  assert.equal(isNoActionModule(moduleOf('原来的话', '更好的话', '改写')), false)
  assert.equal(isNoActionModule(moduleOf('原来的话', '', '空改写')), false)
  assert.equal(isNoActionModule(moduleOf('原来的话', '原来的话。', '多了句号')), false)
  const base = makeResume('原来的话')
  assert.equal(moduleBaseState(base, moduleOf('原来的话', '更好的话')).kind, 'B')
  assert.equal(isNoActionModule(moduleOf('原来的话', '更好的话')), false)
})

test('去编辑区改这一条：同一句出现多处停在第一栏，没有就返回空', () => {
  const sentence = '维护学院官网的栏目内容和活动通知。'
  const resume = {
    ...makeResume('简介里没有这句'),
    education: [{ school: '山东财经大学', major: '新闻学', description: '课程作业另写。' }],
    experience: [job(sentence), job(`前缀${sentence}后缀`)],
    projects: [{ name: '迎新', role: '', description: sentence }],
    skills: [sentence],
  }
  assert.deepEqual(findResumeOriginalField(resume, sentence), { fieldId: 'experience-0-description', start: 0 })
  assert.deepEqual(findResumeOriginalField(resume, `  ${sentence}  `), { fieldId: 'experience-0-description', start: 0 })
  assert.deepEqual(findResumeOriginalField(resume, '没有这句'), { fieldId: 'summary', start: 3 })
  assert.equal(findResumeOriginalField(resume, '稿里根本没有的句子'), null)
  assert.equal(findResumeOriginalField(resume, '   '), null)
  assert.equal(findResumeOriginalField(resume, ''), null)
  const projectOnly = {
    ...makeResume('简介另写'),
    projects: [{ name: '只在项目名称里的原句', role: '只在项目角色里的原句', description: '描述另写。' }],
  }
  assert.deepEqual(findResumeOriginalField(projectOnly, '只在项目名称里的原句'), { fieldId: 'projects-0-name', start: 0 })
  assert.deepEqual(findResumeOriginalField(projectOnly, '只在项目角色里的原句'), { fieldId: 'projects-0-role', start: 0 })
})

test('总览手改行在摘录后保留句号', () => {
  const { optimizeManualOriginalLine } = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/optimizeOverviewCopy.ts')).exports
  assert.equal(optimizeManualOriginalLine('完成门店日结并核对收银。'), '原文：完成门店日结并核对收银。这一条只能在编辑区里改。')
  assert.equal(optimizeManualOriginalLine('完成门店日结并核对收银'), '原文：完成门店日结并核对收银。这一条只能在编辑区里改。')
  assert.equal(optimizeManualOriginalLine('完成门店日结。。'), '原文：完成门店日结。这一条只能在编辑区里改。')
  assert.equal(optimizeManualOriginalLine(''), '原文：这一条没有留下原句。这一条只能在编辑区里改。')
  assert.equal(optimizeManualOriginalLine('完成门店日结。', ' 待确认：负责'), '原文：完成门店日结。这一条只能在编辑区里改。 待确认：负责')
})

test('对照页逐条序号跳过无需操作条目，focusIndex 按原序号映射', () => {
  const keep = moduleOf('教育经历原文这一句。', '这一段没有改动，保留原文', '教育')
  const same = moduleOf('协助整理学院公众号的选题目录和排版稿。', '  协助整理学院公众号的选题目录和排版稿。\n', '公众号')
  const manual = moduleOf('参与迎新志愿服务，协助新生报到和答疑。', '在迎新志愿服务中协助新生完成报到和答疑。', '迎新')
  const first = moduleOf('维护学院官网的栏目内容和活动通知。', '把学院官网的栏目内容和活动通知写得更清楚。', '官网')
  const second = moduleOf('整理招聘会的签到表和展位资料。', '把招聘会的签到表和展位资料按场次归档。', '招聘会')
  const modules = [keep, same, manual, first, second]
  assert.deepEqual(visibleCompareIndices(modules), [2, 3, 4])
  assert.equal(focusToVisiblePosition(modules, 0), 0)
  assert.equal(focusToVisiblePosition(modules, 1), 0)
  assert.equal(focusToVisiblePosition(modules, 2), 0)
  assert.equal(focusToVisiblePosition(modules, 3), 1)
  assert.equal(focusToVisiblePosition(modules, 4), 2)
  assert.equal(focusToVisiblePosition(modules, 9), 2)
  assert.equal(focusToVisiblePosition([], 0), 0)
})

test('可采纳的全部采纳跳过换不上的条目，skipped 把它们计进去，不为无需操作写选择', () => {
  const keep = moduleOf('教育经历原文这一句。', '这一段没有改动，保留原文', '教育')
  const same = moduleOf('协助整理学院公众号的选题目录和排版稿。', '协助整理学院公众号的选题目录和排版稿。', '公众号')
  const manualBefore = '参与迎新志愿服务，协助新生报到和答疑。'
  const manual = moduleOf(manualBefore, '在迎新志愿服务中协助新生完成报到和答疑。', '迎新')
  const first = moduleOf('维护学院官网的栏目内容和活动通知。', '把学院官网的栏目内容和活动通知写得更清楚。', '官网')
  const second = moduleOf('整理招聘会的签到表和展位资料。', '把招聘会的签到表和展位资料按场次归档。', '招聘会')
  const modules = [keep, same, manual, first, second]
  const base = {
    ...makeResume(`${keep.before}\n${same.before}\n${first.before}`),
    experience: [job(manualBefore), job(second.before)],
    projects: [{ name: '迎新', role: '', description: manualBefore }],
  }
  assert.equal(moduleBaseState(base, manual).kind, 'D')
  assert.equal(moduleBaseState(base, first).kind, 'B')
  assert.equal(moduleBaseState(base, second).kind, 'B')
  const visible = buildCompareItems(modules).filter((item) => !isNoActionModule(item))
  assert.deepEqual(visible.map((item) => item.sourceIndex), [2, 3, 4])
  const picked = adoptEligible(visible, {}, {}, base)
  assert.equal(picked.adopted, 2)
  assert.equal(picked.skipped, 1)
  assert.equal(picked.skippedFacts, 0)
  assert.equal(picked.skippedManual, 1)
  assert.equal(picked.next[moduleKeyOf(manual, 2)], undefined)
  assert.equal(picked.next[moduleKeyOf(first, 3)], 'optimized')
  assert.equal(picked.next[moduleKeyOf(second, 4)], 'optimized')
  assert.equal(picked.next[moduleKeyOf(keep, 0)], undefined)
  assert.equal(picked.next[moduleKeyOf(same, 1)], undefined)
  const all = adoptEligible(buildCompareItems(modules), {}, {}, base)
  assert.equal(all.adopted, 2)
  assert.equal(all.skipped, 1)
  assert.equal(all.skippedFacts, 0)
  assert.equal(all.skippedManual, 1)
  assert.equal(all.next[moduleKeyOf(keep, 0)], undefined)
  assert.equal(all.next[moduleKeyOf(same, 1)], undefined)
})

test('编辑区简介和描述上限与导出稿相同，输入时不再截成 600 或 1000', () => {
  const limits = readFileSync(join(kioskRoot, '../../services/api/src/ai/resume/resume-doc-limits.ts'), 'utf8')
  const summary = Number(limits.match(/summary:\s*(\d+)/)?.[1])
  const description = Number(limits.match(/description:\s*(\d+)/)?.[1])
  assert.equal(summary, 24000)
  assert.equal(description, 24000)
  assert.equal(RESUME_EDIT_LIMITS.summary, summary)
  assert.equal(RESUME_EDIT_LIMITS.description, description)
  for (const rel of [
    'src/pages/resume/components/OptimizedResumeEditor.tsx',
    'src/pages/resume/components/resume-deliver/GenerateResumeEditor.tsx',
  ]) {
    const source = readFileSync(join(kioskRoot, rel), 'utf8')
    assert.equal(/slice\(\s*0\s*,\s*600\s*\)/.test(source), false, `${rel} 仍在把简介截成 600`)
    assert.equal(/slice\(\s*0\s*,\s*1000\s*\)/.test(source), false, `${rel} 仍在把描述截成 1000`)
    assert.equal(source.includes('maxLength={RESUME_EDIT_LIMITS.summary}'), true, rel)
    assert.equal(source.includes('maxLength={RESUME_EDIT_LIMITS.description}'), true, rel)
  }
})

test('选保留原文的条目占着它的原句，另一条从改写换回原文时只换自己那一处', () => {
  // 第 j 条（下标 0）选择保留原文，原句里逐字含有第 i 条（下标 1）的改写。
  // 稿里因此有两处改写：嵌在第 j 条原句里的那处在前，第 i 条自己的那处在后。
  // 保留原文必须占住原句，嵌在里面的那处才被剔除，只剩第 i 条自己那一处可换。
  // 不占的话两处都可换，恰好一处不成立，整段保持不动；按第一处换则会改到第 j 条的原句里。
  const afterI = '核对每周的活动通知。'
  const beforeI = '整理每周的活动通知。'
  const beforeJ = `在宣传栏张贴${afterI}`
  const afterJ = '在宣传栏张贴每周的活动安排。'
  const itemJ = moduleOf(beforeJ, afterJ, '宣传栏')
  const itemI = moduleOf(beforeI, afterI, '活动通知')
  const modules = [itemJ, itemI]
  const base = makeResume(beforeI)
  const current = makeResume(`${beforeJ}${afterI}`)
  assert.equal(beforeJ.includes(afterI), true)
  assert.equal(moduleBaseState(base, itemI).kind, 'B')
  assert.equal(current.summary.indexOf(afterI), beforeJ.indexOf(afterI))
  assert.notEqual(current.summary.indexOf(afterI), beforeJ.length)
  assert.equal(current.summary.indexOf(afterI, beforeJ.indexOf(afterI) + 1), beforeJ.length)
  const result = toggleModuleDecision(current, itemI, 'optimized', 'original', base, {
    modules,
    decisions: { [moduleKeyOf(itemJ, 0)]: 'original', [moduleKeyOf(itemI, 1)]: 'optimized' },
    index: 1,
  })
  assert.equal(result.applied, true)
  assert.equal(result.reason, undefined)
  assert.equal(result.resume.summary, `${beforeJ}${beforeI}`)
})

test('A 类换回原文只换自己那一处，自己那处被改掉后不再动别人占着的改写', () => {
  // 第 i 条是 A 类：改写已经在基准稿里，而且出现两处。
  // 一处嵌在第 j 条占着的改写里（在前），一处是第 i 条自己的位置（在后）。
  // 有上下文时只换自己那一处。自己那一处被本人改掉后，只剩别人占着的那处，报 edited，正文不动。
  const afterI = '维护学院官网的栏目和活动通知。'
  const beforeI = '更新学院官网的栏目和活动通知。'
  const afterJ = `在新媒体中心${afterI}`
  const beforeJ = '在新媒体中心更新网页。'
  const itemJ = moduleOf(beforeJ, afterJ, '新媒体')
  const itemI = moduleOf(beforeI, afterI, '官网')
  const modules = [itemJ, itemI]
  const field = `${afterJ}${afterI}`
  const base = makeResume(field)
  assert.equal(afterJ.includes(afterI), true)
  assert.equal(moduleBaseState(base, itemI).kind, 'A')
  assert.equal(field.indexOf(afterI), '在新媒体中心'.length)
  assert.equal(field.lastIndexOf(afterI), afterJ.length)
  const context = {
    modules,
    decisions: {
      [moduleKeyOf(itemJ, 0)]: 'optimized',
      [moduleKeyOf(itemI, 1)]: 'optimized',
    },
    index: 1,
  }
  const restored = toggleModuleDecision(base, itemI, 'optimized', 'original', base, context)
  assert.equal(restored.applied, true)
  assert.equal(restored.reason, undefined)
  assert.equal(restored.resume.summary, `${afterJ}${beforeI}`)
  const edited = makeResume(afterJ)
  const blocked = toggleModuleDecision(edited, itemI, 'optimized', 'original', base, context)
  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'edited')
  assert.equal(blocked.resume.summary, afterJ)
})

test('目标文字重叠出现两次时不算恰好一处，正文不动', () => {
  // 「ABA」在「ABABA」里从第 0 字和第 2 字各出现一次，两处互相重叠。
  // 从上一处末尾接着找只会数到第 0 字，误当成恰好一处，把开头三个字换成改写。
  const needle = 'ABA'
  const item = moduleOf(needle, '已改写')
  const base = makeResume(`前缀${needle}后缀`)
  const edited = makeResume('ABABA')
  assert.equal(moduleBaseState(base, item).kind, 'B')
  const result = toggleModuleDecision(edited, item, 'original', 'optimized', base, {
    modules: [item], decisions: {}, index: 0,
  })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'edited')
  assert.equal(result.resume.summary, 'ABABA')
})

test('前一条整句包住后一条原句、改写又不再含这句时，后一条换不上且不改前一条的改写', () => {
  // 第 1 条原句是「A，B。」，整句包住第 2 条原句「B。」。
  // 包住较短原句时第 1 条仍可换；换成不含「B。」的改写后，第 2 条的原句已经不在稿里。
  // 必须报 edited、正文保持第 1 条的改写，不能到那句改写里面去找地方换。
  const before1 = '核对门店日结，并登记晚班台账。'
  const before2 = '并登记晚班台账。'
  const after1 = '门店日结已核对完毕。'
  const after2 = '晚班台账已登记。'
  assert.equal(before1.includes(before2), true)
  assert.equal(after1.includes(before2), false)
  const modules = [moduleOf(before1, after1, '日结'), moduleOf(before2, after2, '台账')]
  const base = makeResume(before1)
  assert.equal(moduleBaseState(base, modules[0]).kind, 'B')
  assert.equal(moduleBaseState(base, modules[1]).kind, 'B')
  const first = toggleModuleDecision(base, modules[0], 'original', 'optimized', base, {
    modules, decisions: {}, index: 0,
  })
  assert.equal(first.applied, true)
  assert.equal(first.resume.summary, after1)
  const second = toggleModuleDecision(first.resume, modules[1], 'original', 'optimized', base, {
    modules,
    decisions: { [moduleKeyOf(modules[0], 0)]: 'optimized' },
    index: 1,
  })
  assert.equal(second.applied, false)
  assert.equal(second.reason, 'edited')
  assert.equal(second.resume.summary, after1)
  assert.equal(second.resume.summary.includes(after2), false)
})

test('没有基准稿时两个方向都不猜，不传上下文也不换第一处', () => {
  // 没有基准稿分不出这一条占哪一段。两处都没人占时不能挑前面那处。
  // 旧调用不传上下文，也按完整位置表判断：宁可退回手改，绝不换错字。
  const item = moduleOf('原来的话', '更好的话')
  const resume = makeResume('更好的话，更好的话')
  assert.equal(moduleBaseState(null, item).kind, 'unloaded')
  const blocked = toggleModuleDecision(resume, item, 'optimized', 'original', null, {
    modules: [item], decisions: {}, index: 0,
  })
  assert.equal(blocked.applied, false)
  assert.equal(blocked.reason, 'edited')
  assert.equal(blocked.resume.summary, '更好的话，更好的话')
  const legacy = toggleModuleDecision(resume, item, 'optimized', 'original')
  assert.equal(legacy.applied, false)
  assert.equal(legacy.reason, 'edited')
  assert.equal(legacy.resume.summary, '更好的话，更好的话')
  const forward = toggleModuleDecision(makeResume('原来的话'), item, 'original', 'optimized')
  assert.equal(forward.applied, false)
  assert.equal(forward.reason, 'edited')
  assert.equal(forward.resume.summary, '原来的话')
})

test('没有基准稿时即使能剔出恰好一处也不换', () => {
  // 与 A 类同一布局，只是没有基准稿：前面那处在第 j 条占着的改写里，后面那处才是第 i 条自己的。
  // 上一包这里期望换上后面那处。没有基准稿时不再猜，报 edited，正文保持原样。
  const afterI = '维护学院官网的栏目和活动通知。'
  const beforeI = '更新学院官网的栏目和活动通知。'
  const afterJ = `在新媒体中心${afterI}`
  const itemJ = moduleOf('在新媒体中心更新网页。', afterJ, '新媒体')
  const itemI = moduleOf(beforeI, afterI, '官网')
  const modules = [itemJ, itemI]
  const field = `${afterJ}${afterI}`
  const resume = makeResume(field)
  assert.equal(moduleBaseState(null, itemI).kind, 'unloaded')
  const result = toggleModuleDecision(resume, itemI, 'optimized', 'original', null, {
    modules,
    decisions: {
      [moduleKeyOf(itemJ, 0)]: 'optimized',
      [moduleKeyOf(itemI, 1)]: 'optimized',
    },
    index: 1,
  })
  assert.equal(result.applied, false)
  assert.equal(result.reason, 'edited')
  assert.equal(result.resume.summary, field)
})

test('A 类从保留原文切回用改写时也只换自己那一处', () => {
  // 有基准稿、有上下文。前面那处嵌在第 j 条占着的原文里，后面那处才是第 i 条自己的原句。
  // 切回用改写必须剔除别人占着的文字，恰好一处才换。按第一处换会改到第 j 条的原文。
  const beforeI = '整理每周的活动通知。'
  const afterI = '核对每周的活动通知。'
  const beforeJ = `值班时${beforeI}`
  const itemJ = moduleOf(beforeJ, '值班时核对排班。', '值班')
  const itemI = moduleOf(beforeI, afterI, '活动通知')
  const modules = [itemJ, itemI]
  const current = makeResume(`${beforeJ}${beforeI}`)
  const base = makeResume(afterI)
  assert.equal(beforeJ.includes(beforeI), true)
  assert.equal(moduleBaseState(base, itemI).kind, 'A')
  const result = toggleModuleDecision(current, itemI, 'original', 'optimized', base, {
    modules,
    decisions: { [moduleKeyOf(itemJ, 0)]: 'original' },
    index: 1,
  })
  assert.equal(result.applied, true)
  assert.equal(result.resume.summary, `${beforeJ}${afterI}`)
})

test('批量提示只因事实跳过时保持原句，有只能手改时改用括号里那句', () => {
  const factsOnly = '已采纳 1 条；跳过 1 条 —— 那几条的改写里有原文没有的事实，要逐项确认后才能采纳。批量动作不会绕过这道拦截。'
  const withManual = '已采纳 2 条；跳过 1 条（有待确认事实、只能手改的那几条）。'
  assert.equal(adoptEligibleBatchNote({ adopted: 1, skipped: 1, skippedManual: 0 }), factsOnly)
  assert.equal(adoptEligibleBatchNote({ adopted: 2, skipped: 1, skippedManual: 1 }), withManual)
  assert.equal(adoptEligibleBatchNote({ adopted: 0, skipped: 2, skippedManual: 2 }), '已采纳 0 条；跳过 2 条（有待确认事实、只能手改的那几条）。')
})

test('两段相似经历只换屏上选定的那一段，导出不改另一段', () => {
  const beforeA = '主要负责门店排班和订货。'
  const afterA = '负责门店排班和订货。'
  const afterB = '协助店长负责门店排班和订货。'
  const itemA = moduleOf(beforeA, afterA, '甲店')
  const job = (description) => ({ company: '门店', role: '店员', period: '', description })
  const already = {
    ...makeResume(''),
    experience: [job(beforeA), job(afterB)],
  }
  const key = moduleKeyOf(itemA, 0)
  const kept = applyResumeDecisionsWithStatus(already, [itemA], { [key]: 'original' })
  assert.equal(kept.resume.experience[0].description, beforeA)
  assert.equal(kept.resume.experience[1].description, afterB)
  assert.equal(kept.resume.experience[1].description.includes('主要主要'), false)
  assert.deepEqual(kept.failures, [])
  const stillRewrite = {
    ...makeResume(''),
    experience: [job(afterA), job(afterB)],
  }
  const switched = applyResumeDecisionsWithStatus(stillRewrite, [itemA], { [key]: 'original' })
  assert.equal(switched.resume.experience[0].description, beforeA)
  assert.equal(switched.resume.experience[1].description, afterB)
  assert.equal(switched.resume.experience[1].description.includes('主要'), false)
  assert.deepEqual(switched.failures, [])
})

test('K8 技能整句改写配了 module 时一体机判为可切换', () => {
  const before = '熟练使用 Excel、Word、PPT'
  const after = '精通 Excel、Word、PowerPoint 办公软件'
  const item = moduleOf(before, after, '专业技能')
  const base = { ...makeResume(''), skills: [after] }
  assert.equal(moduleBaseState(base, item).kind, 'A')
  assert.equal(moduleSwitchBlock(base, item), null)
  const toggled = toggleModuleDecision(base, item, 'optimized', 'original', base, {
    modules: [item], decisions: {}, index: 0,
  })
  assert.equal(toggled.applied, true)
  assert.deepEqual(toggled.resume.skills, [before])
})
