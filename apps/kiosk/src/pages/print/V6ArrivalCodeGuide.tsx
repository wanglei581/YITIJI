// P47 到机码核销的说明栏 / 对照表 / 失败补充。
// 码规格与失败码以生产为准：8 位数字 + 存量 10 位；不拆 notfound / 错终端。
import type { TerminalPrinterKind } from '../../hooks/useTerminalDeviceStatus'
import {
  LEGACY_PICKUP_CODE_LENGTH,
  PICKUP_CODE_LENGTH,
} from '@ai-job-print/shared'

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

  const unknown = props.kind === 'unknown'
  return (
    <div className="pcp-printer-warn" role="status">
      <strong>{unknown ? '还读不到这台打印机能不能出纸' : '这台机器现在可能出不了纸'}</strong>
      <p>
        {unknown
          ? '核销本身能办，但这一趟可能拿不到纸。建议先确认设备状态，或换一台空闲机器。'
          : `核销和付款都能做，但做完了纸可能出不来（${props.printerLabel}）。到机码不会因为这一步作废，也可以换一台机器。`}
      </p>
    </div>
  )
}

export function V6ArrivalCodeWhy() {
  return (
    <div className="pcp-why">
      <p className="pch-title">这一步做什么</p>
      <ul className="pcp-why-list">
        <li><b>认领到这台机器</b> —— 按到机码找到你在小程序上下的那一单。</li>
        <li><b>这一步不收钱</b> —— 核销只是认领，付款是下一步；不会出纸。</li>
        <li><b>输错了单还在</b> —— 不会把你的单作废，改完再试即可。</li>
        <li><b>没带码也能打</b> —— 回上一页走文档打印，在本机直接传文件。</li>
      </ul>
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
      {props.lastCode ? (
        <p className="pcp-echo">刚才进到机器里的是 <b>{props.lastCode}</b>。对着小程序核一遍；本机没有收钱。</p>
      ) : null}
    </>
  )
}

export function V6ArrivalCodeSide() {
  return (
    <div className="pcp-side-extra">
      <p className="pch-title">到机码长什么样</p>
      <dl className="pcp-facts">
        <div><dt>新码</dt><dd><em>{PICKUP_CODE_LENGTH}</em> 位数字</dd></div>
        <div><dt>旧码</dt><dd>早前下单的 <em>{LEGACY_PICKUP_CODE_LENGTH}</em> 位仍有效</dd></div>
        <div><dt>在哪儿看</dt><dd>小程序「我的 → 打印订单 → 查看到机码」</dd></div>
      </dl>
      <p className="pch-title">别和取件码搞混</p>
      <table className="pcp-cmp">
        <thead>
          <tr><th> </th><th>到机码</th><th>取件码</th></tr>
        </thead>
        <tbody>
          <tr><th>谁给你的</th><td>小程序下单之后</td><td>本机付款成功之后</td></tr>
          <tr><th>干什么用</th><td>在这台机器上认领那一单</td><td>在出纸口认领打好的件</td></tr>
          <tr><th>什么时候</th><td>付款之前</td><td>出纸之后</td></tr>
        </tbody>
      </table>
      <p className="pcp-note">手上那个如果是付完款之后拿到的，那是取件码，不在这一步用。</p>
      <p className="pch-title">这一趟怎么走</p>
      <ol className="pcp-flow">
        <li className="is-done">在小程序上下单</li>
        <li className="is-now">在这台机器上核销 · 不收钱</li>
        <li>收银台付款</li>
        <li>出纸，那时才有取件码</li>
      </ol>
    </div>
  )
}

export function V6ArrivalCodeNextNotes(props: { released: boolean }) {
  return (
    <p className="pcs-next">
      {props.released
        ? '下一步是等出纸。取件码只在付款成功之后才有；本页不再编造页数或金额。'
        : '下一步才是付款。付款成功之后才会出纸，取件码也要等到付完才有。现在退出不收钱。'}
    </p>
  )
}
