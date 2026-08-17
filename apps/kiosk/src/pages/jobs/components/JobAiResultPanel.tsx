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
          {match && <MatchBlock value={match} onRetry={onRetry} />}
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

function MatchBlock({ value, onRetry }: { value: JobAiMatchResponse; onRetry?: () => void }) {
  const { jobFit } = value

  // 后端 governed-job-fit.service.ts 在分析失败时仍返回 HTTP 200，只把
  // JobFitResponse.status 置为 'failed'（见 packages/shared/src/types/ai.ts:405）。
  // 不看这个字段就会把「没生成出来」渲染成「生成完了但内容为空」——
  // 而且 fitLevel 缺失时旧代码还会兜底成 reference_medium，等于替模型编了一个
  // 「匹配参考：中等」。两者都违反 CLAUDE.md §9「不伪造能力」。
  // 处置对齐 JobFitPage.tsx:196/235 的既有口径：如实说没生成出来，并给重试。
  if (jobFit.status === 'failed') {
    return (
      <div className="rounded-xl bg-warning-bg px-4 py-3">
        <div className="flex items-start gap-2 text-sm text-warning-fg">
          <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{jobFit.failReason ?? '这次没有生成出匹配参考，请稍后重试。'}</span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          没有生成结果不影响你查看岗位详情，也不影响去来源平台投递。
        </p>
        {onRetry && (
          <Button size="sm" variant="secondary" className="mt-3 h-12 w-full" onClick={onRetry}>
            重新生成
          </Button>
        )}
      </div>
    )
  }

  // fitLevel 缺失时不兜底成「中等」——查不到就只说「匹配参考」，不替模型定级。
  const fitLabel = jobFit.fitLevel ? (FIT_LABEL[jobFit.fitLevel] ?? '匹配参考') : '匹配参考'
  const matchPoints = jobFit.matchPoints ?? []
  const keywordCoverage = jobFit.decisionSupport?.keywordCoverage
  const hasKeywords = Boolean(
    keywordCoverage && (keywordCoverage.matched.length > 0 || keywordCoverage.missing.length > 0)
  )

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-primary-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary-800">
          <TrendingUpIcon className="h-4 w-4" aria-hidden="true" />
          {fitLabel}
        </div>
        {jobFit.summary && <p className="mt-2 text-sm leading-relaxed text-neutral-700">{jobFit.summary}</p>}
      </div>

      {/* 匹配点连同 evidence 一起给。evidence 是服务端核验过必须出自简历原文的摘录
          （packages/shared/src/types/ai.ts:365），丢掉它等于把「有依据的结论」
          降级成「无出处的断言」。呈现口径对齐 resume/jobFit/FitSkillMap.tsx:29。 */}
      {matchPoints.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-400">匹配点 · 每条附简历原文依据</p>
          <ul className="space-y-2">
            {matchPoints.slice(0, 6).map((item, index) => (
              <li
                key={`${item.point.slice(0, 24)}-${index}`}
                className="rounded-lg border border-neutral-100 bg-white px-3 py-2"
              >
                <div className="flex gap-2 text-sm leading-relaxed text-neutral-600">
                  <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden="true" />
                  <span>{item.point}</span>
                </div>
                {item.evidence && (
                  <p className="mt-1 pl-6 text-xs leading-relaxed text-neutral-400">
                    原文依据：「{item.evidence}」
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <SuggestionList title="差距与建议" items={(jobFit.gapPoints ?? []).map((item) => `${item.gap}：${item.suggestion}`)} />
      <SuggestionList title="准备动作" items={jobFit.targetedSuggestions ?? []} />

      {/* 关键词覆盖：后端已产出且已校验，此前这一处整块丢弃。 */}
      {hasKeywords && keywordCoverage && (
        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-400">关键词覆盖</p>
          <div className="flex flex-wrap gap-1.5">
            {keywordCoverage.matched.map((kw) => (
              <span key={`m-${kw}`} className="rounded-full bg-primary-50 px-2.5 py-1 text-xs text-primary-700">
                已具备 · {kw}
              </span>
            ))}
            {keywordCoverage.missing.map((kw) => (
              <span key={`g-${kw}`} className="rounded-full bg-warning-bg px-2.5 py-1 text-xs text-warning-fg">
                待补足 · {kw}
              </span>
            ))}
          </div>
        </div>
      )}
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
