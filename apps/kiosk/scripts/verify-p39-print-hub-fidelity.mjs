// ============================================================
// verify:p39-print-hub-fidelity — V6 纵切第一刀（打印域 P39）的迁移保真门禁
//
// 守的是「生产页有没有从原型漂走」，分四组：
//   A. 文案保真：一批句子必须**同时**出现在原型 HTML 与生产源码里。
//      读的是真原型文件，所以原型改了这一句、生产没跟，门禁会指出来；
//      反过来生产自己改了话，也会被指出来。方向仍是单向的 ——
//      门禁报错时的处置永远是「改生产」，不是改 docs/design/。
//   B. 结构保真：七件事就是七张卡，到机码不在这七张里。
//   C. 状态轴保真：能力探测轴 + MFP 轴都真的接了真实数据源，
//      且「读不到状态」不得被渲染成「离线」（CLAUDE.md §9 不伪造能力）。
//   D. 触控与可达性：能力门禁型停用一律 aria-disabled + 常显原因，
//      不用原生 disabled、不用 title。
//
// 后续 47 页照抄这个骨架时，只需要换 PROTOTYPE / 文案表 / 结构断言。
// ============================================================
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const PROTOTYPE = join(repoRoot, 'docs/design/kiosk-ai-os-v3-2026-08/39-print-hub.html')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}
const must = (cond, m) => (cond ? pass(m) : fail(m))

/**
 * 把原型 HTML 压成纯文本：去掉 <script>/<style>/注释与标签、解实体、收空白。
 * 必须去标签 —— 原型正文里到处是 <b>，不去掉就没有一句话能整句匹配。
 */
function prototypeText() {
  return readFileSync(PROTOTYPE, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

const proto = prototypeText()
const homeSrc = read('src/pages/print-scan/PrintScanHomePage.tsx')
const viewSrc = read('src/pages/print-scan/components/V6PrintHubView.tsx')
const contentSrc = read('src/pages/print-scan/printHubContent.ts')
const cssSrc = read('src/pages/print-scan/styles/print-hub-v6.css')
const productionSrc = `${homeSrc}\n${viewSrc}\n${contentSrc}`

console.log('\n=== P39 打印域首屏 · V6 迁移保真门禁 ===')

// ── A. 文案保真 ──────────────────────────────────────────────
// 每一条都必须在原型里找得到，也必须在生产源码里找得到。
console.log('\n[A] 文案保真（原型 ∩ 生产）')
const COPY = [
  // 顶部 AI 带
  '这一屏的 AI 只做三件事，点一件我给你下一步',
  '选哪件不依赖 AI',
  // 到机码核销（PR #644 补入原型）
  '在手机上已经下好单了？',
  '到机码核销',
  '凭码办理 · 不登录也能核销',
  // 七件事分组
  '这个台面能做的七件事',
  'AI 怎么帮 · 降级后怎么做',
  // 标签口径：AI 标签在任何状态下都不许消失
  'AI · 仅供参考',
  '不依赖 AI',
  // 一体机离线（device-off）：停什么、留什么、为什么
  '打印扫描一体机离线 —— 要出纸的停了，其余照常',
  '停的是同一台机器上的打印与扫描：文档打印、照片打印、材料扫描、证件照出片',
  '暂停 · 扫描仪就在这台一体机上',
  '暂停 · 同一台打印机',
  '照片走文档打印同一条出纸链路，那条停了，这条也出不了。',
  '尚未开放 · 出片也要这台打印机',
  '功能本身还没开放；就算排好版，出片也要这台机器。',
  // 探测失败（probe unknown）：与 device-off 是两件事
  '服务状态无法确认',
  '暂不开放任务',
  '这次打印扫描都开不了',
  '未取得本机打印扫描能力配置',
  // 能力边界（照 ConvertImagesPage / SignStampPage 的真实边界）
  '多张图片（最多 20 张）合并成一份 PDF，便于打印和存档',
  '在 PDF 上叠加签名 / 印章图片（版式合成，非 CA 电子签）',
  // 记录区与常驻声明
  '我的打印记录',
  '不核价、不结算',
]
for (const line of COPY) {
  if (!proto.includes(line)) {
    fail(`原型里找不到这句（原型已改？请先核对 39-print-hub.html，不要改原型）：「${line}」`)
    continue
  }
  must(productionSrc.includes(line), `文案已迁移：「${line}」`)
}

// ── B. 结构保真 ─────────────────────────────────────────────
console.log('\n[B] 结构保真')
must(/data-v6-page=["']print-hub["']/.test(viewSrc), '保留 V6 设计语言标记 data-v6-page="print-hub"')
must(
  /data-w2-page=["']print-scan-home["']/.test(viewSrc),
  '保留路由归属标记 data-w2-page="print-scan-home"'
)

// 七件事就是七张卡。到机码是第八件事的话，「七件事」这个标题就骗人了 ——
// 迁移前生产正是 8 张卡顶着「七件事」的标题。
const capsBlock = /const CAPABILITIES:[\s\S]*?\n\]/.exec(homeSrc)
must(Boolean(capsBlock), 'CAPABILITIES 声明存在')
if (capsBlock) {
  const keys = [...capsBlock[0].matchAll(/^\s{4}key: '([^']+)'/gm)].map((m) => m[1])
  must(keys.length === 7, `「七件事」栅格恰好 7 张能力卡（实测 ${keys.length}）`)
  must(
    !keys.some((k) => /pickup|arrival/.test(k)),
    '到机码核销不占七件事的格子（它不是「在这台机器上从头办」的第八件事）'
  )
  const expected = ['doc', 'phone', 'scan', 'photo', 'idphoto', 'convert', 'sign']
  const caps = [...capsBlock[0].matchAll(/^\s{4}cap: '([^']+)'/gm)].map((m) => m[1])
  must(
    JSON.stringify(caps) === JSON.stringify(expected),
    `七张卡按原型栅格顺序排列（期望 ${expected.join('/')}）`
  )
}

// 到机码入口：话术、去处、以及它到底是哪个码
must(
  /ARRIVAL_CODE_ENTRY[\s\S]{0,600}?to: '\/print\/pickup-claim'/.test(homeSrc),
  '到机码入口指向已上线的 /print/pickup-claim（POST /print/jobs/claim-pickup）'
)
must(
  /不是付款后的取件凭证码/.test(homeSrc),
  '卡面写明它不是付款后生成的「取件凭证码」（Order.pickupCode 是另一个码）'
)

// ── C. 状态轴保真 ───────────────────────────────────────────
console.log('\n[C] 状态轴保真')
must(
  /useTerminalDeviceStatus/.test(homeSrc),
  'MFP 轴接真实设备状态（GET /terminals/:id/printer-status），不是页面自己编的'
)
must(
  /loadConfiguredCapabilities/.test(homeSrc),
  '能力探测轴接真实能力配置（GET /terminals/:id/capabilities）'
)
// 只有「确定出不了纸」才敢说离线；unknown / loading 不得被当成离线。
must(
  /device\.kind === 'offline' \|\| device\.kind === 'error'\s*\n?\s*\?\s*'unavailable'/.test(homeSrc),
  "只有 kind 为 offline / error 才判定 unavailable —— unknown 不得被渲染成「离线」"
)
must(
  /:\s*'unknown'/.test(homeSrc) && /mfp === 'unknown'/.test(viewSrc),
  '设备状态读不到时有独立的「读不到」呈现，不与「离线」混用'
)
// 要出纸的四项 vs 不经过打印机的三项，这条分界是 device-off 语义的全部内容。
const needsMfp = [...homeSrc.matchAll(/cap: '([^']+)',[\s\S]{0,400}?needsMfp: (true|false)/g)].map(
  (m) => [m[1], m[2] === 'true']
)
const needsMfpMap = Object.fromEntries(needsMfp)
for (const [cap, expected] of [
  ['doc', true],
  ['scan', true],
  ['photo', true],
  ['idphoto', true],
  ['phone', false],
  ['convert', false],
  ['sign', false],
]) {
  must(
    needsMfpMap[cap] === expected,
    `${cap} ${expected ? '要' : '不要'}这台 MFP 动起来（原型 device-off 分界）`
  )
}

// 核销的是订单不是新建本机任务：不得被本机能力探测关闭。
const cardCapabilityKeyBlock = /const CARD_CAPABILITY_KEY[^=]*=\s*\{([\s\S]*?)\n\}/.exec(homeSrc)
must(Boolean(cardCapabilityKeyBlock), 'CARD_CAPABILITY_KEY 仍然声明')
if (cardCapabilityKeyBlock) {
  must(
    !/pickup|arrival/.test(cardCapabilityKeyBlock[1]),
    '到机码核销不登记进 CARD_CAPABILITY_KEY（核销订单 ≠ 新建本机打印任务）'
  )
}

// ── D. 触控与可达性 ─────────────────────────────────────────
console.log('\n[D] 触控与可达性')
must(
  !/\btitle=/.test(viewSrc),
  '不用 title 承载任何信息（触屏没有 hover，title 等于没写）'
)
must(
  /aria-disabled=\{blocked \|\| undefined\}/.test(viewSrc),
  '能力门禁型停用用 aria-disabled（保持可聚焦、读屏读得到）'
)
must(
  !/disabled=\{(?!probeChecking)/.test(viewSrc.replace(/aria-disabled=\{[^}]*\}/g, '')),
  '能力门禁型停用不使用原生 disabled（只有瞬时态「检测中」可以用）'
)
must(
  /onClick=\{blocked \? undefined :/.test(viewSrc),
  '停用态在 onClick 内短路，按下去不会有任何副作用'
)
// 停用一定要有一句常显的原因，否则用户读不到为什么灰。
must(
  /v6-ph-card__badge/.test(viewSrc) && /v6-ph-card__badge/.test(cssSrc),
  '停用原因有独立的常显行（不是 tooltip）'
)
must(
  /\.v6-print-hub button \{\s*min-height: 48px;/.test(cssSrc),
  '所有可点击区 ≥48px（CLAUDE.md §9）'
)
for (const [selector, label] of [
  ['.v6-ph-picks button', 'AI 三件事按钮'],
  ['.v6-ph-rebtn', '重新检测 / 问小青等主操作键'],
]) {
  const block = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*min-height:\\s*56px`
  )
  must(block.test(cssSrc), `${label}主按钮 ≥56px`)
}

// AI 标签不许被停用徽标顶掉 —— 停用后仍要看得出它原本是 AI 能力。
must(
  !/function capabilityTag[\s\S]{0,300}?available/.test(viewSrc),
  'AI 标签不随可用性变化（标签不许消失）'
)

console.log(
  failures === 0
    ? '\n✅ P39 迁移保真门禁通过\n'
    : `\n❌ P39 迁移保真门禁失败：${failures} 项\n`
)
process.exit(failures === 0 ? 0 : 1)
