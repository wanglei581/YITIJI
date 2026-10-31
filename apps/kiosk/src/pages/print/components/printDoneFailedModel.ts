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
import { helpNeededLine, machineCannotPrintLine, printProblemLine } from '../../../copy/unattendedCopy'
import { MINIAPP_DISPLAY_NAME } from '../../../copy/miniappLinkCopy'
import { truncateFileNameMiddle, FILE_NAME_BUDGET_CARD } from '../../../lib/fileName'
import { formatCents } from '../cashierStatus'
import { jamOrderKeptLine, jobSubline, outOfPaperPill, type OutOfPaperMoney } from '../printProgressModel'

export type FailureVariant = 'failed' | 'paper-jam' | 'out-of-paper'

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
}

export interface SummaryRow {
  key: string
  label: string
  value: string
}

const STEPS_LABEL = '处理之前先做这三件'

const PAPER_HELP_FINE = '卡纸、缺纸、没出全？别硬拉纸。'

function orderRefOf(orderNo: string | null): string {
  return orderNo ? `订单号 ${orderNo}` : '这一单'
}

/** 顶栏胶囊前半截：免费写「免费试运营，本单 0 元」，付过写金额，不知道金额只说订单保留。 */
export function paidLabelOf(money: OutOfPaperMoney): string {
  if (money.fact === 'free') return '免费试运营，本单 0 元'
  if (money.fact === 'paid' && money.amountCents != null) return `已付 ${formatCents(money.amountCents)}`
  return '订单保留'
}

/** 第一步三个失败态一样：先看出纸口。本机不知道出了几页，以手里的实物为准。 */
const LOOK_AT_TRAY: FailureStep = {
  title: '先看出纸口，已出的纸取走收好',
  detail: '本机不知道出了几页，以你手里的实物为准。',
}

/**
 * 同一订单整份重打（takeaway-url 给出 canRetry 才有这个出口）。
 * 现场没人加纸、没人处理（走查 I-11），所以不写「加完纸」：按钮只在打印机恢复后才亮，没亮就是机器还没好。
 */
function retryStep(money: OutOfPaperMoney): FailureStep {
  return {
    title: '机器恢复后可点下方「重新提交打印」',
    detail: money.fact === 'free'
      ? '同一订单整份重打，请不要重新下单。'
      : '同一订单整份重打、不再收费；不要重新下单，那会变成两笔费用。',
  }
}

export function failureCopy(input: {
  variant: FailureVariant
  money: OutOfPaperMoney
  orderNo: string | null
  canRetry: boolean
}): FailureCopy {
  const { variant, money, orderNo, canRetry } = input
  const orderRef = orderRefOf(orderNo)
  const free = money.fact === 'free'
  const paid = money.fact === 'paid'
  const help = printProblemLine()

  if (variant === 'paper-jam') {
    return {
      title: '打印机卡纸',
      subtitle: jamOrderKeptLine(money.fact),
      pill: `${paidLabelOf(money)} · 打印机卡纸`,
      stepsLabel: STEPS_LABEL,
      steps: [
        { title: '把出纸口里已经出来的纸取走收好', detail: '别留在机器上。' },
        { title: '不要自己开机盖、不要拽纸', detail: '撕在里面更难取，也可能弄坏机器。' },
        // 卡纸要机器恢复才能再打，现场没人处理：用「机器暂时打不了」的标准句，说清我们已收到提醒、请稍后再来、怎么找到我们。
        { title: `记下${orderRef}`, detail: machineCannotPrintLine(undefined, { orderKept: true }) },
      ],
      fine: PAPER_HELP_FINE,
    }
  }

  if (variant === 'out-of-paper') {
    const machine = machineCannotPrintLine(undefined, { orderKept: true })
    const third: FailureStep = canRetry
      ? retryStep(money)
      : free
        ? { title: `记下${orderRef}，请不要重新下单`, detail: machine }
        : { title: `记下${orderRef}，不要重新下单再打一次`, detail: `那会变成两笔费用。${machine}` }
    const kept = paid ? '订单和已付金额都保留着' : '订单记录保留着'
    const money2 = free
      ? '是否补打，以订单记录为准。'
      : '是否处理费用、处理多少，以订单记录为准，本机不承诺自动处理。'
    return {
      title: '打印机缺纸',
      subtitle: '订单还在。机器缺纸，这次打印不会在加纸后自动续打',
      pill: outOfPaperPill(money),
      stepsLabel: STEPS_LABEL,
      steps: [
        LOOK_AT_TRAY,
        { title: '纸匣空了，这次打印也不会自己接着打', detail: '机器恢复后，只有本页的「重新提交打印」能整份重打。' },
        third,
      ],
      fine: `纸匣已空，这次打印不会在加纸后自动继续。${kept}；只有本页出现「重新提交打印」按钮时，才能自己重打一次${free ? '。' : '，且不会重复收费。'}${money2}${canRetry ? help : ''}`,
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

export function paymentRow(money: OutOfPaperMoney): SummaryRow {
  if (money.fact === 'free') return { key: 'pay', label: '办理方式', value: '免费试运营' }
  if (money.fact === 'paid' && money.amountCents != null) {
    return { key: 'pay', label: '支付状态', value: `已付 ${formatCents(money.amountCents)}` }
  }
  return { key: 'pay', label: '支付状态', value: '以订单为准' }
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
  const tail = '机器恢复后，这个按钮会自己亮起；订单还在，请不要重新下单。'
  if (device.kind === 'offline') return `这台机器的打印机现在离线，暂时不能重新提交。${tail}`
  if (device.kind === 'error') {
    return device.printer.errorCode === 'paperEmpty'
      ? `打印机现在还缺纸，暂时不能重新提交。${tail}`
      : `打印机现在还有故障，暂时不能重新提交。${tail}`
  }
  return `暂时读不到打印机状态，先不能重新提交。${tail}`
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
    : { title: `记下${orderRef}，需要时报给我们`, detail: helpNeededLine() }
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
