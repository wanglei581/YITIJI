#!/usr/bin/env node
// ============================================================
// 发布前法务文档预检（部署脚本 3d 步，位于 pg_dump 之前）
//
// 为什么要有（2026-09-29 总指挥裁定 C4 口径）：一体机与小程序的正式版取不到已发布的
// 协议就拦住登录，服务端 LEGAL_DOCS_REQUIRE_PUBLISHED=false 这个应急口对正式版前端
// 不再起作用。所以发布前逐份确认三份法务文档都已激活，缺一份就不发布——失败时线上未动。
//
// 隐私政策另外要有「未满十四周岁」专章（个人信息保护法第三十一条第二款）。自我探索同意页
// 按标题链接这一章，前端认不出就停在开头。标题形状与一体机分章一致：空行分段后的单独一行，
// 30 字以内、句末没有标点，可以带「六、」「第六章」或 Markdown `#`。
//
// 做法：请求线上**正在运行**的 API 的公开接口 GET {base}/kiosk/legal/{type}
// （生产 50483cd 起就有、无鉴权），每份都要返回「已激活且带发布时间、正文非空」的版本。
// 读不到接口同样算失败（fail-closed）；新服务器首装、API 还没跑起来时，由部署脚本的
// DEPLOY_SKIP_LEGAL_DOCS_PREFLIGHT=first-install 显式跳过，本脚本不提供跳过开关。
//
// 用法：node services/api/scripts/preflight-legal-docs.mjs --base-url http://127.0.0.1:3010/api/v1
//       [--timeout-ms 5000]
// 退出码：0 三份都在且隐私政策含专章；1 缺任何一份、专章对不上或读不到；64 参数错误。
// 只打印类型、版本号与发布时间，不打印正文。只用 node 内置模块。
// ============================================================

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 必须与服务端自我探索 consentLinks 的 sectionTitle 逐字相同；律师改标题时两处一起改。
export const MINOR_PRIVACY_SECTION_TITLE = '未满十四周岁未成年人个人信息处理规则'

const REQUIRED_DOCS = [
  { type: 'terms_of_service', label: '用户服务协议' },
  { type: 'privacy_policy', label: '隐私政策' },
  { type: 'ai_disclaimer', label: 'AI 服务免责声明' },
]

// 与 apps/kiosk/src/pages/legal/legalDocModel.ts 的 headingOf 同一套形状（小程序 legal.js 同此）。
// 一体机只认 1～4 级 #；预检不放宽到小程序的 6 级，避免一体机链不到。
const MARKDOWN_HEADING = /^#{1,4}\s+(.+)$/
const ORDINAL_CHAPTER = /^第[一二三四五六七八九十百零〇\d]+[章节条部分]/
const ORDINAL_ENUM = /^[一二三四五六七八九十]+、/
const END_PUNCT = /[。；;，,]$/

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

/** 这一行是不是专章标题（已去掉首尾空白）。Markdown 取 # 后面的文字再判。 */
function isMinorPrivacyHeading(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  const markdown = MARKDOWN_HEADING.exec(trimmed)
  const text = markdown ? markdown[1].trim() : trimmed
  if (!text || text.length > 30 || END_PUNCT.test(text)) return false
  if (!text.includes(MINOR_PRIVACY_SECTION_TITLE)) return false
  if (markdown) return true
  if (text === MINOR_PRIVACY_SECTION_TITLE) return true
  return ORDINAL_CHAPTER.test(text) || ORDINAL_ENUM.test(text)
}

/** 单独成行：前一行与后一行都是空行，或贴着文首 / 文尾。夹在段落里的同一串字不算。 */
function isStandaloneHeadingLine(lines, index) {
  const prevBlank = index === 0 || lines[index - 1].trim() === ''
  const nextBlank = index === lines.length - 1 || lines[index + 1].trim() === ''
  return prevBlank && nextBlank
}

function hasMinorPrivacySection(content) {
  const lines = String(content).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!isStandaloneHeadingLine(lines, i)) continue
    if (isMinorPrivacyHeading(lines[i])) return true
  }
  return false
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
  if (type === 'privacy_policy' && !hasMinorPrivacySection(data.content)) {
    return {
      ok: false,
      detail: `隐私政策里缺少『${MINOR_PRIVACY_SECTION_TITLE}』这一章（或标题被改了字），自我探索同意页会链接不到。请在后台发布带这一章的新版本隐私政策后再发布。`,
    }
  }
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

const invokedDirectly = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`LEGAL DOCS PREFLIGHT FAILED: 预检自身出错（${error?.message ?? error}）`)
    process.exit(1)
  })
}
