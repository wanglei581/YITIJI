import { AlertTriangleIcon, InfoIcon } from 'lucide-react'
import type { RecruitmentHostingView } from './useRecruitmentHosting'

/**
 * 招聘类页面顶部的托管状态说明。只描述开关的行为，不宣称存量数据已清理
 * （CLAUDE.md §1：3.15 清理完成前不得对外说「我们云上已不存这些数据」）。
 *
 * 3.15 起管理员侧的审核、发布、代建、同步控件不论开关一律停放（源码保留、不再挂载），
 * 所以这里不再说「按钮先不显示」——按钮本来就没有了；开关只决定一体机与小程序展不展示这类内容。
 */
export function RecruitmentHostingNotice({
  hosting,
  subject,
  detail,
}: {
  hosting: RecruitmentHostingView
  /** 本页内容的叫法，例如「岗位」「招聘会」「企业资料」，用于默认说明 */
  subject?: string
  /** 本页能做什么与不能做什么的说明；不传时用「只保留查看与紧急下架」的默认说法 */
  detail?: string
}) {
  if (hosting.status === 'loading') return null

  if (hosting.status === 'error') {
    return (
      <div role="status" className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg">
        <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex-1">
          暂时无法确认招聘内容托管状态。本页的查看、紧急下架与熔断不受影响。
        </div>
        <button
          type="button"
          onClick={hosting.retry}
          className="shrink-0 rounded-md border border-warning/40 px-2.5 py-1 text-xs font-semibold hover:bg-warning/10"
        >
          重新读取
        </button>
      </div>
    )
  }

  if (!hosting.enabled) {
    return (
      <div role="status" className="mb-4 flex items-start gap-2.5 rounded-lg border border-info/20 bg-info-bg px-4 py-3 text-sm text-info-fg">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">本平台已关闭招聘内容托管</p>
          <p className="mt-0.5">
            {detail ?? `一体机与小程序不展示${subject ?? '招聘类内容'}。本平台不代审、不代发，本页只保留查看与紧急下架。紧急下架是单向操作，提交后不能恢复，并会自动通知所属机构。`}
          </p>
        </div>
      </div>
    )
  }

  return null
}
