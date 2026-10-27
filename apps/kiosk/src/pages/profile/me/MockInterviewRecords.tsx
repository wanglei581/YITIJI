import type { MemberInterviewItem } from '@ai-job-print/shared'
import { formatTime } from '../assets/format'
import { MeActs, MeBtn, MeRow } from '../touch/MeKit'
import { MeAiChip } from '../touch/MeStatePacks'

function metaLine(item: MemberInterviewItem): string {
  const ended = item.endedAt ? ` · 结束于 ${formatTime(item.endedAt)}` : ''
  return `${item.industry} · ${item.durationMin} 分钟 · ${formatTime(item.createdAt)}${ended}`
}

/** 模拟面试：有报告可打开，删除两步（确认状态由页面持有）。每条挂「AI 生成，仅供参考」。 */
export function MockInterviewRecords({
  items,
  confirmId,
  busyId,
  onOpen,
  onDelete,
  openKey,
  onToggle,
}: {
  items: MemberInterviewItem[]
  confirmId: string | null
  busyId: string | null
  onOpen: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  openKey: string | null
  onToggle: (key: string) => void
}) {
  if (items.length === 0) return null
  return (
    <>
      {items.map((item) => {
        const confirming = confirmId === item.sessionId
        const key = `iv-${item.sessionId}`
        return (
          <MeRow
            key={item.sessionId}
            data-flag={confirming ? 'true' : undefined}
            open={openKey === key}
            onToggle={() => onToggle(key)}
            title={`模拟面试 · ${item.position}`}
            lines={[`${item.hasReport ? '已完成' : '无报告'} · ${item.interviewerLabel} · ${metaLine(item)}`]}
            chips={<MeAiChip />}
            actions={(
              <MeActs>
                {item.hasReport ? (
                  <MeBtn v="pri" onClick={() => onOpen(item.sessionId)} aria-label={`查看模拟面试报告 ${item.position}`}>打开报告</MeBtn>
                ) : null}
                <MeBtn
                  v={confirming ? 'danger' : 'sec'}
                  disabled={busyId === item.sessionId}
                  onClick={() => onDelete(item.sessionId)}
                  aria-label={confirming ? '再次点击确认删除模拟面试记录' : '删除模拟面试记录'}
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
