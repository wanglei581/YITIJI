#!/usr/bin/env node
/**
 * verify:kiosk-visual-unity — 视觉统一防回归守卫（W6）
 *
 * 锁定 2026-07-25 视觉统一结论：
 * 1) 唯一共享壳：KioskLayout + kiosk-shell/components + KioskPageFrame
 * 2) 全路由 service-desk + fusion-youth，无 legacy 主题分叉
 * 3) 首页不再自绘顶栏/底栏
 * 4) 页面 CSS 不得再散落裸 hex（token 定义文件除外）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkShellChromeProp } from './lib/shell-chrome-contract.mjs'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(kioskRoot, '..', '..')
const read = (absOrRel, base = kioskRoot) => {
  const full = absOrRel.startsWith('/') ? absOrRel : join(base, absOrRel)
  return existsSync(full) ? readFileSync(full, 'utf8') : ''
}

let failed = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failed += 1
  console.error(`  FAIL ${m}`)
}
const expect = (cond, m) => (cond ? pass(m) : fail(m))

function walkCss(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkCss(full, out)
    else if (name.endsWith('.css')) out.push(full)
  }
  return out
}

console.log('\n=== Kiosk visual unity 防回归合同 ===\n')

const pkg = read('package.json')
const root = read('src/layouts/KioskRoot.tsx')
const home = read('src/pages/home/HomePage.tsx')
const indexCss = read('src/index.css')
const shellCss = read(join(repoRoot, 'packages/ui/src/styles/kiosk-shell.css'), '/')
const frame = read(join(repoRoot, 'packages/ui/src/components/KioskPageFrame.tsx'), '/')
const topbar = read(join(repoRoot, 'packages/ui/src/components/KioskTopbar.tsx'), '/')
const layout = read(join(repoRoot, 'packages/ui/src/layouts/KioskLayout.tsx'), '/')

expect(
  pkg.includes('"verify:kiosk-visual-unity": "node scripts/verify-kiosk-visual-unity.mjs"'),
  'package.json 注册 verify:kiosk-visual-unity'
)

expect(
  existsSync(join(repoRoot, 'packages/ui/src/styles/kiosk-shell.css')),
  '共享 kiosk-shell.css 存在'
)
expect(
  existsSync(join(repoRoot, 'packages/ui/src/styles/kiosk-components.css')),
  '共享 kiosk-components.css 存在'
)
expect(indexCss.includes('@ai-job-print/ui/styles/kiosk-shell.css'), 'index.css 导入 kiosk-shell')
expect(
  indexCss.includes('@ai-job-print/ui/styles/kiosk-components.css'),
  'index.css 导入 kiosk-components'
)
expect(indexCss.includes('@ai-job-print/ui/styles/fusion-youth.css'), 'index.css 导入 fusion-youth')
{
  const sd = indexCss.indexOf('@ai-job-print/ui/styles/service-desk.css')
  const shell = indexCss.indexOf('@ai-job-print/ui/styles/kiosk-shell.css')
  expect(
    sd >= 0 && shell >= 0 && sd < shell,
    'index.css 中 service-desk 在 kiosk-shell 之前（fusion 可覆盖冰蓝）'
  )
}

expect(/visualTheme="service-desk"/.test(root), 'KioskRoot 全路由固定 service-desk')
expect(/presentation="fusion-youth"/.test(root), 'KioskRoot 全路由固定 fusion-youth')
expect(!root.includes('SERVICE_DESK_EXACT_ROUTES'), '无 SERVICE_DESK 路由白名单分叉')
expect(!/visualTheme=\{isServiceDeskRoute/.test(root), '无 legacy/service-desk 三元切换')
// 与 verify:fusion-shell / verify:kiosk-runtime-error-boundary 用同一判据。
// 原先三处各自逐字匹配 hideHeader={isCampusZone}，新增一条同样合法的遮蔽条件
// （isQxRoute）会让三条门禁一起误红。判据与故障注入自测见
// scripts/lib/shell-chrome-contract.mjs 文件头。
for (const propName of ['hideHeader', 'hideBottomNav']) {
  const chrome = checkShellChromeProp(root, propName)
  expect(chrome.ok, `KioskRoot ${propName}：${chrome.reason ?? ''}`)
}
expect(
  checkShellChromeProp(root, 'hideBottomNav').disjuncts?.includes('usesPageActionbar') === true,
  '行动条流程页以页面操作栏替代共享底栏（usesPageActionbar 必须仍是判据之一）'
)
expect(/useTerminalDeviceStatus\(\s*true\s*\)/.test(root), '共享顶栏始终拉取真实设备状态')
expect(root.includes('<KioskTopbarStatus'), '共享顶栏注入时钟+设备状态胶囊')
expect(root.includes('KioskStageFit'), 'KioskRoot 使用设计稿舞台等比适配')
expect(indexCss.includes('kiosk-stage-fit.css'), 'index.css 导入 kiosk-stage-fit')
{
  const stageFit = read(join(kioskRoot, 'src/styles/kiosk-stage-fit.css'))
  const hook = read(join(kioskRoot, 'src/hooks/useKioskStageFit.ts'))
  expect(
    stageFit.includes('.kiosk-stage-host') && stageFit.includes('.kiosk-stage'),
    'stage-fit CSS 定义宿主与舞台'
  )
  expect(
    /KIOSK_STAGE_WIDTH\s*=\s*1080/.test(hook) && /KIOSK_STAGE_HEIGHT\s*=\s*1920/.test(hook),
    '舞台尺寸固定 1080×1920'
  )
}

expect(
  !/function KioskTopBar/.test(home) && !/function HomeNavbar/.test(home),
  '首页不再自绘顶栏/底栏组件'
)
expect(
  home.includes('className="v6-home-page"') && !home.includes('kpv1--content-only'),
  '首页内容区只声明 V6 页面作用域'
)
expect(home.includes('KioskPageFrame'), '首页使用 KioskPageFrame')

expect(layout.includes('ui-kiosk-topbar') || topbar.includes('ui-kiosk-topbar'), '共享顶栏类名存在')
expect(layout.includes('ui-kiosk-nav'), '共享底栏类名存在')
expect(frame.includes('ui-kiosk-page-frame'), 'KioskPageFrame 使用统一 page-frame')
expect(
  shellCss.includes("[data-kiosk-presentation='fusion-youth']"),
  'kiosk-shell 作用域绑定 fusion-youth'
)

// 新 V6 运行时 CSS 必须只消费语义 token。旧页面的既有裸 hex 逐页迁移时清退；
// allowlist 只冻结历史债务文件，任何新文件或新 V6 文件出现裸 hex 都会打红。
const pageCssFiles = walkCss(join(kioskRoot, 'src'))
const hexRe = /#[0-9a-fA-F]{3,8}\b/g
const legacyHexAllowlist = new Set([
  'src/pages/assistant/assistant-advisor.css',
  'src/pages/print/print-prototype.css',
  'src/pages/print/styles/print-cashier.css',
  'src/pages/print-scan/styles/print-scan-uplift.css',
  'src/styles/kiosk-uplift.css',
  'src/styles/prototype-v1.css',
  'src/styles/warm-professional-override.css',
])
// 判定只看 allowlist 之外的文件，报错证据必须跟判定同源：
// 早先这里的 offenders 样例是不过滤 allowlist 直接收集的，于是 2 处真违规会
// 报成「总计 146」并举冻结债务文件当例子，把人指向根本不需要动的文件。
let frozenHex = 0
// 令牌定义文件必须写字面 hex——那是它的职责，令牌总得从某处取到值。
// 本文件头第 4 条早就写着「token 定义文件除外」，只是此前没有实现。
//
// 豁免范围卡死为「只做令牌声明」的文件：整份内容除注释外只能是
// `:root { --x: value }` 这类声明块，出现任何选择器规则即不豁免。
// 判定用 isTokenDefinitionFile() 逐文件实算，不靠路径白名单——
// 靠路径白名单就会变成一个口子：谁把业务样式塞进 tokens.css 都能蒙混过关。
const isTokenDefinitionFile = (source) => {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').trim()
  if (!stripped) return false
  const blocks = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  if (blocks.length === 0) return false
  return blocks.every(([, selector, body]) => {
    if (selector.trim() !== ':root') return false
    return body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .every((d) => d.startsWith('--'))
  })
}

const offenders = []
const unexpectedHexFiles = new Set()
for (const file of pageCssFiles) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(kioskRoot, file)
  const frozen = legacyHexAllowlist.has(rel) || isTokenDefinitionFile(text)
  for (const match of text.matchAll(hexRe)) {
    const look = text.slice(Math.max(0, match.index - 40), match.index)
    if (/var\([^)]*,\s*$/.test(look)) continue
    if (frozen) {
      frozenHex += 1
      continue
    }
    unexpectedHexFiles.add(rel)
    if (offenders.length < 8) offenders.push(`${rel}:${match[0]}`)
  }
}
expect(
  unexpectedHexFiles.size === 0,
  `V6/新增页面 CSS 无裸 hex（待清退 ${offenders.length} 处 / ${unexpectedHexFiles.size} 文件${
    offenders.length ? `：${offenders.join(', ')}` : ''
  }；另有 ${frozenHex} 处冻结历史债务不计入判定）`
)

// token 定义文件必须继续持有原型色真值
const fusionYouth = read(join(repoRoot, 'packages/ui/src/styles/fusion-youth.css'), '/')
expect(
  fusionYouth.includes('#1f9e86') && fusionYouth.includes('#10302b'),
  'fusion-youth 仍定义青绿/墨绿真值'
)
expect(
  shellCss.includes('--k-teal') && shellCss.includes('--k-ink'),
  'kiosk-shell 暴露 --k-* 语义别名'
)

if (failed > 0) {
  console.error(`\nFAIL ${failed} 项 — kiosk visual unity 合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS — kiosk visual unity 合同满足\n')
