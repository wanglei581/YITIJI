#!/usr/bin/env node
/**
 * verify:terminal-session-self-heal —— 终端会话失效后页面必须能自己恢复。
 *
 * 防的是 2026-09-08 生产实测到的真实故障：
 *   17:10:57  POST /terminals/session-token/refresh → 401（票过期/被吊销）
 *   此后页面永久停在 failed，报价确认页显示「终端安全校验失败，请联系现场工作人员」，
 *   主按钮全灰。原因是引导票**只在启动时从 URL 读一次**，而 URL 上的票由看门狗塞入 ——
 *   于是一体机只能等看门狗重启浏览器才恢复，无人值守时就一直坏着。
 *
 * 修法是让页面自己走看门狗走的那条路：向本机 Agent 桥接要一张新引导票再换会话。
 * 这条门禁同时钉住**恢复能力**与**fail-closed 边界**：桥接令牌缺失时不得放行。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../src/services/terminalAuth.ts'), 'utf8')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`)
}

// ── 一、必须存在向本机 Agent 取引导票的能力 ────────────────────────────────
check(
  '存在 requestLocalBootTicket',
  /async function requestLocalBootTicket\(\): Promise<string \| null>/.test(src),
)
check(
  '取票打到 Agent 的 /local/terminal-boot-ticket（与看门狗同一端点）',
  /\/local\/terminal-boot-ticket/.test(src),
)
check(
  '取票带本地桥接令牌头',
  /'X-Local-Bridge-Token': LOCAL_BRIDGE_TOKEN/.test(src),
)
check(
  '取票校验票面格式后才使用',
  /BOOT_TICKET_PATTERN\.test\(ticket\)/.test(src),
)

// ── 二、fail-closed 边界：没有桥接令牌一律不放行 ──────────────────────────
// 这是本条门禁最重要的一条。普通浏览器（笔记本、手机）打开一体机页面时没有 Agent，
// 必须继续显示「终端安全校验失败」，不得因为新增自愈路径而被绕开。
check(
  '桥接令牌缺失时立即放弃（fail-closed）',
  /if \(!LOCAL_BRIDGE_TOKEN\) return null/.test(src),
)
{
  const fn = src.slice(src.indexOf('async function requestLocalBootTicket'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  const guardAt = body.indexOf('if (!LOCAL_BRIDGE_TOKEN) return null')
  const fetchAt = body.indexOf('fetchWithTimeout')
  check(
    '令牌判空在发起请求之前',
    guardAt > -1 && fetchAt > -1 && guardAt < fetchAt,
    '否则没令牌也会向 127.0.0.1 发请求',
  )
}

// ── 三、刷新失败后必须先尝试重新引导，再 fail-closed ──────────────────────
{
  const fn = src.slice(src.indexOf('async function retryRefreshOnce'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  const healAt = body.indexOf('reBootstrapFromLocalAgent()')
  const failAt = body.indexOf("setState('failed')")
  check(
    '刷新用尽后调用 reBootstrapFromLocalAgent',
    healAt > -1,
    '401 之后没有任何恢复路径，页面会永久卡死',
  )
  check(
    '重新引导排在 setState(failed) 之前',
    healAt > -1 && failAt > -1 && healAt < failAt,
    '排在之后等于先判死再抢救，用户已经看到失败态',
  )
}

// ── 四、冷启动（无 URL 票、无存量票）也要先问 Agent，而不是直接判失败 ────
{
  const fn = src.slice(src.indexOf('async function initializeTerminalSessionOnce'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  const noTokenAt = body.indexOf('if (!token())')
  const healAt = body.indexOf('reBootstrapFromLocalAgent()')
  check(
    '无存量票时尝试重新引导',
    noTokenAt > -1 && healAt > -1 && healAt > noTokenAt,
    '浏览器单独重开、sessionStorage 被清时会直接判死',
  )
}

// ── 五、恢复成功必须置 ready 并重排续期，否则十分钟后再次卡死 ────────────
{
  const fn = src.slice(src.indexOf('async function reBootstrapFromLocalAgent'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  check('恢复成功置为 ready', /setState\('ready'\)/.test(body))
  check('恢复成功重排续期定时器', /scheduleRefresh\(\)/.test(body))
  check(
    '换票失败返回 false 而不是抛出',
    /return false/.test(body),
    '抛出会绕过调用方的 fail-closed 收尾',
  )
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} 项失败`} — 终端会话自愈`)
process.exit(failed.length === 0 ? 0 : 1)
