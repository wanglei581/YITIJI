import type { ReactNode } from 'react'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { PrintArt } from '../art/PrintArt'
import { PrintIcon } from '../art/PrintIcon'
import { formatCents } from '../cashierStatus'
import { PICKUP_SAME_CODE_RESUME_NOTE, type ClaimSuccessCopy } from '../pickupClaimModel'

// 到机码核对订单页的正文（稿 pickup-ok）：订单摘要 → 续打说明 → 三步。
// 只转述回执：订单号、文件名、金额缺哪项就不画哪一行，不补演示值；纸张缩略只是装饰，不当订单预览。
// 主按钮、返回与问小青在底栏，由页面传入，不在正文里。

type StepIcon = QxTouchIconName | 'clock'

/** 三步的图标按这一单走到哪儿换：未付款、排队或出纸中、已完成、没打成。 */
function stepIcons(cta: string): [StepIcon, StepIcon, StepIcon] {
  if (cta === '进入现场支付') return ['check', 'receipt', 'printer']
  if (cta === '查看打印结果') return ['check', 'printer', 'eye']
  if (cta === '查看打印进度') return ['check', 'clock', 'eye']
  return ['check', 'alert', 'eye']
}

export function PickupOkBody({
  copy,
  orderNo,
  fileName,
  amountCents,
  privacyNote,
}: {
  copy: ClaimSuccessCopy
  orderNo: string
  fileName?: string | null
  amountCents?: number
  privacyNote: ReactNode
}) {
  const icons = stepIcons(copy.cta)
  return (
    <>
      <section className="pok-grid" aria-label="认领结果">
        <div className="pok-thumb">
          <PrintArt name="stack" size={300} count={3} />
        </div>
        <div className="pok-sum">
          <div className="pok-row">
            <span>订单号</span>
            <b className="qx-num" data-testid="pickup-ok-order-no">{orderNo}</b>
          </div>
          {fileName ? (
            <div className="pok-row">
              <span>文件</span>
              <b>{fileName}</b>
            </div>
          ) : null}
          {typeof amountCents === 'number' ? (
            <div className="pok-row">
              <span>金额</span>
              <b className="pok-amt">{formatCents(amountCents)}</b>
            </div>
          ) : null}
        </div>
      </section>

      <aside className="pok-note">
        <PrintIcon name="refresh" size={34} />
        <span>
          <b>同一个到机码可以接着打</b>
          {PICKUP_SAME_CODE_RESUME_NOTE}
        </span>
      </aside>

      <ol className="pok-steps" aria-label="接下来的三步">
        {copy.steps.map((step, index) => (
          <li key={step} className="pok-step">
            <span className="pok-n" aria-hidden="true">{index + 1}</span>
            <span className="pok-i" aria-hidden="true">
              {icons[index] === 'clock'
                ? <PrintIcon name="clock" size={34} />
                : <QxTouchIcon name={icons[index] as QxTouchIconName} size={34} strokeWidth={2} />}
            </span>
            <b>{step}</b>
            {index < copy.steps.length - 1 ? (
              <span className="pok-arrow" aria-hidden="true"><QxTouchIcon name="arrowR" size={28} strokeWidth={2.4} /></span>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="pok-fine">{privacyNote}</p>
    </>
  )
}
