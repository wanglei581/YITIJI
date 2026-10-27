import type { JobAiSessionListItem } from '@ai-job-print/shared'
import { formatTime } from '../assets/format'
import { MeActs, MeBtn, MeRow } from '../touch/MeKit'
import { MeAiChip } from '../touch/MeStatePacks'

const OPERATION_META: Record<JobAiSessionListItem['session']['operation'], { label: string; hint: string }> = {
  recommend: { label: '岗位 AI 推荐参考', hint: '基于本人简历与真实岗位生成' },
  explain: { label: 'AI岗位解读', hint: '基于来源岗位上的内容生成' },
  match: { label: '岗位匹配参考', hint: '用本人简历做求职准备' },
}

const STATUS_LABEL: Record<JobAiSessionListItem['session']['status'], string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

function metaLine(item: JobAiSessionListItem): string {
  const expires = item.session.expiresAt ? ` · 留存至 ${formatTime(item.session.expiresAt)}` : ''
  const recommendation = item.recommendationCount > 0 ? ` · 推荐项共计 ${item.recommendationCount} 项` : ''
  // 不写模型名（provider / llm）：工程信息，稿 39 只显示名称和状态（v2 规则 4，2026-09-30 A 批）。
  return `${formatTime(item.session.createdAt)}${recommendation}${expires}`
}

/** 岗位 AI 参考记录（只在招聘内容托管打开的私有化版本里出现）。只展示记录，不展示简历原文、提示词或模型输出。 */
export function JobAiSessionRecords({
  items,
  confirmId,
  busyId,
  onDelete,
  openKey,
  onToggle,
}: {
  items: JobAiSessionListItem[]
  confirmId: string | null
  busyId: string | null
  onDelete: (sessionId: string) => void
  openKey: string | null
  onToggle: (key: string) => void
}) {
  if (items.length === 0) return null
  return (
    <>
      <p className="me-fine">岗位 AI 参考记录 · 只展示这次岗位解读的记录（时间、岗位名等），不展示简历原文、提示词或模型原始输出。分析结果仅供参考。</p>
      {items.map((item) => {
        const meta = OPERATION_META[item.session.operation]
        const confirming = confirmId === item.session.id
        const key = `job-${item.session.id}`
        return (
          <MeRow
            key={item.session.id}
            data-flag={confirming ? 'true' : undefined}
            data-record-kind="job-ai-session"
            data-record-status={item.session.status}
            open={openKey === key}
            onToggle={() => onToggle(key)}
            title={item.job ? `${item.job.title} · ${item.job.company}` : meta.label}
            lines={[`${STATUS_LABEL[item.session.status]} · ${meta.label} · ${metaLine(item)}`, meta.hint]}
            chips={<MeAiChip />}
            actions={(
              <MeActs>
                <MeBtn
                  v={confirming ? 'danger' : 'sec'}
                  disabled={busyId === item.session.id}
                  onClick={() => onDelete(item.session.id)}
                  aria-label={confirming ? '再次点击确认删除岗位 AI 参考记录' : '删除岗位 AI 参考记录'}
                >
                  {confirming ? '再点一次确认删除' : '删除'}
                </MeBtn>
              </MeActs>
            )}
          />
        )
      })}
    </>
  )
}
