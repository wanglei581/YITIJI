import type { ReactNode } from 'react'
import {
  AlertCircleIcon,
  ChevronRightIcon,
  FileTextIcon,
  LockIcon,
  ShieldCheckIcon,
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

// 报价确认页（原型 14-print-confirm.html）的展示件：小青区 → 四步条 → 01 核对打印内容 →
// 02 费用明细 → 03 确认（动作在卡内）→ 权益卡 → 打印须知 → 三条规矩。只摆页面算好的数据与回调；
// 报价、建单、终端能力收口与地址栏清洗都在 PrintConfirmPage / printConfirmQuery 里。

const STEPS = ['选文件', '材料检查', '预览与参数', '报价确认'] as const
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
  /** 附加自我探索的勾选卡：改的是「打印什么」，放在 01 里、确认键之前。 */
  selfAssessment: ReactNode
  /** 打印须知：确认之后才用得上的操作提醒，排在 03 之后。 */
  printNotes: ReactNode
  /** 03 卡内动作行（稿 .cfm-act）：返回 / 主操作，由页面按本屏状态给出。 */
  actions: ReactNode
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
          <div key={label} className="pcf-step" data-state={state || undefined} aria-current={state === 'on' ? 'step' : undefined}>
            <i aria-hidden="true" />
            {label}
          </div>
        )
      })}
    </div>
  )
}

function Advisor({ screen }: { screen: PrintConfirmScreen }) {
  const { title, doing } = ASK[screen]
  return (
    <section className="pcf-xq" aria-label="小青提示">
      <div className="pcf-xq-row">
        <div className="pcf-xq-face" aria-hidden="true">青</div>
        <div className="pcf-xq-main">
          <div className="pcf-xq-eyebrow" aria-hidden="true">QUOTE &amp; CONFIRM</div>
          <p className="pcf-xq-ask">{title[0]}<em>{title[1]}</em>{title[2]}</p>
          <p className="pcf-xq-doing">{doing}</p>
        </div>
      </div>
    </section>
  )
}

function fileMeta(file: PrintFileState): string {
  const kind = file.mimeType ? FILE_KIND[file.mimeType] : undefined
  const pages = file.pages === null ? '页数待识别，以实际打印为准' : `共 ${file.pages} 页`
  return [kind, pages, file.size && file.size !== '-' ? file.size : null].filter(Boolean).join(' · ')
}

function Review({
  file,
  summaryRows,
  colorOff,
  duplexOff,
  redactionText,
  materialDemo,
}: {
  file: PrintFileState
  summaryRows: SummaryRow[]
  colorOff: boolean
  duplexOff: boolean
  redactionText: string | null
  materialDemo: boolean
}) {
  const offFor = (label: string) =>
    (label === '色彩模式' && colorOff) || (label === '单双面' && duplexOff)
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
          <div key={row.label} data-sum-row={row.label} className={offFor(row.label) ? 'off' : undefined}>
            <span>{row.label}</span>
            <b className={`v${row.label === '文件编号' ? ' id' : ''}`}>{row.value}</b>
          </div>
        ))}
      </div>
    </div>
  )
}

function AmountCard({ quote, amountText, source }: { quote: QuoteView; amountText: string; source: ReactNode }) {
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

function FeeLines({ rows }: { rows: Array<{ label: string; value: string; slot?: boolean; cost?: boolean }> }) {
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

function CouponUnavailable() {
  return (
    <div className="pcf-coupon-wrap">
      <div className="pcf-coupon" data-coupon="unavailable" data-testid="print-confirm-coupon">
        <span className="c-ic"><TicketIcon size={24} aria-hidden="true" /></span>
        <span className="c-m">
          <b>本单暂无可使用优惠券</b>
          <span>优惠券功能尚未接通：服务端还没有下发券面值与适用范围，本机不替你预判，也不试算抵扣。</span>
        </span>
        <span className="c-tag">不使用优惠券</span>
      </div>
      <p className="pcf-coupon-why">本机只展示、不试算、不抵扣，你的券不会因此被扣掉。</p>
    </div>
  )
}

function BenefitCard({ view, onLogin }: { view: PrintBenefitView; onLogin: () => void }) {
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
function ConfirmCard({
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

function Chips({ items }: { items: Array<string | { text: string; tone: 'warn' | 'live' }> }) {
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

function Plan({ items }: { items: string[] }) {
  return (
    <ul className="pcf-plan">
      {items.map((item) => <li key={item}><span className="sq" aria-hidden="true" /><span>{item}</span></li>)}
    </ul>
  )
}

export function PrintConfirmView(props: Props) {
  const {
    screen, invalidReason, file, summaryRows, incomingParams, colorOff, duplexOff, quote, costCalcLabel,
    amountText, benefitView, redactionText, materialDemo, printerBlocked, printerBlockedReason,
    terminalFailed, terminalFailedText, paramsWereRestricted, selfAssessment, printNotes, actions,
    submitError, onLogin,
  } = props
  const idle = screen === 'missing-context' || screen === 'invalid-context'
  const quotedLike = screen === 'quoted' || screen === 'benefit-unverified' || screen === 'zero-amount'
  const amountShown = quote.status === 'ready'
    ? amountText
    : quote.status === 'demo' ? '演示模式不显示金额' : quote.status === 'loading' ? '正在获取金额' : '金额暂不可用'
  const offValue = (kind: 'color' | 'duplex') => kind === 'color'
    ? `${COLOR_MODE_LABEL[incomingParams.colorMode] ?? incomingParams.colorMode} · 暂不可用`
    : `${DUPLEX_LABEL[incomingParams.duplex] ?? incomingParams.duplex} · 暂不可用`

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
            <div className="pcf-state" data-tone="warn" data-testid="print-confirm-fallback">
              <h3><FileTextIcon size={26} aria-hidden="true" />未找到文件信息</h3>
              <p>这一页要有<b>已选好的文件和参数</b>才能报价。现在两样都不在，所以屏幕上<b>没有金额，也没有可以确认的订单</b>。请重新上传文件后再确认打印。</p>
              <p>这里不放示例金额，免得你以为真有一单在等着付款。</p>
              <Chips items={['未建单', '未扣费', '没有金额可显示']} />
            </div>
          </Sec>
          <Sec no="02" title="重新走一遍要准备什么" hint="回上一步就能补齐">
            <div className="pcf-grid2">
              <div className="pcf-pgrp">
                <h4>需要的两样上下文</h4>
                <Plan items={[
                  '要打印的文件：本机上传、手机传来或扫描生成都行。',
                  '这一份的打印参数：纸张、颜色、单双面、份数。',
                  '两样齐了才能向服务端要这一单的正式报价。',
                ]} />
              </div>
              <div className="pcf-pgrp">
                <h4>回去重走不会重复收费</h4>
                <p>刚才这一趟<b>没有创建订单，也没有扣款</b>，所以重新选文件不会产生第二笔费用。</p>
                <p>想核对以前的单子，可以去「我的打印订单」按订单号查。</p>
              </div>
            </div>
          </Sec>
          <Sec no="03" title="现在可以去哪">
            <ConfirmCard note={<>先回上一步把文件和参数选好，<b>回到这一页才会有正式报价</b>。</>} alert={submitError} actions={actions} />
          </Sec>
        </>
      ) : null}

      {screen === 'invalid-context' ? (
        <>
          <Sec no="01" title="这一单没法确认" hint="交接内容没通过登记核对">
            <div className="pcf-state" data-tone="error" data-testid="print-confirm-fallback">
              <h3><LockIcon size={26} aria-hidden="true" />交接内容没通过核对</h3>
              <p data-testid="print-confirm-invalid-reason">{invalidReason}</p>
              <p>本页<b>不按地址栏猜文件名、页数和大小</b>，也<b>不退回默认那一份</b>假装一切正常。</p>
              <Chips items={['未建单', '未扣费', '没有金额可显示', '没有文件信息可显示']} />
            </div>
          </Sec>
          <Sec no="02" title="这一趟没有发生什么" hint="停在这里只花时间，不花钱">
            <div className="pcf-grid2">
              <div className="pcf-pgrp">
                <h4>没有产生任何结果</h4>
                <Plan items={[
                  '没有创建打印订单，也没有订单号。',
                  '没有扣款，也没有向任何支付通道发起过收款。',
                  '没有生成打印任务，打印机不会因为这一屏动一下。',
                ]} />
              </div>
              <div className="pcf-pgrp">
                <h4>为什么不先给你一份默认文件</h4>
                <p>按地址栏随便认一份，屏幕上会立刻多出文件名、页数和金额，但那一份<b>很可能不是你要打的东西</b>。</p>
                <Chips items={['不猜文件', '不套默认值', '不预告金额']} />
              </div>
            </div>
          </Sec>
          <Sec no="03" title="现在可以去哪" hint="回到有文件的那一步">
            <ConfirmCard
              tone="error"
              note={<>重新从<b>有文件的那一步</b>进来，这一页才会有可以确认的一单。这一趟<b>没有创建订单，也没有扣款</b>。</>}
              alert={submitError}
              actions={actions}
            />
          </Sec>
        </>
      ) : null}

      {screen === 'capability-invalid-params' ? (
        <>
          <Sec no="01" title="核对打印内容" hint="标红的项本机暂不可用">
            <Review
              file={file}
              summaryRows={summaryRows.map((row) =>
                row.label === '色彩模式' && colorOff ? { ...row, value: offValue('color') }
                  : row.label === '单双面' && duplexOff ? { ...row, value: offValue('duplex') }
                    : row)}
              colorOff={colorOff}
              duplexOff={duplexOff}
              redactionText={redactionText}
              materialDemo={materialDemo}
            />
          </Sec>
          <Sec no="02" title="费用明细" hint="参数不可用时服务端不出报价">
            <div className="pcf-fee">
              <AmountCard quote={{ status: 'unavailable', reason: '' }} amountText="金额暂不可用" source="当前参数不可用，请修改后重新获取报价。" />
              <FeeLines rows={[
                ...(colorOff ? [{ label: '颜色', value: offValue('color') }] : []),
                ...(duplexOff ? [{ label: '单双面', value: offValue('duplex') }] : []),
                { label: '计价来源', value: '未出报价', slot: true },
                { label: '小计', value: '无法显示', slot: true },
              ]} />
            </div>
            <div className="pcf-grid2">
              <div className="pcf-pgrp">
                <h4>为什么被挡下</h4>
                {colorOff ? <p className="pcf-reason">本机彩色打印尚未通过真机验证，暂不能按彩色下单</p> : null}
                {duplexOff ? <p className="pcf-reason">本机双面尚未通过真机验证，暂不能按双面下单</p> : null}
                <p>参数已按本机已验证能力收口。改回黑白单面才能继续报价。</p>
              </div>
              <div className="pcf-pgrp">
                <h4>改回黑白单面就能继续</h4>
                <p>回上一步把颜色改成<b>黑白</b>、单双面改成<b>单面</b>，再回来重新获取报价。</p>
                <Chips items={['未建单', '未扣费', { text: '回到黑白单面可继续', tone: 'warn' }]} />
              </div>
            </div>
          </Sec>
          <Sec no="03" title="确认并付款" hint="参数修改后才可继续">
            <ConfirmCard
              tone="warn"
              note={<>当前参数被服务端按本机能力登记拒绝，<b>这一页拿不到金额，也不会创建订单</b>。</>}
              reason="参数回到黑白单面再报价，才能确认这一单"
              alert={submitError}
              actions={actions}
            />
          </Sec>
        </>
      ) : null}

      {screen === 'quoting' || screen === 'quote-failed' || quotedLike ? (
        <>
          <Sec no="01" title="核对打印内容" hint={screen === 'quote-failed' ? '文件和参数都保留着' : undefined}>
            <Review
              file={file}
              summaryRows={summaryRows}
              colorOff={false}
              duplexOff={false}
              redactionText={redactionText}
              materialDemo={materialDemo}
            />
            {selfAssessment}
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
                amountText={amountShown.replace(/^¥/, '')}
                source={
                  quote.status === 'ready'
                    ? <>金额由服务端报价返回，本机不估价。</>
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
                { label: '计费方式', value: costCalcLabel, slot: quote.status !== 'ready', cost: true },
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
              <Chips items={[{ text: '正在获取报价', tone: 'live' }, '尚未创建订单', '尚未扣费']} />
            ) : null}
            {screen === 'quote-failed' ? (
              <div className="pcf-grid2">
                <div className="pcf-pgrp">
                  <h4>可能的原因</h4>
                  <Plan items={['本机与服务端之间网络中断。', '参数里有本机没验过的项，服务端直接拒绝报价。']} />
                </div>
                <div className="pcf-pgrp">
                  <h4>这一趟保留了什么</h4>
                  <p>文件、参数和这一步的上下文都还在。<b>本次没有创建订单，也不会扣款。</b></p>
                  <Chips items={['未建单', '未扣费', '文件与参数保留']} />
                </div>
              </div>
            ) : null}
            {quotedLike ? <CouponUnavailable /> : null}
            {screen === 'zero-amount' ? (
              <div className="pcf-grid2">
                <div className="pcf-pgrp">
                  <h4>计费页数怎么来的</h4>
                  <p>计费页数和计价依据都由服务端报价返回。本机不按屏幕上看到的页数自己计算。</p>
                </div>
                <div className="pcf-pgrp" data-testid="print-confirm-fallback">
                  <h4>零元单也要先建单</h4>
                  <p>确认后仍会建单再释放打印，<b>不存在「不建单直接出纸」的路径</b>。</p>
                </div>
              </div>
            ) : null}
          </Sec>
          <Sec
            no="03"
            title={screen === 'zero-amount' ? '确认并建单' : screen === 'quote-failed' ? '现在可以怎么办' : '确认并付款'}
            hint={screen === 'quoting' ? '金额确认后才可继续' : screen === 'quote-failed' ? '重试或改参数' : undefined}
          >
            {screen === 'quoting' ? (
              <ConfirmCard
                flow
                note={<>文件和参数已经保留。<b>金额确认前不会创建订单，也不会扣款。</b></>}
                reason="金额尚未确认 —— 报价回来之前不能建单"
                alert={submitError}
                actions={actions}
              />
            ) : screen === 'quote-failed' ? (
              <ConfirmCard
                tone="error"
                note={<>重新报价只是再问服务端一次，<b>不会重复建单，也不会重复扣款</b>。改过参数之后同样要重新报价。</>}
                alert={submitError}
                actions={actions}
              />
            ) : screen === 'zero-amount' ? (
              <ConfirmCard
                note={<>金额为 0 时，<b>确认后仍会创建打印订单</b>，再直接进入打印流程。</>}
                alert={submitError}
                actions={actions}
              />
            ) : screen === 'benefit-unverified' ? (
              <ConfirmCard
                tone="warn"
                note={<>核销没通过时<b>按实际原价继续</b>。本机不会先按抵扣后的价格显示给你看。</>}
                alert={submitError}
                actions={actions}
              />
            ) : (
              <ConfirmCard
                flow
                note={<>确认后会创建订单并进入付款，<b>付款完成后才开始打印</b>。金额以服务端返回为准。</>}
                alert={submitError}
                actions={actions}
              />
            )}
          </Sec>
          {/* 权益卡按稿不占 01→02→03 的主路：本轮权益只展示、不核销，不改变本单金额（金额只认服务端报价，
              建单时价格变了服务端回 409 要求再确认）。放在 03 之后，1080 首屏才能看到完整的确认卡与主按钮。 */}
          {benefitView ? <BenefitCard view={benefitView} onLogin={onLogin} /> : null}
          {printNotes}
        </>
      ) : null}

      {screen === 'capability-invalid-params' ? printNotes : null}
      <Truth />
    </div>
  )
}
