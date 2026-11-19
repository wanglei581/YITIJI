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
const jamLatch = await import(transpile(join(kioskRoot, 'src/pages/print/printDoneJamLatch.ts')))
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
  assert.equal(confirmed.pill, '打印机卡纸')
  assert.doesNotMatch(confirmed.pill, /免费试运营|已付/)
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
  assert.match(page, /rememberConfirmedJam\(\s*jamLatchTaskId\.current,\s*taskId,\s*visual === 'paper-jam' && printerJamConfirmed\(device\),/)
  assert.match(page, /const confirmedJam = variant === 'paper-jam' && jamHeld/)
  assert.match(page, /confirmedJam,/)
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
    assert.equal(miss, '手机带走链接这次没取到，不影响这笔订单')
    assert.doesNotMatch(text, /工作人员/)
  }
  const retryCopy = failedModel.failureCopy({ variant: 'out-of-paper', money, orderNo: 'ORD-PHONE', canRetry: true })
  const retryReason = failedModel.shownFailureReason('out-of-paper', progress.errorCodeToMessage('PAPER_EMPTY'), '')
  const retryRows = failedModel.failureSummaryRows({ orderNo: 'ORD-PHONE', file: null, params: null, money, reason: retryReason })
  const retryText = [screenText(retryCopy), ...retryRows.map((row) => row.value), failedModel.faultScreenTakeawayMiss('out-of-paper')].join('\n')
  assert.equal((retryText.match(/服务电话/g) ?? []).length, 1, '缺纸能重提时，服务电话只出现一次')
  assert.match(retryCopy.steps[2].detail, /服务电话/, '能重提时服务电话接在第 3 步说明末尾')
  assert.doesNotMatch(retryCopy.fine, /服务电话/)
  assert.match(failedModel.faultScreenTakeawayMiss('failed'), /打印有问题？/)
  const page = readFileSync(join(kioskRoot, 'src/pages/print/PrintDonePage.tsx'), 'utf8')
  assert.match(page, /shownFailureReason\(variant, verification\?\.failureReason \?\? '', failureReason, confirmedJam\)/)
  assert.match(page, /faultScreenTakeawayMiss\(/)
})

test('确认卡纸时设备上报写成打印机卡纸，未确认仍用对照表那句', () => {
  const table = progress.errorCodeToMessage('PRINTER_ERROR')
  const confirmedReason = failedModel.shownFailureReason('paper-jam', table, '整句不该上屏', true)
  assert.equal(confirmedReason, '打印机卡纸，当前无法打印。')
  assert.equal(progress.errorCodeToMessage('PAPER_EMPTY'), '打印机缺纸，当前无法打印。')
  assert.equal(progress.errorCodeToMessage('PRINTER_OFFLINE'), '打印机离线，当前无法打印。')
  const confirmed = failedModel.failureCopy({
    variant: 'paper-jam',
    confirmedJam: true,
    money,
    orderNo: 'ORD-JAM-SURE',
    canRetry: false,
  })
  const confirmedRows = failedModel.failureSummaryRows({
    orderNo: 'ORD-JAM-SURE',
    file: null,
    params: null,
    money,
    reason: confirmedReason,
  })
  const confirmedText = [screenText(confirmed), ...confirmedRows.map((row) => row.value)].join('\n')
  assert.equal((confirmedText.match(/可能卡纸/g) ?? []).length, 0)
  assert.match(confirmedText, /打印机卡纸，当前无法打印。/)
  const unconfirmedReason = failedModel.shownFailureReason('paper-jam', table, '整句不该上屏', false)
  assert.equal(unconfirmedReason, table)
  assert.match(unconfirmedReason, /可能卡纸/)
  assert.doesNotMatch(confirmedText, /工作人员/)
})

test('先读到确认卡纸再变成就绪，这一单标题仍是打印机卡纸；换一单或从未确认则退回可能卡纸', () => {
  const order = 'job-jam-1'
  const titleWhen = (held, current) => failedModel.failureCopy({
    variant: 'paper-jam',
    confirmedJam: held === current,
    money,
    orderNo: 'ORD-LATCH',
    canRetry: false,
  }).title

  let held = jamLatch.rememberConfirmedJam(null, order, false)
  assert.equal(held, null)
  assert.equal(titleWhen(held, order), '打印机出了故障（可能卡纸）')

  held = jamLatch.rememberConfirmedJam(held, order, true)
  assert.equal(held, order)
  held = jamLatch.rememberConfirmedJam(held, order, false)
  assert.equal(held, order, '卡纸被清掉后这一单仍记住')
  assert.equal(titleWhen(held, order), '打印机卡纸')

  const other = 'job-jam-2'
  const switched = jamLatch.rememberConfirmedJam(held, other, false)
  assert.equal(switched, null, '换一单且没有再确认，不沿用上一单')
  assert.equal(titleWhen(switched, other), '打印机出了故障（可能卡纸）')

  const never = jamLatch.rememberConfirmedJam(null, order, false)
  assert.equal(never, null)
  assert.equal(titleWhen(never, order), '打印机出了故障（可能卡纸）')
  assert.doesNotMatch(titleWhen(held, order), /工作人员/)
})

test('缺纸、卡纸、离线不论能否重提，服务电话都只在第 3 步出现一次', async () => {
  const unattended = await import(unattendedUrl)
  unattended.bindSupportContactPeek(() => ({
    servicePhone: '18369161921',
    serviceHours: '工作日 9:00–18:00',
    otherOnlineTerminalNearby: false,
    miniappPublished: false,
    selfNoteTab: false,
  }))
  const phoneCount = (text) => (text.match(/服务电话/g) ?? []).length
  const deviceReasonOf = {
    'out-of-paper': progress.errorCodeToMessage('PAPER_EMPTY'),
    'paper-jam': progress.errorCodeToMessage('PRINTER_ERROR'),
    offline: progress.errorCodeToMessage('PRINTER_OFFLINE'),
  }
  for (const variant of ['out-of-paper', 'paper-jam', 'offline']) {
    for (const canRetry of [false, true]) {
      const copy = failedModel.failureCopy({
        variant,
        confirmedJam: false,
        money,
        orderNo: 'ORD-RETRY-PHONE',
        canRetry,
      })
      const reason = failedModel.shownFailureReason(variant, deviceReasonOf[variant], '不应上屏的整句')
      const rows = failedModel.failureSummaryRows({
        orderNo: 'ORD-RETRY-PHONE',
        file: null,
        params: null,
        money,
        reason,
      })
      const step3 = `${copy.steps[2].title}\n${copy.steps[2].detail}`
      const elsewhere = [
        copy.title,
        copy.subtitle,
        copy.pill,
        copy.steps[0].title,
        copy.steps[0].detail,
        copy.steps[1].title,
        copy.steps[1].detail,
        copy.fine,
        copy.resumeLine ?? '',
        ...rows.map((row) => `${row.label}${row.value}`),
        failedModel.faultScreenTakeawayMiss(variant),
      ].join('\n')
      assert.equal(phoneCount(step3), 1, `${variant}/canRetry=${canRetry} 第 3 步应有且只有一次服务电话`)
      assert.equal(phoneCount(elsewhere), 0, `${variant}/canRetry=${canRetry} 第 3 步以外不应再出现服务电话`)
      assert.doesNotMatch(`${step3}\n${elsewhere}`, /工作人员/)
      if (canRetry) {
        assert.equal(copy.steps[2].title, '机器恢复后可点下方「重新提交打印」')
        assert.match(copy.steps[2].detail, /打印有问题？/)
      }
    }
  }
})

test('缺纸、卡纸、离线能重提时，整屏「订单还在」恰好一次', () => {
  const deviceOf = {
    'out-of-paper': { loading: false, printerReady: false, kind: 'error', printer: { errorCode: 'paperEmpty' } },
    'paper-jam': { loading: false, printerReady: false, kind: 'error', printer: { errorCode: 'paperJam' } },
    offline: { loading: false, printerReady: false, kind: 'offline', printer: {} },
  }
  for (const variant of ['out-of-paper', 'paper-jam', 'offline']) {
    const copy = failedModel.failureCopy({
      variant,
      confirmedJam: variant === 'paper-jam',
      money: { fact: 'free', amountCents: 0 },
      orderNo: 'ORD-RETRY-ONCE',
      canRetry: true,
    })
    const blocked = failedModel.retryBlockedReason(deviceOf[variant])
    assert.equal(typeof blocked, 'string', `${variant} 打印机还没恢复，按钮下应有原因`)
    const text = [
      screenText(copy),
      blocked,
    ].join('\n')
    assert.equal((text.match(/订单还在/g) ?? []).length, 1, `${variant} 整屏「订单还在」应恰好一次`)
    assert.match(blocked, /机器恢复后，这个按钮会自己亮起。$/)
    assert.doesNotMatch(blocked, /订单还在/)
  }
})

test('已付离线页副句和三步里订单在只说一次，缺纸第 2 步按能否重提分开', () => {
  for (const canRetry of [false, true]) {
    const copy = failedModel.failureCopy({
      variant: 'offline',
      money: { fact: 'paid', amountCents: 200 },
      orderNo: 'ORD-OFF-PAID',
      canRetry,
    })
    const head = [copy.subtitle, ...copy.steps.flatMap((step) => [step.title, step.detail])].join('\n')
    const hits = (head.match(/订单和支付记录都在|订单和已付金额都保留着/g) ?? []).length
    assert.equal(hits, 1, `canRetry=${canRetry} 副句加三步里这两句合计应恰好一次`)
    assert.equal(copy.steps[1].title, '是否处理费用、处理多少，以订单记录为准')
    assert.equal(copy.steps[1].detail, '本机不会自动处理费用。')
  }
  for (const fact of ['free', 'paid']) {
    const money = { fact, amountCents: fact === 'paid' ? 200 : 0 }
    const noRetry = failedModel.failureCopy({ variant: 'out-of-paper', money, orderNo: 'ORD-PAPER', canRetry: false })
    const withRetry = failedModel.failureCopy({ variant: 'out-of-paper', money, orderNo: 'ORD-PAPER', canRetry: true })
    assert.doesNotMatch(noRetry.steps[1].detail, /只有本页的「重新提交打印」能整份重打/, `${fact} 不能重提时第 2 步不该指向不存在的按钮`)
    assert.match(noRetry.steps[1].detail, /本页没有「重新提交打印」/)
    assert.doesNotMatch(noRetry.steps[1].detail, /续打|接着打/)
    assert.match(withRetry.steps[1].detail, /只有本页的「重新提交打印」能整份重打/)
  }
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
  assert.match(paper.subtitle, /你的订单和已付金额都保留着。机器缺纸，加纸后也不会自动续打，我们已经收到提醒，会尽快处理/)
  assert.match(paperFree.subtitle, /你的订单还在。机器缺纸，加纸后也不会自动续打，我们已经收到提醒，会尽快处理/)
  assert.equal(paper.pill, '打印机缺纸')
  assert.equal(paperFree.pill, '打印机缺纸')
  assert.equal(offline.pill, '打印机离线')
  assert.doesNotMatch(paper.pill, /免费试运营|已付|工作人员/)
  assert.doesNotMatch(offline.pill, /免费试运营|已付/)
})

test('S15c7 失败页胶囊只写故障，办理方式写全本单 0 元，收费点位写已付金额', () => {
  const free = { fact: 'free', amountCents: 0 }
  const paid = { fact: 'paid', amountCents: 200 }
  const cases = [
    ['out-of-paper', '打印机缺纸'],
    ['paper-jam', '打印机出了故障（可能卡纸）'],
    ['offline', '打印机离线'],
  ]
  for (const [variant, fault] of cases) {
    const copy = failedModel.failureCopy({ variant, money: free, orderNo: 'ORD-PILL7', canRetry: false })
    assert.equal(copy.pill, fault, `${variant} 胶囊应只写故障`)
    assert.doesNotMatch(copy.pill, /免费试运营|本单 0 元|已付| · /)
  }
  const jammed = failedModel.failureCopy({
    variant: 'paper-jam',
    confirmedJam: true,
    money: paid,
    orderNo: 'ORD-PILL7',
    canRetry: false,
  })
  assert.equal(jammed.pill, '打印机卡纸')
  assert.deepEqual(failedModel.paymentRow(free), { key: 'pay', label: '办理方式', value: '免费试运营，本单 0 元' })
  assert.deepEqual(failedModel.paymentRow(paid), { key: 'pay', label: '支付状态', value: '已付 2.00 元' })
  assert.equal(failedModel.paymentRow({ fact: 'unknown', amountCents: null }).value, '以订单为准')
})

test('缺纸、卡纸、离线的带走链接过期句不带服务电话，普通失败仍带', async () => {
  const unattended = await import(unattendedUrl)
  unattended.bindSupportContactPeek(() => ({
    servicePhone: '18369161921',
    serviceHours: '工作日 9:00–18:00',
    otherOnlineTerminalNearby: false,
    miniappPublished: false,
    selfNoteTab: false,
  }))
  for (const variant of ['out-of-paper', 'paper-jam', 'offline']) {
    const line = failedModel.faultScreenTakeawayExpired(variant)
    assert.equal(line, '手机带走链接已过期，不影响这笔订单。')
    assert.equal((line.match(/服务电话/g) ?? []).length, 0, `${variant} 过期句不带服务电话`)
    const copy = failedModel.failureCopy({
      variant,
      confirmedJam: false,
      money,
      orderNo: 'ORD-EXP',
      canRetry: false,
    })
    const screen = [screenText(copy), line].join('\n')
    assert.equal((screen.match(/服务电话/g) ?? []).length, 1, `${variant} 过期后整屏服务电话仍只有第 3 步那一次`)
    assert.doesNotMatch(screen, /工作人员/)
  }
  const ordinary = failedModel.faultScreenTakeawayExpired('failed')
  assert.match(ordinary, /^带走链接已过期。/)
  assert.match(ordinary, /服务电话/)
  assert.doesNotMatch(ordinary, /工作人员/)
  const page = readFileSync(join(kioskRoot, 'src/pages/print/PrintDonePage.tsx'), 'utf8')
  assert.match(page, /expiredLine=\{faultScreenTakeawayExpired\(variant\)\}/)
  assert.doesNotMatch(page, /带走链接已过期。\$\{printProblemLine\(\)\}/)
})

test('失败文案注释放在各自函数上方', () => {
  const source = readFileSync(join(kioskRoot, 'src/pages/print/components/printDoneFailedModel.ts'), 'utf8')
  const sitsOn = (marker, fnName) => {
    const fnAt = source.indexOf(`export function ${fnName}`)
    const markAt = source.lastIndexOf(marker, fnAt)
    assert.ok(fnAt > 0 && markAt >= 0, `${fnName} 上方应有「${marker}」`)
    assert.doesNotMatch(source.slice(markAt, fnAt), /export function /, `${fnName} 的注释和函数之间不应再夹别的函数`)
  }
  sitsOn('三态失败页的「设备上报」', 'shownFailureReason')
  sitsOn('公开打印机状态是不是卡纸', 'printerJamConfirmed')
  sitsOn('重新提交打印要打印机现在能出纸', 'retryBlockedReason')
  const shownAt = source.indexOf('export function shownFailureReason')
  const beforeShown = source.slice(Math.max(0, shownAt - 500), shownAt)
  assert.doesNotMatch(beforeShown, /重新提交打印要打印机现在能出纸|公开打印机状态是不是卡纸/)
})
