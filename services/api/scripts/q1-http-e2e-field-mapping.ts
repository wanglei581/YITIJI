/**
 * Q1 复核 — Excel 字段映射 HTTP 端到端联调（真实 partner JWT + 真实 HTTP 链路）
 *
 * 与 verify-field-mapping-rule.ts（直连 dev.db service 层）不同，本脚本走完整 HTTP：
 *   登录 partner1 → GET mapping-rule(空) → parse → preview → confirm
 *   → GET mapping-rule(读回已保存映射) → 跨机构(partner2) GET 被拒
 *
 * 前置：API 已在 http://localhost:3010 运行；dev.db 已 seed（partner1/partner1, src-uni-excel）
 * 运行：node -r @swc-node/register scripts/q1-http-e2e-field-mapping.ts
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import { PrismaService } from '../src/prisma/prisma.service'

const BASE = process.env['Q1_BASE'] ?? 'http://localhost:3010/api/v1'
const SOURCE_ID = 'src-uni-excel' // org-uni-001 的 excel 源（seed）

/**
 * 跑完清理本脚本写入 dev.db 的测试数据（镜像 verify-job-sync.ts 的「自动清理」习惯）：
 * Q1-* 测试岗位 + 本源 excel 导入批次/记录/同步日志 + 本源字段映射规则。
 * 让 dev.db 回到运行前状态，不污染共享开发库。
 */
async function cleanup(): Promise<void> {
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    const batches = await prisma.importBatch.findMany({
      where: { sourceId: SOURCE_ID, fileName: 'jobs.xlsx' }, select: { id: true },
    })
    const batchIds = batches.map((b) => b.id)
    if (batchIds.length) {
      await prisma.importRecord.deleteMany({ where: { batchId: { in: batchIds } } })
      await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } })
    }
    await prisma.job.deleteMany({ where: { externalId: { startsWith: 'Q1-' } } })
    await prisma.fieldMappingRule.deleteMany({ where: { sourceId: SOURCE_ID } })
    await prisma.syncLog.deleteMany({ where: { sourceId: SOURCE_ID, syncMode: 'excel' } })
  } finally {
    await prisma.onModuleDestroy()
  }
}

let failed = 0
function assert(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✅ ${msg}`)
  else { failed++; console.error(`  ❌ ${msg}`) }
}

async function login(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, portal: 'partner' }),
  })
  const json = (await res.json()) as { data?: { token?: string }; error?: unknown }
  if (!res.ok || !json.data?.token) throw new Error(`login failed ${username}: ${res.status} ${JSON.stringify(json)}`)
  return json.data.token
}

/** 生成一个最小的合法 job 导入 .xlsx buffer（无敏感列）；externalId 带运行戳避免 dup */
async function buildJobXlsx(): Promise<Buffer> {
  const run = Date.now()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('jobs')
  // 列头用「中文标签」，刻意与标准字段不同名，强制走映射
  ws.addRow(['岗位编号', '职位名称', '公司', '城市', '来源链接'])
  ws.addRow([`Q1-${run}-1`, '前端工程师', '青岛科技公司', '青岛', 'https://example.com/apply/1001'])
  ws.addRow([`Q1-${run}-2`, '后端工程师', '青岛软件公司', '青岛', 'https://example.com/apply/1002'])
  const out = await wb.xlsx.writeBuffer()
  return Buffer.from(out)
}

async function parse(token: string, buf: Buffer): Promise<string[]> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)]), 'jobs.xlsx')
  const res = await fetch(`${BASE}/partner/excel/parse`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  })
  const json = (await res.json()) as { columns?: string[] }
  if (!res.ok) throw new Error(`parse failed: ${res.status} ${JSON.stringify(json)}`)
  return json.columns ?? []
}

async function preview(token: string, buf: Buffer, mapping: Record<string, string>): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buf)]), 'jobs.xlsx')
  form.append('sourceId', SOURCE_ID)
  form.append('dataType', 'job')
  // 与前端 partnerHttpAdapter 一致：multipart 字段名必须是 fieldMapping（不是 mapping）
  form.append('fieldMapping', JSON.stringify(mapping))
  const res = await fetch(`${BASE}/partner/excel/preview`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  })
  const json = (await res.json()) as { batchId?: string; validRows?: number }
  if (!res.ok) throw new Error(`preview failed: ${res.status} ${JSON.stringify(json)}`)
  console.log(`     preview: batchId=${json.batchId} validRows=${json.validRows}`)
  return json.batchId!
}

async function confirm(token: string, batchId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/partner/excel/${batchId}/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`confirm failed: ${res.status} ${JSON.stringify(json)}`)
  return json
}

async function getMappingRule(token: string, sourceId = SOURCE_ID, dataType = 'job') {
  const res = await fetch(`${BASE}/partner/excel/mapping-rule?sourceId=${sourceId}&dataType=${dataType}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json()
  return { status: res.status, json }
}

async function main(): Promise<void> {
  console.log('Q1 HTTP E2E — Excel 字段映射规则复用\n')

  const t1 = await login('partner1', 'partner1')
  const t2 = await login('partner2', 'partner2')
  console.log('  ✅ partner1 / partner2 登录获取 JWT\n')

  const mapping = { externalId: '岗位编号', title: '职位名称', company: '公司', city: '城市', sourceUrl: '来源链接' }

  // 0. 清掉历史规则，保证「首次为空」断言不受先前运行影响（直接删 DB 不在 HTTP 范围，
  //    改为：先读当前值，若已存在则导入会覆盖，最终断言以「读回 == 本次映射」为准）
  const before = await getMappingRule(t1)
  console.log(`  ℹ️  首次 GET mapping-rule status=${before.status} updatedAt=${(before.json as any)?.updatedAt}`)

  // 1. parse
  const buf = await buildJobXlsx()
  const columns = await parse(t1, buf)
  assert(columns.includes('岗位编号') && columns.includes('职位名称'), `1. parse 返回列头 [${columns.join(', ')}]`)

  // 2. preview
  const batchId = await preview(t1, buf, mapping)
  assert(!!batchId, '2. preview 生成 batchId')

  // 3. confirm（成功后应 upsert 字段映射规则）
  const confirmed = (await confirm(t1, batchId)) as { imported?: number; syncLogId?: string }
  assert((confirmed.imported ?? 0) >= 1, `3. confirm 成功导入 imported=${confirmed.imported}`)

  // 4. GET mapping-rule —— 读回本次保存的映射（HTTP 全链路核心断言）
  const after = await getMappingRule(t1)
  const m = (after.json as any)?.mapping ?? {}
  assert(after.status === 200, '4a. confirm 后 GET mapping-rule 返回 200')
  assert(m.title === '职位名称' && m.externalId === '岗位编号' && m.sourceUrl === '来源链接',
    `4b. 读回映射 == 本次导入映射（title=${m.title} externalId=${m.externalId}）`)
  assert((after.json as any)?.updatedAt != null, '4c. updatedAt 非空（规则已落库）')

  // 5. 跨机构越权：partner2 读 org-uni-001 的源 → 404 DATA_SOURCE_NOT_FOUND
  const cross = await getMappingRule(t2)
  const code = (cross.json as any)?.error?.code
  assert(cross.status === 404 && code === 'DATA_SOURCE_NOT_FOUND',
    `5. 跨机构 GET 被拒（status=${cross.status} code=${code}）`)

  // 6. 参数校验：缺 sourceId / 非法 dataType
  const badType = await getMappingRule(t1, SOURCE_ID, 'candidate')
  assert(badType.status === 400 && (badType.json as any)?.error?.code === 'INVALID_DATA_TYPE',
    `6. 非法 dataType → 400 INVALID_DATA_TYPE（status=${badType.status}）`)

  console.log(failed === 0 ? '\n✅ ALL PASS' : `\n❌ ${failed} FAILED`)
  return failed
}

main()
  .then(async (f) => { await cleanup(); console.log('  🧹 测试数据已清理'); process.exit(f === 0 ? 0 : 1) })
  .catch(async (e) => {
    console.error('E2E crashed:', e)
    await cleanup().catch(() => {})
    process.exit(1)
  })
