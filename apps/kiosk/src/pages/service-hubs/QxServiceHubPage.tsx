import { useNavigate } from 'react-router-dom'
import {
  AlertTriangleIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  BuildingIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  MapIcon,
  MicIcon,
  PrinterIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from 'lucide-react'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import {
  capabilityKindFor,
  unavailableReason,
  type CapabilityKind,
  type HubAvailability,
  type HubCapability,
  type ServiceHubKey,
} from './serviceHubModel'
import './styles/service-hub-qx.css'

const KIND_ICON: Record<CapabilityKind, typeof BotIcon> = {
  ai: BotIcon,
  device: PrinterIcon,
  info: FileTextIcon,
  account: UserRoundIcon,
}

/**
 * 按能力标题挑更贴切的图标；挑不到就退回按 kind 分。
 *
 * 顺序即优先级，**先具体后笼统**：「求职材料」若先撞上 /材料/ → 打印机图标，
 * 会让人以为它是出纸入口（第一版就是这样，看截图才发现）。所以 /材料/ 只在
 * 明确的打印扫描语境里用，简历侧的材料走公文包。
 */
const TITLE_ICON: Array<[RegExp, typeof BotIcon]> = [
  [/打印|扫描/, PrinterIcon],
  [/诊断|体检/, SearchIcon],
  [/优化|改写|生成简历|简历生成/, FileTextIcon],
  [/招聘会|场次/, CalendarDaysIcon],
  [/岗位|职位|全职|实习|兼职|校招|求职材料/, BriefcaseBusinessIcon],
  [/企业|机构/, BuildingIcon],
  [/面试|模拟/, MicIcon],
  [/政策|社保|档案|登记/, LandmarkIcon],
  [/线上|平台|跳转/, ExternalLinkIcon],
  [/收藏|记录|本人|我的/, UserRoundIcon],
  [/搜索|查找|筛选|全部/, SearchIcon],
  [/条件|核对|资格|风险/, ShieldCheckIcon],
  [/规划|导览|到场|指引|探索/, MapIcon],
  [/素材库|模板|技巧/, FileTextIcon],
]

function iconFor(title: string, kind: CapabilityKind) {
  return TITLE_ICON.find(([re]) => re.test(title))?.[1] ?? KIND_ICON[kind]
}

/**
 * 稿没画、代码长出来的能力：AI 签约风险提示。
 *
 * 它是 `VITE_ENABLE_CONTRACT_REVIEW` 默认关闭的功能（生产默认 false，
 * /contract-review 直接访问会 Navigate 回首页），稿 16 成稿时还没有这条入口，
 * 因此**不能塞进机械抽取的 serviceHubSpecs**——那份必须与稿逐字一致。
 * 放在这里，并保留旧壳同样的开关判据与同样的诚实措辞（仅作风险提示，不是法律意见）。
 */
const contractReviewEnabled = import.meta.env.VITE_ENABLE_CONTRACT_REVIEW === 'true'
const CONTRACT_REVIEW_CAPABILITY: HubCapability = {
  title: 'AI签约风险提示',
  description: '上传劳动合同、实习协议或 Offer，核查试用期、薪酬、竞业等条款风险',
  badge: 'AI · 仅供参考',
  route: '/contract-review',
  kind: 'ai',
}

/**
 * 顶栏状态胶囊：拿不到结论时必须说「正在确认」，不得默认 ok。
 *
 * apiDown 这条说的是「在线服务」而不是稿里的「AI能力」：`useApiReadiness` 判的是
 * `/health` 不可达（整个后端断开），不只是 AI。说成「AI能力不可用」会让用户以为
 * 岗位浏览、台账这些还能用。同理见 noticeCopy 与 serviceHubModel.needsBackend。
 */
function statusPill(state: HubAvailability): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (state.apiDown) return { tone: 'bad', label: '在线服务不可用' }
  if (state.apiChecking) return { tone: 'unknown', label: '正在确认在线服务' }
  if (state.deviceOff) return { tone: 'warn', label: '本机设备不可用' }
  if (state.deviceChecking) return { tone: 'unknown', label: '正在确认本机设备' }
  return { tone: 'ok', label: '能力与设备状态以办理时确认为准' }
}

/**
 * 分流提示条，四种状态各有各的话——照稿逐字，别合并成一句「服务异常」。
 *
 * 判序必须是 apiDown → apiChecking → deviceOff。稿的 device-off 文案会声称
 * 「信息浏览和AI服务仍可进入」；如果探测还没出结果就先说这句话，等于用「还不知道」
 * 冒充「AI 能用」。checking 不能误放行。
 *
 * default 那句是稿的原文，它本身就是一条诚实性声明：**本页不预报**在线、名额、
 * 价格或办理结果。把它省掉，页面就变回「看起来什么都能办」。
 *
 * 唯一偏离稿逐字的是 apiDown 那句。稿写的是「不依赖AI的浏览、材料和本机服务仍可进入」，
 * 因为稿把这个状态设想成「只有 AI 挂了」；代码里它是整个后端不可达，岗位浏览、台账、
 * 打印上传全都进不去，只剩 needsBackend() 白名单里那几条不联网内容。照抄稿那句
 * 会变成一条假承诺——CLAUDE.md §9「不伪造能力」在这里优先于逐字还原，所以改成
 * 说得出具体还能进什么的版本。
 */
function noticeCopy(state: HubAvailability): { title: string; detail: string } {
  if (state.apiDown) {
    return {
      title: '在线服务暂不可用。',
      detail: '已暂停需要联网处理的入口；线上平台目录、面试技巧、社保与档案指引等不联网内容仍可进入。',
    }
  }
  if (state.apiChecking) {
    return { title: '正在确认在线服务。', detail: '检查完成前，需要在线处理的入口暂不开放。' }
  }
  if (state.deviceOff) {
    return {
      title: '本机设备当前不可用。',
      detail: '当前入口中的信息浏览和AI服务仍可进入；涉及出纸或扫描的具体步骤请稍后再试。',
    }
  }
  return { title: '进入具体服务后再确认实时能力。', detail: '本页只负责分流，不预报在线、名额、价格或办理结果。' }
}

/**
 * 五个服务台共用这一个页面，`hub` 决定用哪份规格——稿 16-service-hubs.html 本身就是
 * 一份 HTML 带 `?hub=` 渲染五种，骨架和诚实性声明的位置完全一致。
 *
 * 这五条是首页进任何业务域的**第一跳**：首页早已是青序流光，点进去掉回旧的深藏青壳，
 * 正是产品负责人最初投诉的「新旧页面交替」。
 */
export function QxServiceHubPage({ hub }: { hub: ServiceHubKey }) {
  const navigate = useNavigate()
  const spec = SERVICE_HUB_SPECS[hub]
  const { status: apiStatus, retry: retryApi } = useApiReadiness()
  const device = useTerminalDeviceStatus()

  // 降级判据分开取：AI / 在线台账看后端就绪，设备看终端设备状态。
  // 稿把这两类分开说，笼统灰掉等于让用户猜「是这台机器坏了还是这个功能没了」。
  //
  // apiStatus !== 'ready' 的两半都 fail-closed：'unavailable' 是坏消息，
  // 'checking' 是还没有消息——两者都不构成放行理由。
  const availability: HubAvailability = {
    apiDown: apiStatus === 'unavailable',
    apiChecking: apiStatus === 'checking',
    // hook 初次拉取期间 loading=true；拉完仍是 unknown 表示「测不出来」而非「坏了」，
    // 那种情况不拦设备卡（见 serviceHubModel.unavailableReason 的说明）。
    deviceOff: device.kind === 'offline' || device.kind === 'error',
    deviceChecking: device.loading,
  }
  const apiBlocked = apiStatus !== 'ready'
  const notice = noticeCopy(availability)

  // 合同审查只在下面它自己的「签约与权益」分区渲染，不混进能力网格。
  const showContractReview = hub === 'resume' && contractReviewEnabled

  const renderCard = (cap: HubCapability, slot: 'grid' | 'contract') => {
    const reason = unavailableReason(cap.kind, cap.route, availability)
    const Icon = iconFor(cap.title, cap.kind)
    const head = (
      <>
        <span className="qx-hub-card-icon" aria-hidden="true">
          <Icon size={28} />
        </span>
        <h3>{cap.title}</h3>
        <p>{cap.description}</p>
      </>
    )
    if (reason) {
      // 不可用时不是「灰掉的按钮」，是一张说明为什么进不去的卡片。
      // 稿的做法：把「进入 →」换成具体原因，并让它不再是可点控件。
      return (
        <div
          key={cap.route}
          className="qx-hub-card is-unavailable"
          role="group"
          aria-disabled="true"
          aria-label={`${cap.title}：${reason}`}
          data-kind={cap.kind}
          data-disabled-reason={`capability:${cap.kind}`}
        >
          {head}
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
        data-kind={cap.kind}
        data-testid={`hub-${hub}-${slot}-${cap.title}`}
      >
        {head}
        <span className="qx-hub-card-foot">
          <span className="qx-hub-badge">{cap.badge}</span>
          <span className="qx-hub-go">
            进入
            <ChevronRightIcon size={20} aria-hidden="true" />
          </span>
        </span>
      </button>
    )
  }

  const NoticeIcon = availability.apiDown || availability.deviceOff
    ? AlertTriangleIcon
    : availability.apiChecking || availability.deviceChecking
      ? LoaderCircleIcon
      : CheckCircle2Icon

  return (
    <QxPageFrame
      title={spec.title}
      subtitle={spec.subtitle}
      status={statusPill(availability)}
      back={{ label: '返回首页', onBack: () => navigate('/') }}
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      {/* data-hub-api-blocked 是给走查与门禁的钩子：apiStatus !== 'ready' 的两半
          （unavailable / checking）都算 blocked，它不占位、不参与布局。 */}
      <div
        className="qx-hub qx-scroll"
        data-qx-page="service-hub"
        data-hub={hub}
        data-hub-api-blocked={apiBlocked ? 'true' : 'false'}
      >
        {/* 稿里的 hero-note：原件/结果归属的一句话，紧跟在标题说明之后。 */}
        <p className="qx-hub-hero-note">
          <b>{spec.noteTitle}</b>
          <span>{spec.note}</span>
        </p>

        <section className="qx-hub-goals" aria-label="先告诉我你现在最想完成什么">
          <div className="qx-hub-goals-copy">
            <b>先告诉我你现在最想完成什么</b>
            <span>{spec.sectionHint}；选择后直接进入对应服务，不会替你提交或生成结果。</span>
          </div>
          <div className="qx-hub-goals-row">
            {spec.goals.map((goal) => {
              const kind = capabilityKindFor(spec, goal.route)
              const reason = unavailableReason(kind, goal.route, availability)
              if (reason) {
                return (
                  <div
                    key={goal.route}
                    className="qx-hub-goal is-unavailable"
                    role="group"
                    aria-disabled="true"
                    aria-label={`${goal.label}：${reason}`}
                    data-disabled-reason={`capability:${kind}`}
                  >
                    {goal.label}
                  </div>
                )
              }
              return (
                <button
                  key={goal.route}
                  type="button"
                  className="qx-hub-goal"
                  onClick={() => navigate(goal.route)}
                >
                  {goal.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* 分流提示条。检查中 / 暂不可用 / 就绪都要出声，不能只在坏的时候出现——
            「没显示」在公共终端上会被读成「一切正常」。就绪态说的是「进入后再确认」，
            不说「已连接」。 */}
        <div
          className="qx-hub-notice"
          data-readiness={
            availability.apiDown || availability.deviceOff
              ? 'unavailable'
              : availability.apiChecking || availability.deviceChecking
                ? 'checking'
                : 'ready'
          }
          role="status"
          aria-live="polite"
        >
          <NoticeIcon size={24} aria-hidden="true" />
          <span className="qx-hub-notice-copy">
            <b>{notice.title}</b>
            <span>{notice.detail}</span>
          </span>
          {availability.apiDown ? (
            <button type="button" className="qx-hub-retry" onClick={retryApi}>
              <RefreshCwIcon size={20} aria-hidden="true" />
              重新检测
            </button>
          ) : null}
        </div>

        <section className="qx-hub-board" aria-labelledby="qx-hub-section-title">
          <div className="qx-hub-section-head">
            <h2 id="qx-hub-section-title">{spec.sectionTitle}</h2>
            <span>{spec.sectionHint}</span>
            <b>{spec.capabilities.length}项</b>
          </div>
          <div className="qx-hub-grid">{spec.capabilities.map((cap) => renderCard(cap, 'grid'))}</div>
        </section>

        {/* 签约与权益：默认关闭（VITE_ENABLE_CONTRACT_REVIEW），开启后与简历能力分组展示，
            不作为百宝箱或岗位入口重复投放。 */}
        {showContractReview ? (
          <section className="qx-hub-board" aria-labelledby="qx-hub-contract-title">
            <div className="qx-hub-section-head">
              <h2 id="qx-hub-contract-title">签约与权益</h2>
              <span>签约前自主核查，仅作风险提示</span>
            </div>
            <div className="qx-hub-grid qx-hub-grid--wide">
              {renderCard(CONTRACT_REVIEW_CAPABILITY, 'contract')}
            </div>
          </section>
        ) : null}

        <section className="qx-hub-quick-section" aria-labelledby="qx-hub-quick-title">
          <div className="qx-hub-quick-label">
            <b id="qx-hub-quick-title">常用入口</b>
            <span>继续查看与管理</span>
          </div>
          <div className="qx-hub-quick">
            {spec.quickLinks.map((link) => {
              const reason = unavailableReason(link.kind, link.route, availability)
              const Icon = iconFor(link.title, link.kind)
              if (reason) {
                return (
                  <div
                    key={link.route}
                    className="qx-hub-quick-item is-unavailable"
                    role="group"
                    aria-disabled="true"
                    aria-label={`${link.title}：${reason}`}
                    data-disabled-reason={`capability:${link.kind}`}
                  >
                    <Icon size={26} aria-hidden="true" />
                    <span>
                      <b>{link.title}</b>
                      <span>{reason}</span>
                    </span>
                  </div>
                )
              }
              return (
                <button
                  key={link.route}
                  type="button"
                  className="qx-hub-quick-item"
                  onClick={() => navigate(link.route)}
                >
                  <Icon size={26} aria-hidden="true" />
                  <span>
                    <b>{link.title}</b>
                    <span>{link.description}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 合规与诚实性声明：**逐字取自稿**，不许改写、不许省略。
            三列对应稿的 truth 区：合规边界 / 能力口径 / 隐私清场。
            truth 那句直接是 CLAUDE.md §2 的边界（不代投、不代收简历、不作资格判断）；
            隐私那句是本机的清场承诺，KioskPrivacyGuard 真的会执行。 */}
        <section className="qx-hub-truth" aria-label="服务边界说明">
          <div>
            <b>{spec.truthTitle}</b>
            <span>{spec.truth}</span>
          </div>
          <div>
            <b>能力</b>
            <span>进入具体服务后按实际状态确认，不以本页为准。</span>
          </div>
          <div>
            <b>隐私</b>
            <span>结束会话或闲置超时清除本机登录态与临时会话信息。</span>
          </div>
        </section>
      </div>
    </QxPageFrame>
  )
}
