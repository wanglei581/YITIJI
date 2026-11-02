import { useNavigate } from 'react-router-dom'
import type { PendingTask } from '../../../services/api/pendingTasks'
import { MeBtn } from '../touch/MeKit'

function formatYuan(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`
}

/**
 * 待办卡（稿 todoCard）。只来自 /me/pending-tasks：没取到、没有待办、要付款、正在出纸四种。
 * 没有待办时按账号是不是一条记录都没有，补一句话。
 */
export function ProfileContinueCard({
  task,
  tasksError,
  empty = false,
}: {
  task: PendingTask | null
  tasksError: boolean
  /** 这个账号下什么记录都没有时，待办卡多写一句。 */
  empty?: boolean
}) {
  const navigate = useNavigate()

  if (tasksError) {
    return (
      <div className="me-static">
        <b>待办这次没取到</b>
        <small>请到打印订单查看，或重新加载此页。</small>
      </div>
    )
  }

  if (!task) {
    return (
      <div className="me-static">
        <b>这台机器上没有待继续的办理</b>
        <small>{empty ? '这个账号还没有保存过简历、生成过文档，也没有下过打印订单。' : '可以去首页选择要办理的服务。'}</small>
        <MeBtn v="sec" data-testid="profile-start" onClick={() => navigate('/')}>去首页开始</MeBtn>
      </div>
    )
  }

  const isPayment = task.resume.kind === 'payment'
  const fileName = task.fileName ?? '打印文件'
  const orderNo = task.resume.orderNo
  const amount = task.resume.amountCents

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
    <div className="me-static" data-live="true">
      <b>{isPayment ? '有一份文件还没付款' : '你的文件正在打印'}</b>
      <small>
        <b>{fileName}</b>
        {orderNo ? <> · 订单 <b>{orderNo}</b></> : null}
        {typeof amount === 'number' ? <> · 应付 <b>{formatYuan(amount)}</b></> : null}
      </small>
      <small>
        {isPayment
          ? '应付金额和收费明细以这张订单的实际内容为准；付款前不会开始出纸。'
          : '纸出完前不要离开取件口，可查看最新出纸进度。'}
      </small>
      <MeBtn v="pri" data-testid="profile-resume" onClick={continueTask}>
        {isPayment ? '继续付款' : '看出纸进度'}
      </MeBtn>
    </div>
  )
}
