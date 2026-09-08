import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'

/**
 * 模拟面试域外壳：青序流光 QxPageFrame + 共享 QxAppNavbar。
 * 舞台缩放由 KioskRoot 的 KioskStageFit 负责，本壳不再套 KioskFullscreenShell。
 *
 * TODO(PR #955): QxPageFrame 的 back 槽合入后，顶栏返回指向 /interview-service。
 * 当前 main 上的 QxPageFrame 没有 back prop，不在本文件另写一份。
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
