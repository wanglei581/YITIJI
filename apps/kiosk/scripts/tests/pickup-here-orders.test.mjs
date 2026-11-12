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
    { orderId: 'ord-here', label: '简***.pdf' },
    { orderId: 'pkg-1', label: '材料包 · 3 个文件' },
    { orderId: 'pkg-0', label: '材料包' },
  ])
  const packed = JSON.stringify(rows)
  assert.equal(packed.includes('28491703'), false)
  assert.equal(packed.includes('简历.pdf'), false)
  assert.equal(packed.includes('现场简历'), false)
  assert.equal(packed.includes('别的机器'), false)
})

test('点领取时服务端说不在这台机器：用服务端那句，空句或叫人找工作人员时用无人值守替身', () => {
  assert.equal(
    here.pickupHereMismatchMessage('这笔订单不在这台机器取件，请到下单时选的网点领取'),
    '这笔订单不在这台机器取件，请到下单时选的网点领取',
  )
  assert.equal(here.pickupHereMismatchMessage('   '), here.PICKUP_HERE_OTHER_MACHINE)
  assert.equal(here.pickupHereMismatchMessage('请联系工作人员'), here.PICKUP_HERE_OTHER_MACHINE)
})
