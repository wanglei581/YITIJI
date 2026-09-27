import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'

/** 稿 13 的只读引导与步骤轨；操作留在下方工作区。 */
export function PrintDeskGuide({ step, title, detail }: {
  step: 1 | 2 | 3
  title: ReactNode
  detail: string
}) {
  return (
    <section className="qpd-guide" data-takeaway="核对文件后带走打印件">
      <div className="qpd-guide-row">
        <span className="qpd-guide-face" aria-hidden="true">青</span>
        <div><h2>{title}</h2><p>{detail}</p></div>
      </div>
      <ol aria-label="打印流程">
        {['选文件', '材料检查', '预览与参数', '核对价格'].map((label, index) => (
          <li key={label} aria-current={index + 1 === step ? 'step' : undefined}>
            <span>{index + 1}</span>{label}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** 复用现有顾问路由，不伪造预填、自动发送或 AI 检查结果。 */
export function PrintDeskFooter({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  const navigate = useNavigate()
  return (
    <div className="qpd-bottom">
      <div className="qpd-cta">{children}</div>
      <div className="qpd-actions">
        <button type="button" onClick={onBack}>上一步</button>
        <button type="button" onClick={() => navigate('/assistant')}>问小青：帮我选打印参数 →</button>
      </div>
    </div>
  )
}

export function PrintDeskNavbar() {
  const navigate = useNavigate()
  return <QxAppNavbar onHome={() => navigate('/')} onAdvisor={() => navigate('/assistant')} onProfile={() => navigate('/profile')} />
}
