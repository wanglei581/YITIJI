import { useNavigate } from 'react-router-dom'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { RtFill } from '../recruitment-touch/RtFill'
import { RtFrame } from '../recruitment-touch/RtFrame'

export default function CampusWelcomePage() {
  const navigate = useNavigate()
  const back = () => navigate('/campus')
  return (
    <RtFrame
      eyebrow="校园招聘"
      title="校园招聘迎新指引"
      sub="请从校园招聘专区继续看场次"
      status={{ text: '没有独立迎新内容' }}
      backLabel="返回校园招聘"
      onBack={back}
      ask={{ label: '问小青：校园招聘怎么看？', draft: '校园招聘怎么看？', voice: true }}
    >
      <div className="rt-state">
        <section className="rt-statecard">
          <h2>当前没有独立迎新招聘内容</h2>
          <p>请返回校园招聘专区查看本校招聘会与来源平台信息；智慧校园迎新服务位于独立专区。</p>
          <p className="rt-note">{helpNeededLine()}</p>
        </section>
        <RtFill preset="campus" />
      </div>
    </RtFrame>
  )
}
