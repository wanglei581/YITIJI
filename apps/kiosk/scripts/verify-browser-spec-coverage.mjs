#!/usr/bin/env node
/**
 * verify:kiosk-browser-spec-coverage —— 浏览器用例必须真的在 CI 里跑。
 *
 * ## 防的是什么
 *
 * 2026-09-08 实测：`apps/kiosk/tests/` 下 32 个 spec，**9 个从来没有在 CI 跑过** ——
 * 没有任何 playwright config 的 testMatch 命中它们，ci.yml 也没点名。其中三个
 * 当时已经对着 main **跑不过了**：
 *
 *   - human-journey（旅程 C）：迁移后列表卡片不再响应点击标题，用例一路停在列表页，
 *     却报成「岗位详情缺少来源四要素」——一条看着像合规回归的假信号。
 *   - job-fair-policy-journey：同一个根因。
 *   - resume-optimize-draft：钉的是「手动逐项修改」的旧去向，稿 23 已改。
 *
 * 也就是说：**用例写了、评审过、合进 main，然后静静地烂掉，谁都不知道。**
 * ci.yml 里 `test:browser:truth` 那段注释记的是同一件事的上一次发作
 * （「此前在 package.json 里有定义，却没有任何 CI job 引用它」）——
 * 靠人记住是记不住的，得有门禁。
 *
 * ## 怎么判
 *
 * 从 ci.yml 里抽出所有被调用的 `test:browser*` 脚本 → 解析 package.json 里
 * 对应的命令 → 显式文件名直接算覆盖，`--config` 则读该 config 的 testMatch 正则
 * 去匹配。剩下的就是「没人跑」的。
 *
 * 豁免必须写理由，且**只许减不许增**（与 verify-ci-gate-coverage.mjs 同口径）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const kioskRoot = resolve(here, '..')
const repoRoot = resolve(kioskRoot, '../..')

/**
 * 明确不进 CI 的 spec，每条必须写清「为什么不该进」。
 * 这不是「先记下来以后再说」的清单 —— 想加新条目，先问它是不是其实该进 CI。
 */
const EXEMPT = new Map([
  [
    'ai-resume-journey.spec.ts',
    '按需联调脚本：playwright.interaction.config.ts 顶部注释即写明手动执行命令，'
      + '跑的是真实 AI provider，进 CI 会产生外部调用与费用。',
  ],
  [
    'kiosk-p1-visual-evidence.spec.ts',
    '证据产出脚本（playwright.p1-evidence.config.ts），用途是生成验收截图而不是断言，'
      + '没有失败判据，进 CI 只会浪费时间。',
  ],
])

const ciYml = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(kioskRoot, 'package.json'), 'utf8')).scripts ?? {}

function listSpecs(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...listSpecs(full))
    else if (name.endsWith('.spec.ts')) out.push(name)
  }
  return out
}
const specs = [...new Set(listSpecs(join(kioskRoot, 'tests')))].sort()

const invoked = [...new Set(ciYml.match(/test:browser[a-z:0-9-]*/g) ?? [])]
const covered = new Set()
for (const script of invoked) {
  const cmd = pkg[script]
  if (!cmd) continue
  for (const file of cmd.match(/tests\/\S+?\.spec\.ts/g) ?? []) covered.add(basename(file))
  for (const cfgName of cmd.match(/--config[= ]([^\s]+)/g) ?? []) {
    const cfgPath = join(kioskRoot, cfgName.replace(/^--config[= ]/, ''))
    let cfg
    try { cfg = readFileSync(cfgPath, 'utf8') } catch { continue }
    const tm = cfg.match(/testMatch:\s*\/(.+?)\/[a-z]*\s*,/)
    // 没写 testMatch 的 config 会跑 testDir 下全部
    if (!tm) { specs.forEach((s) => covered.add(s)); continue }
    const rx = new RegExp(tm[1])
    specs.filter((s) => rx.test(s)).forEach((s) => covered.add(s))
  }
  if (/^playwright test$/.test(cmd.trim())) specs.forEach((s) => covered.add(s))
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}

const orphans = specs.filter((s) => !covered.has(s) && !EXEMPT.has(s))
check(
  '每个浏览器 spec 都在 CI 执行闭包内',
  orphans.length === 0,
  `以下 spec 没有任何 CI 步骤会跑到：\n      ${orphans.join('\n      ')}\n`
    + '    要么把它挂进 ci.yml 的某个 test:browser* 脚本，要么在本门禁的 EXEMPT 里写明为什么不该跑。',
)

// 豁免只许减不许增：写下当前值，改大必须显式改这个数并说明。
const EXEMPT_LIMIT = 2
check(
  `豁免条目不超过 ${EXEMPT_LIMIT} 条（只许降）`,
  EXEMPT.size <= EXEMPT_LIMIT,
  `当前 ${EXEMPT.size} 条。新增豁免等于新增「写了但不跑」的用例，先问它是不是其实该进 CI。`,
)

for (const [spec, reason] of EXEMPT) {
  check(`豁免「${spec}」写了理由`, reason.trim().length >= 20, '理由太短，看不出为什么不该进 CI')
  check(`豁免「${spec}」确实存在`, specs.includes(spec), '文件已删除或改名，豁免条目应一并清理')
}

check('CI 确实调用了 kiosk 浏览器脚本', invoked.length > 0, 'ci.yml 里一个 test:browser* 都没有，本门禁失去判别力')
check(
  '被调用的脚本都在 package.json 里有定义',
  invoked.every((s) => pkg[s]),
  `未定义：${invoked.filter((s) => !pkg[s]).join(', ')}`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n共 ${specs.length} 个 spec，CI 覆盖 ${covered.size}，豁免 ${EXEMPT.size}`)
console.log(`${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} 项失败`} — 浏览器用例 CI 覆盖`)
process.exit(failed.length === 0 ? 0 : 1)
