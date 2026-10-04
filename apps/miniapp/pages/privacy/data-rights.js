// pages/privacy/data-rights.js
// 数据权利请求的取值表与列表视图映射。只服务隐私页，不进 utils/。
//
// 取值全部照抄服务端契约，不自造枚举：
//   MemberDataRequestType / MemberDataRequestStatus
//     → services/api/src/member-privacy/member-privacy.types.ts
//   失败码 ExportFailureCode + 排队失败码
//     → services/api/src/member-privacy/member-data-export.service.ts
//       services/api/src/member-privacy/member-data-request.service.ts
//   文案口径对齐 packages/shared/src/types/memberPrivacy.ts（两端共用的诚实文案 SSOT）

const TYPE_LABEL = {
  export: '导出我的数据',
  delete: '账号注销',
  // 服务端 revoke_consent 撤回的是 job_ai 授权；小程序里用它的只有「简历对照」。
  revoke_consent: '撤回简历对照授权',
}

const STATUS_LABEL = {
  pending: '待处理',
  handling: '处理中',
  ready: '可下载',
  completed: '已完成',
  expired: '已过期',
  failed: '处理失败',
  rejected: '已驳回',
  cancelled: '已取消',
}

// 不在表里的码原样展示码值，不替服务端编解释。
const FAILURE_HINT = {
  EXPORT_TOO_LARGE: '数据量超出单次导出上限',
  EXPORT_ARTIFACT_MISSING: '导出件生成失败',
  EXPORT_CLEANUP_FAILED: '导出件清理失败',
  QUEUE_ENQUEUE_FAILED: '导出任务排队失败',
}

const CLOSURE_PENDING_LABEL = '已受理，等待处理'

/**
 * 账号注销说明。与后端执行器实际做的一致（后端窗口 2026-10-04 核对）；保留年限交律师，不写具体年数。
 */
const CLOSURE_NOTES = [
  { k: '会删除', v: '你上传的文件（含扫描件）、AI 生成的结果、模拟面试记录、AI 顾问的会话记录、浏览与收藏、通知。还没用完的权益会作废。' },
  { k: '会保留', v: '订单、打印记录、支付与退款流水、同意记录、意见反馈的处理记录。这些不再关联到你，按法律要求的期限保留。' },
  { k: '手机号', v: '解除绑定。之后用同一个号登录，是一个全新的账号。' },
  { k: '有订单时', v: '有还没取件、退款中或打印中的订单时，要等订单办完才会执行注销。' },
]

// 服务端同一时间只允许一个「进行中」的数据权利请求（activeKey 唯一约束）。
const ACTIVE_STATUS = { pending: true, handling: true }

/**
 * 幂等键。服务端正则要求 UUID 形态（版本位 1-8、variant 位 8/9/a/b），
 * 且全局唯一——同一次提交的重试必须复用同一个 key，换 key 会被当成新请求。
 */
function uuidV4() {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) { out += '-'; continue }
    if (i === 14) { out += '4'; continue }
    const r = Math.floor(Math.random() * 16)
    out += (i === 19) ? hex[(r & 0x3) | 0x8] : hex[r]
  }
  return out
}

function fmtTime(iso) {
  if (!iso) return ''
  return String(iso).slice(0, 16).replace('T', ' ')
}

function statusLabel(status) {
  return STATUS_LABEL[status] || status || ''
}

/** 后端错误已由 request.js 归一成 Error(message, statusCode, code)。码值一并展示，便于排查与对账。 */
function errText(err) {
  if (!err) return '操作失败，请稍后重试'
  const code = err.code ? `（${err.code}）` : ''
  return `${err.message || '操作失败'}${code}`
}

/**
 * 列表响应 → 页面视图。
 * @param {object} page /me/data-requests 的解包结果 { items, nextCursor, capabilities }
 * @returns {{requests:Array, latestExport:object|null, hasActiveRequest:boolean, accountClosureAvailable:boolean}}
 */
function toListView(page) {
  const items = (page && Array.isArray(page.items)) ? page.items : []
  const caps = (page && page.capabilities) || {}

  const requests = items.map((it) => ({
    id: it.id,
    requestType: it.requestType,
    typeLabel: TYPE_LABEL[it.requestType] || it.requestType,
    status: it.status,
    // 注销申请受理后要等管理员核实执行，不是系统在排队：说「已受理，等待处理」
    statusLabel: (it.requestType === 'delete' && it.status === 'pending') ? CLOSURE_PENDING_LABEL : statusLabel(it.status),
    // 只有本人还在待处理的注销申请能撤回（服务端同一判据）
    canCancel: it.requestType === 'delete' && it.status === 'pending',
    requestedAtText: fmtTime(it.requestedAt),
    exportExpiresAtText: fmtTime(it.exportExpiresAt),
    // canDownload 由服务端算（requestType==='export' && status==='ready'），前端不重算。
    canDownload: it.canDownload === true,
    failureText: it.failureCode ? (FAILURE_HINT[it.failureCode] || it.failureCode) : '',
  }))

  return {
    requests,
    latestExport: requests.filter((v) => v.requestType === 'export')[0] || null,
    hasActiveRequest: requests.some((v) => ACTIVE_STATUS[v.status] === true),
    // 轮询只为异步导出；注销申请要等人工处理，可能好几天，不轮询
    hasActiveExport: requests.some((v) => v.requestType === 'export' && ACTIVE_STATUS[v.status] === true),
    // 还在处理中的注销申请（待处理或执行中），页面据此不让重复提交
    activeClosure: requests.filter((v) => v.requestType === 'delete' && ACTIVE_STATUS[v.status] === true)[0] || null,
    // 服务端对「账号注销是否开放」的唯一真话，前端不做任何推断。
    accountClosureAvailable: caps.accountClosureAvailable === true,
  }
}

module.exports = { uuidV4, statusLabel, errText, toListView, CLOSURE_NOTES, CLOSURE_PENDING_LABEL }
