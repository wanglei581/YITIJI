import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { QxPageFrame } from '../components/qingxu/QxPageFrame'
import { SettingsConfirm } from '../pages/profile/me/components/SettingsConfirm'
import { QxMemberNavbar } from '../pages/profile/components/QxMemberNavbar'
import { useKioskSessionControl } from './KioskSessionControlContext'
import { markKioskPresenceConfirmed, needsHandoverConfirm } from './kioskPresence'
import { useAuth } from './useAuth'
import '../pages/profile/me/styles/settings-qx2.css'

/**
 * 进个人资产页（我的、我的文档、打印订单、AI 服务记录、我的简历……）之前的「还是你吗？」（W-75）。
 *
 * 有人登录着、而进来之前这台机器已经空了 30 秒以上（KIOSK_HANDOVER_CONFIRM_MS），
 * 就先问一句再显示：站在屏幕前的可能已经不是登录的那个人。
 *   · 「是我，继续」—— 直接进；
 *   · 「不是我」—— endKioskUse('handover')：清掉上一位，回首页。
 *
 * **先确认、后读取**：确认层出现时根本不挂载资产页，资产页的读取请求一条都不发，
 * 屏上也不出现任何上一位的文件名、订单号或手机号。深链、浏览器后退进来走的是同一个判断
 * （每换一次地址重新判一次）。没登录时资产页只显示登录引导，不问。
 */
export function KioskHandoverGate() {
  const location = useLocation()
  const { isLoggedIn } = useAuth()
  const { endKioskUse } = useKioskSessionControl()
  const [decision, setDecision] = useState(() => ({ key: location.key, ask: needsHandoverConfirm() }))

  let current = decision
  if (decision.key !== location.key) {
    // 换了地址（含后退）：重新判。渲染期更新派生状态，确认层与资产页之间不会闪一帧。
    current = { key: location.key, ask: needsHandoverConfirm() }
    setDecision(current)
  }

  if (!isLoggedIn || !current.ask) return <Outlet />

  return (
    <div className="h-full" data-kiosk-screen="handover-confirm" data-testid="handover-confirm-page">
      <QxPageFrame
        title="我的"
        subtitle="先确认是不是本人，再打开个人资料。"
        status={{ tone: 'warn', label: '公共设备，请保护个人信息' }}
        navbar={<QxMemberNavbar current="profile" />}
      >
        <div className="qx-card" role="note" style={{ fontSize: 'var(--qx-fs-body)', lineHeight: 1.45 }}>
          这台机器上有人登录着，已经有一会儿没人点屏幕了。本人请点「是我，继续」；不是的话点「不是我」，会结束上一位的使用并回到首页。
        </div>
      </QxPageFrame>
      <SettingsConfirm
        testId="handover-confirm"
        title="还是你吗？"
        description="这台机器上有人登录着，已经有一会儿没人点屏幕了。不是本人请点「不是我」，会结束上一位的使用并回到首页。"
        confirmLabel="是我，继续"
        cancelLabel="不是我"
        onConfirm={() => {
          markKioskPresenceConfirmed()
          setDecision({ key: location.key, ask: false })
        }}
        onCancel={() => endKioskUse('handover')}
      />
    </div>
  )
}
