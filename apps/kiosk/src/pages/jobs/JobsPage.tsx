import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO } from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, MapPinIcon, TagIcon } from 'lucide-react'
import { getJobs } from '../../services/api'

const ALL_TAGS = ['全部', '全职', '实习', '校招', '兼职']

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 同步`
}

const TAG_STYLES: Record<string, string> = {
  全职: 'bg-blue-50 text-blue-600',
  实习: 'bg-orange-50 text-orange-600',
  校招: 'bg-green-50 text-green-600',
  兼职: 'bg-purple-50 text-purple-600',
}

export function JobsPage() {
  const navigate = useNavigate()
  const [jobs,     setJobs]     = useState<ExternalJobDTO[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)
  const [activeTag, setActiveTag] = useState('全部')

  useEffect(() => {
    let cancelled = false
    getJobs()
      .then((res) => {
        if (cancelled) return
        setJobs(res.data)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = activeTag === '全部' ? jobs : jobs.filter((j) => j.tags.includes(activeTag))

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <BriefcaseIcon className="h-12 w-12 text-gray-200" />
        <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        <Button variant="secondary" onClick={() => navigate('/')}>返回首页</Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pt-6">
        <PageHeader
          title="岗位信息"
          subtitle="来源：第三方平台 · 官方机构"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />

        <p className="mt-3 text-xs text-gray-400">
          本系统仅展示第三方来源岗位信息，不参与招聘流程，请前往来源平台办理
        </p>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {ALL_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeTag === tag
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16">
            <BriefcaseIcon className="h-12 w-12 text-gray-200" />
            <p className="mt-4 text-sm text-gray-400">该分类暂无岗位</p>
          </div>
        ) : (
          filtered.map((job) => (
            <Card key={job.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-gray-900">{job.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <BuildingIcon className="h-3.5 w-3.5" />
                      {job.company}
                    </span>
                    <span className="flex items-center gap-1">
                      <MapPinIcon className="h-3.5 w-3.5" />
                      {job.city}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium text-primary-600">
                  {job.salaryDisplay}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {job.tags.map((t) => (
                  <span
                    key={t}
                    className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${TAG_STYLES[t] ?? 'bg-gray-100 text-gray-500'}`}
                  >
                    <TagIcon className="h-3 w-3" />
                    {t}
                  </span>
                ))}
                <span className="ml-auto text-xs text-gray-400">
                  {job.sourceName} · {formatSync(job.syncTime)}
                </span>
              </div>

              <div className="mt-4">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => navigate(`/jobs/${job.id}`, { state: { job } })}
                >
                  查看详情
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
