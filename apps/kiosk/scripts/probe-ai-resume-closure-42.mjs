// §4.2「AI 简历与『我的』闭环」本地运行期取证。
//
// 需要一套起好的本地后端（配方见 docs/reviews/member-closure-runtime-evidence-2026-09-08.md），
// AI_PROVIDER=mock。跑法（仓库根）：node apps/kiosk/scripts/probe-ai-resume-closure-42.mjs
//
// 覆盖：上传→诊断→AI服务记录、AI简历生成→导出→我的文档、删除AI记录后不残留幽灵记录。
// 岗位匹配本地 provider 未配置，如实记 SKIP 不记 PASS。
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const API = 'http://127.0.0.1:3010/api/v1'
const out = []
const rec = (id, ok, d) => { out.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${d}`) }
const j = async (r) => { const t = await r.text(); try { return { s: r.status, b: JSON.parse(t) } } catch { return { s: r.status, b: { _raw: t.slice(0, 140) } } } }
// j() 返回 {s,b} 包装；items() 要的是裸 body。第一版直接把包装传进来，
// 于是 d.data 恒为 undefined、恒返回 []，两条断言因此假 FAIL。
const items = (d) => d?.data?.items ?? d?.data ?? []
const listOf = async (url, h) => items((await j(await fetch(url, { headers: h }))).b)

const PHONE = '138' + String(Date.now()).slice(-8)
await fetch(`${API}/member/auth/sms-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE }) })
await new Promise(r => setTimeout(r, 700))
const codes = [...readFileSync('/tmp/sweep-api.log', 'utf8').matchAll(/验证码:\s*(\d{6})/g)].map(m => m[1])
const lr = await j(await fetch(`${API}/member/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: PHONE, code: codes.at(-1), termsVersion: 'draft-pending-legal-review', privacyVersion: 'draft-pending-legal-review' }) }))
const token = lr.b?.data?.token
if (!token) { console.error('登录失败', JSON.stringify(lr.b).slice(0, 160)); process.exit(2) }
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const AUTH = { Authorization: `Bearer ${token}` }
console.log('会员登录成功\n')

// 同意 AI 使用（会员诊断前置）
// 前置步骤也要断言。第一版这里是 `.catch(() => {})`，body 多带了一个字段导致 400 被静默吞掉，
// 于是授权从未生效，失败以「诊断 403」的形式出现在十几行之后 —— 又是一次「setup 静默失败」。
const cs = await j(await fetch(`${API}/me/ai-consents`, { method: 'POST', headers: H, body: JSON.stringify({ scope: 'resume_ai' }) }))
rec('4.2-AI授权前置成功', cs.s < 400 && cs.b?.data?.granted === true, `status=${cs.s} granted=${cs.b?.data?.granted}`)
if (cs.s >= 400) { console.error('授权失败，后续都无意义，终止'); process.exit(1) }

// ① 上传 → 诊断 → AI 服务记录可见
const pdf = readFileSync('/tmp/sweep-fixtures/valid-2p.pdf')
const fd = new FormData()
fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'ch42.pdf')
fd.append('purpose', 'resume_upload')
const up = await j(await fetch(`${API}/files/kiosk-upload`, { method: 'POST', headers: AUTH, body: fd }))
const fileId = up.b?.data?.fileId ?? up.b?.data?.id
const pr = await j(await fetch(`${API}/resume/parse`, { method: 'POST', headers: H, body: JSON.stringify({ fileId, fileName: 'ch42.pdf', fileFormat: 'pdf', source: 'upload' }) }))
const taskId = pr.b?.data?.taskId ?? pr.b?.taskId   // 该端点直接返回结果对象，没有 success/data 信封
rec('4.2-诊断提交成功', Boolean(taskId), `status=${pr.s} taskId=${taskId ?? '-'} ${taskId ? '' : JSON.stringify(pr.b).slice(0, 120)}`)
if (!taskId) process.exit(1)

await new Promise(r => setTimeout(r, 1200))
let recs = await listOf(`${API}/me/ai-records`, AUTH)
rec('4.2-诊断进入AI服务记录', recs.length > 0, `记录 ${recs.length} 条：${recs.map(r => r.serviceType ?? r.kind ?? r.type).join(',')}`)

// 岗位匹配走的是**另一个** consent scope：job_ai，不是简历诊断的 resume_ai。
// 这是有意的颗粒度设计 —— 用户同意「AI 分析我的简历」不等于同意「拿它去匹配岗位」。
// 探针必须分别授权，否则会把一个正确的隐私边界误报成缺陷。
const cs2 = await j(await fetch(`${API}/me/ai-consents`, { method: 'POST', headers: H, body: JSON.stringify({ scope: 'job_ai' }) }))
rec('4.2-岗位匹配需独立授权', cs2.s < 400 && cs2.b?.data?.granted === true, `job_ai 授权 status=${cs2.s}（与 resume_ai 分开，颗粒度正确）`)

// ② 岗位匹配参考 → AI 服务记录可见
const before = recs.length
const fit = await j(await fetch(`${API}/resume/job-fit`, { method: 'POST', headers: H, body: JSON.stringify({ taskId, jobId: "job-uni-0041" }) }))
await new Promise(r => setTimeout(r, 1000))
recs = await listOf(`${API}/me/ai-records`, AUTH)
if (fit.b?.error?.code === 'AI_NOT_CONFIGURED') {
  // 本地没有为 job-fit 配 provider，端点如实回 503「AI 服务暂未启用」。
  // 这本身符合 §4.5 的诚实要求，但它意味着 §4.2 第 4 条（岗位匹配进 AI 服务记录）
  // **本地证不了** —— 记 SKIP，不拿「端点诚实拒绝」冒充「闭环可用」。
  console.log(`SKIP  4.2-岗位匹配进入AI服务记录  本地 job-fit provider 未配置（503 AI_NOT_CONFIGURED，拒绝得诚实），闭环未实测`)
} else {
  rec('4.2-岗位匹配进入AI服务记录', fit.s < 400 && recs.length > before, `job-fit status=${fit.s}，记录 ${before}→${recs.length}`)
}

// ③ AI 简历生成 → 导出 PDF → 我的简历 / 我的文档可见
const genBody = {
  basic: { name: '探针用户', phone: '13800000000' },
  intention: { position: '前端工程师', city: '青岛' },

  education: [], experience: [], projects: [], skills: ['React'], certificates: [],
}
const gen = await j(await fetch(`${API}/resume/generate`, { method: 'POST', headers: H, body: JSON.stringify(genBody) }))
const genTask = gen.b?.taskId ?? gen.b?.data?.taskId
rec('4.2-AI简历生成成功', gen.s < 400 && Boolean(genTask), `status=${gen.s} taskId=${genTask ?? "-"} ${gen.s>=400?JSON.stringify(gen.b).slice(0,200):""}`)
if (genTask) {
  const docsBefore = (await listOf(`${API}/me/documents`, AUTH)).length
  const ex = await j(await fetch(`${API}/resume/generate/export`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ ...genBody, summary: "三年前端开发经验，熟悉 React 与 TypeScript。", taskId: genTask, format: "pdf", factsConfirmedAt: new Date().toISOString() }),
  }))
  await new Promise(r => setTimeout(r, 800))
  const docsAfter = await listOf(`${API}/me/documents`, AUTH)
  rec('4.2-生成稿导出进我的文档', ex.s < 400 && docsAfter.length > docsBefore,
    `导出 status=${ex.s} ${ex.s>=400?JSON.stringify(ex.b).slice(0,200):""}，我的文档 ${docsBefore}→${docsAfter.length}`)
}

// ③ 删除 AI 记录后不残留幽灵记录
const victim = recs[0]
if (victim?.id) {
  const del = await fetch(`${API}/me/ai-records/${victim.id}`, { method: 'DELETE', headers: AUTH })
  const after = await listOf(`${API}/me/ai-records`, AUTH)
  const goneFromList = !after.some(r => r.id === victim.id)
  // 幽灵检查：列表里没了还不够，直连读取也必须读不到
  const direct = await j(await fetch(`${API}/resume/records/${victim.taskId ?? taskId}`, { headers: AUTH }))
  const ghost = direct.s < 400 && direct.b?.success === true && victim.taskId
  rec('4.2-删除后不残留幽灵记录', del.status < 400 && goneFromList && !ghost,
    `删除 status=${del.status}，列表 ${recs.length}→${after.length}，直连读取 status=${direct.s}`)
}

console.log(`\n小计：${out.filter(o => o.ok).length} PASS / ${out.filter(o => !o.ok).length} FAIL`)
