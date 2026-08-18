/**
 * verify-content-pipeline-e2e.ts — 内容信息库端到端链路门禁
 *
 * ## 这个门禁在守什么
 *
 * 一体机摆在人才市场大厅,求职者点「岗位信息 / 招聘会 / 政策」。这三个库是空的,
 * 机器就没有用。链路是:
 *
 *   建来源机构 → 标为内容可信 → 配数据源(6 种接入方式)→ 导入
 *   → 管理员审核 → 发布 → 一体机前台可见 → 浏览/跳转被记录
 *
 * 2026-08-17 出过一起真实事故:5 条未授权的腾讯岗位进了生产并公网可见。
 * 之后加了两道发布闸门(content-trust / publish-completeness)。这两道闸门各自
 * 都有纯内存假 Prisma 的单元门禁,但**没有任何门禁在真实数据流上证明过**:
 *
 *   - 该拦的拦住了(未核验机构、缺来源字段)
 *   - **不该拦的放行了** —— 只验拒绝,等于可能把发布焊死而没人发现
 *
 * 本门禁走真实 HTTP + 真实 Prisma + 真实 Guard,对三类内容各跑一遍完整链路,
 * 两个方向都验。
 *
 * ## 六种接入方式的口径
 *
 * `AccessMode = 'api'|'excel'|'csv'|'json'|'webhook'|'manual'`。本门禁按
 * 「真通 / 半通 / 只有壳」三选一实测每一种,并把结论钉成断言 ——
 * 这样将来谁把某种模式做通了或做坏了,门禁会变色,而不是靠文档口口相传。
 *
 * ## 环境
 *
 * 隔离 SQLite + 进程内内存 Redis 桩(见 support/inmemory-redis-server.ts)。
 * 桩不实现 Lua ⇒ BullMQ 在它上面是失败的,因此 `api` 模式按仓库既有口径
 * (verify-job-sync.ts)用「确定性 fetch 边界」验 inline 路径,队列投递不在本门禁范围。
 *
 * Run: VERIFICATION_DATABASE_TARGET=isolated DATABASE_URL=file:./prisma/verify-e2e.db \
 *      pnpm verify:content-pipeline-e2e
 */
import 'dotenv/config'
import { createHmac, randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import {
  assert, section, step, show, summary, login, unwrap, FIXTURE_PREFIX,
  startHarness, type HarnessEnv, type Client, type HttpResult,
} from './support/content-pipeline-harness'
import { createFixtures, cleanupFixtures, type Fixtures } from './support/content-pipeline-fixtures'

const PORT = Number(process.env['CONTENT_PIPELINE_E2E_PORT'] ?? 3211)

// ── 小工具 ───────────────────────────────────────────────────────────────────

function errCode(res: HttpResult): string {
  return res.body?.error?.code ?? '(无错误码)'
}
function errMsg(res: HttpResult): string {
  return res.body?.error?.message ?? ''
}

/** 生成一个最小合法 .xlsx（首行表头 + N 行数据）。 */
async function xlsxBuffer(headers: string[], rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(headers)
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}

function csvBuffer(headers: string[], rows: string[][]): Buffer {
  const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  return Buffer.from([headers, ...rows].map((r) => r.map(esc).join(',')).join('\n'), 'utf8')
}

/** multipart 上传 —— 用 FormData/Blob，Node 22 原生支持。 */
function uploadForm(file: Buffer, fileName: string, fields: Record<string, string>): FormData {
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array(file)]), fileName)
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return fd
}

interface AdminRow { id: string; externalId?: string; title?: string; reviewStatus?: string; publishStatus?: string }

/** 从 admin 列表里按 externalId 找一条。 */
async function findAdminRow(http: Client, path: string, externalId: string, token: string): Promise<AdminRow | null> {
  const res = await http.get<AdminRow[]>(path, { token })
  const rows = unwrap(res)
  if (!Array.isArray(rows)) return null
  return rows.find((r) => r.externalId === externalId) ?? null
}

// ── 通用链路:导入完成后 → 审核 → 发布 → 前台可见 ──────────────────────────────

interface ChainOpts {
  http: Client
  adminToken: string
  /** admin 列表端点,用于按 externalId 定位刚导入的内容 */
  adminListPath: string
  /** 审核/发布端点前缀,如 '/admin/job-sources' */
  adminActionPrefix: string
  /** 公开列表端点,如 '/jobs' */
  publicListPath: string
  externalId: string
  label: string
}

/**
 * 跑「审核 → 发布 → 前台可见」这后半段,并逐步打印实测输出。
 * 返回内容 id(供后续浏览/跳转记录使用),任一步断掉返回 null。
 */
async function runReviewPublishVisible(o: ChainOpts): Promise<string | null> {
  const { http, adminToken } = o

  const row = await findAdminRow(http, o.adminListPath, o.externalId, adminToken)
  assert(`${o.label}｜导入后出现在管理员待审列表`, row !== null, `externalId=${o.externalId} 未出现在 ${o.adminListPath}`)
  if (!row) return null
  console.log(`      导入落库状态: reviewStatus=${row.reviewStatus} publishStatus=${row.publishStatus}`)
  assert(`${o.label}｜导入落 pending+draft(未审核不得直达前台)`,
    row.reviewStatus === 'pending' && row.publishStatus === 'draft',
    `实际 ${row.reviewStatus}/${row.publishStatus}`)

  // 未审核先试发布 —— 必须被拒
  const early = await http.patch(`${o.adminActionPrefix}/${row.id}/publish`, { token: adminToken, json: { action: 'publish' } })
  show('未审核直接发布', early)
  assert(`${o.label}｜未审核发布被拒(PUBLISH_REQUIRES_APPROVAL)`,
    early.status === 400 && errCode(early) === 'PUBLISH_REQUIRES_APPROVAL', `实际 ${early.status} ${errCode(early)}`)

  const reviewing = await http.patch(`${o.adminActionPrefix}/${row.id}/review`, { token: adminToken, json: { action: 'reviewing' } })
  show('转入审核中', reviewing)
  assert(`${o.label}｜pending → reviewing`, reviewing.status === 200, `实际 ${reviewing.status} ${errCode(reviewing)}`)

  const approve = await http.patch(`${o.adminActionPrefix}/${row.id}/review`, { token: adminToken, json: { action: 'approve' } })
  show('审核通过', approve)
  assert(`${o.label}｜reviewing → approved`, approve.status === 200, `实际 ${approve.status} ${errCode(approve)}`)

  const publish = await http.patch(`${o.adminActionPrefix}/${row.id}/publish`, { token: adminToken, json: { action: 'publish' } })
  show('发布', publish)
  assert(`${o.label}｜审核通过后发布成功(两道闸门放行合规内容)`,
    publish.status === 200, `实际 ${publish.status} ${errCode(publish)}: ${errMsg(publish)}`)
  if (publish.status !== 200) return null

  const pub = await http.get<{ id: string; externalId?: string }[]>(`${o.publicListPath}?pageSize=100`)
  const list = unwrap(pub) ?? []
  const seen = list.find((x) => x.externalId === o.externalId) ?? list.find((x) => x.id === row.id)
  console.log(`      公开列表 ${o.publicListPath} 命中: ${seen ? seen.id : '(未命中)'} / 总条数 ${list.length}`)
  assert(`${o.label}｜一体机前台可见`, !!seen, `${o.publicListPath} 未返回 ${o.externalId}`)
  return row.id
}

// ── §1 六种接入方式 × 岗位 ────────────────────────────────────────────────────

async function jobViaManual(h: HarnessEnv, f: Fixtures, partnerToken: string): Promise<string> {
  const externalId = `MANUAL-${h.run}-J1`
  step(`岗位 / manual(手动录入) —— POST /partner/jobs/import`)
  const res = await h.http.post('/partner/jobs/import', {
    token: partnerToken,
    json: { items: [{
      externalId, title: '前端工程师(E2E手动录入)', company: 'E2E测试科技', city: '广州',
      sourceUrl: 'https://example.com/jobs/manual-1',
    }] },
  })
  show('手动录入导入', res)
  assert('岗位/manual｜导入成功', res.status === 200 || res.status === 201, `实际 ${res.status} ${errCode(res)}: ${errMsg(res)}`)
  return externalId
}

async function jobViaExcel(h: HarnessEnv, f: Fixtures, partnerToken: string): Promise<string> {
  const externalId = `XLSX-${h.run}-J1`
  step('岗位 / excel —— POST /partner/excel/preview → /partner/excel/:id/confirm')
  const headers = ['外部ID', '职位名称', '公司名称', '工作城市', '来源链接']
  const buf = await xlsxBuffer(headers, [[externalId, '后端工程师(E2E-Excel)', 'E2E测试科技', '广州', 'https://example.com/jobs/xlsx-1']])
  const mapping = JSON.stringify({ externalId: '外部ID', title: '职位名称', company: '公司名称', city: '工作城市', sourceUrl: '来源链接' })
  const preview = await h.http.post<{ batchId?: string; validRows?: number }>('/partner/excel/preview', {
    token: partnerToken,
    body: uploadForm(buf, 'jobs.xlsx', { sourceId: f.sources['excel']!, dataType: 'job', fieldMapping: mapping }),
  })
  show('preview', preview)
  assert('岗位/excel｜preview 成功', preview.status === 200 || preview.status === 201, `实际 ${preview.status} ${errCode(preview)}: ${errMsg(preview)}`)
  const batchId = unwrap(preview)?.batchId
  if (!batchId) return externalId
  const confirm = await h.http.post(`/partner/excel/${batchId}/confirm`, { token: partnerToken })
  show('confirm', confirm)
  assert('岗位/excel｜confirm 落库', confirm.status === 200 || confirm.status === 201, `实际 ${confirm.status} ${errCode(confirm)}`)
  return externalId
}

async function jobViaCsv(h: HarnessEnv, f: Fixtures, partnerToken: string): Promise<string> {
  const externalId = `CSV-${h.run}-J1`
  step('岗位 / csv —— 同 excel 端点,按文件名 .csv 分流')
  const headers = ['外部ID', '职位名称', '公司名称', '工作城市', '来源链接']
  const buf = csvBuffer(headers, [[externalId, '测试工程师(E2E-CSV)', 'E2E测试科技', '深圳', 'https://example.com/jobs/csv-1']])
  const mapping = JSON.stringify({ externalId: '外部ID', title: '职位名称', company: '公司名称', city: '工作城市', sourceUrl: '来源链接' })
  const preview = await h.http.post<{ batchId?: string }>('/partner/excel/preview', {
    token: partnerToken,
    body: uploadForm(buf, 'jobs.csv', { sourceId: f.sources['csv']!, dataType: 'job', fieldMapping: mapping }),
  })
  show('preview(.csv)', preview)
  assert('岗位/csv｜preview 成功(csv 源 + .csv 文件)', preview.status === 200 || preview.status === 201,
    `实际 ${preview.status} ${errCode(preview)}: ${errMsg(preview)}`)
  const batchId = unwrap(preview)?.batchId
  if (!batchId) return externalId
  const confirm = await h.http.post(`/partner/excel/${batchId}/confirm`, { token: partnerToken })
  show('confirm', confirm)
  assert('岗位/csv｜confirm 落库', confirm.status === 200 || confirm.status === 201, `实际 ${confirm.status} ${errCode(confirm)}`)
  return externalId
}

async function jobViaWebhook(h: HarnessEnv, f: Fixtures): Promise<string> {
  const externalId = `WH-${h.run}-J1`
  step('岗位 / webhook —— POST /sync/webhook?source=(HMAC 签名,无 JWT)')
  const sourceId = f.sources['webhook']!
  const payload = JSON.stringify({ items: [{
    externalId, title: '运维工程师(E2E-Webhook)', company: 'E2E测试科技', city: '珠海',
    sourceUrl: 'https://example.com/jobs/webhook-1',
  }] })
  const ts = Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const sig = createHmac('sha256', f.webhookSecret).update(`${ts}.${payload}`).digest('hex')
  const headers = {
    'Content-Type': 'application/json',
    'x-webhook-timestamp': String(ts),
    'x-webhook-nonce': nonce,
    'x-webhook-signature': sig,
  }
  const res = await h.http.post(`/sync/webhook?source=${sourceId}`, { headers, body: payload })
  show('webhook 推送', res)
  assert('岗位/webhook｜签名正确时导入成功', res.status === 200 || res.status === 201,
    `实际 ${res.status} ${errCode(res)}: ${errMsg(res)}`)

  // 防重放:同一 nonce 再来一次必须 401
  const replay = await h.http.post(`/sync/webhook?source=${sourceId}`, { headers, body: payload })
  show('webhook 重放同一 nonce', replay)
  assert('岗位/webhook｜nonce 重放被拒 401', replay.status === 401 && errCode(replay) === 'WEBHOOK_UNAUTHORIZED',
    `实际 ${replay.status} ${errCode(replay)}`)

  // 错误签名必须 401
  const badSig = await h.http.post(`/sync/webhook?source=${sourceId}`, {
    headers: { ...headers, 'x-webhook-nonce': randomUUID(), 'x-webhook-signature': 'f'.repeat(64) },
    body: payload,
  })
  show('webhook 错误签名', badSig)
  assert('岗位/webhook｜错误签名被拒 401', badSig.status === 401, `实际 ${badSig.status} ${errCode(badSig)}`)
  return externalId
}

/**
 * 岗位 / json —— 这一格的结论是「只有壳」。
 *
 * `jobs-excel.service.ts` 的 accessMode 闸门放行 ['excel','csv','json'],
 * 但 `partner-import-file.ts::loadPartnerImportRows` 只按文件名分流 .csv / .xlsx,
 * 其余一律 `UNSUPPORTED_FILE_FORMAT`。也就是说 json 源能进门,但没有任何解析器。
 *
 * 断言写成「必须被拒」而不是「必须成功」:本门禁不要求把 json 做通(那是新增能力,
 * 需要单独立项),只钉住**当前真实行为**,并要求错误信息说得出实情 ——
 * 见 §失败路径 对 EXCEL_EMPTY 文案的断言。
 */
async function jobViaJson(h: HarnessEnv, f: Fixtures, partnerToken: string): Promise<void> {
  step('岗位 / json —— 上传 .json 到文件导入端点')
  const body = JSON.stringify([{ externalId: `JSON-${h.run}-J1`, title: 'X', company: 'Y', city: 'Z', sourceUrl: 'https://example.com/j' }])
  const mapping = JSON.stringify({ externalId: 'externalId', title: 'title', company: 'company', city: 'city', sourceUrl: 'sourceUrl' })
  const res = await h.http.post('/partner/excel/preview', {
    token: partnerToken,
    body: uploadForm(Buffer.from(body, 'utf8'), 'jobs.json', { sourceId: f.sources['json']!, dataType: 'job', fieldMapping: mapping }),
  })
  show('preview(.json)', res)
  assert('岗位/json｜.json 文件不被解析(当前无 JSON 解析器,只有壳)',
    res.status === 400, `实际 ${res.status} ${errCode(res)}`)
}

/**
 * 岗位 / api(定时拉取)。
 *
 * 分两段验,因为这两段在本机的可判别性不同:
 *
 *   ① **网络层**:真实 `fetchJson` 前置 SSRF 守卫,回环地址按设计被拒。
 *      本机离线,公网地址也拉不通 —— 所以「真的能从第三方 API 拉到数据」
 *      这件事**本机判别不了**,报告里如实标注,不假装验过。
 *   ② **落库层**:按仓库既有口径(verify-job-sync.ts)替换 `fetchJson`
 *      这个确定性边界,验映射 → upsert → 强制回 pending 全链路。
 *
 * 拆开写而不是含糊带过,是因为「拉取失败」和「拉回来没入库」是两种完全不同的
 * 故障,运营看到的现象都是「岗位没出现」。
 */
async function jobViaApiPull(h: HarnessEnv, f: Fixtures, prisma: import('../src/prisma/prisma.service').PrismaService): Promise<string> {
  const externalId = `API-${h.run}-J1`
  step('岗位 / api —— ① SSRF 守卫 ② 确定性 fetch 边界下的落库')

  const { JobSyncService } = await import('../src/job-sync/job-sync.service')
  const sync = h.api.app.get(JobSyncService)
  const sourceId = f.sources['api']!

  // api 源需要 endpoint + authType + 凭证
  const { encryptSecret } = await import('../src/common/crypto/secret-cipher')
  await prisma.jobSource.update({
    where: { id: sourceId },
    data: {
      endpoint: 'http://127.0.0.1:9/jobs', // 回环 + discard 端口:必须被 SSRF 守卫拦下
      authType: 'bearer',
      encryptedCredential: encryptSecret('verify-only-token'),
      responseConfig: JSON.stringify({ dataType: 'job' }),
      syncEnabled: true,
    },
  })

  // ① 真实网络层:回环地址必须被拒,且失败要落进 SyncLog(运营能查到为什么没数据)
  await sync.pullApiSource(sourceId).catch(() => undefined)
  const failLog = await prisma.syncLog.findFirst({ where: { sourceId }, orderBy: { createdAt: 'desc' } })
  console.log(`      SSRF 拦截后 SyncLog: result=${failLog?.result} errorDetail=${failLog?.errorDetail?.slice(0, 80)}`)
  assert('岗位/api｜回环地址被 SSRF 守卫拒绝并记入 SyncLog',
    failLog?.result === 'failed' && (failLog.errorDetail ?? '').includes('SSRF'),
    `result=${failLog?.result} detail=${failLog?.errorDetail?.slice(0, 120)}`)

  // ② 确定性 fetch 边界:证明拉回来的数据确实会映射 + 落库 + 落 pending
  ;(sync as unknown as { fetchJson: (endpoint: string) => Promise<unknown> }).fetchJson = async () => ({
    jobs: [{
      id: externalId, title: '数据分析师(E2E-API拉取)', company: 'E2E测试科技',
      city: '广州', url: 'https://example.com/jobs/api-1',
    }],
  })
  await prisma.jobSource.update({ where: { id: sourceId }, data: { endpoint: 'https://good-source.invalid/jobs' } })
  await sync.pullApiSource(sourceId)
  const row = await prisma.job.findFirst({ where: { sourceOrgId: f.trustedOrgId, externalId } })
  console.log(`      API 拉取落库: id=${row?.id} reviewStatus=${row?.reviewStatus} publishStatus=${row?.publishStatus}`)
  assert('岗位/api｜拉回的数据落库', !!row, `未找到 externalId=${externalId}`)
  assert('岗位/api｜落 pending+draft(拉取不等于可以上前台)',
    row?.reviewStatus === 'pending' && row?.publishStatus === 'draft', `实际 ${row?.reviewStatus}/${row?.publishStatus}`)
  return externalId
}

// ── §2 招聘会 / §3 政策 的导入 ────────────────────────────────────────────────

async function fairViaManual(h: HarnessEnv, partnerToken: string): Promise<string> {
  const externalId = `MANUAL-${h.run}-F1`
  step('招聘会 / manual —— POST /partner/fairs/import')
  const start = new Date(Date.now() + 7 * 86400_000).toISOString()
  const end = new Date(Date.now() + 8 * 86400_000).toISOString()
  const res = await h.http.post('/partner/fairs/import', {
    token: partnerToken,
    json: { items: [{
      externalId, title: '春季综合招聘会(E2E手动录入)', startAt: start, endAt: end,
      venue: '广州人才市场一号馆', city: '广州', sourceUrl: 'https://example.com/fairs/manual-1',
    }] },
  })
  show('手动录入招聘会', res)
  assert('招聘会/manual｜导入成功', res.status === 200 || res.status === 201, `实际 ${res.status} ${errCode(res)}: ${errMsg(res)}`)
  return externalId
}

async function fairViaExcel(h: HarnessEnv, f: Fixtures, partnerToken: string): Promise<string> {
  const externalId = `XLSX-${h.run}-F1`
  step('招聘会 / excel —— POST /partner/excel/preview(dataType=fair)')
  const headers = ['外部ID', '招聘会名称', '开始时间', '结束时间', '举办地点', '城市', '来源链接']
  const start = new Date(Date.now() + 9 * 86400_000).toISOString()
  const end = new Date(Date.now() + 10 * 86400_000).toISOString()
  const buf = await xlsxBuffer(headers, [[externalId, '秋季校园双选会(E2E-Excel)', start, end, '广州大学城体育馆', '广州', 'https://example.com/fairs/xlsx-1']])
  const mapping = JSON.stringify({
    externalId: '外部ID', title: '招聘会名称', startAt: '开始时间', endAt: '结束时间',
    venue: '举办地点', city: '城市', sourceUrl: '来源链接',
  })
  const preview = await h.http.post<{ batchId?: string }>('/partner/excel/preview', {
    token: partnerToken,
    body: uploadForm(buf, 'fairs.xlsx', { sourceId: f.sources['excel']!, dataType: 'fair', fieldMapping: mapping }),
  })
  show('preview(fair)', preview)
  assert('招聘会/excel｜preview 成功', preview.status === 200 || preview.status === 201,
    `实际 ${preview.status} ${errCode(preview)}: ${errMsg(preview)}`)
  const batchId = unwrap(preview)?.batchId
  if (!batchId) return externalId
  const confirm = await h.http.post(`/partner/excel/${batchId}/confirm`, { token: partnerToken })
  show('confirm(fair)', confirm)
  assert('招聘会/excel｜confirm 落库', confirm.status === 200 || confirm.status === 201, `实际 ${confirm.status} ${errCode(confirm)}`)
  return externalId
}

/**
 * 招聘会 / csv。
 *
 * 单独跑一遍而不是「与 excel 同路径,推断即可」:覆盖矩阵里每一格都要有自己的实测输出,
 * 推断出来的格子正是今天反复出问题的那类判断(类型里有名字 ≠ 端到端跑得通)。
 */
async function fairViaCsv(h: HarnessEnv, f: Fixtures, partnerToken: string): Promise<string> {
  const externalId = `CSV-${h.run}-F1`
  step('招聘会 / csv —— POST /partner/excel/preview(dataType=fair, .csv 文件)')
  const headers = ['外部ID', '招聘会名称', '开始时间', '结束时间', '举办地点', '城市', '来源链接']
  const start = new Date(Date.now() + 11 * 86400_000).toISOString()
  const end = new Date(Date.now() + 12 * 86400_000).toISOString()
  const buf = csvBuffer(headers, [[externalId, '冬季专场招聘会(E2E-CSV)', start, end, '深圳会展中心', '深圳', 'https://example.com/fairs/csv-1']])
  const mapping = JSON.stringify({
    externalId: '外部ID', title: '招聘会名称', startAt: '开始时间', endAt: '结束时间',
    venue: '举办地点', city: '城市', sourceUrl: '来源链接',
  })
  const preview = await h.http.post<{ batchId?: string }>('/partner/excel/preview', {
    token: partnerToken,
    body: uploadForm(buf, 'fairs.csv', { sourceId: f.sources['csv']!, dataType: 'fair', fieldMapping: mapping }),
  })
  show('preview(fair.csv)', preview)
  assert('招聘会/csv｜preview 成功', preview.status === 200 || preview.status === 201,
    `实际 ${preview.status} ${errCode(preview)}: ${errMsg(preview)}`)
  const batchId = unwrap(preview)?.batchId
  if (!batchId) return externalId
  const confirm = await h.http.post(`/partner/excel/${batchId}/confirm`, { token: partnerToken })
  show('confirm(fair.csv)', confirm)
  assert('招聘会/csv｜confirm 落库', confirm.status === 200 || confirm.status === 201, `实际 ${confirm.status} ${errCode(confirm)}`)
  return externalId
}

async function fairViaWebhook(h: HarnessEnv, f: Fixtures): Promise<void> {
  step('招聘会 / webhook —— 该组合按设计不存在,验证它确实拒收而不是静默吞掉')
  const sourceId = f.sources['webhook']!
  const payload = JSON.stringify({ items: [{
    externalId: `WH-${h.run}-F1`, title: '招聘会经 webhook', startAt: new Date().toISOString(),
    endAt: new Date().toISOString(), venue: '某馆', city: '广州', sourceUrl: 'https://example.com/f',
  }] })
  const ts = Math.floor(Date.now() / 1000)
  const sig = createHmac('sha256', f.webhookSecret).update(`${ts}.${payload}`).digest('hex')
  const res = await h.http.post(`/sync/webhook?source=${sourceId}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-timestamp': String(ts), 'x-webhook-nonce': randomUUID(), 'x-webhook-signature': sig,
    },
    body: payload,
  })
  show('webhook 推招聘会字段', res)
  assert('招聘会/webhook｜招聘会专有字段被 DTO 白名单拒收(400,不静默吞)',
    res.status === 400, `实际 ${res.status} ${errCode(res)}`)
}

async function policyViaManual(h: HarnessEnv, partnerToken: string): Promise<string> {
  step('政策 / manual —— POST /partner/policies')
  const title = `灵活就业社保补贴申领指南(E2E-${h.run})`
  const res = await h.http.post<{ id?: string }>('/partner/policies', {
    token: partnerToken,
    json: {
      kind: 'policy_guide', title, audience: 'flexible',
      summary: 'E2E 验证用政策条目', externalUrl: 'https://example.com/policy/1',
      externalId: `POLICY-${h.run}-1`,
    },
  })
  show('新建政策', res)
  assert('政策/manual｜创建成功', res.status === 200 || res.status === 201, `实际 ${res.status} ${errCode(res)}: ${errMsg(res)}`)
  return unwrap(res)?.id ?? ''
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== 内容信息库端到端链路验证(岗位 / 招聘会 / 政策 × 6 种接入方式)===')
  const h = await startHarness(PORT)
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  let f: Fixtures | null = null
  try {
    await cleanupFixtures(prisma, h.run) // 防御性:同 run 不可能有残留,但保持习惯
    f = await createFixtures(prisma, h.run)
    console.log(`  run=${h.run}  可信机构=${f.trustedOrgId}  未核验机构=${f.untrustedOrgId}`)

    const adminToken = await login(h.http, f.adminUsername, f.password, 'admin')
    const partnerToken = await login(h.http, f.partnerUsername, f.password, 'partner')
    const ntPartnerToken = await login(h.http, f.untrustedPartnerUsername, f.password, 'partner')
    console.log('  admin / partner / 未核验机构 partner 登录成功')

    // ── §1 岗位链路 ────────────────────────────────────────────────────────
    section('§1 岗位(Job)—— 六种接入方式各走一遍,再各自 审核 → 发布 → 前台可见')

    const jobChains: { mode: string; externalId: string }[] = []
    jobChains.push({ mode: 'manual', externalId: await jobViaManual(h, f, partnerToken) })
    jobChains.push({ mode: 'excel', externalId: await jobViaExcel(h, f, partnerToken) })
    jobChains.push({ mode: 'csv', externalId: await jobViaCsv(h, f, partnerToken) })
    jobChains.push({ mode: 'webhook', externalId: await jobViaWebhook(h, f) })
    jobChains.push({ mode: 'api', externalId: await jobViaApiPull(h, f, prisma) })
    await jobViaJson(h, f, partnerToken)

    let publishedJobId: string | null = null
    for (const c of jobChains) {
      step(`岗位 / ${c.mode} —— 审核 → 发布 → 前台`)
      const id = await runReviewPublishVisible({
        http: h.http, adminToken,
        adminListPath: '/admin/job-sources', adminActionPrefix: '/admin/job-sources',
        publicListPath: '/jobs', externalId: c.externalId, label: `岗位/${c.mode}`,
      })
      if (id) publishedJobId = id
    }

    // ── §2 招聘会链路 ──────────────────────────────────────────────────────
    section('§2 招聘会(JobFair)')
    const fairChains: { mode: string; externalId: string }[] = []
    fairChains.push({ mode: 'manual', externalId: await fairViaManual(h, partnerToken) })
    fairChains.push({ mode: 'excel', externalId: await fairViaExcel(h, f, partnerToken) })
    fairChains.push({ mode: 'csv', externalId: await fairViaCsv(h, f, partnerToken) })
    await fairViaWebhook(h, f)

    let publishedFairId: string | null = null
    for (const c of fairChains) {
      step(`招聘会 / ${c.mode} —— 审核 → 发布 → 前台`)
      const id = await runReviewPublishVisible({
        http: h.http, adminToken,
        adminListPath: '/admin/fair-sources', adminActionPrefix: '/admin/fair-sources',
        publicListPath: '/job-fairs', externalId: c.externalId, label: `招聘会/${c.mode}`,
      })
      if (id) publishedFairId = id
    }

    // ── §3 政策链路 ────────────────────────────────────────────────────────
    section('§3 政策(PolicyPost)')
    const policyId = await policyViaManual(h, partnerToken)
    if (policyId) {
      const early = await h.http.patch(`/admin/policy-sources/${policyId}/publish`, { token: adminToken, json: { action: 'publish' } })
      show('未审核直接发布', early)
      assert('政策｜未审核发布被拒', early.status === 400 && errCode(early) === 'PUBLISH_REQUIRES_APPROVAL',
        `实际 ${early.status} ${errCode(early)}`)
      const approve = await h.http.patch(`/admin/policy-sources/${policyId}/review`, { token: adminToken, json: { action: 'approve' } })
      show('审核通过', approve)
      assert('政策｜审核通过', approve.status === 200, `实际 ${approve.status} ${errCode(approve)}`)
      const publish = await h.http.patch(`/admin/policy-sources/${policyId}/publish`, { token: adminToken, json: { action: 'publish' } })
      show('发布', publish)
      assert('政策｜发布成功', publish.status === 200, `实际 ${publish.status} ${errCode(publish)}: ${errMsg(publish)}`)
      const pub = await h.http.get<{ id: string }[]>('/policies?pageSize=200')
      const list = unwrap(pub) ?? []
      assert('政策｜一体机前台可见', list.some((p) => p.id === policyId), `/policies 未返回 ${policyId}`)
    }

    // ── §4 闸门:该拦的必须拦住 ────────────────────────────────────────────
    section('§4 发布闸门 —— 该拦的必须拦住')

    step('4.1 来源机构未标为内容可信 → 发布被拒(ORG_CONTENT_TRUST_REQUIRED)')
    const ntExternalId = `MANUAL-${h.run}-NT1`
    const ntImport = await h.http.post('/partner/jobs/import', {
      token: ntPartnerToken,
      json: { items: [{ externalId: ntExternalId, title: '未核验机构的岗位', company: 'X公司', city: '广州', sourceUrl: 'https://example.com/nt-1' }] },
    })
    show('未核验机构导入', ntImport)
    assert('闸门｜未核验机构仍可**录入**(闸门只拦发布,不拦录入)',
      ntImport.status === 200 || ntImport.status === 201, `实际 ${ntImport.status} ${errCode(ntImport)}`)
    const ntRow = await findAdminRow(h.http, '/admin/job-sources', ntExternalId, adminToken)
    if (ntRow) {
      await h.http.patch(`/admin/job-sources/${ntRow.id}/review`, { token: adminToken, json: { action: 'approve' } })
      const ntPublish = await h.http.patch(`/admin/job-sources/${ntRow.id}/publish`, { token: adminToken, json: { action: 'publish' } })
      show('未核验机构发布', ntPublish)
      assert('闸门｜未核验机构的内容发布被拒',
        ntPublish.status === 400 && errCode(ntPublish) === 'ORG_CONTENT_TRUST_REQUIRED',
        `实际 ${ntPublish.status} ${errCode(ntPublish)}`)
      assert('闸门｜拒绝信息指名道姓(含机构名 + 怎么办)',
        errMsg(ntPublish).includes('内容可信') || errMsg(ntPublish).includes('content-trust'),
        `实际文案: ${errMsg(ntPublish).slice(0, 160)}`)

      // 前台绝不可见
      const pubList = await h.http.get<{ externalId?: string }[]>('/jobs?pageSize=100')
      const leaked = (unwrap(pubList) ?? []).some((x) => x.externalId === ntExternalId)
      assert('闸门｜未核验机构的内容不出现在一体机前台', !leaked, '发生泄漏')
    }

    step('4.2 缺来源可追溯字段 → 发布被拒(PUBLISH_INCOMPLETE_FIELDS)')
    // 直接构造一条 sourceUrl='' 的岗位:这正是 Excel 导入 `?? ''` 会产生的形态。
    const blankId = `BLANK-${h.run}-J1`
    const blankJob = await prisma.job.create({
      data: {
        sourceOrgId: f.trustedOrgId, externalId: blankId, sourceName: 'E2E来源',
        sourceUrl: '', title: '缺来源链接的岗位', company: 'E2E测试科技', city: '广州',
        reviewStatus: 'approved', publishStatus: 'draft',
      },
    })
    const blankPublish = await h.http.patch(`/admin/job-sources/${blankJob.id}/publish`, { token: adminToken, json: { action: 'publish' } })
    show('缺 sourceUrl 发布', blankPublish)
    assert('闸门｜sourceUrl 为空串的岗位发布被拒',
      blankPublish.status === 400 && errCode(blankPublish) === 'PUBLISH_INCOMPLETE_FIELDS',
      `实际 ${blankPublish.status} ${errCode(blankPublish)}`)
    assert('闸门｜拒绝信息点名缺的是「来源链接」',
      errMsg(blankPublish).includes('来源链接'), `实际文案: ${errMsg(blankPublish).slice(0, 160)}`)
    assert('闸门｜明说系统不会填默认值',
      errMsg(blankPublish).includes('不会为任何字段填充默认值'), `实际文案: ${errMsg(blankPublish).slice(0, 200)}`)
    const afterBlank = await prisma.job.findUnique({ where: { id: blankJob.id } })
    assert('闸门｜被拒后 sourceUrl 仍为空(只拒绝,绝不修补)', afterBlank?.sourceUrl === '', `实际 "${afterBlank?.sourceUrl}"`)

    step('4.3 下架(unpublish)不受闸门限制 —— 否则不合规内容撤不下来')
    const ntRow2 = await findAdminRow(h.http, '/admin/job-sources', ntExternalId, adminToken)
    if (ntRow2) {
      const un = await h.http.patch(`/admin/job-sources/${ntRow2.id}/publish`, { token: adminToken, json: { action: 'unpublish' } })
      show('未核验机构内容下架', un)
      assert('闸门｜未核验机构的内容仍可下架', un.status === 200, `实际 ${un.status} ${errCode(un)}`)
    }
    const blankUn = await h.http.patch(`/admin/job-sources/${blankJob.id}/publish`, { token: adminToken, json: { action: 'unpublish' } })
    assert('闸门｜缺字段的内容仍可下架', blankUn.status === 200, `实际 ${blankUn.status} ${errCode(blankUn)}`)

    step('4.4 运营把机构标为内容可信后,原先被拒的内容应当能发布')
    const trustRes = await h.http.patch(`/admin/orgs/${f.untrustedOrgId}/content-trust`, {
      token: adminToken, json: { status: 'active', reason: 'E2E:模拟运营完成授权核验' },
    })
    show('标记内容可信', trustRes)
    assert('闸门｜PATCH /admin/orgs/:id/content-trust 可用', trustRes.status === 200, `实际 ${trustRes.status} ${errCode(trustRes)}`)
    if (ntRow2) {
      const retry = await h.http.patch(`/admin/job-sources/${ntRow2.id}/publish`, { token: adminToken, json: { action: 'publish' } })
      show('标记可信后重试发布', retry)
      assert('闸门｜标记可信后同一条内容可以发布(闸门没有把发布焊死)',
        retry.status === 200, `实际 ${retry.status} ${errCode(retry)}: ${errMsg(retry)}`)
    }

    // ── §5 失败路径 ────────────────────────────────────────────────────────
    section('§5 失败路径 —— 运营看得懂吗、幂等吗、静默吞掉吗')

    step('5.1 Excel 缺必填列 → 预览阶段就标错,不等到发布')
    const badHeaders = ['外部ID', '职位名称', '公司名称', '工作城市']
    const badBuf = await xlsxBuffer(badHeaders, [[`BAD-${h.run}-1`, '缺来源链接的岗位', 'E2E测试科技', '广州']])
    const badPreview = await h.http.post<{ invalidRows?: number; preview?: { errors?: string[] }[] }>('/partner/excel/preview', {
      token: partnerToken,
      body: uploadForm(badBuf, 'jobs.xlsx', {
        sourceId: f.sources['excel']!, dataType: 'job',
        fieldMapping: JSON.stringify({ externalId: '外部ID', title: '职位名称', company: '公司名称', city: '工作城市' }),
      }),
    })
    show('缺 sourceUrl 列的 preview', badPreview)
    assert('失败路径｜Excel 缺必填映射在 preview 阶段被拒或标为 invalid',
      badPreview.status === 400 || (unwrap(badPreview)?.invalidRows ?? 0) > 0,
      `实际 ${badPreview.status} invalidRows=${unwrap(badPreview)?.invalidRows}`)
    assert('失败路径｜invalid 行不进入可确认集合(validRows=0)',
      (unwrap(badPreview)?.validRows ?? -1) === 0, `validRows=${unwrap(badPreview)?.validRows}`)

    step('5.2 重复导入同一条 → 幂等(更新而非新增)')
    const dupExternalId = jobChains[0]!.externalId
    const before = await prisma.job.count({ where: { sourceOrgId: f.trustedOrgId, externalId: dupExternalId } })
    const again = await h.http.post('/partner/jobs/import', {
      token: partnerToken,
      json: { items: [{ externalId: dupExternalId, title: '前端工程师(E2E手动录入-改)', company: 'E2E测试科技', city: '广州', sourceUrl: 'https://example.com/jobs/manual-1' }] },
    })
    show('重复导入', again)
    const after = await prisma.job.count({ where: { sourceOrgId: f.trustedOrgId, externalId: dupExternalId } })
    assert('失败路径｜同 externalId 重复导入不产生重复行', before === 1 && after === 1, `before=${before} after=${after}`)
    const reReview = await prisma.job.findFirst({ where: { sourceOrgId: f.trustedOrgId, externalId: dupExternalId } })
    console.log(`      重复导入后状态: reviewStatus=${reReview?.reviewStatus} publishStatus=${reReview?.publishStatus}`)
    assert('失败路径｜内容变更后强制回到 pending+draft(已发布的会被撤下重审)',
      reReview?.reviewStatus === 'pending' && reReview?.publishStatus === 'draft',
      `实际 ${reReview?.reviewStatus}/${reReview?.publishStatus}`)

    step('5.3 注入求职者字段 → 400 拒收(合规红线)')
    const inject = await h.http.post('/partner/jobs/import', {
      token: partnerToken,
      json: { items: [{
        externalId: `INJ-${h.run}`, title: 'X', company: 'Y', city: 'Z', sourceUrl: 'https://example.com/x',
        candidateEmail: 'a@b.com',
      }] },
    })
    show('注入 candidateEmail', inject)
    assert('失败路径｜候选人字段被 forbidNonWhitelisted 拒收 400', inject.status === 400, `实际 ${inject.status}`)

    step('5.4 敏感列(手机号/简历)出现在 Excel → 拒绝导入')
    const sensBuf = await xlsxBuffer(['外部ID', '职位名称', '公司名称', '工作城市', '来源链接', '联系人手机号'],
      [[`SENS-${h.run}`, 'X', 'Y', 'Z', 'https://example.com/x', '13800000000']])
    const sensRes = await h.http.post('/partner/excel/preview', {
      token: partnerToken,
      body: uploadForm(sensBuf, 'jobs.xlsx', {
        sourceId: f.sources['excel']!, dataType: 'job',
        fieldMapping: JSON.stringify({ externalId: '外部ID', title: '职位名称', company: '公司名称', city: '工作城市', sourceUrl: '来源链接' }),
      }),
    })
    show('含手机号列的 preview', sensRes)
    assert('失败路径｜含敏感列的文件被拒(不静默剥离)', sensRes.status === 400, `实际 ${sensRes.status} ${errCode(sensRes)}`)

    step('5.5 格式错误的文件 → 明确拒绝')
    const junk = Buffer.from('this is not a spreadsheet', 'utf8')
    const junkRes = await h.http.post('/partner/excel/preview', {
      token: partnerToken,
      body: uploadForm(junk, 'jobs.xlsx', {
        sourceId: f.sources['excel']!, dataType: 'job',
        fieldMapping: JSON.stringify({ externalId: 'a', title: 'b', company: 'c', city: 'd', sourceUrl: 'e' }),
      }),
    })
    show('垃圾内容当 .xlsx 上传', junkRes)
    assert('失败路径｜非法文件被明确拒绝 400', junkRes.status === 400, `实际 ${junkRes.status} ${errCode(junkRes)}`)

    step('5.6 不支持的文件格式必须**说出实情**,不能报成「文件为空」')
    // 背景:accessMode 闸门放行 ['excel','csv','json'],但解析器只认 .xlsx/.csv。
    // 于是一个 json 源上传 .json 时,底层抛 UNSUPPORTED_FILE_FORMAT,而
    // loadExcelRows 的 catch 阶梯没有这一档,统一落到 EXCEL_EMPTY「文件为空或格式不正确」。
    // 运营看到这句话会去检查文件是不是空的 —— 而真正的原因是格式根本不受支持,
    // 且没有任何提示告诉他受支持的是哪几种。这是「错误必须说清实情」的违反。
    const jsonRes = await h.http.post('/partner/excel/preview', {
      token: partnerToken,
      body: uploadForm(Buffer.from('[{"a":1}]', 'utf8'), 'jobs.json', {
        sourceId: f.sources['json']!, dataType: 'job',
        fieldMapping: JSON.stringify({ externalId: 'a', title: 'b', company: 'c', city: 'd', sourceUrl: 'e' }),
      }),
    })
    show('.json 上传的错误文案', jsonRes)
    assert('失败路径｜不支持的格式报 UNSUPPORTED_FILE_FORMAT 而非 EXCEL_EMPTY',
      errCode(jsonRes) === 'UNSUPPORTED_FILE_FORMAT', `实际错误码 ${errCode(jsonRes)}`)
    assert('失败路径｜错误文案点名受支持的格式(.xlsx / .csv)',
      errMsg(jsonRes).includes('.xlsx') && errMsg(jsonRes).includes('.csv'), `实际文案: ${errMsg(jsonRes)}`)

    step('5.7 CSV 导入的同步日志必须记成 csv,不能记成 excel')
    // SyncLog 是 Partner 后台「同步日志」页直接展示给运营的记录。
    // confirmExcelImport 把 syncMode 硬编码成 'excel',于是 CSV 导入在日志里
    // 伪装成 Excel 导入 —— 运营排查「这批数据哪来的」时会被误导。
    const csvLog = await prisma.syncLog.findFirst({
      where: { sourceId: f.sources['csv']!, orgId: f.trustedOrgId },
      orderBy: { createdAt: 'desc' },
    })
    console.log(`      csv 源的最近一条 SyncLog: syncMode=${csvLog?.syncMode} dataType=${csvLog?.dataType}`)
    assert('失败路径｜CSV 导入在同步日志里记为 csv(不伪装成 excel)',
      csvLog?.syncMode === 'csv', `实际 syncMode=${csvLog?.syncMode}`)

    step('5.8 未登录/越权访问后台端点')
    const anon = await h.http.patch('/admin/job-sources/whatever/publish', { json: { action: 'publish' } })
    assert('失败路径｜匿名访问管理员发布端点 401', anon.status === 401, `实际 ${anon.status}`)
    const wrongRole = await h.http.patch('/admin/job-sources/whatever/publish', { token: partnerToken, json: { action: 'publish' } })
    assert('失败路径｜partner 访问管理员发布端点 403', wrongRole.status === 403, `实际 ${wrongRole.status}`)

    // ── §6 前台可见 + 浏览/跳转记录 ────────────────────────────────────────
    section('§6 求职者侧 —— 详情可读 + 浏览/外部跳转记录落库')

    if (publishedJobId) {
      const detail = await h.http.get<{ sourceName?: string; sourceUrl?: string; externalId?: string; dataSourceNote?: string }>(`/jobs/${publishedJobId}`)
      show('岗位详情', detail)
      const d = unwrap(detail)
      assert('前台｜岗位详情展示来源机构/外部ID/来源链接(CLAUDE.md §10)',
        !!d?.sourceName && !!d?.externalId && !!d?.sourceUrl,
        `sourceName=${d?.sourceName} externalId=${d?.externalId} sourceUrl=${d?.sourceUrl}`)
    }

    // 会员会话:直接铸 JWT + 写 Redis 会话键(与 verify-job-favorites-http 同方案)
    const { JwtService } = await import('@nestjs/jwt')
    const { memberSessionKey } = await import('../src/common/guards/end-user-auth.guard')
    const endUserId = `eu-${FIXTURE_PREFIX}-${h.run}`
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: `ph-${h.run}`, phoneEnc: 'enc' } })
    const sessionId = randomUUID()
    const jwt = new JwtService({ secret: process.env['JWT_SECRET']!, signOptions: { expiresIn: '30m', audience: 'enduser' } })
    const memberToken = jwt.sign({ sub: endUserId }, { jwtid: sessionId })
    await h.redis.set(memberSessionKey(sessionId), endUserId, 'EX', 1800)

    if (publishedJobId) {
      const b = await h.http.post<{ recorded?: boolean }>('/activity/browse', {
        token: memberToken, json: { targetType: 'job', targetId: publishedJobId },
      })
      show('浏览上报', b)
      assert('记录｜浏览记录被接受', b.status === 200 || b.status === 201, `实际 ${b.status}`)
      assert('记录｜浏览确实记录(recorded=true,不是静默丢弃)', unwrap(b)?.recorded === true, JSON.stringify(unwrap(b)))
      const browseCount = await prisma.browseLog.count({ where: { endUserId } })
      assert('记录｜BrowseLog 落库', browseCount >= 1, `count=${browseCount}`)

      // 动作取值受 JUMP_ACTIONS_BY_TARGET 约束:岗位只认 external_apply。
      // 注意口径 —— 记的是「打开了来源平台入口」,不是「投递成功」(合规红线)。
      const j = await h.http.post<{ recorded?: boolean }>('/activity/external-jump', {
        token: memberToken, json: { targetType: 'job', targetId: publishedJobId, action: 'external_apply' },
      })
      show('外部跳转上报', j)
      assert('记录｜外部跳转记录被接受', j.status === 200 || j.status === 201, `实际 ${j.status} ${errCode(j)}`)
      const jumpCount = await prisma.externalJumpLog.count({ where: { endUserId } })
      assert('记录｜ExternalJumpLog 落库', jumpCount >= 1, `count=${jumpCount}`)

      // 动作与目标类型不匹配必须被拒 —— 否则「岗位 + 招聘会预约」这种脏数据会进库
      const badAction = await h.http.post('/activity/external-jump', {
        token: memberToken, json: { targetType: 'job', targetId: publishedJobId, action: 'external_appointment' },
      })
      show('岗位 + 招聘会预约动作', badAction)
      assert('记录｜跳转动作与目标类型不匹配被拒 400',
        badAction.status === 400 && errCode(badAction) === 'ACTIVITY_INVALID_INPUT', `实际 ${badAction.status} ${errCode(badAction)}`)

      const mine = await h.http.get<{ items?: unknown[] }>('/me/browse-logs', { token: memberToken })
      show('我的浏览记录', mine)
      assert('记录｜「我的」浏览记录可读回', (unwrap(mine)?.items?.length ?? 0) >= 1, JSON.stringify(unwrap(mine)).slice(0, 160))
    }

    if (publishedFairId) {
      const b = await h.http.post<{ recorded?: boolean }>('/activity/browse', {
        token: memberToken, json: { targetType: 'job_fair', targetId: publishedFairId },
      })
      show('招聘会浏览上报', b)
      assert('记录｜招聘会浏览记录被接受', unwrap(b)?.recorded === true, JSON.stringify(unwrap(b)))
    }

    // ── §7 批量发布 ────────────────────────────────────────────────────────
    section('§7 批量发布 —— 预览阶段就把不可信来源分流进 excluded')

    const prev = await h.http.post<{ eligibleTotal?: number; excluded?: Record<string, number> }>('/admin/bulk-publish/preview', {
      token: adminToken, json: { kind: 'job' },
    })
    show('批量发布预览', prev)
    assert('批量｜preview 可用', prev.status === 200 || prev.status === 201, `实际 ${prev.status} ${errCode(prev)}`)
    // ── §8 控制台入口:后端支持的接入方式,运营在页面上必须点得到 ──────────
    section('§8 合作机构后台入口 —— 后端支持 ≠ 页面上点得到')
    step('8.1 csv 源必须有导入入口(后端已支持 .csv,页面却只给 excel 源开)')
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const partnerSources = readFileSync(
      join(__dirname, '..', '..', '..', 'apps', 'partner', 'src', 'routes', 'sources', 'index.tsx'), 'utf8',
    )
    // 后端 previewExcelImport / confirmExcelImport 都放行 ['excel','csv','json'],
    // 且解析器真的支持 .csv。但页面把「字段映射(导入)」按钮只给 accessMode==='excel'
    // 的源渲染 —— 一个 csv 源建出来之后在控制台上完全没有入口,等于半通。
    const gatesImportOnExcelOnly = /s\.accessMode === 'excel' &&/.test(partnerSources)
    assert('控制台｜导入入口不再只认 excel 源(csv 源也要能点)',
      !gatesImportOnExcelOnly,
      "apps/partner/src/routes/sources/index.tsx 仍以 s.accessMode === 'excel' 单值判断导入入口")

    const prevData = unwrap(prev)
    console.log(`      excluded=${JSON.stringify(prevData?.excluded)}`)
    assert('批量｜excluded.expired 恒为数字(publishStatus 从不落 expired,按日期字段实时算)',
      typeof prevData?.excluded?.['expired'] === 'number', JSON.stringify(prevData?.excluded))
    assert('批量｜excluded.orgTrustInactive 统计不可信来源',
      typeof prevData?.excluded?.['orgTrustInactive'] === 'number', JSON.stringify(prevData?.excluded))
  } finally {
    if (f) {
      try {
        await cleanupFixtures(prisma, h.run)
        const leftJobs = await prisma.job.count({ where: { externalId: { contains: h.run } } })
        const leftFairs = await prisma.jobFair.count({ where: { externalId: { contains: h.run } } })
        assert('清理｜测试数据已删净(残留会泄漏到公开前台)', leftJobs === 0 && leftFairs === 0,
          `残留 jobs=${leftJobs} fairs=${leftFairs}`)
      } catch (e) {
        console.error('  清理失败:', (e as Error).message)
      }
    }
    await prisma.onModuleDestroy()
    await h.close()
  }

  const failedCount = summary()
  process.exit(failedCount === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\n验证脚本异常退出:', e)
  process.exit(1)
})
