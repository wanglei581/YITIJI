// §4.3「打印/文件闭环」本地运行期取证脚本。
//
// 这不是 CI 门禁 —— 它需要一套起好的本地后端（见
// docs/reviews/member-closure-runtime-evidence-2026-09-08.md 的「本地环境配方」），
// 用途是在本地把清单 §4.3 里**能在本地证的那几条**跑出可复核的运行期证据。
// 生产域名验收不能用它替代：本地是 SQLite + 本地存储 + AI_PROVIDER=mock。
//
// 跑法（在仓库根，后端已起在 3010）：
//   node apps/kiosk/scripts/probe-file-closure-43.mjs
//
// 每次用一个新手机号登录（绕开同号 60s 冷却），全部请求只打 127.0.0.1。
// §4.3 打印/文件闭环 —— 本地运行期取证（只打本机 127.0.0.1，不碰生产）
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const API = 'http://127.0.0.1:3010/api/v1'
const PHONE = '138' + String(Date.now()).slice(-8)  // 每次换号，绕开 60s 同号冷却
const out = []
const rec = (id, ok, detail) => { out.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`) }
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 200) } } }

// 1) 登录拿会员 token
await fetch(`${API}/member/auth/sms-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
await new Promise(r => setTimeout(r, 600))
const log = readFileSync('/tmp/sweep-api.log', 'utf8')
const codes = [...log.matchAll(/验证码:\s*(\d{6})/g)].map(m => m[1])
const code = codes[codes.length - 1]
if (!code) { console.error('拿不到验证码，终止'); process.exit(2) }
const lr = await j(await fetch(`${API}/member/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE, code, termsVersion: "draft-pending-legal-review", privacyVersion: "draft-pending-legal-review" }) }))
const token = lr?.data?.token
if (!token) { console.error('登录失败:', JSON.stringify(lr).slice(0, 200)); process.exit(2) }
const auth = { Authorization: `Bearer ${token}` }
console.log('会员登录成功\n')

// 2) 上传文件 → 我的文档可见
const pdf = readFileSync('/tmp/sweep-fixtures/valid-2p.pdf')
const fd = new FormData()
fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'closure-43.pdf')
fd.append('purpose', 'print_doc')
const up = await j(await fetch(`${API}/files/kiosk-upload`, { method: 'POST', headers: auth, body: fd }))
const fileId = up?.data?.fileId ?? up?.data?.id
rec('4.3-上传', Boolean(fileId), fileId ? `fileId=${fileId}` : `上传失败 ${JSON.stringify(up).slice(0, 160)}`)
if (!fileId) process.exit(1)

const docs = await j(await fetch(`${API}/me/documents`, { headers: auth }))
const list = docs?.data?.items ?? docs?.data ?? []
const found = Array.isArray(list) && list.some(d => d.id === fileId || d.fileId === fileId)
rec('4.3-我的文档可见', found, `列表 ${Array.isArray(list) ? list.length : '?'} 条，含本次上传=${found}`)

// 3) 预览用短期签名 URL（列表只给 previewUrlPath，签名 URL 按需铸造 —— 比内嵌更短的暴露窗口）
const row = Array.isArray(list) ? list.find(d => (d.id ?? d.fileId) === fileId) : null
let signedOk = false, signedDetail = '列表里没有 previewUrlPath'
let signed = null
if (row?.previewUrlPath) {
  const pr = await j(await fetch(`${API}${row.previewUrlPath}`, { headers: auth }))
  signed = pr?.data?.url ?? pr?.data?.signedUrl ?? null
  const expiresAt = pr?.data?.expiresAt ?? null
  if (signed) {
    const u = new URL(signed, 'http://127.0.0.1:3010')
    const hasSig = u.searchParams.has('sig') || u.searchParams.has('signature') || u.searchParams.has('X-Amz-Signature')
    const ttl = expiresAt ? Date.parse(expiresAt) - Date.now() : null
    signedOk = hasSig && ttl !== null && ttl > 0 && ttl <= 30 * 60 * 1000
    signedDetail = `sig=${hasSig} expiresAt=${expiresAt} TTL=${ttl === null ? '?' : Math.round(ttl / 1000) + 's'}（要求 >0 且 ≤1800s）`
  } else {
    signedDetail = `preview-url 未返回 url：${JSON.stringify(pr).slice(0, 140)}`
  }
}
rec('4.3-预览短期签名URL', signedOk, signedDetail)

// 4) 下载成功（走 download-url 铸的签名链接）
let dlOk = false, dlDetail = '无 downloadUrlPath'
if (row?.downloadUrlPath) {
  const dr = await j(await fetch(`${API}${row.downloadUrlPath}`, { headers: auth }))
  const dUrl = dr?.data?.url ?? dr?.data?.signedUrl ?? null
  if (dUrl) {
    const r = await fetch(new URL(dUrl, 'http://127.0.0.1:3010'))
    const buf = Buffer.from(await r.arrayBuffer())
    dlOk = r.status === 200 && buf.length === pdf.length
    dlDetail = `status=${r.status} 字节 ${buf.length}（原件 ${pdf.length}）content-type=${r.headers.get('content-type')}`
  } else {
    dlDetail = `download-url 未返回 url：${JSON.stringify(dr).slice(0, 140)}`
  }
}
rec('4.3-下载成功', dlOk, dlDetail)

// 4b) 再打印入口：列表必须给出 reprintable
rec('4.3-再打印入口', row?.reprintable === true, `reprintable=${row?.reprintable}`)

// 5) Word 能力为假时必须给出服务端 reason
const cap = await j(await fetch(`${API}/document-conversion/capabilities`))
const c = cap?.data ?? {}
const capOk = c.wordToPdf === false && typeof c.reason === 'string' && c.reason.length > 0
rec('4.3-Word能力诚实', capOk, `wordToPdf=${c.wordToPdf} engine=${c.engine} reason=${JSON.stringify(c.reason)}`)

writeFileSync('/tmp/pkt/probe43-fileid.txt', fileId)
writeFileSync('/tmp/pkt/probe43-token.txt', token)
console.log('\n上传的 fileId 已写入 /tmp/pkt/probe43-fileid.txt')

// 6) 删除后：DB 状态 / 物理文件 / 审计 / 旧签名 URL 失效
const before = signed
const del = await fetch(`${API}/files/${fileId}`, { method: 'DELETE', headers: auth })
rec('4.3-删除请求', del.status >= 200 && del.status < 300, `status=${del.status}`)
await new Promise(r => setTimeout(r, 500))

const q = (sql) => execFileSync('sqlite3', [process.env.SWEEP_DB ?? 'services/api/sweep42.db', sql], { encoding: 'utf8' }).trim()
const dbStatus = q(`SELECT status FROM FileObject WHERE id='${fileId}';`)
rec('4.3-删除后DB状态', dbStatus === 'deleted', `FileObject.status=${dbStatus || '(行已消失)'}`)

const auditCount = q(`SELECT COUNT(*) FROM AuditLog WHERE action='file.delete' AND createdAt > datetime('now','-2 minutes');`)
rec('4.3-删除审计存在', Number(auditCount) > 0, `近 2 分钟 file.delete 审计 ${auditCount} 条`)

const onDisk = execFileSync('sh', ['-c', `find /tmp/sweep-storage -name '*${fileId}*' 2>/dev/null | wc -l`], { encoding: 'utf8' }).trim()
rec('4.3-物理文件已清理', onDisk === '0', `/tmp/sweep-storage 下残留 ${onDisk} 个`)

let staleOk = false, staleDetail = '删除前没拿到签名 URL'
if (before) {
  const r = await fetch(new URL(before, 'http://127.0.0.1:3010'))
  staleOk = r.status >= 400
  staleDetail = `删除前铸的签名 URL 现在 status=${r.status}（要求 ≥400）`
}
rec('4.3-旧签名URL已失效', staleOk, staleDetail)

console.log(`\n小计：${out.filter(o => o.ok).length} PASS / ${out.filter(o => !o.ok).length} FAIL`)
