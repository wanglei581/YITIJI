/**
 * 一体机无人值守文案（2026-10-04，10/6 按产品负责人口径改条件）。
 *
 * 现场不安排工作人员。需要人接着处理时，只给出服务电话或站内已有出路。
 * 号码、服务时间、附近是否还有别的在线终端、小程序是否已发布，都从
 * `PublicSupportContact` 读，不写死。读不到时用最保守的一套：没号码、
 * 没服务时间、单点位、小程序未发布。
 *
 * 省略 contact 时读会话缓存，不发请求。显式传 null 表示当前没有联系方式。
 * 运行时根在进页时拉取一次，子页面重绘时就能读到。
 * 本文件不发请求，也不 import 接口模块，避免和 supportContact 循环引用。
 *
 * `UNATTENDED_FORBIDDEN_PHRASES` 与 `scripts/verify-kiosk-unattended-copy.mjs` 共用。
 * 门禁用文本解析读这份数组，改词必须两处一起看。
 */

export interface PublicSupportContact {
  servicePhone: string | null
  serviceHours: string | null
  otherOnlineTerminalNearby: boolean
  miniappPublished: boolean
}

/** 404、超时、字段缺失，以及还没请求到之前，都用这一套。 */
export const CONSERVATIVE_SUPPORT_CONTACT: PublicSupportContact = {
  servicePhone: null,
  serviceHours: null,
  otherOnlineTerminalNearby: false,
  miniappPublished: false,
}

let readCachedContact: () => PublicSupportContact = () => CONSERVATIVE_SUPPORT_CONTACT

/** 由 supportContact 在模块加载时绑上。这里不发请求。 */
export function bindSupportContactPeek(read: () => PublicSupportContact): void {
  readCachedContact = read
}

export function peekSupportContact(): PublicSupportContact {
  return readCachedContact()
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** 缺字段按保守值补齐，不把缺的布尔当成真。 */
export function resolveSupportContact(contact?: PublicSupportContact | null): PublicSupportContact {
  if (contact === undefined) return peekSupportContact()
  if (contact === null) return CONSERVATIVE_SUPPORT_CONTACT
  return {
    servicePhone: trimmedOrNull(contact.servicePhone),
    serviceHours: trimmedOrNull(contact.serviceHours),
    otherOnlineTerminalNearby: contact.otherOnlineTerminalNearby === true,
    miniappPublished: contact.miniappPublished === true,
  }
}

/**
 * 拼禁用说法。整句不能写成一个字符串字面量，否则文案门禁扫到这份词表自己就会红。
 * 运行时拼回去，`preferUnattended` 仍按整句判断。
 */
function forbiddenPhrase(parts: readonly string[]): string {
  return parts.join('')
}

export const UNATTENDED_FORBIDDEN_PHRASES = [
  forbiddenPhrase(['联系现场', '工作人员']),
  forbiddenPhrase(['联系', '工作人员']),
  forbiddenPhrase(['找现场', '工作人员']),
  forbiddenPhrase(['找', '工作人员']),
  forbiddenPhrase(['交给', '工作人员']),
  forbiddenPhrase(['工作人员', '核查']),
  forbiddenPhrase(['向', '工作人员出示']),
  forbiddenPhrase(['向现场', '工作人员出示']),
  forbiddenPhrase(['出示给现场', '工作人员']),
  forbiddenPhrase(['出示给', '工作人员']),
  forbiddenPhrase(['去服', '务台']),
  // 10/6 总指挥：以下三个词整体禁用（门禁 FORBIDDEN 同步）。片段拆开写，免得词表自己被扫到。
  forbiddenPhrase(['现场工作', '人员']),
  forbiddenPhrase(['服务', '台']),
  forbiddenPhrase(['值', '守']),
  forbiddenPhrase(['缺纸时一体机会自动停止', '接单']),
  forbiddenPhrase(['找人', '补纸']),
  forbiddenPhrase(['取件', '凭证码']),
] as const

export function containsStaffHandoff(text: string): boolean {
  return UNATTENDED_FORBIDDEN_PHRASES.some((phrase) => text.includes(phrase))
}

/**
 * 电话片段。
 * 有号码且有服务时间 →「拨打服务电话 {号码}（{服务时间}）」
 * 有号码但没有服务时间 →「拨打服务电话 {号码}」
 * 没号码 →「查看《隐私政策》里的联系方式」
 */
export function servicePhoneLine(contact?: PublicSupportContact | null): string {
  const ctx = resolveSupportContact(contact)
  if (!ctx.servicePhone) return '查看《隐私政策》里的联系方式'
  if (!ctx.serviceHours) return `拨打服务电话 ${ctx.servicePhone}`
  return `拨打服务电话 ${ctx.servicePhone}（${ctx.serviceHours}）`
}

/** 标准句 1：通用求助。 */
export function helpNeededLine(contact?: PublicSupportContact | null): string {
  return `需要帮助？${servicePhoneLine(contact)}`
}

/**
 * 标准句 2：缺纸、卡纸、打印机离线、结果未确认、设备异常。
 * 附近有别的在线终端才写「换一台机器」，否则只写「请稍后再来」。
 * 「这单还在，手机上能看到。」只在订单还在、这一步小程序里能接着看、且小程序已发布时加。
 * 这句不写已付、退款、金额。
 */
export function machineCannotPrintLine(
  contact?: PublicSupportContact | null,
  options?: { orderKept?: boolean },
): string {
  const ctx = resolveSupportContact(contact)
  const next = ctx.otherOnlineTerminalNearby
    ? '你可以换一台机器继续，或稍后再来；'
    : '请稍后再来；'
  const base = `这台机器暂时打不了，我们已经收到提醒，会尽快处理。${next}需要帮助请${servicePhoneLine(ctx)}。`
  if (options?.orderKept && ctx.miniappPublished) return `${base}这单还在，手机上能看到。`
  return base
}

/**
 * 标准句 3：机器未登记、暂停接单，或整台机器暂时不能用。
 * 附近有别的在线终端才写「请换一台机器」，否则「请稍后再来」。
 */
export function machineUnusableLine(contact?: PublicSupportContact | null): string {
  const ctx = resolveSupportContact(contact)
  const next = ctx.otherOnlineTerminalNearby ? '请换一台机器，或' : '请稍后再来，或'
  return `这台机器暂时不能用，${next}${servicePhoneLine(ctx)}。`
}

/** 标准句 4：完成页的核查入口。 */
export function printProblemLine(contact?: PublicSupportContact | null): string {
  return `打印有问题？${servicePhoneLine(contact)}，或问小青`
}

/**
 * 标准句 5：只在这一单金额 > 0 时由调用方显示。
 * 不写「在手机上申请」。0 元单不要调用。
 */
export function refundApplyLine(contact?: PublicSupportContact | null): string {
  return `如需退款，请${servicePhoneLine(contact)}，我们核实后原路退回。`
}

/** 一体机主机靠 4G CPE 上网。提到网络断开时用这一句，不叫用户自己查线。 */
export function networkDisconnectLine(): string {
  return '网络断开时，我们会收到提醒并远程处理'
}

/** 小程序未发布时，不出现「用手机继续 / 打开小程序」这一类引导。 */
export function whenMiniapp(contact: PublicSupportContact | null | undefined, text: string): string {
  return resolveSupportContact(contact).miniappPublished ? text : ''
}

/**
 * 续打说明。字段缺一截就不写对应那句。
 * `reprintAllowed` 不是布尔（旧接口没给）→ 两句都不出现。
 * 为真且 `reprintRemaining` 是非负整数 → 可续打。
 * 为假 → 不可续打。次数还没算出来（null）时，假值多半是「这单本来就没有续打资格」，
 * 不说「不能再续打了」，免得正常待打的单也被说成用尽。
 */
/** 订单视图或认领回执上的续打字段。缺字段保持 undefined，不把缺省当成 false。 */
export function readReprintFields(value: unknown): {
  reprintAllowed: boolean | undefined
  reprintRemaining: number | null | undefined
} {
  if (!value || typeof value !== 'object') {
    return { reprintAllowed: undefined, reprintRemaining: undefined }
  }
  const row = value as { reprintAllowed?: unknown; reprintRemaining?: unknown }
  return {
    reprintAllowed: typeof row.reprintAllowed === 'boolean' ? row.reprintAllowed : undefined,
    reprintRemaining: typeof row.reprintRemaining === 'number' || row.reprintRemaining === null
      ? row.reprintRemaining
      : undefined,
  }
}

export function reprintHintLine(
  reprintAllowed: boolean | null | undefined,
  reprintRemaining: number | null | undefined,
  contact?: PublicSupportContact | null,
): string | null {
  if (typeof reprintAllowed !== 'boolean') return null
  if (reprintAllowed) {
    if (typeof reprintRemaining !== 'number' || !Number.isInteger(reprintRemaining) || reprintRemaining < 0) {
      return null
    }
    return `没打完？同一个到机码再输一次就能接着打（还能续打 ${reprintRemaining} 次）。`
  }
  if (reprintRemaining !== 0) return null
  return `这单不能再续打了，回到订单重新打印，或${servicePhoneLine(contact)}。`
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
