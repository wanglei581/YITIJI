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
import { QxTouchDock, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
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

const FAIR_EYEBROW: Record<FairScreen, string> = {
  list: '招聘会',
  checkin: '到场指引',
  detail: '招聘会详情',
  companies: '参展企业',
  map: '展位分布',
  materials: '活动物料',
  'visit-plan': '参会准备',
  stats: '现场统计',
}

const FAIR_ASK: Record<FairScreen, string> = {
  list: '问小青',
  checkin: '问小青：怎么签到',
  detail: '问小青：这场怎么走',
  companies: '问小青：这家企业',
  map: '问小青：展位怎么看',
  materials: '问小青：打印哪一份',
  'visit-plan': '问小青：准备单怎么用',
  stats: '问小青：这些数怎么来',
}

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
  /** 底栏上方的一行边界句。声明条三段原文仍由壳渲染。 */
  boundary?: ReactNode
  /** 问小青和主按钮之间的次操作。不要再放第二个返回。 */
  secondary?: ReactNode
  primary?: QxTouchPrimary
  children: ReactNode
}

export function QxFairWorkbench({
  screen,
  state,
  fairId = '',
  title,
  subtitle,
  back,
  boundary,
  secondary,
  primary,
  children,
}: QxFairWorkbenchProps) {
  const navigate = useNavigate()
  const [headTitle, headSubtitle] = FAIR_HEAD[screen]
  const defaultBack = fairBackOf(screen, fairId)
  const resolvedBack = back ?? { label: defaultBack.label, onBack: () => navigate(defaultBack.route) }
  const pill = fairPillOf(screen, state)
  const askLabel = FAIR_ASK[screen]

  return (
    <QxTouchScreen
      page="recruit"
      stateId={`${screen}:${state}`}
      bodyClassName="qxt-body-scroll"
      band={
        <QxTouchBand
          kind="compact"
          eyebrow={FAIR_EYEBROW[screen]}
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
          {boundary ? <div className="rt-boundary">{boundary}</div> : null}
          <div className="qxfw-truth">
            <p>
              <b>{FAIR_TRUTH_LEAD}</b>
              {FAIR_TRUTH_REST}
            </p>
            <button type="button" className="rt-textbtn qxfw-truth-link" onClick={() => navigate('/help')}>
              {FAIR_TRUTH_LINK}
            </button>
          </div>
          <QxTouchDock
            back
            backLabel={resolvedBack.label}
            onBack={resolvedBack.onBack}
            ask={{ label: askLabel, draft: askLabel.replace(/^问小青：?/, '') || '招聘会怎么看', voice: true }}
            secondary={secondary}
            primary={primary}
          />
        </div>
      }
      nav={
        <QxTouchNav
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
    </QxTouchScreen>
  )
}
