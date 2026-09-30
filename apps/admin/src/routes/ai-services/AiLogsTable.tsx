import { formatCount, formatDateTime } from '@ai-job-print/shared'
import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import type { AdminAiLogEntry, AiOperation, AiLogStatus } from '../../services/api'
import { OPERATION_LABELS } from './aiOperationLabels'
import { aiLogReason, aiProviderName } from './aiLogDisplay'

const STATUS_MAP: Record<AiLogStatus, { badge: 'success' | 'error'; label: string }> = {
  success: { badge: 'success', label: '成功' },
  failed: { badge: 'error', label: '失败' },
}

// ─── 筛选类型 ─────────────────────────────────────────────────

export type OpFilter = 'all' | AiOperation
export type StatusFilter = 'all' | AiLogStatus

const OP_FILTERS: OpFilter[] = [
  'all',
  'parseResume',
  'optimizeResume',
  'adjustResumeLayout',
  'generateResume',
  'chatAssistant',
  'classifyIntent',
  'jobRecommend',
  'jobExplain',
  'jobMatch',
  'careerPlan',
  'fairVisitPlan',
  'interviewQuestion',
  'interviewReport',
  'voiceTranscribe',
  'voiceSynthesize',
  // selfAssessment 此前有标签但漏在筛选列表外，日志页筛不出来；一并补上。
  'selfAssessment',
  'contractReview',
]
const OP_FILTER_LABELS: Record<OpFilter, string> = {
  all: '全部',
  parseResume: '简历解析',
  optimizeResume: '简历优化',
  adjustResumeLayout: '排版调整',
  generateResume: 'AI 简历生成',
  chatAssistant: 'AI 对话',
  classifyIntent: '意图分类',
  jobRecommend: '岗位推荐',
  jobExplain: '岗位解读',
  jobMatch: '匹配参考',
  careerPlan: '职业规划',
  fairVisitPlan: '招聘会计划',
  interviewQuestion: '面试出题',
  interviewReport: '面试报告',
  voiceTranscribe: '语音转写',
  voiceSynthesize: '语音播报',
  selfAssessment: '自我探索 · 倾向参考',
  contractReview: '合同审查',
}
/** 单页条数。后端硬上限 500（services/api/src/ai/ai-log.service.ts MAX_LOG_LIMIT）。 */
export const LOGS_PAGE_SIZE = 100

const STATUS_FILTERS: StatusFilter[] = ['all', 'success', 'failed']
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: '全部状态',
  success: '成功',
  failed: '失败',
}

interface Props {
  logs: AdminAiLogEntry[]
  logsTotal: number
  logsOffset: number
  logsLoading: boolean
  logsError: string | null
  opFilter: OpFilter
  statusFilter: StatusFilter
  applyOpFilter: (filter: OpFilter) => void
  applyStatusFilter: (filter: StatusFilter) => void
  setLogsOffset: (offset: number) => void
}

export function AiLogsTable({
  logs,
  logsTotal,
  logsOffset,
  logsLoading,
  logsError,
  opFilter,
  statusFilter,
  applyOpFilter,
  applyStatusFilter,
  setLogsOffset,
}: Props) {
  const columns: ConsoleColumn<AdminAiLogEntry>[] = [
    {
      id: 'operation',
      header: '服务类型',
      cell: (log) => (
        <span title={`任务编号：${log.taskId} · ${log.operation}`}>
          {OPERATION_LABELS[log.operation] ?? '其他 AI 功能'}
        </span>
      ),
    },
    {
      id: 'provider',
      header: '厂商与模型',
      truncate: true,
      title: (log) => log.provider,
      cell: (log) => aiProviderName(log.provider),
    },
    {
      id: 'status',
      header: '状态与原因',
      cell: (log) => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            dot
            status={STATUS_MAP[log.status].badge}
            label={STATUS_MAP[log.status].label}
          />
          {log.errorCode && (
            <span title={log.errorCode} className="text-xs text-neutral-500">
              {aiLogReason(log.errorCode)}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'latency',
      header: '响应时间',
      align: 'right',
      cell: (log) =>
        log.latencyMs >= 1000
          ? `${(log.latencyMs / 1000).toFixed(1)} 秒`
          : `${formatCount(log.latencyMs)} 毫秒`,
    },
    {
      id: 'time',
      header: '时间',
      cellClassName: 'whitespace-nowrap text-xs text-neutral-500',
      cell: (log) => formatDateTime(log.createdAt),
    },
  ]
  return (
    <section aria-label="最近 AI 调用日志" className="mt-7">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500"
            aria-hidden="true"
          />
          <h2 className="text-[13px] font-bold text-neutral-700">最近调用日志</h2>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex flex-wrap rounded-lg border border-neutral-200 bg-surface text-sm">
            {OP_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => applyOpFilter(f)}
                className={`px-3 py-1.5 first:rounded-l-lg last:rounded-r-lg ${
                  opFilter === f
                    ? 'bg-primary-600 text-white'
                    : 'text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {OP_FILTER_LABELS[f]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap rounded-lg border border-neutral-200 bg-surface text-sm">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => applyStatusFilter(f)}
                className={`px-3 py-1.5 first:rounded-l-lg last:rounded-r-lg ${
                  statusFilter === f
                    ? 'bg-primary-600 text-white'
                    : 'text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {STATUS_FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <ConsoleTable
          items={logs}
          columns={columns}
          loading={logsLoading}
          error={logsError ? { title: '调用日志加载失败', message: logsError } : null}
          empty={{
            title: '该筛选条件下没有调用记录',
            description: '已按条件查询全部记录，请调整筛选条件。',
          }}
          page={Math.floor(logsOffset / LOGS_PAGE_SIZE) + 1}
          pageSize={LOGS_PAGE_SIZE}
          total={logsTotal}
          onPageChange={(page) => setLogsOffset((page - 1) * LOGS_PAGE_SIZE)}
        />
      </Card>
    </section>
  )
}
