// §4.1「账号与资产」本地取证：手机号登录 / 登出 / 资产区不伪造数量。
//
// 需要起好的本地后端（配方见 docs/reviews/member-closure-runtime-evidence-2026-09-08.md）。
// 跑法（仓库根）：node apps/kiosk/scripts/probe-member-session-41.mjs
//
// 注意本地配额：短信接口有 IP 小时频控。反复跑探针会把它打满，
// 表现为 `SMS_IP_LIMIT`（这是频控在正常工作，不是缺陷）。
// 本地隔离环境可清计数键继续：
//   redis-cli -n 9 --scan --pattern 'member:sms:ip:*' | xargs -r -n1 redis-cli -n 9 DEL
//
// QR 扫码登录、空闲自动退出、忙碌态豁免不在本脚本内 ——
// 前者需真手机与 Terminal Agent，后两者是浏览器侧行为，见同目录的 Playwright 用例。
import { readFileSync } from 'node:fs'
const API = 'http://127.0.0.1:3010/api/v1'
const out = []
const rec = (id, ok, d) => { out.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${d}`) }
const j = async (r) => { const t = await r.text(); try { return { s: r.status, b: JSON.parse(t) } } catch { return { s: r.status, b: { _raw: t.slice(0, 140) } } } }

const PHONE = '138' + String(Date.now()).slice(-8)
await fetch(`${API}/member/auth/sms-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
// 按**本次的手机号**从日志里取码，不要 at(-1)。
// 日志是全局共享的：并行探针 / 上一轮残留都会往里写，取最后一条经常拿到别人的码，
// 表现为莫名其妙的 401 —— 症状像「登录坏了」，实际是探针取错了值。
// 掩码格式：138****7018（前 3 位 + 后 4 位）。
const mask = `${PHONE.slice(0, 3)}****${PHONE.slice(-4)}`
let code = null
for (let i = 0; i < 20 && !code; i += 1) {
  await new Promise(r => setTimeout(r, 250))
  const lines = readFileSync('/tmp/sweep-api.log', 'utf8').split('\n').filter(l => l.includes(mask))
  const m = lines.at(-1)?.match(/验证码:\s*(\d{6})/)
  if (m) code = m[1]
}
if (!code) { console.error(`日志里找不到 ${mask} 的验证码`); process.exit(2) }

// ① 手机号登录成功
const lr = await j(await fetch(`${API}/member/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: PHONE, code, termsVersion: 'draft-pending-legal-review', privacyVersion: 'draft-pending-legal-review' }),
}))
const token = lr.b?.data?.token
rec('4.1-手机号登录成功', lr.s < 400 && Boolean(token), `status=${lr.s} 拿到 token=${Boolean(token)}`)
if (!token) process.exit(1)
const AUTH = { Authorization: `Bearer ${token}` }

// ② 登录态确实能读到本人资产（否则「登出后读不到」就没有对照意义）
const before = await j(await fetch(`${API}/me/documents`, { headers: AUTH }))
rec('4.1-登录态可读本人资产', before.s < 400 && before.b?.success === true, `GET /me/documents status=${before.s}`)

// ③ 一次性验证码不可重放
const replay = await j(await fetch(`${API}/member/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: PHONE, code, termsVersion: 'draft-pending-legal-review', privacyVersion: 'draft-pending-legal-review' }),
}))
rec('4.1-验证码不可重放', replay.s >= 400, `重放同一验证码 status=${replay.s} code=${replay.b?.error?.code ?? '-'}`)

// ④ 登出成功，且登出后旧 token 立即失效
const lo = await j(await fetch(`${API}/member/auth/logout`, { method: 'POST', headers: AUTH }))
const after = await j(await fetch(`${API}/me/documents`, { headers: AUTH }))
rec('4.1-登出后旧token失效', lo.s < 400 && after.s >= 400,
  `logout status=${lo.s}，登出后 GET /me/documents status=${after.s}（必须 ≥400）`)

// ⑤ 资产区不伪造数量：未登录时不得出现具体条数
const anon = await j(await fetch(`${API}/me/documents`))
const leaks = JSON.stringify(anon.b).match(/"total":\s*\d+|"count":\s*\d+/g) ?? []
rec('4.1-未登录不返回数量', anon.s >= 400 && leaks.length === 0,
  `未登录 status=${anon.s}，响应里的计数字段 ${leaks.length} 个${leaks.length ? '：' + leaks.join(',') : ''}`)

console.log(`\n小计：${out.filter(o => o.ok).length} PASS / ${out.filter(o => !o.ok).length} FAIL`)
process.exit(out.some(o => !o.ok) ? 1 : 0)
