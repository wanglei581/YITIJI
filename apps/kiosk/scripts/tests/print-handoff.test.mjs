/**
 * 打印交接上下文（商用收口 P0-5 第二、三批）—— 单元测试 U1–U10。
 *
 * 规格：docs/reviews/print-handoff-unification-2026-09-28.md 第 3、4.5 节与「协调方裁定」。
 * 写法照 boot-ticket-clears-sensitive-session.test.mjs：把真实的 TypeScript 源码转译成 ESM，
 * 用内存里的 sessionStorage 跑，不在测试里另抄一份逻辑。
 *
 *   U1  新交接整份覆盖：旧检查结论、参数、任务、source 都不带过来，编号换新
 *   U2  归属四种情况；不符时存储被清，返回值里没有旧文件名
 *   U3  过期：满 30 分钟判过期并清；链接到期已过判「链接过期」；解析不出不拦
 *   U4  编号对不上的补丁不写入（检查页竞态）；清除只清同一编号
 *   U5  旧结构（v1）：直接清掉，不升级（产品负责人 9/29 拍板）
 *   U6  存储里查不到会员 id、令牌、手机号
 *   U7  参数求交 negotiatePrintParams
 *   U8  确认页状态判定：参数被收口后不再落到拦截屏
 *   U9  确认页取交接：带文件、但编号不符或没编号的临时状态，一律盖不过存储里的上下文
 *   U10 打印页生成的登录回跳地址不含查询串和文件身份
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = join(kioskRoot, '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

/** 转译一个 TS 源文件；replacements 把它的 import 说明符换成别的模块（data URL）。 */
function transpile(absolutePath, replacements = {}) {
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('data:'))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)) },
    removeItem: (key) => { map.delete(key) },
    clear: () => { map.clear() },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size },
    dump: () => Object.fromEntries(map),
  }
}

const STORAGE_KEY = 'ai-job-print:current-print-material-check'
const MINUTE = 60_000

let seq = 0
async function loadHandoff() {
  seq += 1
  const storage = memoryStorage()
  globalThis.window = { sessionStorage: storage }
  const session = transpile(join(kioskRoot, 'src/pages/print/printMaterialSession.ts'))
  const policy = transpile(join(kioskRoot, 'src/pages/print/printHandoffPolicy.ts'))
  const unattended = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
  const handoff = transpile(join(kioskRoot, 'src/pages/print/printHandoff.ts'), {
    './printMaterialSession': session,
    './printHandoffPolicy': policy,
    '../../copy/unattendedCopy': unattended,
  })
  const mod = await import(`${handoff}#${seq}`)
  const sessionMod = await import(`${session}#${seq}`)
  const policyMod = await import(`${policy}#${seq}`)
  return { ...mod, session: sessionMod, policy: policyMod, storage }
}

const GUEST = { kind: 'guest' }
const MEMBER_A = { kind: 'member', mark: 'mark-a-0001' }
const MEMBER_B = { kind: 'member', mark: 'mark-b-0002' }
const NOW = Date.parse('2026-09-29T08:00:00.000Z')

const fileA = () => ({
  name: '上一位的简历-13800138000.pdf', size: '128 KB', pages: 2, fileId: 'file-a',
  fileUrl: `/api/v1/files/file-a/content?expires=${NOW + 30 * MINUTE}&sig=aaa`, mimeType: 'application/pdf',
})
const fileB = () => ({
  name: '这一次的材料.pdf', size: '64 KB', pages: 1, fileId: 'file-b',
  fileUrl: `/api/v1/files/file-b/content?expires=${NOW + 30 * MINUTE}&sig=bbb`, mimeType: 'application/pdf',
})

const CHECK = {
  inspectionTaskId: 'i-1', piiTaskId: 'p-1', piiRedactTaskId: 'r-1', checkedAt: '2026-09-29T07:00:00.000Z',
  findingCount: 0, redactedCount: 0, keptCount: 0,
  redaction: { claim: 'nothing_to_redact', redactedFileId: null, appliedRedactedCount: 0, failedNoPositionCount: 0, keptCount: 0, reverifyRemainingCount: null, reverifyRan: false },
  mode: 'checked',
}
const PARAMS = { copies: 3, colorMode: 'color', duplex: 'duplex_long_edge', paperSize: 'A4', orientation: 'auto', quality: 'standard', scale: 'fit', pagesPerSheet: 1 }
const TASK = { id: 'task-1', kind: 'pii_scan', status: 'completed', accessToken: 'anon-token-xyz' }

test('U1 新交接整份覆盖：旧检查结论、参数、任务、source 一律不带过来，编号换新', async () => {
  const h = await loadHandoff()
  const first = h.beginPrintHandoff({ origin: 'upload', file: fileA(), source: 'resume' }, GUEST, NOW)
  assert.equal(first.ok, true)
  const patched = h.patchPrintHandoff(first.context.contextId, { materialCheck: CHECK, printParams: PARAMS, piiTask: TASK }, NOW + MINUTE)
  assert.ok(patched?.materialCheck && patched.printParams && patched.piiTask, '前提：旧上下文确实带着检查结论、参数和任务')

  const second = h.beginPrintHandoff({ origin: 'resume_optimize', file: fileB() }, GUEST, NOW + 2 * MINUTE)
  assert.equal(second.ok, true)
  assert.notEqual(second.context.contextId, first.context.contextId, '编号换新')
  const read = h.readPrintHandoff(GUEST, NOW + 3 * MINUTE)
  assert.equal(read.status, 'ok')
  assert.equal(read.context.contextId, second.context.contextId)
  assert.equal(read.context.file.fileId, 'file-b')
  for (const key of ['materialCheck', 'printParams', 'piiTask', 'inspectionTask', 'normalizeTask', 'piiRedactTask', 'source', 'order']) {
    assert.equal(read.context[key], undefined, `${key} 不许从上一份带过来`)
  }
  assert.equal(read.context.origin, 'resume_optimize')
  assert.equal(read.context.checkPolicy, 'exempt', '优化稿是派生产物，免检查')
  assert.equal(second.entry, 'confirm')
  const raw = JSON.parse(h.storage.getItem(STORAGE_KEY))
  assert.equal(raw.v, 2)
  assert.ok(!JSON.stringify(raw).includes('file-a'), '存储里不再有上一份的任何痕迹')
})

test('U1b 缺文件编号或打印链接的交接不写入，诚实返回失败', async () => {
  const h = await loadHandoff()
  const { fileId: _drop, ...noId } = fileB()
  assert.deepEqual(h.beginPrintHandoff({ origin: 'job_material', file: noId }, GUEST, NOW), { ok: false, reason: 'invalid_input' })
  assert.deepEqual(h.beginPrintHandoff({ origin: 'job_material', file: { ...fileB(), fileUrl: '' } }, GUEST, NOW), { ok: false, reason: 'invalid_input' })
  assert.equal(h.storage.getItem(STORAGE_KEY), null)
})

test('U1c sessionStorage 写不进时报 storage_unavailable，不静默退回', async () => {
  const h = await loadHandoff()
  globalThis.window = { sessionStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => undefined } }
  assert.deepEqual(h.beginPrintHandoff({ origin: 'upload', file: fileB() }, GUEST, NOW), { ok: false, reason: 'storage_unavailable' })
  const target = h.printHandoffTarget({ ok: false, reason: 'storage_unavailable' })
  assert.equal(target.ok, false)
  assert.equal(target.path, '/print/confirm')
  assert.deepEqual(target.state, { printHandoffError: 'storage_unavailable' })
  assert.match(h.printHandoffFailureText('storage_unavailable'), /本机暂时无法保存打印信息。需要帮助？/)
  assert.doesNotMatch(h.printHandoffFailureText('storage_unavailable'), /找现场工作人员/)
})

test('U2 归属：游客→游客、游客→会员（改绑）、同一次登录通过；换人 / 变游客 / 刷新后标记丢了一律不符并清掉', async () => {
  const h = await loadHandoff()
  h.beginPrintHandoff({ origin: 'upload', file: fileA() }, GUEST, NOW)
  assert.equal(h.readPrintHandoff(GUEST, NOW + MINUTE).status, 'ok', '游客 → 游客')

  const rebound = h.readPrintHandoff(MEMBER_A, NOW + MINUTE)
  assert.equal(rebound.status, 'ok', '游客中途登录视为同一人继续办理')
  assert.deepEqual(rebound.context.owner, MEMBER_A, '并改绑到这位会员')
  assert.deepEqual(JSON.parse(h.storage.getItem(STORAGE_KEY)).owner, MEMBER_A, '改绑写回存储')
  assert.equal(h.readPrintHandoff(MEMBER_A, NOW + MINUTE).status, 'ok', '同一次登录')

  for (const [label, who] of [['另一位会员', MEMBER_B], ['登出后的游客', GUEST], ['刷新后标记丢了', { kind: 'member', mark: 'mark-after-reload' }]]) {
    h.beginPrintHandoff({ origin: 'upload', file: fileA() }, MEMBER_A, NOW)
    const read = h.readPrintHandoff(who, NOW + MINUTE)
    assert.deepEqual(read, { status: 'owner_mismatch' }, `${label}：只报不符，不带旧文件的任何信息`)
    assert.equal(h.storage.getItem(STORAGE_KEY), null, `${label}：存储当场清掉`)
    assert.ok(!JSON.stringify(read).includes('上一位的简历'), `${label}：返回值里没有旧文件名`)
  }
})

test('U3 有效期：满 30 分钟判过期并清；链接到期已过判链接过期；解析不出到期时间不拦', async () => {
  const h = await loadHandoff()
  const begun = h.beginPrintHandoff({ origin: 'resume_report', file: fileB(), returnPath: '/resume/report?taskId=t-1#x' }, GUEST, NOW)
  assert.equal(begun.context.expiresAt, new Date(NOW + 30 * MINUTE).toISOString())
  assert.equal(begun.context.returnPath, '/resume/report', '返回路径只取路径部分')
  assert.equal(begun.context.fileUrlExpiresAt, new Date(NOW + 30 * MINUTE).toISOString(), '从打印链接的 expires 解析到期时间')
  assert.equal(h.readPrintHandoff(GUEST, NOW + 30 * MINUTE - 1).status, 'ok')
  const expired = h.readPrintHandoff(GUEST, NOW + 30 * MINUTE)
  assert.equal(expired.status, 'expired')
  assert.equal(expired.returnPath, '/resume/report', '过期仍可回到这一位自己的上一步')
  assert.equal(h.storage.getItem(STORAGE_KEY), null)

  const shortLink = { ...fileB(), fileUrl: `/api/v1/files/file-b/content?expires=${NOW + 5 * MINUTE}&sig=bbb` }
  h.beginPrintHandoff({ origin: 'job_fit', file: shortLink, returnPath: '/resume/job-fit' }, GUEST, NOW)
  assert.equal(h.readPrintHandoff(GUEST, NOW + 4 * MINUTE).status, 'ok')
  const linkExpired = h.readPrintHandoff(GUEST, NOW + 5 * MINUTE)
  assert.equal(linkExpired.status, 'link_expired')
  assert.equal(linkExpired.returnPath, '/resume/job-fit')
  assert.equal(h.storage.getItem(STORAGE_KEY), null)

  for (const fileUrl of ['/w2-fixtures/sample-visible.pdf', '/api/v1/files/file-b/content?sig=x', '/api/v1/files/file-b/content?expires=abc&sig=x']) {
    const begunUnknown = h.beginPrintHandoff({ origin: 'upload', file: { ...fileB(), fileUrl } }, GUEST, NOW)
    assert.equal(begunUnknown.context.fileUrlExpiresAt, null, `${fileUrl}：到期时间未知`)
    assert.equal(h.readPrintHandoff(GUEST, NOW + 29 * MINUTE).status, 'ok', `${fileUrl}：解析不出不拦`)
  }
})

test('U4 编号对不上的补丁不写入；清除只清同一编号', async () => {
  const h = await loadHandoff()
  const a = h.beginPrintHandoff({ origin: 'upload', file: fileA() }, GUEST, NOW)
  const b = h.beginPrintHandoff({ origin: 'upload', file: fileB() }, GUEST, NOW + MINUTE)
  // A 的检查在路上，回来时存储里已经是 B：A 的结论不许写进 B。
  assert.equal(h.patchPrintHandoff(a.context.contextId, { materialCheck: CHECK, file: fileA() }, NOW + 2 * MINUTE), null)
  const read = h.readPrintHandoff(GUEST, NOW + 2 * MINUTE)
  assert.equal(read.context.file.fileId, 'file-b')
  assert.equal(read.context.materialCheck, undefined)
  // 403/404/410 清场只清对应编号：A 的任务失效，不许误清已经换成的 B。
  assert.equal(h.clearPrintHandoff(a.context.contextId), false)
  assert.equal(h.readPrintHandoff(GUEST, NOW + 2 * MINUTE).status, 'ok')
  assert.equal(h.clearPrintHandoff(b.context.contextId), true)
  assert.equal(h.readPrintHandoff(GUEST, NOW + 2 * MINUTE).status, 'none')
  // 补丁不能改身份字段。
  const c = h.beginPrintHandoff({ origin: 'upload', file: fileB() }, GUEST, NOW)
  const patched = h.patchPrintHandoff(c.context.contextId, { contextId: 'forged', owner: MEMBER_B, expiresAt: new Date(NOW + 999 * MINUTE).toISOString(), checkPolicy: 'exempt' }, NOW + MINUTE)
  assert.equal(patched.contextId, c.context.contextId)
  assert.deepEqual(patched.owner, GUEST)
  assert.equal(patched.expiresAt, c.context.expiresAt)
  assert.equal(patched.checkPolicy, 'required')
})

test('U5 旧结构（v1）与坏结构：当场清掉，不当成游客的升级', async () => {
  const h = await loadHandoff()
  const v1 = { file: fileA(), source: 'document', materialCheck: CHECK, printParams: PARAMS, updatedAt: '2026-09-28T00:00:00.000Z' }
  h.storage.setItem(STORAGE_KEY, JSON.stringify(v1))
  assert.deepEqual(h.readPrintHandoff(GUEST, NOW), { status: 'invalid' })
  assert.equal(h.storage.getItem(STORAGE_KEY), null)
  for (const broken of ['not json', JSON.stringify({ v: 2 }), JSON.stringify({ v: 2, contextId: 'x', file: { name: 'a' } }), JSON.stringify([1, 2])]) {
    h.storage.setItem(STORAGE_KEY, broken)
    assert.deepEqual(h.readPrintHandoff(GUEST, NOW), { status: 'invalid' }, broken)
    assert.equal(h.storage.getItem(STORAGE_KEY), null)
  }
  assert.deepEqual(h.readPrintHandoff(GUEST, NOW), { status: 'none' })
})

test('U6 存储里查不到会员 id、令牌、手机号', async () => {
  const h = await loadHandoff()
  const user = { id: 'member-id-7788', token: 'member-session-token-9999', phoneMasked: '138****8000', nickname: '张三', method: 'phone' }
  const owner = h.printHandoffOwnerFor(user)
  assert.equal(owner.kind, 'member')
  assert.ok(typeof owner.mark === 'string' && owner.mark.length >= 8, '本次登录的随机标记')
  // 标记是随机十六进制串，查 4 位数字片段会偶然撞上（CI 红过一次）；查的是整段会员字段有没有被带进去。
  for (const secret of [user.id, user.token, user.phoneMasked, '13800138000', user.nickname]) assert.ok(!owner.mark.includes(secret), `标记里不许带 ${secret}`)
  const sameFields = h.printHandoffOwnerFor({ ...user }).mark
  assert.notEqual(sameFields, owner.mark, '同样的会员字段换一次登录，标记也不同：标记不是由会员字段算出来的')
  assert.deepEqual(h.printHandoffOwnerFor(user), owner, '同一次登录拿到同一个标记')
  assert.notEqual(h.printHandoffOwnerFor({ ...user }).mark, owner.mark, '重新登录（新的登录对象）换新标记')
  assert.deepEqual(h.printHandoffOwnerFor(null), { kind: 'guest' })

  const begun = h.beginPrintHandoff({ origin: 'my_documents', requiresCheck: true, file: fileA(), source: 'resume' }, owner, NOW)
  h.patchPrintHandoff(begun.context.contextId, { piiTask: TASK, materialCheck: CHECK }, NOW + MINUTE)
  const raw = h.storage.getItem(STORAGE_KEY)
  assert.ok(!raw.includes('13800138000'), '文件名里的手机号在存储前已打码')
  assert.match(raw, /138\*\*\*\*8000/)
  for (const forbidden of ['member-id-7788', 'member-session-token-9999', '张三', 'nickname', 'phoneMasked', 'endUserId']) {
    assert.ok(!raw.includes(forbidden), `存储里不许出现 ${forbidden}`)
  }
  assert.deepEqual(JSON.parse(raw).owner, owner, '归属只存本次登录的随机标记')
})

test('U6b 入口策略表：原件去打印台检查，派生产物直达报价，我的文档按文件定', async () => {
  const h = await loadHandoff()
  const { printHandoffPolicyFor, printHandoffEntryPath } = h.policy
  for (const origin of ['upload', 'scan_result', 'resume_original', 'image_convert', 'sign_stamp']) {
    assert.deepEqual(printHandoffPolicyFor(origin), { checkPolicy: 'required', entry: 'check' }, origin)
  }
  for (const origin of ['resume_report', 'resume_optimize', 'resume_generate', 'advisor_artifact', 'job_material', 'job_fit', 'career_plan', 'self_assessment', 'interview_report', 'interview_practice', 'fair_material', 'fair_visit_plan']) {
    assert.deepEqual(printHandoffPolicyFor(origin), { checkPolicy: 'exempt', entry: 'confirm' }, origin)
  }
  assert.deepEqual(printHandoffPolicyFor('fair_company'), { checkPolicy: 'exempt', entry: 'preview' })
  assert.deepEqual(printHandoffPolicyFor('my_documents', { requiresCheck: true }), { checkPolicy: 'required', entry: 'check' })
  assert.deepEqual(printHandoffPolicyFor('my_documents', { requiresCheck: false }), { checkPolicy: 'exempt', entry: 'confirm' })
  assert.deepEqual(printHandoffPolicyFor('my_documents'), { checkPolicy: 'required', entry: 'check' }, '不说就按原件（fail-closed）')
  assert.equal(printHandoffEntryPath('check'), '/print/desk?step=check')
  assert.equal(printHandoffEntryPath('preview'), '/print/desk?step=preview')
  assert.equal(printHandoffEntryPath('confirm'), '/print/confirm')
  const begun = h.beginPrintHandoff({ origin: 'scan_result', file: fileB() }, GUEST, NOW)
  assert.deepEqual(h.printHandoffTarget(begun), { ok: true, path: '/print/desk?step=check', state: { printContextId: begun.context.contextId } })
})

async function loadShared() {
  const url = transpile(join(repoRoot, 'packages/shared/src/types/print.ts'))
  seq += 1
  return import(`${url}#${seq}`)
}

const BASE = { copies: 1, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4', orientation: 'auto', quality: 'standard', scale: 'fit', pagesPerSheet: 1 }
const cap = (loading, color, duplex) => ({
  loading,
  color: { allowed: color, reason: color ? null : '本机彩色打印暂未开通' },
  duplex: { allowed: duplex, reason: duplex ? null : '本机自动双面暂未开通' },
})

test('U7 参数求交 negotiatePrintParams', async () => {
  const { negotiatePrintParams } = await loadShared()
  const wantDuplex = { ...BASE, duplex: 'duplex_long_edge' }
  const noDuplex = negotiatePrintParams(wantDuplex, cap(false, true, false))
  assert.equal(noDuplex.waiting, false)
  assert.equal(noDuplex.params.duplex, 'simplex', '要双面但本机不许 → 改单面')
  assert.deepEqual(noDuplex.adjustments.map((a) => [a.field, a.from, a.to]), [['duplex', 'duplex_long_edge', 'simplex']])
  assert.equal(noDuplex.adjustments[0].reason, '本机自动双面暂未开通', '理由用本机能力给的原话')

  const noColor = negotiatePrintParams({ ...BASE, colorMode: 'color' }, cap(false, false, true))
  assert.equal(noColor.params.colorMode, 'black_white', '要彩色但不许 → 改黑白')
  assert.deepEqual(noColor.adjustments.map((a) => a.field), ['colorMode'])

  const allowed = negotiatePrintParams({ ...BASE, colorMode: 'color', duplex: 'duplex_short_edge' }, cap(false, true, true))
  assert.deepEqual(allowed.params, { ...BASE, colorMode: 'color', duplex: 'duplex_short_edge' }, '本机许 → 不变')
  assert.deepEqual(allowed.adjustments, [])

  const loadingNeeds = negotiatePrintParams({ ...BASE, colorMode: 'color' }, cap(true, false, false))
  assert.equal(loadingNeeds.waiting, true, '能力加载中且需要能力 → 等')
  assert.equal(loadingNeeds.params.colorMode, 'black_white', '等的时候误用也只会是最保守参数')
  assert.deepEqual(loadingNeeds.adjustments, [], '还没查清不下结论')

  const loadingBase = negotiatePrintParams(BASE, cap(true, false, false))
  assert.equal(loadingBase.waiting, false, '基线参数不等')
  assert.deepEqual(loadingBase.params, BASE)

  const nup = negotiatePrintParams({ ...BASE, pagesPerSheet: 4 }, cap(false, true, true))
  assert.equal(nup.params.pagesPerSheet, 1, '每张纸只印一页，恒为 1')
  assert.deepEqual(nup.adjustments.map((a) => [a.field, a.from, a.to]), [['pagesPerSheet', 4, 1]])
})

async function loadConfirmModel() {
  const queryStub = toDataUrl(`
export const PRINT_CONFIRM_STATES = ['missing-context','invalid-context','quoting','quoted','quote-failed','capability-invalid-params','benefit-unverified','zero-amount']
export function isRegisteredScreen(value) { return value !== null && PRINT_CONFIRM_STATES.includes(value) }
`)
  const url = transpile(join(kioskRoot, 'src/pages/print/printConfirmModel.ts'), { './printConfirmQuery': queryStub })
  seq += 1
  return import(`${url}#${seq}`)
}

test('U8 确认页状态判定：参数被收口后按收口后的参数报价，不落拦截屏', async () => {
  const { derivePrintConfirmScreen, confirmScreenAllowsOrder } = await loadConfirmModel()
  const base = { queryInvalid: false, requestedState: null, hasFile: true, handoffInvalid: false, ordered: false, waitingCapability: false, adjusted: false, benefitsError: false }
  const ready = { status: 'ready', amountCents: 200, billablePages: 2, unitCents: 100, quantity: 2 }
  assert.equal(derivePrintConfirmScreen({ ...base, adjusted: true, quote: { status: 'loading' } }), 'quoting', '收口后照常报价：报价中就是报价中')
  const adjustedReady = derivePrintConfirmScreen({ ...base, adjusted: true, quote: ready })
  assert.equal(adjustedReady, 'capability-invalid-params', '状态键不改（稿 14 定稿）')
  assert.equal(confirmScreenAllowsOrder(adjustedReady), true, '收口后主按钮可点')
  assert.equal(derivePrintConfirmScreen({ ...base, waitingCapability: true, quote: ready }), 'quoting', '能力还在等：停在「正在计算本次费用」，不闪拦截屏')
  assert.equal(derivePrintConfirmScreen({ ...base, quote: ready }), 'quoted')
  assert.equal(confirmScreenAllowsOrder('quoted'), true)
  assert.equal(derivePrintConfirmScreen({ ...base, handoffInvalid: true, quote: ready }), 'invalid-context')
  assert.equal(derivePrintConfirmScreen({ ...base, ordered: true, quote: ready }), 'ordered', '建过单只看状态')
  assert.equal(confirmScreenAllowsOrder('ordered'), false, '建过单不能再建第二单')
  for (const screen of ['missing-context', 'invalid-context', 'quoting', 'quote-failed']) {
    assert.equal(confirmScreenAllowsOrder(screen), false, screen)
  }
})

test('U9 确认页取交接：临时状态只认编号，带文件也盖不过存储里的上下文', async () => {
  const h = await loadHandoff()
  const stored = h.beginPrintHandoff({ origin: 'resume_optimize', file: fileB() }, GUEST, NOW)
  const read = h.readPrintHandoff(GUEST, NOW + MINUTE)
  // 没带编号（登录回跳、返回预览）：用存储里那一份。
  const noId = h.resolveRouteHandoff(read, { file: fileA(), params: PARAMS })
  assert.equal(noId.status, 'ok')
  assert.equal(noId.context.file.fileId, 'file-b', '临时状态里的文件一律不看')
  // 编号对得上：同一份。
  assert.equal(h.resolveRouteHandoff(read, { printContextId: stored.context.contextId, file: fileA() }).context.file.fileId, 'file-b')
  // 编号对不上：这一单作废，不提供「看当前这一份」。
  const replaced = h.resolveRouteHandoff(read, { printContextId: 'older-ctx-000000001', file: fileA() })
  assert.deepEqual(replaced, { status: 'replaced' })
  assert.ok(!JSON.stringify(replaced).includes('file-b') && !JSON.stringify(replaced).includes('file-a'))
  // 失败原因原样透传（不会被临时状态里的文件「补救」成正常）。
  assert.deepEqual(h.resolveRouteHandoff({ status: 'none' }, { file: fileA() }), { status: 'none' })
  assert.deepEqual(h.resolveRouteHandoff({ status: 'none' }, { printHandoffError: 'storage_unavailable' }), { status: 'storage_unavailable' })
})

test('U10 打印页生成的登录回跳地址不含查询串和文件身份', async () => {
  const url = transpile(join(kioskRoot, 'src/auth/returnPath.ts'))
  seq += 1
  const { loginPathForPrintStep } = await import(`${url}#${seq}`)
  globalThis.window = { location: { pathname: '/print/confirm', search: '?fileId=file-b&state=quoted', hash: '#frag' } }
  const confirm = loginPathForPrintStep('confirm')
  assert.equal(confirm, `/login?from=${encodeURIComponent('/print/confirm')}`)
  const preview = loginPathForPrintStep('preview')
  assert.equal(preview, `/login?from=${encodeURIComponent('/print/desk?step=preview')}`)
  for (const path of [confirm, preview]) {
    const from = decodeURIComponent(new URL(path, 'http://kiosk').searchParams.get('from'))
    assert.ok(!/fileId|fileUrl|sig=|expires=|contextId|state=|#/.test(from), `${from} 不带文件身份与原查询串`)
  }
})

test('U11 我的文档：原件、原件转出的 PDF 先过材料检查；AI 报告、优化稿直达报价（9/29 拍板）', async () => {
  const stubs = {
    '../../../../services/api/httpAdapter': toDataUrl('export class ApiHttpError extends Error {}'),
    '../../../../services/api/userErrorMessage': toDataUrl('export const errorCodeOf = () => null; export const userMessageOf = (_e, f) => f'),
  }
  const url = transpile(join(kioskRoot, 'src/pages/profile/me/components/documentReprint.ts'), stubs)
  seq += 1
  const { documentNeedsPrintMaterialCheck } = await import(`${url}#${seq}`)
  const original = { purpose: 'resume_upload', assetCategory: 'original' }
  const wordOriginal = { purpose: 'print_doc', assetCategory: 'original' }
  const convertedFromWord = { purpose: 'print_doc', assetCategory: 'derived' }
  assert.equal(documentNeedsPrintMaterialCheck(original), true, '本人原件先查')
  assert.equal(documentNeedsPrintMaterialCheck(wordOriginal), true, 'print_doc 原件先查')
  assert.equal(documentNeedsPrintMaterialCheck(convertedFromWord), false, '单看派生的 print_doc（AI 报告同形）放行')
  assert.equal(documentNeedsPrintMaterialCheck(convertedFromWord, wordOriginal), true, '刚从原件转出的 PDF 按原件先查')
  assert.equal(documentNeedsPrintMaterialCheck({ purpose: 'resume_upload', assetCategory: 'derived' }), true, '简历原件转出的派生件只可能来自本人原件，先查')
  assert.equal(documentNeedsPrintMaterialCheck({ purpose: 'id_scan', assetCategory: 'derived' }), true, '证件扫描的派生件先查')
  assert.equal(documentNeedsPrintMaterialCheck({ purpose: 'print_doc', assetCategory: 'derived' }), false, 'AI 报告（派生 print_doc）直达报价')
  assert.equal(documentNeedsPrintMaterialCheck({ purpose: 'resume_upload', assetCategory: 'optimized' }), false, '优化稿直达报价')
  assert.equal(documentNeedsPrintMaterialCheck({ purpose: 'print_doc', assetCategory: null }), true, '类别缺失按原件（fail-closed）')
})
