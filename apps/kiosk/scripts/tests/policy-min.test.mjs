import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/pages/renshi/policyModel.ts'), 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
new Function('exports', 'module', output)(module.exports, module)
const m = module.exports
const result = (total, items = [], page = 1, totalPages = Math.max(1, Math.ceil(total / 4))) => ({
  total, items, page, pageSize: 4, totalPages,
})

test('六类汇总使用 total 与第一条标题，不用单页条数冒充总数', () => {
  const rows = m.policyCategorySummaries([result(23, [{ id: 'p', title: '接口原题' }]), ...Array.from({ length: 5 }, () => result(0))])
  assert.deepEqual(rows.map((row) => row.key), ['graduate', 'startup', 'flexible', 'hardship', 'migrant', 'general'])
  assert.deepEqual(rows.map((row) => row.label), ['应届高校毕业生', '创业扶持', '灵活就业人员', '困难群体就业援助', '返乡务工人员', '通用'])
  assert.equal(rows[0].total, 23)
  assert.equal(rows[0].latest.title, '接口原题')
  assert.equal(rows[0].disabled, false)
  assert.ok(rows.slice(1).every((row) => row.total === 0 && row.disabled && row.latest === undefined))
})

test('路由只接受六类与正整数页码，非法页码归第一页', () => {
  for (const value of [null, '', '0', '-1', '2.2', 'NaN', 'Infinity', '9007199254740992']) assert.equal(m.policyPage(value), 1)
  assert.equal(m.policyPage('3'), 3)
  assert.equal(m.policyAudience('general'), 'general')
  assert.equal(m.policyAudience('graduate'), 'graduate')
  assert.equal(m.policyAudience('all'), null)
  assert.equal(m.policyAudience('unknown'), null)
})

test('四条分页首尾、中间、空页完全按服务端元数据', () => {
  assert.equal(m.POLICY_PAGE_SIZE, 4)
  assert.deepEqual(m.policyPagination(result(9, [], 1, 3)), { page: 1, pages: 3, previous: false, next: true })
  assert.deepEqual(m.policyPagination(result(9, [], 2, 3)), { page: 2, pages: 3, previous: true, next: true })
  assert.deepEqual(m.policyPagination(result(9, [], 3, 3)), { page: 3, pages: 3, previous: true, next: false })
  assert.deepEqual(m.policyPagination(result(0, [], 1, 0)), { page: 1, pages: 1, previous: false, next: false })
  assert.equal(m.policyPagination(result(17, [], 1, 9)).pages, 9)
})

test('三栏按换行去空白，缺失字段不从正文或摘要猜', () => {
  assert.deepEqual(m.policyLines('  身份证\r\n\n  申请表  \n证明'), ['身份证', '申请表', '证明'])
  for (const value of [undefined, null, '', ' \r\n ']) assert.deepEqual(m.policyLines(value), [m.POLICY_MISSING_FIELD])
  assert.deepEqual(m.policyLines('<script>原样纯文本</script>'), ['<script>原样纯文本</script>'])
})

test('原文三态：只有核验为 true 且有效 https 才给码', () => {
  assert.equal(m.policySourceLink({}).kind, 'missing')
  assert.equal(m.policySourceLink({ externalUrl: '  ', externalUrlVerified: true }).kind, 'missing')
  for (const verified of [undefined, false]) {
    const link = m.policySourceLink({ externalUrl: 'https://org.gov.cn/a', externalUrlVerified: verified })
    assert.equal(link.kind, 'unverified')
    assert.ok(link.message.includes('暂不提供扫码'))
  }
  assert.deepEqual(m.policySourceLink({ externalUrl: ' https://org.gov.cn/a ', externalUrlVerified: true }), {
    kind: 'verified', url: 'https://org.gov.cn/a', host: 'org.gov.cn',
  })
  for (const url of ['http://org.gov.cn', 'javascript:alert(1)', 'bad', 'https://u:p@org.gov.cn']) {
    assert.equal(m.policySourceLink({ externalUrl: url, externalUrlVerified: true }).kind, 'unverified')
  }
})

test('打印按钮生成中防重复，未知设备不冒充在线，离线仍可生成手机清单', () => {
  const state = { busy: false, printerReady: true, printerLoading: false }
  assert.deepEqual(m.policyPrintButton(state), { label: '打印办事清单（1 页）', disabled: false })
  assert.deepEqual(m.policyPrintButton({ ...state, busy: true }), { label: '正在生成办事清单…', disabled: true })
  assert.equal(m.policyPrintButton({ ...state, printerLoading: true }).disabled, true)
  assert.deepEqual(m.policyPrintButton({ ...state, printerReady: false }), {
    label: '打印机暂停服务 · 扫码把清单存到手机', disabled: false,
  })
  assert.equal(m.policyPrintButton({ ...state, blocked: true }).disabled, true)
})

test('文件大小与手机链接有效期按返回字段格式化', () => {
  assert.equal(m.policyFileSize(1025), '2 KB')
  assert.equal(m.policyFileSize(1048576), '1.0 MB')
  assert.equal(m.policyPhoneExpiry(null), '到期时刻未提供')
  assert.equal(m.policyPhoneExpiry('invalid'), '到期时刻未提供')
  assert.notEqual(m.policyPhoneExpiry('2026-11-05T12:00:00Z'), '到期时刻未提供')
})

test('读取有截止时间，失败或超时不伪造空数据', async () => {
  const data = { total: 0, items: [] }
  assert.equal(await m.policyRead(Promise.resolve(data), 100), data)
  await assert.rejects(m.policyRead(Promise.reject(new Error('offline')), 100), /offline/)
  await assert.rejects(m.policyRead(new Promise(() => {}), 5), /policy read timeout/)
})
