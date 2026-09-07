import type { ReactNode } from 'react'
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileTextIcon,
  InfoIcon,
  LockIcon,
  TicketIcon,
} from 'lucide-react'
import type { MemberBenefitItem, PrintJobParams } from '@ai-job-print/shared'
import type { PrintBenefitView } from '../../../services/api/benefits'
import {
  PRINT_BENEFIT_REDEEM_CTA_LABEL,
  PRINT_BENEFIT_REDEEM_DISABLED_REASON,
} from '../../../services/api/benefits'
import { ASK, COLOR_MODE_LABEL, DUPLEX_LABEL, type PrintConfirmScreen, type QuoteView } from '../printConfirmModel'
import type { PrintFileState } from '../printMaterialSession'

const STEPS = ['选文件', '材料检查', '预览与参数', '报价确认'] as const
const BENEFIT_TYPE_LABEL: Record<string, string> = {
  coupon: '优惠券',
  free_quota: '免费次数',
  package_entitlement: '服务额度',
  subsidy_eligibility_hint: '政策资格提示',
}

export type SummaryRow = { label: string; value: string }

type Props = {
  step: 4
  screen: PrintConfirmScreen
  invalidReason: string
  file: PrintFileState
  summaryRows: SummaryRow[]
  incomingParams: PrintJobParams
  colorOff: boolean
  duplexOff: boolean
  quote: QuoteView
  costCalcLabel: string
  amountText: string
  benefitView: PrintBenefitView | null
  redactionText: string | null
  materialDemo: boolean
  printerBlocked: boolean
  printerBlockedReason: string
  terminalFailed: boolean
  terminalFailedText: string
  paramsWereRestricted: boolean
  selfAssessment: ReactNode
  submitError: string | null
  onLogin: () => void
}

function Steps({ idle, step }: { idle: boolean; step: 4 }) {
  return (
    <div className="pcf-steps" aria-label="打印流程">
      {STEPS.map((label, index) => {
        const indexStep = index + 1
        const state = idle ? '' : indexStep < step ? 'done' : indexStep === step ? 'on' : ''
        return (
          <div key={label} className="pcf-step" data-state={state || undefined}>
            <i aria-hidden="true" />
            {label}
          </div>
        )
      })}
    </div>
  )
}

function Advisor({ screen }: { screen: PrintConfirmScreen }) {
  const ask = ASK[screen]
  return (
    <section className="pcf-xq">
      <div className="pcf-xq-row">
        <div className="pcf-xq-face" aria-hidden="true">青</div>
        <div>
          <div className="pcf-xq-eyebrow">QUOTE &amp; CONFIRM</div>
          <p className="pcf-xq-ask">{ask.title}</p>
          <p className="pcf-xq-doing">{ask.doing}</p>
        </div>
      </div>
    </section>
  )
}

function Review({
  file,
  summaryRows,
  colorOff,
  duplexOff,
}: {
  file: PrintFileState
  summaryRows: SummaryRow[]
  colorOff: boolean
  duplexOff: boolean
}) {
  const offFor = (label: string) =>
    (label === '色彩模式' && colorOff) || (label === '单双面' && duplexOff)
  return (
    <div className="pcf-rev" data-testid="print-confirm-review">
      <div className="pcf-rev-file">
        <span className="pcf-rf-ic"><FileTextIcon size={36} aria-hidden="true" /></span>
        <span className="pcf-rf-m">
          <b className="print-file-name">{file.name}</b>
          <span className="print-file-meta">
            {file.size}
            {file.pages !== null ? ` · ${file.pages} 页` : ''}
          </span>
        </span>
      </div>
      <div className="pcf-rev-grid">
        {summaryRows.map((row) => (
          <div key={row.label} data-sum-row={row.label} className={offFor(row.label) ? 'off' : undefined}>
            <span>{row.label}</span>
            <b className={`v${row.label === '文件编号' ? ' id' : ''}`}>{row.value}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function AmountCard({
  quote,
  amountText,
  label,
  source,
}: {
  quote: QuoteView
  amountText: string
  label: string
  source: ReactNode
}) {
  const known = quote.status === 'ready'
  return (
    <div className="pcf-amount">
      <div className="pcf-amount-lb">{label}</div>
      <div
        className={`pcf-amount-row${known ? '' : ' is-msg'}`}
        data-quote-slot="true"
        data-quote-status={known ? 'known' : 'unavailable'}
        data-testid="print-confirm-amount"
      >
        {known ? <span className="cur">¥</span> : null}
        <span className="num">{known ? amountText : amountText}</span>
      </div>
      <div className="pcf-amount-src" data-disclaimer="true" data-testid="print-confirm-amount-source">
        {source}
      </div>
    </div>
  )
}

function FeeLines({ rows }: { rows: Array<{ label: string; value: string; slot?: boolean; testId?: string }> }) {
  return (
    <div className="pcf-lines" data-testid="print-confirm-list">
      {rows.map((row) => (
        <div className="pcf-line" key={row.label}>
          <span className="lb">{row.label}</span>
          <span className={`vl${row.slot ? ' slot' : ''}`} data-cost-calc={row.testId === 'cost' ? true : undefined}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function CouponUnavailable() {
  return (
    <>
      <div className="pcf-coupon" data-coupon="unavailable" data-testid="print-confirm-coupon">
        <span className="c-ic"><TicketIcon size={24} aria-hidden="true" /></span>
        <span className="c-m">
          <b>本单暂无可使用优惠券</b>
          <span>优惠券功能尚未接通：服务端还没有下发券面值与适用范围，本机不替你预判，也不试算抵扣。</span>
        </span>
        <span className="c-tag">不使用优惠券</span>
      </div>
      <p className="pcf-coupon-why">本机只展示、不试算、不抵扣，你的券不会因此被扣掉。</p>
    </>
  )
}

function BenefitCard({
  view,
  onLogin,
}: {
  view: PrintBenefitView
  onLogin: () => void
}) {
  return (
    <div className="qx-card pcf-benefit" data-benefit-state={view.state}>
      <div className="pcf-benefit-head">
        <TicketIcon size={22} aria-hidden="true" />
        权益与本单价格
        <span className="pcf-benefit-snap">价目与权益均来自后台配置</span>
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
      {view.showLoginAction ? (
        <button type="button" className="qx-btn" data-variant="teal" onClick={onLogin} style={{ marginTop: 12 }}>
          去登录查看我的权益
        </button>
      ) : null}
      {view.state === 'available' ? (
        <>
          <button
            type="button"
            className="qx-btn"
            data-variant="ghost"
            aria-disabled="true"
            aria-describedby="print-benefit-redeem-reason"
            data-benefit-redeem="disabled"
            style={{ marginTop: 12 }}
          >
            {PRINT_BENEFIT_REDEEM_CTA_LABEL}
          </button>
          <p className="pcf-benefit-reason" id="print-benefit-redeem-reason">
            {PRINT_BENEFIT_REDEEM_DISABLED_REASON}
          </p>
        </>
      ) : null}
    </div>
  )
}

function ConfirmNote({
  tone,
  flow,
  note,
  reason,
}: {
  tone?: 'warn' | 'error'
  flow?: boolean
  note: ReactNode
  reason?: string
}) {
  return (
    <div className="pcf-cfm" data-tone={tone}>
      {flow ? (
        <div className="pcf-flow">
          <div className="cs on"><b>创建订单</b><span>点确认才建单</span></div>
          <span className="ar"><ChevronRightIcon size={20} aria-hidden="true" /></span>
          <div className="cs"><b>完成付款</b><span>付款成功才排队</span></div>
          <span className="ar"><ChevronRightIcon size={20} aria-hidden="true" /></span>
          <div className="cs"><b>开始打印</b><span>出纸口取件</span></div>
        </div>
      ) : null}
      <div className="pcf-cfm-note">{note}</div>
      {reason ? (
        <div className="pcf-cfm-reason" data-testid="print-confirm-disabled-reason">{reason}</div>
      ) : null}
    </div>
  )
}

function Truth() {
  return (
    <div className="pcf-truth" data-disclaimer="true" data-testid="print-confirm-truth">
      <div><b>金额</b>只认服务端返回的正式报价；拿不到就不显示具体数字。</div>
      <div><b>权益</b>核销要等服务端结果；没通过就按原价走，不会先按抵扣算给你看。</div>
      <div><b>建单</b>点确认才会真正建单，零元单也一样先建单，再走后面的流程。</div>
    </div>
  )
}

function Sec({ no, title, hint, children }: { no: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="pcf-sec">
      <div className="pcf-sec-h">
        <span className="no">{no}</span>
        <span className="t">{title}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

export function PrintConfirmView(props: Props) {
  const {
    screen,
    invalidReason,
    file,
    summaryRows,
    incomingParams,
    colorOff,
    duplexOff,
    quote,
    costCalcLabel,
    amountText,
    benefitView,
    redactionText,
    materialDemo,
    printerBlocked,
    printerBlockedReason,
    terminalFailed,
    terminalFailedText,
    paramsWereRestricted,
    selfAssessment,
    submitError,
    onLogin,
  } = props
  const idle = screen === 'missing-context' || screen === 'invalid-context'
  const knownAmount = quote.status === 'ready' ? amountText : quote.status === 'loading' || quote.status === 'demo' ? (quote.status === 'demo' ? '演示模式不显示金额' : '正在获取金额') : '金额暂不可用'

  return (
    <div
      className="qx-scroll pcf-page qx-grow"
      data-w2-page="print-confirm"
      data-state={screen}
      data-testid={`print-confirm-state-${screen}`}
    >
      <Advisor screen={screen} />
      <Steps idle={idle} step={props.step} />

      {printerBlocked && !idle ? <div className="pcf-alert" role="status">{printerBlockedReason}</div> : null}
      {terminalFailed ? <div className="pcf-alert" data-tone="error" role="alert">{terminalFailedText}</div> : null}
      {paramsWereRestricted && screen !== 'capability-invalid-params' ? (
        <div className="pcf-alert">参数已按本机已验证能力收口。收口后的参数才参与报价。</div>
      ) : null}

      {screen === 'missing-context' ? (
        <>
          <Sec no="01" title="这一页现在没有任务" hint="缺少文件与参数上下文">
            <div className="qx-state" data-tone="empty" data-testid="print-confirm-fallback">
              <span className="qx-state-ic"><FileTextIcon size={28} aria-hidden="true" /></span>
              <div>
                <div className="qx-state-t">未找到文件信息</div>
                <div className="qx-state-d">
                  这一页要有<b>已选好的文件和参数</b>才能报价。现在两样都不在，所以屏幕上<b>没有金额，也没有可以确认的订单</b>。请重新上传文件后再确认打印。
                </div>
                <div className="pcf-chips">
                  <span className="pcf-chip">未建单</span>
                  <span className="pcf-chip">未扣费</span>
                  <span className="pcf-chip">没有金额可显示</span>
                </div>
              </div>
            </div>
          </Sec>
          <Sec no="02" title="重新走一遍要准备什么" hint="回上一步就能补齐">
            <div className="pcf-grid2">
              <div className="pcf-pgrp">
                <h4>需要的两样上下文</h4>
                <ul className="pcf-plan">
                  <li><span className="sq" /><span>要打印的文件：本机上传、手机传来或扫描生成都行。</span></li>
                  <li><span className="sq" /><span>这一份的打印参数：纸张、颜色、单双面、份数。</span></li>
                  <li><span className="sq" /><span>两样齐了才能向服务端要这一单的正式报价。</span></li>
                </ul>
              </div>
              <div className="pcf-pgrp">
                <h4>回去重走不会重复收费</h4>
                <p className="qx-state-d">刚才这一趟<b>没有创建订单，也没有扣款</b>，所以重新选文件不会产生第二笔费用。</p>
              </div>
            </div>
          </Sec>
          <Sec no="03" title="现在可以去哪">
            <ConfirmNote note="先回上一步把文件和参数选好，回到这一页才会有正式报价。" />
          </Sec>
        </>
      ) : null}

      {screen === 'invalid-context' ? (
        <>
          <Sec no="01" title="这一单没法确认" hint="交接内容没通过登记核对">
            <div className="qx-state" data-tone="error" data-testid="print-confirm-fallback">
              <span className="qx-state-ic"><LockIcon size={28} aria-hidden="true" /></span>
              <div>
                <div className="qx-state-t">交接内容没通过核对</div>
                <div className="qx-state-d" data-testid="print-confirm-invalid-reason">{invalidReason}</div>
                <div className="qx-state-d">本页不按地址栏猜文件名、页数和大小，也不退回默认那一份假装一切正常。</div>
                <div className="pcf-chips">
                  <span className="pcf-chip">未建单</span>
                  <span className="pcf-chip">未扣费</span>
                  <span className="pcf-chip">没有金额可显示</span>
                  <span className="pcf-chip">没有文件信息可显示</span>
                </div>
              </div>
            </div>
          </Sec>
          <Sec no="02" title="这一趟没有发生什么" hint="停在这里只花时间，不花钱">
            <div className="pcf-grid2">
              <div className="pcf-pgrp">
                <h4>没有产生任何结果</h4>
                <ul className="pcf-plan">
                  <li><span className="sq" /><span>没有创建打印订单，也没有订单号。</span></li>
                  <li><span className="sq" /><span>没有扣款，也没有向任何支付通道发起过收款。</span></li>
                  <li><span className="sq" /><span>没有生成打印任务，打印机不会因为这一屏动一下。</span></li>
                </ul>
              </div>
              <div className="pcf-pgrp">
                <h4>为什么不先给你一份默认文件</h4>
                <p className="qx-state-d">按地址栏随便认一份，屏幕上会立刻多出文件名、页数和金额，但那一份很可能不是你要打的东西。</p>
              </div>
            </div>
          </Sec>
          <Sec no="03" title="现在可以去哪" hint="回到有文件的那一步">
            <ConfirmNote tone="error" note="重新从有文件的那一步进来，这一页才会有可以确认的一单。这一趟没有创建订单，也没有扣款。" />
          </Sec>
        </>
      ) : null}

      {screen === 'capability-invalid-params' ? (
        <>
          <Sec no="01" title="核对打印内容" hint="标红的项本机暂不可用">
            <Review
              file={file}
              summaryRows={summaryRows.map((row) => {
                if (row.label === '色彩模式' && colorOff) {
                  return { ...row, value: `${COLOR_MODE_LABEL[incomingParams.colorMode] ?? incomingParams.colorMode} · 暂不可用` }
                }
                if (row.label === '单双面' && duplexOff) {
                  return { ...row, value: `${DUPLEX_LABEL[incomingParams.duplex] ?? incomingParams.duplex} · 暂不可用` }
                }
                return row
              })}
              colorOff={colorOff}
              duplexOff={duplexOff}
            />
          </Sec>
          <Sec no="02" title="费用明细" hint="参数不可用时服务端不出报价">
            <div className="pcf-fee">
              <AmountCard quote={{ status: 'unavailable', reason: '' }} amountText="金额暂不可用" label="本次应付" source="当前参数不可用，请修改后重新获取报价。" />
              <FeeLines rows={[
                ...(colorOff ? [{ label: '颜色', value: `${COLOR_MODE_LABEL[incomingParams.colorMode] ?? incomingParams.colorMode} · 暂不可用` }] : []),
                ...(duplexOff ? [{ label: '单双面', value: `${DUPLEX_LABEL[incomingParams.duplex] ?? incomingParams.duplex} · 暂不可用` }] : []),
                { label: '计价来源', value: '未出报价', slot: true },
                { label: '小计', value: '无法显示', slot: true },
              ]} />
            </div>
            <div className="pcf-grid2">
              <div className="pcf-pgrp">
                <h4>为什么被挡下</h4>
                {colorOff ? <p className="pcf-reason">本机彩色打印尚未通过真机验证，暂不能按彩色下单</p> : null}
                {duplexOff ? <p className="pcf-reason">本机双面尚未通过真机验证，暂不能按双面下单</p> : null}
                <p className="qx-state-d">参数已按本机已验证能力收口。改回黑白单面才能继续报价。</p>
              </div>
              <div className="pcf-pgrp">
                <h4>改回黑白单面就能继续</h4>
                <p className="qx-state-d">回上一步把颜色改成黑白、单双面改成单面，再回来重新获取报价。</p>
                <div className="pcf-chips">
                  <span className="pcf-chip">未建单</span>
                  <span className="pcf-chip">未扣费</span>
                  <span className="pcf-chip warn">回到黑白单面可继续</span>
                </div>
              </div>
            </div>
          </Sec>
          <Sec no="03" title="确认并付款" hint="参数修改后才可继续">
            <ConfirmNote
              tone="warn"
              note="当前参数被服务端按本机能力登记拒绝，这一页拿不到金额，也不会创建订单。"
              reason="参数回到黑白单面再报价，才能确认这一单"
            />
          </Sec>
        </>
      ) : null}

      {screen === 'quoting' || screen === 'quoted' || screen === 'quote-failed' || screen === 'benefit-unverified' || screen === 'zero-amount' ? (
        <>
          <Sec no="01" title="核对打印内容" hint={screen === 'quoting' ? undefined : screen === 'quote-failed' ? '文件和参数都保留着' : undefined}>
            <Review file={file} summaryRows={summaryRows} colorOff={false} duplexOff={false} />
          </Sec>
          <Sec
            no="02"
            title="费用明细"
            hint={
              screen === 'quoting' ? '正在向服务端要这一单的报价'
                : screen === 'quote-failed' ? '这一次没有拿到报价'
                  : screen === 'zero-amount' ? '零元单也要先建单'
                    : '金额以服务端返回为准'
            }
          >
            <div className="pcf-fee">
              <AmountCard
                quote={quote}
                amountText={knownAmount.replace(/^¥/, '')}
                label={screen === 'quoted' || screen === 'benefit-unverified' || screen === 'zero-amount' ? '本次应付' : '本次应付'}
                source={
                  quote.status === 'ready'
                    ? <>金额来自服务端 <b>POST /orders/quote</b>，本机不估价。</>
                    : quote.status === 'demo'
                      ? '演示模式不显示金额'
                      : quote.status === 'unavailable'
                        ? quote.reason
                        : '金额确认前不会创建订单，也不会扣款。'
                }
              />
              <FeeLines rows={[
                {
                  label: '计费页数',
                  value: quote.status === 'ready' ? `${quote.billablePages} 页` : quote.status === 'loading' ? '正在计算' : '未获取',
                  slot: quote.status !== 'ready',
                },
                {
                  label: '计费方式',
                  value: costCalcLabel,
                  slot: quote.status !== 'ready',
                  testId: 'cost',
                },
                {
                  label: '权益抵扣',
                  value: screen === 'benefit-unverified' ? '未核销，按原价' : '等报价返回后由服务端裁定',
                  slot: true,
                },
                {
                  label: '小计',
                  value: quote.status === 'ready' ? `¥${amountText}` : quote.status === 'unavailable' ? '无法显示' : '等待报价',
                  slot: quote.status !== 'ready',
                },
              ]} />
            </div>
            {screen === 'quoting' ? (
              <div className="pcf-chips">
                <span className="pcf-chip"><span className="pcf-dot pcf-breathe" />正在获取报价</span>
                <span className="pcf-chip">尚未创建订单</span>
                <span className="pcf-chip">尚未扣费</span>
              </div>
            ) : null}
            {screen === 'quote-failed' ? (
              <div className="pcf-grid2">
                <div className="pcf-pgrp">
                  <h4>可能的原因</h4>
                  <ul className="pcf-plan">
                    <li><span className="sq" /><span>本机与服务端之间网络中断。</span></li>
                    <li><span className="sq" /><span>参数里有本机没验过的项，服务端直接拒绝报价。</span></li>
                  </ul>
                </div>
                <div className="pcf-pgrp">
                  <h4>这一趟保留了什么</h4>
                  <p className="qx-state-d">文件、参数和这一步的上下文都还在。<b>本次没有创建订单，也不会扣款。</b></p>
                  <div className="pcf-chips">
                    <span className="pcf-chip">未建单</span>
                    <span className="pcf-chip">未扣费</span>
                    <span className="pcf-chip">文件与参数保留</span>
                  </div>
                </div>
              </div>
            ) : null}
            {screen === 'zero-amount' ? (
              <div className="pcf-grid2">
                <div className="pcf-pgrp">
                  <h4>计费页数怎么来的</h4>
                  <p className="qx-state-d">计费页数和计价依据都由服务端报价返回。本机不按屏幕上看到的页数自己计算。</p>
                </div>
                <div className="pcf-pgrp" data-testid="print-confirm-fallback">
                  <h4>零元单也要先建单</h4>
                  <p className="qx-state-d">确认后仍会建单再释放打印，<b>不存在「不建单直接出纸」的路径</b>。</p>
                </div>
              </div>
            ) : null}
            {screen === 'quoted' || screen === 'zero-amount' || screen === 'benefit-unverified' ? (
              <div style={{ marginTop: 14 }}><CouponUnavailable /></div>
            ) : null}
            {redactionText ? (
              <div className="qx-card" style={{ marginTop: 14 }}>
                <div className="pcf-benefit-head"><InfoIcon size={20} aria-hidden="true" />隐私检查摘要{materialDemo ? '（流程演示）' : ''}</div>
                <p className="pcf-benefit-detail">{materialDemo ? '已完成打印前材料检查流程演示。' : ''}{redactionText}。</p>
              </div>
            ) : null}
            {benefitView ? <BenefitCard view={benefitView} onLogin={onLogin} /> : null}
            {selfAssessment}
          </Sec>
          <Sec
            no="03"
            title={screen === 'zero-amount' ? '确认并建单' : screen === 'quote-failed' ? '现在可以怎么办' : '确认并付款'}
            hint={
              screen === 'quoting' ? '金额确认后才可继续'
                : screen === 'quote-failed' ? '重试或改参数'
                  : undefined
            }
          >
            {screen === 'quoting' ? (
              <ConfirmNote
                flow
                note="文件和参数已经保留。金额确认前不会创建订单，也不会扣款。"
                reason="金额尚未确认 —— 报价回来之前不能建单"
              />
            ) : screen === 'quote-failed' ? (
              <ConfirmNote
                tone="error"
                note="重新报价只是再问服务端一次，不会重复建单，也不会重复扣款。改过参数之后同样要重新报价。"
              />
            ) : screen === 'zero-amount' ? (
              <ConfirmNote
                note="金额为 0 时，确认后仍会创建打印订单，再直接进入打印流程。"
              />
            ) : screen === 'benefit-unverified' ? (
              <ConfirmNote
                tone="warn"
                note="核销没通过时按实际原价继续。本机不会先按抵扣后的价格显示给你看。"
              />
            ) : (
              <ConfirmNote
                flow
                note="确认后会创建订单并进入付款，付款完成后才开始打印。"
              />
            )}
          </Sec>
        </>
      ) : null}

      {submitError ? (
        <div className="pcf-alert" data-tone="error" role="alert">
          <AlertCircleIcon size={20} aria-hidden="true" /> {submitError}
        </div>
      ) : null}

      <Truth />
    </div>
  )
}
