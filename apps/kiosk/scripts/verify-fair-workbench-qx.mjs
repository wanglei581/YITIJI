/**
 * 招聘会共享工作台（青序流光）稿 ↔ 代码对账。
 *
 * 稿：docs/design/kiosk-redesign-2026-08/28-jobfair-enhanced.html
 * 代码：apps/kiosk/src/pages/job-fairs/fairWorkbenchSpecs.ts + 八个页面
 *
 * 为什么要有这条门禁：`fairWorkbenchSpecs.ts` 是「稿 → 代码」的**转录面**，
 * 而转录漂移正是这批迁移反复出问题的形态（服务台那一轮漏抄稿里的 `quick`，
 * 15 条通往「我的」台账的入口静默消失；图标键被丢掉后页面改用正则猜图标）。
 * 手抄的四张表没人盯就会慢慢和稿分叉，分叉的第一受害者永远是诚实性声明——
 * 顶栏胶囊会开始说页面自己编的话。
 *
 * 本脚本直接从稿里 eval 出 HEAD / BACK / PILL / DEFAULT_STATE 四张表与 VIEWS 的键集，
 * 与 specs 逐条比对；再用 TS AST 检查八个页面传给 <QxFairWorkbench> 的 screen/state
 * 是不是稿里真的存在的组合。改了稿不改代码、改了代码不改稿，两边都会当场红。
 *
 * 运行：node --experimental-strip-types apps/kiosk/scripts/verify-fair-workbench-qx.mjs
 *      （pnpm --filter @ai-job-print/kiosk verify:fair-workbench-qx）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const KIOSK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = join(KIOSK_ROOT, '..', '..')
const DRAFT = join(REPO_ROOT, 'docs/design/kiosk-redesign-2026-08/28-jobfair-enhanced.html')
const PAGES_DIR = join(KIOSK_ROOT, 'src/pages/job-fairs')

let failed = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => { failed += 1; console.error(`  FAIL ${m}`) }

const html = readFileSync(DRAFT, 'utf8')

/** 从稿里把一个 `var NAME={...};` 字面量 eval 出来。找不到就是稿结构变了，直接中止。 */
function draftTable(name) {
  const start = html.indexOf(`var ${name}={`)
  if (start < 0) throw new Error(`稿里找不到 var ${name}={…}，对账中止（稿结构变了？）`)
  // 四张表的值都是「字符串 / 字符串数组」，不含嵌套对象，所以第一处 `};` 就是收尾。
  // DEFAULT_STATE 在稿里写成一行，不能只认 `\n};`。
  const end = html.indexOf('};', start)
  if (end < 0) throw new Error(`稿里 var ${name} 没有以 }; 收尾，对账中止`)
  return vm.runInNewContext(`${html.slice(start, end + 2)}\n${name}`)
}

const HEAD = draftTable('HEAD')
const BACK = draftTable('BACK')
const PILL = draftTable('PILL')
const DEFAULT_STATE = draftTable('DEFAULT_STATE')

/** 稿 VIEWS 的键集合 = 稿真的画过的 `screen:state` 组合。 */
const VIEW_KEYS = (() => {
  const start = html.indexOf('var VIEWS={')
  const end = html.indexOf('var PILL={', start)
  if (start < 0 || end < 0) throw new Error('稿里找不到 VIEWS/PILL 区段，对账中止')
  return new Set(
    [...html.slice(start, end).matchAll(/^'([a-z-]+:[a-z-]+)':function\(\)/gm)].map((m) => m[1]),
  )
})()

const specs = await import('../src/pages/job-fairs/fairWorkbenchSpecs.ts')

/**
 * 稿没建模、但生产必须有的状态 —— **门禁这一侧**的登记清单。
 *
 * 它与 specs 里的 FAIR_PILL_GAPS 必须逐字相等：加一条就得同时动源码与门禁，
 * 动了门禁就会出现在 diff 里被人看见。这是刻意的摩擦，防的是「反正稿里没有，
 * 我再补一个 state 就是了」——那条路走到底，稿就不再是真值了。
 */
const REGISTERED_GAP_STATES = {
  'materials:error': '稿把 materials 的失败只画成 expired；GET /materials 500 时页面会说「链接超时失效，重取即可，内容不变」，三句全假。',
  'visit-plan:idle': '稿的 missing-context 指「没有简历上下文」；有 taskId 但这场还没生成过（GET latest 404）被折进去后，生成入口不可达。',
  'visit-plan:load-failed': '读上次结果失败既不是 missing-context（简历在）也不是 failed（本次根本没生成）。',
}

/**
 * 稿画过、但**后端当前不产生对应信号**，因此生产没有可达路径的状态。
 *
 * 与上面那张表方向相反：这里登记的是「稿多了一个状态」，而不是「稿少了一个」。
 * 每条都要写清楚**恢复条件** —— 后端哪天真的下发了那个信号，就该把它接上并从这里删掉。
 * 第 8 条会反向断言：一旦它变成可达，这里必须删除，防止登记表烂在原地。
 */
const UNIMPLEMENTED_DRAFT_STATES = {
  'materials:expired': '后端不下发任何「链接已过期」信号：print-url 的失败码是 MATERIAL_NOT_PRINTABLE / MATERIAL_PRINT_PREPARING / MATERIAL_INTEGRITY_FAILED，物料列表本身也没有有效期字段。恢复条件：服务端出现明确的过期码或 DTO 带上有效期后，把这一态接到那个真实信号上，并删掉本条登记。',
}

console.log('\n=== 招聘会共享工作台 稿 ↔ 代码对账（28-jobfair-enhanced.html）===')

// ── 0. 抽取本身要有阳性对照 ─────────────────────────────────────────────────
// 「读数为 0」有两种可能：稿里真的没有，或者正则根本没匹配上。没有这一条，
// 下面所有 deepEqual 都会在抽取失效时用空对象互相通过。
{
  const counts = {
    HEAD: Object.keys(HEAD).length,
    BACK: Object.keys(BACK).length,
    PILL: Object.keys(PILL).length,
    DEFAULT_STATE: Object.keys(DEFAULT_STATE).length,
    VIEWS: VIEW_KEYS.size,
  }
  const ok = counts.HEAD === 8 && counts.BACK === 8 && counts.DEFAULT_STATE === 8
    && counts.PILL >= 20 && counts.VIEWS >= 20
  if (!ok) fail(`0. 稿抽取结果不合理（抽取失效会让后面全部静默通过）: ${JSON.stringify(counts)}`)
  else pass(`0. 稿抽取阳性对照 ${JSON.stringify(counts)}`)
}

/** 在同一文件里找 `const <name> = <initializer>` 的初始化表达式。 */
function findConstInitializer(sourceFile, name) {
  let found = null
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

function compare(label, actual, expected) {
  const a = JSON.stringify(actual, Object.keys(actual).sort())
  const e = JSON.stringify(expected, Object.keys(expected).sort())
  if (a === e) { pass(label); return }
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  const diffs = [...keys]
    .filter((k) => JSON.stringify(actual[k]) !== JSON.stringify(expected[k]))
    .map((k) => `${k}: 代码=${JSON.stringify(actual[k])} 稿=${JSON.stringify(expected[k])}`)
  fail(`${label} — ${diffs.join(' | ')}`)
}

// ── 1. HEAD：h1 + 一句话说明 ────────────────────────────────────────────────
compare(
  '1. FAIR_HEAD 与稿 HEAD 逐字一致',
  Object.fromEntries(Object.entries(specs.FAIR_HEAD).map(([k, v]) => [k, [...v]])),
  Object.fromEntries(Object.entries(HEAD).map(([k, v]) => [k, [...v]])),
)

// ── 2. BACK：落点路由 + 无障碍名（稿第 0 位是 html 链接，生产不用） ──────────
compare(
  '2. FAIR_BACK 与稿 BACK 的 data-route / aria-label 一致',
  Object.fromEntries(Object.entries(specs.FAIR_BACK).map(([k, v]) => [k, [...v]])),
  Object.fromEntries(Object.entries(BACK).map(([k, v]) => [k, [v[1], v[2]]])),
)

// ── 3. PILL：稿里 tone 为空字符串记作 unknown ───────────────────────────────
compare(
  '3. FAIR_PILL 与稿 PILL 逐条一致（空 tone → unknown）',
  Object.fromEntries(Object.entries(specs.FAIR_PILL).map(([k, v]) => [k, [v.tone, v.label]])),
  Object.fromEntries(Object.entries(PILL).map(([k, v]) => [k, [v[0] || 'unknown', v[1]]])),
)

// ── 4. DEFAULT_STATE ───────────────────────────────────────────────────────
compare('4. FAIR_DEFAULT_STATE 与稿 DEFAULT_STATE 一致', { ...specs.FAIR_DEFAULT_STATE }, { ...DEFAULT_STATE })

// ── 5. 底部 truth 条：八屏共用的合规底线声明，不得按页删改 ──────────────────
{
  const truth = html.match(/<div class="truth">\s*<p><b>([^<]*)<\/b>([^<]*)<\/p>\s*<a[^>]*>([^<]*)<\/a>/)
  if (!truth) {
    fail('5. 稿里找不到 .truth 条')
  } else {
    const expected = [truth[1], truth[2], truth[3]]
    const actual = [specs.FAIR_TRUTH_LEAD, specs.FAIR_TRUTH_REST, specs.FAIR_TRUTH_LINK]
    if (JSON.stringify(actual) === JSON.stringify(expected)) pass('5. truth 条三段与稿逐字一致')
    else fail(`5. truth 条与稿不一致: 代码=${JSON.stringify(actual)} 稿=${JSON.stringify(expected)}`)
  }
}

// ── 6. 默认胶囊不得留空、也不得默认「正常」 ─────────────────────────────────
{
  const d = specs.FAIR_DEFAULT_PILL
  if (d && d.tone === 'unknown' && typeof d.label === 'string' && d.label.length > 0) {
    pass('6. 未登记状态落中性默认胶囊（不留空、不默认 ok）')
  } else {
    fail(`6. FAIR_DEFAULT_PILL 必须是中性(unknown)且有文案，当前 ${JSON.stringify(d)}`)
  }
}

// ── 7. 八个页面传给 <QxFairWorkbench> 的 screen/state 必须是稿画过的组合 ────
// 页面自己编一个稿里没有的 state，胶囊就会落到默认文案上——在公共终端上
// 那是「顶栏说了一句谁都没审过的话」。这一条把它堵死。
{
  const files = readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
    .map((e) => join(PAGES_DIR, e.name))
  const seen = new Set()
  const bad = []
  let usages = 0
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!src.includes('QxFairWorkbench')) continue
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node) => {
      const opening = ts.isJsxSelfClosingElement(node)
        ? node
        : (ts.isJsxElement(node) ? node.openingElement : null)
      if (opening && opening.tagName.getText(sf) === 'QxFairWorkbench') {
        usages += 1
        const attrs = new Map()
        for (const a of opening.attributes.properties) {
          if (ts.isJsxAttribute(a) && a.initializer) attrs.set(a.name.getText(sf), a.initializer)
        }
        const screenInit = attrs.get('screen')
        const screen = screenInit && ts.isStringLiteral(screenInit) ? screenInit.text : null
        if (!screen) {
          bad.push(`${relative(KIOSK_ROOT, file)}: screen 必须是字面量`)
        } else {
          const stateInit = attrs.get('state')
          const states = []
          const collect = (n) => {
            if (ts.isStringLiteralLike(n)) states.push(n.text)
            ts.forEachChild(n, collect)
          }
          // `state="empty"` 直接是字面量；`state={uiState}` 要回到 `const uiState = …`
          // 那条声明里去收全部分支的字面量（页面的状态机都写成一条三元链）。
          if (stateInit) {
            const inner = ts.isJsxExpression(stateInit) ? stateInit.expression : stateInit
            if (inner && ts.isIdentifier(inner)) {
              const decl = findConstInitializer(sf, inner.text)
              if (!decl) bad.push(`${relative(KIOSK_ROOT, file)}: state={${inner.text}} 找不到同文件的 const 声明`)
              else collect(decl)
            } else if (inner) {
              collect(inner)
            }
          }
          if (states.length === 0) bad.push(`${relative(KIOSK_ROOT, file)}: screen=${screen} 的 state 里没有任何字面量`)
          for (const state of states) {
            const key = `${screen}:${state}`
            seen.add(key)
            if (!VIEW_KEYS.has(key) && !(key in REGISTERED_GAP_STATES)) {
              bad.push(`${relative(KIOSK_ROOT, file)}: ${key} 既不在稿的 VIEWS 里，也没登记进 REGISTERED_GAP_STATES`)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  if (usages < 8) bad.push(`只扫到 ${usages} 处 <QxFairWorkbench> 用法，八条路由应各至少一处`)
  const screens = new Set([...seen].map((k) => k.split(':')[0]))
  for (const screen of Object.keys(DEFAULT_STATE)) {
    if (!screens.has(screen)) bad.push(`稿里的 screen=${screen} 在生产页面里没有任何用法`)
  }
  if (bad.length > 0) fail(`7. 页面 screen/state 与稿不符: ${bad.join(' | ')}`)
  else pass(`7. 八屏 ${usages} 处用法共 ${seen.size} 个 screen:state 组合，全部在稿里或已登记为稿面缺口`)

  // ── 7b. 稿面缺口表：源码与门禁必须逐字相等，且不得覆写稿已画过的状态 ────────
  {
    const codeKeys = Object.keys(specs.FAIR_PILL_GAPS ?? {}).sort()
    const gateKeys = Object.keys(REGISTERED_GAP_STATES).sort()
    const problems = []
    if (JSON.stringify(codeKeys) !== JSON.stringify(gateKeys)) {
      problems.push(`FAIR_PILL_GAPS=${JSON.stringify(codeKeys)} 门禁登记=${JSON.stringify(gateKeys)}`)
    }
    for (const key of codeKeys) {
      // ① 不得影子覆盖稿的状态：那会让第 3 条的逐条对账失去意义。
      if (VIEW_KEYS.has(key)) problems.push(`${key} 稿里本来就有，不该进缺口表`)
      // ② 缺口的 screen 必须是稿里真实存在的屏。
      const screen = key.split(':')[0]
      if (!(screen in DEFAULT_STATE)) problems.push(`${key} 的 screen 不在稿里`)
      // ③ 缺口也要有胶囊，且不能是「一切正常」那一档。
      const pill = specs.FAIR_PILL_GAPS[key]
      if (!pill || !pill.label || pill.tone === 'ok') problems.push(`${key} 缺口胶囊必须有文案且不得为 ok：${JSON.stringify(pill)}`)
      // ④ 必须真的被页面用到；登记了没人用就是死状态。
      if (!seen.has(key)) problems.push(`${key} 登记了却没有任何页面用法`)
    }
    if (problems.length > 0) fail(`7b. 稿面缺口登记不一致: ${problems.join(' | ')}`)
    else pass(`7b. ${codeKeys.length} 个稿面缺口状态在源码与门禁两侧逐字一致且各有页面用法`)
  }

  // ── 8. 反向覆盖：稿画过的每个 state 都必须有生产可达路径 ──────────────────
  // 第 7 条只保证「代码没编新状态」，它挡不住**丢状态**：稿画了 ai-unavailable
  // 而页面把能力级故障和本次失败合并成一个 failed，用户就永远看不到
  // 「AI 不可用，浏览与打印不受影响」这句话——那正是迁移最容易悄悄丢的一类能力。
  // （2026-09-20 首次接这条门禁时就抓到了这一例，visit-plan:ai-unavailable 当时 0 可达。）
  const uncovered = [...VIEW_KEYS].filter((k) => !seen.has(k))
  const unregistered = uncovered.filter((k) => !(k in UNIMPLEMENTED_DRAFT_STATES))
  // 反向：登记成「后端没有这个信号」的状态，一旦被接上就必须从登记表里删掉。
  // 没有这一条，UNIMPLEMENTED_DRAFT_STATES 会变成一张只进不出、越来越松的豁免单。
  const staleRegistrations = Object.keys(UNIMPLEMENTED_DRAFT_STATES).filter((k) => seen.has(k))
  if (unregistered.length > 0) {
    fail(`8. 稿画过但生产不可达、且未登记恢复条件的状态: ${unregistered.join(', ')}`)
  } else if (staleRegistrations.length > 0) {
    fail(`8. 这些状态已经有生产可达路径，必须从 UNIMPLEMENTED_DRAFT_STATES 删除: ${staleRegistrations.join(', ')}`)
  } else {
    pass(`8. 稿的 ${VIEW_KEYS.size} 个状态中 ${VIEW_KEYS.size - uncovered.length} 个可达，${uncovered.length} 个已登记恢复条件`)
  }
}

// ── 8b. 居中态：稿 `.scroll.center` 的 19 个状态屏逐条对账 ──────────────────
// 定高屏上「顶部对齐 + 短内容」= 底部一大片死白。稿自己给了答案（.scroll.center），
// 所以这一位也必须从稿里抄，不能各页拍脑袋——拍脑袋的结果 2026-09-21 实测过一次：
// 一律居中会让列表屏在列表上方裂开一条空带。
{
  const start = html.indexOf('var VIEWS={')
  const end = html.indexOf('var PILL={', start)
  const body = html.slice(start, end)
  const entries = [...body.matchAll(
    /^'([a-z-]+:[a-z-]+)':function\(\)\{([\s\S]*?)(?=\n'[a-z-]+:[a-z-]+':function|\n\};)/gm,
  )]
  const drafted = entries.filter(([, , body2]) => body2.includes('scroll center')).map((m) => m[1]).sort()
  const problems = []
  // 阳性对照：抽取失效时 drafted 会是空数组，下面的比对就会「两边都空」地通过。
  if (entries.length !== VIEW_KEYS.size) problems.push(`VIEWS 条目抽取数 ${entries.length} 与键集 ${VIEW_KEYS.size} 不一致`)
  if (drafted.length < 10) problems.push(`稿里只抽到 ${drafted.length} 个居中屏，抽取疑似失效`)
  const coded = [...(specs.FAIR_CENTERED_STATES ?? [])].sort()
  if (JSON.stringify(coded) !== JSON.stringify(drafted)) {
    const only = (a, b) => a.filter((k) => !b.includes(k))
    problems.push(`代码多出 ${JSON.stringify(only(coded, drafted))} / 稿多出 ${JSON.stringify(only(drafted, coded))}`)
  }
  // 缺口态也要各自表态，且不能和稿的集合重叠。
  const gapCentered = specs.FAIR_GAP_STATE_CENTERED ?? {}
  const gapKeys = Object.keys(gapCentered).sort()
  if (JSON.stringify(gapKeys) !== JSON.stringify(Object.keys(REGISTERED_GAP_STATES).sort())) {
    problems.push(`FAIR_GAP_STATE_CENTERED 的键与缺口表不一致: ${JSON.stringify(gapKeys)}`)
  }
  for (const key of gapKeys) {
    if (drafted.includes(key)) problems.push(`${key} 稿里本来就有，不该在缺口居中表里`)
    if (typeof gapCentered[key] !== 'boolean') problems.push(`${key} 必须显式写 true / false`)
  }
  if (problems.length > 0) fail(`8b. 居中态与稿不一致: ${problems.join(' | ')}`)
  else pass(`8b. 稿的 ${drafted.length} 个居中状态屏与代码逐条一致，${gapKeys.length} 个缺口态各自表态`)
}

// ── 9. fairNotice：「去之前先知道这几件事」三条 ──────────────────────────────
// 这三句同时出现在 /job-fairs/checkin 与 /job-fairs/:id。稿里是一个共用片段，
// 代码里也必须是一份常量；两边都手写就会在下一次改文案时分叉。
{
  const start = html.indexOf('function fairNotice()')
  const end = html.indexOf('function fairSubnav()', start)
  if (start < 0 || end < 0) {
    fail('9. 稿里找不到 fairNotice() 片段')
  } else {
    const block = html.slice(start, end)
    // 稿里这三句带 <b> 强调；生产是纯文本常量，所以去标签后再逐字比。
    const drafted = [...block.matchAll(/<span class="rule"><i>\d<\/i><span>([\s\S]*?)<\/span><\/span>/g)]
      .map((m) => m[1].replace(/<\/?b>/g, ''))
    const actual = [...(specs.FAIR_NOTICE_RULES ?? [])]
    if (drafted.length !== 3) {
      fail(`9. 稿 fairNotice 抽出 ${drafted.length} 条，期望 3 条（抽取失效会让对账静默通过）`)
    } else if (JSON.stringify(actual) !== JSON.stringify(drafted)) {
      fail(`9. FAIR_NOTICE_RULES 与稿不一致: 代码=${JSON.stringify(actual)} 稿=${JSON.stringify(drafted)}`)
    } else {
      pass('9. FAIR_NOTICE_RULES 三条与稿逐字一致')
    }
  }
}

if (failed > 0) {
  console.error(`\n=== FAILED (${failed} 项) — 稿与代码已分叉，合入前必须对齐 ===\n`)
  process.exit(1)
}
console.log('\n=== ALL PASS — 招聘会共享工作台与稿一致 ===\n')
