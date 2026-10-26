// verify:kiosk-touch-frozen — 「青序流光 · 触屏版」稿（docs/design/kiosk-touch-2026-10）补稿定稿后不许再改。
//
// 产品负责人 10/25 拍板首页、打印、简历三条主路以触屏版为准，并定「改程序前先补稿」；
// 10/26 他看过补稿后的稿并定了最后三件事（见该目录 README「补稿」）。从此运行页和稿不一致时
// 改运行页，不改稿。这条门禁把「不改稿」落成 CI：逐个文件比对 FROZEN.json 里记下的 sha256，
// 改动、新增、删除都算红。README.md 是说明文档，不在冻结范围。
// 做法照搬 2.0 稿的 verify-qingxu-v2-frozen.mjs，两条门禁各管各的目录。
//
// 真要改稿（只在产品负责人同意之后）：改完在 apps/kiosk 下跑
//   node scripts/verify-kiosk-touch-frozen.mjs --update
// 重写清单，并在 docs/progress/current-progress.md 写明谁同意的、改了什么、为什么。

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const draftDir = path.resolve(here, '../../../docs/design/kiosk-touch-2026-10')
const manifestPath = path.join(draftDir, 'FROZEN.json')
const NOT_FROZEN = new Set(['README.md', 'FROZEN.json'])

function currentHashes() {
  const out = {}
  for (const name of fs.readdirSync(draftDir).sort()) {
    const full = path.join(draftDir, name)
    if (NOT_FROZEN.has(name) || !fs.statSync(full).isFile()) continue
    out[name] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
  }
  return out
}

const current = currentHashes()

if (process.argv.includes('--update')) {
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
  const manifest = {
    frozenAt: previous?.frozenAt ?? new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10),
    note: '青序流光 · 触屏版，补稿定稿（产品负责人 2026-10-26 看过）。改稿须产品负责人同意，并在 current-progress.md 写明原因；README.md 不在冻结范围。',
    files: current,
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`已写入 ${path.relative(process.cwd(), manifestPath)}：${Object.keys(current).length} 个文件`)
  process.exit(0)
}

if (!fs.existsSync(manifestPath)) {
  console.error(`FAIL 找不到冻结清单 ${manifestPath}`)
  process.exit(1)
}

const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files ?? {}
if (Object.keys(frozen).length === 0) {
  console.error('FAIL 冻结清单是空的：触屏版稿文件一个都没登记，等于没冻结。')
  process.exit(1)
}
const problems = []
for (const [name, hash] of Object.entries(frozen)) {
  if (!(name in current)) problems.push(`删除了 ${name}`)
  else if (current[name] !== hash) problems.push(`改动了 ${name}`)
}
for (const name of Object.keys(current)) {
  if (!(name in frozen)) problems.push(`新增了 ${name}`)
}

if (problems.length) {
  console.error('FAIL 青序流光 · 触屏版稿已补稿定稿（2026-10-26），不许再改：')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('运行页和稿不一致时改运行页。若产品负责人同意改稿，改完跑 node scripts/verify-kiosk-touch-frozen.mjs --update，并在进度文档写明原因。')
  process.exit(1)
}
console.log(`PASS 青序流光 · 触屏版稿未被改动（${Object.keys(frozen).length} 个文件）`)
