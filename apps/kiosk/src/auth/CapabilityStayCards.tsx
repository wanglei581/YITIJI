import { useNavigate } from 'react-router-dom'
import { LandmarkIcon, PrinterIcon } from 'lucide-react'

/** 未开启页下面两张去处。检查中不渲染，避免在确认完成前放出按钮。 */
export function CapabilityStayCards() {
  const navigate = useNavigate()
  return (
    <section className="p10-stay" aria-label="这些不受影响">
      <h2>这些不受影响</h2>
      <div className="p10-stay-grid">
        <button type="button" className="p10-stay-card" onClick={() => navigate('/print-scan')}>
          <span className="p10-stay-mark" aria-hidden="true"><PrinterIcon /></span>
          <span>
            <b>打印扫描</b>
            <span>打印和扫描照常可用</span>
          </span>
        </button>
        <button type="button" className="p10-stay-card" onClick={() => navigate('/policy-service')}>
          <span className="p10-stay-mark" aria-hidden="true"><LandmarkIcon /></span>
          <span>
            <b>查政策</b>
            <span>查看已发布的政策和办事说明</span>
          </span>
        </button>
      </div>
    </section>
  )
}
