import type { ReactNode } from 'react'
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileTextIcon,
  LockIcon,
  ShieldCheckIcon,
  TicketIcon,
} from 'lucide-react'
import type { MemberBenefitItem } from '@ai-job-print/shared'
import type { PrintBenefitView } from '../../../services/api/benefits'
import {
  PRINT_BENEFIT_REDEEM_CTA_LABEL,
  PRINT_BENEFIT_REDEEM_DISABLED_REASON,
} from '../../../services/api/benefits'
import type { QuoteView } from '../printConfirmModel'
import { PrintAiHelp } from './PrintAiHelp'
import type { PrintFileState } from '../printMaterialSession'

// 报价确认页（稿 14）的展示小件：核对区、金额卡、费用行、权益卡、确认卡、分段与标签。
// 从 PrintConfirmView 拆出来（那个文件已过 600 行），只搬家、不改样子；核对区多了「本机暂未开通」的灰格。

const BENEFIT_TYPE_LABEL: Record<string, string> = {
  coupon: '优惠券',
  free_quota: '免费次数',
  package_entitlement: '服务额度',
  subsidy_eligibility_hint: '政策资格提示',
}
const FILE_KIND: Record<string, string> = {
  'application/pdf': 'PDF 文档',
  'image/jpeg': 'JPG 图片',
  'image/png': 'PNG 图片',
}

/** off = 本机暂未开通、已按能打的参数报价的那一项（稿 14：灰底虚线，旁边写已按什么报价）。 */
export type SummaryRow = { label: string; value: string; fileId?: string; off?: boolean; note?: string }

function fileMeta(file: PrintFileState): string {
  const kind = file.mimeType ? FILE_KIND[file.mimeType] : undefined
  const pages = file.pages === null ? '页数待识别，以实际打印为准' : `共 ${file.pages} 页`
  return [kind, pages, file.size && file.size !== '-' ? file.size : null].filter(Boolean).join(' · ')
}

export function Review({
  file,
  summaryRows,
  redactionText,
  materialDemo,
}: {
  file: PrintFileState
  summaryRows: SummaryRow[]
  redactionText: string | null
  materialDemo: boolean
}) {
  return (
    <div className="pcf-rev" data-testid="print-confirm-review">
      <div className="pcf-rev-file">
        <span className="pcf-rf-ic"><FileTextIcon size={36} aria-hidden="true" /></span>
        <span className="pcf-rf-m">
          <b className="print-file-name">{file.name}</b>
          <span className="print-file-meta">{fileMeta(file)}</span>
          {redactionText ? (
            <span className="pcf-rf-check">
              <ShieldCheckIcon size={18} aria-hidden="true" />
              <b>隐私检查摘要{materialDemo ? '（流程演示）' : ''}</b>
              {materialDemo ? '已完成打印前材料检查流程演示。' : ''}{redactionText}
            </span>
          ) : null}
        </span>
      </div>
      <div className="pcf-rev-grid">
        {summaryRows.map((row) => (
          <div
            key={row.label}
            data-sum-row={row.label}
            data-file-id={row.fileId}
            className={row.off ? 'off' : undefined}
          >
            <span>{row.label}</span>
            <b className="v">{row.off ? <LockIcon size={22} aria-hidden="true" /> : null}{row.value}</b>
            {row.note ? <em>{row.note}</em> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export function AmountCard({ quote, amountText, source }: { quote: QuoteView; amountText: string; source: ReactNode }) {
  const known = quote.status === 'ready'
  return (
    <div className="pcf-amount">
      <div className="pcf-amount-lb">本次应付</div>
      <div
        className={`pcf-amount-row${known ? '' : ' is-msg'}`}
        data-quote-slot="true"
        data-quote-status={known ? 'known' : 'unavailable'}
        data-testid="print-confirm-amount"
      >
        {known ? <span className="cur">¥</span> : null}
        <span className="num">{amountText}</span>
      </div>
      <div className="pcf-amount-src" data-disclaimer="true" data-testid="print-confirm-amount-source">
        {source}
      </div>
    </div>
  )
}

export function FeeLines({ rows }: { rows: Array<{ label: string; value: string; slot?: boolean; cost?: boolean }> }) {
  return (
    <div className="pcf-lines" data-testid="print-confirm-list">
      {rows.map((row) => (
        <div className="pcf-line" key={row.label}>
          <span className="lb">{row.label}</span>
          <span className={`vl${row.slot ? ' slot' : ''}`} data-cost-calc={row.cost ? true : undefined}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

export function CouponUnavailable() {
  return (
    <div className="pcf-coupon-wrap">
      <div className="pcf-coupon" data-coupon="unavailable" data-testid="print-confirm-coupon">
        <span className="c-ic"><TicketIcon size={24} aria-hidden="true" /></span>
        <span className="c-m">
          <b>本单暂无可使用优惠券</b>
          <span>优惠券功能尚未接通：系统还没有下发券面值与适用范围，本机不替你预判，也不试算抵扣。</span>
        </span>
        <span className="c-tag">不使用优惠券</span>
      </div>
      <p className="pcf-coupon-why">本机只展示、不试算、不抵扣，你的券不会因此被扣掉。</p>
    </div>
  )
}

export function BenefitCard({ view, onLogin }: { view: PrintBenefitView; onLogin: () => void }) {
  return (
    <div className="qx-card pcf-benefit" data-benefit-state={view.state}>
      <div className="pcf-benefit-head">
        <TicketIcon size={22} aria-hidden="true" />
        权益与本单价格
        <span className="pcf-benefit-snap">价目与权益均来自机构配置</span>
      </div>
      <p className="pcf-benefit-title">{view.title}</p>
      <p className="pcf-benefit-detail">{view.detail}</p>
      {view.repricedUnits ? (
        <p className="pcf-benefit-detail">
          {`本单报价单价 ¥${(view.repricedUnits.quoteUnitCents / 100).toFixed(2)}，现行公示单价 ¥${(view.repricedUnits.configUnitCents / 100).toFixed(2)}`}
        </p>
      ) : null}
      {view.grants.length > 0 ? (
        <ul className="pcf-benefit-list">
          {view.grants.map((grant: MemberBenefitItem) => (
            <li key={grant.id} className="pcf-benefit-item">
              <b>{grant.title}</b>
              <span>
                {BENEFIT_TYPE_LABEL[grant.benefitType] ?? grant.benefitType}
                {' · '}
                {grant.quantityTotal === null
                  ? `剩余 ${grant.quantityRemaining ?? 0}`
                  : `剩余 ${grant.quantityRemaining ?? 0} / ${grant.quantityTotal}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.showLoginAction || view.state === 'available' ? (
        <div className="pcf-benefit-acts">
          {view.showLoginAction ? (
            <button type="button" className="qx-btn" data-variant="teal" onClick={onLogin}>
              去登录查看我的权益
            </button>
          ) : null}
          {view.state === 'available' ? (
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              aria-disabled="true"
              aria-describedby="print-benefit-redeem-reason"
              data-benefit-redeem="disabled"
            >
              {PRINT_BENEFIT_REDEEM_CTA_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}
      {view.state === 'available' ? (
        <p className="pcf-benefit-reason" id="print-benefit-redeem-reason">{PRINT_BENEFIT_REDEEM_DISABLED_REASON}</p>
      ) : null}
    </div>
  )
}

/** 稿 .cfm：流程三步（可选）→ 说明 → 黄色理由行 → 本屏唯一的错误/价格变更提示 → 动作行。 */
export function ConfirmCard({
  tone,
  flow,
  note,
  reason,
  alert,
  actions,
}: {
  tone?: 'warn' | 'error'
  flow?: boolean
  note: ReactNode
  reason?: string
  alert: string | null
  actions: ReactNode
}) {
  return (
    <div className="pcf-cfm" data-tone={tone}>
      {flow ? (
        <ol className="pcf-flow" aria-label="确认之后会发生什么">
          <li className="cs on"><b>创建订单</b><span>点确认才建单</span></li>
          <li className="ar" aria-hidden="true"><ChevronRightIcon size={20} /></li>
          <li className="cs"><b>完成付款</b><span>付款成功才排队</span></li>
          <li className="ar" aria-hidden="true"><ChevronRightIcon size={20} /></li>
          <li className="cs"><b>开始打印</b><span>出纸口取件</span></li>
        </ol>
      ) : null}
      <div className="pcf-cfm-note">{note}</div>
      {reason ? <div className="pcf-cfm-reason" data-testid="print-confirm-disabled-reason">{reason}</div> : null}
      {alert ? (
        <div className="pcf-alert pcf-cfm-alert" data-tone="error" role="alert">
          <AlertCircleIcon size={22} aria-hidden="true" />
          <span>{alert}</span>
        </div>
      ) : null}
      <div className="pcf-act">{actions}</div>
      <div className="pcf-airow">
        <PrintAiHelp
          label="问小青：帮我看费用明细 →"
          draft="请告诉我打印报价应该核对哪些项目，怎样确认页数、份数和费用是否一致？"
        />
      </div>
    </div>
  )
}

export function Sec({ no, title, hint, children }: { no: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="pcf-sec" aria-label={title}>
      <div className="pcf-sec-h">
        <span className="no" aria-hidden="true">{no}</span>
        <h2 className="t">{title}</h2>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

export function Chips({ items }: { items: Array<string | { text: string; tone: 'warn' | 'live' }> }) {
  return (
    <div className="pcf-chips">
      {items.map((item) => {
        const text = typeof item === 'string' ? item : item.text
        const tone = typeof item === 'string' ? undefined : item.tone
        return (
          <span key={text} className={`pcf-chip${tone === 'warn' ? ' warn' : ''}`}>
            {tone === 'live' ? <span className="pcf-dot pcf-breathe" aria-hidden="true" /> : null}
            {text}
          </span>
        )
      })}
    </div>
  )
}

export function Plan({ items }: { items: string[] }) {
  return (
    <ul className="pcf-plan">
      {items.map((item) => <li key={item}><span className="sq" aria-hidden="true" /><span>{item}</span></li>)}
    </ul>
  )
}

