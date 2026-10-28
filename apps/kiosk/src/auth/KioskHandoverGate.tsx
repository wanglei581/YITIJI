import { useLayoutEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { SettingsConfirm } from '../pages/profile/me/components/SettingsConfirm'
import { MeTouchShell } from '../pages/profile/touch/MeTouchShell'
import { useKioskSessionControl } from './KioskSessionControlContext'
import { markHandoverPending, markKioskPresenceConfirmed, needsHandoverConfirm } from './kioskPresence'
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
 *
 * **弹出了没回答，就一直是待确认**：浏览器后退、问小青这些路能把人带离这一屏，
 * 再点底部「我的」时进页前只空了几秒，光看空闲时长不会再问。所以确认层一弹出就记下「待确认」
 * （kioskPresence.markHandoverPending，只在内存里），每次判断都先看它：待确认期间，
 * 不管从底导航、后退、问小青回来还是站内直达地址进来，都先回到这一屏。
 * 解除只有三条路：本人答「是我，继续」、答「不是我」走清场（退出登录一并清掉）、新的一位登录成功。
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

  const showConfirm = isLoggedIn && current.ask
  // 确认层与「待确认」在同一次提交里就位：没有「已经画出来、标记还没记」的间隙。
  useLayoutEffect(() => {
    if (showConfirm) markHandoverPending()
  }, [showConfirm])

  if (!showConfirm) return <Outlet />

  return (
    <div className="h-full" data-kiosk-screen="handover-confirm" data-testid="handover-confirm-page">
      <MeTouchShell
        eyebrow="继续使用前"
        title="还是你吗？"
        titleId="handover-title"
        sub="离开屏幕超过 30 秒后再进来，会先问这一句"
        status={{ tone: 'warn', label: '待确认是不是你' }}
        back={false}
        nav={false}
      >
        <p id="handover-desc">确认之前不会显示上一位的文件和订单。</p>
        <SettingsConfirm
          layout="cards"
          testId="handover-confirm"
          labelledBy="handover-title"
          describedBy="handover-desc"
          title="还是你吗？"
          description="确认之前不会显示上一位的文件和订单。"
          confirmLabel="是我，继续"
          confirmDetail="接着看简历、文档和订单。"
          cancelLabel="不是我，结束上一位的使用"
          cancelDetail="退出登录，并清掉这台机器上这一次的临时信息。"
          onConfirm={() => {
            markKioskPresenceConfirmed()
            setDecision({ key: location.key, ask: false })
          }}
          onCancel={() => endKioskUse('handover')}
        />
      </MeTouchShell>
    </div>
  )
}
