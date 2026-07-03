import { Button, Card } from '@ai-job-print/ui'
import type { JobAiRecommendationDTO, JobExplainResponse } from '@ai-job-print/shared'
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon, SparklesIcon, TrendingUpIcon } from 'lucide-react'
import type { JobAiMatchResponse } from '../../../services/api/jobAi'

const FIT_LABEL: Record<string, string> = {
  reference_high: '匹配参考：较高',
  reference_medium: '匹配参考：中等',
  reference_low: '匹配参考：偏低',
}

export function JobAiResultPanel({
  title,
  loading,
  error,
  recommendations,
  explanation,
  match,
  clearLabel = '退出 AI 推荐',
  onRetry,
  onClear,
  onOpenRecommendation,
}: {
  title: string
  loading?: boolean
  error?: string | null
  recommendations?: JobAiRecommendationDTO[]
  explanation?: JobExplainResponse | null
  match?: JobAiMatchResponse | null
  clearLabel?: string
  onRetry?: () => void
  onClear?: () => void
  onOpenRecommendation?: (jobId: string) => void
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
            <p className="mt-0.5 text-xs text-neutral-400">仅供参考，不代表录用结果。</p>
          </div>
        </div>
        {onClear && (
          <Button size="sm" variant="secondary" onClick={onClear}>
            {clearLabel}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="mt-5 flex min-h-[8rem] items-center justify-center gap-2 text-sm text-neutral-400">
          <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />
          正在生成岗位 AI 参考…
        </div>
      ) : error ? (
        <div className="mt-4 rounded-xl bg-error-bg px-4 py-3">
          <div className="flex items-start gap-2 text-sm text-error-fg">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
          {onRetry && (
            <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
              重试
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {recommendations && <RecommendationList items={recommendations} onOpen={onOpenRecommendation} />}
          {explanation && <ExplanationBlock value={explanation} />}
          {match && <MatchBlock value={match} />}
        </div>
      )}
    </Card>
  )
}

function RecommendationList({ items, onOpen }: { items: JobAiRecommendationDTO[]; onOpen?: (jobId: string) => void }) {
  if (items.length === 0) {
    return <p className="rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-500">当前简历未匹配到更合适的岗位，请调整筛选条件或更新简历后再试。</p>
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.job.jobId} className="rounded-xl border border-neutral-100 bg-white px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutral-900">{item.job.title}</p>
              <p className="mt-0.5 truncate text-xs text-neutral-400">{item.job.company} · {item.job.sourceName}</p>
            </div>
            <span className="shrink-0 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
              {FIT_LABEL[item.fitLevel] ?? '匹配参考'}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">{item.summary}</p>
          <SuggestionList title="匹配点" items={item.matchPoints} />
          <SuggestionList title="准备动作" items={item.actionChecklist} />
          {onOpen && (
            <Button size="sm" variant="secondary" className="mt-3 h-12 w-full" onClick={() => onOpen(item.job.jobId)}>
              查看岗位详情
            </Button>
          )}
        </div>
      ))}
    </div>
  )
}

function ExplanationBlock({ value }: { value: JobExplainResponse }) {
  return (
    <div className="space-y-3">
      {value.dataQualityWarning && (
        <p className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning-fg">{value.dataQualityWarning}</p>
      )}
      <SuggestionList title="这个岗位主要做什么" items={value.responsibilities} />
      <SuggestionList title="必须准备的要求" items={value.mustHaveRequirements} />
      <SuggestionList title="可加分的准备" items={value.niceToHaveRequirements} />
      <SuggestionList title="面试前准备建议" items={value.preparationTips} />
    </div>
  )
}

function MatchBlock({ value }: { value: JobAiMatchResponse }) {
  const fitLevel = value.jobFit.fitLevel ?? 'reference_medium'
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-primary-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary-800">
          <TrendingUpIcon className="h-4 w-4" aria-hidden="true" />
          {FIT_LABEL[fitLevel] ?? '匹配参考'}
        </div>
        {value.jobFit.summary && <p className="mt-2 text-sm leading-relaxed text-neutral-700">{value.jobFit.summary}</p>}
      </div>
      <SuggestionList title="匹配点" items={(value.jobFit.matchPoints ?? []).map((item) => item.point)} />
      <SuggestionList title="差距与建议" items={(value.jobFit.gapPoints ?? []).map((item) => `${item.gap}：${item.suggestion}`)} />
      <SuggestionList title="准备动作" items={value.jobFit.targetedSuggestions ?? []} />
    </div>
  )
}

function SuggestionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-neutral-400">{title}</p>
      <ul className="space-y-1.5">
        {items.slice(0, 6).map((item) => (
          <li key={item} className="flex gap-2 text-sm leading-relaxed text-neutral-600">
            <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
