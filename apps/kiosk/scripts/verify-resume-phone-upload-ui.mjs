import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertIncludes(src, marker, label) {
  if (!src.includes(marker)) throw new Error(`${label}: missing ${marker}`)
  console.log(`PASS ${label}`)
}

function assertNotIncludes(src, marker, label) {
  if (src.includes(marker)) throw new Error(`${label}: unexpected ${marker}`)
  console.log(`PASS ${label}`)
}

function assertMatches(src, pattern, label) {
  if (!pattern.test(src)) throw new Error(`${label}: missing ${pattern}`)
  console.log(`PASS ${label}`)
}

const source = read('src/pages/resume/ResumeSourcePage.tsx')
const panel = read('src/pages/upload/components/UploadSessionQrPanel.tsx')
const phone = read('src/pages/upload/PhoneUploadPage.tsx')
const routes = read('src/routes/index.tsx')
const api = read('src/services/api/uploadSessions.ts')

assertIncludes(source, '手机扫码上传', 'resume source exposes phone upload')
assertIncludes(source, 'UploadSessionQrPanel', 'resume source uses QR panel')
assertIncludes(panel, 'QRCodeSVG', 'QR panel renders real QR')
assertIncludes(panel, 'confirmUploadSession', 'Kiosk confirmation is explicit')
assertIncludes(panel, 'requiresKioskConfirmation', 'panel understands confirmation state')
assertIncludes(panel, 'created.controlToken', 'Kiosk keeps control token outside QR URL')
assertIncludes(panel, 'UPLOAD_SESSION_NOT_FOUND', 'polling stops when session disappears')
assertIncludes(api, 'url.hash = fragment.toString()', 'phone upload token stays in URL fragment')
assertIncludes(phone, '一体机上确认', 'phone page explains kiosk confirmation')
assertIncludes(phone, 'location.hash', 'phone page reads fragment upload token')
assertNotIncludes(phone, 'useSearchParams', 'phone page does not read upload token from query string')
assertNotIncludes(phone, 'searchParams.get', 'phone page does not fall back to query token')
assertMatches(
  phone,
  /<input\b(?=[^>]*\btype=(?:"file"|'file'))(?=[^>]*\baria-label=\{\s*`选择\$\{fileNoun\}`\s*\})[^>]*>/,
  'phone upload file input keeps a dynamic accessible label',
)
assertIncludes(source, 'aria-label="选择本机简历文件"', 'resume source file input has accessible label')
assertIncludes(routes, '/upload/phone', 'phone upload route is registered')
assertNotIncludes(source, '/print/upload', 'resume phone upload must not route through print flow')

console.log('PASS resume phone upload UI verification')
