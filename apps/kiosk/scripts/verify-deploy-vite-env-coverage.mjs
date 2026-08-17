// 门禁：kiosk 代码读到的 VITE_* 必须与 deploy.yml 实设值对齐，差集必须显式登记。
//
// 为什么需要这条门禁：
// 代码里 `import.meta.env.VITE_X` 在构建期没被设置时不会报错，只会静默变成 undefined。
// 于是「新增一个开关」和「部署时忘了设这个开关」这两件事之间没有任何机制约束。
// VITE_ENABLE_CONTRACT_REVIEW 就是活例子：功能代码、7 个后端端点、隐私治理全都在，
// 但它从未出现在 deploy.yml，于是一体机生产上入口不渲染、路由回首页、chunk 不打包 ——
// 这个功能在生产上从来不存在，而没有任何红灯提示过这件事。
//
// 本门禁不替产品负责人做决定，只让缺口可见：差集里的每一个变量都必须在
// deploy-env-registry.json 里登记，并写明「为什么不需要在 deploy.yml 设」。
// 未登记即红。登记条目也必须真实（不能登记一个代码里根本不读的变量）。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '..', '..')

const VITE_RE = /VITE_[A-Z0-9_]+/g
const VALID_STATUS = new Set(['deploy-set', 'terminal-local', 'safe-default', 'pending-decision'])

/** 代码里实际读到的 VITE_*（含 vite.config.ts —— 它也在构建期读 env）。 */
function readVarsUsedInCode() {
  // 用 git ls-files 而非 find：只看被跟踪的源文件，不受 node_modules / dist / 本地脏文件影响。
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', 'apps/kiosk/src', 'apps/kiosk/vite.config.ts'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  )
  const files = listed.split('\0').filter(Boolean)
  assert.ok(files.length > 0, 'git ls-files 未列出任何 kiosk 源文件，门禁无法取证')

  const used = new Set()
  for (const rel of files) {
    if (!/\.(ts|tsx|js|jsx|mts|cts)$/.test(rel)) continue
    // vite-env.d.ts 只是类型声明，不代表运行时真的读；但声明了却没人读也是一种漂移，
    // 这里仍计入 —— 宁可要求登记，也不要漏掉一个开关。
    const text = readFileSync(join(repoRoot, rel), 'utf8')
    for (const m of text.match(VITE_RE) ?? []) used.add(m)
  }
  return used
}

/** deploy.yml 里给 kiosk 构建实际设置的 VITE_*。 */
function readVarsSetForKioskBuild() {
  const deploy = readFileSync(join(repoRoot, '.github/workflows/deploy.yml'), 'utf8')
  const marker = 'pnpm build:kiosk:production'
  const at = deploy.indexOf(marker)
  assert.notEqual(
    at,
    -1,
    'deploy.yml 里找不到 `pnpm build:kiosk:production`：kiosk 构建方式变了，本门禁的取证锚点需同步更新',
  )
  // 取该构建命令之前、最近一个「非 VITE_ 赋值」行之后的连续赋值块。
  const before = deploy.slice(0, at).split('\n')
  const set = new Set()
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const line = before[i].trim()
    if (line === '') continue
    const m = /^(VITE_[A-Z0-9_]+)=/.exec(line)
    if (!m) break
    set.add(m[1])
  }
  assert.ok(set.size > 0, 'deploy.yml kiosk 构建块里没解析到任何 VITE_ 赋值，取证失败')
  return set
}

const used = readVarsUsedInCode()
const set = readVarsSetForKioskBuild()

const registry = JSON.parse(readFileSync(join(kioskRoot, 'deploy-env-registry.json'), 'utf8'))
assert.ok(Array.isArray(registry.variables), 'deploy-env-registry.json 必须有 variables 数组')

const byName = new Map()
for (const entry of registry.variables) {
  assert.ok(typeof entry.name === 'string' && VITE_RE.test(entry.name), `登记项 name 非法：${entry.name}`)
  VITE_RE.lastIndex = 0
  assert.ok(VALID_STATUS.has(entry.status), `登记项 ${entry.name} 的 status 非法：${entry.status}`)
  assert.ok(
    typeof entry.reason === 'string' && entry.reason.trim().length >= 20,
    `登记项 ${entry.name} 必须写明理由（≥20 字），当前：${JSON.stringify(entry.reason)}`,
  )
  assert.ok(!byName.has(entry.name), `登记项 ${entry.name} 重复`)
  byName.set(entry.name, entry)
}

const failures = []

// 1. 代码读到但 deploy.yml 没设的，必须登记。
for (const name of [...used].sort()) {
  if (set.has(name)) continue
  if (!byName.has(name)) {
    failures.push(
      `${name}：kiosk 代码读它，但 deploy.yml 没设，也没在 deploy-env-registry.json 登记。\n` +
        `    生产构建里它恒为 undefined。请在登记表写明「为什么不需要设」，或在 deploy.yml 补上。`,
    )
  }
}

// 2. 登记为 deploy-set 的，必须真的在 deploy.yml 里。
for (const [name, entry] of byName) {
  if (entry.status === 'deploy-set' && !set.has(name)) {
    failures.push(`${name}：登记为 deploy-set，但 deploy.yml 的 kiosk 构建块里并没有设置它。`)
  }
}

// 3. 登记表不得留下代码里已经不读的陈旧条目。
for (const [name] of byName) {
  if (!used.has(name)) {
    failures.push(`${name}：已登记，但 kiosk 代码里已无人读取。请从 deploy-env-registry.json 移除。`)
  }
}

// 4. deploy.yml 设了但代码不读 —— 属无效配置，容易让人以为某功能已开。
for (const name of set) {
  if (!used.has(name)) {
    failures.push(`${name}：deploy.yml 设了它，但 kiosk 代码里没有任何地方读取。属无效配置。`)
  }
}

if (failures.length > 0) {
  console.error('FAIL kiosk 构建期 VITE_* 覆盖度门禁\n')
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    `\n代码读到 ${used.size} 个，deploy.yml 设了 ${set.size} 个，登记 ${byName.size} 个。`,
  )
  process.exit(1)
}

const pending = [...byName.values()].filter((e) => e.status === 'pending-decision')
console.log(
  `PASS kiosk VITE_* 覆盖度：代码读 ${used.size} / deploy.yml 设 ${set.size} / 登记 ${byName.size}` +
    (pending.length > 0 ? `（其中 ${pending.length} 项待裁决：${pending.map((e) => e.name).join('、')}）` : ''),
)
