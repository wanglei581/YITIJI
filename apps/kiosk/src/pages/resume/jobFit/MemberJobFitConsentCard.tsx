import { Button, Card } from '@ai-job-print/ui'

interface MemberJobFitConsentCardProps {
  onNavigate: () => void
}

/** 会员岗位 AI 授权沿用既有岗位信息页入口，不新增第二套 consent 流程。 */
export function MemberJobFitConsentCard({ onNavigate }: MemberJobFitConsentCardProps) {
  return (
    <Card className="job-fit-card p-5">
      <p className="text-sm leading-relaxed text-neutral-600">
        请前往岗位信息页打开岗位 AI 辅助，在授权弹窗确认后再返回重试。
      </p>
      <Button size="lg" variant="secondary" className="mt-3 h-12 w-full" onClick={onNavigate}>
        去岗位信息页授权
      </Button>
    </Card>
  )
}
