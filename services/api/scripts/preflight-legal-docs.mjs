#!/usr/bin/env node
// ============================================================
// 发布前法务文档预检（部署脚本 3d 步，位于 pg_dump 之前）
//
// 为什么要有（2026-09-29 总指挥裁定 C4 口径）：一体机与小程序的正式版取不到已发布的
// 协议就拦住登录，服务端 LEGAL_DOCS_REQUIRE_PUBLISHED=false 这个应急口对正式版前端
// 不再起作用。所以发布前逐份确认三份法务文档都已激活，缺一份就不发布——失败时线上未动。
//
// 做法：请求线上**正在运行**的 API 的公开接口 GET {base}/kiosk/legal/{type}
// （生产 50483cd 起就有、无鉴权），每份都要返回「已激活且带发布时间、正文非空」的版本。
// 读不到接口同样算失败（fail-closed）；新服务器首装、API 还没跑起来时，由部署脚本的
// DEPLOY_SKIP_LEGAL_DOCS_PREFLIGHT=first-install 显式跳过，本脚本不提供跳过开关。
//
// 用法：node services/api/scripts/preflight-legal-docs.mjs --base-url http://127.0.0.1:3010/api/v1
//       [--timeout-ms 5000]
// 退出码：0 三份都在；1 缺任何一份或读不到；64 参数错误。
// 只打印类型、版本号与发布时间，不打印正文。只用 node 内置模块。
// ============================================================

const REQUIRED_DOCS = [
  { type: 'terms_of_service', label: '用户服务协议' },
  { type: 'privacy_policy', label: '隐私政策' },
  { type: 'ai_disclaimer', label: 'AI 服务免责声明' },
]

function parseArgs(argv) {
  const out = { baseUrl: '', timeoutMs: 5000 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--base-url') out.baseUrl = argv[++i] ?? ''
    else if (arg === '--timeout-ms') out.timeoutMs = Number(argv[++i])
    else return null
  }
  if (!/^https?:\/\//.test(out.baseUrl) || !Number.isFinite(out.timeoutMs) || out.timeoutMs <= 0) return null
  out.baseUrl = out.baseUrl.replace(/\/+$/, '')
  return out
}

/** 一份文档的判定；返回 { ok, detail }，detail 不含正文。 */
async function checkDoc(baseUrl, type, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${baseUrl}/kiosk/legal/${type}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (error) {
    return { ok: false, detail: `读不到线上 API（${error?.name === 'AbortError' ? `${timeoutMs}ms 超时` : error?.cause?.code ?? error?.message ?? '网络错误'}）` }
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) return { ok: false, detail: `接口返回 HTTP ${res.status}` }
  let body
  try {
    body = await res.json()
  } catch {
    return { ok: false, detail: '接口返回的不是 JSON' }
  }
  if (!body || body.success !== true) return { ok: false, detail: '接口没有返回成功' }
  const data = body.data
  if (data == null) return { ok: false, detail: '没有已激活的版本' }
  const version = typeof data.version === 'string' ? data.version.trim() : ''
  const publishedAt = typeof data.publishedAt === 'string' ? data.publishedAt : ''
  const hasContent = typeof data.content === 'string' && data.content.trim().length > 0
  if (!version || !publishedAt || !hasContent) return { ok: false, detail: '已激活的版本信息不完整（版本号、发布时间或正文缺失）' }
  return { ok: true, detail: `版本 ${version}（发布于 ${publishedAt}）` }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error('用法：node services/api/scripts/preflight-legal-docs.mjs --base-url http(s)://…/api/v1 [--timeout-ms 5000]')
    process.exit(64)
  }
  const missing = []
  for (const doc of REQUIRED_DOCS) {
    const result = await checkDoc(args.baseUrl, doc.type, args.timeoutMs)
    if (result.ok) console.log(`OK  ${doc.label}：${result.detail}`)
    else {
      console.log(`缺  ${doc.label}：${result.detail}`)
      missing.push(doc.label)
    }
  }
  if (missing.length > 0) {
    console.error(`LEGAL DOCS PREFLIGHT FAILED: ${missing.join('、')}。先在后台「法务文档版本」新增并激活，再发布。`)
    process.exit(1)
  }
  console.log(`LEGAL DOCS PREFLIGHT OK: ${REQUIRED_DOCS.length} docs`)
}

main().catch((error) => {
  console.error(`LEGAL DOCS PREFLIGHT FAILED: 预检自身出错（${error?.message ?? error}）`)
  process.exit(1)
})
