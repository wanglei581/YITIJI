// ============================================================
// PrintDoneSections —— /print/done（稿 15-print-fulfill）的结果态纯展示分区
//
// 只收 PrintDonePage 已经向服务端核验过的真值：不发请求、不判定任务状态、不改金额。
//   PrintDoneXq            小青区（稿 .xq）：各结果态的首句与「你现在该干嘛」
//   PrintFeeBoundaryBar    「费用与订单边界」内联条（稿 moneyBar）：费用说明态与缺纸态共用
//   PrintJobSummaryCard    完成态「本次任务摘要」
//   PrintOutOfPaperPanel   PAPER_EMPTY 缺纸态正文（稿 out-of-paper）：任务卡 + 缺纸说明 + 费用边界 + 现场三步
//
// 结果判定（completed / failed / errorCode 分态）、带走链接、重试与清场仍在页面里，门禁按页面文件取证。
// 本文件渲染在完成页上，守同一套文案红线：不写「已支付」（用「已付」）、不出现退款 / 赔付字样。
// ============================================================

import type { ReactNode } from 'react'
import { FileTextIcon, PrinterIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { truncateFileNameMiddle, FILE_NAME_BUDGET_COMPACT } from '../../../lib/fileName'
import { formatCents } from '../cashierStatus'
import { jobSubline, type OutOfPaperMoney } from '../printProgressModel'
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
          <div className="pff-xq-eyebrow">PRINT &amp; PICKUP</div>
          <p className="pff-xq-ask">{ask}</p>
          <p className="pff-xq-doing">{doing}</p>
        </div>
      </div>
    </section>
  )
}

/** 稿 moneyBar：只写订单本身的确定事实 + 由谁裁决，不承诺补打、费用处理或到账。 */
export function PrintFeeBoundaryBar({ sub, body, facts }: {
  sub: string
  body: ReactNode
  facts: ReactNode
}) {
  return (
    <div className="pff-inbar">
      <div className="pff-inbar-h">
        <span className="pff-inbar-ic"><FileTextIcon aria-hidden="true" /></span>
        <span>费用与订单边界<small>{sub}</small></span>
      </div>
      <p className="pff-inbar-b">{body}</p>
      <div className="pff-inbar-kv">{facts}</div>
    </div>
  )
}

export function PrintJobSummaryCard({ file, params }: {
  file: { name: string; pages: number }
  params: PrintJobParams
}) {
  return (
    <div className="qx-card">
      <b className="pff-info-hd">本次任务摘要</b>
      <div className="pff-i-row"><span className="pff-i-k">文件名</span><span className="pff-i-v">{file.name}</span></div>
      <div className="pff-i-row"><span className="pff-i-k">页数 / 份数</span><span className="pff-i-v">{file.pages} 页 × {params.copies} 份</span></div>
      <div className="pff-i-row"><span className="pff-i-k">打印面</span><span className="pff-i-v">{DUPLEX_LABEL[params.duplex] ?? params.duplex}</span></div>
      <div className="pff-i-row">
        <span className="pff-i-k">色彩 / 质量</span>
        <span className="pff-i-v">
          {params.colorMode === 'color' ? '彩色' : '黑白'} · {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
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
 *   「加纸后继续打印不需要重新下单」—— 同上，不存在「继续」，只有工作人员处理或有条件的整份重打。
 * 费用只写订单事实与由谁核查，不写费用处理结果（本页拿不到）。
 */
export function PrintOutOfPaperPanel({
  file, params, taskId, orderNo, failureReason, money, canRetry, takeaway,
}: {
  file: { name: string; pages: number } | null
  params: Partial<PrintJobParams> | null
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
  const idLine = [taskId ? `任务号 ${taskId}` : '', orderNo ? `订单号 ${orderNo}` : ''].filter(Boolean).join(' · ')
  const paid = money.fact === 'paid'
  const orderRef = orderNo ? `订单号 ${orderNo}` : taskId ? `任务号 ${taskId}` : '这一单的订单号'
  return (
    <>
      <section className="pff-sec" aria-label="这一单现在的状态">
        <div className="pff-sec-h">
          <span className="t">这一单现在的状态</span>
          <span className="hint">服务端登记缺纸 · 订单保留</span>
        </div>
        <div className="pfp-card" data-testid="print-fulfill-list">
          <PrintJobRow fileName={fileName} subline={jobSubline(file, params)} idLine={idLine} state={{ tone: 'err', label: '缺纸中断' }} />
          <div className="pff-inbar" data-tone="bad" data-testid="print-fulfill-fallback">
            <div className="pff-inbar-h">
              <span className="pff-inbar-ic"><PrinterIcon aria-hidden="true" /></span>
              <span>打印机缺纸<small>订单保留，不会自动续打</small></span>
            </div>
            <p className="pff-inbar-b">
              纸匣已空，这次打印<b>不会在加纸后自动继续</b>。出纸口里如果已经有纸，可以先拿走；没打完的部分请<b>联系现场工作人员</b>处理。
              {paid ? '订单和已付金额都保留着' : '订单记录保留着'}；只有本页出现「重新提交打印」按钮时，才能自己重打一次，且不会重复收费。
            </p>
            <p className="pff-inbar-b pfd-reason"><span className="pfd-reason-k">设备上报</span><span>{failureReason}</span></p>
          </div>
          <PrintFeeBoundaryBar
            sub={paid ? '订单和支付记录都在，不会因为这次缺纸消失' : '订单记录都在，不会因为这次缺纸消失'}
            body={<>补纸只能由工作人员做，这次打印<b>不会在加纸后自动续打</b>。是否补打、是否处理费用、处理多少，<b>以工作人员核查结果为准</b>，本机不承诺自动处理，也不会替你把费用改成别的数。</>}
            facts={
              <>
                {orderNo ? <span>订单 <b>{orderNo}</b></span> : null}
                {taskId ? <span>任务号 <b>{taskId}</b></span> : null}
                <span>
                  支付状态 <b>{paid && money.amountCents != null ? `已付 ${formatCents(money.amountCents)}` : money.fact === 'free' ? '本次未收款' : '以订单为准'}</b>
                </span>
              </>
            }
          />
        </div>
      </section>

      <section className="pff-sec" aria-label="找工作人员之前先做这三件">
        <div className="pff-sec-h">
          <span className="t">找工作人员之前先做这三件</span>
          <span className="hint">当场处理最快</span>
        </div>
        <div className="pfp-card pfp-todo">
          <div className="pff-step">
            <span className="pff-step-no">1</span>
            <span className="pff-step-txt">看一眼出纸口：<b>已经出来的纸先取走收好</b>。本机不知道出了几页，以你手里的实物为准。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">2</span>
            <span className="pff-step-txt">叫现场工作人员<b>加纸</b>，这一步只能由他们做；加完纸这次打印也<b>不会自己接着打</b>。</span>
          </div>
          <div className="pff-step">
            <span className="pff-step-no">3</span>
            <span className="pff-step-txt">
              {canRetry
                ? <>加完纸可点下方<b>重新提交打印</b>：同一订单<b>整份重打</b>、不再收费；<b>不要重新下单</b>，那会变成两笔费用。</>
                : <>记下<b>{orderRef}</b>，补打由工作人员凭它处理；<b>不要重新下单再打一次</b>，那会变成两笔费用。</>}
            </span>
          </div>
        </div>
      </section>

      <div className="pfd-takeaway">{takeaway}</div>
    </>
  )
}
