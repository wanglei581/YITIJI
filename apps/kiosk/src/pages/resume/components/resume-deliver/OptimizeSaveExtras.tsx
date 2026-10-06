import type { ResumeExportPricing } from '@ai-job-print/shared'
import { ResumeDraftBanner } from './ResumeDraftBanner'
import { ResumePricingBar } from './ResumePricingBar'
import { ResumeVersionsPanel } from './ResumeVersionsPanel'
import type { DraftSaveStatus } from './useResumeDraftAutosave'

/** 稿给运行页留的四件东西：草稿自动保存、多版本、定价、未登录不保存。放进「编辑与导出」卡。 */
export function OptimizeSaveExtras(props: {
  guest: boolean
  draft: { status: DraftSaveStatus; savedAt?: string | null }
  pricing: { pricing: ResumeExportPricing | null; loading: boolean; blockedReason: string | null }
  taskId?: string
  token: string | null
  exportVersion: number
}) {
  return (
    <div className="qx-opt-save-extra">
      <ResumeDraftBanner
        guest={props.guest}
        loading={false}
        choicePending={false}
        onContinue={() => undefined}
        onRestart={() => undefined}
        saveStatus={props.guest ? 'guest' : props.draft.status}
        savedAt={props.draft.savedAt}
      />
      <ResumePricingBar pricing={props.pricing.pricing} loading={props.pricing.loading} blockedReason={props.pricing.blockedReason} />
      {props.token && props.taskId ? (
        <ResumeVersionsPanel taskId={props.taskId} token={props.token} refreshKey={props.exportVersion} />
      ) : null}
    </div>
  )
}
