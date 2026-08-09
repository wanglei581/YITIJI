import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const kioskRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(kioskRoot, '../..')

function read(root, file) {
  return readFileSync(resolve(root, file), 'utf8')
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  PASS ${message}`)
}

console.log('\n=== Kiosk 打印参数已验证能力合同 ===')

const shared = read(repoRoot, 'packages/shared/src/types/print.ts')
const preview = read(kioskRoot, 'src/pages/print/PrintPreviewPage.tsx')
const params = read(kioskRoot, 'src/pages/print/PrintParamsPage.tsx')
const confirm = read(kioskRoot, 'src/pages/print/PrintConfirmPage.tsx')

expect(
  shared.includes('VERIFIED_PRINT_PARAMETER_PROFILE') &&
    shared.includes('restrictToVerifiedPrintParams') &&
    shared.includes('hasUnverifiedPrintParams'),
  'shared 提供安全 profile、旧参数收口与差异检测 helper',
)

for (const [name, source] of [['PrintPreviewPage', preview], ['PrintParamsPage', params]]) {
  expect(source.includes('VERIFIED_PRINT_PARAMETER_PROFILE'), `${name} 从 shared 安全 profile 取参数`)
  expect(
    source.includes('hasUnverifiedPrintParams') && source.includes('检测到旧会话参数，已明确收口为当前组合'),
    `${name} 对恢复出的旧参数显式提示收口`,
  )
  expect(!source.includes('setColorMode('), `${name} 不再允许切换彩色`)
  expect(!source.includes('setDuplex('), `${name} 不再允许切换双面`)
  expect(source.includes('当前仅开放黑白、单面、每张 1 页'), `${name} 明示当前能力边界`)
  expect(source.includes('厂家确认和 Windows 真机验收后再开放'), `${name} 不把硬件规格冒充已验证能力`)
}

expect(
  confirm.includes('restrictToVerifiedPrintParams') &&
    confirm.includes('hasUnverifiedPrintParams') &&
    confirm.includes('参数已按当前已验证能力收口') &&
    confirm.indexOf('restrictToVerifiedPrintParams') < confirm.indexOf('quotePrintOrder('),
  'PrintConfirmPage 在报价前识别旧会话并显式收口，避免按未验证参数计价',
)
expect(
  !/params\.colorMode\s*===\s*['"]color['"]/.test(confirm) &&
    !confirm.includes('彩色效果以设备支持'),
  '确认页不再展示彩色可用暗示',
)

console.log('\nALL PASS')
