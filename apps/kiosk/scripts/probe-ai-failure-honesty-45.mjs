// §4.5「AI / 外部服务」本地取证：**外部服务失败时诚不诚实**。
//
// 清单 4.5 每条都有两半：「真实调用成功」和「失败时诚实」。
// 前一半需要真 LLM/OCR 密钥，本地做不到；**后一半本地做得到，而且它才是安全关键的一半**
// —— 调用成功了用户自己看得见，伪造成功了没有人看得见。
//
// 这个探针必须在**两种配置下各跑一次**才有意义：
//   A) 故意让 provider 失败（AI_PROVIDER=openai + 假密钥）→ 三条「失败诚实」断言必须 PASS
//   B) 换回可用 provider（AI_PROVIDER=mock）        → 同样三条必须 FAIL
// B 是阳性对照。只跑 A 的话，一个恒真断言也会全绿 —— 今天已经在本仓库抓到三条这种断言。
//
// 跑法（仓库根，后端已按上述配置起在 3010）：
//   node apps/kiosk/scripts/probe-ai-failure-honesty-45.mjs
import { execFileSync } from 'node:child_process'
const API = 'http://127.0.0.1:3010/api/v1'
const DB = 'services/api/sweep42.db'
const out = []
const rec = (id, ok, d) => { out.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${d}`) }
const j = async (r) => { const t = await r.text(); try { return { s: r.status, b: JSON.parse(t) } } catch { return { s: r.status, b: { _raw: t.slice(0, 150) } } } }
const q = (s) => execFileSync('sqlite3', [DB, s], { encoding: 'utf8' }).trim()

// 只数「AI 流水线产出的文件」。探针自己为了拿 fileId 上传的那份原件 createdBy 为空，
// 不能算进来 —— 否则断言会把探针自己的动作当成「伪造结果」。
const AIFILES = "SELECT COUNT(*) FROM FileObject WHERE createdBy LIKE 'ai_%';"
const before = { ai: q('SELECT COUNT(*) FROM AiResumeResult;'), file: q(AIFILES) }

// 1) LLM 失败必须诚实报错，不能返回伪造的诊断结果
//    先真上传一份 PDF 拿 fileId —— 用假 body 会被 DTO 校验挡在 LLM 之前，
//    那样测到的是 VALIDATION_FAILED，不是「LLM 失败时诚不诚实」。
const pdf = (await import('node:fs')).readFileSync('/tmp/sweep-fixtures/valid-2p.pdf')
const fd = new FormData()
fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'probe45.pdf')
fd.append('purpose', 'resume_upload')
const up = await j(await fetch(`${API}/files/kiosk-upload`, { method: 'POST', body: fd }))
const fileId = up.b?.data?.fileId ?? up.b?.data?.id
if (!fileId) { console.error('上传失败，无法继续:', JSON.stringify(up.b).slice(0, 160)); process.exit(2) }

const r = await j(await fetch(`${API}/resume/parse`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId, fileName: 'probe45.pdf', fileFormat: 'pdf', source: 'upload' }),
}))
// 解析可能是异步的：HTTP 成功但 status 为 failed 也算诚实，只要没有伪造正文。
const data = r.b?.data ?? {}
const statusField = String(data.status ?? '')
// 收紧：VALIDATION_FAILED 说明请求被 DTO 挡在 LLM 之前，测到的不是「LLM 失败时诚不诚实」。
// 不排除它的话，一个写错的探针会永远 PASS —— 那正是「断言恒真」的另一种长相。
const code = r.b?.error?.code ?? ''
const reachedLlm = code !== 'VALIDATION_FAILED'
const httpHonest = r.s >= 400 && r.b?.success === false && typeof code === 'string' && code.length > 0 && reachedLlm
const asyncHonest = r.s < 400 && /fail|error/i.test(statusField)
const fabricated = r.s < 400 && /success|completed/i.test(statusField)
rec('4.5-LLM失败诚实报错', (httpHonest || asyncHonest) && !fabricated,
  `status=${r.s} 业务status=${statusField || '-'} code=${code || '-'}${reachedLlm ? '' : '（请求没到 LLM，不算数）'}`)
const taskId = data.taskId ?? null

// 2) 失败后不得写入假结果（§4.5 第 4 条：外部服务失败不伪造成功、不写入假结果）
await new Promise(x => setTimeout(x, 800))
const after = { ai: q('SELECT COUNT(*) FROM AiResumeResult;'), file: q(AIFILES) }
// 两个坑都踩过，写在这里免得重犯：
//  ① status 词表里没有 'success'，只有 'completed' —— 按 'success' 过滤永远是 0，断言恒真。
//  ② createdAt 存的是 ISO（2026-09-08T10:51:41.250+00:00），datetime('now') 出的是
//     '2026-09-08 12:36:44'。字符串比较里 'T'(0x54) > ' '(0x20)，于是**每一行都命中**，
//     时间过滤等于没写。
// 所以不靠 SQL 时间过滤，直接用前后计数差 —— 它不依赖任何格式假设。
const newRowCount = Number(after.ai) - Number(before.ai)
const newFileCount = Number(after.file) - Number(before.file)
const statuses = q("SELECT DISTINCT status FROM AiResumeResult;").split('\n').filter(Boolean)
rec('4.5-失败不写假结果', newRowCount === 0 && newFileCount === 0,
  `AI 结果行 ${before.ai}→${after.ai}（新增 ${newRowCount}），AI 产出文件 ${before.file}→${after.file}（新增 ${newFileCount}）；当前 status 词表=[${statuses.join(',')}]`)

// 3) AiServiceLog 必须如实记 failed，不能记成 success
const lastLog = q("SELECT operation||'/'||status||'/'||COALESCE(errorCode,'-') FROM AiServiceLog ORDER BY createdAt DESC LIMIT 1;")
rec('4.5-服务日志如实记失败', /\/(failed|error)\//i.test(lastLog) || lastLog === '', `最近一条：${lastLog || '(无新日志)'}`)

// 4) ASR/TTS 能力如实上报（不可用就说不可用）
const v = await j(await fetch(`${API}/mock-interviews/capabilities/voice`))
const vok = v.b?.data && v.b.data.asrEnabled === false && v.b.data.ttsEnabled === false
rec('4.5-语音能力如实上报', vok, `asrEnabled=${v.b?.data?.asrEnabled} ttsEnabled=${v.b?.data?.ttsEnabled}（本机未配置，必须为 false）`)

// 5) 语音不可用时文字兜底仍可用 —— AI 是加速器不是前置条件
const mi = await j(await fetch(`${API}/mock-interviews`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetJob: '前端工程师', scene: 'campus' }),
}))
const textFallback = mi.s !== 404 && mi.s !== 501
rec('4.5-语音关闭不阻断文字路径', textFallback, `创建会话 status=${mi.s}（不能因为 ASR/TTS 关闭就 404/501）`)

console.log(`\n小计：${out.filter(o => o.ok).length} PASS / ${out.filter(o => !o.ok).length} FAIL`)
