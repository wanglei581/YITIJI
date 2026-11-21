/**
 * 取件页「这台机器上还没取的单」：只留本人本机的手机单，文件名打码与后端同一算法。
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

const unattendedUrl = transpile(join(kioskRoot, 'src/copy/unattendedCopy.ts'))
const here = await import(transpile(join(kioskRoot, 'src/pages/print/pickupHereOrders.ts'), {
  '../../copy/unattendedCopy': unattendedUrl,
}))
const serverMask = await import(transpile(join(repoRoot, 'services/api/src/print-jobs/pickup-file-mask.ts')))

const NAMES = [
  null,
  undefined,
  '',
  '   ',
  '简历.pdf',
  'a',
  '报告',
  'path/to/文件.docx',
  'C:\\扫描\\证件.png',
  '.pdf',
  '无扩展名',
  '简历.终稿.pdf',
]

test('屏上文件名打码与后端 maskPickupFileName 逐条一致', () => {
  for (const name of NAMES) {
    assert.equal(here.maskPickupFileName(name), serverMask.maskPickupFileName(name), JSON.stringify(name))
  }
  assert.equal(here.maskPickupFileName('简历.pdf'), '简***.pdf')
  assert.equal(serverMask.maskPickupFileName('简历.pdf'), '简***.pdf')
})

test('只列本人本机还没取的手机单：现场单、别的机器、没有订单号的都不出现，文件名已打码', () => {
  const rows = here.pickupHereRows([
    { kind: 'kiosk_task', orderId: 'task-1', title: '现场简历.pdf', itemCount: 1, claimableHere: true },
    { kind: 'cloud_single', orderId: 'ord-other', title: '别的机器.pdf', itemCount: 1, claimableHere: false },
    { kind: 'cloud_single', orderId: null, title: '没有单号.pdf', itemCount: 1, claimableHere: true },
    { kind: 'cloud_single', orderId: '', title: '空单号.pdf', itemCount: 1, claimableHere: true },
    { kind: 'cloud_single', orderId: 'ord-here', title: '简历.pdf', itemCount: 1, claimableHere: true, pickupCode: '28491703' },
    { kind: 'package', orderId: 'pkg-1', title: null, itemCount: 3, claimableHere: true },
    { kind: 'package', orderId: 'pkg-0', title: '不该出现.pdf', itemCount: 0, claimableHere: true },
    { kind: 'something', orderId: 'x', title: '未知.pdf', itemCount: 1, claimableHere: true },
  ])
  assert.deepEqual(rows, [
    { orderId: 'ord-here', label: '简***.pdf', detail: null },
    { orderId: 'pkg-1', label: '材料包 · 3 个文件', detail: null },
    { orderId: 'pkg-0', label: '材料包', detail: null },
  ])
  const packed = JSON.stringify(rows)
  assert.equal(packed.includes('28491703'), false)
  assert.equal(packed.includes('简历.pdf'), false)
  assert.equal(packed.includes('现场简历'), false)
  assert.equal(packed.includes('别的机器'), false)
})

test('行内时间是北京时间，页数用内容页；缺了、不是整数、是 0 就不写', () => {
  assert.equal(here.formatPickupHereWhen('2026-11-12T06:20:00.000Z'), '11月12日 14:20')
  assert.equal(here.formatPickupHereWhen('2026-11-12T16:20:00.000Z'), '11月13日 00:20')
  assert.equal(here.formatPickupHereWhen('2026-01-01T00:00:00.000Z'), '1月1日 08:00')
  assert.equal(here.formatPickupHereWhen('不是时间'), null)
  assert.equal(here.formatPickupHereWhen(''), null)
  assert.equal(here.formatPickupHereWhen(null), null)
  const withBoth = here.pickupHereRows([{
    kind: 'cloud_single', orderId: 'ord', title: '简历.pdf', itemCount: 1, claimableHere: true,
    createdAt: '2026-11-12T06:20:00.000Z', billablePages: 2,
  }])
  assert.deepEqual(withBoth, [{ orderId: 'ord', label: '简***.pdf', detail: '11月12日 14:20 · 2 页' }])
  assert.equal(here.pickupHereDetail({ createdAt: null, billablePages: 3 }), '3 页')
  assert.equal(here.pickupHereDetail({ createdAt: '2026-11-12T06:20:00.000Z', billablePages: 0 }), '11月12日 14:20')
  assert.equal(here.pickupHereDetail({ createdAt: '2026-11-12T06:20:00.000Z', billablePages: 1.5 }), '11月12日 14:20')
  assert.equal(here.pickupHereDetail({}), null)
  assert.equal(JSON.stringify(withBoth).includes('简历.pdf'), false)
})

test('终态拒绝从列表拿掉，网络失败和打印机暂不可用留着以便重试', () => {
  assert.equal(here.pickupHereClaimDropsRow('closed', 'ORDER_REFUNDED'), true)
  assert.equal(here.pickupHereClaimDropsRow('closed', 'PICKUP_CODE_ALREADY_USED'), true)
  assert.equal(here.pickupHereClaimDropsRow('invalid', 'PICKUP_CODE_EXPIRED'), true)
  assert.equal(here.pickupHereClaimDropsRow('other', 'PICKUP_TERMINAL_MISMATCH'), true)
  assert.equal(here.pickupHereClaimDropsRow('other', 'PRINT_ORDER_NOT_FOUND'), true)
  assert.equal(here.pickupHereClaimDropsRow('network', 'NETWORK_ERROR'), false)
  assert.equal(here.pickupHereClaimDropsRow('printer', 'PRINTER_UNAVAILABLE'), false)
  assert.equal(here.pickupHereClaimDropsRow('other', 'PICKUP_CLAIM_RATE_LIMITED'), false)
  assert.equal(here.pickupHereClaimDropsRow('locked', 'PICKUP_CLAIM_LOCKED'), false)
})

test('点单失败的可恢复说法不叫人输码', () => {
  for (const code of ['PRINTER_UNAVAILABLE', 'PRINT_TERMINAL_QUEUE_HALTED']) {
    const line = here.pickupHereRecoverableLine(code)
    assert.match(line, /没有作废/)
    assert.doesNotMatch(line, /输码|到机码/)
  }
  assert.equal(here.pickupHereRecoverableLine('NETWORK_ERROR'), null)
  assert.doesNotMatch(here.pickupHereNetworkLine(), /输码|到机码/)
  assert.match(here.pickupHereNetworkLine(), /请重试/)
  const notReady = here.pickupHereRecoverableLine('PRINT_TERMINAL_NOT_READY')
  assert.match(notReady, /这台机器暂时不能取件/)
  assert.equal(notReady.split('这台机器暂时不能取件').length - 1, 1)
  assert.match(notReady, /请稍后再来/)
  assert.doesNotMatch(notReady, /不能用/)
  assert.doesNotMatch(notReady, /输码|到机码/)
  assert.equal(here.pickupHereClaimDropsRow('other', 'PRINT_TERMINAL_NOT_READY'), false)
  assert.equal(here.PICKUP_HERE_RESUME_NOTE, '打印中断时，回手机上查看这笔订单')
  assert.doesNotMatch(here.PICKUP_HERE_RESUME_NOTE, /到机码/)
})

test('我的打印订单里的手机待取单：本机可以来取，别的机器写去处，现场单不进', () => {
  const rows = here.pendingPickupRows([
    { kind: 'kiosk_task', orderId: 'task-1', title: '现场简历.pdf', itemCount: 1, claimableHere: true },
    { kind: 'cloud_single', orderId: '', title: '空单号.pdf', itemCount: 1, claimableHere: true },
    { kind: 'cloud_single', orderId: 'ord-here', title: '简历.pdf', itemCount: 1, claimableHere: true, pickupCode: '28491703' },
    {
      kind: 'cloud_single', orderId: 'ord-other', title: '别的机器.pdf', itemCount: 1, claimableHere: false,
      terminal: { displayName: '2号机', locationLabel: '市人才市场' },
    },
    {
      kind: 'package', orderId: 'pkg-far', title: null, itemCount: 2, claimableHere: false,
      terminal: { displayName: '大厅', locationLabel: '大厅' },
    },
    { kind: 'cloud_single', orderId: 'ord-blank', title: '无名网点.pdf', itemCount: 1, claimableHere: false, terminal: null },
    {
      kind: 'cloud_single', orderId: 'ord-ctrl', title: '控制符.pdf', itemCount: 1, claimableHere: false,
      terminal: { displayName: '3号机\u0000', locationLabel: '  西门  ' },
    },
  ])
  assert.deepEqual(rows.map((row) => ({ orderId: row.orderId, claimableHere: row.claimableHere, elsewhere: row.elsewhere, label: row.label })), [
    { orderId: 'ord-here', claimableHere: true, elsewhere: null, label: '简***.pdf' },
    { orderId: 'ord-other', claimableHere: false, elsewhere: '这笔订单不在这台机器取件，请到市人才市场的2号机领取', label: '别***.pdf' },
    { orderId: 'pkg-far', claimableHere: false, elsewhere: '这笔订单不在这台机器取件，请到大厅领取', label: '材料包 · 2 个文件' },
    { orderId: 'ord-blank', claimableHere: false, elsewhere: here.PICKUP_HERE_OTHER_MACHINE, label: '无***.pdf' },
    { orderId: 'ord-ctrl', claimableHere: false, elsewhere: '这笔订单不在这台机器取件，请到西门的3号机领取', label: '控***.pdf' },
  ])
  const packed = JSON.stringify(rows)
  assert.equal(packed.includes('28491703'), false)
  assert.equal(packed.includes('简历.pdf'), false)
  assert.equal(packed.includes('工作人员'), false)
  assert.equal(here.pendingPickupPlace({
    kind: 'cloud_single', orderId: 'x', title: null, itemCount: 1, claimableHere: false,
    terminal: { displayName: '   ', locationLabel: '\u0007' },
  }), null)
})

test('我的打印订单复用取件时间线，不另造接口', () => {
  const page = readFileSync(join(kioskRoot, 'src/pages/profile/me/MyPrintOrdersPage.tsx'), 'utf8')
  const section = readFileSync(join(kioskRoot, 'src/pages/profile/me/printOrders/PendingPickupSection.tsx'), 'utf8')
  const api = readFileSync(join(kioskRoot, 'src/services/api/pickupHereOrdersApi.ts'), 'utf8')
  assert.match(page, /usePendingPickupOrders/)
  assert.match(page, /<PendingPickupSection/)
  assert.match(section, /listPickupHereOrders/)
  const exitsSrc = readFileSync(join(kioskRoot, 'src/pages/profile/me/printOrders/pendingPickupExits.ts'), 'utf8')
  assert.match(exitsSrc, /手机上还没取的单这次没读到/)
  assert.match(section, /pendingPickupErrorLines\(hasTasks\)/)
  assert.match(section, /className="me-pk-err"[^>]*data-testid="pending-pickup-error"/)
  assert.match(section, /到这台取件/)
  assert.match(section, /去哪台取/)
  assert.match(api, /\/me\/print-orders\/timeline/)
  assert.doesNotMatch(`${page}\n${section}`, /\/me\/print-orders\/pending|claim-here/)
  assert.doesNotMatch(`${page}\n${section}`, /工作人员/)
})

test('有待取单、没有打印任务时，待取单块下面接去打印和去我的文档', async () => {
  const exits = await import(transpile(join(kioskRoot, 'src/pages/profile/me/printOrders/pendingPickupExits.ts')))
  const cards = exits.pendingPickupExitCards({ printTaskCount: 0, presence: 'rows', miniOn: true })
  assert.deepEqual(cards.map((card) => card.title), ['去打印', '去我的文档'])
  assert.deepEqual(cards.map((card) => card.to), ['/print-scan', '/me/documents'])
  assert.equal(cards[1].desc, '从已保存的文件里再选一份')
  assert.equal(cards[1].locked, false)
  assert.equal(cards[1].art, 'stack')
  assert.equal(exits.pendingPickupExitCards({ printTaskCount: 2, presence: 'rows', miniOn: true }).length, 0, '已有打印任务不再接空态出路卡')
  assert.equal(exits.pendingPickupExitCards({ printTaskCount: 0, presence: 'hidden', miniOn: true }).length, 0)
  // 定稿第 8 条：读失败且没有打印任务也接这两张卡。改回「error 时 length 0」这里要红。
  const failedEmpty = exits.pendingPickupExitCards({ printTaskCount: 0, presence: 'error', miniOn: true })
  assert.deepEqual(failedEmpty.map((card) => card.title), ['去打印', '去我的文档'])
  assert.equal(exits.pendingPickupExitCards({ printTaskCount: 2, presence: 'error', miniOn: true }).length, 0, '已有打印任务时读失败不另接空态出路卡')
  assert.deepEqual(exits.pendingPickupErrorLines(false), ['手机上还没取的单这次没读到。'])
  assert.deepEqual(exits.pendingPickupErrorLines(true), ['手机上还没取的单这次没读到。', '下面已产生打印任务的订单不受影响。'])
  assert.deepEqual(exits.pendingPickupFileMark('简***.pdf'), { pkg: false, text: 'PDF' })
  assert.deepEqual(exits.pendingPickupFileMark('材料包 · 3 个文件'), { pkg: true, text: '' })
  const withoutMini = exits.pendingPickupExitCards({ printTaskCount: 0, presence: 'rows', miniOn: false })
  assert.deepEqual(withoutMini.map((card) => card.title), ['去打印', '看看我的文档'])
  assert.equal(JSON.stringify(cards).includes('工作人员'), false)
  const page = readFileSync(join(kioskRoot, 'src/pages/profile/me/MyPrintOrdersPage.tsx'), 'utf8')
  const section = readFileSync(join(kioskRoot, 'src/pages/profile/me/printOrders/PendingPickupSection.tsx'), 'utf8')
  assert.match(page, /pendingPickupExitCards\(/)
  assert.match(page, /data-testid="pending-pickup-exits"/)
  assert.match(page, /pendingPickup\.presence === 'rows' \|\| pendingPickup\.presence === 'error'/)
  assert.match(section, /data-testid="pending-pickup-list"[^>]*className="me-stack me-pin"|className="me-stack me-pin"[^>]*data-testid="pending-pickup-list"/)
})

test('S15c8 没有打印任务时仍给出到店单横幅和小字', async () => {
  const exits = await import(transpile(join(kioskRoot, 'src/pages/profile/me/printOrders/pendingPickupExits.ts')))
  const title = '手机上下的到店单，到机器上输到机码取件'
  const rows = exits.mobilePickupBanner(true, 'rows')
  assert.equal(rows.title, title)
  assert.equal(rows.note, '还没取的手机单列在这一条下面。')
  const failed = exits.mobilePickupBanner(true, 'error')
  assert.equal(failed.title, title)
  assert.equal(failed.note, null)
  assert.equal(exits.mobilePickupBanner(true, 'hidden').note, '还没核销出打印任务的单，不在下面的列表里')
  assert.equal(exits.mobilePickupBanner(false, 'rows'), null)
  const page = readFileSync(join(kioskRoot, 'src/pages/profile/me/MyPrintOrdersPage.tsx'), 'utf8')
  assert.match(page, /mobilePickupBanner\(miniOn, pendingPickup\.presence\)/)
  assert.match(page, /\{pickupBanner \?/)
  assert.doesNotMatch(page, /hideClaimShortcut/)
})

test('S15c7：待取单是横排小按钮，读失败两句分两行且按钮在右边', async () => {
  const jsxUrl = import.meta.resolve('react/jsx-runtime')
  const reactUrl = import.meta.resolve('react')
  const { createElement } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const allow = new Set([jsxUrl, reactUrl])
  function transpileJsx(absolutePath, replacements) {
    let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: absolutePath,
    }).outputText
    for (const [specifier, url] of Object.entries(replacements)) {
      out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
    }
    const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
      .filter((specifier) => !specifier.startsWith('data:') && !allow.has(specifier))
    assert.deepEqual(leftover, [], `${absolutePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
    return toDataUrl(out)
  }
  const exitsUrl = transpile(join(kioskRoot, 'src/pages/profile/me/printOrders/pendingPickupExits.ts'))
  const hereUrl = transpile(join(kioskRoot, 'src/pages/print/pickupHereOrders.ts'), {
    '../../copy/unattendedCopy': unattendedUrl,
  })
  const sectionUrl = transpileJsx(join(kioskRoot, 'src/pages/profile/me/printOrders/PendingPickupSection.tsx'), {
    react: reactUrl,
    'react/jsx-runtime': jsxUrl,
    'react-router-dom': toDataUrl('export function useNavigate() { return () => {} }'),
    '../../../../services/api/pickupHereOrdersApi': toDataUrl('export async function listPickupHereOrders() { return [] }'),
    '../../../print/pickupHereOrders': hereUrl,
    '../../touch/MeKit': toDataUrl(`import { jsx } from '${jsxUrl}'; export function MeBtn({ children, className, ...rest }) { return jsx('button', { ...rest, className, children }) }`),
    '../../../../components/qingxu/touch/QxTouchIcon': toDataUrl(`import { jsx } from '${jsxUrl}'; export function QxTouchIcon() { return jsx('svg', {}) }`),
    './pendingPickupExits': exitsUrl,
  })
  const { PendingPickupSection } = await import(sectionUrl)
  const draw = (props) => renderToStaticMarkup(createElement(PendingPickupSection, { onReload: () => {}, reloading: false, ...props }))
  const emptyFail = draw({ presence: 'error', rows: [], hasTasks: false })
  assert.match(emptyFail, /me-pk-err/)
  assert.match(emptyFail, /<p><span>手机上还没取的单这次没读到。<\/span><\/p>/)
  assert.doesNotMatch(emptyFail, /不受影响/)
  assert.match(emptyFail, /<button[^>]*class="me-pk-retry"[^>]*>重新读取<\/button>/)
  assert.doesNotMatch(emptyFail, /me-stack/)
  const taskFail = draw({ presence: 'error', rows: [], hasTasks: true })
  assert.match(taskFail, /<span>手机上还没取的单这次没读到。<\/span><span>下面已产生打印任务的订单不受影响。<\/span>/)
  const busy = draw({ presence: 'error', rows: [], hasTasks: false, reloading: true })
  assert.match(busy, /正在重新读取…/)
  assert.match(busy, /disabled/)
  const hereRow = draw({
    presence: 'rows',
    hasTasks: false,
    rows: [{ orderId: 'ord-here', label: '简***.pdf', detail: '11月18日 20:16 · 1 页', claimableHere: true, elsewhere: null }],
  })
  assert.match(hereRow, /me-pk-row/)
  assert.match(hereRow, /me-pk-ft[^>]*>PDF</)
  assert.match(hereRow, /class="me-pk-go"/)
  assert.match(hereRow, /到这台取件/)
  assert.doesNotMatch(hereRow, /去哪台取/)
  const farRow = draw({
    presence: 'rows',
    hasTasks: true,
    rows: [{ orderId: 'pkg-far', label: '材料包 · 3 个文件', detail: '11月17日 18:40 · 9 页', claimableHere: false, elsewhere: '这笔订单不在这台机器取件，请到二楼服务区的 2 号机领取' }],
  })
  assert.match(farRow, /me-pk-pkg/)
  assert.match(farRow, /<div class="me-pk-where">[\s\S]*<b>去哪台取<\/b>/)
  assert.doesNotMatch(farRow, /<button[^>]*>[\s\S]*去哪台取/)
  const css = readFileSync(join(kioskRoot, 'src/pages/profile/touch/me-states.css'), 'utf8')
  assert.match(css, /\.me-pk-err\s*\{[^}]*display:\s*flex/)
  assert.match(css, /\.me-orders-exits \.me-exit-art\s*\{[^}]*width:\s*240px/)
  const sectionSrc = readFileSync(join(kioskRoot, 'src/pages/profile/me/printOrders/PendingPickupSection.tsx'), 'utf8')
  assert.match(sectionSrc, /reloadKey > 0 && presenceRef\.current === 'error'/)
})

test('点领取时服务端说不在这台机器：用服务端那句，空句或叫人找工作人员时用无人值守替身', () => {
  assert.equal(
    here.pickupHereMismatchMessage('这笔订单不在这台机器取件，请到下单时选的网点领取'),
    '这笔订单不在这台机器取件，请到下单时选的网点领取',
  )
  assert.equal(here.pickupHereMismatchMessage('   '), here.PICKUP_HERE_OTHER_MACHINE)
  assert.equal(here.pickupHereMismatchMessage('请联系工作人员'), here.PICKUP_HERE_OTHER_MACHINE)
})
