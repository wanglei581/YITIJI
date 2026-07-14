import { useNavigate } from 'react-router-dom'
import './reference-service-nav.css'
import './reference-layout.css'

export const REFERENCE_SERVICE_ITEMS = [
  { label: '简历服务', hash: '#resume' },
  { label: '岗位信息', hash: '#jobs' },
  { label: '招聘会', hash: '#job-fairs' },
  { label: '打印扫描', hash: '#print-scan' },
  { label: '面试训练', hash: '#interview' },
  { label: '政策服务', hash: '#policy' },
] as const

export function ReferenceServiceNav() {
  const navigate = useNavigate()

  return (
    <nav className="reference-service-nav" aria-label="服务分类">
      {REFERENCE_SERVICE_ITEMS.map((item) => (
        <button
          key={item.hash}
          type="button"
          onClick={() => navigate({ pathname: '/', hash: item.hash })}
        >
          {item.label}
        </button>
      ))}
    </nav>
  )
}
