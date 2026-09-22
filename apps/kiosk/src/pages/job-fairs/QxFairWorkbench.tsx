// 招聘会共享工作台宿主（青序流光）。
//
// 稿 28-jobfair-enhanced.html 的文件头把八条路由写成「共用一个青序流光宿主」：
//   /job-fairs 084 · /job-fairs/checkin 085 · /job-fairs/:id 086
//   /job-fairs/:id/companies 087 · /job-fairs/:id/map 090
//   /job-fairs/:id/materials 091 · /job-fairs/:id/visit-plan 092
//   /job-fairs/:id/stats 093
// 所以壳只写一份：顶栏返回键 / h1 / 一句话说明 / 状态胶囊 / 底部 truth 条 / 三项导航
// 全部由 fairWorkbenchSpecs 的稿面真值表驱动，业务页只负责 body 与 ctabar。
//
// 为什么不是「八个页面各自套一次 QxPageFrame」：那样八页的返回落点、胶囊语气和
// 合规声明会各写各的，迁移完成后第一次改文案就会重新分叉——五个服务台那一轮
// 已经证明共享规格表能把这类分叉堵死。
//
// 舞台缩放由外层 KioskRoot 的 KioskStageFit 负责，本层不再缩放（QxPageFrame 同此口径）。

import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { getTerminalCode } from '../../services/api/terminalConfig'
import {
  FAIR_HEAD,
  FAIR_TRUTH_LEAD,
  FAIR_TRUTH_LINK,
  FAIR_TRUTH_REST,
  fairBackOf,
  fairIsCentered,
  fairPillOf,
  type FairScreen,
} from './fairWorkbenchSpecs'
import '../../components/qingxu/directory/directory-qx.css'
import './styles/fair-workbench-qx.css'

export interface QxFairWorkbenchProps {
  /** 稿里的 screen 键。决定 h1 / 副标题 / 返回落点 / 胶囊查表口径。 */
  screen: FairScreen
  /**
   * 稿里的 state 键（ready / loading / empty / error / …）。
   * 必须是页面**当前真实**的数据状态，不能为了好看写成默认态——
   * 顶栏胶囊直接读它，写错就是在公共终端上说假话。
   */
  state: string
  /** 带参路由的 fairId，用于把 BACK 表里的 `:id` 换成真实路径。列表/签到页传空串。 */
  fairId?: string
  /** 顶栏 h1 覆盖。只有详情页会用（稿 hero 用真实场次名当标题更有用）。 */
  title?: ReactNode
  /** 副标题覆盖。同上，默认取稿的 HEAD。 */
  subtitle?: ReactNode
  /** 返回键落点覆盖。默认按稿 BACK 表。 */
  back?: { label: string; onBack: () => void }
  /** 页面底部操作条（稿 .ctabar）。不传则不渲染。 */
  ctabar?: ReactNode
  children: ReactNode
}

export function QxFairWorkbench({
  screen,
  state,
  fairId = '',
  title,
  subtitle,
  back,
  ctabar,
  children,
}: QxFairWorkbenchProps) {
  const navigate = useNavigate()
  const [headTitle, headSubtitle] = FAIR_HEAD[screen]
  const defaultBack = fairBackOf(screen, fairId)
  const pill = fairPillOf(screen, state)

  return (
    <QxPageFrame
      back={back ?? { label: defaultBack.label, onBack: () => navigate(defaultBack.route) }}
      title={title ?? headTitle}
      subtitle={subtitle ?? headSubtitle}
      status={pill}
      terminalLabel={getTerminalCode() || '设备未绑定'}
      /*
       * QxPageFrame 的 ctabar 槽是壳里**唯一**不随正文滚动的那条带（有 border-top
       * 与 surface 底色，永远压在三项导航之上）。本页的主操作必须落在这里。
       *
       * 2026-09-20 修正：此前这个槽被合规 truth 条独占，业务页的操作按钮以
       * `.qxfw-ctabar` 的身份渲染在 children 里。它虽然也是 flex:none 不会滚走，
       * 但没有底色也没有分隔线，与正文连成一片 —— 一体机上「哪一条是操作区」
       * 全靠这条带的视觉定型，糊在一起等于主操作没有固定位。
       *
       * 现在两者同在这条带里、上下排：操作在上（近拇指），合规声明在下。
       * 声明仍然写在壳里，业务页删不掉；顺序与稿一致（.ctabar 在 .truth 之上）。
       */
      ctabar={
        <div className="qxfw-bottom">
          {ctabar ? <div className="qxfw-ctabar">{ctabar}</div> : null}
          <div className="qxfw-truth">
            <p>
              <b>{FAIR_TRUTH_LEAD}</b>
              {FAIR_TRUTH_REST}
            </p>
            <button type="button" className="qxfw-truth-link" onClick={() => navigate('/help')}>
              {FAIR_TRUTH_LINK}
            </button>
          </div>
        </div>
      }
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <div
        className="dw-page qxfw"
        data-fair-screen={screen}
        data-fair-state={state}
        /* 稿用 `.scroll.center` 标记的状态屏整体垂直居中，内容屏顶部对齐。
           判定来自稿面表，不在这里逐页拍脑袋。 */
        data-fair-center={fairIsCentered(screen, state) ? 'true' : undefined}
        data-testid={`fair-${screen}-state-${state}`}
      >
        {children}
      </div>
    </QxPageFrame>
  )
}
