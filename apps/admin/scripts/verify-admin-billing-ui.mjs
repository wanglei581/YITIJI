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

// route + nav 接入
if (routes.includes("path: 'billing'") && routes.includes('BillingPage')) pass('路由注册 /billing')
else fail('路由未注册 /billing')
if (nav.includes("'/billing'") && nav.includes('计费与对账')) pass('侧栏导航接入计费与对账')
else fail('侧栏未接入计费与对账')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — Admin 计费/对账 UI 守卫未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — Admin 计费/对账 UI 守卫通过\n')
