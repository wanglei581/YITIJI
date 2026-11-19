/**
 * 完成页少见失败态（普通失败、卡纸、缺纸、费用与订单边界）的文案与摘要行。纯函数：组件渲染它，单测直接断言它。
 *
 * 版式照稿 st-unconfirmed 的骨架：三步（数字步骤）+ 订单摘要 + 出口 + 小字。稿里没有这几态，
 * 所以只搬运原来页面上已经成立的说法，不发明新词：
 *   缺纸：服务端没有「补纸后自动续打」的链路，唯一的重来是 POST /print/jobs/:taskId/retry，
 *         要 takeaway-url 先给出 canRetry，且重打的是整份文件；GET /print/jobs/:taskId 不回已出页数。
 *   费用：只写订单本身的确定事实和由谁裁决，不承诺补打、费用处理或到账。
 * 不写「已支付」（用「已付」），不出现退款 / 赔付承诺，不出现「联系 / 找（现场）工作人员」。
 */

import type { PrintJobParams } from '@ai-job-print/shared'
import { helpNeededLine, printProblemLine, resolveSupportContact } from '../../../copy/unattendedCopy'
import { MINIAPP_DISPLAY_NAME } from '../../../copy/miniappLinkCopy'
import { truncateFileNameMiddle, FILE_NAME_BUDGET_CARD } from '../../../lib/fileName'
import { jamOrderKeptLine, jobSubline, orderKeptFaultLine, paidLabelOf, sameCodeResumeLine, type OutOfPaperMoney } from '../printProgressModel'

export type FailureVariant = 'failed' | 'paper-jam' | 'out-of-paper' | 'offline'

export interface FailureStep {
  title: string
  detail: string
}

export interface FailureCopy {
  title: string
  subtitle: string
  /** 顶栏状态胶囊。 */
  pill: string
  /** 三步。 */
  steps: FailureStep[]
  /** 步骤区的读屏名。 */
  stepsLabel: string
  /** 小字：订单边界。标准求助句不在步骤里时，补在这里。 */
  fine: string
  /** 到机码单且后端还允许续打时的同码续打说明；否则 null。 */
  resumeLine: string | null
}

export interface SummaryRow {
  key: string
  label: string
  value: string
}

const STEPS_LABEL = '处理之前先做这三件'

/** 三态小字。收费点位写已付金额还在，不写退款。 */
function keptFine(money: OutOfPaperMoney): string {
  const head = money.fact === 'paid' ? '订单和已付金额都保留着' : '订单记录保留着'
  return `${head}，不会因为这次失败消失。`
}

function orderRefOf(orderNo: string | null): string {
  return orderNo ? `订单号 ${orderNo}` : '这一单'
}

/** 第一步三个失败态一样：先看出纸口。本机不知道出了几页，以手里的实物为准。 */
const LOOK_AT_TRAY: FailureStep = {
  title: '先看出纸口，已出的纸取走收好',
  detail: '本机不知道出了几页，以你手里的实物为准。',
}

/** 缺纸副题。结构与故障副题相同。定稿加「也」：加纸后也不会自动续打。 */
function outOfPaperKeptLine(fact: OutOfPaperMoney['fact']): string {
  const kept = fact === 'paid' ? '你的订单和已付金额都保留着' : '你的订单还在'
  return `${kept}。机器缺纸，加纸后也不会自动续打，我们已经收到提醒，会尽快处理`
}

/**
 * 定稿第 3 步，和「结果未确认」同一句。能不能重新提交都一样。
 * 服务电话只出现在标题里；服务时间另起一行。读不到号码时改去隐私政策。
 */
function helpStep(): FailureStep {
  const ctx = resolveSupportContact()
  if (!ctx.servicePhone) {
    return { title: '需要帮助？查看《隐私政策》里的联系方式', detail: '' }
  }
  return {
    title: `需要帮助？拨打服务电话 ${ctx.servicePhone}，报这一单的订单号`,
    detail: ctx.serviceHours ? `服务时间：${ctx.serviceHours}` : '',
  }
}

/**
 * 定稿第 2 步。故障和离线先说这次不会自己接着打（缺纸已在副句说过）。
 * 能重新提交时点名下面的按钮；不能时不提那个按钮。附近还有在线终端才写换一台。
 * 全屏这一步只用「稍后再来」，不写「请稍后再来」。
 */
function reorderStep(variant: FailureVariant, money: OutOfPaperMoney, canRetry: boolean): FailureStep {
  const paid = money.fact === 'paid'
  const nearby = resolveSupportContact().otherOnlineTerminalNearby === true
  const again = nearby
    ? '也可以换一台机器继续，或稍后再来'
    : canRetry
      ? '也可以稍后再来'
      : '你可以稍后再来'
  const lead = variant === 'paper-jam' || variant === 'offline' ? '这次打印不会自己接着打。\n' : ''
  const body = canRetry
    ? `机器恢复后，用下面的「重新提交打印」整份重打${paid ? '，不再收费' : ''}；${again}。`
    : `是否补打，以订单记录为准；${again}。`
  return {
    title: paid ? '请不要重新下单，那会变成两笔费用' : '请不要重新下单',
    detail: `${lead}${body}`,
  }
}

/** 故障态第 1 步：取纸和不要开机盖并成一步。确实卡纸只把「可能」升成「卡着的纸」。 */
function jamStep(confirmed: boolean): FailureStep {
  return {
    title: '已出的纸取走收好，不要开机盖、不要拽纸',
    detail: confirmed
      ? '卡着的纸撕在里面更难取，也可能弄坏机器。'
      : '可能卡了纸，撕在里面更难取，也可能弄坏机器。',
  }
}

/**
 * 同一订单整份重打（takeaway-url 给出 canRetry 才有这个出口）。
 * 现场没人加纸、没人处理（走查 I-11），所以不写「加完纸」：按钮只在打印机恢复后才亮，没亮就是机器还没好。
 * 缺纸、卡纸、离线能重提时，把现成的求助句接在说明末尾，服务电话只在这一步出现一次。
 */
function retryStep(money: OutOfPaperMoney, help?: string): FailureStep {
  const detail = money.fact === 'free'
    ? '同一订单整份重打，请不要重新下单。'
    : '同一订单整份重打、不再收费；不要重新下单，那会变成两笔费用。'
  return {
    title: '机器恢复后可点下方「重新提交打印」',
    detail: help ? `${detail}${help}` : detail,
  }
}

export function failureCopy(input: {
  variant: FailureVariant
  money: OutOfPaperMoney
  orderNo: string | null
  canRetry: boolean
  /** 从到机码进来的这一单。缺省不当成到机码单，也不按金额猜测。 */
  pickupSource?: boolean
  /** 订单视图上的续打资格。没带来时只看 canRetry。 */
  reprintAllowed?: boolean | null
  reprintRemaining?: number | null
  /**
   * 只有公开打印机状态确实是卡纸（mapTerminalPrinterStatus 把 paper_jam / jam 收成 errorCode paperJam）才说死「打印机卡纸」。
   * PRINTER_ERROR 但状态不是卡纸、或状态还在读，都写成「打印机出了故障（可能卡纸）」。
   */
  confirmedJam?: boolean
}): FailureCopy {
  const { variant, money, orderNo, canRetry } = input
  const resumeLine = sameCodeResumeLine({
    pickupSource: input.pickupSource,
    canRetry,
    reprintAllowed: input.reprintAllowed,
    reprintRemaining: input.reprintRemaining,
  })
  const orderRef = orderRefOf(orderNo)
  const paid = money.fact === 'paid'
  const help = printProblemLine()

  if (variant === 'paper-jam') {
    const confirmed = input.confirmedJam === true
    const fault = confirmed ? '打印机卡纸' : '打印机出了故障（可能卡纸）'
    return {
      title: fault,
      subtitle: confirmed ? jamOrderKeptLine(money.fact) : orderKeptFaultLine(money.fact, '机器出了故障'),
      pill: fault,
      stepsLabel: STEPS_LABEL,
      steps: [
        jamStep(confirmed),
        reorderStep('paper-jam', money, canRetry),
        helpStep(),
      ],
      fine: keptFine(money),
      resumeLine,
    }
  }

  if (variant === 'offline') {
    return {
      title: '打印机离线',
      subtitle: orderKeptFaultLine(money.fact, '打印机没连上'),
      pill: '打印机离线',
      stepsLabel: STEPS_LABEL,
      steps: [
        LOOK_AT_TRAY,
        reorderStep('offline', money, canRetry),
        helpStep(),
      ],
      fine: keptFine(money),
      resumeLine,
    }
  }

  if (variant === 'out-of-paper') {
    return {
      title: '打印机缺纸',
      subtitle: outOfPaperKeptLine(money.fact),
      pill: '打印机缺纸',
      stepsLabel: STEPS_LABEL,
      steps: [
        LOOK_AT_TRAY,
        reorderStep('out-of-paper', money, canRetry),
        helpStep(),
      ],
      fine: keptFine(money),
      resumeLine,
    }
  }

  // 普通失败：服务端已确认失败，但不回已出页数。
  return {
    title: '打印失败',
    subtitle: '打印任务已经确认失败',
    pill: `${paidLabelOf(money)} · 打印失败`,
    stepsLabel: STEPS_LABEL,
    steps: [
      LOOK_AT_TRAY,
      paid
        ? { title: '订单和支付记录都在', detail: '是否处理费用、处理多少，以订单记录为准；本机不会自动处理费用。' }
        : { title: '你的订单还在', detail: '是否补打，以订单记录为准。' },
      canRetry
        ? retryStep(money)
        : { title: `记下${orderRef}`, detail: help },
    ],
    fine: `${paid ? '订单和支付记录保留着' : '订单记录保留着'}，不会因为这次失败消失。${canRetry ? help : ''}`,
    resumeLine,
  }
}

/**
 * 出纸页「暂时查不到打印结果」（client-status-timeout）的三步与小字。
 * 本机连续 10 分钟没拿到终态只是查询超时：系统的任务状态没有被改变，不猜成功也不猜失败。
 */
export function timeoutCopy(input: { money: OutOfPaperMoney; orderNo: string | null }): {
  stepsLabel: string
  steps: FailureStep[]
  fine: string
} {
  const { money, orderNo } = input
  const help = printProblemLine()
  const boundary = money.fact === 'free'
    ? '这次到底出没出纸、要不要补打，以订单记录为准。订单记录保留。'
    : money.fact === 'paid'
      ? '这次到底出没出纸、要不要补打或退费，以订单记录为准。是否退款、退多少、多久到账，本机不承诺自动退款。'
      : '这次到底出没出纸，以订单记录为准。'
  return {
    stepsLabel: '这一刻你可以做的三件',
    steps: [
      { title: '看一眼出纸口，已出的纸先取走收好', detail: '它和这次查询结果无关。' },
      { title: '点下方「重新查询状态」', detail: '这只是再问系统一次，不会重下单、不会重复扣费。' },
      orderNo
        ? { title: `还是查不到就记下订单号 ${orderNo}`, detail: `和这台机器的位置。${help}` }
        : { title: '还是查不到就记下这台机器的位置', detail: help },
    ],
    fine: `这只是查询超时：系统的打印任务状态没有被改变，我们不会猜它成功或失败。可以先重新查询。${boundary}`,
  }
}

/** 「查看费用说明 / 查看订单说明」那一屏的文案。 */
export function feeInfoCopy(input: { free: boolean; orderNo: string | null }): {
  title: string
  subtitle: string
  stepsLabel: string
  steps: FailureStep[]
  fine: string
} {
  const { free, orderNo } = input
  const help = printProblemLine()
  return {
    title: free ? '订单记录' : '费用与订单边界',
    subtitle: '本页只展示订单的真实状态，不替你承诺结果',
    stepsLabel: STEPS_LABEL,
    steps: [
      orderNo
        ? { title: `记下订单号 ${orderNo}`, detail: '和这台机器的位置。' }
        : { title: '记下这台机器的位置', detail: '方便核对这一单。' },
      { title: '说明实际拿到了几页、哪几页没出', detail: '已出的纸请一并带上。' },
      { title: '核对之后是否处理、处理多少，以订单记录为准', detail: help },
    ],
    fine: free
      ? `是否补打，以订单记录为准。订单记录保留，不会因为这次异常消失。`
      : '是否处理费用、处理多少、多久到账，以订单记录为准。本机不承诺自动处理，也不会替你把费用改成别的数，也不会把支付异常写成打印状态。订单和支付记录都在，不会因为这次异常消失。',
  }
}

/**
 * 订单摘要行：订单号、文件、参数、支付事实，再加一行设备上报的原因。
 * 原因已经被标准求助句替换过的（服务端原话让用户去找人）不再重复占一行，标准句只在步骤里说一次。
 */
export function failureSummaryRows(input: {
  orderNo: string | null
  file: { name: string; pages: number | null } | null
  params: Partial<PrintJobParams> | null
  money: OutOfPaperMoney
  reason: string
}): SummaryRow[] {
  const { orderNo, file, params, money, reason } = input
  const rows: SummaryRow[] = []
  if (orderNo) rows.push({ key: 'order', label: '订单号', value: orderNo })
  rows.push({
    key: 'file',
    label: '文件',
    value: file?.name ? truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_CARD }) : '本次打印任务',
  })
  rows.push({ key: 'params', label: '参数', value: jobSubline(file, params) })
  rows.push(paymentRow(money))
  if (reason && reason !== printProblemLine()) rows.push({ key: 'reason', label: '设备上报', value: reason })
  return rows
}

/** 摘要里的金额。定稿写「已付 2.00 元」，不带货币符号。 */
function yuanLabel(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  return `${(safe / 100).toFixed(2)} 元`
}

export function paymentRow(money: OutOfPaperMoney): SummaryRow {
  if (money.fact === 'free') return { key: 'pay', label: '办理方式', value: '免费试运营，本单 0 元' }
  if (money.fact === 'paid' && money.amountCents != null) {
    return { key: 'pay', label: '支付状态', value: `已付 ${yuanLabel(money.amountCents)}` }
  }
  return { key: 'pay', label: '支付状态', value: '以订单为准' }
}

/**
 * 三态失败页的「设备上报」只留设备那一句，不把第 3 步的服务电话再贴一遍。
 * 公开状态已经确认是卡纸时，改成与「打印机缺纸，当前无法打印。」「打印机离线，当前无法打印。」同一写法。
 * 还没确认时仍用对照表那句。普通失败仍用已经换成无人值守口径的整句。
 */
export function shownFailureReason(
  variant: FailureVariant,
  deviceReason: string,
  presentedReason: string,
  confirmedJam = false,
): string {
  if (variant === 'paper-jam' && confirmedJam) return '打印机卡纸，当前无法打印。'
  if (variant === 'paper-jam' || variant === 'out-of-paper' || variant === 'offline') return deviceReason
  return presentedReason
}

/** 带走链接取不到。三态写明不影响这笔订单，不再接服务电话。普通失败仍接「打印有问题」。 */
export function faultScreenTakeawayMiss(visual: string): string {
  if (visual === 'paper-jam' || visual === 'out-of-paper' || visual === 'offline') {
    return '手机带走链接这次没取到，不影响这笔订单。'
  }
  return `带走链接没取到。${printProblemLine()}`
}

/** 带走链接过期。三态与「没取到」同一口径，不接服务电话。普通失败仍接「打印有问题」。 */
export function faultScreenTakeawayExpired(visual: string): string {
  if (visual === 'paper-jam' || visual === 'out-of-paper' || visual === 'offline') {
    return '手机带走链接已过期，不影响这笔订单。'
  }
  return `带走链接已过期。${printProblemLine()}`
}

/**
 * 公开打印机状态是不是卡纸。
 * useTerminalDeviceStatus 的 mapTerminalPrinterStatus：心跳在线且 printerStatus 为 paper_jam 或别名 jam 时，
 * kind 是 error、printer.errorCode 是 paperJam。还在读、离线、缺纸、其它故障都不是。
 */
export function printerJamConfirmed(device: {
  loading: boolean
  kind: 'ready' | 'offline' | 'error' | 'low_paper' | 'unknown'
  printer: { errorCode?: string }
}): boolean {
  return !device.loading && device.kind === 'error' && device.printer.errorCode === 'paperJam'
}

/**
 * 重新提交打印要打印机现在能出纸才有意义：缺纸、卡纸、离线、读不到状态时，按钮置灰，并写清为什么。
 * 打印机恢复后状态刷新（每分钟一次）按钮自己亮起。读不到就按不能算（和打印预览、核价页一个口径：状态没读到不放行）。
 * 返回 null = 现在能提交；返回一句话 = 不能提交的原因，放在按钮下面。
 */
export function retryBlockedReason(device: {
  loading: boolean
  printerReady: boolean
  kind: 'ready' | 'offline' | 'error' | 'low_paper' | 'unknown'
  printer: { errorCode?: string }
  printerNotice?: string
}): string | null {
  if (device.printerReady) return null
  if (device.loading) return '正在确认这台机器的打印机状态…'
  if (device.printerNotice) return device.printerNotice
  const tail = '机器恢复后，这个按钮会自己亮起。'
  if (device.kind === 'offline') return `这台机器的打印机现在离线，暂时不能重新提交；${tail}`
  if (device.kind === 'error') {
    if (device.printer.errorCode === 'paperEmpty') {
      return `打印机现在还缺纸，暂时不能重新提交；${tail}`
    }
    if (device.printer.errorCode === 'paperJam') {
      return `打印机现在还卡着纸，暂时不能重新提交；${tail}`
    }
    return `打印机现在还有故障，暂时不能重新提交；${tail}`
  }
  return `暂时读不到打印机状态，先不能重新提交；${tail}`
}

/**
 * 完成页「无法确认打印结果」（有任务号）的三步与小字：状态读不到不等于没出纸，也不等于失败（走查 I-30）。
 *   ① 先看出纸口——读不到结果不代表没出纸，别因此重新下单；
 *   ② 这一单已登记，这一页在自动重查（窗口内）或可以手动再查一次；
 *   ③ 订单号的出口：这一单关联了账号才有「在手机上 / 在这台机器上查看」；没关联就记下订单号、需要时报给我们。
 * `viewable` 只在建单响应确认这一单关联了账号（hasEndUser === true）时为真；手机这一句再受小程序是否已发布限制。
 * 钱的事实只在金额大于 0 时提：免费单不提钱。
 */
export function unverifiedTaskCopy(input: {
  money: OutOfPaperMoney
  orderNo: string | null
  viewable: boolean
  miniappPublished: boolean
  autoRechecking: boolean
}): { stepsLabel: string; steps: FailureStep[]; fine: string } {
  const { money, orderNo, viewable, miniappPublished, autoRechecking } = input
  const orderRef = orderNo ? `订单号 ${orderNo}` : '这一单'
  const paid = money.fact === 'paid'
  const third: FailureStep = viewable
    ? miniappPublished
      ? { title: '在手机上查看这一单', detail: `打开${MINIAPP_DISPLAY_NAME}小程序「我的 → 打印订单」，找到${orderRef}。` }
      : { title: '在这台机器上查看这一单', detail: `点下方「查看打印订单」，找到${orderRef}。` }
    : { title: orderNo ? `订单号是 ${orderNo}` : '记下这一单的订单号', detail: orderNo ? `需要时报这个订单号查询。${helpNeededLine()}` : helpNeededLine() }
  return {
    stepsLabel: '这一刻你可以做的三件',
    steps: [
      { title: '先看出纸口，已出的纸取走收好', detail: '这一页读不到结果，不代表没出纸，以你手里的实物为准。' },
      {
        title: '这一单已登记，请不要重新下单',
        detail: `${paid ? '重新下单会变成两笔费用。' : ''}${autoRechecking ? '这一页在自动重新查，查到会自己更新。' : '点下方「重新查看这一单」可以再查一次。'}`,
      },
      third,
    ],
    fine: '这只是这一页暂时读不到结果：不代表没出纸，也不代表打印失败。订单记录保留。',
  }
}
