/**
 * S15c2：PRINTER_ERROR 不说死卡纸；公开状态 paper_jam 才写「打印机卡纸」。
 * 跑完成页文案和打印机状态映射的真源码。
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

const cashier = transpile(join(kioskRoot, 'src/pages/print/cashierStatus.ts'))
const pageRange = transpile(join(kioskRoot, 'src/pages/print/pageRange.ts'))
const unattendedUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
const miniappLinkCopyUrl = transpile(join(kioskRoot, 'src/copy/miniappLinkCopy.ts'), {
  './unattendedCopy': unattendedUrl,
})
const progressUrl = transpile(join(kioskRoot, 'src/pages/print/printProgressModel.ts'), {
  './cashierStatus': cashier,
  './pageRange': pageRange,
  '../../copy/unattendedCopy': unattendedUrl,
})
const failedModel = await import(transpile(join(kioskRoot, 'src/pages/print/components/printDoneFailedModel.ts'), {
  '../../../copy/unattendedCopy': unattendedUrl,
  '../../../copy/miniappLinkCopy': miniappLinkCopyUrl,
  '../../../lib/fileName': transpile(join(kioskRoot, 'src/lib/fileName.ts')),
  '../cashierStatus': cashier,
  '../printProgressModel': progressUrl,
}))
const progress = await import(progressUrl)
const reactStub = toDataUrl('export function useEffect() {} export function useMemo(fn) { return fn() } export function useState(v) { return [v, () => {}] } export function useSyncExternalStore(_sub, get) { return get() }')
const clientStub = toDataUrl('export const API_BASE_URL = ""\nexport const IS_MOCK_MODE = true')
const screenStub = toDataUrl('export function getTerminalId() { return null } export function subscribeTerminalIdentity() { return () => {} }')
const supportStub = toDataUrl('export function useSupportContactSnapshot() { return {} }')
const scanProbeStub = toDataUrl('export function abortLocalScanProbe() {} export function requestLocalScanProbe() {} export function useLocalScanProbe() { return null }')
const deviceStatus = await import(transpile(join(kioskRoot, 'src/hooks/useTerminalDeviceStatus.ts'), {
  react: reactStub,
  '../copy/unattendedCopy': unattendedUrl,
  '../services/api/client': clientStub,
  '../services/api/screensaver': screenStub,
  './useSupportContact': supportStub,
  '../services/scan/localScanProbe': scanProbeStub,
}))

const money = { fact: 'free', amountCents: 0 }
const screenText = (copy) => [copy.title, copy.subtitle, copy.pill, ...copy.steps.flatMap((step) => [step.title, step.detail]), copy.fine].join('\n')

test('PRINTER_ERROR 不出现确定的「打印机卡纸」，公开状态 paper_jam 才出现', () => {
  const unconfirmed = failedModel.failureCopy({
    variant: 'paper-jam',
    confirmedJam: false,
    money,
    orderNo: 'ORD-FAULT',
    canRetry: false,
  })
  const unconfirmedText = screenText(unconfirmed)
  assert.equal(unconfirmed.title, '打印机出了故障（可能卡纸）')
  assert.match(unconfirmed.subtitle, /你的订单还在。机器出了故障，我们已经收到提醒，会尽快处理/)
  assert.doesNotMatch(unconfirmed.subtitle, /打印机出了故障（可能卡纸）/)
  const paidUnconfirmed = failedModel.failureCopy({
    variant: 'paper-jam',
    confirmedJam: false,
    money: { fact: 'paid', amountCents: 200 },
    orderNo: 'ORD-FAULT-PAID',
    canRetry: false,
  })
  assert.match(paidUnconfirmed.subtitle, /你的订单和已付金额都保留着。机器出了故障，我们已经收到提醒，会尽快处理/)
  assert.match(unconfirmed.pill, /打印机出了故障（可能卡纸）/)
  assert.doesNotMatch(unconfirmedText, /打印机卡纸/)
  assert.doesNotMatch(unconfirmedText, /机器卡纸/)
  assert.equal(progress.errorCodeToMessage('PRINTER_ERROR'), '打印机可能卡纸或发生设备故障，当前暂时无法继续使用。')
  assert.doesNotMatch(progress.errorCodeToMessage('PRINTER_ERROR'), /打印机卡纸/)

  const confirmed = failedModel.failureCopy({
    variant: 'paper-jam',
    confirmedJam: true,
    money,
    orderNo: 'ORD-JAM',
    canRetry: false,
  })
  assert.equal(confirmed.title, '打印机卡纸')
  assert.equal(confirmed.subtitle, progress.jamOrderKeptLine('free'))
  assert.match(confirmed.pill, / · 打印机卡纸$/)
  assert.match(screenText(confirmed), /打印机卡纸/)

  const paperJam = deviceStatus.mapTerminalPrinterStatus({ heartbeatOnline: true, printerStatus: 'paper_jam' })
  assert.equal(paperJam.printer.errorCode, 'paperJam')
  assert.equal(failedModel.printerJamConfirmed({ loading: false, kind: paperJam.kind, printer: paperJam.printer }), true)
  const jamAlias = deviceStatus.mapTerminalPrinterStatus({ heartbeatOnline: true, printerStatus: 'jam' })
  assert.equal(failedModel.printerJamConfirmed({ loading: false, kind: jamAlias.kind, printer: jamAlias.printer }), true, '公开状态别名 jam 与 paper_jam 同一映射')
  const ready = deviceStatus.mapTerminalPrinterStatus({ heartbeatOnline: true, printerStatus: 'ready' })
  assert.equal(failedModel.printerJamConfirmed({ loading: false, kind: ready.kind, printer: ready.printer }), false)
  assert.equal(failedModel.printerJamConfirmed({ loading: true, kind: 'error', printer: { errorCode: 'paperJam' } }), false, '状态还在读，不先说死卡纸')
  assert.equal(failedModel.printerJamConfirmed({ loading: false, kind: 'error', printer: { errorCode: 'hardwareError' } }), false)

  const page = readFileSync(join(kioskRoot, 'src/pages/print/PrintDonePage.tsx'), 'utf8')
  assert.match(page, /confirmedJam: variant === 'paper-jam' && printerJamConfirmed\(device\)/)
  assert.doesNotMatch(unconfirmedText, /工作人员/)
})

test('离线副题与卡纸同结构，同一屏不再混用请稍后重试和请稍后再来', () => {
  for (const fact of ['free', 'paid', 'unknown']) {
    const copy = failedModel.failureCopy({
      variant: 'offline',
      money: { fact, amountCents: fact === 'paid' ? 200 : fact === 'free' ? 0 : null },
      orderNo: 'ORD-OFF',
      canRetry: false,
    })
    const text = screenText(copy)
    assert.match(copy.subtitle, fact === 'paid'
      ? /你的订单和已付金额都保留着。打印机没连上，我们已经收到提醒，会尽快处理/
      : /你的订单还在。打印机没连上，我们已经收到提醒，会尽快处理/)
    assert.doesNotMatch(copy.subtitle, /打印机离线/)
    assert.doesNotMatch(text, /请稍后重试/)
    assert.match(copy.steps[2].detail, /请稍后再来/)
    assert.doesNotMatch(text, /工作人员/)
  }
  const deviceLine = progress.errorCodeToMessage('PRINTER_OFFLINE')
  assert.equal(deviceLine, '打印机离线，当前无法打印。')
  assert.doesNotMatch(deviceLine, /请稍后重试|请稍后再来/)
})

test('三态失败页上服务电话只出现一次，设备上报和带走失败都不带电话', async () => {
  const unattended = await import(unattendedUrl)
  unattended.bindSupportContactPeek(() => ({
    servicePhone: '18369161921',
    serviceHours: '工作日 9:00–18:00',
    otherOnlineTerminalNearby: false,
    miniappPublished: false,
    selfNoteTab: false,
  }))
  const cases = [
    ['out-of-paper', 'PAPER_EMPTY'],
    ['paper-jam', 'PRINTER_ERROR'],
    ['offline', 'PRINTER_OFFLINE'],
  ]
  for (const [variant, errorCode] of cases) {
    const deviceReason = progress.screenFailureReason({ errorCode, failureReasonForUser: '请联系工作人员处理' })
    const presented = progress.presentScreenFailure({ errorCode, failureReasonForUser: deviceReason })
    const copy = failedModel.failureCopy({ variant, confirmedJam: false, money, orderNo: 'ORD-PHONE', canRetry: false })
    const reason = failedModel.shownFailureReason(variant, deviceReason, presented)
    const rows = failedModel.failureSummaryRows({ orderNo: 'ORD-PHONE', file: null, params: null, money, reason })
    const miss = failedModel.faultScreenTakeawayMiss(variant)
    const text = [screenText(copy), ...rows.map((row) => `${row.label}${row.value}`), miss].join('\n')
    assert.equal((text.match(/服务电话/g) ?? []).length, 1, `${variant} 服务电话应只出现一次`)
    assert.match(copy.steps[2].detail, /服务电话/)
    assert.doesNotMatch(reason, /服务电话|这台机器暂时打不了|打印有问题/)
    assert.equal(miss, '带走链接没取到。')
    assert.doesNotMatch(text, /工作人员/)
  }
  const retryCopy = failedModel.failureCopy({ variant: 'out-of-paper', money, orderNo: 'ORD-PHONE', canRetry: true })
  const retryReason = failedModel.shownFailureReason('out-of-paper', progress.errorCodeToMessage('PAPER_EMPTY'), '')
  const retryRows = failedModel.failureSummaryRows({ orderNo: 'ORD-PHONE', file: null, params: null, money, reason: retryReason })
  const retryText = [screenText(retryCopy), ...retryRows.map((row) => row.value), failedModel.faultScreenTakeawayMiss('out-of-paper')].join('\n')
  assert.equal((retryText.match(/服务电话/g) ?? []).length, 1, '缺纸能重提时，服务电话只留在小字里那一次')
  assert.match(failedModel.faultScreenTakeawayMiss('failed'), /打印有问题？/)
  const page = readFileSync(join(kioskRoot, 'src/pages/print/PrintDonePage.tsx'), 'utf8')
  assert.match(page, /shownFailureReason\(variant, verification\?\.failureReason \?\? '', failureReason\)/)
  assert.match(page, /faultScreenTakeawayMiss\(/)
})

test('三态失败页里订单还在和已收到提醒各只说一次', () => {
  for (const variant of ['paper-jam', 'offline', 'out-of-paper']) {
    for (const fact of ['free', 'paid']) {
      const copy = failedModel.failureCopy({
        variant,
        confirmedJam: variant === 'paper-jam',
        money: { fact, amountCents: fact === 'paid' ? 200 : 0 },
        orderNo: 'ORD-ONCE',
        canRetry: false,
      })
      const text = screenText(copy)
      const kept = (text.match(/你的订单还在/g) ?? []).length
      const reminded = (text.match(/我们已经收到提醒，会尽快处理/g) ?? []).length
      assert.equal(reminded, 1, `${variant}/${fact} 已收到提醒应只出现一次`)
      assert.equal(kept, fact === 'paid' ? 0 : 1, `${variant}/${fact} 你的订单还在出现次数`)
      assert.doesNotMatch(copy.steps[2].detail, /我们已经收到提醒，会尽快处理/)
      assert.doesNotMatch(copy.steps.map((step) => step.title).join('\n'), /你的订单还在/)
    }
  }
})

test('缺纸胶囊和卡纸、离线同一写法，写成前缀加打印机缺纸', () => {
  const paid = { fact: 'paid', amountCents: 200 }
  const free = { fact: 'free', amountCents: 0 }
  const unknown = { fact: 'unknown', amountCents: null }
  assert.equal(progress.outOfPaperPill(paid), `${progress.paidLabelOf(paid)} · 打印机缺纸`)
  assert.equal(progress.outOfPaperPill(free), `${progress.paidLabelOf(free)} · 打印机缺纸`)
  assert.equal(progress.outOfPaperPill(unknown), `${progress.paidLabelOf(unknown)} · 打印机缺纸`)
  assert.match(progress.outOfPaperPill(paid), / · 打印机缺纸$/)
  const paper = failedModel.failureCopy({ variant: 'out-of-paper', money: paid, orderNo: 'ORD-PILL', canRetry: false })
  const paperFree = failedModel.failureCopy({ variant: 'out-of-paper', money: free, orderNo: 'ORD-PILL', canRetry: false })
  const offline = failedModel.failureCopy({ variant: 'offline', money: paid, orderNo: 'ORD-PILL', canRetry: false })
  assert.match(paper.subtitle, /你的订单和已付金额都保留着。机器缺纸，加纸后不会自动续打，我们已经收到提醒，会尽快处理/)
  assert.match(paperFree.subtitle, /你的订单还在。机器缺纸，加纸后不会自动续打，我们已经收到提醒，会尽快处理/)
  assert.equal(paper.pill, progress.outOfPaperPill(paid))
  assert.equal(offline.pill.split(' · ')[0], paper.pill.split(' · ')[0])
  assert.doesNotMatch(paper.pill, /工作人员/)
})
