#!/usr/bin/env node
/**
 * verify:kiosk-unattended-copy —— 一体机源码里不许再教用户去「找 / 联系现场工作人员」。
 *
 * 为什么有这条门禁：一体机在政府就业服务大厅等场所无人值守，现场没有工作人员（产品负责人定）。
 * 任何错误分支都不许叫用户去找人；需要求助时只给服务电话（src/copy/unattendedCopy.ts 的标准句）
 * 或站内出路。这类句子散在共享模块和页面里，换一句漏一句，此前没有任何东西拦。
 *
 * 判据只有一份词表：`UNATTENDED_FORBIDDEN_PHRASES`（src/copy/unattendedCopy.ts）。
 * 本门禁把那个文件转译后真读出来，不另抄一份 —— 词表加一条，下面的规则立刻按新词表重判。
 *
 * 扫 apps/kiosk/src 全部文本源码（.ts/.tsx/.js/.css/.json 等，注释也算），两条规则：
 *
 *   ① 共享模块（src/pages/ 以外的一切：copy、services、hooks、components、auth、layouts……）零容忍。
 *      词表里任何一条出现就红。词表覆盖不到「请叫现场工作人员」「工作人员会核实」这类变体，
 *      所以共享模块里「工作人员」三个字本身也不许出现；隐私类说明这种不是求助指引的句子，
 *      在下面的 NOT_HELP_GUIDANCE 里按「文件 + 整行原文」精确放行并写明理由。
 *      src/copy/unattendedCopy.ts 是词表本体，只免「三个字」这一条，词表条目照扫。
 *
 *   ② 页面目录（src/pages/）里的存量命中，逐个文件登记在待清名单
 *      scripts/fixtures/unattended-pending-pages.json，并写明归触屏版第几包整页重写；
 *      那一包重写完页面，就把条目删掉。名单只许减不许增：
 *        · 名单外的文件出现命中            → 红（新增）；
 *        · 命中次数超过名单上的数字        → 红（新增）；
 *        · 命中次数少于名单（含已清零）    → 也红，要把名单调低 / 删条目，
 *          还账必须落进文件，不给自己留额度（同 scripts/verify-fixture-time-bombs.mjs 的记账方式）。
 *      命中处数 = 该文件里被词表盖住的位置数：同一处被好几条说法同时盖住（长句型是短说法的子集）只算一处，
 *      所以词表里多写几条同义说法不会把页面存量的数字翻倍。
 *
 * 做不到的事（如实写明）：静态文本扫不到运行时拼出来的句子，也扫不到把词拆开写的字符串。
 * 码表里的句子由 verify-kiosk-runtime-error-boundary 在运行时逐码真跑一遍补上这一层。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcRoot = join(kioskRoot, 'src')
const COPY_MODULE = 'src/copy/unattendedCopy.ts'
const PENDING_FILE = 'scripts/fixtures/unattended-pending-pages.json'
const PAGES_PREFIX = 'src/pages/'

/** 共享模块里连单独出现都不许的字眼。词表是「求助句型」，这个是「角色词」，两者互补。 */
const ROLE_WORD = '工作人员'

/**
 * 不是求助指引的句子，按「文件 + 整行原文（去掉首尾空白）」精确放行。
 * 登记即承诺：这句话没有叫用户去找人（例如隐私说明里的「……工作人员都看不到」）。
 * 条目对不上任何一行就红，免得白名单烂在那里；不许按目录或关键词放行。
 *
 * 目前没有条目：页面里仅有的两处隐私说明（SelfAssessmentFlow.tsx）不含词表里的任何一条，
 * 本来就不命中；共享模块里没有出现角色词的非求助句子。
 */
const NOT_HELP_GUIDANCE = [
  // { file: 'src/xxx/Yyy.tsx', line: '整行原文', why: '隐私说明：……，没有叫用户去找人' },
]

/** 扫描的扩展名；其余已知二进制 / 说明文档在 SKIPPED_EXT 里写明；遇到没登记的扩展名直接红（不静默漏扫）。 */
const SCANNED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.html', '.svg'])
const SKIPPED_EXT = new Set([
  '.woff2', '.woff', '.ttf', '.otf', // 字体
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp4', '.webm', // 图片、视频
  '.md', '.txt', // 字体许可证与说明，不是上屏文案
])

const failures = []
const fail = (message) => failures.push(message)
const toPosix = (p) => p.split(sep).join('/')

/**
 * 词表在文本里盖住的位置，一处记一条。同一行里重叠的说法合并成一处
 * （「联系现场工作人员」同时被「联系现场工作人员」和「现场工作人员」盖住，只算一处）。
 * 返回的 phrase 是合并后真实匹配到的那段原文。
 */
function findHits(text, phrases) {
  const hits = []
  text.split('\n').forEach((line, index) => {
    const spans = []
    for (const phrase of phrases) {
      for (let from = 0; ;) {
        const at = line.indexOf(phrase, from)
        if (at < 0) break
        spans.push({ start: at, end: at + phrase.length })
        from = at + 1
      }
    }
    spans.sort((a, b) => a.start - b.start || b.end - a.end)
    let current = null
    const flush = () => {
      if (current) hits.push({ line: index + 1, phrase: line.slice(current.start, current.end), text: line.trim() })
    }
    for (const span of spans) {
      if (current && span.start < current.end) current.end = Math.max(current.end, span.end)
      else {
        flush()
        current = { ...span }
      }
    }
    flush()
  })
  return hits
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

function describeHits(hits, limit = 5) {
  const shown = hits.slice(0, limit).map((hit) => `      第 ${hit.line} 行「${hit.phrase}」：${hit.text.slice(0, 80)}`)
  if (hits.length > limit) shown.push(`      …… 另有 ${hits.length - limit} 处`)
  return shown.join('\n')
}

// ── 读词表，并先证明扫描器本身是活的（阳性对照）──────────────────────────────
async function loadForbiddenPhrases() {
  const js = ts.transpileModule(readFileSync(join(kioskRoot, COPY_MODULE), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: COPY_MODULE,
  }).outputText
  try {
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js, 'utf8').toString('base64')}`)
    return mod.UNATTENDED_FORBIDDEN_PHRASES
  } catch (error) {
    // 词表文件新增了运行时 import 时，data URL 里解析不了相对路径；那时本门禁要跟着改，不能静默放过。
    fail(`${COPY_MODULE} 加载失败（它不得有运行时依赖，本门禁按原样转译后读词表）：${error instanceof Error ? error.message : error}`)
    return null
  }
}

const phrases = await loadForbiddenPhrases()
const phrasesOk = Array.isArray(phrases) && phrases.length >= 10 && phrases.every((p) => typeof p === 'string' && p.length >= 3)
if (phrases !== null && !phrasesOk) {
  fail(`UNATTENDED_FORBIDDEN_PHRASES 读出来不对（${Array.isArray(phrases) ? `${phrases.length} 条` : '不是数组'}）：词表被清空或改坏了，本门禁不能在空词表上通过`)
}
if (phrasesOk) {
  if (new Set(phrases).size !== phrases.length) fail('UNATTENDED_FORBIDDEN_PHRASES 里有重复条目')
  for (const phrase of phrases) {
    const sample = findHits(`甲${phrase}乙`, [phrase])
    if (sample.length !== 1) fail(`扫描器对词表条目「${phrase}」没有恰好命中一次（实际 ${sample.length}），扫描逻辑坏了`)
    // 整张词表一起上：长句型被短说法同时盖住，仍只能算一处，否则页面存量的数字会随词表同义条目翻倍。
    const merged = findHits(`甲${phrase}乙`, phrases)
    if (merged.length !== 1) fail(`整张词表扫「${phrase}」应只算一处（重叠的说法要合并），实际 ${merged.length} 处，合并逻辑坏了`)
  }
  if (findHits('这里什么也没有', phrases).length !== 0) fail('扫描器在不含任何禁用说法的句子上误报')
}

// ── 读待清名单 ──────────────────────────────────────────────────────────────
/** @type {Map<string, { count: number, group: string }>} */
const pending = new Map()
try {
  const groups = JSON.parse(readFileSync(join(kioskRoot, PENDING_FILE), 'utf8'))?.packages
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) throw new Error('缺少 packages 对象')
  for (const [group, files] of Object.entries(groups)) {
    if (!/第 \d+ 包/.test(group)) fail(`${PENDING_FILE}：分组名「${group}」没有写明触屏版第几包（形如「触屏版第 3 包 · 打印」）`)
    if (!files || typeof files !== 'object' || Array.isArray(files)) {
      fail(`${PENDING_FILE}：分组「${group}」不是「文件 → 次数」对象`)
      continue
    }
    for (const [file, count] of Object.entries(files)) {
      if (pending.has(file)) fail(`${PENDING_FILE}：${file} 同时登记在「${pending.get(file).group}」和「${group}」`)
      if (!Number.isInteger(count) || count < 1) fail(`${PENDING_FILE}：${file} 的次数必须是正整数（已清零就删掉这一条），现在是 ${JSON.stringify(count)}`)
      if (!file.startsWith(PAGES_PREFIX)) fail(`${PENDING_FILE}：${file} 不在 ${PAGES_PREFIX} 下；共享模块零容忍，不能进待清名单`)
      pending.set(file, { count, group })
    }
  }
} catch (error) {
  fail(`${PENDING_FILE} 读取或解析失败：${error instanceof Error ? error.message : error}`)
}

// ── 白名单自检 ──────────────────────────────────────────────────────────────
const allowed = new Map() // 文件 -> 放行的整行原文集合
for (const entry of NOT_HELP_GUIDANCE) {
  if (!entry.file || !entry.line || !entry.why) fail(`NOT_HELP_GUIDANCE 条目缺字段（file / line / why 都要写）：${JSON.stringify(entry)}`)
  const abs = join(kioskRoot, entry.file)
  const matched = existsSync(abs) && readFileSync(abs, 'utf8').split('\n').some((line) => line.trim() === entry.line)
  if (!matched) fail(`NOT_HELP_GUIDANCE 里「${entry.file}」的这一条已经对不上任何一行，请删掉或改成现行原文：${entry.line}`)
  if (!allowed.has(entry.file)) allowed.set(entry.file, new Set())
  allowed.get(entry.file).add(entry.line)
}
const isAllowedLine = (file, text) => allowed.get(file)?.has(text) === true

// ── 扫 src ──────────────────────────────────────────────────────────────────
let scannedShared = 0
let scannedPages = 0
const pageRoleOnly = [] // 页面里单独出现「工作人员」、但词表没命中的文件（只提示，不计入名单）：[{ rel, lines }]
const unknownExt = new Set()
const sharedHits = [] // [{ rel, hits }]
/** @type {Map<string, Array<{ line: number, phrase: string, text: string }>>} */
const pageHits = new Map()

if (phrasesOk) {
  for (const full of walk(srcRoot)) {
    const rel = toPosix(relative(kioskRoot, full))
    const ext = full.slice(full.lastIndexOf('.')).toLowerCase()
    if (SKIPPED_EXT.has(ext)) continue
    if (!SCANNED_EXT.has(ext)) {
      unknownExt.add(ext || '(无扩展名)')
      continue
    }
    const text = readFileSync(full, 'utf8')
    const phraseHits = findHits(text, phrases).filter((hit) => !isAllowedLine(rel, hit.text))
    if (rel.startsWith(PAGES_PREFIX)) {
      scannedPages += 1
      if (phraseHits.length > 0) pageHits.set(rel, phraseHits)
      else {
        const roleOnly = findHits(text, [ROLE_WORD]).filter((hit) => !isAllowedLine(rel, hit.text))
        if (roleOnly.length > 0) pageRoleOnly.push({ rel, lines: roleOnly.length })
      }
      continue
    }
    scannedShared += 1
    // 词表本体必然含有角色词的片段，只免角色词这一条；词表条目照扫。
    const roleHits = rel === COPY_MODULE ? [] : findHits(text, [ROLE_WORD]).filter((hit) => !isAllowedLine(rel, hit.text))
    const phraseLines = new Set(phraseHits.map((hit) => hit.line)) // 同一行已因词表命中，就不再因角色词重复报
    const hits = [...phraseHits, ...roleHits.filter((hit) => !phraseLines.has(hit.line))].sort((a, b) => a.line - b.line)
    if (hits.length > 0) sharedHits.push({ rel, hits })
  }

  if (unknownExt.size > 0) {
    fail(`src 下出现没登记的扩展名：${[...unknownExt].join('、')}。先决定扫不扫（加进 SCANNED_EXT 或 SKIPPED_EXT），不能静默漏扫`)
  }
  if (scannedShared < 100 || scannedPages < 300) {
    fail(`扫到的文件数异常偏少（共享 ${scannedShared}、页面 ${scannedPages}）：目录结构变了，或扫描空跑`)
  }
  for (const must of ['src/services/api/userErrorMessage.ts', 'src/hooks/useTerminalDeviceStatus.ts', 'src/components/KioskFeedbackDialog.tsx']) {
    if (!existsSync(join(kioskRoot, must))) fail(`找不到 ${must}：文件改名或挪位了，先更新本门禁里的阳性对照`)
  }
}

// ── 规则 ①：共享模块零容忍 ─────────────────────────────────────────────────
for (const { rel, hits } of sharedHits) {
  fail(
    `[共享模块零容忍] ${rel} 有 ${hits.length} 处：\n${describeHits(hits)}\n`
    + '      改成 src/copy/unattendedCopy.ts 的标准句（helpNeededLine / machineUnusableLine / machineCannotPrintLine / printProblemLine / refundApplyLine），'
    + '带号码的要在取文案时现算；若这句不是求助指引（如隐私说明），登记到本门禁的 NOT_HELP_GUIDANCE。',
  )
}

// ── 规则 ②：页面目录只减不增 ───────────────────────────────────────────────
let pageHitTotal = 0
let pendingTotal = 0
if (phrasesOk) {
  for (const rel of [...new Set([...pageHits.keys(), ...pending.keys()])].sort()) {
    const hits = pageHits.get(rel) ?? []
    const listed = pending.get(rel)
    pageHitTotal += hits.length
    if (!listed) {
      fail(`[页面新增] ${rel} 出现 ${hits.length} 处，它不在待清名单里（名单只许减不许增）：\n${describeHits(hits)}\n      新写的页面文案用标准句；不要往名单里加条目。`)
      continue
    }
    pendingTotal += listed.count
    if (!existsSync(join(kioskRoot, rel))) {
      fail(`[页面已清] ${rel} 已不存在（${listed.group}整页重写时删掉了），请从 ${PENDING_FILE} 删掉这一条`)
    } else if (hits.length > listed.count) {
      fail(`[页面新增] ${rel} 命中 ${hits.length} 处，超过待清名单上的 ${listed.count}（${listed.group}）：\n${describeHits(hits)}`)
    } else if (hits.length === 0) {
      fail(`[页面已清] ${rel} 已没有命中，请从 ${PENDING_FILE} 删掉这一条（${listed.group}）。名单只许减不许增，还账要落进文件。`)
    } else if (hits.length < listed.count) {
      fail(`[页面已清一部分] ${rel} 现在命中 ${hits.length} 处，名单上还写着 ${listed.count}（${listed.group}）。请把名单里的数字改成 ${hits.length}。`)
    }
  }
}

console.log('\n=== 一体机无人值守文案门禁（找 / 联系现场工作人员） ===')
if (failures.length > 0) {
  for (const message of failures) console.error(`  FAIL ${message}`)
  console.error(`\n✗ verify:kiosk-unattended-copy：${failures.length} 项失败（待清名单合计 ${pendingTotal} 处，页面实际命中 ${pageHitTotal} 处）\n`)
  process.exit(1)
}
console.log(`  PASS 词表 ${phrases.length} 条，读自 ${COPY_MODULE}（转译后真读，未另抄）`)
console.log(`  PASS 共享模块 ${scannedShared} 个文件：零命中（词表 + 「${ROLE_WORD}」）`)
console.log(`  PASS 页面目录 ${scannedPages} 个文件：命中 ${pageHitTotal} 处，全部在待清名单的 ${pending.size} 个文件里，次数与名单逐个一致，无新增`)
if (pageRoleOnly.length > 0) {
  const lines = pageRoleOnly.reduce((sum, item) => sum + item.lines, 0)
  const names = pageRoleOnly.slice(0, 8).map((item) => `${item.rel.replace(PAGES_PREFIX, '')}(${item.lines})`).join('、')
  console.log(
    `  NOTE 另有 ${pageRoleOnly.length} 个页面文件共 ${lines} 行单独出现「${ROLE_WORD}」、词表没命中，不计入名单：${names}${pageRoleOnly.length > 8 ? ' 等' : ''}。`
    + '这些是隐私说明或展会、门店、银行的人员，不是叫用户去找本机的人；若有求助句漏网，改 unattendedCopy.ts 的词表，名单随之重算。',
  )
}
console.log('\n✓ verify:kiosk-unattended-copy 通过\n')
