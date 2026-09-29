#!/usr/bin/env node
/**
 * 两端「我的」数据对照（next-tasks 2.7 / M-07）：同一个会员，小程序和一体机各自读到的
 * 订单、简历、文档、AI 记录、模拟面试是不是同一份。
 *
 * **不是门禁**：要连一个正在跑的 API 和一个真实会员令牌，所以放 tools/、不进 CI。
 * 两端读哪些接口，照的是各自源码（改了哪一端，这张表跟着改）：
 *   小程序  apps/miniapp/utils/api.js：getMyResumes / getMyDocuments / getMyPrintOrders +
 *           getMyCloudPrintOrders + getPackageOrders / getMyAiRecords / getMyMockInterviews
 *   一体机  apps/kiosk/src/services/api/memberAssets.ts、memberPrintOrders.ts、interview.ts
 *
 * 用法：
 *   node apps/miniapp/tools/cross-end-member-parity.mjs --base http://127.0.0.1:3010/api/v1 --token <会员 JWT>
 *   node apps/miniapp/tools/cross-end-member-parity.mjs --self-test     # 用内置夹具验证比对逻辑本身
 * 退出码：0 两端一致；1 有差异（逐条列出）；2 用法或网络错误。
 */

const DOMAINS = [
  {
    key: 'resumes',
    label: '我的简历',
    miniapp: [{ path: '/me/resumes', id: (r) => r.id || r.taskId }],
    kiosk: [{ path: '/me/resumes', id: (r) => r.id || r.taskId }],
  },
  {
    key: 'documents',
    label: '我的文档',
    miniapp: [{ path: '/me/documents', id: (r) => r.fileId || r.id }],
    kiosk: [{ path: '/me/documents', id: (r) => r.fileId || r.id }],
  },
  {
    key: 'orders',
    label: '打印订单',
    // 小程序三处合在一起看；一体机只读 PrintTask 历史这一处。两套 id：历史列表是 PrintTask id，
    // 云打印列表是 Order id —— 已到机核销的单有 printTaskId，按它对上一体机那一行；
    // 还没核销的单、材料包单只有 Order id，一体机「我的打印订单」里看不到它们，正是要报出来的差异。
    miniapp: [
      { path: '/me/print-orders', id: (r) => r.id },
      { path: '/me/print-orders/cloud', id: (r) => r.printTaskId || r.id, unpaged: true },
      { path: '/orders/package', id: (r) => r.orderId || r.id },
    ],
    kiosk: [{ path: '/me/print-orders', id: (r) => r.id }],
  },
  {
    key: 'aiRecords',
    label: 'AI 服务记录',
    miniapp: [{ path: '/me/ai-records', id: (r) => r.id || r.recordId }],
    kiosk: [{ path: '/me/ai-records', id: (r) => r.id || r.recordId }],
  },
  {
    key: 'interviews',
    label: '模拟面试',
    miniapp: [{ path: '/me/mock-interviews', id: (r) => r.id || r.sessionId }],
    kiosk: [{ path: '/me/mock-interviews', id: (r) => r.id || r.sessionId }],
  },
]

const MAX_PAGES = 20

function itemsOf(body) {
  const data = body && typeof body === 'object' && 'data' in body ? body.data : body
  if (Array.isArray(data)) return { items: data, next: null }
  if (data && Array.isArray(data.items)) return { items: data.items, next: data.nextCursor || null }
  return { items: [], next: null }
}

async function readAll(fetchJson, source) {
  const ids = new Set()
  let cursor = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const q = source.unpaged ? '' : `?pageSize=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const { items, next } = itemsOf(await fetchJson(source.path + q))
    for (const row of items) {
      const id = row && source.id(row)
      if (id) ids.add(String(id))
    }
    if (source.unpaged || !next) break
    cursor = next
  }
  return ids
}

async function side(fetchJson, sources) {
  const all = new Set()
  for (const source of sources) for (const id of await readAll(fetchJson, source)) all.add(id)
  return all
}

/** 比对全部领域。返回 [{ label, miniapp, kiosk, onlyMiniapp[], onlyKiosk[] }]。 */
export async function compare(fetchJson) {
  const rows = []
  for (const d of DOMAINS) {
    const m = await side(fetchJson, d.miniapp)
    const k = await side(fetchJson, d.kiosk)
    rows.push({
      label: d.label,
      miniapp: m.size,
      kiosk: k.size,
      onlyMiniapp: [...m].filter((id) => !k.has(id)),
      onlyKiosk: [...k].filter((id) => !m.has(id)),
    })
  }
  return rows
}

function print(rows) {
  let diff = 0
  console.log('领域          小程序  一体机  结论')
  for (const r of rows) {
    const same = !r.onlyMiniapp.length && !r.onlyKiosk.length
    if (!same) diff += 1
    console.log(`${r.label.padEnd(10, '　')}  ${String(r.miniapp).padStart(4)}  ${String(r.kiosk).padStart(6)}  ${same ? '一致' : '不一致'}`)
    if (r.onlyMiniapp.length) console.log(`    只在小程序看得到：${r.onlyMiniapp.slice(0, 10).join(', ')}${r.onlyMiniapp.length > 10 ? ' …' : ''}`)
    if (r.onlyKiosk.length) console.log(`    只在一体机看得到：${r.onlyKiosk.slice(0, 10).join(', ')}${r.onlyKiosk.length > 10 ? ' …' : ''}`)
  }
  return diff
}

async function selfTest() {
  // 夹具：一张小程序下单、还没到机核销的单（只在 cloud 列表里）+ 一张材料包单；其余两端相同。
  const fixture = {
    '/me/resumes?pageSize=50': { data: { items: [{ id: 'r1' }], nextCursor: null } },
    '/me/documents?pageSize=50': { data: { items: [{ fileId: 'f1' }, { fileId: 'f2' }], nextCursor: null } },
    '/me/print-orders?pageSize=50': { data: { items: [{ id: 't1' }], nextCursor: null } },
    '/me/print-orders/cloud': { data: [{ id: 'o-new' }, { id: 'o-old', printTaskId: 't1' }] },
    '/orders/package?pageSize=50': { data: { items: [{ orderId: 'p1' }], nextCursor: null } },
    '/me/ai-records?pageSize=50': { data: { items: [{ id: 'a1' }], nextCursor: 'c2' } },
    '/me/ai-records?pageSize=50&cursor=c2': { data: { items: [{ id: 'a2' }], nextCursor: null } },
    '/me/mock-interviews?pageSize=50': { data: { items: [], nextCursor: null } },
  }
  const rows = await compare(async (p) => {
    if (!(p in fixture)) throw new Error(`夹具缺 ${p}`)
    return fixture[p]
  })
  const orders = rows.find((r) => r.label === '打印订单')
  const ai = rows.find((r) => r.label === 'AI 服务记录')
  const ok = orders.onlyMiniapp.sort().join(',') === 'o-new,p1' && !orders.onlyKiosk.length && ai.miniapp === 2 && ai.kiosk === 2
  print(rows)
  console.log(ok ? '\nSELF-TEST PASS：翻页读全、订单差异按预期报出' : '\nSELF-TEST FAIL')
  return ok ? 0 : 1
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--self-test')) return selfTest()
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
  const base = (arg('--base') || process.env.PARITY_API_BASE || '').replace(/\/+$/, '')
  const token = arg('--token') || process.env.MEMBER_TOKEN || ''
  if (!base || !token) {
    console.error('用法：--base <API 前缀，如 http://127.0.0.1:3010/api/v1> --token <会员 JWT>（或 PARITY_API_BASE / MEMBER_TOKEN）')
    return 2
  }
  const fetchJson = async (p) => {
    const res = await fetch(base + p, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`)
    return res.json()
  }
  try {
    return print(await compare(fetchJson)) ? 1 : 0
  } catch (e) {
    console.error(`读取失败：${e.message}`)
    return 2
  }
}

main().then((code) => { process.exitCode = code })
