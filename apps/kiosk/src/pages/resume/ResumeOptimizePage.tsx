import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { InfoIcon, PrinterIcon } from 'lucide-react'

interface OptimizeModule {
  title: string
  before: string
  after: string
}

const OPTIMIZE_MODULES: OptimizeModule[] = [
  {
    title: '个人简介表达优化',
    before: '热爱工作，积极向上，有较强的学习能力和团队合作精神。',
    after: '建议改为具体可量化的表达，如：具有X年前端开发经验，熟练掌握 React、TypeScript，参与过中型商业项目全程开发，注重代码质量与用户体验。',
  },
  {
    title: '项目经历表达优化',
    before: '参与了公司内部系统的开发工作，完成了部分功能。',
    after: '建议改为具体职责+成果，如：主导前端模块开发（React + Vite），实现用户管理、权限控制等核心功能；优化页面加载流程，系统响应时间降低约 40%。',
  },
  {
    title: '技能关键词建议',
    before: '已有：React、JavaScript、CSS。',
    after: '建议补充：TypeScript、Vite、Git、RESTful API 等关键词，与目标岗位方向更好匹配（根据实际求职方向按需添加）。',
  },
  {
    title: '排版建议',
    before: '经历条目格式不统一，字体层级不清晰，段落间距偏小。',
    after: '建议统一使用"公司名 | 职位 | 时间段"格式；正文使用无衬线字体；段落间距建议 1.5 倍行距，整体视觉更清爽专业。',
  },
]

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  const file = state?.file as { name: string; size: string; format: string } | undefined

  const handleSaveAdvice = () => {
    const advice = OPTIMIZE_MODULES.map((m) => ({
      title: m.title,
      before: m.before,
      after: m.after,
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
          name: file?.name ?? '简历.pdf',
          size: file?.size ?? '200 KB',
          pages: 1,
        },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  const handleViewFile = () => {
    navigate('/resume/export', { state })
  }

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

      {/* 合规提示 */}
      <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2.5">
        <InfoIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <p className="text-xs text-gray-400">以下建议基于已有内容调整表达，不生成虚假经历</p>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto">
        {OPTIMIZE_MODULES.map((mod) => (
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
