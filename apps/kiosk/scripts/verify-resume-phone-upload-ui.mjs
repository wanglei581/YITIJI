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
const usbPanel = read('src/pages/resume/components/ResumeUsbImportPanel.tsx')
const usbApi = read('src/services/files/usbImportApi.ts')
const preview = read('src/components/FileContentPreview.tsx')
const previewDialog = read('src/components/FilePreviewDialog.tsx')
const optimize = read('src/pages/resume/ResumeOptimizePage.tsx')
const selfAssessment = read('src/pages/resume/SelfAssessmentFlow.tsx')

assertIncludes(source, '手机扫码上传', 'resume source exposes phone upload')
assertIncludes(source, 'UploadSessionQrPanel', 'resume source uses QR panel')
assertIncludes(source, 'ResumeUsbImportPanel', 'resume source uses the Terminal Agent USB panel')
assertIncludes(source, 'FileContentPreview', 'resume source renders the uploaded original file')
assertIncludes(source, 'fileUrl: uploaded.signedUrl', 'local resume upload keeps its short preview URL in memory')
assertIncludes(source, 'fileUrl: file.fileUrl', 'phone resume upload passes through its short preview URL')
assertIncludes(usbPanel, 'getUsbStatus', 'resume USB panel reads real Agent status')
assertIncludes(usbPanel, 'listUsbFiles', 'resume USB panel lists real Agent files')
assertIncludes(usbPanel, "uploadUsbFile(item.safeId, 'resume_upload', getToken())", 'resume USB panel uploads with the resume purpose and current in-memory member token')
assertIncludes(usbApi, "Authorization: `Bearer ${endUserToken}`", 'USB bridge forwards the optional member token in the standard authorization header')
assertIncludes(source, 'const sourceBusy = uploading || phoneBusy || usbBusy', 'resume upload channels share one navigation lock')
assertIncludes(usbPanel, 'mountedRef.current = true', 'resume USB panel restores its mounted guard under React StrictMode effect replay')
assertIncludes(usbPanel, 'onBusyChange?.(false)', 'resume USB panel clears its parent busy state on unmount')
assertIncludes(usbPanel, 'item.sizeBytes <= MAX_RESUME_BYTES', 'resume USB panel enforces its stated 10MB file limit')
assertNotIncludes(usbPanel, '`${mimeType} ${filename}`', 'resume USB format detection does not use filename substrings')
assertIncludes(usbPanel, "normalizedMime === 'image/jpeg'", 'resume USB format detection prefers exact image MIME')
assertIncludes(preview, '<iframe', 'shared file preview renders PDF content')
assertIncludes(preview, '<img', 'shared file preview renders image content')
assertIncludes(preview, 'setRenderFailed(false)', 'shared file preview resets a prior render failure when the selected file changes')
assertIncludes(preview, "normalizedMime && !['application/octet-stream', 'binary/octet-stream'].includes(normalizedMime)", 'shared file preview trusts a specific MIME before extension fallback')
assertNotIncludes(preview, "target=\"_blank\"", 'shared Kiosk preview does not leave a signed file open outside the privacy root')
assertNotIncludes(preview, "normalized.includes('pdf')", 'shared file preview does not use substring PDF detection')
assertIncludes(previewDialog, 'FileContentPreview', 'sensitive file dialog uses the shared inline preview')
assertIncludes(previewDialog, 'QRCodeSVG', 'sensitive file dialog can hand a short-lived download URL to the user phone')
assertIncludes(previewDialog, 'h-12 w-12', 'sensitive file dialog close button keeps the 48px Kiosk touch target')
assertIncludes(optimize, 'FilePreviewDialog', 'optimized resumes open inside the Kiosk privacy root')
assertIncludes(selfAssessment, 'FilePreviewDialog', 'self-assessment PDFs open inside the Kiosk privacy root')
assertNotIncludes(optimize, "window.open(exported.signedUrl", 'optimized resumes do not escape to a new browser tab')
assertNotIncludes(selfAssessment, 'target="_blank"', 'self-assessment PDFs do not escape to a new browser tab')
assertIncludes(panel, 'QRCodeSVG', 'QR panel renders real QR')
assertIncludes(panel, 'confirmUploadSession', 'Kiosk confirmation is explicit')
assertIncludes(panel, 'requiresKioskConfirmation', 'panel understands confirmation state')
assertIncludes(panel, 'created.controlToken', 'Kiosk keeps control token outside QR URL')
assertIncludes(panel, 'UPLOAD_SESSION_NOT_FOUND', 'polling stops when session disappears')
assertIncludes(panel, 'await cancelUploadSession(existing.sessionId, existing.controlToken)', 'refresh revokes the previous QR before minting a replacement')
assertIncludes(panel, "disabled={loading || confirming || uploaded}", 'an uploaded file cannot be discarded by refreshing the QR')
assertIncludes(panel, 'window.setInterval(() => setNow(Date.now()), 1_000)', 'QR countdown is driven by the server expiry timestamp')
assertIncludes(panel, 'uploadSessionUserMessage', 'Kiosk QR errors use public-safe copy')
assertIncludes(api, 'url.hash = fragment.toString()', 'phone upload token stays in URL fragment')
assertIncludes(phone, '一体机上确认', 'phone page explains kiosk confirmation')
assertIncludes(phone, 'PHONE_UPLOAD_PURPOSES', 'phone page maps each supported purpose explicitly')
assertIncludes(phone, '签名或印章图片', 'signature uploads use their own mobile copy and file filter')
assertNotIncludes(phone, '就业服务大厅 · 01号机', 'phone page does not invent a terminal name')
assertIncludes(phone, 'uploadSessionUserMessage', 'phone upload errors use public-safe copy')
assertIncludes(phone, "state !== 'success'", 'successful uploads cannot be reset into a false re-upload state')
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
for (const persistenceApi of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
  assertNotIncludes(`${source}\n${panel}\n${usbPanel}`, persistenceApi, `resume preview URL is not persisted through ${persistenceApi}`)
}

console.log('PASS resume phone upload UI verification')
