import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')

const proto = read('src/pages/print/print-prototype.css')
const cashier = read('src/pages/print/styles/print-cashier.css')

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

check('print tokens resolve with teal fallbacks (not bare var(--k-teal) at :root)', () => {
  // :root { --print-teal: var(--k-teal) } is invalid when --k-teal is only defined on fusion-youth.
  // Require explicit fallback so primary CTAs cannot paint transparent + cream text.
  assert.match(proto, /--print-teal:\s*var\(--k-teal,\s*#[0-9a-fA-F]{3,8}\)/)
  assert.match(proto, /--print-teal-deep:\s*var\(--k-teal-deep,\s*#[0-9a-fA-F]{3,8}\)/)
  assert.match(proto, /--print-teal-soft:\s*var\(--k-teal-soft,\s*#[0-9a-fA-F]{3,8}\)/)
  assert.doesNotMatch(proto, /--print-teal:\s*var\(--k-teal\)\s*;/)
})

check('print-confirm-primary keeps opaque teal background and light text with fallbacks', () => {
  const block = cashier.match(/\.print-confirm-primary\s*\{[^}]+\}/)?.[0] ?? ''
  assert.ok(block.includes('background: var(--print-teal, var(--k-teal, #1f9e86))'), 'background must include teal fallbacks')
  assert.ok(block.includes('color: var(--k-surface, var(--color-surface, #fffdf8))'), 'color must include surface fallbacks')
})

if (failures) {
  console.error(`\n${failures} FAIL print CTA contrast contract`)
  process.exit(1)
}
console.log('\nALL PASS print CTA contrast contract')
