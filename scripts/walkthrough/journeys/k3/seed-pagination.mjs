// K3 走查 F13：用一体机前端同样调用的公开接口，给测试会员批量产生「我的文档」与「外部跳转足迹」，
// 用来看「我的」各页能否看到第 51 条以后、有没有「加载更多」。不直接写库。
// 接口来源：apps/kiosk/src/services/auth/memberAuthApi.ts（短信登录）、
//           apps/kiosk/src/services/api/uploadSessions.ts（建上传会话 / 手机传文件 / 一体机确认）、
//           apps/kiosk/src/services/api/activity.ts（外部跳转记录）、memberFavorites.ts（收藏）。
// 短信验证码只从走查 API 日志读（[DEV 短信]），不打印。
// 用法：node seed-pagination.mjs [手机号=13800000429] [文档数=62] [足迹数=56] [起始编号=1]
// 上传会话创建接口按来源 IP 限 12 次/分钟（upload-sessions.controller.ts:43），三条走查共用 127.0.0.1，
// 所以这里每 10 秒只建一个，留余量给别的路。
import { readFileSync, statSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { makePdf } from './make-pdf.mjs'

const API = 'http://127.0.0.1:4300/api/v1'
const ROOT = join(homedir(), '.cache/walk0929')
const API_LOG = join(ROOT, 'logs/api.log')
const LEDGER = join(ROOT, 'evidence/k3/ledger.jsonl')
const [phone = '13800000429', nDocs = '62', nJumps = '56', start = '1'] = process.argv.slice(2)
const TERMINAL_ID = 't_09fd272201b6588e'
const nowSh = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace(' ', 'T') + '+08:00'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(path, { method = 'GET', body, token, headers = {}, form } = {}) {
  const h = { Accept: 'application/json', Origin: 'http://127.0.0.1:4310', ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  let payload
  if (form) payload = form
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(API + path, { method, headers: h, body: payload })
  const txt = await res.text()
  let json = null; try { json = JSON.parse(txt) } catch {}
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${txt.slice(0, 200)}`)
  return json?.data ?? json
}

function smsCode(tail, after) {
  const txt = readFileSync(API_LOG).subarray(after).toString('utf8')
  const re = new RegExp(`\\[DEV 短信\\][^\\n]*${tail}[^\\n]*验证码[:：]\\s*(\\d{4,6})`, 'g')
  let m, code = null
  while ((m = re.exec(txt))) code = m[1]
  return code
}

async function login() {
  const terms = await call('/kiosk/legal/terms_of_service')
  const privacy = await call('/kiosk/legal/privacy_policy')
  const after = statSync(API_LOG).size
  await call('/member/auth/sms-code', { method: 'POST', body: { phone } })
  let code = null
  for (let i = 0; i < 30 && !code; i++) { await sleep(400); code = smsCode(phone.slice(-4), after) }
  if (!code) throw new Error('10 秒内日志里没有验证码')
  const r = await call('/member/auth/login', { method: 'POST', body: { phone, code, termsVersion: terms.version, privacyVersion: privacy.version } })
  return r.token ?? r.accessToken
}

async function uploadOne(token, i) {
  const s = await call('/upload-sessions', { method: 'POST', token, body: { purpose: 'print_doc', mode: 'member', channel: 'phone_h5', terminalId: TERMINAL_ID } })
  const form = new FormData()
  form.append('uploadToken', s.uploadToken)
  const name = `k3-page-${String(i).padStart(3, '0')}.pdf`
  form.append('file', new Blob([makePdf(1, `K3 PAGINATION DOC ${i}`)], { type: 'application/pdf' }), name)
  await call(`/upload-sessions/${s.sessionId}/files`, { method: 'POST', form })
  await call(`/upload-sessions/${s.sessionId}/confirm`, { method: 'POST', token, headers: { 'X-Upload-Session-Control': s.controlToken } })
  return name
}

const token = await login()
console.log('登录成功（令牌不打印）')
const report = { phone: phone.slice(0, 3) + '****' + phone.slice(-4), docs: 0, docErrors: [], jumps: 0, jumpErrors: [], favorites: [] }
for (let i = Number(start); i < Number(start) + Number(nDocs); i++) {
  try { await uploadOne(token, i); report.docs++ } catch (e) { report.docErrors.push(`#${i} ${e.message}`); if (report.docErrors.length > 8) break; await sleep(30000) }
  await sleep(10000)
  if (i % 10 === 0) console.log('文档', i)
}
// 外部跳转足迹：对当前在架政策逐条打开来源（服务端不去重）
const policies = await call('/policies?kind=policy_guide')
const ids = (Array.isArray(policies) ? policies : policies.items ?? []).map((p) => p.id)
for (let i = 0; i < Number(nJumps); i++) {
  try { await call('/activity/external-jump', { method: 'POST', token, body: { targetType: 'policy', targetId: ids[i % ids.length], action: 'external_open' } }); report.jumps++ } catch (e) { report.jumpErrors.push(e.message); if (report.jumpErrors.length > 5) break }
}
// 收藏：服务端对 (会员, 类型, 对象) 唯一，且只收在架对象 —— 能收几条就收几条，记录上限
for (const id of ids) {
  try { await call('/me/favorites', { method: 'POST', token, body: { targetType: 'policy', targetId: id } }); report.favorites.push(id) } catch (e) { report.favorites.push('ERR ' + e.message) }
}
const list = await call('/me/documents?pageSize=50', { token })
report.docsFirstPage = (list.items ?? list).length
report.docsTotal = list.total ?? null
report.docsNextCursor = list.nextCursor ?? null
console.log(JSON.stringify(report, null, 1))
appendFileSync(LEDGER, JSON.stringify({ time: nowSh(), 人物: '测试·会员429（脚本）', 手机号: report.phone, 端: '公开接口（一体机前端同款）', 操作: 'F13 批量：上传 PDF 进我的文档 + 外部跳转足迹 + 收藏', 结果: report }) + '\n')
