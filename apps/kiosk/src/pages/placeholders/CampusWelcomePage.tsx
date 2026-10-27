import { useNavigate } from 'react-router-dom'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { RtFrame } from '../recruitment-touch/RtFrame'

export default function CampusWelcomePage() {
  const navigate = useNavigate()
  const back = () => navigate('/campus')
  return (
    <RtFrame
      eyebrow="私有化版 · 校园招聘"
      title="校园招聘迎新指引"
      sub="当前没有独立迎新招聘内容"
      status={{ text: '没有独立迎新内容' }}
      backLabel="返回校园招聘"
      onBack={back}
      primary={{ label: '返回校园招聘', onClick: back, noArrow: true }}
    >
      <QxTouchCallout kind="howto">
        当前没有独立迎新招聘内容。请返回校园招聘专区查看本校招聘会与来源平台信息；智慧校园迎新服务位于独立专区。
      </QxTouchCallout>
    </RtFrame>
  )
}
