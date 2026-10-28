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
import { printProblemLine } from '../../../copy/unattendedCopy'
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

/** 同一订单整份重打（takeaway-url 给出 canRetry 才有这个出口）。 */
function retryStep(money: OutOfPaperMoney): FailureStep {
  return {
    title: '加完纸可点下方「重新提交打印」',
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
        { title: `记下${orderRef}`, detail: help },
      ],
      fine: PAPER_HELP_FINE,
    }
  }

  if (variant === 'out-of-paper') {
    const third: FailureStep = canRetry
      ? retryStep(money)
      : free
        ? { title: `记下${orderRef}，请不要重新下单`, detail: help }
        : { title: `记下${orderRef}，不要重新下单再打一次`, detail: `那会变成两笔费用。${help}` }
    const kept = paid ? '订单和已付金额都保留着' : '订单记录保留着'
    const money2 = free
      ? '是否补打，以订单记录为准。'
      : '是否处理费用、处理多少，以订单记录为准，本机不承诺自动处理。'
    return {
      title: '打印机缺纸',
      subtitle: '已经登记缺纸，这次打印不会在加纸后自动续打',
      pill: outOfPaperPill(money),
      stepsLabel: STEPS_LABEL,
      steps: [
        LOOK_AT_TRAY,
        { title: '纸匣空了，这次打印也不会自己接着打', detail: '加纸之后，只有本页出现「重新提交打印」才能整份重打。' },
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
