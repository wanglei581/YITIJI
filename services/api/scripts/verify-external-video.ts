import assert from 'node:assert/strict'
import { validateExternalVideoUrl } from '../src/content/external-video-url'

/**
 * 外部视频直链校验单测(纯函数,无需 DB / HTTP)。
 * 覆盖:HTTPS 限制、私网/内网/回环阻断、mp4/webm 直链、白名单、归一化。
 */

// ── 合法直链 ──────────────────────────────────────────────────────────────────
for (const url of [
  'https://cdn.example.com/promo.mp4',
  'https://cdn.example.com/path/to/clip.webm',
  'https://videos.example.gov.cn/2026/intro.MP4', // 大小写扩展名
  'https://cdn.example.com/v.mp4?token=abc&t=10', // 带 query
]) {
  const r = validateExternalVideoUrl(url)
  assert.equal(r.ok, true, `expected OK for ${url}: ${JSON.stringify(r)}`)
}

{
  const r = validateExternalVideoUrl('https://cdn.example.com/a.webm')
  assert.ok(r.ok && r.mimeType === 'video/webm' && r.ext === 'webm')
}
{
  const r = validateExternalVideoUrl('https://cdn.example.com/a.MP4')
  assert.ok(r.ok && r.mimeType === 'video/mp4' && r.normalizedUrl.startsWith('https://'))
}

// ── 非 https(含 javascript: / data: / file: 等危险伪协议)─────────────────────
for (const url of [
  'http://cdn.example.com/a.mp4',
  'ftp://cdn.example.com/a.mp4',
  'file:///etc/passwd',
  'javascript:alert(1)//a.mp4',
  'data:video/mp4;base64,AAAA',
  'blob:https://cdn.example.com/a.mp4',
]) {
  const r = validateExternalVideoUrl(url)
  assert.equal(r.ok, false, `expected reject for ${url}`)
}

// ── 私网 / 回环 / 内网域名(SSRF 防护)────────────────────────────────────────
for (const url of [
  'https://localhost/a.mp4',
  'https://127.0.0.1/a.mp4',
  'https://10.0.0.5/a.mp4',
  'https://172.16.0.1/a.mp4',
  'https://172.31.255.255/a.mp4',
  'https://192.168.1.100/a.mp4',
  'https://169.254.169.254/a.mp4', // 云元数据
  'https://[::1]/a.mp4',
  'https://[fe80::1]/a.mp4',
  'https://[fd00::1]/a.mp4',
  'https://intranet/a.mp4', // 单标签内网短名
  'https://nas.local/a.mp4',
  'https://server.internal/a.mp4',
]) {
  const r = validateExternalVideoUrl(url)
  assert.equal(r.ok, false, `expected private-host reject for ${url}`)
  assert.ok(!r.ok && r.code === 'EXTERNAL_VIDEO_URL_PRIVATE_HOST', `unexpected code for ${url}: ${JSON.stringify(r)}`)
}

// 172.32.x 不在私网段,应放行
assert.equal(validateExternalVideoUrl('https://172.32.0.1/a.mp4').ok, true)

// ── 非直链 / iframe / 视频站页面 ────────────────────────────────────────────
for (const url of [
  'https://www.bilibili.com/video/BV1xx', // 页面
  'https://www.youtube.com/watch?v=abc',
  'https://v.douyin.com/abc/',
  'https://cdn.example.com/a.mov', // 不支持的扩展名
  'https://cdn.example.com/a', // 无扩展名
]) {
  const r = validateExternalVideoUrl(url)
  assert.equal(r.ok, false, `expected non-direct reject for ${url}`)
}

// ── 内嵌账号密码 ──────────────────────────────────────────────────────────────
assert.equal(validateExternalVideoUrl('https://user:pass@cdn.example.com/a.mp4').ok, false)

// ── 空 / 超长 ────────────────────────────────────────────────────────────────
assert.equal(validateExternalVideoUrl('').ok, false)
assert.equal(validateExternalVideoUrl('   ').ok, false)
assert.equal(validateExternalVideoUrl(`https://cdn.example.com/${'a'.repeat(2100)}.mp4`).ok, false)

// ── 白名单 ──────────────────────────────────────────────────────────────────
process.env['ALLOWED_EXTERNAL_VIDEO_HOSTS'] = 'cdn.allowed.com, videos.gov.cn'
assert.equal(validateExternalVideoUrl('https://cdn.allowed.com/a.mp4').ok, true)
assert.equal(validateExternalVideoUrl('https://CDN.ALLOWED.COM/a.mp4').ok, true) // host 大小写不敏感
{
  const r = validateExternalVideoUrl('https://cdn.notallowed.com/a.mp4')
  assert.ok(!r.ok && r.code === 'EXTERNAL_VIDEO_URL_HOST_NOT_ALLOWED')
}
delete process.env['ALLOWED_EXTERNAL_VIDEO_HOSTS']
// 白名单移除后恢复放行
assert.equal(validateExternalVideoUrl('https://cdn.notallowed.com/a.mp4').ok, true)

console.log('verify:external-video passed')
