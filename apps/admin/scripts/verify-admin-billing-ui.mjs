import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pagePath = join(root, 'src/routes/billing/index.tsx')
const servicePath = join(root, 'src/services/api/adminBilling.ts')
const routesPath = join(root, 'src/routes/index.tsx')
const navPath = join(root, 'src/layouts/AdminLayoutWrapper.tsx')

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}

console.log('\n=== Admin billing/reconciliation UI verification ===')

if (!existsSync(pagePath)) fail('billing page missing')
if (!existsSync(servicePath)) fail('adminBilling service missing')
const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''
const service = existsSync(servicePath) ? readFileSync(servicePath, 'utf8') : ''
const routes = readFileSync(routesPath, 'utf8')
const nav = readFileSync(navPath, 'utf8')

// service：只调既有端点，无支付凭证字段
if (
  service.includes("'/admin/billing/price-config'") &&
  service.includes('/admin/billing/price-config/') &&
  service.includes('/admin/billing/reconciliation')
) {
  pass('service 调用 price-config（GET/PUT）+ reconciliation（GET）')
} else {
  fail('service 未正确调用计费/对账端点')
}
if (!/apiSecret|appSecret|privateKey|apiV3Key|SECRET/i.test(service)) {
  pass('service 不含任何支付凭证/密钥字段')
} else {
  fail('service 出现疑似凭证字段')
}
if (service.includes("method: 'PUT'") && !/method:\s*'(POST|DELETE)'/.test(service)) {
  pass('service 改价用 PUT，不暴露新建/删除价目')
} else {
  fail('service 不应有 POST/DELETE 价目操作')
}

// page：改价二次确认 + 停用语义诚实（非「免费」）
if (page.includes('window.confirm') && page.includes('记入审计')) {
  pass('改价前二次确认且提示记审计')
} else {
  fail('改价缺二次确认/审计提示')
}
if (
  page.includes('0 元 = 免费打印，将跳过收银') &&
  page.includes('confirmZeroPrice: true') &&
  service.includes('confirmZeroPrice?: boolean')
) {
  pass('OPS-06: 改 0 元确认框写明跳过收银，并提交 confirmZeroPrice: true')
} else {
  fail('单价改 0 必须显式确认「0 元 = 免费打印，将跳过收银」并传 confirmZeroPrice')
}
if (page.includes('并非「免费」') || page.includes('不可下单')) {
  pass('停用价目语义诚实（报价失败，非免费）')
} else {
  fail('停用语义未诚实说明')
}
if (page.includes('渠道账单 diff 需在部署期')) {
  pass('对账页明示渠道账单 diff 属部署期（不夸大本地对账为全量对账）')
} else {
  fail('对账页缺渠道账单边界说明')
}

// page：说明编辑必须与改价/启停隔离，并在失败时保留输入
const descriptionSaveBlock = page.match(/const saveDescription[\s\S]*?const toggleActive/)?.[0] ?? ''
const descriptionCatchBlock = descriptionSaveBlock.match(/catch \(e\) \{[\s\S]*?\} finally/)?.[0] ?? ''

if (page.includes('descriptionEditing') && page.includes('保存说明')) {
  pass('说明编辑使用独立状态和独立保存操作')
} else {
  fail('说明编辑不得复用单价状态或保存操作')
}

if (
  /updatePriceConfig\s*\(\s*item\.serviceKey\s*,\s*\{\s*description:\s*nextDescription\s*\}\s*\)/.test(
    descriptionSaveBlock,
  ) &&
  !descriptionSaveBlock.includes('unitCents') &&
  !descriptionSaveBlock.includes('active:')
) {
  pass('说明保存请求只提交 description')
} else {
  fail('说明保存请求必须只提交 description，不得携带单价或状态')
}

if (
  descriptionSaveBlock.includes('只更新说明，不修改单价与启停状态') &&
  descriptionSaveBlock.includes('记入审计')
) {
  pass('说明保存二次确认明确字段边界与审计')
} else {
  fail('说明保存确认缺少字段隔离或审计提示')
}

if (
  descriptionSaveBlock.includes('delete next[item.serviceKey]') &&
  descriptionSaveBlock.includes('await load()') &&
  descriptionSaveBlock.includes('setDescriptionEditing') &&
  descriptionSaveBlock.indexOf('await load()') < descriptionSaveBlock.indexOf('setDescriptionEditing')
) {
  pass('说明保存成功后先刷新再清理当前行状态')
} else {
  fail('说明保存成功后必须先刷新再清理当前行状态')
}

if (
  descriptionCatchBlock &&
  !descriptionCatchBlock.includes('setDescriptionEditing') &&
  !descriptionCatchBlock.includes('delete next[item.serviceKey]')
) {
  pass('说明保存失败时保留当前编辑值')
} else {
  fail('说明保存失败时不得清理当前编辑值')
}

if (page.includes('maxLength={200}') && descriptionSaveBlock.includes('nextDescription.length > 200')) {
  pass('说明长度在输入与保存边界均限制为 200 字符')
} else {
  fail('说明编辑缺少 200 字符双重边界')
}

// route + nav 接入
if (routes.includes("path: 'billing'") && routes.includes('BillingPage')) pass('路由注册 /billing')
else fail('路由未注册 /billing')
if (nav.includes("'/billing'") && nav.includes('计费与对账')) pass('侧栏导航接入计费与对账')
else fail('侧栏未接入计费与对账')

if (!page.includes('print_duplex_surcharge') && !page.includes('双面附加')) {
  pass('计费页不展示未播种的双面附加价目标签')
} else {
  fail('计费页不得把 print_duplex_surcharge / 双面附加标成价目（双面不计价）')
}

// M-2（2026-09-18）：对账差异码不得裸着甩给运营。
//
// 差异清单里 `DISCREPANCY_LABELS[d.code] ?? d.code` 有回落分支，漏配一个码不会报错，
// 只会在页面上摆一串英文常量（实际发生过：ONLINE_COLLECTED_PENDING_REFUND 与
// ORDER_EXTRA_COLLECTION_AFTER_REFUND 随迟到回调退款一起落地，中文没跟上）。
//
// 因此**不在门禁里另抄一份码表**：直接从 reconciliation.service.ts 反解出
// push(discrepancies, 'CODE', …) 的全部取值，逐个要求本页有中文。
// 后端新增差异码而前端漏配，这条会自己转红。
const reconciliationSource = readFileSync(
  join(root, '../../services/api/src/payment/reconciliation.service.ts'),
  'utf8',
)
const emittedCodes = [
  ...new Set(
    [...reconciliationSource.matchAll(/push\(\s*discrepancies\s*,\s*'([A-Z_]+)'/g)].map((m) => m[1]),
  ),
]
const labelBlock = page.match(/const DISCREPANCY_LABELS[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? ''
if (emittedCodes.length < 5) {
  fail(`未能从 reconciliation.service.ts 反解出差异码（解析到 ${emittedCodes.length} 个），门禁无法判定`)
} else {
  const naked = emittedCodes.filter((code) => !new RegExp(`\\b${code}\\s*:\\s*'`).test(labelBlock))
  if (naked.length > 0) {
    fail(`对账差异码缺中文标签，会以裸码呈现给运营：${naked.join(', ')}`)
  } else {
    pass(`对账差异码全部有中文标签（从服务端源码反解 ${emittedCodes.length} 个，未在门禁内重抄码表）`)
  }
  // 本轮明确要求的两个码必须真的在反解结果里，避免正则失效后上面那条空转成绿。
  for (const required of ['ONLINE_COLLECTED_PENDING_REFUND', 'ORDER_EXTRA_COLLECTION_AFTER_REFUND']) {
    if (emittedCodes.includes(required)) {
      pass(`反解到 ${required}（迟到回调待退 / 退款后额外收款）`)
    } else {
      fail(`未从 reconciliation.service.ts 反解到 ${required}，上面的覆盖断言可能已空转`)
    }
  }
}

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Admin 计费/对账 UI 守卫未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — Admin 计费/对账 UI 守卫通过\n')
