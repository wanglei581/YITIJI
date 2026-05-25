import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { ExternalJob } from '@ai-job-print/shared'
import { BriefcaseIcon, BuildingIcon, MapPinIcon, TagIcon } from 'lucide-react'

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_JOBS: ExternalJob[] = [
  {
    id: 'j1',
    title: '前端开发工程师',
    company: '字节跳动（上海）科技有限公司',
    city: '上海',
    salary: '25,000–35,000 元/月',
    tags: ['全职', '校招'],
    description: '负责公司旗下产品前端开发，参与页面交互设计及性能优化。',
    requirements: '本科及以上学历，熟悉 React / TypeScript，有实际项目经验优先。',
    sourceOrgId: 'org-001',
    externalId: 'ZH-2026-FE-0312',
    sourceName: '招聘网',
    sourceUrl: 'https://example-job-platform.com/jobs/ZH-2026-FE-0312',
    syncTime: '2026-05-24T08:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
  {
    id: 'j2',
    title: '行政助理',
    company: '市就业服务中心',
    city: '本市',
    salary: '面议',
    tags: ['全职'],
    description: '协助中心日常行政管理工作，负责文档整理、会议安排及接待工作。',
    requirements: '大专及以上学历，有相关行政工作经验者优先，熟练使用 Office 办公软件。',
    sourceOrgId: 'org-002',
    externalId: 'GOV-2026-ADM-0045',
    sourceName: '市人社局官网',
    sourceUrl: 'https://example-hrss.gov.cn/jobs/GOV-2026-ADM-0045',
    syncTime: '2026-05-23T10:30:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
  {
    id: 'j3',
    title: 'Java 后端工程师',
    company: '阿里云计算有限公司',
    city: '杭州',
    salary: '20,000–30,000 元/月',
    tags: ['全职', '校招'],
    description: '负责云服务核心模块后端开发，参与分布式系统设计与优化。',
    requirements: '本科及以上，熟悉 Java/Spring Boot，了解微服务架构，有高并发系统开发经验优先。',
    sourceOrgId: 'org-001',
    externalId: 'ZH-2026-BE-0889',
    sourceName: '招聘网',
    sourceUrl: 'https://example-job-platform.com/jobs/ZH-2026-BE-0889',
    syncTime: '2026-05-24T08:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
  {
    id: 'j4',
    title: 'UI 设计师（实习）',
    company: '腾讯科技（深圳）有限公司',
    city: '深圳',
    salary: '150–200 元/天',
    tags: ['实习'],
    description: '参与产品界面设计，完成视觉稿输出，与前端团队协作落地设计方案。',
    requirements: '设计相关专业在校生，熟练使用 Figma / Sketch，有实习作品集优先。',
    sourceOrgId: 'org-001',
    externalId: 'ZH-2026-UI-1203',
    sourceName: '招聘网',
    sourceUrl: 'https://example-job-platform.com/jobs/ZH-2026-UI-1203',
    syncTime: '2026-05-22T14:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
  {
    id: 'j5',
    title: '客服专员',
    company: '某人力资源服务有限公司',
    city: '本市',
    salary: '4,500–6,000 元/月',
    tags: ['兼职'],
    description: '负责电话及在线客服接待，解答用户咨询，协助处理售后问题。',
    requirements: '高中及以上学历，普通话流利，有客服相关经验者优先，可兼职。',
    sourceOrgId: 'org-003',
    externalId: 'HR-2026-CS-0056',
    sourceName: '本地就业网',
    sourceUrl: 'https://example-local-jobs.com/jobs/HR-2026-CS-0056',
    syncTime: '2026-05-21T09:00:00Z',
    reviewStatus: 'published',
    publishStatus: 'published',
  },
]

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
