#!/usr/bin/env node
/**
 * verify:file-source-qx — 选择文件来源页（12-file-source.html → /print/upload）
 *
 * 钉住：青序外壳、38 态清单、隐私预检不可绕过、主 CTA 无文件禁用、
 * 取消失败不得清会话。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(kioskRoot, rel), 'utf8')

const files = {
  page: read('src/pages/print/PrintUploadPage.tsx'),
  model: read('src/pages/print/file-source/fileSourceModel.ts'),
  view: read('src/pages/print/file-source/FileSourceView.tsx'),
  bits: read('src/pages/print/file-source/FileSourceBits.tsx'),
  css: read('src/pages/print/styles/file-source-qx.css'),
  root: read('src/layouts/KioskRoot.tsx'),
  panel: read('src/pages/upload/components/UploadSessionQrPanel.tsx'),
}
const all = Object.values(files).join('\n')

const failures = []
const assert = (ok, msg) => {
  if (!ok) failures.push(msg)
  else console.log(`PASS ${msg}`)
}
const has = (src, marker) => src.includes(marker)

assert(has(files.root, "'/print/upload'"), 'KioskRoot QX_MIGRATED_ROUTES registers /print/upload')
assert(has(files.view, 'QxPageFrame'), 'upload page uses QxPageFrame')
assert(has(files.page, "import { FileSourceView }"), 'page composes FileSourceView')
assert(has(files.view, "import '../styles/file-source-qx.css'"), 'view imports Qingxu CSS')
assert(has(files.view, 'data-w2-page="print-upload"'), 'page keeps stable W2 landmark')
assert(has(files.css, 'var(--qx-ink)'), 'page CSS uses Qingxu tokens')
assert(has(files.css, '--qx-tap-min'), 'page CSS keeps 48px touch floor token')
assert(!/#[0-9a-fA-F]{3,8}\b/.test(files.css), 'page CSS has no naked hex')

const STATES = [
  'source-chooser', 'missing-file', 'unknown',
  'local-guide', 'local-picking', 'local-cancelled', 'local-rejected', 'local-oversize',
  'local-unreadable', 'local-uploading', 'local-upload-failed', 'local-ready',
  'phone-generating', 'phone-gen-failed', 'phone-ready', 'phone-waiting', 'phone-uploading',
  'phone-status-unknown', 'phone-expired', 'phone-uploaded', 'phone-confirming',
  'phone-confirm-failed', 'phone-confirmed', 'phone-cancel-requesting', 'phone-cancel-failed',
  'phone-cancelled',
  'usb-unavailable', 'usb-agent-offline', 'usb-wait', 'usb-detecting', 'usb-empty', 'usb-list',
  'usb-read-failed', 'usb-selected', 'usb-safeid-expired', 'usb-importing', 'usb-import-failed',
  'usb-ready',
]
assert(STATES.length === 38, 'prototype state list has 38 entries')
for (const state of STATES) {
  assert(files.model.includes(`'${state}'`), `model lists state ${state}`)
}

assert(has(files.model, 'function deriveFileSourceScreen'), 'runtime derives screens from real data')
assert(!has(files.page, 'capture=1'), 'runtime does not implement capture fixtures that fake uploaded files')
assert(!has(files.view, '合成演示'), 'runtime does not label synthetic uploaded files')

assert(
  has(files.page, "navigate('/print/material-check', { state: { file, source } })"),
  'only material-check is the forward exit, and it carries file+source',
)
assert(!/navigate\('\/print\/preview'/.test(files.page), 'upload page never skips to preview')
assert(!/navigate\('\/print\/confirm'/.test(files.page), 'upload page never skips to confirm')
assert(!/materialCheck\s*:/.test(files.page), 'upload page does not write a fake materialCheck summary')
assert(has(files.view, 'FILE_SOURCE_HAS_FILE.has(screen)'), 'primary continue is gated on a confirmed current file')
assert(has(files.page, 'if (!file) return'), 'handleNext refuses to continue without a file')

assert(has(files.bits, '本机选文件'), 'channel copy uses 本机选文件')
assert(has(files.bits, '手机扫码上传'), 'channel copy uses 手机扫码上传')
assert(has(files.bits, 'U 盘导入'), 'channel copy uses U 盘导入')
assert(has(files.bits, '扫描纸质原件'), 'scan is a real independent entry')
assert(has(files.bits, '我的文档 / 最近打印'), 'member documents is a real independent entry')
assert(has(files.bits, '第三方网盘尚未接入') || has(files.view, '第三方网盘尚未接入'), 'cloud drive is marked not connected')
assert(!has(all, '一键投递') && !has(all, '立即投递') && !has(all, '平台投递'), 'compliance: no platform apply copy')

assert(has(files.page, 'classifyLocalFile'), 'local files are classified before upload')
assert(has(files.page, 'local-uploading') || has(files.model, "'local-uploading'"), 'uploading is a real screen')
assert(
  has(files.view, '本页无取消动作') || has(files.view, '没有「取消本次上传」'),
  'local-uploading does not offer a fake cancel-upload action',
)

assert(has(files.panel, 'cancelFailed'), 'QR panel tracks cancel failure instead of swallowing it')
assert(
  !/handleCancel[\s\S]{0,400}catch \{\s*\/\/ best-effort only\s*\}/.test(files.panel),
  'QR panel no longer swallows DELETE failure then clears the session',
)
assert(has(files.panel, '这次会话没能取消，文件还留着'), 'cancel failure keeps an honest user message')
assert(has(files.panel, "status: 'cancelled'"), 'successful cancel records cancelled, does not invent success without the server')

assert(has(files.page, 'usbSelected'), 'USB select-then-import is a real two-step')
assert(has(files.page, 'isUsbSafeIdExpired'), 'USB 410/expired safeId is a distinct failure')
assert(has(files.view, 'file-source-primary'), 'primary CTA has a stable test id')
assert(has(files.view, '下一步：材料检查'), 'ready-state primary names the real next step')

if (failures.length) {
  console.error('verify-file-source-qx failed:')
  for (const f of failures) console.error(`- ${f}`)
  process.exit(1)
}
console.log(`verify-file-source-qx passed (${Object.keys(files).length} files, ${STATES.length} states)`)
