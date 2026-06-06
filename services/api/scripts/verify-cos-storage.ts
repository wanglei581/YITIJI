/**
 * COS 存储纯函数验证(无 DB / 无网络)。
 *
 * 覆盖:
 *   1. objectKey 生成规则(各 purpose 前缀 + 路径穿越防护 + ext 归一)
 *   2. COS 预签名 URL 签名(独立重算交叉校验 + 结构断言 + 确定性)
 *   3. 上传校验(purpose / MIME / 扩展名 / 大小;proxy vs intent)
 *
 * Run: pnpm --filter @ai-job-print/api verify:cos
 */
import { createHash, createHmac } from 'crypto'
import { generateObjectKey } from '../src/storage/object-key'
import { buildCosPresignedUrl, objectKeyToUrlPath } from '../src/storage/cos-signing'
import { validateUpload } from '../src/files/file-validation'

let passed = 0
function pass(msg: string) {
  passed++
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
  process.exit(1)
}
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual === expected) pass(`${msg}`)
  else fail(`${msg}\n    expected: ${String(expected)}\n    actual:   ${String(actual)}`)
}
function ok(cond: boolean, msg: string) {
  if (cond) pass(msg)
  else fail(msg)
}

// ── 1. objectKey 规则 ──────────────────────────────────────────────────────
console.log('\n=== 1. objectKey 生成规则 ===')
eq(
  generateObjectKey({ purpose: 'resume_upload', ownerType: 'user', ownerId: 'u1', fileId: 'abc', ext: 'pdf' }),
  'users/u1/resumes/abc.pdf',
  '简历上传 → users/{userId}/resumes',
)
eq(
  generateObjectKey({ purpose: 'resume_scan', ownerType: 'user', ownerId: 'u1', fileId: 'abc', ext: 'png' }),
  'users/u1/scans/abc.png',
  '扫描 → users/{userId}/scans',
)
eq(
  generateObjectKey({ purpose: 'print_doc', ownerType: 'user', ownerId: 'u1', fileId: 'abc', ext: 'pdf' }),
  'users/u1/print-files/abc.pdf',
  '打印 → users/{userId}/print-files',
)
eq(
  generateObjectKey({ purpose: 'partner_profile', ownerType: 'partner', ownerId: 'org1', fileId: 'abc', ext: 'png' }),
  'partners/org1/profiles/abc.png',
  '机构资料 → partners/{orgId}/profiles',
)
eq(
  generateObjectKey({ purpose: 'partner_image', ownerType: 'partner', ownerId: 'org1', fileId: 'abc', ext: 'jpg' }),
  'partners/org1/job-images/abc.jpg',
  '岗位图片 → partners/{orgId}/job-images',
)
eq(
  generateObjectKey({ purpose: 'partner_video', ownerType: 'partner', ownerId: 'org1', fileId: 'abc', ext: 'mp4' }),
  'partners/org1/videos/abc.mp4',
  '机构视频 → partners/{orgId}/videos',
)
eq(
  generateObjectKey({ purpose: 'job_fair_material', ownerType: 'partner', ownerId: 'org1', fileId: 'abc', ext: 'pdf' }),
  'partners/org1/job-fair-materials/abc.pdf',
  '招聘会资料 → partners/{orgId}/job-fair-materials',
)
eq(
  generateObjectKey({ purpose: 'admin_upload', ownerType: 'admin', ownerId: 'admin1', fileId: 'abc', ext: 'pdf' }),
  'admin/uploads/abc.pdf',
  '管理员上传 → admin/uploads',
)
eq(
  generateObjectKey({ purpose: 'screensaver_material', ownerType: 'system', ownerId: null, fileId: 'abc', ext: 'mp4' }),
  'screensaver/materials/abc.mp4',
  '宣传屏素材 → screensaver/materials',
)
eq(
  generateObjectKey({ purpose: 'temp', ownerType: 'system', ownerId: null, fileId: 'abc', ext: 'pdf', uploadSessionId: 'sess1' }),
  'tmp/uploads/sess1/abc.pdf',
  '临时 → tmp/uploads/{session}',
)
// owner 缺失的 user/partner 用途 → 回退 tmp,绝不落 users/ 持久前缀
eq(
  generateObjectKey({ purpose: 'resume_upload', ownerType: 'user', ownerId: null, fileId: 'abc', ext: 'pdf' }),
  'tmp/uploads/abc/abc.pdf',
  '匿名简历(无 ownerId)→ 回退 tmp/uploads',
)
// 路径穿越防护
eq(
  // 不安全字符(/ . )全部剥离:'../../etc'→'etc','a/../b'→'ab',杜绝路径穿越
  generateObjectKey({ purpose: 'resume_upload', ownerType: 'user', ownerId: '../../etc', fileId: 'a/../b', ext: 'pdf' }),
  'users/etc/resumes/ab.pdf',
  '路径穿越字符被清洗',
)
// ext 归一
eq(
  generateObjectKey({ purpose: 'admin_upload', ownerType: 'admin', ownerId: 'a', fileId: 'x', ext: 'PDF' }),
  'admin/uploads/x.pdf',
  'ext 大写归一为小写',
)
eq(
  generateObjectKey({ purpose: 'admin_upload', ownerType: 'admin', ownerId: 'a', fileId: 'x', ext: '' }),
  'admin/uploads/x.bin',
  '空 ext → bin',
)

// ── 2. COS 预签名 URL 签名 ──────────────────────────────────────────────────
console.log('\n=== 2. COS 预签名 URL 签名 ===')

const SID = 'AKIDtestsecretidtestsecretidtest12345'
const SKEY = 'testsecretkeytestsecretkeytest1234567'
const BUCKET = 'yitiji-prod-private-1257025684'
const REGION = 'ap-guangzhou'
const KEY = 'users/u1/resumes/abc.pdf'
const T = 1_700_000_000 // 固定签名时间(秒)
const TTL = 1800

function camEnc(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
}
function hmacSha1(key: string, data: string): string {
  return createHmac('sha1', key).update(data).digest('hex')
}
function sha1(data: string): string {
  return createHash('sha1').update(data).digest('hex')
}

/** 独立重算签名(不调用 cos-signing 内部),交叉校验实现是否遵循官方算法。 */
function independentSig(method: string, key: string, query: Record<string, string>): { sig: string; keyTime: string } {
  const now = T - 1
  const exp = now + TTL
  const keyTime = `${now};${exp}`
  const signKey = hmacSha1(SKEY, keyTime)
  const lowered = Object.keys(query).map((k) => ({ k: k.toLowerCase(), v: query[k] ?? '' }))
  lowered.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
  const httpParameters = lowered.map((p) => `${camEnc(p.k)}=${camEnc(p.v)}`).join('&')
  const pathname = '/' + key.replace(/^\/+/, '')
  const formatString = [method.toLowerCase(), pathname, httpParameters, '', ''].join('\n')
  const stringToSign = ['sha1', keyTime, sha1(formatString), ''].join('\n')
  return { sig: hmacSha1(signKey, stringToSign), keyTime }
}

function extractParam(url: string, name: string): string | null {
  const m = url.match(new RegExp(`(?:[?&])${name}=([^&]*)`))
  return m ? m[1]! : null
}

// GET 无 query
const getUrl = buildCosPresignedUrl({ secretId: SID, secretKey: SKEY, bucket: BUCKET, region: REGION, method: 'GET', objectKey: KEY, ttlSeconds: TTL, signTimeSec: T })
ok(getUrl.startsWith(`https://${BUCKET}.cos.${REGION}.myqcloud.com/`), 'URL host 正确')
ok(getUrl.includes(objectKeyToUrlPath(KEY)), 'URL path 含编码后的 objectKey')
eq(extractParam(getUrl, 'q-ak'), SID, 'q-ak == SecretId')
const indGet = independentSig('GET', KEY, {})
eq(extractParam(getUrl, 'q-sign-time'), indGet.keyTime, 'q-sign-time == keyTime(回拨 1s)')
eq(extractParam(getUrl, 'q-key-time'), indGet.keyTime, 'q-key-time == keyTime')
eq(extractParam(getUrl, 'q-signature'), indGet.sig, 'q-signature 与独立重算一致(GET)')
ok(/^[0-9a-f]{40}$/.test(extractParam(getUrl, 'q-signature') ?? ''), 'q-signature 为 40 位 hex')

// GET 带 response-content-disposition(必须签名)
const disp = "attachment; filename*=UTF-8''abc.pdf"
const dlUrl = buildCosPresignedUrl({
  secretId: SID, secretKey: SKEY, bucket: BUCKET, region: REGION, method: 'GET', objectKey: KEY, ttlSeconds: TTL, signTimeSec: T,
  query: { 'response-content-disposition': disp },
})
eq(extractParam(dlUrl, 'q-url-param-list'), 'response-content-disposition', 'q-url-param-list 含被签名参数')
ok(dlUrl.includes(`response-content-disposition=${camEnc(disp)}`), '被签名 query 出现在 URL 中')
const indDl = independentSig('GET', KEY, { 'response-content-disposition': disp })
eq(extractParam(dlUrl, 'q-signature'), indDl.sig, 'q-signature 与独立重算一致(带 disposition)')

// PUT 预签名
const putUrl = buildCosPresignedUrl({ secretId: SID, secretKey: SKEY, bucket: BUCKET, region: REGION, method: 'PUT', objectKey: KEY, ttlSeconds: TTL, signTimeSec: T })
eq(extractParam(putUrl, 'q-signature'), independentSig('PUT', KEY, {}).sig, 'q-signature 与独立重算一致(PUT)')

// 确定性 + 不同 key 不同签名
const url2 = buildCosPresignedUrl({ secretId: SID, secretKey: SKEY, bucket: BUCKET, region: REGION, method: 'GET', objectKey: KEY, ttlSeconds: TTL, signTimeSec: T })
eq(url2, getUrl, '相同输入 → 相同 URL(确定性)')
const urlOther = buildCosPresignedUrl({ secretId: SID, secretKey: SKEY, bucket: BUCKET, region: REGION, method: 'GET', objectKey: 'users/u2/resumes/xyz.pdf', ttlSeconds: TTL, signTimeSec: T })
ok(extractParam(urlOther, 'q-signature') !== extractParam(getUrl, 'q-signature'), '不同 objectKey → 不同签名')
ok(!getUrl.includes(SKEY), 'URL 不泄漏 SecretKey')

// ── 3. 上传校验 ─────────────────────────────────────────────────────────────
console.log('\n=== 3. 上传校验(purpose / MIME / ext / 大小)===')
const MB = 1024 * 1024

function expectOk(args: Parameters<typeof validateUpload>[0], expectExt: string, msg: string) {
  const r = validateUpload(args)
  if (r.ok && r.ext === expectExt) pass(msg)
  else fail(`${msg} → ${JSON.stringify(r)}`)
}
function expectErr(args: Parameters<typeof validateUpload>[0], code: string, msg: string) {
  const r = validateUpload(args)
  if (!r.ok && r.code === code) pass(msg)
  else fail(`${msg} → ${JSON.stringify(r)}`)
}

expectOk({ purpose: 'print_doc', mimeType: 'application/pdf', filename: 'a.pdf', sizeBytes: 1 * MB, mode: 'proxy' }, 'pdf', '打印 PDF 通过')
expectOk({ purpose: 'partner_video', mimeType: 'video/mp4', filename: 'v.mp4', sizeBytes: 100 * MB, mode: 'intent' }, 'mp4', '机构视频 100MB(intent)通过')
expectErr({ purpose: 'print_doc', mimeType: 'image/webp', filename: 'a.webp', sizeBytes: 1 * MB, mode: 'proxy' }, 'FILE_MIME_NOT_ALLOWED', '打印用途拒绝 webp')
expectErr({ purpose: 'print_doc', mimeType: 'application/pdf', filename: 'a.exe', sizeBytes: 1 * MB, mode: 'proxy' }, 'FILE_EXT_MISMATCH', '扩展名与 MIME 不一致被拒')
expectErr({ purpose: 'resume_upload', mimeType: 'application/pdf', filename: 'a.pdf', sizeBytes: 16 * MB, mode: 'proxy' }, 'FILE_TOO_LARGE', '代理上传超 15MB 被拒')
expectOk({ purpose: 'resume_upload', mimeType: 'application/pdf', filename: 'a.pdf', sizeBytes: 16 * MB, mode: 'intent' }, 'pdf', '直传 16MB(<20MB 上限)通过')
expectErr({ purpose: 'partner_video', mimeType: 'video/mp4', filename: 'v.mp4', sizeBytes: 100 * MB, mode: 'proxy' }, 'FILE_TOO_LARGE', '视频走代理上传被拒(应走直传)')
expectErr({ purpose: 'not_a_purpose', mimeType: 'application/pdf', filename: 'a.pdf', sizeBytes: 1 * MB, mode: 'proxy' }, 'FILE_PURPOSE_INVALID', '非法 purpose 被拒')
expectErr({ purpose: 'print_doc', mimeType: 'application/pdf', filename: 'a.pdf', sizeBytes: 0, mode: 'proxy' }, 'FILE_EMPTY', '空文件被拒')

console.log(`\nALL PASS (${passed} checks)`)
