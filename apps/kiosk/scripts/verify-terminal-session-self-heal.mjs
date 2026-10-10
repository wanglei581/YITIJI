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

// ── 六、换回来的新票必须真的被发出去 ──────────────────────────────────────
// 前五节保证「能换到新票」，这一节保证「换到的票真的用上」。缺了这一节，恢复只是表面的：
// 票换成功、state 置 ready，请求却仍带着换掉的旧票，服务端照样 401，屏幕上还是那句
// 「终端安全校验失败，请联系现场工作人员」。
//
// 这两条同时也是浏览器用例的可观察性前提。2026-09-13 之前 token() 把 E2E mock 排在最前面
// 短路返回，E2E 构建里它恒为同一个固定值 —— 于是 fusion-w2-print 的两条续期窗口用例
// 无论 headers() 组在等待之前还是之后都拿到同样的头，顺序缺陷被原样盖住。
{
  const fn = src.slice(src.indexOf('function token(): string | null'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  const storageAt = body.indexOf('sessionStorage.getItem(STORAGE_KEY)')
  const mockAt = body.indexOf('HAS_E2E_MOCK_TOKEN')
  check(
    'token() 读 sessionStorage 里的当前票',
    storageAt > -1,
    '不读存量票就读不到续期刚写进去的新票',
  )
  check(
    'E2E mock 票只作兜底初始票，排在 sessionStorage 之后',
    storageAt > -1 && (mockAt === -1 || mockAt > storageAt),
    'mock 短路排在前面时 token() 恒返回固定值：换票后仍发旧票，且浏览器用例观察不到任何差异',
  )
}
{
  const fn = src.slice(src.indexOf('export async function terminalProtectedFetch'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  const awaitAt = body.indexOf('await awaitReadySessionOrFailClosed()')
  const headersAt = body.indexOf('headers(init.headers)')
  check(
    '业务请求先等会话闸门，再组 headers',
    awaitAt > -1 && headersAt > -1 && awaitAt < headersAt,
    'headers 排在 await 之前会把刚被换掉的旧票发出去：等到了也没用',
  )
}

// ── 七、failed 不是终点：判死之后后台每分钟再试，网关 5xx 算可重试 ──────────
// 防的是 2026-10-10 走查实测到的故障：开机换票那一下撞上一次网关 503（不带业务错误码），
// 一次就判 failed，此后 4 分半不恢复，整页重开才好。读码还更宽：十分钟续期撞上服务器重启
// 同样一去不回 —— 每次发布都可能让某台机器一直打不了，而现场没有人。
// 行为由 scripts/tests/terminal-session-background-recovery.test.mjs 真跑（同一条 verify 命令里），
// 这里只钉结构，免得那几条被改成「测试还在、路已经断了」。
{
  const transientBody = src.match(/function transient\(error: unknown\): boolean \{([\s\S]*?)\n\}/)?.[1] ?? ''
  check(
    '网关 502 / 503 / 504 算可重试',
    /502/.test(transientBody) && /503/.test(transientBody) && /504/.test(transientBody),
    '后端重启那几十秒里网关回的就是这三个',
  )
  check('可重试判定里没有 401', !/401/.test(transientBody), '作废的票重试不会变好')
}
{
  const fn = src.slice(src.indexOf('function setState(next: TerminalSessionState): void'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  check(
    '每次落到 failed 都排后台恢复',
    /if \(next === 'failed'\) \{[\s\S]*?scheduleRecovery\(\)\n  \} else \{/.test(body),
    '排在各个判死分支里迟早会漏一个',
  )
  check('离开 failed 就撤掉后台恢复', /\} else \{\n    cancelRecovery\(\)\n  \}/.test(body))
  check(
    '落到 failed 时撤掉残留的十分钟续期定时器',
    /if \(next === 'failed'\) \{[\s\S]*?window\.clearTimeout\(refreshTimer\); refreshTimer = null[\s\S]*?\} else \{/.test(body),
    '留着它会在恢复中途把状态翻回 checking',
  )
}
{
  const fn = src.slice(src.indexOf('async function recoverInBackground'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  check(
    '后台恢复不把状态改成 checking',
    !/setState\('checking'\)/.test(body),
    'checking 会让闸门去等在飞的续期；恢复期间必须照旧立即拦',
  )
  check('没恢复成且仍是 failed 时排下一轮', /catch \{\s*if \(state === 'failed'\) scheduleRecovery\(\)/.test(body))
  check(
    '后台恢复与 retryRefresh 共用同一把锁',
    /refreshInflight = attempt\.finally\(\(\) => \{ refreshInflight = null \}\)/.test(body),
    '否则恢复在飞时别处的 401 会并发出第二个续期请求',
  )
}
{
  const fn = src.slice(src.indexOf('async function recoverOnce'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  check(
    '续期只在服务端明确判作废时才改走「要新引导票」',
    /if \(!sessionInvalid\(error\)\) return false/.test(body),
    '服务器只是没回来就去换新会话，会把这一位办到一半的材料清掉',
  )
  check(
    '带引导票打开而没换成的页不拿旧会话票续期',
    /if \(!bootExchangeUnsettled && current && current !== rejectedSessionToken\)/.test(body),
    '否则「换引导票即清场」可以被后台恢复绕开',
  )
}
{
  const fn = src.slice(src.indexOf('async function retryRefreshOnce'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  check(
    '续期主路同样不拿旧会话票（身份恢复回调、按台计请求的 401 都走这里）',
    /for \(const delay of bootExchangeUnsettled \? \[\] : \[0, \.\.\.RETRY_DELAYS_MS\]\)/.test(body),
    '只挡后台恢复一处，身份恢复回调仍能拿旧票续上而不清场',
  )
}
{
  const fn = src.slice(src.indexOf('async function awaitReadySessionOrFailClosed'))
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3)
  check(
    '闸门没变：不是 ready 就抛 TERMINAL_SESSION_INVALID',
    /if \(state !== 'ready'\) throw new ApiHttpError\('TERMINAL_SESSION_INVALID'/.test(body),
  )
  check('闸门不等后台恢复', !/recover/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')))
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${failed.length === 0 ? '✅ ALL PASS' : `❌ ${failed.length} 项失败`} — 终端会话自愈`)
process.exit(failed.length === 0 ? 0 : 1)
