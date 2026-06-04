// ============================================================
// ResumeHomePage — AI 简历服务中心首页（/resume）
//
// 布局原则：可完成链路（诊断/优化/素材库）放主区大卡片，
// 未上线能力（面试准备）移到次级"即将上线"区。
//
// 合规：不出现一键投递/候选人管理等招聘闭环词；标注"不发送给企业"。
// ============================================================

import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import type { ResumeTargetContext } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  ClockIcon,
  FileSearchIcon,
  LayoutTemplateIcon,
  MessagesSquareIcon,
  ScanLineIcon,
  SparklesIcon,
  UploadCloudIcon,
} from 'lucide-react'

// ── 最近记录（仅从 location.state 承接，不持久化）────────────

interface RecentRecord {
  taskId?: string
  file?: { name: string; size?: string; format?: string }
  targetContext?: ResumeTargetContext
}

// ── 已上线能力（可完成完整链路）─────────────────────────────

interface CoreEntry {
  key: string
  icon: React.ComponentType<{ className?: string }>
  iconBg: string
  iconColor: string
  title: string
  description: string
  cta: string
}

const CORE_ENTRIES: CoreEntry[] = [
  {
    key: 'diagnose',
    icon: FileSearchIcon,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-600',
    title: 'AI 简历诊断',
    description: '深度分析简历内容，生成参考评分与可执行建议',
    cta: '开始诊断',
  },
  {
    key: 'optimize',
    icon: SparklesIcon,
    iconBg: 'bg-violet-50',
    iconColor: 'text-violet-600',
    title: 'AI 简历优化',
    description: '基于真实经历优化表达，查看前后对比',
    cta: '开始优化',
  },
  {
    key: 'templates',
    icon: LayoutTemplateIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    title: '简历素材库',
    description: '简历模板、求职信、感谢信、作品集封面',
    cta: '浏览素材',
  },
]

// ── 即将上线能力────────────────────────────────────────────

const UPCOMING_ENTRIES = [
  {
    key: 'interview',
    icon: MessagesSquareIcon,
    title: '面试准备',
    description: '面试要点与常见问题',
  },
]

// ── 四步流程────────────────────────────────────────────────

const FLOW_STEPS = [
  { icon: UploadCloudIcon,    label: '上传 / 扫描',  sub: '电子或纸质简历' },
  { icon: ClipboardCheckIcon, label: '选择目标方向', sub: '行业 · 岗位 · 场景' },
  { icon: FileSearchIcon,     label: '生成诊断',     sub: '参考评分 + 建议' },
  { icon: SparklesIcon,       label: '优化导出打印', sub: '前后对比 + 输出' },
]

// ── Component ──────────────────────────────────────────────

export function ResumeHomePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const recent = (location.state ?? {}) as RecentRecord
  const hasRecent = Boolean(recent.taskId)

  const handleCore = (key: string) => {
    switch (key) {
      case 'diagnose':
        navigate('/resume/source')
        break
      case 'optimize':
        if (recent.taskId) navigate('/resume/optimize', { state: recent })
        else navigate('/resume/source')
        break
      case 'templates':
        navigate('/resume/templates')
        break
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-6">
      <PageHeader
        title="AI 简历服务中心"
        subtitle="上传或扫描简历，获取诊断、优化与导出打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      {/* 四步流程（紧凑版） */}
      <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4">
        {FLOW_STEPS.map((step, i) => {
          const Icon = step.icon
          return (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50">
                  <Icon className="h-5 w-5 text-primary-600" aria-hidden="true" />
                </div>
                <p className="mt-1.5 text-xs font-medium text-gray-700">{step.label}</p>
                <p className="text-[10px] text-gray-400">{step.sub}</p>
              </div>
              {i < FLOW_STEPS.length - 1 && (
                <ArrowRightIcon className="mx-2 h-3.5 w-3.5 shrink-0 text-gray-300" aria-hidden="true" />
              )}
            </div>
          )
        })}
      </div>

      {/* ── 主区：已上线入口（3 列，首屏同行完整可见）── */}
      <section className="mt-6" aria-label="AI 简历服务">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {CORE_ENTRIES.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => handleCore(entry.key)}
                className="flex min-h-[140px] flex-col rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary-200 hover:bg-primary-50/40 active:bg-primary-100/40"
              >
                <div className={['flex h-12 w-12 items-center justify-center rounded-xl', entry.iconBg].join(' ')}>
                  <Icon className={['h-6 w-6', entry.iconColor].join(' ')} aria-hidden="true" />
                </div>
                <h3 className="mt-2.5 text-base font-semibold text-gray-900">{entry.title}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-gray-500">{entry.description}</p>
                <div className="mt-3 flex items-center">
                  <span className="rounded-lg bg-primary-600 px-3.5 py-1.5 text-sm font-semibold text-white">
                    {entry.cta}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── 次级区：即将上线 ── */}
      <section className="mt-5" aria-label="即将上线">
        <div className="mb-2 flex items-center gap-2">
          <ClockIcon className="h-4 w-4 text-gray-400" aria-hidden="true" />
          <h2 className="text-sm font-medium text-gray-400">即将上线</h2>
        </div>
        <div className="flex gap-3">
          {UPCOMING_ENTRIES.map((entry) => {
            const Icon = entry.icon
            return (
              <div
                key={entry.key}
                className="flex min-h-[72px] flex-1 items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-4 py-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100 opacity-60">
                  <Icon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-400">{entry.title}</p>
                    <span className="rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">即将上线</span>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-400">{entry.description}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 最近记录 */}
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
                <Button size="sm" variant="secondary" onClick={() => navigate('/resume/report', { state: recent })}>
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
