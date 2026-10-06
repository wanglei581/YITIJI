/**
 * 「给用户看的错误文案」的唯一收敛点。
 *
 * 起因（2026-08-19 专家评审 + 四家 CLI 只读复核）：10 个页面在出错时把技术串直接甩给
 * 站在一体机前的求职者。根因有两层：
 *
 * 1. 适配器在拿不到 `body.error.message` 时造的是英文 `HTTP ${status}`
 *    （仓库里多数适配器早就用中文 `请求失败（${status}）`，只有一部分没跟上）；
 * 2. 页面普遍写成 `err instanceof Error ? err.message : '中文兜底'` ——
 *    兜底挂在了「不是 Error」那一支，而技术串恰恰是**有 message 的 Error**，
 *    于是那句准备好的中文一次都执行不到。
 *
 * ## 为什么不按「message 里有没有汉字」判
 *
 * 这是本轮被证伪的第一版方案。反例是真实存在的：
 * `job-material-pdf.service.ts:103` 下发的是
 * 「服务器缺少可用中文字体，无法生成求职材料 PDF；请配置 JOB_MATERIAL_PDF_FONT_PATH
 * 指向 .ttf/.ttc 中文字体文件」——中文，但它在教运维配环境变量，不是给求职者看的。
 * 同型的还有 `fair-company-print.service.ts:276` 等数处 PDF 服务。
 * 「含中文」不等于「面向用户」。
 *
 * ## 采用的判据：错误码白名单，未知码回退到调用方兜底
 *
 * 与 `uploadSessions.ts` 的 `uploadSessionUserMessage` 同一套哲学（那里的注释原文：
 * 「不要把服务端原始错误（可能含内部状态）直接显示给用户」），对披露 fail-closed。
 * 另一处先例 `memberAuthApi.ts` 的 `resolveMemberApiErrorMessage` 采宽松式（过滤占位串后
 * 原样透传），恰好会被上面那个字体路径反例击穿，因此本模块不沿用它。
 *
 * **已知代价，如实记录**：后端确实存在有价值的中文业务提示（如「简历文件已过期，请重新
 * 上传」），在本模块下会被替换成页面自己的兜底句，helpfulness 有损失。回收方式是把这些
 * 码逐个登记进下面的白名单 —— 这是安全方向上的增量，不是重新放开透传。
 */
import {
  helpNeededLine,
  machineCannotPrintLine,
  machineUnusableLine,
  networkDisconnectLine,
  preferUnattended,
  resolveSupportContact,
  whenMiniapp,
  type PublicSupportContact,
} from '../../copy/unattendedCopy'
import { ApiHttpError } from './httpAdapter'

/**
 * 跨页面通用的技术性失败。这些码与「用户此刻在做什么」无关，因此可以给统一文案；
 * 与具体业务有关的失败一律留给调用方兜底句，那里才知道用户是在导出还是在转写。
 *
 * 公共额度用完（429 `AI_PUBLIC_QUOTA_EXCEEDED`）各页共用下面这一句，不写价格、购买或充值。
 */
export const AI_PUBLIC_QUOTA_EXCEEDED_COPY = '今天的 AI 次数用完了，明天恢复；可以先打印原件。'

type SharedUserMessage = string | ((contact?: PublicSupportContact | null) => string)

const SHARED_USER_MESSAGES: Readonly<Record<string, SharedUserMessage>> = {
  NETWORK_ERROR: `网络连接失败，请稍后再试。${networkDisconnectLine()}。`,
  // 到机码（取件码）：服务端 message 本就是面向用户的中文，这里给同义的稳定文案，避免落到通用兜底
  PICKUP_CODE_INVALID: '到机码无效或已过期，请核对后重新输入',
  PICKUP_CODE_EXPIRED: '到机码无效或已过期，请核对后重新输入',
  PICKUP_CODE_UNAVAILABLE: (contact) => `这个到机码对应的文件暂时不可用。${helpNeededLine(contact)}`,
  // 2026-09-07 产品裁决「退款则不出文件」：服务端在任何状态写入前拦下，这里给同义稳定文案。
  // 这是已经退过款的订单状态，不是向免费单提供退款。看进度只在小程序已发布时写。
  ORDER_REFUNDED: (contact) => {
    const where = whenMiniapp(contact, '可在小程序「我的 → 打印订单」查看退款进度。')
    return `本单已退款，不再出纸。款项按原路退回。${where || helpNeededLine(contact)}`
  },
  PICKUP_CODE_LENGTH: '到机码位数不对，请重新输入',
  PICKUP_CODE_PATTERN: '到机码格式不对，请重新输入',
  REQUEST_TIMEOUT: '本次请求响应超时，请重试',
  RATE_LIMITED: '当前使用的人较多，请稍后再试',
  AI_RATE_LIMITED: '当前使用的人较多，请稍后再试',
  // 公共日额度：当天重试不会成功。不要并进上面的普通限流句。
  AI_PUBLIC_QUOTA_EXCEEDED: AI_PUBLIC_QUOTA_EXCEEDED_COPY,
  AI_BUSY: 'AI 服务正忙，请稍后再试',
  FILE_TOO_LARGE: '文件过大，请压缩后重试',
  PRINT_JOB_TOO_LARGE: '每单最多打印 100 面，请分几单打印',
  MEMBER_AUTH_REQUIRED: '登录状态已失效，请重新登录后重试',
  MEMBER_MISSING_TOKEN: '登录状态已失效，请重新登录后重试',
  MEMBER_SESSION_EXPIRED: '登录状态已失效，请重新登录后重试',
  MEMBER_TOKEN_INVALID: '登录状态已失效，请重新登录后重试',
  // 演示模式：verify-ai-down-fallbacks.mjs 要求解析页透出**真实原因**，
  // 不许把它抹成通用文案，因此必须在白名单里有自己的说法。
  MOCK_MODE: '当前为演示模式，未连接真实 AI 服务',
  AI_NOT_CONFIGURED: (contact) => `AI 能力尚未启用。${helpNeededLine(contact)}`,
  AI_PROVIDER_NOT_CONFIGURED: (contact) => `AI 能力尚未启用。${helpNeededLine(contact)}`,
  AI_PROVIDER_UNREACHABLE: 'AI 服务暂时连不上，请稍后重试',
  TERMINAL_NOT_READY: (contact) => machineUnusableLine(contact),
  TERMINAL_ID_REQUIRED: (contact) => machineUnusableLine(contact),
  TERMINAL_SESSION_INVALID: (contact) => machineUnusableLine(contact),
  TERMINAL_SESSION_RETRYABLE: '这台机器正在做安全校验，请稍候',
  ONLINE_PAYMENT_DISABLED: (contact) => `本机暂未开通线上支付，请改用其他支付方式。${helpNeededLine(contact)}`,
  PRINTER_UNAVAILABLE: (contact) => machineCannotPrintLine(contact),
  // #1150 方案 A：只给「终端队列闸门停领」用的新码，不占用上面的 PRINTER_UNAVAILABLE。
  // 原话通过透传形状检查就原样显示；缺失或不像人话时回退标准句 3。
  // 2026-10-06：暂停接单不再写「找现场工作人员」。附近没有别的在线终端时不写「换一台机器」。
  PRINT_TERMINAL_QUEUE_HALTED: (contact) => machineUnusableLine(contact),
  SCAN_TERMINAL_BUSY: '本机正在扫描中，请等待当前任务完成后再试',
  SCAN_TERMINAL_DISABLED: (contact) => `本机扫描功能已停用。${machineUnusableLine(contact)}`,
  SCAN_SESSION_EXPIRED: '这次扫描已过期，请返回重新开始',
  INVALID_SCAN_SESSION: '扫描任务未创建成功，请返回重试',
  PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED: '检测到上一笔支付待核实，请先等待自动确认或点击核实',
  PAYMENT_ATTEMPT_PENDING: '已有支付正在处理中，请勿重复扫码',
  // 该码含「受理未知」（出码超时/中断）与「已受理但本地回填失败」两支，本机都无从判定是否扣款。
  // 因此固定文案只说未知结果，既不断言「已受理」，也不落 5xx「请稍后重试」诱导重复支付。
  PAY_CHANNEL_ACCEPTANCE_UNCONFIRMED: (contact) => `支付结果尚未确认，可能已扣款。请勿重复支付，可在手机支付账单中核对。${helpNeededLine(contact)}`,
  RECONCILE_TOO_FREQUENT: '核实过于频繁，请稍候几秒再试',
  RECONCILE_UNSUPPORTED: '当前通道不支持主动核实，请继续等待支付结果',
  LOCAL_AGENT_UNREACHABLE: '无法连接这台机器的本机程序，请确认设备正常后重试',
  LOCAL_USB_BRIDGE_TOKEN_MISSING: (contact) => {
    const viaPhone = whenMiniapp(contact, '请改用手机扫码上传。')
    return `这台机器还没配好 U 盘导入。${viaPhone}${helpNeededLine(contact)}`
  },
  // 2026-10-04 Agent 本地接口：读的那一下失败（多半是 Windows Defender 拦下了可疑文件，或文件已被隔离）。
  // 重试同一个文件不会成功，所以不说「请重试」，直接让用户换一个。
  LOCAL_USB_FILE_UNREADABLE: '这个文件读不了，请换一个文件',
  // 列表过期（一次性编号已用过或超时）：同一个编号再点只会再失败，要重新读取 U 盘列表。
  LOCAL_USB_FILE_EXPIRED: '文件列表已过期，请重新读取 U 盘后再选',
  // 2026-10-04 能力中心把这台机器的 U 盘导入配成非「可用」。重试过不了，改走手机扫码。
  LOCAL_USB_DISABLED: (contact) => {
    const viaPhone = whenMiniapp(contact, '请用手机扫码上传。')
    return viaPhone
      ? `这台机器暂未开放 U 盘导入，${viaPhone}`
      : `这台机器暂未开放 U 盘导入。${helpNeededLine(contact)}`
  },
  // 2026-10-04 查能力开关失败、超时或返回对不上。当时确认不了是否开放，不要当成已开放。
  LOCAL_USB_CAPABILITY_UNKNOWN: (contact) => {
    const viaPhone = whenMiniapp(contact, '或用手机扫码上传')
    return `暂时确认不了 U 盘导入是否开放，请稍后再试${viaPhone}。`
  },
  CONVERT_TOO_MANY_IMAGES: '一次转换的图片过多，请减少张数后重试',
  SIGN_SOURCE_NOT_FOUND: '文件访问凭证已过期或文件已清理，请重新选择文件',
  NO_TERMINAL_IDENTITY: (contact) => machineUnusableLine(contact),
  KIOSK_FEEDBACK_RATE_LIMITED: '反馈提交过于频繁，请稍后再试',
  KIOSK_FEEDBACK_PII_REJECTED: '反馈内容含不宜提交的个人信息，请删改后再试',
  KIOSK_FEEDBACK_EMPTY: '请填写问题说明后再提交',
  ORDER_NOT_FOUND: '未找到对应订单，请返回重新开始',
  VALIDATION_FAILED: '提交内容未通过校验，请检查后重试',
  // 2026-09-28 合规开关（服务端 ai-access 与内容检查）。这几个码原因唯一，给固定文案；
  // 不登记时 401 会落成「登录状态已失效」（用户根本没登录过），403/400 落成页面的
  // 「请稍后重试」，照着重试永远不会成功。
  AI_PAUSED: 'AI 服务暂停中，打印、扫描照常可用',
  MAINTENANCE_MODE: '系统维护中，请稍后再来',
  AI_LOGIN_REQUIRED: '使用 AI 功能需要先用手机号登录',
  AI_DECLARATION_REQUIRED: '使用 AI 前需要先确认年满 14 周岁；用到语音时还需同意录音',
  AI_CONTENT_BLOCKED: '内容里有不能处理的信息，请修改后再试',
  // 2026-09-29 AI 每日金额上限（服务端 ai-access 额度检查，503）。重试当天不会成功，明说「明天恢复」。
  AI_BUDGET_EXHAUSTED: '今天的 AI 服务额度已用完，明天恢复；打印、扫描照常可用',
  AI_BUDGET_UNAVAILABLE: '暂时核对不了 AI 额度，为防超支先暂停 AI；打印、扫描照常可用',
  // 2026-09-29 P1-3 出站白名单：服务商地址未核准，这次没有发出请求（覆盖门禁 verify:backend-error-copy-coverage）
  AI_ENDPOINT_NOT_ALLOWED: 'AI 服务暂时不可用，本次没有生成结果；打印、扫描照常可用',
}

/**
 * 「服务端文案可直接展示」的码白名单。
 *
 * 与上面 SHARED_USER_MESSAGES 的分工：那张表是**用固定中文覆盖**服务端说法，
 * 适合失败原因唯一的码；这张表针对的是**原因随具体输入变化、且服务端那句就是
 * 写给求职者看的**的码，固定文案在这里反而更糟。
 *
 * 实例：`CONVERT_FAILED` 若统一成「生成失败，请稍后重试」，用户会照着提示一直重试，
 * 而真实原因可能是「合成图片尺寸不受支持」—— 重试永远不会成功，正确动作是换一张图。
 * 这不只是 helpfulness 损失，是把用户导向一个无效操作。
 *
 * `PRINT_TERMINAL_QUEUE_HALTED` 也在这张表里，且只加这一个码（#1150 方案 A：
 * 终端队列闸门停领专用新码。本分支不合入那份服务端改动。开工时该码尚未出现在
 * #1150 的 services/api/src，码名按拍板登记）。服务端把这句写成给一体机前求职者看的话，
 * 原文可能与下面的固定句不完全相同，固定覆盖会把原话吞掉。
 * 它同时留在 SHARED_USER_MESSAGES：原话缺失，或通不过下面的形状检查，就回退到
 * 标准句 3（这台机器暂时不能用；附近有别的在线终端才写「换一台机器」，否则「请稍后再来」）。
 * 原话若仍让用户去找现场的人，同样回退，不原样上屏。
 * `PRINTER_UNAVAILABLE` 不进这张表，固定用标准句 2，不透传服务端原话。
 *
 * 加码进这张表的判据（三条都要满足）：
 * 1. 该码的服务端 message 由业务代码显式写成面向求职者的中文，不是异常串或运维提示
 *    （反例见本文件顶部那条「请配置 JOB_MATERIAL_PDF_FONT_PATH」）；
 * 2. message 不含内部状态：路径、SQL、堆栈、配置项名、内部 ID；
 * 3. 有门禁或浏览器用例钉住前两条。CONVERT_FAILED 由
 *    fusion-w2-tools.spec.ts「conversion page renders a server conversion error
 *    without fabricating output」钉住。PRINT_TERMINAL_QUEUE_HALTED 由
 *    verify-kiosk-runtime-error-boundary.mjs 钉住：合格中文原话原样显示，
 *    英文堆栈或路径回退固定文案，PRINTER_UNAVAILABLE 仍不透传。
 *
 * 未登记的码一律仍走调用方兜底句 —— 对披露 fail-closed 的默认没有变。
 * userMessageOf 先看这张表、再看固定码表：两张表都有的码，原话合格用原话，不合格才用固定文案。
 */
const PASSTHROUGH_MESSAGE_CODES: ReadonlySet<string> = new Set([
  'CONVERT_FAILED',
  'PRINT_TERMINAL_QUEUE_HALTED',
])

/**
 * 透传前的最后一道形状检查。不是判据（判据是上面那三条 + 逐码登记），
 * 只是防止某天服务端在同一个码下换成异常串时把它原样怼到一体机屏幕上。
 */
function displayableServerMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiHttpError)) return undefined
  const message = error.message?.trim()
  if (!message || message.length > 60) return undefined
  if (!/[\u4e00-\u9fa5]/.test(message)) return undefined
  if (/^(HTTP\s|请求失败（)/.test(message)) return undefined
  return message
}

/** 从任意 error 上取错误码；取不到返回 undefined。 */
export function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof ApiHttpError) return error.code
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return undefined
}

/**
 * 取可直接展示给用户的中文文案。
 *
 * `fallback` 必须是**与当前操作相关**的中文句子（「导出失败，请稍后重试」而不是
 * 「操作失败」），因为未知错误码一律落到它 —— 它是用户实际会看到的那句话。
 * `contact` 省略时读会话缓存，不在这里发请求。显式传 null 表示当前没有联系方式。
 */
function resolveSharedMessage(entry: SharedUserMessage, contact?: PublicSupportContact | null): string {
  return typeof entry === 'function' ? entry(contact) : entry
}

export function userMessageOf(error: unknown, fallback: string, contact?: PublicSupportContact | null): string {
  const resolved = contact === undefined ? resolveSupportContact(undefined) : contact
  const code = errorCodeOf(error)
  // 透传先于固定覆盖。目前只有 PRINT_TERMINAL_QUEUE_HALTED 两张表都在：
  // 原话过形状检查就显示原话，否则落到下面的固定文案。没进透传表的码行为不变。
  // 原话若仍让用户去找现场的人，改用一体机固定句（2026-10-04 无人值守）。
  if (code && PASSTHROUGH_MESSAGE_CODES.has(code)) {
    const serverMessage = displayableServerMessage(error)
    if (serverMessage) {
      const entry = code in SHARED_USER_MESSAGES ? SHARED_USER_MESSAGES[code] : undefined
      const replacement = entry
        ? resolveSharedMessage(entry, resolved)
        : `服务暂时不可用，请稍后重试。${helpNeededLine(resolved)}`
      return preferUnattended(serverMessage, replacement)
    }
  }
  if (code && code in SHARED_USER_MESSAGES) {
    return resolveSharedMessage(SHARED_USER_MESSAGES[code] as SharedUserMessage, resolved)
  }
  // 浏览器 fetch 失败是 TypeError。普通 Error('Failed to fetch') 仍走兜底——
  // verify-kiosk-runtime-error-boundary 钉死不得按 message 文本猜测。
  if (error instanceof TypeError) return resolveSharedMessage(SHARED_USER_MESSAGES.NETWORK_ERROR, resolved)
  if (error instanceof ApiHttpError) {
    if (error.status === 0) return resolveSharedMessage(SHARED_USER_MESSAGES.NETWORK_ERROR, resolved)
    if (error.status === 429) return resolveSharedMessage(SHARED_USER_MESSAGES.RATE_LIMITED, resolved)
    if (error.status === 401) return resolveSharedMessage(SHARED_USER_MESSAGES.MEMBER_AUTH_REQUIRED, resolved)
    if (error.status >= 500) return `服务暂时不可用，请稍后重试。${helpNeededLine(resolved)}`
  }
  return fallback
}

/** 门禁与测试用：暴露白名单本体，避免各处重新抄一份码表造成漂移。 */
export const SHARED_USER_MESSAGE_CODES = Object.freeze(Object.keys(SHARED_USER_MESSAGES))

/** 门禁与测试用：暴露透传码白名单，同样避免各处重抄造成漂移。 */
export const PASSTHROUGH_USER_MESSAGE_CODES = Object.freeze([...PASSTHROUGH_MESSAGE_CODES])
