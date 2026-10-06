/**
 * 一体机无人值守文案（2026-10-04）。
 *
 * 设备现场不安排工作人员。需要人接着处理时，只给出服务电话或站内已有出路。
 * 号码不写死：由 `servicePhoneLine` 决定有号码和没有号码两种说法。
 * `{号码}` 在标准句里换成 `servicePhoneLine` 的整句结果，避免没有号码时仍写「拨打服务电话」。
 *
 * 省略 phone 时读会话缓存，不发请求。显式传 null 表示当前没有号码。
 * 运行时根在进页时拉取一次，子页面重绘时就能读到。
 * 本文件不发请求，也不 import 接口模块，避免和 serviceContact 循环引用。
 *
 * `UNATTENDED_FORBIDDEN_PHRASES` 与 `scripts/verify-kiosk-unattended-copy.mjs` 共用。
 * 门禁用文本解析读这份数组，改词必须两处一起看。
 */

let readCachedPhone: () => string | null = () => null

/** 由 serviceContact 在模块加载时绑上。这里不发请求。 */
export function bindServicePhonePeek(read: () => string | null): void {
  readCachedPhone = read
}

export function peekServicePhone(): string | null {
  return readCachedPhone()
}

function resolvePhone(phone?: string | null): string | null {
  if (phone !== undefined) return phone
  return peekServicePhone()
}

export const UNATTENDED_FORBIDDEN_PHRASES = [
  '联系现场工作人员',
  '联系工作人员',
  '找现场工作人员',
  '找工作人员',
  '交给工作人员',
  '工作人员核查',
  '向工作人员出示',
  '出示给现场工作人员',
  '出示给工作人员',
  '去服务台',
] as const

export function containsStaffHandoff(text: string): boolean {
  return UNATTENDED_FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase))
}

/** 有号码 →「拨打服务电话 {号码}」；没有 →「查看《隐私政策》里的联系方式」。 */
export function servicePhoneLine(phone?: string | null): string {
  const resolved = resolvePhone(phone)
  const trimmed = typeof resolved === 'string' ? resolved.trim() : ''
  if (!trimmed) return '查看《隐私政策》里的联系方式'
  return `拨打服务电话 ${trimmed}`
}

/** 标准句 1：通用求助。 */
export function helpNeededLine(phone?: string | null): string {
  return `需要帮助？${servicePhoneLine(phone)}`
}

/**
 * 标准句 2：缺纸、卡纸、打印机离线、结果未确认、设备异常。
 * 始终写「换一台机器」，不看附近还有没有别的终端。
 * `orderKept` 时补「这单还在，手机上能看到。」不写已付、退款、金额。
 */
export function machineCannotPrintLine(
  phone?: string | null,
  options?: { orderKept?: boolean },
): string {
  const base = `这台机器暂时打不了，我们已经收到提醒，会尽快处理。你可以换一台机器继续，或稍后再来；需要帮助请${servicePhoneLine(phone)}。`
  return options?.orderKept ? `${base}这单还在，手机上能看到。` : base
}

/** 标准句 3：机器未登记、暂停接单，或整台机器暂时不能用。始终写「换一台机器」。 */
export function machineUnusableLine(phone?: string | null): string {
  return `这台机器暂时不能用，请换一台机器，或${servicePhoneLine(phone)}。`
}

/** 标准句 4：完成页的核查入口。 */
export function printProblemLine(phone?: string | null): string {
  return `打印有问题？${servicePhoneLine(phone)}，或问小青`
}

/** 标准句 5：只在收费单出现。0 元单不要调用。 */
export function refundApplyLine(phone?: string | null): string {
  return `如需退款，在手机上『我的 → 打印订单』里申请，或${servicePhoneLine(phone)}`
}

/**
 * 服务端原话若仍让用户去找现场的人，改用一体机自己的句子。
 * 原话不含那些说法时原样留下。
 */
export function preferUnattended(serverText: string, replacement: string): string {
  const trimmed = serverText.trim()
  if (!trimmed || containsStaffHandoff(trimmed)) return replacement
  return trimmed
}
