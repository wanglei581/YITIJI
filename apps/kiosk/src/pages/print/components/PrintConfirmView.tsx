import type { ReactNode } from 'react'
import { FileTextIcon, LockIcon } from 'lucide-react'
import type { PrintParamAdjustment } from '@ai-job-print/shared'
import { machineCannotPrintLine, machineUnusableLine, preferUnattended, printProblemLine } from '../../../copy/unattendedCopy'
import type { PrintBenefitView } from '../../../services/api/benefits'
import type { PrintConfirmScreen, QuoteView } from '../printConfirmModel'
import type { PrintFileState } from '../printMaterialSession'
import {
  BenefitCard,
  Chips,
  ConfirmCard,
  CouponUnavailable,
  Plan,
  Review,
  Sec,
  type SummaryRow,
} from './PrintConfirmParts'

// 核对价格的正文。步骤轴和问小青在 PrintTouchFrame 上。
// 只摆页面算好的数据；报价、建单、能力求交仍在 PrintConfirmPage。
export type { SummaryRow }

type Props = {
  step: 4
  freePricing: boolean
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
  /** 附加自我探索的勾选卡：改的是「打印什么」，放在确认键之前。 */
  selfAssessment: ReactNode
  /** 打印须知：确认之后才用得上的操作提醒。 */
  printNotes: ReactNode
  /** 底栏已经放了唯一主按钮时，页面传 null，正文不再摆第二颗。 */
  actions: ReactNode
  submitError: string | null
  onLogin: () => void
  /** 已有文件的真实预览。没有就不画假图。 */
  preview?: ReactNode
  sheetsLabel?: string | null
  settingsLabel?: string | null
  copiesLabel?: string | null
  /** 底栏已有问小青时，确认卡里不再放第二颗。 */
  docked?: boolean
}

function adjustmentEnds(field: PrintParamAdjustment['field']): [string, string] {
  if (field === 'colorMode') return ['彩色', '黑白']
  if (field === 'duplex') return ['双面', '单面']
  return ['多版合一', '每张一页']
}

function pagesCopies(quote: QuoteView, file: PrintFileState, copiesLabel?: string | null): string {
  const pages = quote.status === 'ready' ? quote.billablePages : file.pages
  const pagesText = pages === null || pages === undefined ? '页数待识别' : `${pages} 页`
  return copiesLabel ? `${pagesText} × ${copiesLabel}` : pagesText
}

export function PrintConfirmView(props: Props) {
  const {
    freePricing, screen, invalidReason, file, summaryRows, adjustments, paperNote, pricedParamsLabel, quote, costCalcLabel,
    amountText, benefitView, redactionText, materialDemo, printerBlocked, printerBlockedReason,
    terminalFailed, terminalFailedText, selfAssessment, printNotes, actions,
    submitError, onLogin, preview = null, sheetsLabel = null, settingsLabel = null, copiesLabel = null, docked = false,
  } = props
  const idle = screen === 'missing-context' || screen === 'invalid-context'
  const quotedLike = screen === 'quoted' || screen === 'benefit-unverified' || screen === 'zero-amount'
  const work = screen === 'quoting' || screen === 'quote-failed' || quotedLike || screen === 'capability-invalid-params'
  const halted = quote.status === 'unavailable' && quote.code === 'PRINT_TERMINAL_QUEUE_HALTED'
  const ready = quote.status === 'ready'
  const readyZero = ready && quote.amountCents === 0
  const failText = quote.status !== 'unavailable'
    ? null
    : preferUnattended(
      freePricing && quote.reason.includes('确认前不显示金额')
        ? `暂时无法核定页数，请重试。${printProblemLine()}`
        : quote.reason,
      freePricing ? printProblemLine() : machineUnusableLine(),
    )
  const printerLine = preferUnattended(printerBlockedReason, machineCannotPrintLine())
  const settingsText = settingsLabel?.trim() || pricedParamsLabel
  const sheetsText = sheetsLabel ?? paperNote ?? '以实际打印为准'
  const hideHelp = docked

  return (
    <div
      className="qx-scroll pcf-page pct-page qx-grow"
      data-w2-page="print-confirm"
      data-state={screen}
      data-testid={`print-confirm-state-${screen}`}
    >
      {printerBlocked && !idle && !halted ? <div className="pct-alert" role="status">{printerLine}</div> : null}
      {terminalFailed ? <div className="pct-alert" data-tone="error" role="alert">{terminalFailedText}</div> : null}

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
            <ConfirmCard hideHelp={hideHelp} note={<>先回上一步把文件和参数选好，<b>回到这一页才会有正式报价</b>。</>} alert={submitError} actions={actions} />
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
              hideHelp={hideHelp}
              tone="error"
              note={<>重新从<b>有文件的那一步</b>进来，这一页才会有可以确认的一单。这一趟<b>没有创建订单，也没有扣款</b>。</>}
              alert={submitError}
              actions={actions}
            />
          </Sec>
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
            <ConfirmCard hideHelp={hideHelp} note={<>回到这一单继续付款或查看进度；也可以去「我的打印订单」按订单号查。</>} alert={submitError} actions={actions} />
          </Sec>
        </>
      ) : null}

      {work ? (
        <>
          {submitError ? <div className="pct-alert" data-tone="error" role="alert">{submitError}</div> : null}
          <div className="pct-grid">
            <div className="pct-thumb">
              {preview ?? <p>这一页没有可显示的预览。</p>}
            </div>
            <section className="pct-sum" aria-label="打印摘要">
              <div className="pct-row"><span>文件</span><b>{file.name}</b></div>
              <div className="pct-row"><span>页数</span><b>{pagesCopies(quote, file, copiesLabel)}</b></div>
              <div className="pct-row"><span>设置</span><b>{settingsText}</b></div>
              <div className="pct-row"><span>用纸</span><b>{sheetsText}</b></div>
            </section>
          </div>

          <Review file={file} summaryRows={summaryRows} redactionText={redactionText} materialDemo={materialDemo} />
          {selfAssessment}

          {adjustments.length > 0 ? (
            <div className="pct-alert">
              彩色或双面本机暂未开通，已改回目前能打的参数。
              {freePricing ? '请按改回后的参数核对打印内容。' : '改回之后的参数才参与报价。'}
              {adjustments.map((item) => {
                const [from, to] = adjustmentEnds(item.field)
                return (
                  <p key={item.field}>
                    {from}本机暂未开通，已改成{to}。
                    {freePricing ? null : '价格以这组参数为准。'}
                  </p>
                )
              })}
            </div>
          ) : null}

          {freePricing ? (
            <section className="pct-fee" aria-label="页数核定">
              <b>页数核定</b>
              {readyZero ? (
                <>
                  <span data-testid="print-confirm-amount">免费试运营</span>
                  <strong className="pct-num">0 元</strong>
                  <p>免费试运营，本单 0 元</p>
                </>
              ) : screen === 'quoting' || quote.status === 'demo' ? (
                <p>正在核定页数</p>
              ) : screen === 'quote-failed' ? (
                <div className={halted ? 'pcf-grid2' : 'pct-note'} data-single={halted ? 'true' : undefined}>
                  <p>{failText}</p>
                </div>
              ) : (
                <p>页数核定未完成</p>
              )}
            </section>
          ) : (
            <section className="pct-fee" aria-label="应付金额">
              {ready ? (
                <>
                  <p className="pct-fee-line">
                    应付 <span data-testid="print-confirm-amount">{`¥${amountText}`}</span> 元
                  </p>
                  <p className="pct-note">金额以订单为准</p>
                </>
              ) : quote.status === 'demo' ? (
                <p>演示模式不显示金额</p>
              ) : screen === 'quoting' ? (
                <p>正在获取金额</p>
              ) : (
                <p>这一次没有拿到报价</p>
              )}
              {quote.status !== 'unavailable' ? (
                <p className="pct-note"><span data-cost-calc="true">{costCalcLabel}</span></p>
              ) : null}
              {screen === 'quote-failed' ? (
                halted ? (
                  <div className="pcf-grid2" data-single="true"><p>{failText}</p></div>
                ) : (
                  <>
                    <div className="pct-note"><p>{failText}</p></div>
                    <div className="pcf-pgrp">
                      <h4>可能的原因</h4>
                      <Plan items={['本机与系统之间网络中断。', '参数里有本机暂未开通的项，系统直接拒绝报价。']} />
                    </div>
                  </>
                )
              ) : null}
              {screen === 'benefit-unverified' ? (
                <p className="pct-note">核销没通过，按实际原价继续。本机不会先按抵扣后的价格显示。</p>
              ) : null}
              {ready && (quotedLike || screen === 'capability-invalid-params') ? (
                <CouponUnavailable free={quote.amountCents === 0} />
              ) : null}
            </section>
          )}

          {!freePricing && benefitView ? <BenefitCard view={benefitView} onLogin={onLogin} /> : null}
          {printNotes}
          {actions ? <div className="pct-acts">{actions}</div> : null}
        </>
      ) : null}
    </div>
  )
}
