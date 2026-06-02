// ============================================================
// ResumeHomePage — AI 简历服务中心首页（/resume）
//
// 用户从这里进入完整链路：
//   选择来源 → 选择目标方向 → AI 诊断 → 优化前后对比 → 生成优化版 → 导出/打印
//
// 4 个大入口：AI简历诊断 / AI简历优化 / 简历素材库 / 面试准备(即将上线)
// 含四步流程说明、最近一次记录入口（无真实数据时空状态）、隐私合规提示。
//
// 合规：不出现一键投递/候选人管理等招聘闭环词；标注"不发送给企业"。
// ============================================================

import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import type { ResumeTargetContext } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  FileSearchIcon,
  LayoutTemplateIcon,
  MessagesSquareIcon,
  ScanLineIcon,
  SparklesIcon,
  UploadCloudIcon,
} from 'lucide-react'

// 最近一次诊断/优化记录（仅从 location.state 承接，不持久化、不硬编码假数据）
interface RecentRecord {
  taskId?: string
  file?: { name: string; size?: string; format?: string }
  targetContext?: ResumeTargetContext
}

interface EntryCard {
  key: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  description: string
  comingSoon?: boolean
}

const ENTRIES: EntryCard[] = [
  {
    key: 'diagnose',
    icon: FileSearchIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: 'AI 简历诊断',
    description: '深度分析简历内容，生成参考评分与可执行建议',
  },
  {
    key: 'optimize',
    icon: SparklesIcon,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    title: 'AI 简历优化',
    description: '基于真实经历优化表达，查看前后对比',
  },
  {
    key: 'templates',
    icon: LayoutTemplateIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    title: '简历素材库',
    description: '简历模板、求职信、感谢信、作品集封面',
  },
  {
    key: 'interview',
    icon: MessagesSquareIcon,
    iconBg: 'bg-gray-100',
    iconColor: 'text-gray-400',
    title: '面试准备',
    description: '面试要点与常见问题（即将上线）',
    comingSoon: true,
  },
]

const FLOW_STEPS = [
  { icon: UploadCloudIcon, label: '上传 / 扫描', sub: '电子或纸质简历' },
  { icon: ClipboardCheckIcon, label: '选择目标方向', sub: '行业 · 岗位 · 场景' },
  { icon: FileSearchIcon, label: '生成诊断', sub: '参考评分 + 建议' },
  { icon: SparklesIcon, label: '优化导出打印', sub: '前后对比 + 输出' },
]

export function ResumeHomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const recent = (location.state ?? {}) as RecentRecord
  const hasRecent = Boolean(recent.taskId)

  const handleEntry = (key: string) => {
    switch (key) {
      case 'diagnose':
        navigate('/resume/source')
        break
      case 'optimize':
        // 有最近 taskId 直达优化对比；否则先走来源选择生成诊断
        if (recent.taskId) navigate('/resume/optimize', { state: recent })
        else navigate('/resume/source')
        break
      case 'templates':
        navigate('/resume/templates')
        break
      case 'interview':
        // 占位：即将上线，不导航
        break
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="AI 简历服务中心"
        subtitle="上传或扫描简历，获取诊断、优化、素材与导出打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      {/* 四步流程说明 */}
      <Card className="mt-4 p-5">
        <p className="mb-4 text-sm font-medium text-gray-700">服务流程</p>
        <div className="flex items-stretch">
          {FLOW_STEPS.map((step, i) => {
            const Icon = step.icon
            return (
              <div key={step.label} className="flex flex-1 items-center">
                <div className="flex flex-1 flex-col items-center text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-50">
                    <Icon className="h-6 w-6 text-primary-600" aria-hidden="true" />
                  </div>
                  <p className="mt-2 text-sm font-medium text-gray-800">{step.label}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{step.sub}</p>
                </div>
                {i < FLOW_STEPS.length - 1 && (
                  <ArrowRightIcon className="mx-1 h-4 w-4 shrink-0 text-gray-300" aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* 4 个大入口 */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        {ENTRIES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.key}
              type="button"
              disabled={entry.comingSoon}
              onClick={() => handleEntry(entry.key)}
              className={[
                'flex min-h-[148px] flex-col rounded-xl border bg-white p-5 text-left shadow-sm transition-colors',
                entry.comingSoon
                  ? 'cursor-not-allowed border-gray-200 opacity-70'
                  : 'border-gray-200 hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100/40',
              ].join(' ')}
            >
              <div className={['flex h-14 w-14 items-center justify-center rounded-xl', entry.iconBg].join(' ')}>
                <Icon className={['h-7 w-7', entry.iconColor].join(' ')} aria-hidden="true" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <h3 className="text-lg font-semibold text-gray-900">{entry.title}</h3>
                {entry.comingSoon && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                    即将上线
                  </span>
                )}
              </div>
              <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-500">{entry.description}</p>
              {!entry.comingSoon && (
                <div className="mt-2 flex min-h-[28px] items-center gap-0.5 text-sm font-semibold text-primary-600">
                  <span>进入</span>
                  <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 最近一次记录 */}
      <div className="mt-6">
        <p className="mb-3 text-sm font-medium text-gray-700">最近记录</p>
        {hasRecent ? (
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-50">
                <FileSearchIcon className="h-6 w-6 text-primary-600" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900">
                  {recent.file?.name ?? '最近一次简历诊断'}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {recent.targetContext?.skipped
                    ? '通用诊断'
                    : [recent.targetContext?.industry, recent.targetContext?.targetJob]
                        .filter(Boolean)
                        .join(' · ') || '已生成诊断报告'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate('/resume/report', { state: recent })}
                >
                  查看报告
                </Button>
                <Button size="sm" onClick={() => navigate('/resume/optimize', { state: recent })}>
                  查看优化
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100">
              <ScanLineIcon className="h-7 w-7 text-gray-400" aria-hidden="true" />
            </div>
            <p className="text-sm text-gray-500">暂无最近诊断记录</p>
            <Button size="lg" onClick={() => navigate('/resume/source')}>
              开始简历诊断
            </Button>
          </Card>
        )}
      </div>

      {/* 隐私与合规提示 */}
      <div className="mt-6">
        <ComplianceBanner tone="success" title="隐私保护">
          {COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}
          {' '}
          {COMPLIANCE_COPY.KIOSK_RESUME_NO_SEND_ENTERPRISE}
        </ComplianceBanner>
      </div>

      <div className="h-2" />
    </div>
  )
}
