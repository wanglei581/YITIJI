import { QRCodeSVG } from 'qrcode.react'
import { PAY_CHECK_LINE, PAY_WAIT_BACK } from './payServiceModel'

/**
 * 稿 .d3-qrframe：码框里依次是「请扫码支付」、收款码、这一次的服务与金额、有效期与返回说明，
 * 核实中再加一句。码的内容只用服务端给的 qrCodeContent；没有就不画码，不拿别的东西充数。
 */
export function PayServiceQr({
  value,
  name,
  amount,
  remain,
  checking,
}: {
  value: string | null
  name: string
  amount: string
  remain: string
  checking: boolean
}) {
  return (
    <div className="pys-qrframe" data-testid="pay-service-qr">
      <b className="pys-qrt">请扫码支付</b>
      {value ? (
        <div className="pys-qr" role="img" aria-label={`这一次的收款码：${name} · ${amount}`} data-testid="pay-service-qr-code">
          <QRCodeSVG value={value} size={280} level="M" marginSize={1} />
        </div>
      ) : (
        <p className="pys-qr-missing" role="status">收款码这会儿没出来，可以点「刷新付款结果」再看一次。</p>
      )}
      <b>这一次：{name} · {amount}</b>
      <p data-testid="pay-service-remain">收款码 5 分钟内有效。还剩 {remain}。付好了才会开始。{PAY_WAIT_BACK}</p>
      {checking ? <p role="status" data-testid="pay-service-checking">{PAY_CHECK_LINE}</p> : null}
    </div>
  )
}
