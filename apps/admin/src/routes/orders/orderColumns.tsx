import { StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import type { AdminOrderReadonlyItem } from '../../services/api/adminOrdersReadonly'
import { printErrorText } from '../../lib/printErrorText'
import { amountText, channelText, orderUserText, PAY_STATUS_MAP, STATUS_MAP } from './orderDisplay'
import { opsAttentionText } from './orderHonestyCopy'

export function orderColumns(openDetail: (id: string) => Promise<void>): ConsoleColumn<AdminOrderReadonlyItem>[] {
  return [
    { id: 'order', header: '订单号', truncate: true, title: (order) => order.orderNo,
      headerClassName: 'w-[18%]', cell: (order) => (
        <button type="button" title={order.orderNo} aria-label={`查看订单 ${order.orderNo}`}
          onClick={() => void openDetail(order.id)} className="block w-full truncate text-left font-semibold text-primary-700 hover:underline">
          {order.orderNo}
        </button>
      ) },
    { id: 'file', header: '文件名', truncate: true, title: (order) => order.printFileName ?? '未记录',
      headerClassName: 'w-[17%]', cell: (order) => order.printFileName ?? '未记录' },
    { id: 'user', header: '用户', truncate: true, headerClassName: 'w-[10%]', cell: orderUserText },
    { id: 'channel', header: '渠道', headerClassName: 'w-[8%]', cell: (order) => <span>{channelText(order.channel)}</span> },
    { id: 'terminal', header: '终端', truncate: true, headerClassName: 'w-[8%]', cell: (order) => order.terminalCode ?? '—' },
    { id: 'amount', header: '金额', align: 'right', headerClassName: 'w-[12%]',
      cell: (order) => <span className="whitespace-nowrap">{amountText(order.amountCents, order.currency)}</span> },
    { id: 'payment', header: '支付状态', headerClassName: 'w-[10%]', cell: (order) => {
      const pay = PAY_STATUS_MAP[order.payStatus] ?? { badge: 'default' as const, label: '未归类' }
      return <><StatusBadge dot status={pay.badge} label={pay.label} />
        {opsAttentionText(order.opsAttentionCode) ? (
          <span className="mt-1 block text-[11px] font-bold text-warning-fg">{opsAttentionText(order.opsAttentionCode)}</span>
        ) : order.opsAttentionCode === undefined && order.refundRequired ? (
          <span className="mt-1 block text-[11px] font-bold text-warning-fg">待退款</span>
        ) : null}</>
    } },
    { id: 'task', header: '任务状态', headerClassName: 'w-[10%]', cell: (order) => {
      const task = STATUS_MAP[order.taskStatus] ?? { badge: 'default' as const, label: '未归类' }
      return <><StatusBadge dot status={task.badge} label={task.label} />
        {order.errorCode && <span title={`${printErrorText(order.errorCode)}（${order.errorCode}）`}
          className="mt-1 block truncate text-[11px] text-error-fg">{printErrorText(order.errorCode)}</span>}</>
    } },
    { id: 'actions', header: '操作', sticky: true, align: 'right', headerClassName: 'w-[7%]',
      cell: (order) => <button type="button" onClick={() => void openDetail(order.id)}
        aria-label={`订单 ${order.orderNo} 详情`} className="whitespace-nowrap text-primary-700 hover:underline">详情</button> },
  ]
}
