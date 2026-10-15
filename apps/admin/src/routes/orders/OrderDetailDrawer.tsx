import { Drawer, LoadingState, ErrorState } from '@ai-job-print/ui'
import type { OrderDetailControls } from './useOrderDetail'
import { amountText, billablePagesText, channelText, pageRangeText, fmt, orderUserText, payStatusText, pickupText, pickupTitle, REFUND_REASON_LABELS, taskStatusText } from './orderDisplay'
import { colorModeText, copiesText, duplexText, NET_PAID_UNRECORDED, recordedCentsText } from './orderHonestyCopy'
import { printErrorText } from '../../lib/printErrorText'
import { OrderAftercare } from './OrderAftercare'
import { OrderPaymentActions } from './OrderPaymentActions'

function Info({ label, value, title }: { label: string; value: string; title?: string }) {
  return <div><p className="text-xs font-bold text-neutral-500">{label}</p><p title={title} className="mt-1 break-words text-sm font-semibold text-neutral-900">{value}</p></div>
}

export function OrderDetailDrawer({ controls }: { controls: OrderDetailControls }) {
  const { detail, detailState, closeDetail } = controls
  return (
    <Drawer open={detailState !== 'idle'} onClose={closeDetail} title={detail ? `订单详情 · ${detail.orderNo}` : '订单详情'} size="md">
      {detailState === 'loading' && <LoadingState className="py-16" />}
      {detailState === 'error' && <ErrorState className="py-16" onRetry={closeDetail} />}
      {detailState === 'ready' && detail && (() => {
            const pay = payStatusText(detail.payStatus)
            const task = taskStatusText(detail.taskStatus)
            return <>
            <div className="my-4 grid grid-cols-2 gap-x-4 gap-y-3">
              <Info label="订单类型" title={detail.type} value={detail.type === 'print' ? '打印' : detail.type === 'scan' ? '扫描' : '未归类'} />
              <Info label="渠道" value={channelText(detail.channel)} />
              <Info label="取件" value={pickupText(detail)} title={pickupTitle(detail)} />
              <Info label="取件码过期时间" value={fmt(detail.pickupCodeExpiresAt)} />
              <Info label="创建时间" value={fmt(detail.createdAt)} />
              <Info label="失败原因" value={printErrorText(detail.errorCode, detail.type)} title={detail.errorCode ?? undefined} />
              <Info label="下单金额" value={amountText(detail.amountCents, detail.currency)} />
              <Info label="优惠/权益抵扣" value={recordedCentsText(detail.discountCents, detail.currency)} />
              <Info label="已退款" value={recordedCentsText(detail.refundedAmountCents, detail.currency)} />
              <Info label="实付" value={NET_PAID_UNRECORDED} />
              <Info label="支付状态" value={pay.label} title={pay.title} />
              <Info label="任务状态" value={task.label} title={task.title} />
              <Info label="用户" value={orderUserText(detail)} />
              <Info label="终端" value={detail.terminalCode ?? '—'} />
              <Info label="文件名" value={detail.print?.fileName ?? '未记录'} />
              <Info label="单双面" value={duplexText(detail.print?.duplex)} />
              <Info label="彩色/黑白" value={colorModeText(detail.print?.colorMode)} />
              <Info label="份数" value={copiesText(detail.print?.copies)} />
              <Info label="计费页数" value={billablePagesText(detail.billablePages) ?? '—'} />
              <Info label="页范围" value={pageRangeText(detail.print?.pageRange, detail.billablePages)} />
              <Info label="幅面" value={detail.print?.paperSize?.trim() ? detail.print.paperSize : '未记录'} />
              {detail.refundedAt && (
                <Info label="退款时间" value={fmt(detail.refundedAt)} />
              )}
              {detail.refundReason && detail.payStatus !== 'paid' ? (
                <Info label="退款原因" value={REFUND_REASON_LABELS[detail.refundReason] ?? detail.refundReason} />
              ) : null}
            </div>

      <OrderAftercare controls={controls} />
            <h3 className="mb-2 mt-5 text-[12.5px] font-extrabold text-neutral-700 [font-family:var(--font-heading,inherit)]">
              状态流转
            </h3>
            {detail.statusLogs.length === 0 ? (
              <p className="text-xs text-neutral-500">暂无状态流转记录</p>
            ) : (
              <div className="space-y-2">
                {detail.statusLogs.map((log) => {
                  const from = taskStatusText(log.fromStatus)
                  const to = taskStatusText(log.toStatus)
                  const rawTitle = [from.title, to.title].filter(Boolean).join(' → ')
                  return (
                  <div
                    key={`${log.fromStatus}-${log.toStatus}-${log.createdAt}`}
                    className="rounded-[9px] bg-neutral-50 px-3 py-2 text-xs text-neutral-700"
                  >
                    <span className="font-semibold" title={rawTitle || undefined}>
                      {from.label} → {to.label}
                    </span>
                    {log.errorCode ? <span title={log.errorCode} className="ml-2 text-error-fg">{printErrorText(log.errorCode, detail.type)}</span> : null}
                    <span className="ml-2 tabular-nums text-neutral-500">{fmt(log.createdAt)}</span>
                  </div>
                  )
                })}
              </div>
            )}

      <OrderPaymentActions controls={controls} />
      </>})()}
    </Drawer>
  )
}
