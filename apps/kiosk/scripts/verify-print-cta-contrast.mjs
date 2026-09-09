import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')

const tokens = read('src/styles/qingxu/tokens.css')
const primitives = read('src/styles/qingxu/primitives.css')
const cashierQx = read('src/pages/print/styles/cashier-qx.css')

let failures = 0
function check(label, run) {
  try {
    run()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

check('qingxu tokens define opaque paper/deep/teal as hex literals', () => {
  // 原断言钉 print-prototype.css 的 --print-teal fallback，防 CTA 画成透明底+浅字。
  // 活页面已改用青序令牌；令牌必须自带字面 hex，不能再依赖未定义的 --k-teal。
  assert.match(tokens, /--qx-deep:\s*#[0-9a-fA-F]{3,8}/)
  assert.match(tokens, /--qx-paper:\s*#[0-9a-fA-F]{3,8}/)
  assert.match(tokens, /--qx-teal:\s*#[0-9a-fA-F]{3,8}/)
})

check('primary CTA uses opaque deep background and light text', () => {
  const block = primitives.match(/\.qx-btn\[data-variant='primary'\]\s*\{[^}]+\}/)?.[0] ?? ''
  assert.ok(block.includes('background: var(--qx-deep)'), 'primary background must be --qx-deep')
  assert.ok(block.includes('color: var(--qx-paper)'), 'primary text must be --qx-paper')
})

check('cashier active channel choice uses opaque deep background and light text', () => {
  const block = cashierQx.match(/\.cashier-qx-choice\[data-active='true'\]\s*\{[^}]+\}/)?.[0] ?? ''
  assert.ok(block.includes('background: var(--qx-deep)'), 'active choice background must be --qx-deep')
  assert.ok(block.includes('color: var(--qx-paper)'), 'active choice text must be --qx-paper')
})

if (failures) {
  console.error(`\n${failures} FAIL print CTA contrast contract`)
  process.exit(1)
}
console.log('\nALL PASS print CTA contrast contract')
