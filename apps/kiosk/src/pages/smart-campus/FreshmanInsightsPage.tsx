import { Button, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'

export function FreshmanInsightsPage() {
  const navigate = useNavigate()
  const back = () => navigate('/smart-campus')
  return (
    <KioskPageFrame
      header={<KioskPageHeader title="校园大数据" description="迎新报到聚合统计 · 暂未开放" onBack={back} backLabel="返回智慧校园" />}
    >
      <KioskStatePanel
        tone="permission"
        title="校园大数据暂未开放"
        description="学校书面授权、数据处理协议与聚合脱敏统计三项条件全部满足后才会开放；开放前不展示统计，也不采集个人信息。"
        actions={<Button onClick={back}>返回智慧校园</Button>}
      />
    </KioskPageFrame>
  )
}

export default FreshmanInsightsPage
