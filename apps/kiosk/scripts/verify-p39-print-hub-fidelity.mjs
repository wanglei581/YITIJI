// ============================================================
// verify:p39-print-hub-fidelity — 打印扫描 Hub 青序流光保真门禁
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/10-print-hub.html
// 守的是「生产页有没有从原型漂走」：
//   A. 文案保真（原型 ∩ 生产）
//   B. 结构：八张能力卡 + 到机码不在能力键里
//   C. 状态轴：探测轴 + MFP 轴 fail-closed
//   D. 触控：aria-disabled，不用 title / 原生 disabled
//   E. 不宣称不存在的能力
// ============================================================
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const PROTOTYPE = join(repoRoot, 'docs/design/kiosk-redesign-2026-08/10-print-hub.html')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}
const must = (cond, m) => (cond ? pass(m) : fail(m))

const proto = readFileSync(PROTOTYPE, 'utf8')
const homeSrc = read('src/pages/print-scan/PrintScanHomePage.tsx')
const viewSrc = read('src/pages/print-scan/components/QxPrintHubView.tsx')
const contentSrc = read('src/pages/print-scan/printHubContent.ts')
const featureSrc = read('src/pages/print-scan/PrintScanFeatureInfoPage.tsx')
const cssSrc = read('src/pages/print-scan/styles/print-hub-qx.css')
const rootSrc = read('src/layouts/KioskRoot.tsx')
const productionSrc = `${homeSrc}\n${viewSrc}\n${contentSrc}\n${featureSrc}`

console.log('\n=== 打印扫描 Hub · 青序流光保真门禁 ===')

console.log('\n[A] 文案保真（原型 ∩ 生产）')
const COPY = [
  '到机码核销',
  '不是取件码',
  '8 位数字到机码',
  '要办什么',
  '已下过单 · 我的文件',
  'U 盘导入打印',
  '服务状态无法确认',
  '正在检查本机能力',
  '打印扫描一体机离线 —— 要出纸的停了，其余照常',
  '有几项被管理员关掉了',
  '证件照：本机尚未开放',
  '没有这项能力说明',
  '请直接在奔图机器面板上操作',
  '本机网页没有复印流程',
  '能力与设备状态以办理时确认',
]
for (const line of COPY) {
  if (!proto.includes(line)) {
    fail(`原型里找不到这句（请先核对 10-print-hub.html，不要改原型）：「${line}」`)
    continue
  }
  must(productionSrc.includes(line), `文案已迁移：「${line}」`)
}

console.log('\n[B] 结构保真')
must(/data-qx-page=["']print-hub["']/.test(viewSrc), '保留青序设计语言标记 data-qx-page="print-hub"')
must(
  /data-w2-page=["']print-scan-home["']/.test(viewSrc),
  '保留路由归属标记 data-w2-page="print-scan-home"'
)
must(/QxPageFrame/.test(homeSrc), 'Hub 使用 QxPageFrame')
must(/isQxMigratedPath\(pathname\)/.test(rootSrc), '带参路由走具名谓词，不只 Set.has')
must(/\/print-scan\/feature\//.test(rootSrc), '前缀列表收录 /print-scan/feature/')
must(
  !/QX_MIGRATED_PREFIXES\s*=\s*\[[^\]]*['"]\/print-scan['"]/.test(rootSrc),
  '前缀不是 /print-scan（会误伤 convert / sign）'
)
must(/['"]\/print-scan['"]/.test(rootSrc), '精确集合收录 /print-scan')

const capsBlock = /const CAPABILITIES:[\s\S]*?\n\]/.exec(homeSrc)
must(Boolean(capsBlock), 'CAPABILITIES 声明存在')
if (capsBlock) {
  const keys = [...capsBlock[0].matchAll(/^\s{4}key: '([^']+)'/gm)].map((m) => m[1])
  must(keys.length === 8, `能力卡恰好 8 张（实测 ${keys.length}）`)
  must(
    !keys.some((k) => /pickup|arrival/.test(k)),
    '到机码核销不占能力卡格子'
  )
  const expected = ['doc', 'phone', 'usb', 'photo', 'scan', 'convert', 'sign', 'idphoto']
  const caps = [...capsBlock[0].matchAll(/^\s{4}cap: '([^']+)'/gm)].map((m) => m[1])
  must(
    JSON.stringify(caps) === JSON.stringify(expected),
    `八张卡按原型栅格顺序排列（期望 ${expected.join('/')}）`
  )
}

must(
  /ARRIVAL_CODE_ENTRY[\s\S]{0,800}?to: '\/print\/pickup-claim'/.test(homeSrc),
  '到机码入口指向 /print/pickup-claim'
)
must(
  /不是付款后的取件凭证码/.test(homeSrc),
  '卡面写明它不是付款后生成的「取件凭证码」'
)

console.log('\n[C] 状态轴保真')
must(/useTerminalDeviceStatus/.test(homeSrc), 'MFP 轴接 GET /terminals/:id/printer-status')
must(/loadConfiguredCapabilities/.test(homeSrc), '能力探测轴接 GET /terminals/:id/capabilities')
must(
  /device\.kind === 'offline' \|\| device\.kind === 'error'\s*\n?\s*\?\s*'unavailable'/.test(homeSrc),
  "只有 kind 为 offline / error 才判定 unavailable —— unknown 不得被渲染成「离线」"
)
must(
  /tone: 'unknown'/.test(contentSrc) && /能力与设备状态以办理时确认/.test(contentSrc),
  '默认态顶栏胶囊不得声称设备正常'
)
must(
  !/tone: 'ok'/.test(contentSrc.replace(/'ok' \| 'warn' \| 'bad' \| 'unknown'/, '')),
  'Hub 胶囊枚举不使用 tone=ok 作为默认设备正常'
)

const needsMfp = [...homeSrc.matchAll(/cap: '([^']+)',[\s\S]{0,500}?needsMfp: (true|false)/g)].map(
  (m) => [m[1], m[2] === 'true']
)
const needsMfpMap = Object.fromEntries(needsMfp)
for (const [cap, expected] of [
  ['doc', true],
  ['scan', true],
  ['photo', true],
  ['idphoto', false],
  ['phone', false],
  ['usb', false],
  ['convert', false],
  ['sign', false],
]) {
  must(
    needsMfpMap[cap] === expected,
    `${cap} ${expected ? '要' : '不要'}这台 MFP 动起来（原型 device-off 分界）`
  )
}

const cardCapabilityKeyBlock = /const CARD_CAPABILITY_KEY[^=]*=\s*\{([\s\S]*?)\n\}/.exec(homeSrc)
must(Boolean(cardCapabilityKeyBlock), 'CARD_CAPABILITY_KEY 仍然声明')
if (cardCapabilityKeyBlock) {
  must(
    !/pickup|arrival/.test(cardCapabilityKeyBlock[1]),
    '到机码核销不登记进 CARD_CAPABILITY_KEY'
  )
}

console.log('\n[D] 触控与可达性')
must(!/\btitle=/.test(viewSrc), '不用 title 承载任何信息')
must(
  /aria-disabled=\{closed \|\| undefined\}/.test(viewSrc),
  '能力门禁型停用用 aria-disabled'
)
must(
  /onClick=\{closed \? undefined :/.test(viewSrc),
  '停用态在 onClick 内短路'
)
must(/--qx-tap-min/.test(cssSrc), '触控下限走 --qx-tap-min')
must(/min-height:\s*196px/.test(cssSrc), '能力卡高度远高于 48px')
must(/QxPageFrame/.test(featureSrc), '说明页同样使用 QxPageFrame')
must(/feature-id-photo/.test(featureSrc) && /feature-not-found/.test(featureSrc), '说明页覆盖两个 feature 态')

console.log('\n[E] 能力真实性')
const FORBIDDEN_COPY = [
  ['规格体检与换底', '证件照规格体检 / 换底前后端均无实现'],
  ['一键投递', '合规红线'],
  ['立即投递', '合规红线'],
  ['平台投递', '合规红线'],
  ['设备正常', 'Hub 不得默认声称设备正常'],
]
for (const [line, why] of FORBIDDEN_COPY) {
  must(!productionSrc.includes(line), `不宣称：「${line}」（${why}）`)
}

console.log(
  failures === 0
    ? '\n✅ 打印扫描 Hub 青序流光保真门禁通过\n'
    : `\n❌ 打印扫描 Hub 青序流光保真门禁失败：${failures} 项\n`
)
process.exit(failures === 0 ? 0 : 1)
