// ============================================================
// PrintDoneSections —— /print/done（稿 15-print-fulfill）的结果态纯展示分区
//
// 只收 PrintDonePage 已经向服务端核验过的真值：不发请求、不判定任务状态、不改金额。
//   PrintDoneXq            小青区（稿 .xq）：各结果态的首句与「你现在该干嘛」
//   PrintFeeBoundaryBar    「费用与订单边界」内联条（稿 moneyBar）：费用说明态与缺纸态共用
//   PrintDoneRecordSection 完成态「本次记录」：摘要默认可见，保留与删除记录可展开
//   PrintJobSummaryCard    完成态「本次任务摘要」
//   PrintOutOfPaperPanel   PAPER_EMPTY 缺纸态正文（稿 out-of-paper）：任务卡 + 缺纸说明 + 费用边界 + 现场三步
//   PrintJamGuide          卡纸态下半屏：稿 paper-jam 的三步 + 求助条，用来填掉二维码下面的空白
//
// 结果判定（completed / failed / errorCode 分态）、带走链接、重试与清场仍在页面里，门禁按页面文件取证。
// 本文件渲染在完成页上：不写「已支付」（用「已付」）。退款只在金额大于 0 时用标准句 5，免费单不写。
// ============================================================

import { useState, type ReactNode } from 'react'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { truncateFileNameMiddle, FILE_NAME_BUDGET_COMPACT } from '../../../lib/fileName'
import { formatCents } from '../cashierStatus'
import { machineCannotPrintLine, refundApplyLine } from '../../../copy/unattendedCopy'
import { jobSubline, pagesPerCopy, publicOrderNo, type OutOfPaperMoney } from '../printProgressModel'
import { PrintFileDeletionRecords } from './PrintFileDeletionRecords'
import { PrintFileRetentionNotice } from './PrintFileRetentionNotice'
import type { PrintFileRetentionInput } from './printFileRetention'
import { PrintAiHelp } from './PrintAiHelp'
import { PrintJobRow } from './PrintProgressSections'

const DUPLEX_LABEL: Record<string, string> = {
  simplex:           '单面',
  duplex_long_edge:  '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

export function PrintDoneXq({ ask, doing, mainClassName }: {
  ask: ReactNode
  doing: ReactNode
  /** 稿 15 一屏骨架（.pfp-page）里文字列要吃满余宽；其余结果态保持原排版。 */
  mainClassName?: string
}) {
  return (
    <section className="pff-xq">
      <div className="pff-xq-row">
        <div className="pff-xq-face" aria-hidden="true">青</div>
        <div className={mainClassName}>
          <div className="pff-xq-eyebrow">出纸 · 取件</div>
          <p className="pff-xq-ask">{ask}</p>
          <p className="pff-xq-doing">{doing}</p>
        </div>
      </div>
    </section>
  )
}

/** 稿 moneyBar：只写订单本身的确定事实 + 由谁裁决，不承诺补打、费用处理或到账。 */
export function PrintFeeBoundaryBar({ sub, body, facts, free = false }: {
  free?: boolean
  sub: string
  body: ReactNode
  facts: ReactNode
}) {
  return (
    <div className="pff-inbar">
      <div className="pff-inbar-h">
        <span className="pff-inbar-ic"><FileTextIcon aria-hidden="true" /></span>
        <span>{free ? '订单记录' : '费用与订单边界'}<small>{sub}</small></span>
      </div>
      <p className="pff-inbar-b">{body}</p>
      <div className="pff-inbar-kv">{facts}</div>
    </div>
  )
}

/** 完成页下半部：摘要默认展开，文件保留与删除记录收在同一区里，避免把求助挤出首屏。 */
export function PrintDoneRecordSection({
  file,
  params,
  retention,
}: {
  file?: { name: string; pages: number | null }
  params?: Partial<PrintJobParams>
  retention: PrintFileRetentionInput
}) {
  const [open, setOpen] = useState(false)
  return (
    <section className="pff-record" aria-label="本次记录">
      <div className="pff-sec-h"><span className="t">本次记录</span></div>
      {file && params ? <PrintJobSummaryCard file={file} params={params} /> : (
        <p className="print-done-card-sub">这次没有带到文件名和打印参数，摘要留空。</p>
      )}
      <button
        type="button"
        className="pff-record-toggle"
        aria-expanded={open}
        aria-controls="print-done-record-extra"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '收起文件保留和删除记录' : '查看文件保留和删除记录'}
      </button>
      <div id="print-done-record-extra" className="pff-record-extra" hidden={!open}>
        <PrintFileRetentionNotice retention={retention} />
        <PrintFileDeletionRecords />
      </div>
    </section>
  )
}

export function PrintJobSummaryCard({ file, params }: {
  file: { name: string; pages: number | null }
  params: Partial<PrintJobParams>
}) {
  const perCopy = pagesPerCopy(file, params)
  const copies = params.copies != null && params.copies >= 1 ? params.copies : null
  const pagesText = perCopy != null && perCopy >= 1
    ? (copies != null && copies > 1 ? `${perCopy} 页 × ${copies} 份` : `${perCopy} 页`)
    : copies != null ? `${copies} 份，页数待识别` : '页数 / 份数未提供'
  return (
    <div className="qx-card">
      <b className="pff-info-hd">本次任务摘要</b>
      <div className="pff-i-row"><span className="pff-i-k">文件名</span><span className="pff-i-v">{file.name}</span></div>
      <div className="pff-i-row"><span className="pff-i-k">页数 / 份数</span><span className="pff-i-v">{pagesText}</span></div>
      <div className="pff-i-row"><span className="pff-i-k">打印面</span><span className="pff-i-v">{params.duplex ? DUPLEX_LABEL[params.duplex] ?? params.duplex : '未提供'}</span></div>
      <div className="pff-i-row">
        <span className="pff-i-k">色彩 / 质量</span>
        <span className="pff-i-v">
          {params.colorMode === 'color' ? '彩色' : params.colorMode === 'black_white' ? '黑白' : '未提供'}{params.quality ? ` · ${params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}` : ''}
        </span>
      </div>
    </div>
  )
}

/**
 * 稿 15 out-of-paper 的任务区。稿里三处说法在真实合同里不成立，按事实改写：
 *   「剩下没打的部分会在加纸后继续」—— 服务端没有补纸后自动续打的链路：PrintTask 此刻已是
 *     failed 终态，唯一的重来是 POST /print/jobs/:taskId/retry，要服务端先在 takeaway-url
 *     给出 canRetry，且重打的是整份文件，不是「剩下的部分」；
 *   「已出 1 份」「等待加纸」—— GET /print/jobs/:taskId 不回已出页数，只能请用户看出纸口实物；
 *   「加纸后继续打印不需要重新下单」—— 同上，不存在「继续」，只有整份重打或回到订单。
 * 缺纸按机器故障标准句说明。付过钱才写退款那一句；免费单不写退款。
 */
export function PrintOutOfPaperPanel({
  file, params, orderNo, failureReason, money, canRetry, takeaway,
}: {
  file: { name: string; pages: number | null } | null
  params: Partial<PrintJobParams> | null
  /** 调用方仍传入，页面不再把内部任务号展示给用户。 */
  taskId: string | null
  orderNo: string | null
  /** 服务端给用户看的安全文案（failureReasonForUser），不含 Agent 原始错误。 */
  failureReason: string
  money: OutOfPaperMoney
  /** 服务端 takeaway-url 的 canRetry；为真时底部才有「重新提交打印」。 */
  canRetry: boolean
  /** 页面签发的「文件带走」区块（二维码 / 过期 / 签发失败），原样放在任务区之后。 */
  takeaway: ReactNode
}) {
  const fileName = file?.name ? truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_COMPACT }) : '本次打印任务'
  const shownOrderNo = publicOrderNo(orderNo)
  const idLine = shownOrderNo ? `订单号 ${shownOrderNo}` : ''
  const paid = money.fact === 'paid' && typeof money.amountCents === 'number' && money.amountCents > 0
  const fault = machineCannotPrintLine(undefined, { orderKept: true })
  const orderRef = shownOrderNo ? `订单号 ${shownOrderNo}` : '这一单'
  return (
    <>
      <section className="pff-sec" aria-label="这一单现在的状态">
        <div className="pff-sec-h">
          <span className="t">这一单现在的状态</span>
          <span className="hint">已经登记缺纸 · 订单保留</span>
        </div>
        <div className="pfp-card" data-testid="print-fulfill-list">
          <PrintJobRow fileName={fileName} subline={jobSubline(file, params)} idLine={idLine} state={{ tone: 'err', label: '缺纸中断' }} />
          <div className="pff-inbar" data-tone="bad" data-testid="print-fulfill-fallback">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><PrinterIcon aria-hidden="true" /></span>
              <span>打印机缺纸<small>订单保留，不会自动续打</small></span>
            </div>
            <p className="pff-inbar-b">
              纸匣已空，这次打印<b>不会在加纸后自动继续</b>。出纸口里如果已经有纸，可以先拿走。{fault}
              {paid ? '订单和支付记录都保留着' : '订单记录保留着'}；只有本页出现「重新提交打印」按钮时，才能自己重打一次{paid ? '，且不会重复收费。' : '。'}
            </p>
            <p className="pff-inbar-b pfd-reason"><span className="pfd-reason-k">设备上报</span><span>{failureReason}</span></p>
          </div>
          <PrintFeeBoundaryBar
            free={money.fact === 'free'}
            sub={paid ? '订单和支付记录都在，不会因为这次缺纸消失' : '订单记录都在，不会因为这次缺纸消失'}
            body={paid ? <>{fault}{refundApplyLine()}</> : <>{fault}</>}
            facts={
              <>
                {shownOrderNo ? <span>订单 <b>{shownOrderNo}</b></span> : null}
                <span>
                  {money.fact === 'free' ? '办理方式' : '支付状态'} <b>{paid && money.amountCents != null ? `已付 ${formatCents(money.amountCents)}` : money.fact === 'free' ? '免费试运营' : '以订单为准'}</b>
                </span>
              </>
            }
          />
        </div>
      </section>

      <section className="pff-sec" aria-label="处理之前先做这三件">
        <div className="pff-sec-h">
          <span className="t">处理之前先做这三件</span>
          <span className="hint">先看出纸口</span>
        </div>
        <div className="pfp-card pfp-todo">
          <div className="pff-step">
            <span className="pff-step-no">1</span>
            <span className="pff-step-txt">看一眼出纸口：<b>已经出来的纸先取走收好</b>。本机不知道出了几页，以你手里的实物为准。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">2</span>
            <span className="pff-step-txt">这次打印<b>不会自己接着打</b>。{fault}</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">3</span>
            <span className="pff-step-txt">
              {canRetry
                ? paid
                  ? <>可点下方<b>重新提交打印</b>：同一订单<b>整份重打</b>、不会重复收费；<b>不要重新下单</b>，那会变成两笔费用。</>
                  : <>可点下方<b>重新提交打印</b>：同一订单<b>整份重打</b>，请不要重新下单。</>
                : paid
                  ? <>记下<b>{orderRef}</b>。{refundApplyLine()}不要重新下单再打一次，那会变成两笔费用。</>
                  : <>记下<b>{orderRef}</b>，回到订单重新打印。</>}
            </span>
          </div>
        </div>
      </section>

      <div className="pfd-takeaway">{takeaway}</div>
    </>
  )
}

/** 稿 15 paper-jam 的三步和求助条。不写收款；订单号没有时只说「这一单」。 */
export function PrintJamGuide({ orderNo }: { orderNo: string | null }) {
  const orderRef = orderNo ? `订单号 ${orderNo}` : '这一单'
  return (
    <section className="pff-jam-fill" aria-label="找工作人员之前先做这三件">
      <div className="pff-sec-h">
        <span className="t">找工作人员之前先做这三件</span>
        <span className="hint">当场处理最快</span>
      </div>
      <div className="pff-jam-steps">
        <div className="pff-step">
          <span className="pff-step-no">1</span>
          <span className="pff-step-txt">把出纸口里<b>已经出来的纸取走收好</b>，别留在机器上。</span>
        </div>
        <div className="pff-step">
          <span className="pff-step-no">2</span>
          <span className="pff-step-txt"><b>不要自己开机盖、不要拽纸</b>：撕在里面更难取，也可能弄坏机器。</span>
        </div>
        <div className="pff-step">
          <span className="pff-step-no">3</span>
          <span className="pff-step-txt">记下<b>{orderRef}</b>，补打时工作人员按它找这一单。</span>
        </div>
      </div>
      <div className="pff-help">
        <span className="txt">卡纸、缺纸、没出全？<b>别硬拉纸</b>，找现场工作人员处理。</span>
      </div>
      <PrintAiHelp
        label="问小青：取纸或异常怎么办 →"
        draft="打印时取纸或遇到异常该怎么办？请告诉我现在可以做的事，不要替我判断有没有打出来。"
      />
    </section>
  )
}
