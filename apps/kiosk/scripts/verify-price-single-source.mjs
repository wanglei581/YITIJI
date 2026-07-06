// ============================================================
// W-A 价格真相源单一化守卫（verify:price-single-source）
//
// 保护不变量：
// 1. Kiosk 业务页面不得持有任何硬编码单价常量（PRICE_BW/PRICE_COLOR 及 ¥x.x/面 字样）；
//    展示价唯一来源 = services/print/priceConfigApi.ts（GET /print/price-config）。
// 2. 预览/确认页估价必须经 estimatePrintCents（与服务端「按内容页」口径同源），
//    不得自行乘「面数」。
// 3. priceConfigApi 的 DEMO 价目仅 mock 演示模式可达（API_MODE 门控），http 模式
//    取价失败进入 error 态，绝不回退 DEMO/硬编码价。
// 4. 服务端契约存在：PricingService.listActivePriceConfig + GET print/price-config 路由。
// ============================================================
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (p) => readFileSync(p, 'utf8')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}
const expectMatches = (src, pattern, m) => (pattern.test(src) ? pass(m) : fail(`${m} — pattern ${pattern} not found`))
const expectAbsent = (src, pattern, m) => (!pattern.test(src) ? pass(m) : fail(`${m} — forbidden pattern ${pattern} matched`))

console.log('\n=== W-A 价格真相源单一化守卫 ===')

// ── 1. 全仓 kiosk src 扫描：禁止硬编码单价常量（priceConfigApi 的 DEMO 价目除外）──
const PRICE_API = 'src/services/print/priceConfigApi.ts'
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const offenders = []
for (const file of walk(join(root, 'src'))) {
  if (file.endsWith(PRICE_API.replace(/\//g, file.includes('\\') ? '\\' : '/'))) continue
  const src = read(file)
  if (/PRICE_BW|PRICE_COLOR/.test(src) || /¥\s*\d+(\.\d+)?\s*\/\s*面/.test(src)) offenders.push(file)
}
if (offenders.length === 0) pass('kiosk src 无硬编码单价常量（PRICE_BW/PRICE_COLOR/¥x.x/面）')
else fail(`硬编码价格常量出现在：${offenders.join(', ')}`)

// ── 2. 预览/确认页接真服务端价目 + 估价口径同源 ──
const preview = read(join(root, 'src/pages/print/PrintPreviewPage.tsx'))
const confirm = read(join(root, 'src/pages/print/PrintConfirmPage.tsx'))
for (const [name, src] of [
  ['PrintPreviewPage', preview],
  ['PrintConfirmPage', confirm],
]) {
  expectMatches(src, /usePrintPriceConfig\(\)/, `${name} 使用服务端价目 hook`)
  expectMatches(src, /estimatePrintCents\(/, `${name} 估价经统一口径 helper（按内容页）`)
  expectAbsent(src, /totalFaces\s*\*\s*\w*[Pp]rice/, `${name} 不再按「面」自行乘价`)
}
expectMatches(preview, /价格暂不可用|以收银台金额为准/, 'PrintPreviewPage 取价失败态诚实提示（不显示假价）')
expectMatches(confirm, /价格暂不可用|以收银台显示为准/, 'PrintConfirmPage 取价失败态诚实提示')
expectAbsent(preview, /请选择优惠券/, 'PrintPreviewPage 不再渲染假的优惠券入口')

// ── 3. priceConfigApi：DEMO 仅 mock 可达 + http 失败不回退 ──
const priceApi = read(join(root, PRICE_API))
expectMatches(priceApi, /API_MODE\s*===\s*'http'\s*\?\s*\{\s*status:\s*'loading'/, 'http 模式初始 loading（不直接用 DEMO）')
expectMatches(priceApi, /API_MODE\s*!==\s*'http'/, 'DEMO 价目仅非 http（mock 演示）模式可达')
expectMatches(priceApi, /status:\s*'error',\s*config:\s*null/, 'http 取价失败进入 error 态且 config=null（不回退假价）')
expectMatches(priceApi, /unitCents\s*\*\s*input\.pages\s*\*\s*input\.copies|unit\s*\*\s*input\.pages\s*\*\s*input\.copies/, '估价公式=单价×内容页×份数（与服务端 PricingService 同源）')

// ── 4. 服务端契约存在 ──
const pricingService = read(join(repoRoot, 'services/api/src/payment/pricing.service.ts'))
const paymentController = read(join(repoRoot, 'services/api/src/payment/payment.controller.ts'))
expectMatches(pricingService, /listActivePriceConfig\(\)/, 'PricingService.listActivePriceConfig 存在')
expectMatches(pricingService, /where:\s*\{\s*active:\s*true\s*\}/, '公开视图只读 active 价目')
expectMatches(paymentController, /@Get\('print\/price-config'\)/, 'GET /print/price-config 路由存在')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 价格真相源单一化守卫未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 价格真相源单一化守卫通过\n')
