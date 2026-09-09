import { useNavigate } from 'react-router-dom'
import {
  BotIcon, BriefcaseBusinessIcon, CalendarDaysIcon, FileTextIcon, LandmarkIcon,
  MicIcon, PrinterIcon, SearchIcon, ShieldCheckIcon, UserRoundIcon,
} from 'lucide-react'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import { unavailableReason, type CapabilityKind, type ServiceHubKey } from './serviceHubModel'
import './styles/service-hub-qx.css'

const KIND_ICON: Record<CapabilityKind, typeof BotIcon> = {
  ai: BotIcon,
  device: PrinterIcon,
  info: FileTextIcon,
}

/** 按能力标题挑更贴切的图标；挑不到就退回按 kind 分。 */
const TITLE_ICON: Array<[RegExp, typeof BotIcon]> = [
  [/招聘会|场次/, CalendarDaysIcon],
  [/岗位|职位|全职|实习|兼职/, BriefcaseBusinessIcon],
  [/面试|模拟/, MicIcon],
  [/政策|社保|档案/, LandmarkIcon],
  [/收藏|记录|本人/, UserRoundIcon],
  [/打印|扫描/, PrinterIcon],
  [/搜索|查找|筛选/, SearchIcon],
  [/条件|核对|资格/, ShieldCheckIcon],
]

function iconFor(title: string, kind: CapabilityKind) {
  return TITLE_ICON.find(([re]) => re.test(title))?.[1] ?? KIND_ICON[kind]
}

/**
 * 五个服务台共用这一个页面，`hub` 决定用哪份规格——稿 16-service-hubs.html 本身就是
 * 一份 HTML 带 `?hub=` 渲染五种，骨架和诚实性声明的位置完全一致。
 *
 * 不拆成五个组件的理由和 serviceHubSpecs 一样：拆开等于给「某一份漏掉一句诚实性声明」
 * 留五次机会。这些声明（truthTitle / truth）直接对应 CLAUDE.md §2 的合规边界，
 * 例如岗位台的「投递在来源平台完成」、面试台的「不进行录用判断，不向企业推荐候选人」。
 */
export function QxServiceHubPage({ hub }: { hub: ServiceHubKey }) {
  const navigate = useNavigate()
  const spec = SERVICE_HUB_SPECS[hub]
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const device = useTerminalDeviceStatus()

  // 降级判据分开取：AI 不可用看后端就绪，设备不可用看终端设备状态。
  // 稿把这两类分开说，笼统灰掉等于让用户猜「是这台机器坏了还是这个功能没了」。
  const aiDown = apiStatus === 'unavailable'
  const deviceOff = device.kind === 'offline' || device.kind === 'error'

  return (
    <QxPageFrame
      title={spec.title}
      subtitle={spec.subtitle}
      status={
        aiDown
          ? { tone: 'bad', label: 'AI 能力不可用' }
          : deviceOff
            ? { tone: 'warn', label: '本机设备不可用' }
            : { tone: 'ok', label: spec.eyebrow }
      }
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <div className="qx-hub qx-scroll" data-qx-page="service-hub" data-hub={hub}>
        <section className="qx-hub-goals" aria-label="先选一个目标">
          <span className="qx-hub-goals-hint">{spec.sectionHint}</span>
          <div className="qx-hub-goals-row">
            {spec.goals.map((goal) => (
              <button
                key={goal.route}
                type="button"
                className="qx-hub-goal"
                onClick={() => navigate(goal.route)}
              >
                {goal.label}
              </button>
            ))}
          </div>
        </section>

        {aiDown ? (
          <div className="qx-hub-degraded" role="status">
            <div>
              <strong>后端暂时连不上</strong>
              <span>依赖服务端的能力现在进不去；不依赖的仍可使用。</span>
            </div>
            <button type="button" onClick={retryApi}>重试</button>
          </div>
        ) : null}

        <section className="qx-hub-board" aria-labelledby="qx-hub-section-title">
          <h2 id="qx-hub-section-title">{spec.sectionTitle}</h2>
          <div className="qx-hub-grid">
            {spec.capabilities.map((cap) => {
              const reason = unavailableReason(cap.kind, aiDown, deviceOff)
              const Icon = iconFor(cap.title, cap.kind)
              if (reason) {
                // 不可用时不是「灰掉的按钮」，是一张说明为什么进不去的卡片。
                // 稿的做法：把「进入 →」换成具体原因，并让它不再是可点控件。
                return (
                  <div
                    key={cap.route}
                    className="qx-hub-card is-unavailable"
                    role="group"
                    aria-label={`${cap.title}：${reason}`}
                    data-disabled-reason={cap.kind === 'ai' ? 'capability:ai' : 'capability:device'}
                  >
                    <span className="qx-hub-card-icon" aria-hidden="true"><Icon size={30} /></span>
                    <h3>{cap.title}</h3>
                    <p>{cap.description}</p>
                    <span className="qx-hub-card-foot">
                      <span className="qx-hub-badge">{cap.badge}</span>
                      <span className="qx-hub-why">{reason}</span>
                    </span>
                  </div>
                )
              }
              return (
                <button
                  key={cap.route}
                  type="button"
                  className="qx-hub-card"
                  onClick={() => navigate(cap.route)}
                  data-testid={`hub-${hub}-${cap.title}`}
                >
                  <span className="qx-hub-card-icon" aria-hidden="true"><Icon size={30} /></span>
                  <h3>{cap.title}</h3>
                  <p>{cap.description}</p>
                  <span className="qx-hub-card-foot">
                    <span className="qx-hub-badge">{cap.badge}</span>
                    <span className="qx-hub-go">进入</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 合规与诚实性声明：**逐字取自稿**，不许改写、不许省略。
            它们对应 CLAUDE.md §2 的边界（不代投、不代收简历、不作资格判断）。 */}
        <section className="qx-hub-truth" aria-label="服务边界说明">
          <p className="qx-hub-truth-title">{spec.truthTitle}</p>
          <p className="qx-hub-truth-copy">{spec.truth}</p>
          <p className="qx-hub-note-title">{spec.noteTitle}</p>
          <p className="qx-hub-note-copy">{spec.note}</p>
        </section>
      </div>
    </QxPageFrame>
  )
}
