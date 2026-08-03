import { Button, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'

export default function FreshmanInsightsPage() {
  const navigate = useNavigate()
  const back = () => navigate('/campus')
  return (
    <KioskPageFrame
      header={<KioskPageHeader title="校园招聘数据" onBack={back} backLabel="返回校园招聘" />}
    >
      <KioskStatePanel
        tone="empty"
        title="暂无经核验的校园招聘统计"
        description="当前没有经核验的校园招聘聚合统计，请查看具体招聘会；不会展示示例数据。"
        actions={<Button onClick={back}>返回校园招聘</Button>}
      />
    </KioskPageFrame>
  )
}
