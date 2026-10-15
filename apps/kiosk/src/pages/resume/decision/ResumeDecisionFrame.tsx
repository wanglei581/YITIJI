// ============================================================
// 简历决策工作台 · 青序流光外壳（稿 46-resume-decision-workspace）
//
// 一个外壳承接三条真实路由：
//   /resume/job-fit          岗位匹配参考（差在哪）
//   /resume/job-fit/actions  差距行动清单（怎么补）
//   /resume/career-plan      求职方案
// 稿里还有第四屏 `screen=templates`（/resume/templates），不在本批，别顺手拉进来。
//
// 为什么不直接在每页写 QxPageFrame：这三页共用同一套顶栏语义 —— 同一个返回落点
// （稿里的 topbar back → 16-service-hubs.html?hub=resume，即 /resume-service）、
// 同一条设备状态胶囊、同一组底部导航。抄三份的下场在 #970 已经发生过一次：
// 15 个已迁页同时丢了返回键，因为每页各写各的。
//
// 这三条是**顶级全屏路由**（routes/index.tsx 里与 /login 同级，不嵌在 KioskRoot 下），
// 所以舞台缩放必须自己套 KioskStageFit —— 与 LoginPage / ScreensaverPage 同一形态。
// QxPageFrame 自身不做缩放（外层已缩过，再缩一次会叠乘）。
// ============================================================

import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { KioskStageFit } from '../../../components/kiosk-shell/KioskStageFit'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { useTerminalDeviceStatus, type TerminalDeviceStatusView } from '../../../hooks/useTerminalDeviceStatus'

/** 简历服务中心（稿 16-service-hubs?hub=resume）。三页的顶栏返回都落在这里。 */
export const RESUME_SERVICE_ROUTE = '/resume-service'

/**
 * 设备状态胶囊。
 *
 * 迁移前这三页挂在 `KioskFullscreenShell` 的 `KioskAppTopbar` 上，顶栏显示的是
 * `useTerminalDeviceStatus` 的真实读数。换壳不能把它换没了 —— 否则公共终端上
 * 「没显示」会被读成「一切正常」。
 *
 * 未知一律落 `unknown`：读不到就说读不到，不默认 ok（CLAUDE.md §9 不伪造能力）。
 */
function statusPillOf(device: TerminalDeviceStatusView): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (device.loading || device.kind === 'unknown') return { tone: 'unknown', label: '状态未知' }
  if (device.printerReady) return { tone: device.kind === 'low_paper' ? 'warn' : 'ok', label: device.printerLabel }
  return { tone: 'bad', label: device.printerLabel }
}

export interface ResumeDecisionFrameProps {
  title: ReactNode
  subtitle?: ReactNode
  /** 顶栏返回键。默认回简历服务中心；行动页按稿回比对结果页，所以可覆盖。 */
  back?: { label: string; onBack: () => void }
  children: ReactNode
}

export function ResumeDecisionFrame({ title, subtitle, back, children }: ResumeDecisionFrameProps) {
  const navigate = useNavigate()
  const device = useTerminalDeviceStatus()

  return (
    <KioskStageFit>
      <QxPageFrame
        title={title}
        subtitle={subtitle}
        status={statusPillOf(device)}
        back={back ?? { label: '返回简历服务', onBack: () => navigate(RESUME_SERVICE_ROUTE) }}
        navbar={(
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        )}
      >
        {children}
      </QxPageFrame>
    </KioskStageFit>
  )
}
