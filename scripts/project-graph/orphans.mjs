// ============================================================================
// 项目图谱 · 孤儿盘点
//
// 本模块只出清单，不删任何东西，也不建议自动删除。
//
// 判定标准照抄 CLAUDE.md §8「删除旧代码必须有证据」的五条，全部满足才进
// 「零引用」桶：无路由引用、无 import 引用、无测试/verify 依赖、无当前文档声明、
// 不会被生产部署或硬件链路使用。任何一条不满足就降级到「有残余引用」，
// 并把那条引用写出来给人看。
//
// PROTECTED 是硬名单：即使五条全中也不进删除候选。这些目录的价值不在「被代码
// 引用」，而在「作为基线可回归、作为目标可对照、作为产权归属不可动」。图谱如果
// 把它们列进删除候选，那这份图谱本身就成了下一次事故的起点。
// ============================================================================

import path from 'node:path'
import { readText, sorted, trackedFiles } from './repo.mjs'

/** 图谱产物目录。它自己不参与孤儿判定，也不计入提及索引。 */
export const GRAPH_OUTPUT_DIR = 'docs/graph'

/**
 * 图谱工具自身的源码，同样不计入提及索引。
 *
 * 这是自指 bug 的**第二次**出现，值得单独记一笔：产物目录排掉之后，我在
 * orphans.mjs 的注释里举了 `placeholders/OfflineAgenciesPage.tsx` 当例子说明
 * basename 误判 —— 下一次生成，这个文件就因为「被 scripts/project-graph/ 引用」
 * 从 low 升成了 high，也就是「动不得」。工具描述一个文件，被自己算成了这个文件
 * 还有人用。
 *
 * 教训不是「别在注释里写路径」，而是：**任何分析工具都必须把自己排除在分析域外**，
 * 否则它的输出会反过来喂进自己的输入。
 */
const GRAPH_TOOL_PATHS = [
  'scripts/project-graph/',
  'scripts/generate-project-graph.mjs',
  'scripts/project-graph-query.mjs',
]

/** 该文件是否属于图谱自身（产物或工具源码）。 */
export function isGraphSelf(file) {
  return (
    file.startsWith(`${GRAPH_OUTPUT_DIR}/`) ||
    GRAPH_TOOL_PATHS.some((prefix) => file === prefix || file.startsWith(prefix))
  )
}

export const PROTECTED = [
  {
    prefix: 'apps/miniapp/',
    reason: '原生微信小程序，归产品负责人所有；开发者工具直接打开该目录，任何改动都可能被误判为「小程序丢了」',
  },
  {
    prefix: 'docs/design/kiosk-proto-2026-07/',
    reason: 'Gen 1 只读历史原型，保留作回归测试基线；「没被业务代码引用」是它的正常状态，不是删除理由',
  },
  {
    prefix: 'docs/design/kiosk-proto-2026-07-fusion/sources/',
    reason: 'sha256 逐字节冻结的来源快照，任何字节变化都会让 fusion 基线门禁失效',
  },
  {
    prefix: 'docs/design/kiosk-ai-os-v3-2026-08/',
    reason: '当前 V6 目标设计，是「将要实现」而不是「已被引用」',
  },
  { prefix: '.github/', reason: 'CI / 部署编排' },
  { prefix: 'services/api/prisma/', reason: '数据库 schema 与迁移，生产数据底座' },
  { prefix: 'apps/terminal-agent/', reason: 'Windows 硬件链路（打印机 / 扫描仪 / U 盘）' },
  { prefix: 'docs/compliance/', reason: '合规边界，长期红线文档' },
]

export function protectionFor(file) {
  return PROTECTED.find((entry) => file.startsWith(entry.prefix)) ?? null
}

// ---------------------------------------------------------------------------
// 全仓「提及索引」
// ---------------------------------------------------------------------------
// CLAUDE.md §8 里的「无当前文档声明」这一条，机器化之后就是：这个路径有没有在
// 仓库里任何其它文件中被写到过。包括 markdown 链接、门禁里的字符串、CI 的 run
// 行、注释里的路径。命中即视为「还有人在说它」，不进零引用桶。

const TEXT_EXT =
  /\.(tsx?|mts|cts|mjs|cjs|jsx?|json|md|ya?ml|css|scss|html|prisma|sql|sh|ps1|txt|wxml|wxss|toml|env|example|gitignore|gitattributes)$/

// 2026-09-06 修：原来是 /[\w@][\w@.-]*(?:\/[\w@.-]+)+/g —— \w 只认 ASCII，
// 遇到中文文件名会在中文处截断：`docs/patent/对接清单.md` 只 tokenize 出 `docs/patent`。
// 后果：仓库里 5 个中文名跟踪文档全部被误判成「全仓零提及」进 orphans.md。
// 改用 Unicode 属性类 + u 标志，中日韩文件名同样能整段取出。
const PATH_TOKEN_PATTERN = /[\p{L}\p{N}@_][\p{L}\p{N}@._-]*(?:\/[\p{L}\p{N}@._-]+)+/gu

/**
 * 返回 { paths, basenames, ambiguousBasenames }
 *
 * ambiguousBasenames：仓库里存在同名不同路径的文件名集合。
 * 这类文件名**不能**用来判定「谁提到了我」—— 见 mentionsOf 的说明。
 */
export function buildMentionIndex(maxBytes = 2 * 1024 * 1024) {
  const paths = new Map()
  const basenames = new Map()

  // 先算出哪些 basename 在仓库里不唯一。
  // 本仓库真实存在 placeholders/OfflineAgenciesPage.tsx 与
  // offline-agencies/OfflineAgenciesPage.tsx 这种同名对，按文件名比对必然张冠李戴。
  const basenameCount = new Map()
  for (const file of trackedFiles()) {
    if (isGraphSelf(file)) continue
    const base = file.slice(file.lastIndexOf('/') + 1)
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1)
  }
  const ambiguousBasenames = new Set(
    [...basenameCount.entries()].filter(([, count]) => count > 1).map(([base]) => base),
  )

  for (const file of trackedFiles()) {
    // 排除图谱自己的产物。它列举了仓库里几乎每一个路径，一旦计入提及索引，
    // 「全仓没有任何其它文件提到它」这条判据对所有文件都恒假 —— 实测会把孤儿
    // 候选从 161 条压到 45 条，protected 一条不剩。图谱不能把自己算作引用。
    if (isGraphSelf(file)) continue
    if (!TEXT_EXT.test(file) && !file.endsWith('package.json')) continue
    const text = readText(file)
    if (!text || text.length > maxBytes) continue

    for (const [token] of text.matchAll(PATH_TOKEN_PATTERN)) {
      if (!paths.has(token)) paths.set(token, new Set())
      paths.get(token).add(file)
    }
    // 文档里常只写文件名（如「见 CareerPlanPage.tsx」），也算一次提及
    for (const [, base] of text.matchAll(/\b([\w-]+\.(?:tsx?|mjs|css|md|prisma))\b/g)) {
      if (!basenames.has(base)) basenames.set(base, new Set())
      basenames.get(base).add(file)
    }
  }

  return { paths, basenames, ambiguousBasenames }
}

/** 除自身之外，还有哪些文件提到了 target。 */
export function mentionsOf(target, index) {
  const hits = new Set()
  const segments = target.split('/')

  // 完整路径，以及各级后缀（文档里常写 `src/pages/x/Y.tsx` 这种包内相对路径）
  for (let i = 0; i < segments.length; i += 1) {
    const suffix = segments.slice(i).join('/')
    if (!suffix.includes('/')) break
    for (const file of index.paths.get(suffix) ?? []) if (file !== target) hits.add(file)
  }

  // 文件名兜底匹配：只在该文件名全仓唯一时才算数。
  //
  // 不加这个前提就会张冠李戴 —— 实测踩过：placeholders/OfflineAgenciesPage.tsx 被
  // 判成 high（「仍被门禁引用」），而门禁真正 read 的是 offline-agencies/ 目录下的
  // 同名文件。两个路径都真实存在，按 basename 比对分不开，结果把一个零引用死文件
  // 误报成「动不得」。docs/README.md 专门警告过这类比对，图谱既然按路径建索引，
  // 兜底也必须让位给路径。
  const base = segments[segments.length - 1]
  if (!index.ambiguousBasenames?.has(base)) {
    for (const file of index.basenames.get(base) ?? []) if (file !== target) hits.add(file)
  }

  return sorted([...hits])
}

// ---------------------------------------------------------------------------
// 风险分级
// ---------------------------------------------------------------------------

/**
 * risk:
 *   protected  硬名单，不得删除（附原因）
 *   high       仍被 CI / 门禁 / 部署 / 硬件链路提及
 *   medium     只被文档提及（删代码要连文档一起改，需人确认）
 *   low        全仓零提及、零 import、零路由
 */
export function classifyRisk(file, mentionFiles) {
  const protection = protectionFor(file)
  if (protection) return { risk: 'protected', why: protection.reason, mentions: mentionFiles }

  const ciMentions = mentionFiles.filter(
    (m) => m.startsWith('.github/') || /(^|\/)scripts\//.test(m) || m.endsWith('package.json'),
  )
  if (ciMentions.length > 0) {
    return { risk: 'high', why: `仍被 CI / 门禁 / 包脚本引用：${ciMentions.slice(0, 3).join('、')}`, mentions: mentionFiles }
  }

  const docMentions = mentionFiles.filter((m) => m.endsWith('.md'))
  if (docMentions.length > 0) {
    return { risk: 'medium', why: `仅被文档提及：${docMentions.slice(0, 3).join('、')}`, mentions: mentionFiles }
  }

  if (mentionFiles.length > 0) {
    return { risk: 'medium', why: `仍被其它文件提及：${mentionFiles.slice(0, 3).join('、')}`, mentions: mentionFiles }
  }

  return { risk: 'low', why: '全仓零提及：无路由、无 import、无门禁、无文档、无 CI', mentions: [] }
}

// ---------------------------------------------------------------------------
// 各类孤儿
// ---------------------------------------------------------------------------

const APP_SOURCE_EXT = /\.(tsx?|css)$/

/** 前端应用里从入口不可达的源文件。 */
export function findUnreachableAppFiles(appRoot, reachable, entries) {
  const candidates = trackedFiles().filter(
    (file) =>
      file.startsWith(`${appRoot}/src/`) &&
      APP_SOURCE_EXT.test(file) &&
      !file.endsWith('.d.ts') &&
      !entries.includes(file),
  )
  return candidates.filter((file) => !reachable.has(file))
}

/**
 * 存在于 scripts/ 但没有任何 package.json 脚本名指向它的门禁。
 *
 * 这是 verify:ci-gate-coverage 结构上看不见的一层：那条元门禁枚举的是
 * package.json 里**已声明**的脚本名，再拿去和 CI 闭包比。一个 .mjs 文件如果
 * 压根没被起过名字，它连枚举的入口都进不去，于是「写完就没跑过」不会有任何
 * 信号。helper（被别的门禁 import 的库）不算，它们本来就不该有脚本名。
 */
export function findUnwiredGates(gates) {
  return [...gates.values()]
    .filter((gate) => gate.scriptNames.length === 0 && !gate.helper)
    .map((gate) => gate.file)
    .sort()
}

/** 全仓没有任何其它文件提及的文档（图谱自己的产物不算文档，排除）。 */
export function findUnreferencedDocs(index) {
  const docs = trackedFiles().filter(
    (file) =>
      file.startsWith('docs/') &&
      file.endsWith('.md') &&
      !file.startsWith(`${GRAPH_OUTPUT_DIR}/`),
  )
  return docs.filter((file) => mentionsOf(file, index).length === 0)
}

export function groupByRisk(entries) {
  const groups = { protected: [], high: [], medium: [], low: [] }
  for (const entry of entries) groups[entry.risk].push(entry)
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  }
  return groups
}

export function dirnameOf(file) {
  return path.posix.dirname(file)
}
