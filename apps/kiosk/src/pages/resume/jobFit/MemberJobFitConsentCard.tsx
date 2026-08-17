import { Button, Card } from '@ai-job-print/ui'

interface MemberJobFitConsentCardProps {
  /** 就地授权。走既有 `POST /me/ai-consents`（scope `job_ai`），不新增第二套 consent 模型。 */
  onAuthorize: () => void
  /** 授权 + 重跑分析进行中。 */
  busy?: boolean
}

/**
 * 会员岗位 AI 授权卡（S2-2）。
 *
 * 原实现把用户打发去 `/jobs` 授权（问题 F2）：用户在岗位匹配页点了分析，
 * 却被要求先离开这一页、去另一个域找一个岗位、在那儿点开 AI 辅助、同意、再走回来。
 * 中途丢掉已选岗位与已恢复的报告，实际等于放弃。
 *
 * 现在就地授权。**scope 仍是 `job_ai`，弹窗仍是 `JobAiConsentModal`** ——
 * 同一个授权范围只能有一套法律文案，这里不另写一份。
 *
 * 匿名态不走这张卡：匿名有专属的 `POST /resume/job-fit/consent`
 * （那三个端点**有意拒绝 Bearer**，不要改它们）。两条路径在页面上收敛成同一个入口。
 */
export function MemberJobFitConsentCard({ onAuthorize, busy = false }: MemberJobFitConsentCardProps) {
  return (
    <Card className="job-fit-card p-5">
      <p className="text-sm leading-relaxed text-neutral-600">
        岗位匹配参考需要你先同意「岗位 AI 辅助」。结果只展示给你本人，不会共享给企业或合作机构。
      </p>
      <Button
        size="lg"
        className="job-fit-primary-action mt-3 h-14 w-full"
        onClick={onAuthorize}
        disabled={busy}
      >
        {busy ? '正在授权…' : '开启岗位 AI 辅助'}
      </Button>
    </Card>
  )
}
