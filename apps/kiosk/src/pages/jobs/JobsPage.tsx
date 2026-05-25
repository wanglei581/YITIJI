import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { BriefcaseIcon, BuildingIcon, MapPinIcon, TagIcon } from 'lucide-react'
import { MOCK_JOBS } from '../../data/externalSources'

const ALL_TAGS = ['全部', '全职', '实习', '校招', '兼职']

// ─── Utilities ────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function JobsPage() {
  const navigate = useNavigate()
  const [activeTag, setActiveTag] = useState('全部')

  const filtered =
    activeTag === '全部' ? MOCK_JOBS : MOCK_JOBS.filter((j) => j.tags.includes(activeTag))

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

        {/* 合规提示 */}
        <p className="mt-3 text-xs text-gray-400">
          本系统仅展示第三方来源岗位信息，不参与招聘流程，请前往来源平台投递
        </p>

        {/* 分类筛选 */}
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

      {/* 列表 */}
      <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16">
            <BriefcaseIcon className="h-12 w-12 text-gray-200" />
            <p className="mt-4 text-sm text-gray-400">该分类暂无岗位</p>
          </div>
        ) : (
          filtered.map((job) => (
            <Card key={job.id} className="p-5">
              {/* 标题行 */}
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
                {job.salary && (
                  <span className="shrink-0 text-sm font-medium text-primary-600">{job.salary}</span>
                )}
              </div>

              {/* 标签 */}
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

              {/* 操作 */}
              <div className="mt-4 flex gap-3">
                <Button
                  size="sm"
                  className="flex-1"
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
