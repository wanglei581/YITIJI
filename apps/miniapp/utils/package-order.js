// utils/package-order.js
// 材料包订单的前端口径（纯函数，无 wx 依赖）。
//
// 这个文件取代了 utils/package-feature.js。那个文件只做一件事：在四页 onLoad 首行
// 无条件弹窗 + reLaunch，把整条链硬关掉。它当初是对的 —— 2026-09-08 走查时
// 材料包下完单没有任何界面能再给出 orderId，用户手上只剩一个到机码，而到机码不能
// 反查订单。也就是说那条链的最后一步「找回我的订单」在代码层根本不存在。
//
// 现在缺的那一块补齐了：服务端 `GET /orders/package` 已提供本人材料包订单列表
// （游标分页、visibleCode 判据与详情一致），小程序「打印订单」页已接入它，
// 点进去只带 orderId，由 `package-code` 再向服务端核一次。于是硬关闭的理由消失，
// 关闭方式也换成了**运行期 fail-closed**：
//
//   终端离线            → PRINT_TERMINAL_OFFLINE
//   终端停用 / 不存在   → PRINT_TERMINAL_NOT_ACTIVE / PRINT_TERMINAL_NOT_FOUND
//   隐私检查未完成      → PRINT_PII_SCAN_REQUIRED / PII_SCAN_STALE
//   价目未配置          → PRICE_CONFIG_UNAVAILABLE
//   文件失效 / 非本人   → PRINT_FILE_EXPIRED / PRINT_FILE_NOT_FOUND
//   订单非本人          → PACKAGE_ORDER_NOT_FOUND（连存在性都不泄漏）
//   未登录              → 401
//
// 这些都由服务端说「不行」，前端只负责把它翻译成一句用户能照着做的话。
// 前端**不再**自行判定「这个功能今天能不能用」—— 那种硬编码判断必然与真实运行环境
// 漂移，而漂移的方向恰好是最坏的：关着的时候功能其实好了，开着的时候功能其实坏了。
//
// 同样重要的是本文件**没有**放宽的东西：
//   - 不做任何本地计价。页数与金额一律取服务端 quote / 下单结果（CLAUDE.md §9「不伪造能力」）。
//   - 不把到机码、金额、有效期经 URL 传递；凭证只能来自带登录态的服务端响应。
//   - 不提供在线支付（材料包是到机器后现场付款），因此全链禁止 wx.requestPayment。

/** 服务端 CreatePackageOrderDto 允许进材料包的文件用途（ALLOWED_PURPOSES 同集合）。 */
const PACKAGE_ALLOWED_PURPOSES = ['print_doc', 'resume_upload', 'resume_scan', 'cover_letter']

/** 这些用途服务端会硬性要求先完成打印隐私检查（PII_SCAN_REQUIRED_PURPOSES 的交集）。 */
const PACKAGE_PII_PURPOSES = ['print_doc', 'resume_upload', 'resume_scan']

/** 文件用途的中文标签。未知用途原样回显，不编一个好看的名字。 */
const PURPOSE_LABELS = {
  print_doc: '打印文档',
  resume_upload: '上传简历',
  resume_scan: '扫描简历',
  cover_letter: '求职信',
}

// ── 服务端订单状态的中文标签 ────────────────────────────────────────────
// 取值逐字取自 services/api/prisma/schema.prisma 的 Order 注释与代码里实际写入的字面量。
// **未登记的取值一律原样回显**（见 statusText）：编一个好看的中文比露出英文串更危险 ——
// 那会把一个我们其实没理解的状态说成一个我们理解的状态。
const PICKUP_STATUS_LABELS = {
  none: '未生成到机码',
  pending: '待到机核销',
  claimed: '已核销',
  // used 是**已付款且已交给一体机**之后的状态（pickup-order.service 在释放打印任务的
  // 同一事务里写 pickupStatus:'used' + taskStatus:'pending'）。漏了它会让订单在出纸
  // 阶段被判成终态，从「打印中」筛选里整批消失。
  used: '已交付打印',
  expired: '已过期',
  cancelled: '已取消',
}
const PAY_STATUS_LABELS = {
  unpaid: '未付款',
  paying: '付款中',
  paid: '已付款',
  refunding: '退款中',
  partial_refunded: '部分退款',
  refunded: '已退款',
  closed: '已关单',
  failed: '付款失败',
}
const TASK_STATUS_LABELS = {
  pending: '排队中',
  pending_release: '等待到机释放',
  awaiting_payment: '等待现场付款',
  claimed: '终端已领取',
  printing: '打印中',
  completed: '已完成',
  failed: '打印失败',
  cancelled: '已取消',
  abandoned: '已放弃',
  expired: '已过期',
}

/**
 * 到机使用的真实边界。**必须**在下单前后都出现在用户面前：
 * 小程序这一步只是「组包 + 拿码」，钱是到机器上现场付的，纸是核销后才出的。
 * 不写清楚就等于暗示已经付过款、已经排上队。
 */
const PACKAGE_ONSITE_NOTICE = '材料包在小程序只完成组包与到机码；费用在一体机现场支付，付款并核销后才开始打印。'

/** 材料包目前没有在线取消端点，如实说明未付款订单的归宿，不暗示可以撤单。 */
const PACKAGE_NO_CANCEL_NOTICE = '材料包订单暂不支持在线取消；未付款的订单会在有效期结束后自动失效。'

function parseAmountCents(value) {
  if (value === undefined || value === null || value === '') return null
  const amountCents = Number(value)
  return Number.isSafeInteger(amountCents) && amountCents >= 0 ? amountCents : null
}

/** 分 → 展示串。0 分是真的免费（试运营价目），不是「未知」，两者必须分开。 */
function formatAmount(value) {
  const amountCents = parseAmountCents(value)
  if (amountCents === null) return '待服务端核定'
  if (amountCents === 0) return '免费'
  return '¥' + (amountCents / 100).toFixed(2)
}

/**
 * 有效期展示。服务端下发 ISO 串，直接塞模板会让用户看到 `2026-09-15T10:` 这种半截
 * 技术串；解析失败返回空串（模板里空即不显示该行），绝不把原始串兜底显示出去。
 */
function formatExpireAt(iso) {
  if (!iso) return ''
  const at = new Date(iso)
  if (isNaN(at.getTime())) return ''
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/**
 * 到机码分组显示，每 2 位一组。与 print-pickup / orders 的 formatCode 同形
 * （8 位数字 → `12-34-56-78`）。空白串、数字入参都必须安全：一行数据异常不能中断整页渲染。
 */
function formatPickupCode(raw) {
  if (!raw) return ''
  const value = String(raw).replace(/[\s-]/g, '').toUpperCase()
  const groups = value.match(/.{1,2}/g)
  return groups ? groups.join('-') : ''
}

function formatFileSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return size + 'B'
  if (size < 1024 * 1024) return Math.round(size / 1024) + 'KB'
  return (size / (1024 * 1024)).toFixed(1) + 'MB'
}

function purposeLabel(purpose) {
  return PURPOSE_LABELS[purpose] || String(purpose || '')
}

/** 该文件进材料包前是否需要先过打印隐私检查（与服务端 assertPiiReady 的判据同源）。 */
function needsPiiScan(doc) {
  if (!doc) return false
  // 服务端对派生件（derived / optimized）直接放行，前端跟着放行，否则会让用户做一次
  // 服务端根本不看的检查。
  if (doc.assetCategory === 'derived' || doc.assetCategory === 'optimized') return false
  return PACKAGE_PII_PURPOSES.indexOf(doc.purpose) >= 0
}

/** 该文件能否进材料包：用途在白名单内，且没有被服务端标成禁止进打印链路。 */
function isPackagePrintable(doc) {
  if (!doc || !doc.id) return false
  if (doc.reprintable === false) return false
  return PACKAGE_ALLOWED_PURPOSES.indexOf(doc.purpose) >= 0
}

/**
 * 材料包订单 → 展示状态。
 *
 * 状态键与「打印订单」页既有的 waiting / printing / done 三档对齐，好让同一排筛选
 * 同时管住单件订单和材料包订单。**不新开 payment 档**：材料包未付款是常态
 * （现场付款），把它归成「待付款」会让这些订单从「待取件」筛选里整批消失。
 */
function resolvePackageStatus(order, now) {
  const at = now === undefined ? Date.now() : now
  const pickupStatus = (order && order.pickupStatus) || ''
  const taskStatus = (order && order.taskStatus) || ''
  const payStatus = (order && order.payStatus) || ''
  const expiresAt = order && order.expiresAt ? new Date(order.expiresAt).getTime() : 0

  // 出纸任务的终态优先：它一旦有结论，就是用户最关心的那个事实。
  if (taskStatus === 'completed') return { key: 'done', label: '已完成', tone: 'ok' }
  if (taskStatus === 'failed') return { key: 'done', label: '打印失败', tone: 'danger' }
  if (taskStatus === 'cancelled' || taskStatus === 'abandoned') return { key: 'done', label: '已取消', tone: 'neutral' }
  if (taskStatus === 'expired') return { key: 'done', label: '已过期', tone: 'neutral' }

  if (pickupStatus === 'expired') return { key: 'done', label: '到机码已过期', tone: 'neutral' }
  if (pickupStatus === 'cancelled') return { key: 'done', label: '已取消', tone: 'neutral' }
  if (pickupStatus === 'pending') {
    if (expiresAt && expiresAt <= at) return { key: 'done', label: '到机码已过期', tone: 'neutral' }
    return { key: 'waiting', label: '待到机 · 现场付款', tone: 'wheat' }
  }
  if (pickupStatus === 'claimed') {
    // 核销了但还没付款：pickup-order.service 在出纸前硬卡 payStatus !== 'paid'。
    if (payStatus !== 'paid') return { key: 'printing', label: '已核销 · 待现场付款', tone: 'wheat' }
    return { key: 'printing', label: '已付款 · 正在进入队列', tone: 'teal' }
  }
  if (pickupStatus === 'used') {
    // 已付款并已交给一体机，此时 taskStatus 镜像 PrintTask.status。
    if (taskStatus === 'printing') return { key: 'printing', label: '正在打印', tone: 'teal' }
    return { key: 'printing', label: '已付款 · 排队出纸', tone: 'teal' }
  }
  // 未登记的服务端状态不猜：原样回显状态串，比编一个好看的标签安全。
  return { key: 'done', label: taskStatus || pickupStatus || '状态未知', tone: 'neutral' }
}

/** 单个状态字段 → 中文；未登记取值原样回显（不编造理解）。 */
function statusText(kind, value) {
  const raw = String(value || '')
  if (!raw) return '—'
  const table = kind === 'pickup' ? PICKUP_STATUS_LABELS : kind === 'pay' ? PAY_STATUS_LABELS : TASK_STATUS_LABELS
  return Object.prototype.hasOwnProperty.call(table, raw) ? table[raw] : raw
}

/**
 * 三个服务端状态字段拼成一行给用户看。
 *
 * 三个都要露出来：它们回答的是不同的问题（码还能不能用 / 钱付了没 / 纸出了没），
 * 只显示一个合成状态时，运营和用户都没法判断卡在哪一步。
 */
function statusDetail(order) {
  return `取件 ${statusText('pickup', order && order.pickupStatus)}`
    + ` · 付款 ${statusText('pay', order && order.payStatus)}`
    + ` · 任务 ${statusText('task', order && order.taskStatus)}`
}

/**
 * 列表行 → UI 行。
 *
 * 到机码只在服务端**确实下发**时展示：服务端的 visibleCode 判据是
 * `pickupStatus === 'pending' && 未过期`，已核销 / 已过期的订单直接给 null。
 * 前端不做第二套判据，也不在本地保留上一次拿到的码。
 */
function toPackageRow(order, now) {
  const source = order || {}
  const status = resolvePackageStatus(source, now)
  const amountCents = parseAmountCents(source.amountCents)
  const pickupRaw = status.key === 'waiting' && source.pickupCode ? String(source.pickupCode) : ''
  const itemCount = Number(source.itemCount)
  return {
    orderId: source.orderId || '',
    orderNo: source.orderNo || source.orderId || '',
    amountText: formatAmount(amountCents),
    amountCents,
    fileCount: Number.isFinite(itemCount) && itemCount >= 0 ? itemCount : 0,
    pickupStatus: source.pickupStatus || '',
    payStatus: source.payStatus || '',
    taskStatus: source.taskStatus || '',
    expiresText: formatExpireAt(source.expiresAt),
    pickupCode: formatPickupCode(pickupRaw),
    hasPickupCode: !!pickupRaw,
    statusDetail: statusDetail(source),
    statusKey: status.key,
    statusLabel: status.label,
    statusTone: status.tone,
  }
}

/**
 * 去重合并两页材料包订单。
 *
 * 触底分页会在服务端并发写入时重复返回同一条（游标是行 id，createdAt 相同的行顺序
 * 可能变化）。重复渲染同一张订单会让用户以为自己下了两单，所以按 orderId 去重，
 * 且**保留后到的那一份**（它更新），同时保持原有顺序不跳动。
 */
function mergePackageRows(existing, incoming) {
  const merged = []
  const indexById = new Map()
  for (const row of [...(existing || []), ...(incoming || [])]) {
    if (!row || !row.orderId) continue
    if (indexById.has(row.orderId)) {
      merged[indexById.get(row.orderId)] = row
      continue
    }
    indexById.set(row.orderId, merged.length)
    merged.push(row)
  }
  return merged
}

/**
 * 服务端错误 → 一句用户能照着做的话 + 可恢复动作。
 *
 * 判据是**错误码**，不是 message：服务端 message 在设计上不面向用户
 * （见 utils/user-error.js）。request.js 已经把不可展示的 message 清空，所以这里
 * `err.message` 有值时可以直接用（例如 PRINT_TERMINAL_OFFLINE 在透传白名单里）；
 * 无值时落到本表写好的中文。未知错误码 fail-closed 到「请稍后重试」，不宣称成功。
 *
 * recover 取值：
 *   'retry'   本页可直接重试（网络 / 临时不可用）
 *   'login'   去登录
 *   'files'   回去重新选文件
 *   'store'   回去换服务点
 *   'privacy' 去完成隐私检查
 *   'orders'  去我的打印订单找回
 *   'none'    当下没有可执行动作，只能等运营侧配置
 */
const PACKAGE_ERROR_COPY = {
  PRINT_TERMINAL_OFFLINE: { title: '服务点当前离线', text: '该一体机最近 5 分钟没有心跳，现在下单会被服务端拒绝。请换一个在线服务点，或稍后重试。', recover: 'store' },
  PRINT_TERMINAL_NOT_ACTIVE: { title: '服务点暂不接单', text: '该一体机已被运营方停用或尚未启用，请换一个服务点。', recover: 'store' },
  PRINT_TERMINAL_NOT_FOUND: { title: '服务点不存在', text: '服务点信息已失效，请返回重新选择。', recover: 'store' },
  CAPABILITY_NOT_CONFIGURED: { title: '该服务点未开通文档打印', text: '这台一体机的文档打印能力尚未由管理员登记，暂不能接材料包。请换一个服务点。', recover: 'store' },
  CAPABILITY_UNAVAILABLE: { title: '该服务点文档打印不可用', text: '这台一体机的文档打印当前不可用，请换一个服务点或稍后重试。', recover: 'store' },
  // 彩色 / 自动双面是**按终端逐台**判定的第二层能力门禁
  // （terminal-capabilities.service.ts 的 assertPrintParamsAllowed，未登记即拒绝）。
  // 它与上面两条 CAPABILITY_* 不是同一回事：那两条说的是「这台机器开不开放文档打印」，
  // 这两条说的是「这台机器的彩色/双面没验过」——EV-013 验过的是那一台，新机器各自要验。
  // 缺了这两条映射，服务端明确说出的拒绝理由会落到 describePackageError 末尾那个
  // 「操作未完成 / 请稍后重试」——而这件事重试一万次也不会变，用户只会反复点。
  //
  // recover 是 'store' 而不是 'files'：放行路径只有一条 —— 管理员在该终端真机验过后
  // 把 color_print / duplex_print 配成 available。用户当下能做的就是换一台验过的机器。
  // （改黑白/单面也能过，但那要回到第一步改参数，不是本页错误卡片这个按钮的动作；
  //  文案里说出来，按钮仍与 recover 一致。）
  PRINT_COLOR_NOT_VERIFIED_ON_TERMINAL: { title: '该服务点未验过彩色打印', text: '这台一体机的彩色打印还没在真机上验过，服务端不会受理彩色材料包。请换一个服务点；也可以回到第一步改成黑白再下单。', recover: 'store' },
  PRINT_DUPLEX_NOT_VERIFIED_ON_TERMINAL: { title: '该服务点未验过自动双面', text: '这台一体机的自动双面还没在真机上验过，服务端不会受理双面材料包。请换一个服务点；也可以回到第一步改成单面再下单。', recover: 'store' },
  PRICE_CONFIG_UNAVAILABLE: { title: '打印价目未配置', text: '服务端还没有配置打印价目，无法核定金额，因此不能下单。这需要运营方在后台配置，请稍后再试。', recover: 'none' },
  PRINT_PII_SCAN_REQUIRED: { title: '请先完成隐私检查', text: '材料包里有文件还没做完打印隐私检查。回到上一步逐个完成后再下单。', recover: 'privacy' },
  PII_SCAN_STALE: { title: '文件在检查后又变了', text: '有文件在隐私检查之后被改动过，需要重新检查一次。', recover: 'privacy' },
  PRINT_FILE_NOT_FOUND: { title: '文件已不可用', text: '材料包里有文件不存在或不属于当前账号，请返回重新选择。', recover: 'files' },
  PRINT_FILE_EXPIRED: { title: '文件已过期', text: '材料包里有文件已超过保存期限，请返回重新选择或重新上传。', recover: 'files' },
  PRINT_FILE_PURPOSE_UNSUPPORTED: { title: '有文件不支持打印', text: '材料包里有文件不在可打印范围内，请返回重新选择。', recover: 'files' },
  PACKAGE_FILE_DUPLICATED: { title: '有文件重复', text: '同一个文件不能在材料包里选两次，请返回调整。', recover: 'files' },
  PACKAGE_ORDER_NOT_FOUND: { title: '未找到该订单', text: '该订单不存在，或不属于当前登录账号。可以到「我的 · 打印订单」里找回自己的材料包订单。', recover: 'orders' },
  VALIDATION_FAILED: { title: '提交内容有误', text: '提交的材料包信息不被服务端接受，请返回重新选择文件与打印参数。', recover: 'files' },
}

function describePackageError(err, fallbackText) {
  const code = (err && err.code) || ''
  const statusCode = err && err.statusCode
  if (statusCode === 401 || code === 'MEMBER_SESSION_EXPIRED' || code === 'MEMBER_MISSING_TOKEN' || code === 'AUTH_REQUIRED') {
    return { code: code || 'UNAUTHENTICATED', title: '登录已失效', text: '请重新登录后再查看或下单。', recover: 'login' }
  }
  const mapped = PACKAGE_ERROR_COPY[code]
  if (mapped) return { code, title: mapped.title, text: (err && err.message) || mapped.text, recover: mapped.recover }
  if (statusCode === -1) {
    return { code: code || 'NETWORK_ERROR', title: '网络连接失败', text: '请检查网络后重试。', recover: 'retry' }
  }
  return {
    code: code || '',
    title: '操作未完成',
    text: (err && err.message) || fallbackText || '请稍后重试。',
    recover: 'retry',
  }
}

// ── 打印参数：UI 取值 → 服务端 wire 取值 ──────────────────────────────────
//
// **这两个函数是报价与建单的唯一出口，两条链必须用同一个。**
//
// 服务端的两个 DTO 都是 `@IsIn` 白名单，取值不同但有交集：
//   - 报价 `PrintJobParamsDto.duplex` ∈ simplex | duplex_long_edge | duplex_short_edge
//   - 建单 `PackagePrintParamsDto.duplex` ∈ single | simplex | duplex_long_edge | duplex_short_edge
// 本页 UI 用的是 `single` / `double` 两档。`double` **两边都不接受** ——
// 此前报价与建单都原样发 `'double'`，双面材料包在报价那一步就必然 400，
// 也就是说"双面"这个选项从来没有真正工作过。
//
// 为什么 double → duplex_long_edge（而不是 short_edge、也不是把双面藏起来）：
// 这是仓库里**已有的产品口径**，不是本文件新定的 ——
//   ① `packages/shared/src/types/print.ts` 的 `normalizeDuplex()` 就写着
//      `if (d === 'double') return 'duplex_long_edge'`，那是跨端共用的归一函数；
//   ② `services/api/src/materials/print-param-suggestion.rules.ts` 的参数建议
//      也按 `duplex_long_edge` 给，并按它判定 `verifiedDuplexModes`；
//   ③ 同一份 shared 类型的注释：`duplex_long_edge = 长边翻页（竖排文档）`，
//      而材料包里装的是简历 / 求职材料，本来就是竖排。
//
// 选了双面但这台机器没登记 `duplex_print` 能力时会怎样：服务端 fail-closed，
// 报价直接回 `CAPABILITY_NOT_CONFIGURED` / `CAPABILITY_UNAVAILABLE`，
// 本文件已把它翻译成「换一个服务点」。这是**诚实的拒绝**，不是静默降级成单面 ——
// 悄悄按单面出纸会让用户拿到一叠和他选的不一样的纸。

/** 服务端两个 DTO 都接受的单双面取值（交集）。 */
const PACKAGE_WIRE_DUPLEX_MODES = ['simplex', 'duplex_long_edge', 'duplex_short_edge']

/** UI 单双面 → 服务端 wire 取值。未知一律落到 simplex（最保守：单面一定能打）。 */
function toWireDuplex(uiDuplex) {
  if (PACKAGE_WIRE_DUPLEX_MODES.indexOf(uiDuplex) >= 0) return uiDuplex
  return uiDuplex === 'double' ? 'duplex_long_edge' : 'simplex'
}

/**
 * UI 色彩 → 服务端 wire 取值。
 * 报价 DTO 只接受 black_white | color；建单 DTO 额外兼容 bw，但两条链统一用
 * black_white，省得"报价按一种取值、建单按另一种"埋一个将来才炸的分叉。
 */
function toWireColorMode(uiColorMode) {
  return uiColorMode === 'color' ? 'color' : 'black_white'
}

module.exports = {
  PACKAGE_ALLOWED_PURPOSES,
  PACKAGE_WIRE_DUPLEX_MODES,
  toWireDuplex,
  toWireColorMode,
  PACKAGE_PII_PURPOSES,
  PACKAGE_ONSITE_NOTICE,
  PACKAGE_NO_CANCEL_NOTICE,
  parseAmountCents,
  formatAmount,
  formatExpireAt,
  formatPickupCode,
  formatFileSize,
  purposeLabel,
  needsPiiScan,
  isPackagePrintable,
  resolvePackageStatus,
  statusText,
  statusDetail,
  toPackageRow,
  mergePackageRows,
  describePackageError,
}
