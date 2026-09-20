/**
 * 从稿 16-service-hubs.html 的 `const H` 机械抽出五份服务台规格 → serviceHubSpecs.ts。
 *
 * 手抄是漏掉诚实性声明最常见的来源，所以这里不手抄：直接把稿里那段字面量 eval 出来。
 * 稿改了就重跑本脚本，不要手改 serviceHubSpecs.ts。
 *
 * 两种用法：
 *   · 生成：node apps/kiosk/scripts/extract-service-hub-specs.mjs        （改稿后重跑）
 *   · 对账：`verify:service-entry-readiness` 门禁 import SERVICE_HUB_SPECS_TEXT
 *           与磁盘上的 serviceHubSpecs.ts 逐字节比对。
 *
 * 为什么要有对账这一半：本脚本不进门禁闭包就只是一次性工具，而这份 12KB 的规格
 * 是「稿 → 代码」的转录面——**转录漂移正是这批迁移反复出问题的形态**
 * （2026-09-10 那版漏掉稿里的 `quick`，15 条通往「我的」台账的入口静默消失）。
 * 接进门禁后，手改 specs 或改了稿没同步，都会当场变红。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '..', '..')
const DRAFT = join(repoRoot, 'docs/design/kiosk-redesign-2026-08/16-service-hubs.html')
const OUT = join(kioskRoot, 'src/pages/service-hubs/serviceHubSpecs.ts')

const html = readFileSync(DRAFT, 'utf8')
const start = html.indexOf('const H={')
const end = html.indexOf('\n/* hub key', start)
if (start < 0 || end < 0) throw new Error('稿里找不到 const H 字面量，抽取中止')
const H = vm.runInNewContext(`${html.slice(start, end)}\nH`)

const HUBS = ['resume', 'jobs', 'fairs', 'interview', 'policy']
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// 卡片 kind 直接取稿的第 7 位（ai / device / info）。
// 常用入口稿里没标 kind，按**路由前缀机械判定**：`/me/` 是本人在线台账
// （后端不可达时进去只会是错误页，旧壳的 apiBlocked 同样禁用它们）→ 'account'；其余 'info'。
const quickKind = (route) => (route.startsWith('/me/') ? 'account' : 'info')

const body = HUBS.map((key) => {
  const h = H[key]
  const goals = h.first
    .map(([label, , route]) => `      { label: ${q(label)}, route: ${q(route)} },`)
    .join('\n')
  const caps = h.cards
    .map(
      ([title, description, , badge, , route, kind]) =>
        `      { title: ${q(title)}, description: ${q(description)}, badge: ${q(badge)}, route: ${q(route)}, kind: ${q(kind)} },`,
    )
    .join('\n')
  const quick = h.quick
    .map(
      ([title, description, , , route]) =>
        `      { title: ${q(title)}, description: ${q(description)}, route: ${q(route)}, kind: ${q(quickKind(route))} },`,
    )
    .join('\n')
  return `  ${key}: {
    eyebrow: ${q(h.eyebrow)},
    title: ${q(h.title)},
    subtitle: ${q(h.subtitle)},
    goals: [
${goals}
    ],
    sectionTitle: ${q(h.section)},
    sectionHint: ${q(h.hint)},
    capabilities: [
${caps}
    ],
    quickLinks: [
${quick}
    ],
    truthTitle: ${q(h.truthTitle)},
    truth: ${q(h.truth)},
    noteTitle: ${q(h.noteTitle)},
    note: ${q(h.note)},
  },`
}).join('\n')

const header = `import type { ServiceHubKey, ServiceHubSpec } from './serviceHubModel'

/**
 * 五份规格**机械抽自** docs/design/kiosk-redesign-2026-08/16-service-hubs.html 的 \`const H\`。
 * 抽取脚本：apps/kiosk/scripts/extract-service-hub-specs.mjs。稿改了重跑它，别手改本文件。
 *
 * 手抄是漏掉诚实性声明最常见的来源——这批迁移里已经因为手抄漏过多次。
 * 一次历史教训写在这里：2026-09-10 的那版抽取**漏了稿里的 \`quick\`**（每个 hub 3 条
 * 「常用入口」），于是 15 条通往「我的」台账的真实入口（/me/resumes、/me/ai-records、
 * /me/activity、/interview/reports…）在迁移里静默消失。本文件把 quick 一并抽出为
 * \`quickLinks\`，缺一条就是丢一个入口。
 */
export const SERVICE_HUB_SPECS: Record<ServiceHubKey, ServiceHubSpec> = {
`

const footer = `}
`

/** 抽取结果。模块加载只读稿、不写盘；落盘只发生在直接运行本脚本时。 */
export const SERVICE_HUB_SPECS_TEXT = header + body + '\n' + footer
export const SERVICE_HUB_SPECS_PATH = OUT
export const SERVICE_HUB_SPECS_COUNTS = {
  hubs: HUBS.length,
  cards: HUBS.reduce((n, k) => n + H[k].cards.length, 0),
  goals: HUBS.reduce((n, k) => n + H[k].first.length, 0),
  quick: HUBS.reduce((n, k) => n + H[k].quick.length, 0),
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(OUT, SERVICE_HUB_SPECS_TEXT)
  console.log('written', OUT, '|', JSON.stringify(SERVICE_HUB_SPECS_COUNTS))
}
