/**
 * 手机上传页认「本人手写签名图片」（触屏版走查 I-14）。
 *
 * 之前：后端 CreateUploadSessionDto 不收 signature_image，一体机签名第 2 步的二维码必败，手机页于是给
 * 一个「signature-blocked」死胡同。后端放行之后（见 services/api 的 verify-upload-sessions-signature），
 * 手机页必须真能传：
 * - 回执用途是 signature_image 算「已收到」，确认后的用途就是它（不再被当成回执不认识的用途退成「结果未知」）；
 * - 链接不再有「签名不可用」这一态；
 * - 上传前的通用档只在文档类用途里取交集（PDF 仍可选）；链接写着是签名图时只收紧到 JPG / PNG，不放宽；
 * - 签名图被拒的文案不能叫人去「转成 PDF」。
 * 转译真源码来跑；node 里装不起来的依赖换成替身。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(relativePath, replacements) {
  const absolutePath = join(kioskRoot, relativePath)
  let out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    out = out.split(`'${specifier}'`).join(`'${url}'`).split(`"${specifier}"`).join(`"${url}"`)
  }
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((s) => !s.startsWith('data:'))
  assert.deepEqual(leftover, [], `${relativePath} 还有没替换的运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const httpStub = toDataUrl(`export class ApiHttpError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; this.name = 'ApiHttpError' }
}`)
const model = await import(transpile('src/pages/upload/phoneUploadModel.ts', { '../../services/api/httpAdapter': httpStub }))

const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const RESUME_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const SIGN_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png'
const accepts = {
  resume_upload: RESUME_ACCEPT,
  print_doc: DOC_ACCEPT,
  contract_upload: RESUME_ACCEPT,
  signature_image: SIGN_ACCEPT,
}

const receipt = (purpose) => ({
  sessionId: 's1', status: 'uploaded', purpose, mode: 'member', requiresKioskConfirmation: true, expiresAt: '2099-01-01T00:00:00.000Z',
  file: { fileId: 'f1', filename: '签名.png', sizeBytes: 1200, mimeType: 'image/png', sha256: 'x', fileExpiresAt: null },
})
const picked = (name, type, size = 2048) => ({ name, size, ext: model.extOf(name), type })

test('回执用途是 signature_image 算「已收到」，确认后的用途就是它', () => {
  assert.equal(model.isSessionPurpose('signature_image'), true)
  assert.deepEqual(model.receiptOf(receipt('signature_image')), { received: true, purpose: 'signature_image' })
  // 其余用途不变；不认识的用途仍然不算收到
  assert.deepEqual(model.receiptOf(receipt('print_doc')), { received: true, purpose: 'print_doc' })
  assert.deepEqual(model.receiptOf(receipt('id_scan')), { received: false, purpose: null })
})

test('链接不再有「签名不可用」这一态：带 signature_image 的链接缺了会话号才算坏', () => {
  assert.equal(model.linkIssueOf('sess', 'token'), null)
    assert.equal(model.linkIssueOf('', 'token'), 'invalid')
  assert.equal(model.linkIssueOf('sess', ''), 'invalid')
})

test('上传前的通用档：文档类用途取交集，PDF 仍可选；签名链接只收紧到 JPG / PNG，不放宽', () => {
  const generic = model.preUploadPolicy(accepts, '')
  assert.ok(generic.exts.includes('pdf'), '通用档要有 PDF（简历 / 打印 / 合同都靠它）')
  assert.deepEqual(model.preUploadPolicy(accepts, 'print_doc').exts, generic.exts, '别的用途提示不改通用档')
  assert.deepEqual(model.preUploadPolicy(accepts, 'nonsense').exts, generic.exts, '读不懂的提示不改通用档')
  const sign = model.preUploadPolicy(accepts, 'signature_image')
  assert.deepEqual([...sign.exts].sort(), ['jpeg', 'jpg', 'png'])
  for (const ext of sign.exts) assert.ok(generic.exts.includes(ext), `收紧只能是通用档的子集：${ext}`)
  assert.deepEqual([...sign.chips].sort(), ['JPG', 'PNG'])
  assert.equal(model.precheck(picked('签名.png', 'image/png'), sign), null)
  assert.equal(model.precheck(picked('签名.jpg', 'image/jpeg'), sign), null)
  assert.equal(model.precheck(picked('合同.pdf', 'application/pdf'), sign)?.state, 'type-error', '签名链接上选 PDF 要在手机上就拦下')
  assert.equal(model.precheck(picked('照片.webp', 'image/webp'), sign)?.state, 'type-error')
  assert.equal(model.precheck(picked('合同.pdf', 'application/pdf'), generic), null, '文档链接上 PDF 照常放行')
})

test('签名图被拒时不能叫人去「转成 PDF」', () => {
  const sign = model.preUploadPolicy(accepts, 'signature_image')
  const ctx = (file) => ({ file, typeIssue: null, unknownType: false, chips: sign.chips, target: 'signature' })
  for (const state of ['type-error', 'content-type-error']) {
    const view = model.uploadView(state, ctx(picked('合同.pdf', 'application/pdf')))
    const text = [view.fileNote?.text, view.progress.note, view.progress.head].join('\n')
    assert.ok(!/转成\s*\**PDF/.test(text) && !text.includes('转成 PDF'), `${state} 不能让人把签名图转成 PDF：${text}`)
    assert.ok(text.includes('JPG') && text.includes('PNG'), `${state} 要点名可以传 JPG / PNG：${text}`)
  }
  // 文档链接的原话不变
  const doc = model.uploadView('type-error', { file: picked('旧稿.wps', ''), typeIssue: null, unknownType: true, chips: ['PDF', 'JPG', 'PNG'], target: 'document' })
  assert.ok(`${doc.fileNote?.text}${doc.progress.note}`.includes('PDF'))
})
