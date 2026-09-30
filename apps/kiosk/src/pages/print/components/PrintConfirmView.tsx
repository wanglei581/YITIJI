import type { ReactNode } from 'react'
import { FileTextIcon, LockIcon } from 'lucide-react'
import type { PrintParamAdjustment } from '@ai-job-print/shared'
import type { PrintBenefitView } from '../../../services/api/benefits'
import { ASK, type PrintConfirmScreen, type QuoteView } from '../printConfirmModel'
import type { PrintFileState } from '../printMaterialSession'
import {
  AmountCard,
  BenefitCard,
  Chips,
  ConfirmCard,
  CouponUnavailable,
  FeeLines,
  Plan,
  Review,
  Sec,
  type SummaryRow,
} from './PrintConfirmParts'

// 报价确认页（原型 14-print-confirm.html，9/29 定稿）的展示件：小青区 → 四步条 → 01 核对打印内容 →
// 02 费用明细 → 03 确认（动作在卡内）→ 权益卡 → 打印须知。只摆页面算好的数据与回调；
// 报价、建单、终端能力求交、交接核对与地址栏清洗都在 PrintConfirmPage / printConfirmQuery 里。

const STEPS = ['选文件', '材料检查', '预览与参数', '报价确认'] as const
export type { SummaryRow }

type Props = {
  step: 4
  screen: PrintConfirmScreen
  invalidReason: string
  file: PrintFileState
  summaryRows: SummaryRow[]
  /** 本机暂未开通、已按能打的参数改过的项（空 = 没改）。 */
  adjustments: PrintParamAdjustment[]
  /** 改参数后的用纸说明，如「比原来多用 2 张纸」「用纸张数不变」。 */
  paperNote: string | null
  /** 按改后参数的计价说明，如「黑白 · 单面」。 */
  pricedParamsLabel: string
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

function Advisor({ screen, doingOverride }: { screen: PrintConfirmScreen; doingOverride?: string | null }) {
  const { title } = ASK[screen]
  const doing = doingOverride ?? ASK[screen].doing
  return (
    <section className="pcf-xq" aria-label="小青提示">
      <div className="pcf-xq-row">
        <div className="pcf-xq-face" aria-hidden="true">青</div>
        <div className="pcf-xq-main">
          <div className="pcf-xq-eyebrow">核对价格</div>
          <p className="pcf-xq-ask">{title[0]}<em>{title[1]}</em>{title[2]}</p>
          <p className="pcf-xq-doing">{doing}</p>
        </div>
      </div>
    </section>
  )
}

export function PrintConfirmView(props: Props) {
  const {
    screen, invalidReason, file, summaryRows, adjustments, paperNote, pricedParamsLabel, quote, costCalcLabel,
    amountText, benefitView, redactionText, materialDemo, printerBlocked, printerBlockedReason,
    terminalFailed, terminalFailedText, selfAssessment, printNotes, actions,
    submitError, onLogin,
  } = props
  const idle = screen === 'missing-context' || screen === 'invalid-context'
  const quotedLike = screen === 'quoted' || screen === 'benefit-unverified' || screen === 'zero-amount'
  const amountShown = quote.status === 'ready'
    ? amountText
    : quote.status === 'demo' ? '演示模式不显示金额' : quote.status === 'loading' ? '正在获取金额' : '金额暂不可用'
  const adjustedFields = adjustments.map((item) => (item.field === 'colorMode' ? '彩色' : item.field === 'duplex' ? '双面' : '多版合一'))
  const adjustedTo = adjustments.map((item) => (item.field === 'colorMode' ? '黑白' : item.field === 'duplex' ? '单面' : '每张一页'))
  const capabilityDoing = screen === 'capability-invalid-params' && adjustments.length > 0
    ? `${adjustedFields.join('、')}本机暂未开通，已改成${adjustedTo.join('、')}。价格以这组参数为准。`
    : null

  return (
    <div
      className="qx-scroll pcf-page qx-grow"
      data-w2-page="print-confirm"
      data-state={screen}
      data-testid={`print-confirm-state-${screen}`}
    >
      <Advisor screen={screen} doingOverride={capabilityDoing} />
      <Steps idle={idle} step={props.step} />

      {printerBlocked && !idle ? <div className="pcf-alert" role="status">{printerBlockedReason}</div> : null}
      {terminalFailed ? <div className="pcf-alert" data-tone="error" role="alert">{terminalFailedText}</div> : null}
      {adjustments.length > 0 && screen !== 'capability-invalid-params' ? (
        <div className="pcf-alert">彩色或双面本机暂未开通，已改回目前能打的参数。改回之后的参数才参与报价。</div>
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
                  '两样齐了才能向系统要这一单的正式报价。',
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
          {/* 9/29 定稿（稿 14）：不拦截。灰色的项本机暂未开通，已按能打的参数照常报价，主按钮可点。 */}
          <Sec no="01" title="核对打印内容" hint="灰色的项本机暂未开通，已按能用的参数报价">
            <Review file={file} summaryRows={summaryRows} redactionText={redactionText} materialDemo={materialDemo} />
            {selfAssessment}
          </Sec>
          <Sec no="02" title="费用明细" hint="按本机能用的参数计价">
            <div className="pcf-fee">
              <AmountCard
                quote={quote}
                amountText={amountShown.replace(/^¥/, '')}
                source={
                  quote.status === 'ready' && quote.amountCents === 0
                    ? <>免费试运营，本单 0 元。<br />{paperNote ?? '用纸张数以实际打印为准'}。</>
                    : <>已按本机能用的参数报价，<br />{paperNote ?? '用纸张数以实际打印为准'}。</>
                }
              />
              <FeeLines rows={[
                {
                  label: '计费页数',
                  value: quote.status === 'ready' ? `${quote.billablePages} 页` : '未获取',
                  slot: quote.status !== 'ready',
                },
                { label: '计价参数', value: pricedParamsLabel },
                { label: '计费方式', value: costCalcLabel, slot: quote.status !== 'ready', cost: true },
                { label: '小计', value: quote.status === 'ready' ? `¥${amountText}` : '无法显示', slot: quote.status !== 'ready' },
              ]} />
            </div>
            <CouponUnavailable free={quote.status === 'ready' && quote.amountCents === 0} />
          </Sec>
          <Sec
            no="03"
            title={quote.status === 'ready' && quote.amountCents === 0 ? '确认并打印' : '确认并付款'}
            hint={quote.status === 'ready' && quote.amountCents === 0 ? '这次不用付款' : '确认后进入付款'}
          >
            <ConfirmCard
              flow={!(quote.status === 'ready' && quote.amountCents === 0)}
              note={
                quote.status === 'ready' && quote.amountCents === 0
                  ? <>价格已按<b>{adjustedTo.join('、')}</b>算好。免费试运营，本单 0 元。确认后直接开始打印，<b>不用去付款</b>。</>
                  : <>价格已按<b>{adjustedTo.join('、')}</b>算好。确认后进入付款，<b>付款完成后才开始打印</b>。</>
              }
              alert={submitError}
              actions={actions}
            />
          </Sec>
          {benefitView ? <BenefitCard view={benefitView} onLogin={onLogin} /> : null}
          {printNotes}
        </>
      ) : null}

      {screen === 'ordered' ? (
        <>
          <Sec no="01" title="这一单已经提交" hint="同一份文件不会再建第二单">
            <Review file={file} summaryRows={summaryRows} redactionText={redactionText} materialDemo={materialDemo} />
          </Sec>
          <Sec no="02" title="现在可以去哪">
            <div className="pcf-state" data-tone="warn" data-testid="print-confirm-ordered">
              <h3><LockIcon size={26} aria-hidden="true" />这份文件已经下过单</h3>
              <p>付款和打印进度在这一单里看。要改参数或换文件，请<b>重新发起打印</b>，本页不会拿同一份再建一单。</p>
              <Chips items={['已建单', '不会重复建单']} />
            </div>
            <ConfirmCard note={<>回到这一单继续付款或查看进度；也可以去「我的打印订单」按订单号查。</>} alert={submitError} actions={actions} />
          </Sec>
        </>
      ) : null}

      {screen === 'quoting' || screen === 'quote-failed' || quotedLike ? (
        <>
          <Sec no="01" title="核对打印内容" hint={screen === 'quote-failed' ? '文件和参数都保留着' : undefined}>
            <Review file={file} summaryRows={summaryRows} redactionText={redactionText} materialDemo={materialDemo} />
            {selfAssessment}
          </Sec>
          <Sec
            no="02"
            title="费用明细"
            hint={
              screen === 'quoting' ? '正在核对这一单的价格'
                : screen === 'quote-failed' ? '这一次没有拿到报价'
                  : screen === 'zero-amount' ? '免费试运营，本单 0 元'
                    : '金额以实际结果为准'
            }
          >
            <div className="pcf-fee">
              <AmountCard
                quote={quote}
                amountText={amountShown.replace(/^¥/, '')}
                source={
                  quote.status === 'ready'
                    ? quote.amountCents === 0
                      ? '免费试运营，本单 0 元。'
                      : '金额以这一单的报价为准。'
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
                  value: screen === 'benefit-unverified'
                    ? '未核销，按原价'
                    : quote.status === 'ready'
                      ? quote.amountCents === 0
                        ? '这次免费，没有抵扣'
                        : '按这一单的报价，没有抵扣'
                      : '报价出来后再显示',
                  slot: quote.status !== 'ready' || screen === 'benefit-unverified',
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
                {quote.status === 'unavailable' && quote.code === 'PRINT_TERMINAL_QUEUE_HALTED' ? null : <div className="pcf-pgrp">
                  <h4>可能的原因</h4>
                  <Plan items={['本机与系统之间网络中断。', '参数里有本机暂未开通的项，系统直接拒绝报价。']} />
                </div>}
                <div className="pcf-pgrp">
                  <h4>这一趟保留了什么</h4>
                  <p>文件、参数和这一步的上下文都还在。<b>本次没有创建订单，也不会扣款。</b></p>
                  <Chips items={['未建单', '未扣费', '文件与参数保留']} />
                </div>
              </div>
            ) : null}
            {quotedLike ? <CouponUnavailable free={quote.status === 'ready' && quote.amountCents === 0} /> : null}
            {screen === 'zero-amount' ? (
              <div className="pcf-grid2">
                <div className="pcf-pgrp">
                  <h4>页数怎么算</h4>
                  <p>页数和价格都按这一单的报价。屏幕上看见的页数不会另外再算一次价。</p>
                </div>
                <div className="pcf-pgrp" data-testid="print-confirm-fallback">
                  <h4>免费试运营，本单 0 元</h4>
                  <p>这次不用付款。确认后直接开始打印，请留在出纸口旁取纸。</p>
                </div>
              </div>
            ) : null}
          </Sec>
          <Sec
            no="03"
            title={screen === 'zero-amount' ? '确认并打印' : screen === 'quote-failed' ? '现在可以怎么办' : '确认并付款'}
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
                note={<>重新报价只是再问系统一次，<b>不会重复建单，也不会重复扣款</b>。改过参数之后同样要重新报价。</>}
                alert={submitError}
                actions={actions}
              />
            ) : screen === 'zero-amount' ? (
              <ConfirmCard
                note={<>免费试运营，本单 0 元。确认后直接开始打印，<b>不用去付款</b>。</>}
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
                note={<>确认后会创建订单并进入付款，<b>付款完成后才开始打印</b>。金额以实际结果为准。</>}
                alert={submitError}
                actions={actions}
              />
            )}
          </Sec>
          {/* 权益卡不占 01→02→03 的主路：本轮权益只展示、不核销，不改变本单金额。
              放在 03 之后，1080 首屏才能看到完整的确认卡与主按钮。 */}
          {benefitView ? <BenefitCard view={benefitView} onLogin={onLogin} /> : null}
          {printNotes}
        </>
      ) : null}

    </div>
  )
}
