import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const kioskRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(kioskRoot, '../..')

function read(root, file) {
  return readFileSync(resolve(root, file), 'utf8')
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  PASS ${message}`)
}

console.log('\n=== Kiosk 打印参数已验证能力合同 ===')

const shared = read(repoRoot, 'packages/shared/src/types/print.ts')
const preview = read(kioskRoot, 'src/pages/print/PrintPreviewPage.tsx')
const confirm = read(kioskRoot, 'src/pages/print/PrintConfirmPage.tsx')
const layout = read(kioskRoot, 'src/pages/print/PrintPrototypeLayout.tsx')
const routes = read(kioskRoot, 'src/routes/index.tsx')
const kioskRootLayout = read(kioskRoot, 'src/layouts/KioskRoot.tsx')

expect(
  shared.includes('VERIFIED_PRINT_PARAMETER_PROFILE') &&
    shared.includes('restrictToAllowedPrintParams') &&
    shared.includes('hasParamsBeyondCapability'),
  'shared 提供最保守 profile + 按终端能力收口 / 差异检测 helper',
)

// 2026-08-18：彩色/双面已按终端能力开放。控件不再恒禁用，而是随**本机**能力登记变化。
// 未验证的机器上仍必须禁用，且理由要说「本机未通过真机验证」而不是「不支持」。
// PrintParamsPage 已于 #690 下线（与预览页重复且零导航），故只剩预览页一处参数入口。
for (const [name, source] of [['PrintPreviewPage', preview]]) {
  expect(source.includes('VERIFIED_PRINT_PARAMETER_PROFILE'), `${name} 从 shared 安全 profile 取初始参数`)
  expect(source.includes('usePrintParamCapability'), `${name} 按本机能力登记决定彩色/双面可用性`)
  expect(source.includes('setColorMode('), `${name} 在能力放行时允许切换彩色`)
  expect(source.includes('setDuplex('), `${name} 在能力放行时允许切换双面`)
  expect(
    !source.includes('当前仅开放黑白、单面、每张 1 页'),
    `${name} 不再写死「仅开放黑白」（已验证的机器上属谎报）`,
  )
  expect(
    !source.includes('厂家确认和 Windows 真机验收后再开放'),
    `${name} 不再把彩色/双面统一说成未开放`,
  )
  // 禁用态必须可聚焦可解释：原生 disabled 读屏读不到原因。
  expect(source.includes('aria-disabled'), `${name} 禁用态使用可聚焦的 aria-disabled`)
  expect(!/\n\s+disabled\n\s+\/>/.test(source), `${name} 不再用裸 disabled 属性恒禁用控件`)
  expect(source.includes('capability.color.reason'), `${name} 展示彩色被禁用的真实原因`)
  expect(source.includes('capability.duplex.reason'), `${name} 展示双面被禁用的真实原因`)
}

expect(
  confirm.includes('restrictToAllowedPrintParams') &&
    confirm.includes('hasParamsBeyondCapability') &&
    confirm.includes('参数已按本机已验证能力收口') &&
    confirm.indexOf('restrictToAllowedPrintParams') < confirm.indexOf('quotePrintOrder('),
  'PrintConfirmPage 在报价前按本机能力收口，避免按未验证参数计价',
)
expect(
  confirm.includes('terminalId: getTerminalId()'),
  'PrintConfirmPage 报价带 terminalId，服务端才能按本机能力 fail-closed 复核',
)

// ── 打印参数页下线合同（2026-08-18）────────────────────────────────────────────
// 原状：步骤条七步里第 4 格是「参数」，对应 /print/params。但全站零运行时 navigate()
// 指向它（预览页「确认参数」直跳 /print/confirm），用户看得到第 4 格却永远走不到，
// 进度条从 3 直接跳到 5。该页每个可编辑控件都与预览页重复，页范围卡自己写着
// 「（在预览步骤设置）」。故删页 + 步骤条收成 6 步 + 路由保留为兼容重定向。
console.log('\n--- 打印参数页下线合同 ---')

expect(
  !existsSync(resolve(kioskRoot, 'src/pages/print/PrintParamsPage.tsx')),
  'PrintParamsPage.tsx 已删除（不得复活与预览页重复的第二个参数页）',
)

const stepsMatch = layout.match(/const PRINT_STEPS = \[([^\]]*)\]/)
expect(Boolean(stepsMatch), 'PrintPrototypeLayout 仍导出 PRINT_STEPS 常量')
const steps = stepsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
expect(steps.length === 6, `步骤条为 6 步（实际 ${steps.length}：${steps.join('/')}）`)
expect(!steps.includes('参数'), '步骤条不再出现用户走不到的「参数」步')
expect(
  steps.join('/') === '上传/材料检查/预览/确认/支付/打印',
  `步骤条文案与真实链路一致（实际 ${steps.join('/')}）`,
)
expect(
  /export type PrintFlowStep = 1 \| 2 \| 3 \| 4 \| 5 \| 6\b/.test(layout) &&
    !/PrintFlowStep = [^\n]*\| 7/.test(layout),
  'PrintFlowStep 类型上界收成 6（越界 step 编译期即报错）',
)

// 每一步都必须真的有页面声明，且 1..6 连续无跳号
const declaredSteps = new Set()
for (const file of [
  'src/pages/print/PrintUploadPage.tsx',
  'src/pages/print/PrintMaterialCheckPage.tsx',
  'src/pages/print/PrintPreviewPage.tsx',
  'src/pages/print/PrintConfirmPage.tsx',
  'src/pages/print/PrintCashierPage.tsx',
  'src/pages/print/PrintProgressPage.tsx',
  'src/pages/print/PrintDonePage.tsx',
]) {
  for (const m of read(kioskRoot, file).matchAll(/step=\{(\d)\}/g)) declaredSteps.add(Number(m[1]))
}
expect(
  [...declaredSteps].sort((a, b) => a - b).join(',') === '1,2,3,4,5,6',
  `打印页声明的 step 覆盖 1..6 且无跳号（实际 ${[...declaredSteps].sort((a, b) => a - b).join(',')}）`,
)

expect(
  /path: 'print\/params',\s*element: <Navigate to="\/print\/preview" replace \/>/.test(routes),
  '/print/params 保留为指向 /print/preview 的兼容重定向（106 路由冻结基线不变）',
)
expect(!routes.includes('PrintParamsPage'), 'routes 不再 import 已删除的 PrintParamsPage')
expect(
  !kioskRootLayout.includes("'/print/params'"),
  'KioskRoot actionbar 路由集不再包含已下线的 /print/params',
)

// ── 预览框高度约束（2026-08-18 产品走查「预览比例不对」）────────────────────────
// 原状：容器只有 min-h + flex-1，没有任何 max-height，会把剩余竖向空间全吃掉，
// 在 1080×1920 竖屏上被拉成与 A4 完全不成比例的长条。
console.log('\n--- 预览框高度约束 ---')

const previewBox = preview.match(/<div className="relative flex ([^"]*)rounded-xl border border-neutral-200 bg-neutral-50">/)
expect(Boolean(previewBox), '预览容器仍是可被守卫定位的单一节点')
expect(/max-h-\[/.test(previewBox[1]), `预览容器有 max-height 约束（实际 class：${previewBox[1].trim()}）`)
expect(/min-h-\[/.test(previewBox[1]), '预览容器保留 min-height 下限')
expect(
  /max-h-\[min\(\d+vh,\s*(\d+)px\)\]/.test(previewBox[1]),
  '预览高度上限同时按视口与绝对像素封顶（矮屏不顶出视口，竖屏不超 A4 比例）',
)
const capPx = Number(previewBox[1].match(/max-h-\[min\(\d+vh,\s*(\d+)px\)\]/)[1])
// 竖屏可用列宽 ≈ 1080 − 48(p-6) − 400(参数栏) − 24(gap) = 608px；A4 对应高 608×297/210 ≈ 860px
expect(
  capPx >= 780 && capPx <= 940,
  `高度上限按 1080×1920 竖屏的 A4 比例取值（608px 宽 → ≈860px 高，实际 ${capPx}px）`,
)
for (const tag of ['img', 'iframe']) {
  const el = preview.match(new RegExp(`<${tag}[^>]*?className="([^"]*)"`, 's'))
  expect(Boolean(el) && /max-h-full/.test(el[1]), `预览 <${tag}> 有 max-h-full，不撑破容器`)
}

console.log('\nALL PASS')
