// P47 到机码核销的短说明。首屏不堆「为什么」长文。
import type { TerminalPrinterKind } from '../../hooks/useTerminalDeviceStatus'
import { PICKUP_CODE_LENGTH } from '@ai-job-print/shared'

export type ArrivalClaimErrorKind = 'expired' | 'unavailable' | 'locked' | 'invalid'

export function classifyArrivalClaimError(code: string | undefined): ArrivalClaimErrorKind {
  if (code === 'PICKUP_CODE_EXPIRED') return 'expired'
  if (code === 'PICKUP_CODE_UNAVAILABLE' || code === 'ORDER_PAYMENT_UNAVAILABLE') return 'unavailable'
  if (code === 'PICKUP_CLAIM_LOCKED') return 'locked'
  return 'invalid'
}

const ERROR_TITLE: Record<ArrivalClaimErrorKind, string> = {
  expired: '这个码已经过期',
  unavailable: '这单现在不能核销',
  locked: '这台机器暂时不能核销',
  invalid: '到机码无效或已过期',
}

export function V6ArrivalCodePrinterWarn(props: {
  kind: TerminalPrinterKind
  loading: boolean
  printerLabel: string
}) {
  if (props.loading) return null
  if (props.kind === 'ready' || props.kind === 'low_paper') return null

  return (
    <div className="pcp-printer-warn" role="status">
      {props.kind === 'unknown'
        ? '还读不到能不能出纸。核销能做，这一趟可能拿不到纸。'
        : `这台可能出不了纸（${props.printerLabel}）。核销仍可做，码不会作废。`}
    </div>
  )
}

export function V6ArrivalCodeErrorBody(props: {
  kind: ArrivalClaimErrorKind
  message: string
  lastCode: string
}) {
  return (
    <>
      <strong className="pcp-error-title">{ERROR_TITLE[props.kind]}</strong>
      <span> {props.message}</span>
      {props.lastCode ? <p className="pcp-echo">刚才输入的是 {props.lastCode} · 没有收钱</p> : null}
    </>
  )
}

export function V6ArrivalCodeSide() {
  return (
    <div className="pcp-side-extra">
      <p className="pch-title">别和取件码搞混</p>
      <p className="pcp-cmp-one">
        现在输入的是<strong>到机码</strong>（{PICKUP_CODE_LENGTH} 位数字，付款前认领）。
        取件码要等付完款、出纸后才有。
      </p>
    </div>
  )
}

export function V6ArrivalCodeNextNotes(props: { released: boolean }) {
  return (
    <p className="pcs-next">
      {props.released ? '请在出纸口等候。' : '下一步付款后才会出纸。'}
    </p>
  )
}
