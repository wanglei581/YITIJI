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
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import {
  FAIR_HEAD,
  FAIR_TRUTH_LEAD,
  FAIR_TRUTH_LINK,
  FAIR_TRUTH_REST,
  fairBackOf,
  fairIsCentered,
  fairPillOf,
  type FairPill,
  type FairScreen,
} from './fairWorkbenchSpecs'
import '../recruitment-touch/recruit-touch.css'
import '../../components/qingxu/directory/directory-qx.css'
import './styles/fair-workbench-qx.css'

/** 胶囊只有明确 ok 才亮绿。bad / warn 用提醒色，unknown 保持灰点。 */
function pillStatus(pill: FairPill): QxTouchStatus {
  if (!pill.label) return false
  if (pill.tone === 'ok') return { text: pill.label, tone: 'ok' }
  if (pill.tone === 'warn' || pill.tone === 'bad') return { text: pill.label, tone: 'warn' }
  return { text: pill.label }
}

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
  const resolvedBack = back ?? { label: defaultBack.label, onBack: () => navigate(defaultBack.route) }
  const pill = fairPillOf(screen, state)

  return (
    <QxTouchScreen
      testId={`fair-${screen}-state-${state}`}
      stateId={`${screen}:${state}`}
      bodyClassName="qxt-body-scroll"
      band={
        <QxTouchBand
          kind="compact"
          eyebrow="私有化版 · 招聘会"
          title={title ?? headTitle}
          sub={subtitle ?? headSubtitle}
          seal={null}
          status={pillStatus(pill)}
          back
          onBack={resolvedBack.onBack}
        />
      }
      dock={
        <div className="rt-fair-dock">
          {ctabar ? <div className="rt-ctabar qxfw-ctabar">{ctabar}</div> : null}
          <div className="qxfw-truth">
            <p>
              <b>{FAIR_TRUTH_LEAD}</b>
              {FAIR_TRUTH_REST}
            </p>
            <button type="button" className="rt-textbtn qxfw-truth-link" onClick={() => navigate('/help')}>
              {FAIR_TRUTH_LINK}
            </button>
          </div>
          <QxTouchDock back backLabel={resolvedBack.label} onBack={resolvedBack.onBack} ask={false} />
        </div>
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
    </QxTouchScreen>
  )
}
