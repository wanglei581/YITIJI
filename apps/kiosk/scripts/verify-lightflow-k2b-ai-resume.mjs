import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => {
  const absolutePath = join(kioskRoot, relativePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

let failures = 0

function expect(condition, message) {
  if (condition) console.log(`PASS ${message}`)
  else {
    failures += 1
    console.error(`FAIL ${message}`)
  }
}

function expectIncludes(source, marker, message) {
  expect(source.includes(marker), `${message}${source.includes(marker) ? '' : ` — missing ${marker}`}`)
}

function expectNotIncludes(source, marker, message) {
  expect(!source.includes(marker), `${message}${source.includes(marker) ? ` — unexpected ${marker}` : ''}`)
}

function expectCssContract(path, routeRoots) {
  const source = read(path)
  const lines = source.split(/\r?\n/).length
  expect(source.length > 0, `${path} exists`)
  expect(lines < 300, `${path} stays below 300 lines`)
  expectIncludes(source, '.resume-lightflow', `${path} scopes styles to resume-lightflow`)
  expectIncludes(source, '@media (prefers-reduced-motion: reduce)', `${path} supports reduced motion`)
  for (const routeRoot of routeRoots) {
    expectIncludes(source, `.${routeRoot}`, `${path} scopes styles to ${routeRoot}`)
  }
  expect(
    /:is\([^)]*\)(?:\.resume-lightflow|:where\(\.resume-lightflow\))/.test(source),
    `${path} binds the shared namespace to its route root on the same element`,
  )
  expect(
    !/^\s*\.resume-lightflow(?:__|\s|\{|:)/m.test(source),
    `${path} never starts a selector from the shared resume-lightflow namespace`,
  )
  for (const forbiddenSelector of ['html', 'body', ':root']) {
    expectNotIncludes(source, `${forbiddenSelector} {`, `${path} does not override ${forbiddenSelector}`)
  }
}

console.log('\n=== K2b AI 简历青序 LightFlow 静态合同 ===')

const packageJson = read('package.json')
const ciWorkflow = read('../../.github/workflows/ci.yml')
const kioskShell = read('src/layouts/KioskRoot.tsx')
const source = read('src/pages/resume/ResumeSourcePage.tsx')
const parse = read('src/pages/resume/ResumeParsePage.tsx')
const report = read('src/pages/resume/ResumeReportPage.tsx')
const generate = read('src/pages/resume/ResumeGeneratePage.tsx')
const preview = read('src/pages/resume/ResumeGeneratePreviewPage.tsx')
const optimize = read('src/pages/resume/ResumeOptimizePage.tsx')
const templates = read('src/pages/resume/ResumeTemplateLibraryPage.tsx')
const materials = read('src/pages/resume/JobMaterialLibraryPage.tsx')

expectIncludes(
  packageJson,
  '"verify:lightflow-k2b-ai-resume": "node scripts/verify-lightflow-k2b-ai-resume.mjs"',
  'package registers the K2b visual contract',
)
expectIncludes(
  ciWorkflow,
  'pnpm --filter @ai-job-print/kiosk verify:lightflow-k2b-ai-resume',
  'CI runs the K2b visual contract',
)
expectIncludes(
  ciWorkflow,
  'pnpm --filter @ai-job-print/kiosk verify:resume-diagnosis-flow-ui',
  'CI runs the real resume diagnosis and print URL contract',
)
expectIncludes(
  ciWorkflow,
  'pnpm --filter @ai-job-print/kiosk verify:job-material-library-ui',
  'CI runs the resume and job material routing contract',
)

expectIncludes(kioskShell, 'visualTheme="service-desk"', 'Kiosk shell uses unified service-desk theme')
expectIncludes(kioskShell, 'presentation="fusion-youth"', 'Kiosk shell uses unified fusion-youth presentation')
expectNotIncludes(kioskShell, 'SERVICE_DESK_EXACT_ROUTES', 'Kiosk shell removes exact LightFlow route whitelist fork')
expectNotIncludes(kioskShell, "startsWith('/resume')", 'Kiosk shell never broad-matches resume routes')

for (const [page, sourceCode, rootClass, cssPath] of [
  // 稿 21-resume-triage 迁入青序流光（2026-09-23）：两页共用本工作台的 Qx 根类与样式。
  ['source', source, 'qx-resume-triage', './resume-triage-qx.css'],
  ['parse', parse, 'qx-resume-triage', './resume-triage-qx.css'],
  ['generate', generate, 'qx-resume-generate', './resume-generate-qx.css'],
  ['generate preview', preview, 'qx-resume-generate', './resume-generate-qx.css'],
  ['optimize', optimize, 'qx-resume-optimize', './resume-optimize-qx.css'],
  // 2026-09-23 版式参考迁入青序流光（稿 46 ?screen=templates），根作用域换成宿主 46 的 .rdq- 样式。
  ['templates', templates, 'rdq-tpl-grid', './resume-decision-qx.css'],
  // 2026-09-23 求职材料库迁入青序流光（稿 25-material-workshop），根作用域换成本页的 Qx 根类与样式。
  ['materials', materials, 'qx-resume-materials', './resume-materials-qx.css'],
]) {
  expectIncludes(sourceCode, `import '${cssPath}'`, `${page} imports its local LightFlow CSS`)
  expectIncludes(sourceCode, rootClass, `${page} uses its route-specific LightFlow root`)
  if (!rootClass.startsWith('qx-') && !rootClass.startsWith('rdq-')) {
    expectIncludes(sourceCode, 'resume-lightflow', `${page} uses shared local LightFlow namespace`)
  }
}

for (const [page, sourceCode, route] of [['source', source, '/resume/source'], ['parse', parse, '/resume/parse']]) {
  expectIncludes(sourceCode, 'QxPageFrame', `${page} uses Qingxu page frame (21-resume-triage migration)`)
  expectIncludes(kioskShell, `'${route}'`, `${page} is registered in QX_MIGRATED_ROUTES`)
  expectNotIncludes(sourceCode, 'KioskPageFrame', `${page} no longer mounts the old LightFlow page frame`)
  expectNotIncludes(sourceCode, 'resume-lightflow', `${page} no longer mixes the LightFlow namespace into the Qingxu frame`)
}
expectIncludes(report, "import './resume-report-qx.css'", 'report imports Qingxu page CSS')
expectIncludes(report, 'QxPageFrame', 'report uses Qingxu page frame (22-resume-report migration)')
expectIncludes(kioskShell, "'/resume/report'", 'report is registered in QX_MIGRATED_ROUTES')
expectIncludes(templates, 'QxPageFrame', 'templates uses Qingxu page frame (46-resume-decision-workspace migration)')
expectIncludes(kioskShell, "'/resume/templates'", 'templates is registered in QX_MIGRATED_ROUTES')
expectNotIncludes(templates, 'KioskStageFit', 'templates stays inside the KioskRoot stage instead of scaling twice')
expectNotIncludes(templates, 'resume-lightflow', 'templates no longer mixes the LightFlow namespace into the Qingxu frame')
expectIncludes(materials, 'QxPageFrame', 'materials uses Qingxu page frame (25-material-workshop migration)')
expectIncludes(kioskShell, "'/resume/materials'", 'materials is registered in QX_MIGRATED_ROUTES')
expectNotIncludes(materials, 'KioskPageFrame', 'materials no longer mounts the old LightFlow page frame')
expectNotIncludes(materials, 'resume-lightflow', 'materials no longer mixes the LightFlow namespace into the Qingxu frame')

expectCssContract('src/pages/resume/resume-diagnosis-lightflow.css', [
  'resume-source-lightflow',
  'resume-parse-lightflow',
  'resume-report-lightflow',
])
expectCssContract('src/pages/resume/resume-authoring-lightflow.css', [
  'resume-generate-lightflow',
  'resume-generate-preview-lightflow',
  'resume-optimize-lightflow',
])
for (const [path, rootClass] of [
  ['src/pages/resume/resume-optimize-qx.css', 'qx-resume-optimize'],
  ['src/pages/resume/resume-generate-qx.css', 'qx-resume-generate'],
  ['src/pages/resume/resume-triage-qx.css', 'qx-resume-triage'],
  // 稿 21 子面板换装（诊断方向 / U 盘 / 手机扫码 / 预览 / 扫描交接），同一作用域根。
  ['src/pages/resume/resume-triage-panels-qx.css', 'qx-resume-triage'],
  ['src/pages/resume/resume-materials-qx.css', 'qx-resume-materials'],
]) {
  const source = read(path)
  expect(source.length > 0, `${path} exists`)
  expect(source.split(/\r?\n/).length < 300, `${path} stays below 300 lines`)
  expectIncludes(source, `.${rootClass}`, `${path} scopes styles to ${rootClass}`)
  expectIncludes(source, '@media (prefers-reduced-motion: reduce)', `${path} supports reduced motion`)
  expectIncludes(source, '--qx-', `${path} consumes Qingxu tokens`)
  expectNotIncludes(source, 'html {', `${path} does not override html`)
  expectNotIncludes(source, 'body {', `${path} does not override body`)
}
expectCssContract('src/pages/resume/resume-library-lightflow.css', [
  'resume-templates-lightflow',
  'resume-materials-lightflow',
  'resume-export-lightflow',
])

for (const [sourceCode, marker, label] of [
  [source, 'const sourceBusy = uploading || phoneBusy || usbBusy', 'source combines every upload channel into one busy state'],
  [source, 'useBusyLock(sourceBusy)', 'source keeps the combined upload busy lock'],
  [source, 'UploadSessionQrPanel', 'source keeps phone upload session'],
  [parse, 'submitResumeParse(', 'parse keeps real resume parse request'],
  [parse, 'saveAiResumeSession({ taskId: result.taskId, accessToken: result.accessToken })', 'parse keeps minimal session only'],
  [report, 'getResumeRecord(taskId, { token: getToken(), accessToken })', 'report keeps token-gated record read'],
  [report, "navigate('/resume/optimize'", 'report keeps optimize handoff'],
  [generate, 'useBusyLock(generating || exportingDraft)', 'generate keeps busy lock (含 ai-down 草稿导出)'],
  [generate, 'submitResumeGenerate(input, getToken())', 'generate keeps wrapper submission'],
  [preview, 'exportGeneratedResume(resume, result.taskId, getToken()', 'preview keeps real export wrapper'],
  [preview, 'exported?.printFileUrl', 'preview only enables real print URL'],
  [optimize, 'confirmLeave', 'optimize keeps dirty-leave guard'],
  [optimize, 'useBusyLock(exporting || printNavigating || Boolean(adjusting))', 'optimize keeps busy lock'],
  [optimize, 'exported?.printFileUrl', 'optimize only enables real print URL'],
  [templates, 'getResumeTemplates()', 'templates keep real template read'],
  [templates, 'aria-pressed={selected?.id === template.id}', 'templates expose actual selection state'],
  [materials, 'readJobMaterialDraft()', 'materials keep draft recovery'],
  [materials, 'file.printFileUrl', 'materials print only real file URL'],
]) {
  expectIncludes(sourceCode, marker, label)
}

expect(
  !existsSync(join(kioskRoot, 'src/pages/resume/ResumeExportPage.tsx')),
  'AI-07 ResumeExportPage is deleted',
)
expectIncludes(
  read('src/routes/index.tsx'),
  '<Navigate to="/resume/optimize" replace />',
  'AI-07 /resume/export redirects to the real optimize export',
)

// 优化失败后「手动逐项修改」把诊断内容块带回生成表单。这一块自己执行转换函数。
console.log('\n=== 手动逐项修改：诊断内容块带回生成表单 ===')

function sourceNode(text, name) {
  const ast = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let found
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(ast) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!found) throw new Error(`source node ${name} missing`)
  const raw = found.getText(ast).replace(/^export\s+/u, '')
  return ts.isVariableDeclaration(found) ? `const ${raw};` : raw
}

function executable(text) {
  return ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText
}

const modelSource = read('src/pages/resume/components/resumeGenerateModel.ts')
const carrySource = read('src/pages/resume/resumeBlocksToGenerateForm.ts')
const carryProgram = [
  sourceNode(modelSource, 'TEXT_LIMITS'),
  sourceNode(modelSource, 'LIMITS'),
  sourceNode(modelSource, 'splitList'),
  sourceNode(modelSource, 'clampText'),
  sourceNode(modelSource, 'clampListText'),
  sourceNode(modelSource, 'EMPTY_EDU'),
  sourceNode(modelSource, 'EMPTY_EXP'),
  sourceNode(modelSource, 'EMPTY_PROJ'),
  sourceNode(modelSource, 'emptyForm'),
  sourceNode(carrySource, 'DIAGNOSIS_MASK_PLACEHOLDER'),
  sourceNode(carrySource, 'CARRIED_NOTE'),
  sourceNode(carrySource, 'keptLines'),
  sourceNode(carrySource, 'resumeBlocksToGenerateForm'),
  'return { resumeBlocksToGenerateForm, CARRIED_NOTE, DIAGNOSIS_MASK_PLACEHOLDER, clampText, clampListText, splitList, LIMITS, TEXT_LIMITS };',
].join('\n')
const carryApi = new Function(executable(carryProgram))()
const toForm = carryApi.resumeBlocksToGenerateForm
const NOTE = '已带入你简历里的内容，请逐项核对'

function block(key, label, lines) {
  return { key, label, lines }
}

const eduLines = ['  青岛职业技术学院物流管理  ', '', '在校做过仓库理货实训']
const expLines = ['在成品仓理货和拣货', '联系电话 [手机号_1]', '一天大约处理 80 单', '   ', '按货位把货配齐']
const projLines = ['和同学轮班收发快递', '邮箱 [邮箱_2] 不要印', '登记取件码']
const skillLines = ['Excel', '仓储理货']
const introLines = ['做事按单核对', '有问题会先问清楚再动手']
const full = toForm([
  block('basic', '基础信息', ['孙晓雯', '13800001111', 'sun@example.com', '青岛']),
  block('objective', '求职目标', ['仓储管理员', '全职', '青岛', '面议']),
  block('education', '教育经历', eduLines),
  block('experience', '工作经历', expLines),
  block('project', '项目经历', projLines),
  block('skill', '技能', skillLines),
  block('selfintro', '自我评价', introLines),
])
const eduText = '青岛职业技术学院物流管理\n在校做过仓库理货实训'
const expText = '在成品仓理货和拣货\n一天大约处理 80 单\n按货位把货配齐'
const projText = '和同学轮班收发快递\n登记取件码'
const dumped = JSON.stringify(full)

expect(toForm(undefined) === null, 'undefined 返回 null')
expect(toForm([]) === null, '空数组返回 null')
expect(toForm([block('basic', '基础信息', ['孙晓雯', '13800001111'])]) === null, '只有 basic 返回 null')
expect(toForm([block('objective', '求职目标', ['仓储管理员'])]) === null, '只有 objective 返回 null')
expect(full !== null, '五块里带得出内容时不返回 null')
if (full) {
  for (const key of ['name', 'phone', 'email', 'city']) {
    expect(full.form.basic[key] === '', `basic.${key} 留空`)
  }
  for (const key of ['position', 'city', 'jobType', 'salary']) {
    expect(full.form.intention[key] === '', `intention.${key} 留空`)
  }
  expect(!dumped.includes('[手机号_1]') && !dumped.includes('[邮箱_2]'), '含遮盖占位的行不在结果里')
  expect(full.form.education.length === 1, '教育只带一条')
  expect(full.form.education[0].description === eduText, '教育长文本等于各行用换行连起来')
  expect(full.form.education[0].school === '' && full.form.education[0].major === '' && full.form.education[0].degree === '' && full.form.education[0].period === '', '教育的学校专业学历时间留空')
  expect(full.form.experience.length === 1, '工作只带一条')
  expect(full.form.experience[0].description === expText, '工作长文本等于各行用换行连起来')
  expect(full.form.experience[0].company === '' && full.form.experience[0].role === '' && full.form.experience[0].period === '', '工作的公司职位时间留空')
  expect(full.form.projects.length === 1, '项目只带一条')
  expect(full.form.projects[0].description === projText, '项目长文本等于各行用换行连起来')
  expect(full.form.projects[0].name === '' && full.form.projects[0].role === '', '项目名称和角色留空')
  expect(full.form.skillsText === carryApi.clampListText(skillLines.join('\n'), carryApi.TEXT_LIMITS.skill), '技能按 clampListText 封顶')
  expect(full.form.selfIntro === carryApi.clampText(introLines.join('\n'), carryApi.TEXT_LIMITS.selfIntro), '自我评价按 clampText 封顶')
  expect(full.form.certsText === '', '证书不从内容块带入')
  expect(full.seg === 'exp', '带了工作经历落在 exp')
}
const longSkill = '一二三四五六七八九十'.repeat(5)
const skillOnly = toForm([block('skill', '技能', [longSkill, 'Excel'])])
expect(skillOnly !== null && skillOnly.form.skillsText === carryApi.clampListText(`${longSkill}\nExcel`, carryApi.TEXT_LIMITS.skill), '超长技能按条封顶')
expect(skillOnly !== null && !skillOnly.form.skillsText.includes(longSkill), '超长技能不是整段原样带入')
expect(skillOnly !== null && skillOnly.seg === 'exp', '只带了技能时经历页签用 exp')
const longIntro = '我'.repeat(520)
const introOnly = toForm([block('selfintro', '自我评价', [longIntro])])
expect(introOnly !== null && introOnly.form.selfIntro === carryApi.clampText(longIntro, carryApi.TEXT_LIMITS.selfIntro), '超长自我评价按 clampText 封顶')
expect(introOnly !== null && introOnly.form.selfIntro.length === 500, '自我评价封顶 500 字')
const eduOnly = toForm([block('education', '教育经历', ['只剩教育'])])
expect(eduOnly !== null && eduOnly.seg === 'edu' && eduOnly.form.experience[0].description === '', '只带了教育时落在 edu，工作描述留空')
const projOnly = toForm([block('project', '项目经历', ['只剩项目'])])
expect(projOnly !== null && projOnly.seg === 'proj' && projOnly.form.projects.length === 1, '只带了项目时落在 proj')
expect(carryApi.CARRIED_NOTE === NOTE, '提示句逐字等于任务包给的原句（不在定稿上，等产品负责人定字）')

// 技能：提交时只取前 LIMITS.skills 条（splitList）。带进来的要先按条截到同样条数，屏上看到的就是会提交的。
const skillTotal = carryApi.LIMITS.skills + 5
const skillItems = Array.from({ length: skillTotal }, (_, i) => `技能${i + 1}`)
const perLine = Math.ceil(skillTotal / 6)
const manySkillLines = Array.from({ length: 6 }, (_, line) => skillItems.slice(line * perLine, (line + 1) * perLine).join('、')).filter(Boolean)
const manySkills = toForm([block('skill', '技能', manySkillLines)])
const carriedSkillItems = manySkills ? carryApi.splitList(manySkills.form.skillsText, skillTotal) : []
expect(carriedSkillItems.length === carryApi.LIMITS.skills, `技能超过 ${carryApi.LIMITS.skills} 条时只带前 ${carryApi.LIMITS.skills} 条（实际 ${carriedSkillItems.length}）`)
expect(carriedSkillItems.join('|') === skillItems.slice(0, carryApi.LIMITS.skills).join('|'), '技能按原顺序整条地取前面的，不从条中间截')

// 遮盖占位的类别要和后端一致：后端多一种类别而前端常量没跟上，带占位的行就会进表单、印到新简历上。
const repoRead = (relativePath) => readFileSync(join(kioskRoot, '..', '..', relativePath), 'utf8')
const maskCategoryLine = repoRead('services/api/src/common/pii/pii-masker.ts').match(/type MaskCategory =([^\n]+)/u)
const backendMaskCategories = maskCategoryLine ? [...maskCategoryLine[1].matchAll(/'([^']+)'/gu)].map((m) => m[1]) : []
expect(backendMaskCategories.length > 0, '读得出后端 pii-masker.ts 的遮盖类别')
for (const category of backendMaskCategories) {
  expect(carryApi.DIAGNOSIS_MASK_PLACEHOLDER.test(`电话 [${category}_1]`), `前端认得后端遮盖类别「${category}」`)
}
const backendToken = repoRead('services/api/src/common/pii/llm-input-mask.ts').match(/const PLACEHOLDER_TOKEN =\s*\/(.+)\/[a-z]*/u)
expect(Boolean(backendToken) && backendToken[1] === carryApi.DIAGNOSIS_MASK_PLACEHOLDER.source, '前端遮盖占位和后端 PLACEHOLDER_TOKEN 写法逐字一致')

function countSentence(dir, sentence) {
  let count = 0
  const files = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(tsx?|css)$/u.test(entry.name)) {
        const text = readFileSync(path, 'utf8')
        let from = 0
        while (from <= text.length) {
          const at = text.indexOf(sentence, from)
          if (at < 0) break
          count += 1
          files.push(path)
          from = at + sentence.length
        }
      }
    }
  }
  walk(dir)
  return { count, files }
}
const sentenceHits = countSentence(join(kioskRoot, 'src'), NOTE)
expect(sentenceHits.count === 1, `apps/kiosk/src 里提示句只出现一次（实际 ${sentenceHits.count}：${sentenceHits.files.join(', ')}）`)

const generatePage = read('src/pages/resume/ResumeGeneratePage.tsx')
expect(
  /\{boot\.carried \? \([\s\S]{0,400}data-testid="resume-generate-carried-note"/u.test(generatePage),
  '生成页只在 boot.carried 为真时出提示',
)
expect(generatePage.split('resume-generate-carried-note').length === 2, '提示 testid 只写了一处')

const emptyState = read('src/pages/resume/components/resume-deliver/OptimizeEmptyState.tsx')
for (const marker of [
  "title: '返回诊断报告'",
  "description: '看清楚要改哪几处，再决定怎么改'",
  "route: '/resume/report'",
  "title: '手动逐项修改'",
  "description: '自己填写并原样导出草稿，不经过模型'",
  "route: '/resume/generate'",
  "title: '打开我的简历'",
  "description: '查看和整理已保存的版本'",
  "route: '/me/resumes'",
  'data-route={route}',
]) {
  expect(emptyState.includes(marker), `OptimizeEmptyState 三条退路的字和 data-route 没变：${marker}`)
}

if (failures > 0) {
  console.error(`\n${failures} K2b LightFlow contract checks failed`)
  process.exit(1)
}

console.log('\nALL PASS K2b AI 简历青序 LightFlow 静态合同')
