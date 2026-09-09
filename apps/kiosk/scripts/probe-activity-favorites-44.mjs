// §4.4「岗位收藏 / 浏览与跳转记录」本地运行期取证。
//
// 这不是 CI 门禁 —— 需要一套起好的本地后端（配方见
// docs/reviews/member-closure-runtime-evidence-2026-09-08.md）。
// 跑法（仓库根，后端已起在 3010）：node apps/kiosk/scripts/probe-activity-favorites-44.mjs
//
// 除了「能收藏、能看见、能删」这些功能项，本探针还钉住 CLAUDE.md §10 的合规红线：
// 系统只记录浏览 / 收藏 / 外部跳转，**不记录第三方后续结果**。
import { execFileSync } from 'node:child_process'
const API = 'http://127.0.0.1:3010/api/v1'
const DB = process.env.SWEEP_DB ?? 'services/api/sweep42.db'
const out = []
const rec = (id, ok, detail) => { out.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`) }
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t) } catch { return { _raw: t.slice(0, 160) } } }
const q = (sql) => execFileSync('sqlite3', [DB, sql], { encoding: 'utf8' }).trim()

// 登录（每次换号绕开 60s 同号冷却）
const PHONE = '138' + String(Date.now()).slice(-8)
await fetch(`${API}/member/auth/sms-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
await new Promise(r => setTimeout(r, 600))
const codes = [...(await import('node:fs')).readFileSync('/tmp/sweep-api.log', 'utf8').matchAll(/验证码:\s*(\d{6})/g)].map(m => m[1])
const lr = await j(await fetch(`${API}/member/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: PHONE, code: codes[codes.length - 1], termsVersion: 'draft-pending-legal-review', privacyVersion: 'draft-pending-legal-review' }),
}))
const token = lr?.data?.token
if (!token) { console.error('登录失败:', JSON.stringify(lr).slice(0, 180)); process.exit(2) }
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
console.log('会员登录成功\n')

const JOB = q("SELECT id FROM Job WHERE reviewStatus='approved' AND publishStatus='published' LIMIT 1;") || 'job-001'
const FAIR = q("SELECT id FROM JobFair LIMIT 1;")
// 三类目标（岗位 / 招聘会 / 政策）走同一套 targetType 通道。只测 job 会留下
// 「同代码路径所以应该也行」的推断，而推断不是证据 —— 所以逐类实测。
// 政策：本地夹具 PolicyPost 为 0 行，如实跳过而不是拿合成 id 凑一个 PASS。
const POLICY = q("SELECT id FROM PolicyPost LIMIT 1;")
const items = (d) => d?.data?.items ?? d?.data ?? []

// 1) 收藏岗位 → 我的收藏可见
await fetch(`${API}/me/favorites`, { method: 'POST', headers: H, body: JSON.stringify({ targetType: 'job', targetId: JOB }) })
let fav = items(await j(await fetch(`${API}/me/favorites`, { headers: H })))
rec('4.4-岗位收藏进入我的收藏', fav.some(f => f.targetId === JOB), `收藏 ${fav.length} 条，含 ${JOB}=${fav.some(f => f.targetId === JOB)}`)

// 2) 取消收藏 → 不再可见
await fetch(`${API}/me/favorites/job/${JOB}`, { method: 'DELETE', headers: H })
fav = items(await j(await fetch(`${API}/me/favorites`, { headers: H })))
rec('4.4-取消收藏生效', !fav.some(f => f.targetId === JOB), `剩 ${fav.length} 条`)

// 3) 浏览记录：写入 → 可见 → 可删
await fetch(`${API}/activity/browse`, { method: 'POST', headers: H, body: JSON.stringify({ targetType: 'job', targetId: JOB, targetTitle: '探针岗位', sourceName: '青岛市公共就业服务中心', externalId: 'EXT-probe' }) })
let logs = items(await j(await fetch(`${API}/me/browse-logs`, { headers: H })))
const bl = logs.find(l => l.targetId === JOB)
rec('4.4-浏览记录可见', Boolean(bl), `浏览记录 ${logs.length} 条`)
if (bl) {
  await fetch(`${API}/me/browse-logs/${bl.id}`, { method: 'DELETE', headers: H })
  logs = items(await j(await fetch(`${API}/me/browse-logs`, { headers: H })))
  rec('4.4-浏览记录可删除', !logs.some(l => l.id === bl.id), `删后剩 ${logs.length} 条`)
}

// 4) 外部跳转记录：写入 → 可见 → 可删
await fetch(`${API}/activity/external-jump`, { method: 'POST', headers: H, body: JSON.stringify({ targetType: 'job', targetId: JOB, action: 'external_apply', targetTitle: '探针岗位', sourceName: '青岛市公共就业服务中心', sourceUrl: 'https://example.invalid/apply', externalId: 'EXT-probe' }) })
let jumps = items(await j(await fetch(`${API}/me/external-jump-logs`, { headers: H })))
const jl = jumps.find(l => l.targetId === JOB)
rec('4.4-跳转记录可见', Boolean(jl), `跳转记录 ${jumps.length} 条 action=${jl?.action}`)
if (jl) {
  await fetch(`${API}/me/external-jump-logs/${jl.id}`, { method: 'DELETE', headers: H })
  jumps = items(await j(await fetch(`${API}/me/external-jump-logs`, { headers: H })))
  rec('4.4-跳转记录可删除', !jumps.some(l => l.id === jl.id), `删后剩 ${jumps.length} 条`)
}

// 4b) 招聘会 / 政策：同一通道逐类实测，不做「同代码路径」的推断
for (const [label, type, id, action] of [
  ['招聘会', 'job_fair', FAIR, 'external_appointment'],
  ['政策', 'policy', POLICY, 'external_open'],
]) {
  if (!id) { console.log(`SKIP  4.4-${label}收藏与记录  本地夹具 0 行，未实测（不按 PASS 记）`); continue }
  await fetch(`${API}/me/favorites`, { method: 'POST', headers: H, body: JSON.stringify({ targetType: type, targetId: id }) })
  const f = items(await j(await fetch(`${API}/me/favorites`, { headers: H })))
  rec(`4.4-${label}收藏进入我的收藏`, f.some(x => x.targetId === id), `收藏 ${f.length} 条，含 ${id}`)
  await fetch(`${API}/me/favorites/${type}/${id}`, { method: 'DELETE', headers: H })

  await fetch(`${API}/activity/browse`, { method: 'POST', headers: H, body: JSON.stringify({ targetType: type, targetId: id, targetTitle: `探针${label}`, sourceName: '青岛市公共就业服务中心', externalId: 'EXT-probe' }) })
  const bs = items(await j(await fetch(`${API}/me/browse-logs`, { headers: H })))
  const b2 = bs.find(l => l.targetId === id)
  rec(`4.4-${label}浏览记录可见`, Boolean(b2), `浏览记录 ${bs.length} 条`)
  if (b2) await fetch(`${API}/me/browse-logs/${b2.id}`, { method: 'DELETE', headers: H })

  await fetch(`${API}/activity/external-jump`, { method: 'POST', headers: H, body: JSON.stringify({ targetType: type, targetId: id, action, targetTitle: `探针${label}`, sourceName: '青岛市公共就业服务中心', sourceUrl: 'https://example.invalid/entry', externalId: 'EXT-probe' }) })
  const js2 = items(await j(await fetch(`${API}/me/external-jump-logs`, { headers: H })))
  const j2 = js2.find(l => l.targetId === id)
  rec(`4.4-${label}跳转记录可见`, Boolean(j2), `跳转记录 ${js2.length} 条 action=${j2?.action}`)
  if (j2) await fetch(`${API}/me/external-jump-logs/${j2.id}`, { method: 'DELETE', headers: H })
}

// 5) 合规红线（CLAUDE.md §10）：两张日志表都不得有「第三方后续结果」类字段。
//    这条是本探针最重要的一项 —— 功能坏了会被用户发现，合规越界不会。
const RESULT_LIKE = /(status|result|outcome|stage|applied|interview|offer|hired|progress)/i
for (const t of ['BrowseLog', 'ExternalJumpLog']) {
  const cols = q(`PRAGMA table_info(${t});`).split('\n').map(l => l.split('|')[1]).filter(Boolean)
  const bad = cols.filter(c => RESULT_LIKE.test(c))
  rec(`4.4-${t} 无结果字段`, bad.length === 0, bad.length ? `越界字段：${bad.join(',')}` : `字段 ${cols.length} 个，无结果类：${cols.join(' ')}`)
}

// 6) 跳转 action 的取值必须全是「打开入口」语义，不能记录第三方结果
const src = (await import('node:fs')).readFileSync('services/api/src/activity/activity.types.ts', 'utf8')
const m = src.match(/ActivityJumpAction\s*=\s*([^\n]+)/)
const actions = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : []
const okActions = actions.length > 0 && actions.every(a => /^external_/.test(a)) && !actions.some(a => RESULT_LIKE.test(a))
rec('4.4-跳转action只记打开入口', okActions, actions.join(' / ') || '(未解析到)')

console.log(`\n小计：${out.filter(o => o.ok).length} PASS / ${out.filter(o => !o.ok).length} FAIL`)
process.exit(out.some(o => !o.ok) ? 1 : 0)
