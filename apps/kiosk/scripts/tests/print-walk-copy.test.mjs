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
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith('data:') && !Object.values(replacements).includes(specifier))
  assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const pageRange = transpile(join(kioskRoot, 'src/pages/print/pageRange.ts'))
const cashier = transpile(join(kioskRoot, 'src/pages/print/cashierStatus.ts'))
const unattendedUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
const progressUrl = transpile(join(kioskRoot, 'src/pages/print/printProgressModel.ts'), {
  './cashierStatus': cashier,
  './pageRange': pageRange,
  '../../copy/unattendedCopy': unattendedUrl,
})
const paymentUrl = transpile(join(kioskRoot, 'src/pages/profile/me/printOrders/paymentCopy.ts'))

const httpStub = toDataUrl('export class ApiHttpError extends Error { constructor(status, code) { super(String(code)); this.status = status; this.code = code } }')
const phoneUrl = transpile(join(kioskRoot, 'src/pages/upload/phoneUploadModel.ts'), {
  '../../services/api/httpAdapter': httpStub,
  '../../copy/unattendedCopy': unattendedUrl,
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
const progressSections = readFileSync(join(kioskRoot, 'src/pages/print/components/PrintProgressSections.tsx'), 'utf8')
const materialPage = readFileSync(join(kioskRoot, 'src/pages/print/PrintMaterialCheckPage.tsx'), 'utf8')
const materialPresentation = readFileSync(join(kioskRoot, 'src/pages/print/components/MaterialCheckPresentation.tsx'), 'utf8')
const previewCanvas = readFileSync(join(kioskRoot, 'src/components/PdfCanvasPreview.tsx'), 'utf8')
const previewPanel = readFileSync(join(kioskRoot, 'src/pages/print/components/PrintPreviewPanel.tsx'), 'utf8')

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
  assert.doesNotMatch(free, /报价|价格|付款|收费|未收款|抵扣|权益/)

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

test('0 元失败页不提已付金额，收费单保留原句', () => {
  assert.equal(progress.jamOrderKeptLine('paid'), '你的订单和已付金额都保留着')
  assert.equal(progress.jamOrderKeptLine('free'), '你的订单还在，处理好后可以继续打印')
  assert.equal(progress.jamOrderKeptLine('unknown'), '你的订单还在，处理好后可以继续打印')
  assert.equal(progress.failureStaffDoing('paid'), '订单和支付记录都在，请凭订单找现场工作人员处理。')
  assert.equal(progress.failureStaffDoing('free'), '你的订单还在，请凭订单找现场工作人员处理。')
  assert.equal(progress.failureStaffDoing('unknown'), '你的订单还在，请凭订单找现场工作人员处理。')
  assert.match(progress.outOfPaperDoing({ fact: 'paid', amountCents: 200 }), /已付金额/)
  assert.doesNotMatch(progress.outOfPaperDoing({ fact: 'free', amountCents: 0 }), /已付金额|支付/)
  assert.doesNotMatch(progress.outOfPaperDoing({ fact: 'unknown', amountCents: null }), /已付金额|支付/)
})

test('0 元订单不算收费单', () => {
  assert.equal(payment.isFreeMemberOrder({ payStatus: 'paid', amountCents: 0, paymentSource: 'offline' }), true)
  assert.equal(payment.isFreeMemberOrder({ payStatus: 'paid', amountCents: 100, paymentSource: 'free' }), true)
  assert.equal(payment.isFreeMemberOrder({ payStatus: 'paid', amountCents: 100, paymentSource: 'offline' }), false)
  assert.equal(payment.isFreeMemberOrder({ payStatus: null, amountCents: 0 }), false)
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
  const reason = '打印机缺纸，请联系工作人员补纸'
  const view = progress.progressFailurePresentation(reason)
  assert.equal(view.headerTitle, '打印没有完成')
  assert.equal(view.badge, '打印未完成')
  assert.match(view.ask, /打印机缺纸/)
  assert.match(view.wayOut, /重新打印/)
  assert.doesNotMatch(view.wayOut, /打印机缺纸/)
  assert.doesNotMatch(`${view.headerTitle}${view.badge}${view.ask}${view.doing}${view.wayOut}`, /排队|等待终端领取|正在出纸/)
  const blank = progress.progressFailurePresentation('   ')
  assert.match(blank.ask, /请联系现场工作人员/)
  assert.doesNotMatch(blank.badge, /排队/)
  assert.match(progressPage, /progressFailurePresentation/)
  assert.match(progressPage, /failed && !isSim \? failureView\.badge/)
  assert.match(progressPage, /hint=\{reprintHint\(amountCents\)\}/)
  assert.match(progressPage, /PrintProgressFailureNote wayOut=\{failureView\.wayOut\}/)
  assert.doesNotMatch(progressPage, /PrintProgressFailureNote[^/\n]*failureView\.ask/)
  assert.match(progressSections, /data-testid="print-progress-failure"/)
  assert.match(progressSections, /\{wayOut\}/)
  assert.doesNotMatch(progressSections, /\{ask\}/)
  assert.match(progressSections, /<p className="why">\{hint\}<\/p>/)
  assert.match(progressSections, />\s*重新打印\s*</)
  assert.match(progressSections, /查看订单/)
  assert.match(progressSections, /联系工作人员/)
  assert.doesNotMatch(progressSections, /重新打印[\s\S]{0,40}<small>/)
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
  assert.match(materialPresentation, /encryptedPdf \? '打不开'/)
  assert.deepEqual(previewKind.ENCRYPTED_PDF_UNLOCK_STEPS.map((step) => step.title), [
    '在电脑上打开',
    '另存为不带打开密码的 PDF',
    '重新上传',
  ])
  assert.match(previewKind.ENCRYPTED_PDF_UNLOCK_STEPS.map((step) => step.body).join('\n'), /WPS 或 Acrobat/)
  assert.match(materialPresentation, /ENCRYPTED_PDF_UNLOCK_STEPS/)
  assert.match(materialPresentation, /props\.encryptedPdf \? null :/)
  assert.match(materialPresentation, /normalization && !props\.encryptedPdf/)
  assert.match(materialPresentation, /data-encrypted=\{props\.encryptedPdf \? 'true' : undefined\}/)
  assert.match(previewPanel, /previewKind === 'word' \? \([\s\S]*Word 转换暂未开放，请另存为 PDF 再上传。/)
  assert.match(previewPanel, /encrypted \? null :/)
  assert.match(previewPanel, /这份 PDF 打不开，看不到页码/)
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

// B 补：渲染现有表现组件的真实 JSX，检查零元屏可见文案和拒单原因数量。
// 这里只隔离按钮/图标等依赖；下单与重试行为仍由现有 Playwright 用例验证。
const jsxUrl = import.meta.resolve('react/jsx-runtime')
const { createElement } = await import('react')
const { renderToStaticMarkup } = await import('react-dom/server')
const iconUrl = toDataUrl('export const AlertCircleIcon = () => null; export const ChevronRightIcon = () => null; export const FileTextIcon = () => null; export const LockIcon = () => null; export const ShieldCheckIcon = () => null; export const TicketIcon = () => null;')
const aiUrl = toDataUrl(`import { jsx } from '${jsxUrl}'; export function PrintAiHelp({label}) { return jsx('button', {children:label}) }`)
const benefitStub = toDataUrl('export const PRINT_BENEFIT_REDEEM_CTA_LABEL = "使用权益"; export const PRINT_BENEFIT_REDEEM_DISABLED_REASON = "未开放"')
const partsUrl = transpile(join(kioskRoot, 'src/pages/print/components/PrintConfirmParts.tsx'), {
  'react/jsx-runtime': jsxUrl,
  'lucide-react': iconUrl,
  '../../../services/api/benefits': benefitStub,
  './PrintAiHelp': aiUrl,
})
const queryUrl = toDataUrl('export const isRegisteredScreen = () => true')
const confirmModelUrl = transpile(join(kioskRoot, 'src/pages/print/printConfirmModel.ts'), { './printConfirmQuery': queryUrl })
const viewUrl = transpile(join(kioskRoot, 'src/pages/print/components/PrintConfirmView.tsx'), {
  'react/jsx-runtime': jsxUrl,
  'lucide-react': iconUrl,
  '../printConfirmModel': confirmModelUrl,
  './PrintConfirmParts': partsUrl,
})
const { PrintConfirmView } = await import(viewUrl)
const confirmProps = {
  step: 4, freePricing: true, file: { name: '本人文件.pdf', pages: 2, size: '14 KB' },
  invalidReason: '', summaryRows: [], adjustments: [], paperNote: null,
  pricedParamsLabel: '黑白 · 单面', costCalcLabel: '不应上屏的报价',
  amountText: '0.00', benefitView: null, redactionText: null, materialDemo: false,
  printerBlocked: false, printerBlockedReason: '', terminalFailed: false,
  terminalFailedText: '', selfAssessment: null, printNotes: null,
  actions: createElement('button', {}, '确认打印'), submitError: null, onLogin: () => {},
}
const visibleMarkup = (props) => renderToStaticMarkup(createElement(PrintConfirmView, props)).replace(/<[^>]*>/g, '')
test('B 补：零元加载、失败、确认与参数收口的真实 JSX 不说收费或权益机制', () => {
  for (const [screen, quote, adjustments] of [
    ['quoting', { status: 'loading' }, []],
    ['quote-failed', { status: 'unavailable', reason: '页数以实际结果为准，确认前不显示金额' }, []],
    ['zero-amount', { status: 'ready', amountCents: 0, billablePages: 2 }, []],
    ['capability-invalid-params', { status: 'ready', amountCents: 0, billablePages: 2 }, [{ field: 'colorMode' }]],
  ]) {
    const text = visibleMarkup({ ...confirmProps, screen, quote, adjustments })
    assert.match(text, /页数核定/)
    assert.doesNotMatch(text, /报价|价格|费用|付款|扣费|收款|抵扣|权益/)
  }
})
test('W-117：收费闸门拒单原因只上屏一次，单卡占满现有栅格', () => {
  const reason = '这台终端暂停接打印单，暂不能下单，请稍后再试或换一台终端'
  const props = { ...confirmProps, freePricing: false, screen: 'quote-failed', quote: { status: 'unavailable', code: 'PRINT_TERMINAL_QUEUE_HALTED', reason }, costCalcLabel: reason, printerBlocked: true, printerBlockedReason: '打印机暂时不可用，请联系现场工作人员' }
  const html = renderToStaticMarkup(createElement(PrintConfirmView, props))
  assert.equal(html.split(reason).length - 1, 1)
  assert.match(html, /data-single="true"/)
  assert.doesNotMatch(html, /可能的原因/)
  assert.doesNotMatch(html, /打印机暂时不可用，请联系现场工作人员/)
})

const hubIconUrl = toDataUrl('export const ArrowRightIcon = () => null; export const CopyIcon = () => null; export const InfoIcon = () => null; export const LockIcon = () => null;')
const hubContentUrl = transpile(join(kioskRoot, 'src/pages/print-scan/printHubContent.ts'))
const hubViewUrl = transpile(join(kioskRoot, 'src/pages/print-scan/components/QxPrintHubView.tsx'), {
  'react/jsx-runtime': jsxUrl,
  'lucide-react': hubIconUrl,
  '../../print/components/PrintAiHelp': aiUrl,
  '../../../components/qingxu/QxAppNavbar': toDataUrl('export const QxAppNavbar = () => null'),
  '../printHubContent': hubContentUrl,
})
const { QxPrintHubView } = await import(hubViewUrl)
test('BFIX：Hub 不额外读取价目，入口与展开说明均使用中性文案', () => {
  const home = readFileSync(join(kioskRoot, 'src/pages/print-scan/PrintScanHomePage.tsx'), 'utf8')
  assert.doesNotMatch(home, /priceConfigApi|usePrintPriceConfig|fetchPrintPriceConfig|price-config/)
  for (const hubState of ['default', 'capability-loading', 'capability-error', 'locked', 'device-off']) {
    const html = renderToStaticMarkup(createElement(QxPrintHubView, {
      hubState, probe: 'ok', mfp: 'ready', colorDuplexLabel: '本机暂未开通',
      capabilities: [], arrivalCode: { key: 'arrival', icon: () => null, title: '到机码', description: '输入到机码' },
      quickLinks: [], capabilityGroupHint: '', recordsGroupHint: '', notices: ['隐私说明', '电子签说明'],
      onBack: () => {}, onRetry: () => {}, onHelp: () => {}, onArrivalCode: () => {}, onQuickLink: () => {}, onCapability: () => {},
    }))
    const text = html.replace(/<[^>]*>/g, '')
    // 未办理、未核价的入口无需钱的字眼，也不得凭入口状态承诺免费；付费核对仍在确认页。
    assert.doesNotMatch(text, /价格|报价|费用|付款|收款|抵扣|权益|免费/)
    assert.match(text, /可用服务，以办理时显示为准/)
    assert.match(text, /隐私与电子签说明/)
    assert.match(text, /按 A4 出纸；结束办理清除本机临时信息，文件按留存期限管理/)
    if (hubState === 'default') assert.match(text, /文件检查 → 设置参数 → 确认打印/)
  }
})

test('W-117：缺纸、异常、离线分别说明，签名提示只在真开通时出现', () => {
  for (const [label, notice] of [
    ['打印机缺纸', '打印机缺纸，请找现场工作人员加纸'],
    ['打印机异常', '打印机异常，请找现场工作人员检查'],
    ['打印机离线', '打印机当前无法连接，请找现场工作人员'],
  ]) {
    for (const actionable of [false, true]) {
      const html = renderToStaticMarkup(createElement(QxPrintHubView, {
        hubState: 'device-off', probe: 'ok', mfp: 'unavailable',
        printerUnavailable: { label, notice }, colorDuplexLabel: '本机暂未开通',
        capabilities: [{ key: 'sign', title: '签名', description: '本人手写签名', icon: () => null, actionable, available: actionable }],
        arrivalCode: { key: 'arrival', icon: () => null, title: '到机码', description: '输入到机码' },
        quickLinks: [], capabilityGroupHint: label, recordsGroupHint: '', notices: [],
        onBack: () => {}, onRetry: () => {}, onHelp: () => {}, onArrivalCode: () => {}, onQuickLink: () => {}, onCapability: () => {},
      }))
      const banner = /<section class="ph-fallback"[^>]*>(.*?)<\/section>/s.exec(html)?.[1]
      assert.ok(banner)
      assert.match(banner, new RegExp(notice))
      if (label !== '打印机离线') assert.doesNotMatch(banner, /离线|无法连接/)
      if (actionable) assert.match(banner, /签名仍可使用/)
      else assert.doesNotMatch(banner, /签名仍可使用/)
    }
  }
})

const cashierIcons = toDataUrl('export const AlertTriangleIcon = () => null; export const CheckCircle2Icon = () => null; export const Clock3Icon = () => null; export const FileXIcon = () => null; export const InfoIcon = () => null; export const LockIcon = () => null; export const QrCodeIcon = () => null; export const ScanLineIcon = () => null; export const Undo2Icon = () => null;')
const cashierModelUrl = transpile(join(kioskRoot, 'src/pages/print/cashierQxModel.tsx'), {
  'react/jsx-runtime': jsxUrl, 'lucide-react': cashierIcons, './cashierStatus': cashier,
})
const cashierViewUrl = transpile(join(kioskRoot, 'src/pages/print/components/CashierQxView.tsx'), {
  'react/jsx-runtime': jsxUrl, 'lucide-react': cashierIcons, './PrintAiHelp': aiUrl,
  '../cashierStatus': cashier, '../printConfirmModel': confirmModelUrl,
  '../cashierQxModel': cashierModelUrl,
  '../CashierPaymentPanel': toDataUrl('export const CashierPaymentPanel = () => null'),
})
const { CashierQxView } = await import(cashierViewUrl)
test('B 补：零元收银台与放行失败只说免费试运营，不说收款、付款或权益机制', () => {
  for (const state of ['free-order', 'release-failed']) {
    const text = renderToStaticMarkup(createElement(CashierQxView, {
      state, amountCents: 0, orderNo: 'ORD-20261003-FREE', orderId: 'internal-order-1',
      channels: [], file: null, params: null, snapshot: null, view: null,
      priceLines: [], refundAssistanceCopy: '不应上屏的退款说明',
    })).replace(/<[^>]*>/g, '')
    assert.match(text, /免费试运营/)
    assert.doesNotMatch(text, /报价|价格|费用|付款|收款|收钱|扣费|抵扣|权益|退款/)
  }
})

const doneSectionsUrl = transpile(join(kioskRoot, 'src/pages/print/components/PrintDoneSections.tsx'), {
  'react': import.meta.resolve('react'), 'react/jsx-runtime': jsxUrl,
  'lucide-react': toDataUrl('export const FileTextIcon = () => null; export const PrinterIcon = () => null'),
  '../../../lib/fileName': transpile(join(kioskRoot, 'src/lib/fileName.ts')),
  '../cashierStatus': cashier, '../printProgressModel': progressUrl,
  './PrintFileDeletionRecords': toDataUrl('export const PrintFileDeletionRecords = () => null'),
  './PrintFileRetentionNotice': toDataUrl('export const PrintFileRetentionNotice = () => null'),
  './PrintProgressSections': toDataUrl('export const PrintJobRow = () => null'),
  './PrintAiHelp': aiUrl,
})
const { PrintOutOfPaperPanel } = await import(doneSectionsUrl)
test('B 补：零元缺纸页两种重试权限均不说收费，付费分支保留原说明', () => {
  for (const canRetry of [false, true]) {
    const props = { file: null, params: null, taskId: 'internal-task', orderNo: 'ORD-20261003-PAPER', failureReason: '打印机缺纸', canRetry, takeaway: null }
    const textOf = (money) => renderToStaticMarkup(createElement(PrintOutOfPaperPanel, { ...props, money })).replace(/<[^>]*>/g, '')
    const freeText = textOf({ fact: 'free', amountCents: 0 })
    assert.match(freeText, /免费试运营/)
    assert.doesNotMatch(freeText, /报价|价格|费用|付款|收费|收款|扣费|抵扣|权益|internal-task/)
    assert.match(textOf({ fact: 'paid', amountCents: 200 }), /不会重复收费/)
  }
})

const { PrintJamGuide } = await import(doneSectionsUrl)
test('卡纸三步不提收款', () => {
  const text = renderToStaticMarkup(createElement(PrintJamGuide, { orderNo: 'ORD-20261003-JAM' })).replace(/<[^>]*>/g, '')
  assert.match(text, /找工作人员之前先做这三件/)
  assert.match(text, /别硬拉纸/)
  assert.match(text, /订单号 ORD-20261003-JAM/)
  assert.doesNotMatch(text, /已付金额|已支付|支付|报价|价格/)
})

// W-118：执行真实配置回调；测试随 verify:print-done-truth 已进入 CI，无需另加登记。
const pluginStub = toDataUrl('export default () => ({})')
let viteConfigSource = readFileSync(join(kioskRoot, 'vite.config.ts'), 'utf8')
viteConfigSource = viteConfigSource.replace('import.meta.url', JSON.stringify(new URL('../../vite.config.ts', import.meta.url).href))
let viteConfigJs = ts.transpileModule(viteConfigSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
for (const [specifier, url] of Object.entries({
  '@tailwindcss/vite': pluginStub, '@vitejs/plugin-react': pluginStub,
  'vite': toDataUrl('export const defineConfig = f => f; export const loadEnv = () => ({VITE_API_MODE:"http", VITE_USE_TRTC_CALL:"true", VITE_API_BASE_URL:"/api/v1"})'),
  './pdfjs-cmap-plugin': toDataUrl('export const pdfjsPresetAssets = () => ({})'),
})) viteConfigJs = viteConfigJs.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
const { default: kioskConfig } = await import(toDataUrl(viteConfigJs))
test('W-118：生产构建拒绝 shell 中的非 production NODE_ENV，开发与测试构建不受影响', () => {
  const previous = process.env.NODE_ENV
  try {
    for (const value of ['development', 'test', '']) {
      process.env.NODE_ENV = value
      assert.throws(() => kioskConfig({ command: 'build', mode: 'production' }), /当前 shell 里 NODE_ENV=.*React 开发版.*StrictMode.*请去掉该变量再构建/)
      assert.doesNotThrow(() => kioskConfig({ command: 'serve', mode: 'production' }))
      assert.doesNotThrow(() => kioskConfig({ command: 'build', mode: 'test' }))
    }
    process.env.NODE_ENV = 'production'
    assert.doesNotThrow(() => kioskConfig({ command: 'build', mode: 'production' }))
    delete process.env.NODE_ENV
    assert.doesNotThrow(() => kioskConfig({ command: 'build', mode: 'production' }))
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
})

const deskModel = await import(transpile(join(kioskRoot, 'src/pages/print/printDeskModel.ts')))
test('W-118：摘要按真实裁决区分无命中、全保留、部分遮挡，缺数时不编数字', () => {
  const text = (counts) => deskModel.printPrivacyDecisionSummary(counts)
  assert.equal(text({ findingCount: 0, redactedCount: 0, keptCount: 0 }), '没发现需要遮挡的内容')
  assert.equal(text({ findingCount: 3, redactedCount: 0, keptCount: 3 }), '发现 3 处个人信息，你选择了全部保留，原样打印。')
  assert.equal(text({ findingCount: 3, redactedCount: 2, keptCount: 1 }), '发现 3 处个人信息，遮挡 2 处，保留 1 处。')
  for (const counts of [{}, { findingCount: 3, redactedCount: 1, keptCount: 1 }, { findingCount: -1, redactedCount: 0, keptCount: -1 }]) {
    assert.equal(text(counts), '隐私检查结果以材料检查页为准')
  }
})

// 抽取指定声明并执行源码，隔离网络依赖；不在测试中另写一份防重逻辑。
async function loadFlightDeclarations(relativePath, names, stubs = '') {
  const src = readFileSync(join(kioskRoot, relativePath), 'utf8')
  const file = ts.createSourceFile(relativePath, src, ts.ScriptTarget.Latest, true)
  const selected = file.statements.filter((node) =>
    ts.isFunctionDeclaration(node) ? names.includes(node.name?.text)
      : ts.isVariableStatement(node) && node.declarationList.declarations.some((d) => names.includes(d.name.getText(file))),
  )
  assert.equal(selected.length, names.length)
  const js = ts.transpileModule(stubs + '\n' + selected.map((node) => node.getText(file)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return import(toDataUrl(js))
}
const networkFlightStub = `
export let calls = 0;
let settle;
export function finish(fail = false) { fail ? settle.reject(new Error('failed')) : settle.resolve({sessionId:'one'}); }
function send() { calls++; return new Promise((resolve, reject) => { settle = {resolve, reject}; }); }
const requestJson = send, callEnvelope = send, call = send;
const requireLocalAgentHeaders = () => ({}), LOCAL_AGENT_BASE_URL = '', API_MODE = 'http';
const adapter = {submitResumeParse: send};
`
for (const [path, names, args] of [
  ['src/services/api/uploadSessions.ts', ['uploadCreatesInFlight', 'createUploadSession'], [{ purpose: 'resume_upload', mode: 'temporary', channel: 'phone_h5' }, null]],
  ['src/services/auth/memberQrLoginApi.ts', ['qrCreatesInFlight', 'createQrLoginViaLocalAgent'], [{ deviceId: 'device', returnTo: '/resume/source' }]],
  ['src/services/api/ai.ts', ['parsesInFlight', 'submitResumeParse'], [{ fileId: 'file' }, 'member', { intent: 'one', proof: 'proof' }]],
  ['src/services/api/selfAssessment.ts', ['assessmentsInFlight', 'submitSelfAssessment'], [{ answers: [], consent: { nonSensitive: true, sensitive: true } }, { token: 'member' }]],
]) {
  const mod = await loadFlightDeclarations(path, names, networkFlightStub)
  test(`W-118：${names[1]} 同轮复用 Promise，成功和失败后均释放，允许显式新一轮`, async () => {
    const create = mod[names[1]]
    const first = create(...args)
    assert.equal(create(...args), first)
    assert.equal(mod.calls, 1)
    mod.finish()
    await first
    const second = create(...args)
    assert.notEqual(second, first)
    assert.equal(mod.calls, 2)
    mod.finish(true)
    await assert.rejects(second, /failed/)
    const third = create(...args)
    assert.equal(mod.calls, 3)
    mod.finish()
    await third
  })
}
const checkFlight = await loadFlightDeclarations('src/pages/print/printDeskModel.ts', ['checksInFlight', 'shareMaterialChecks'])
test('W-118：重复挂载与重挂共享检查结果，不同文件隔离，失败后能重试', async () => {
  const releases = []
  let calls = 0
  const run = () => { calls++; return new Promise((resolve) => { releases.push(resolve) }) }
  const first = checkFlight.shareMaterialChecks('context:file', run)
  assert.equal(checkFlight.shareMaterialChecks('context:file', run), first)
  assert.equal(calls, 1)
  const other = checkFlight.shareMaterialChecks('other:file', run)
  assert.notEqual(other, first)
  assert.equal(calls, 2)
  releases[0]({ pii: { id: 'same-task' } })
  releases[1]({ pii: { id: 'other' } })
  await other
  assert.deepEqual(await first, { pii: { id: 'same-task' } })
  const failed = checkFlight.shareMaterialChecks('context:file', async () => { throw new Error('failed') })
  await assert.rejects(failed, /failed/)
  assert.deepEqual(await checkFlight.shareMaterialChecks('context:file', async () => ({ pii: { id: 'retry' } })), { pii: { id: 'retry' } })
})
