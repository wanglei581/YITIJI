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
import { ApiHttpError } from './httpAdapter'

/**
 * 跨页面通用的技术性失败。这些码与「用户此刻在做什么」无关，因此可以给统一文案；
 * 与具体业务有关的失败一律留给调用方兜底句，那里才知道用户是在导出还是在转写。
 */
const SHARED_USER_MESSAGES: Readonly<Record<string, string>> = {
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  REQUEST_TIMEOUT: '本次请求响应超时，请重试',
  RATE_LIMITED: '当前使用的人较多，请稍后再试',
  AI_RATE_LIMITED: '当前使用的人较多，请稍后再试',
  AI_BUSY: 'AI 服务正忙，请稍后再试',
  FILE_TOO_LARGE: '文件过大，请压缩后重试',
  MEMBER_AUTH_REQUIRED: '登录状态已失效，请重新登录后重试',
  MEMBER_MISSING_TOKEN: '登录状态已失效，请重新登录后重试',
  MEMBER_SESSION_EXPIRED: '登录状态已失效，请重新登录后重试',
  MEMBER_TOKEN_INVALID: '登录状态已失效，请重新登录后重试',
  // 演示模式：verify-ai-down-fallbacks.mjs 要求解析页透出**真实原因**，
  // 不许把它抹成通用文案，因此必须在白名单里有自己的说法。
  MOCK_MODE: '当前为演示模式，未连接真实 AI 服务',
  AI_NOT_CONFIGURED: 'AI 能力尚未启用，请联系现场工作人员',
  AI_PROVIDER_NOT_CONFIGURED: 'AI 能力尚未启用，请联系现场工作人员',
  AI_PROVIDER_UNREACHABLE: 'AI 服务暂时连不上，请稍后重试',
  TERMINAL_NOT_READY: '本机设备未就绪，请联系现场工作人员后再试',
  TERMINAL_ID_REQUIRED: '本机设备未就绪，请联系现场工作人员后再试',
  ONLINE_PAYMENT_DISABLED: '本机暂未开通线上支付，请改用其他支付方式或联系现场工作人员',
  PRINTER_UNAVAILABLE: '打印机当前不可用（离线、缺纸或故障），请稍后再试或联系现场工作人员',
  SCAN_TERMINAL_BUSY: '本机正在扫描中，请等待当前任务完成后再试',
  SCAN_TERMINAL_DISABLED: '本机扫描功能已停用，请联系现场工作人员',
  SCAN_SESSION_EXPIRED: '扫描会话已过期，请返回重新开始',
  INVALID_SCAN_SESSION: '扫描任务未创建成功，请返回重试',
  PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED: '检测到上一笔支付待核实，请先等待自动确认或点击核实',
  PAYMENT_ATTEMPT_PENDING: '已有支付正在处理中，请勿重复扫码',
  RECONCILE_TOO_FREQUENT: '核实过于频繁，请稍候几秒再试',
  RECONCILE_UNSUPPORTED: '当前通道不支持主动核实，请继续等待支付结果',
  LOCAL_AGENT_UNREACHABLE: '无法连接本机终端服务，请确认设备正常后重试',
  LOCAL_USB_BRIDGE_TOKEN_MISSING: '当前终端未配置 U 盘导入，请联系现场工作人员',
  CONVERT_TOO_MANY_IMAGES: '一次转换的图片过多，请减少张数后重试',
  SIGN_SOURCE_NOT_FOUND: '文件访问凭证已过期或文件已清理，请重新选择文件',
  NO_TERMINAL_IDENTITY: '本机终端身份未确认，请联系现场工作人员',
  KIOSK_FEEDBACK_RATE_LIMITED: '反馈提交过于频繁，请稍后再试',
  KIOSK_FEEDBACK_PII_REJECTED: '反馈内容含不宜提交的个人信息，请删改后再试',
  KIOSK_FEEDBACK_EMPTY: '请填写问题说明后再提交',
  ORDER_NOT_FOUND: '未找到对应订单，请返回重新开始',
  VALIDATION_FAILED: '提交内容未通过校验，请检查后重试',
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
 */
export function userMessageOf(error: unknown, fallback: string): string {
  const code = errorCodeOf(error)
  if (code && code in SHARED_USER_MESSAGES) return SHARED_USER_MESSAGES[code] as string
  // 浏览器 fetch 失败是 TypeError。普通 Error('Failed to fetch') 仍走兜底——
  // verify-kiosk-runtime-error-boundary 钉死不得按 message 文本猜测。
  if (error instanceof TypeError) return SHARED_USER_MESSAGES.NETWORK_ERROR as string
  if (error instanceof ApiHttpError) {
    if (error.status === 0) return SHARED_USER_MESSAGES.NETWORK_ERROR as string
    if (error.status === 429) return SHARED_USER_MESSAGES.RATE_LIMITED as string
    if (error.status === 401) return SHARED_USER_MESSAGES.MEMBER_AUTH_REQUIRED as string
    if (error.status >= 500) return '服务暂时不可用，请稍后重试或联系现场工作人员'
  }
  return fallback
}

/** 门禁与测试用：暴露白名单本体，避免各处重新抄一份码表造成漂移。 */
export const SHARED_USER_MESSAGE_CODES = Object.freeze(Object.keys(SHARED_USER_MESSAGES))
