// ============================================================
// ResumeTemplateLibraryPage — 简历素材库 MVP（/resume/templates）
//
// 内容：简历模板、求职信、面试感谢信、作品集封面。
// 标签筛选：校招/社招/技术岗/运营岗/设计岗/通用。
// 操作：查看模板 / 用于简历优化 / 打印材料。
//
// 合规：不收费、不接企业端、不做投递。素材为本地占位展示，
// 真实素材后续接 service；当前不伪造后端成功。
// ============================================================

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, PageHeader } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
import {
  FileTextIcon,
  LayoutTemplateIcon,
  MailIcon,
  PrinterIcon,
  SparklesIcon,
  ImageIcon,
} from 'lucide-react'

type MaterialType = 'resume' | 'cover_letter' | 'thank_you' | 'portfolio'

interface Material {
  id: string
  type: MaterialType
  title: string
  description: string
  tags: string[]
}

const TYPE_META: Record<MaterialType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  resume:       { label: '简历模板',   icon: LayoutTemplateIcon, color: 'text-primary-600', bg: 'bg-primary-50' },
  cover_letter: { label: '求职信',     icon: MailIcon,           color: 'text-violet-600',  bg: 'bg-violet-50' },
  thank_you:    { label: '面试感谢信', icon: FileTextIcon,       color: 'text-amber-600',   bg: 'bg-amber-50' },
  portfolio:    { label: '作品集封面', icon: ImageIcon,          color: 'text-emerald-600', bg: 'bg-emerald-50' },
}

const FILTERS = ['全部', '校招', '社招', '技术岗', '运营岗', '设计岗', '通用'] as const

// 本地占位素材（MVP）。不含价格、不含企业端字段。
const MATERIALS: Material[] = [
  { id: 'm1', type: 'resume',       title: '清新校招版',     description: '应届毕业生通用，突出教育与项目经历', tags: ['校招', '通用'] },
  { id: 'm2', type: 'resume',       title: '简洁技术风',     description: '研发/技术岗位，强调技术栈与项目产出', tags: ['技术岗', '社招'] },
  { id: 'm3', type: 'resume',       title: '稳重运营版',     description: '运营/市场岗位，突出数据与增长成果',   tags: ['运营岗', '社招'] },
  { id: 'm4', type: 'resume',       title: '创意设计版',     description: '设计岗位，版式留白与作品展示友好',     tags: ['设计岗'] },
  { id: 'm5', type: 'cover_letter', title: '通用求职信',     description: '结构清晰的求职信范式，按岗位替换要点', tags: ['通用', '社招'] },
  { id: 'm6', type: 'cover_letter', title: '校招自荐信',     description: '面向校园招聘的自荐信模板',             tags: ['校招'] },
  { id: 'm7', type: 'thank_you',    title: '面试感谢信',     description: '面试后致谢与跟进，留下良好印象',       tags: ['通用'] },
  { id: 'm8', type: 'portfolio',    title: '作品集封面',     description: '设计/内容岗位作品集封面排版',         tags: ['设计岗', '通用'] },
]

export function ResumeTemplateLibraryPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')

  const visible = useMemo(() => {
    if (filter === '全部') return MATERIALS
    return MATERIALS.filter((m) => m.tags.includes(filter))
  }, [filter])

  const handlePrint = (m: Material) => {
    navigate('/print/confirm', {
      state: {
        file: { name: `${m.title}.pdf`, size: '120 KB', pages: 1 },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleUseForOptimize = () => {
    // 引导回简历来源开始诊断/优化（素材作为参考，不伪造已生成的优化文件）
    navigate('/resume/source')
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="简历素材库"
        subtitle="精选模板与求职材料，按方向选用"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/resume')}>
            返回服务中心
          </Button>
        }
      />

      {/* 标签筛选 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={[
                'min-h-[48px] rounded-full border px-4 text-sm font-medium transition-colors',
                active
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              {f}
            </button>
          )
        })}
      </div>

      {/* 素材网格 */}
      {visible.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={LayoutTemplateIcon}
            title="该分类暂无素材"
            description="请切换其他标签查看"
          />
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
          {visible.map((m) => {
            const meta = TYPE_META[m.type]
            const Icon = meta.icon
            return (
              <Card key={m.id} className="flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <div className={['flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', meta.bg].join(' ')}>
                    <Icon className={['h-6 w-6', meta.color].join(' ')} aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-gray-900">{m.title}</p>
                    <p className="text-xs text-gray-400">{meta.label}</p>
                  </div>
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-gray-500">{m.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m.tags.map((t) => (
                    <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex items-center gap-1.5"
                    onClick={handleUseForOptimize}
                  >
                    <SparklesIcon className="h-4 w-4" />
                    用于简历优化
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="flex items-center gap-1.5"
                    onClick={() => handlePrint(m)}
                  >
                    <PrinterIcon className="h-4 w-4" />
                    打印材料
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-gray-400">
        素材仅供求职准备参考使用，不涉及收费与投递流程。
      </p>
      <div className="h-2" />
    </div>
  )
}
