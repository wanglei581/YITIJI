import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskPageFrame } from '@ai-job-print/ui'
import {
  PrinterIcon,
  ArrowRightIcon,
  ClockIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { getPendingTasks, type PendingTask } from '../../services/api/pendingTasks'
import '../../styles/prototype-v1.css'

function taskIcon(type: string) {
  switch (type) {
    case 'print':      return <PrinterIcon aria-hidden="true" style={{ width: 28, height: 28 }} />
    default:           return <ClockIcon aria-hidden="true" style={{ width: 28, height: 28 }} />
  }
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2)   return '刚刚'
  if (minutes < 60)  return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)    return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function taskDescription(task: PendingTask): string {
  switch (task.status) {
    case 'pending':
      if (task.resume.kind === 'payment') {
        return task.payStatus === 'paying' ? '支付处理中，可继续确认支付状态' : '订单待支付，完成支付后开始打印'
      }
      return '已支付，等待终端领取任务'
    case 'claimed':
      return '终端已领取任务，正在准备打印'
    case 'printing':
      return '打印机正在出纸，请及时取件'
  }
}

export function SessionResumePage() {
  const navigate = useNavigate()
  const { ready, isLoggedIn, getToken } = useAuth()
  const [tasks,   setTasks]   = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    if (!ready) return
    const token = getToken()
    if (!isLoggedIn || !token) {
      navigate('/login', { replace: true, state: { from: '/session-resume' } })
      return
    }
    let cancelled = false
    getPendingTasks(token)
      .then((data) => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [getToken, isLoggedIn, navigate, ready])

  const continueTask = (task: PendingTask) => {
    const state = {
      taskId: task.id,
      file: task.fileName ? { name: task.fileName, size: '待识别' } : undefined,
      orderId: task.resume.orderId,
      orderNo: task.resume.orderNo,
      amountCents: task.resume.amountCents,
      paymentSessionToken: task.resume.paymentSessionToken,
      ...(task.resume.kind === 'payment' ? { priceLines: task.resume.priceLines } : {}),
    }
    if (task.resume.kind === 'payment') {
      navigate('/print/cashier', { state })
      return
    }
    navigate('/print/progress', { state })
  }

  return (
    <KioskPageFrame
      className="kpv1 kpv1--content-only"
      title="继续上次"
      subtitle="选择一个未完成的任务继续"
      onBack={() => navigate('/')}
      backLabel="返回首页"
    >
      {loading && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--pv-muted)',
            fontSize: 18,
            gap: 12,
          }}
        >
          <ClockIcon aria-hidden="true" style={{ width: 24, height: 24 }} />
          正在加载未完成任务…
        </div>
      )}

      {!loading && error && (
        <div
          style={{
            margin: '8px 0',
            padding: '20px 24px',
            background: 'var(--pv-clay-soft)',
            borderRadius: 'var(--pv-r-md)',
            border: '1px solid color-mix(in srgb, var(--pv-clay) 30%, transparent)',
            fontSize: 18,
            color: 'var(--pv-clay-deep)',
          }}
        >
          加载失败，请稍后重试或返回首页重新开始。
        </div>
      )}

      {!loading && !error && tasks.length === 0 && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            color: 'var(--pv-muted)',
            padding: '48px 24px',
          }}
        >
          <ClockIcon aria-hidden="true" style={{ width: 48, height: 48, opacity: 0.4 }} />
          <div style={{ fontSize: 22, fontWeight: 600 }}>暂无未完成任务</div>
          <div style={{ fontSize: 16 }}>所有任务已完成，可从首页选择新的服务</div>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              marginTop: 8,
              minHeight: 56,
              padding: '0 40px',
              borderRadius: 'var(--pv-r-sm)',
              border: 'none',
              background: 'var(--pv-teal)',
              color: 'var(--pv-paper)',
              fontSize: 20,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--pv-sans)',
            }}
          >
            返回首页
          </button>
        </div>
      )}

      {!loading && !error && tasks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className="card"
              onClick={() => continueTask(task)}
              style={{
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 18,
                width: '100%',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'var(--pv-surface)',
                border: '1px solid var(--pv-line)',
                fontFamily: 'var(--pv-sans)',
              }}
            >
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  flexShrink: 0,
                  background: 'var(--pv-teal-soft)',
                  color: 'var(--pv-teal-deep)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {taskIcon(task.type)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 600, color: 'var(--pv-ink)', letterSpacing: 0.5 }}>
                  {task.fileName ?? '打印任务'}
                </div>
                <div style={{ fontSize: 16, color: 'var(--pv-muted)', marginTop: 4 }}>
                  {taskDescription(task)}
                </div>
                <div style={{ fontSize: 14, color: 'var(--pv-muted)', marginTop: 6, opacity: 0.7 }}>
                  {formatRelativeTime(task.updatedAt)} 更新
                </div>
              </div>
              <ArrowRightIcon
                aria-hidden="true"
                style={{ width: 24, height: 24, color: 'var(--pv-muted)', flexShrink: 0 }}
              />
            </button>
          ))}
        </div>
      )}

      {/* 合规提示 */}
      <div className="notice" style={{ marginTop: 16 }}>
        <ClockIcon aria-hidden="true" />
        未完成任务保留时间有限；为保护隐私，公共终端会话结束后记录自动清除。
      </div>
    </KioskPageFrame>
  )
}
