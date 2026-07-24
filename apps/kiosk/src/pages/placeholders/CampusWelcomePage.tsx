import { Button, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'

export default function CampusWelcomePage() {
  const navigate = useNavigate()
  const back = () => navigate('/campus')
  return (
    <KioskPageFrame
      header={<KioskPageHeader title="校园招聘迎新指引" onBack={back} backLabel="返回校园招聘" />}
    >
      <KioskStatePanel
        tone="empty"
        title="当前没有独立迎新招聘内容"
        description="请返回校园招聘专区查看本校招聘会与来源平台信息；智慧校园迎新服务位于独立专区。"
        actions={<Button onClick={back}>返回校园招聘</Button>}
      />
    </KioskPageFrame>
  )
}
