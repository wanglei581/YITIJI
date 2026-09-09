import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'

/**
 * 模拟面试域外壳：青序流光 QxPageFrame + 共享 QxAppNavbar。
 * 舞台缩放由 KioskRoot 的 KioskStageFit 负责，本壳不再套 KioskFullscreenShell。
 *
 * 顶栏返回照稿 29-interview-training.html：`<a class="back" href="16-service-hubs.html?hub=interview"
 * aria-label="返回面试服务">`，对应运行时 /interview-service。
 *
 * 接在壳里而不是逐页传：QxPageFrame 的 `back` 是可选 prop，不传就没有返回键、
 * 也不会有任何报错。五个屏各传一次就是五次漏传的机会。
 */
export function InterviewShell({
  title,
  subtitle,
  status,
  ctabar,
  navbar = true,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  status?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  ctabar?: ReactNode
  navbar?: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <QxPageFrame
      title={title}
      subtitle={subtitle}
      status={status ?? { tone: 'ok', label: '模拟练习' }}
      back={{ label: '返回面试服务', onBack: () => navigate('/interview-service') }}
      terminalLabel="就业服务大厅"
      ctabar={ctabar}
      navbar={
        navbar ? (
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        ) : undefined
      }
    >
      {children}
    </QxPageFrame>
  )
}
