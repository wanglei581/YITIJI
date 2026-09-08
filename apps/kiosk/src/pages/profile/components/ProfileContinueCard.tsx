import { useNavigate } from 'react-router-dom'
import { CheckIcon, ClockIcon, PrinterIcon } from 'lucide-react'
import type { PendingTask } from '../../../services/api/pendingTasks'

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

export function ProfileContinueCard({
  task,
  tasksError,
}: {
  task: PendingTask | null
  tasksError: boolean
}) {
  const navigate = useNavigate()

  if (tasksError) {
    return (
      <div className="qx-card">
        <div className="pf-todo">
          <span className="pf-todo-ic" data-tone="wheat">
            <ClockIcon size={26} aria-hidden />
          </span>
          <span className="pf-todo-tx">
            <span className="pf-todo-t">待办这次没取到</span>
            <span className="pf-todo-d">本机不显示上一次的进度。入口仍可点进各自页面重新加载。</span>
          </span>
        </div>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="qx-card">
        <div className="pf-todo pf-todo--none">
          <span className="pf-todo-ic" data-tone="teal">
            <CheckIcon size={26} aria-hidden />
          </span>
          <span className="pf-todo-tx">
            <span className="pf-todo-t">这台机器上没有待继续的办理</span>
            <span className="pf-todo-d">没有就是没有。本机不会把上一位使用者的进度显示给你。</span>
          </span>
          <button
            type="button"
            className="pf-todo-btn"
            data-testid="profile-start"
            onClick={() => navigate('/')}
          >
            去首页开始
          </button>
        </div>
      </div>
    )
  }

  const isPayment = task.resume.kind === 'payment'
  const fileName = task.fileName ?? '打印文件'
  const orderNo = task.resume.orderNo
  const amount = task.resume.kind === 'payment' ? task.resume.amountCents : task.resume.amountCents

  const continueTask = () => {
    const state = {
      taskId: task.id,
      file: task.fileName ? { name: task.fileName, size: '待识别' } : undefined,
      orderId: task.resume.orderId,
      orderNo: task.resume.orderNo,
      amountCents: task.resume.amountCents,
      paymentSessionToken: task.resume.paymentSessionToken,
      ...(task.resume.kind === 'payment' ? { priceLines: task.resume.priceLines } : {}),
    }
    if (isPayment) {
      navigate('/print/cashier', { state })
      return
    }
    navigate('/print/progress', { state })
  }

  return (
    <div className="qx-card" data-live="true">
      <div className="pf-todo">
        <span className="pf-todo-ic" data-tone={isPayment ? 'wheat' : 'teal'}>
          {isPayment ? <ClockIcon size={26} aria-hidden /> : <PrinterIcon size={26} aria-hidden />}
        </span>
        <span className="pf-todo-tx">
          <span className="pf-todo-t">{isPayment ? '有一份文件还没付款' : '你的文件正在打印'}</span>
          <span className="pf-todo-meta">
            <b>{fileName}</b>
            {orderNo ? (
              <>
                <i>·</i>订单 <b>{orderNo}</b>
              </>
            ) : null}
            {typeof amount === 'number' ? (
              <>
                <i>·</i>应付 <b>{formatYuan(amount)}</b>
              </>
            ) : null}
          </span>
          <span className="pf-todo-d">
            {isPayment
              ? '金额与明细由 /me/pending-tasks 返回；付款前不会开始出纸。'
              : '出纸进度由 /me/pending-tasks 的 status（claimed / printing）返回；纸出完前不要离开取件口。'}
          </span>
        </span>
        <button
          type="button"
          className="pf-todo-btn pf-todo-btn--teal"
          data-testid="profile-resume"
          onClick={continueTask}
        >
          {isPayment ? '继续付款' : '看出纸进度'}
        </button>
      </div>
    </div>
  )
}
