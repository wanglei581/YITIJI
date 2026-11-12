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
const { buildCompareItems, adoptEligible, visibleCompareIndices, focusToVisiblePosition } = compareModule.exports
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
  assert.equal(picked.next[moduleKeyOf(manual, 2)], undefined)
  assert.equal(picked.next[moduleKeyOf(first, 3)], 'optimized')
  assert.equal(picked.next[moduleKeyOf(second, 4)], 'optimized')
  assert.equal(picked.next[moduleKeyOf(keep, 0)], undefined)
  assert.equal(picked.next[moduleKeyOf(same, 1)], undefined)
  const all = adoptEligible(buildCompareItems(modules), {}, {}, base)
  assert.equal(all.adopted, 2)
  assert.equal(all.skipped, 1)
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
