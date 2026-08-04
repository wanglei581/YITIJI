import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskPageFrame } from '@ai-job-print/ui'
import {
  FileTextIcon,
  PrinterIcon,
  ScanIcon,
  SparklesIcon,
  ArrowRightIcon,
  ClockIcon,
} from 'lucide-react'
import { API_BASE_URL, API_MODE } from '../../services/api/client'
import '../../styles/prototype-v1.css'

interface PendingTask {
  id: string
  type: 'print' | 'resume' | 'scan' | 'ai-service' | string
  title: string
  description: string
  route: string
  updatedAt: string
}

interface PendingTasksResponse {
  data: PendingTask[]
}

function taskIcon(type: string) {
  switch (type) {
    case 'print':      return <PrinterIcon aria-hidden="true" style={{ width: 28, height: 28 }} />
    case 'resume':     return <FileTextIcon aria-hidden="true" style={{ width: 28, height: 28 }} />
    case 'scan':       return <ScanIcon aria-hidden="true" style={{ width: 28, height: 28 }} />
    case 'ai-service': return <SparklesIcon aria-hidden="true" style={{ width: 28, height: 28 }} />
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

async function fetchPendingTasks(): Promise<PendingTask[]> {
  const url = new URL(`${API_BASE_URL}/me/pending-tasks`, window.location.origin)
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = (await res.json()) as PendingTasksResponse
  return Array.isArray(json.data) ? json.data : []
}

export function SessionResumePage() {
  const navigate = useNavigate()
  const [tasks,   setTasks]   = useState<PendingTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    // Mock 模式下没有真实 pending-tasks 接口，直接显示空态。
    if (API_MODE !== 'http') {
      setLoading(false)
      return
    }
    let cancelled = false
    fetchPendingTasks()
      .then((data) => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

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
              onClick={() => navigate(task.route)}
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
                  {task.title}
                </div>
                <div style={{ fontSize: 16, color: 'var(--pv-muted)', marginTop: 4 }}>
                  {task.description}
                </div>
                <div style={{ fontSize: 14, color: 'var(--pv-muted)', marginTop: 6, opacity: 0.7 }}>
                  {formatRelativeTime(task.updatedAt)} 中断
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
