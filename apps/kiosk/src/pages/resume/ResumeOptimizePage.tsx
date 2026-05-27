import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, InfoIcon, PrinterIcon, SparklesIcon } from 'lucide-react'
import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { getResumeOptimize } from '../../services/api'

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  const taskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const file   = state?.file as { name: string; size: string; format: string } | undefined

  const [modules,  setModules]  = useState<ResumeOptimizeModule[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)

  useEffect(() => {
    if (!taskId) {
      setLoading(false)
      setError(true)
      return
    }
    let cancelled = false
    getResumeOptimize(taskId)
      .then((res) => {
        if (cancelled) return
        if (res.modules && res.modules.length > 0) setModules(res.modules)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId])

  const handleSaveAdvice = () => {
    const advice = modules.map((m) => ({
      title:  m.title,
      before: m.before,
      after:  m.after,
    }))
    navigate('/profile', {
      state: {
        savedResumeAdvice: {
          file,
          suggestions: advice,
          savedAt: new Date().toISOString(),
        },
      },
    })
  }

  const handlePrintOriginal = () => {
    navigate('/print/confirm', {
      state: {
        file: {
          name:  file?.name  ?? '简历.pdf',
          size:  file?.size  ?? '200 KB',
          pages: 1,
        },
        copies: 1,
        duplex: 'single',
        color:  'bw',
      },
    })
  }

  const handleViewFile = () => {
    navigate('/resume/export', { state })
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col p-6">
        <PageHeader
          title="优化建议"
          subtitle="基于已有内容优化表达"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
              返回报告
            </Button>
          }
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
            <SparklesIcon className="h-10 w-10 animate-pulse text-primary-600" />
          </div>
          <p className="text-base text-gray-500">正在生成优化建议…</p>
        </div>
      </div>
    )
  }

  if (error || modules.length === 0) {
    return (
      <div className="flex h-full flex-col p-6">
        <PageHeader
          title="优化建议"
          subtitle="基于已有内容优化表达"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
              返回报告
            </Button>
          }
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <AlertCircleIcon className="h-14 w-14 text-gray-300" />
          <p className="text-base text-gray-500">暂无优化建议，请返回重新解析</p>
          <Button variant="secondary" onClick={() => navigate('/resume/source')}>
            重新开始
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="优化建议"
        subtitle="基于已有内容优化表达（仅供参考）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate(-1)}>
            返回报告
          </Button>
        }
      />

      {/* 合规提示 */}
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2.5">
        <InfoIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <p className="text-xs text-gray-400">以下建议基于已有内容调整表达，不生成虚假经历，结果仅供参考</p>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto">
        {modules.map((mod) => (
          <Card key={mod.title} className="p-5">
            <p className="mb-3 text-sm font-semibold text-gray-800">{mod.title}</p>

            {/* 优化前 */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <p className="mb-1 text-xs font-medium text-gray-400">优化前</p>
              <p className="text-sm text-gray-600">{mod.before}</p>
            </div>

            {/* 建议参考 */}
            <div className="mt-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3">
              <p className="mb-1 text-xs font-medium text-primary-500">建议参考</p>
              <p className="text-sm text-gray-700">{mod.after}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button size="lg" onClick={handleSaveAdvice}>
          保存优化建议
        </Button>
        <Button size="lg" variant="secondary" onClick={handleViewFile}>
          查看简历文件
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="flex items-center gap-2"
          onClick={handlePrintOriginal}
        >
          <PrinterIcon className="h-4 w-4" />
          打印原简历
        </Button>
        <Button size="lg" variant="secondary" onClick={() => navigate('/')}>
          返回首页
        </Button>
      </div>
    </div>
  )
}
