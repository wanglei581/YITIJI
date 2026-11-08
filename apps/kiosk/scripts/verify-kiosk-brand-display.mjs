import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const checks = [
  ['src/layouts/KioskRoot.tsx', ["isV6Route ? brand.brandName", 'v6ShellSubtitle(v6Shell, terminalCode, brand.brandName)', 'kioskBrandMark(brand)']],
  ['src/components/qingxu/QxPageFrame.tsx', ['{brand.brandName}', 'kioskBrandMark(brand)']],
  ['src/components/qingxu/touch/QxTouchBand.tsx', ['{brand.brandName}', 'kioskBrandMark(brand)']],
  ['src/pages/home/components/HomeHeroHeader.tsx', ['{brand.brandName}', 'kioskBrandMark(brand)']],
  ['src/pages/screensaver/StandbyView.tsx', ['{brand.brandName}', 'kioskBrandMark(brand)', '进入${brand.brandName}首页']],
]
let errors = 0
for (const [path, required] of checks) {
  const source = read(path)
  for (const fragment of required) {
    if (!source.includes(fragment)) { console.error(`FAIL ${path}: missing ${fragment}`); errors++ }
  }
  const executable = source.split('\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\n')
  if (executable.includes('职易达')) { console.error(`FAIL ${path}: hard-coded brand`); errors++ }
}
if (!read('src/copy/miniappLinkCopy.ts').includes("export const MINIAPP_DISPLAY_NAME = '职易达'")) {
  console.error('FAIL src/copy/miniappLinkCopy.ts: miniapp name changed'); errors++
}
if (errors) process.exitCode = 1
else console.log('PASS kiosk brand display and fixed miniapp name')
