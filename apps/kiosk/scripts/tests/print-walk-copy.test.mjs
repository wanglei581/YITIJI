/**
 * W-46 / W-51：完成页订单号、再印一份、取纸页数，以及打印订单详单的实付和页范围。
 * 跑真实源码，不在测试里另抄一份逻辑。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(absolutePath, replacements = {}) {
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith('data:'))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const pageRange = transpile(join(kioskRoot, 'src/pages/print/pageRange.ts'))
const cashier = transpile(join(kioskRoot, 'src/pages/print/cashierStatus.ts'))
const progressUrl = transpile(join(kioskRoot, 'src/pages/print/printProgressModel.ts'), {
  './cashierStatus': cashier,
  './pageRange': pageRange,
})
const paymentUrl = transpile(join(kioskRoot, 'src/pages/profile/me/printOrders/paymentCopy.ts'))

const httpStub = toDataUrl('export class ApiHttpError extends Error { constructor(status, code) { super(String(code)); this.status = status; this.code = code } }')
const phoneUrl = transpile(join(kioskRoot, 'src/pages/upload/phoneUploadModel.ts'), {
  '../../services/api/httpAdapter': httpStub,
})
const conversionStub = toDataUrl('export function isWordDocument() { return false }')
const previewKindUrl = transpile(join(kioskRoot, 'src/pages/print/components/printPreviewKind.ts'), {
  '../../../services/api/documentConversion': conversionStub,
})

const progress = await import(progressUrl)
const payment = await import(paymentUrl)
const previewKind = await import(previewKindUrl)
const phone = await import(phoneUrl)
const progressPage = readFileSync(join(kioskRoot, 'src/pages/print/PrintProgressPage.tsx'), 'utf8')
const materialPage = readFileSync(join(kioskRoot, 'src/pages/print/PrintMaterialCheckPage.tsx'), 'utf8')
const previewCanvas = readFileSync(join(kioskRoot, 'src/components/PdfCanvasPreview.tsx'), 'utf8')

test('publicOrderNo 只接受 ORD- 号', () => {
  for (const fn of [progress.publicOrderNo, payment.publicOrderNo]) {
    assert.equal(fn('ORD-20260929-4BDFD88D74'), 'ORD-20260929-4BDFD88D74')
    assert.equal(fn('  ORD-1  '), 'ORD-1')
    assert.equal(fn('ptask_abc'), null)
    assert.equal(fn('cm123cuid'), null)
    assert.equal(fn('W2-ORDER-001'), null)
    assert.equal(fn('w2-order-001'), null)
    assert.equal(fn('SRV-ORDER-777'), null)
    assert.equal(fn('ORD-'), null)
    assert.equal(fn('ord-123'), null)
    assert.equal(fn(''), null)
    assert.equal(fn(null), null)
    assert.equal(fn(undefined), null)
  }
})

test('reprintHint 按真实价目写，0 元说免费试运营', () => {
  const free = progress.reprintHint(0)
  assert.match(free, /免费试运营/)
  assert.doesNotMatch(free, /不免费/)
  assert.doesNotMatch(free, /去付款/)

  const paid = progress.reprintHint(200)
  assert.match(paid, /再付款/)
  assert.doesNotMatch(paid, /免费试运营/)
  assert.doesNotMatch(paid, /不免费/)

  for (const unknown of [null, undefined, Number.NaN, -1]) {
    const text = progress.reprintHint(unknown)
    assert.match(text, /再确认价格/)
    assert.doesNotMatch(text, /不免费/)
    assert.doesNotMatch(text, /免费试运营/)
  }
})

test('doneTakeaway 份数乘进总页数，页数未知不写共 0 面', () => {
  const threeCopies = progress.doneTakeaway(
    { pages: 2 },
    { copies: 3, duplex: 'simplex', pagesPerSheet: 1, pageRange: 'all' },
  )
  assert.equal(threeCopies.pagesLabel, '全部 6 页（2 页 × 3 份）')
  assert.match(threeCopies.facesLabel, /6 张（6 面）/)
  assert.doesNotMatch(threeCopies.facesLabel, /0 面/)
  assert.doesNotMatch(threeCopies.pagesLabel, /^全部 2 页$/)

  const oneCopy = progress.doneTakeaway(
    { pages: 2 },
    { copies: 1, duplex: 'simplex', pagesPerSheet: 1, pageRange: 'all' },
  )
  assert.equal(oneCopy.pagesLabel, '全部 2 页')
  assert.match(oneCopy.facesLabel, /2 张（2 面）/)

  const duplex = progress.doneTakeaway(
    { pages: 2 },
    { copies: 3, duplex: 'duplex_long_edge', pagesPerSheet: 1, pageRange: 'all' },
  )
  assert.equal(duplex.pagesLabel, '全部 6 页（2 页 × 3 份）')
  assert.match(duplex.facesLabel, /3 张（6 面）/)
  assert.doesNotMatch(duplex.facesLabel, /12 面/)

  const ranged = progress.doneTakeaway(
    { pages: 2 },
    { copies: 3, duplex: 'simplex', pagesPerSheet: 1, pageRange: '1-1' },
  )
  assert.equal(ranged.pagesLabel, '全部 3 页（1 页 × 3 份）')

  for (const pages of [null, 0]) {
    const unknown = progress.doneTakeaway({ pages }, { copies: 3, duplex: 'simplex' })
    assert.equal(unknown.pagesLabel, '全部纸张')
    assert.doesNotMatch(unknown.facesLabel, /0 面/)
    assert.doesNotMatch(unknown.pagesLabel, /0 页/)
  }
})

test('页范围没传或 all 显示全部页，写明的范围原样显示', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.equal(payment.pageRangeDisplay(blank), '全部页')
  }
  assert.equal(payment.pageRangeDisplay('all'), '全部页')
  assert.equal(payment.pageRangeDisplay('ALL'), '全部页')
  assert.equal(payment.pageRangeDisplay('1-3'), '1-3')
  assert.equal(payment.pageRangeDisplay(' 1-3 '), '1-3')
  assert.notEqual(payment.pageRangeDisplay(''), '未记录')
  assert.notEqual(payment.pageRangeDisplay(null), '未记录')
})

test('0 元实付写免费试运营，其余仍标未记录且不推算', () => {
  const free = payment.netPaidDisplay({ amountCents: 0, discountCents: 0 })
  assert.equal(free.value, '0 元（免费试运营）')
  assert.equal(free.hint, undefined)

  const freeSource = payment.netPaidDisplay({ amountCents: 100, paymentSource: 'free' })
  assert.equal(freeSource.value, '0 元（免费试运营）')

  const paid = payment.netPaidDisplay({ amountCents: 240, discountCents: 40, paymentSource: 'offline' })
  assert.equal(paid.value, '未记录')
  assert.match(paid.hint, /不按应付减优惠/)
  assert.notEqual(paid.value, '¥2.00')
  assert.notEqual(paid.value, '免费')

  const missing = payment.netPaidDisplay({ amountCents: null })
  assert.equal(missing.value, '未记录')
})

const QUIET_COPY = '这台机器暂时没有回报打印进度，请看出纸口或找现场工作人员'
const ENCRYPTED_COPY = '这份 PDF 设置了打开密码，本机没法读取。请在手机或电脑上去掉密码后重新上传'

test('W-91 出纸中长时间没有新状态就换掉正在出纸', () => {
  assert.equal(progress.PRINT_PROGRESS_QUIET_MS, 45_000)
  assert.equal(progress.PRINT_PROGRESS_QUIET_COPY, QUIET_COPY)
  const printing = { status: 'printing', errorCode: '', failureReasonForUser: '', completedAt: '' }
  assert.equal(progress.progressStatusFingerprint(printing), progress.progressStatusFingerprint({ ...printing }))
  assert.notEqual(progress.progressStatusFingerprint(printing), progress.progressStatusFingerprint({ ...printing, status: 'failed' }))
  assert.match(progressPage, /PRINT_PROGRESS_QUIET_MS/)
  assert.match(progressPage, /PRINT_PROGRESS_QUIET_COPY/)
  assert.match(progressPage, /backendStatus === 'printing' && !progressQuiet/)
  assert.match(progressPage, /progressQuiet\s*\?\s*<>\{PRINT_PROGRESS_QUIET_COPY\}<\/>/)
})

test('W-88 已知失败不再说排队', () => {
  const view = progress.progressFailurePresentation('打印机缺纸，请联系工作人员补纸')
  assert.equal(view.headerTitle, '打印没有完成')
  assert.equal(view.badge, '打印未完成')
  assert.match(view.ask, /打印机缺纸/)
  assert.doesNotMatch(`${view.headerTitle}${view.badge}${view.ask}${view.doing}`, /排队|等待终端领取|正在出纸/)
  const blank = progress.progressFailurePresentation('   ')
  assert.match(blank.ask, /请联系现场工作人员/)
  assert.doesNotMatch(blank.badge, /排队/)
  assert.match(progressPage, /progressFailurePresentation/)
  assert.match(progressPage, /failed && !isSim \? failureView\.badge/)
  assert.match(progressPage, /查看订单/)
  assert.match(progressPage, /重新打印/)
  assert.match(progressPage, /联系工作人员/)
  assert.match(progressPage, /data-testid="print-progress-failure"/)
})

test('W-93 加密 PDF 说明原因并重新选择，页数未识别本身不算加密', () => {
  assert.equal(previewKind.ENCRYPTED_PDF_BLOCK_COPY, ENCRYPTED_COPY)
  assert.equal(previewKind.inspectionSignalsEncrypted(['PDF_PAGE_COUNT_NOT_DETECTED']), false)
  assert.equal(previewKind.inspectionSignalsEncrypted(['SOURCE_FILE_BYTES_UNAVAILABLE']), false)
  assert.equal(previewKind.inspectionSignalsEncrypted(['PDF_ENCRYPTED']), true)
  assert.equal(previewKind.inspectionSignalsEncrypted(['encrypted']), true)
  assert.equal(previewKind.inspectionSignalsEncrypted(['PII_REDACT_ENCRYPTED']), true)
  assert.match(materialPage, /ENCRYPTED_PDF_BLOCK_COPY/)
  assert.match(materialPage, /!encryptedPdf/)
  assert.match(materialPage, /重新选择文件/)
  assert.match(materialPage, /onEncryptedPdf/)
  assert.match(previewCanvas, /onPasswordRequired/)
  assert.match(previewCanvas, /setPasswordBlocked\(true\)/)
})

test('W-94 手机上传不支持的格式说清是什么、为什么、怎么办', () => {
  const cases = [
    ['heic', 'HEIC 照片'],
    ['wps', 'WPS 文字'],
    ['et', 'WPS 表格'],
    ['doc', 'Word 文档'],
  ]
  for (const [ext, name] of cases) {
    const view = phone.uploadView('type-error', {
      file: { name: `周建军材料.${ext}`, size: 37_000, ext, type: '' },
      typeIssue: null,
      unknownType: true,
      chips: ['PDF', 'JPG', 'PNG'],
    })
    assert.match(view.fileNote.text, new RegExp(name))
    assert.match(view.fileNote.text, /打不了/)
    assert.match(view.fileNote.text, /PDF/)
    assert.match(view.fileNote.text, /JPG/)
    assert.match(view.fileNote.text, /没有发出去/)
    assert.doesNotMatch(view.fileNote.text, /已收到/)
    assert.equal(view.progress.right, '未发送')
  }
})
