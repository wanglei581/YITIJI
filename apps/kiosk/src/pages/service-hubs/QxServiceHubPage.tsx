import { useNavigate } from 'react-router-dom'
import {
  AlertTriangleIcon,
  BarChart3Icon,
  BotIcon,
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileIcon,
  LoaderCircleIcon,
  MapIcon,
  MicIcon,
  PencilLineIcon,
  PrinterIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  UserRoundIcon,
} from 'lucide-react'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useApiReadiness } from '../../hooks/useApiReadiness'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { SERVICE_HUB_SPECS } from './serviceHubSpecs'
import {
  capabilityKindFor,
  hubUsesDevice,
  unavailableReason,
  type HubAvailability,
  type HubCapability,
  type HubIconKey,
  type ServiceHubKey,
} from './serviceHubModel'
import './styles/service-hub-qx.css'

/**
 * 稿 16 的图标键 → lucide 组件。**一对一显式映射，不按标题猜。**
 *
 * 上一版这里是一张 `TITLE_ICON` 正则表（/校招/、/岗位/…按标题挑图标），
 * 原因是抽取脚本把稿里的 `icon` 字段丢了。代价在截图里看得见：
 * 「校园招聘」（稿 building）落到文档图标，「岗位匹配参考」（稿 chart）落到公文包，
 * 「AI简历优化」（稿 edit）落到文档。正则永远只能猜标题，稿里的键才是设计意图。
 *
 * 选型口径：同名优先，同名不存在时选**画法最接近稿里那段 path** 的一个，并在此注明：
 *   · file     → FileIcon        稿画的是带折角的空白文件（不是带横线的 FileText）
 *   · edit     → PencilLineIcon  稿是 feather edit-3：铅笔 + 底部横线
 *   · brief    → BriefcaseIcon   稿是公文包（矩形 + 提手）
 *   · chart    → BarChart3Icon   稿是三根竖条 + 基线的柱状图
 *   · user     → UserRoundIcon   稿是圆头 + 圆肩（不是方肩的 User）
 *   · calendar → CalendarIcon    稿是无日期点的空月历（不是 CalendarDays）
 *   · building → BuildingIcon    同名
 * 其余（search / map / mic / shield / bot / printer / external）均为同名直取。
 *
 * 类型是 Record<HubIconKey, …>：稿新增图标键而这里没登记，typecheck 当场红，
 * 不会静默退回某个兜底图标（兜底就是另一种猜）。
 */
const HUB_ICON: Record<HubIconKey, typeof BotIcon> = {
  file: FileIcon,
  search: SearchIcon,
  edit: PencilLineIcon,
  brief: BriefcaseIcon,
  building: BuildingIcon,
  calendar: CalendarIcon,
  map: MapIcon,
  mic: MicIcon,
  chart: BarChart3Icon,
  shield: ShieldIcon,
  bot: BotIcon,
  printer: PrinterIcon,
  user: UserRoundIcon,
  external: ExternalLinkIcon,
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
  // 稿里没有这张卡，所以图标也得在这里显式指定；shield 对应「风险提示」。
  icon: 'shield',
}

/**
 * 顶栏状态胶囊：拿不到结论时必须说「正在确认」，不得默认 ok。
 *
 * apiDown 这条说的是「在线服务」而不是稿里的「AI能力」：`useApiReadiness` 判的是
 * `/health` 不可达（整个后端断开），不只是 AI。说成「AI能力不可用」会让用户以为
 * 岗位浏览、台账这些还能用。同理见 noticeCopy 与 serviceHubModel.needsBackend。
 */
function statusPill(state: HubAvailability): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  // 注意：deviceOff / deviceChecking 在「本服务台没有设备能力」时恒为 false
  // （见 QxServiceHubPage 的 deviceAware），所以岗位 / 招聘会 / 面试 / 政策
  // 永远走不到下面两条设备分支——它们不该替打印机播报。
  if (state.apiDown) return { tone: 'bad', label: '在线服务不可用' }
  if (state.apiChecking) return { tone: 'unknown', label: '正在确认在线服务' }
  if (state.deviceOff) return { tone: 'warn', label: '本机设备不可用' }
  if (state.deviceChecking) return { tone: 'unknown', label: '正在确认本机设备' }
  return { tone: 'ok', label: '能力与设备状态以办理时确认为准' }
}

/**
 * 分流提示条，五种状态各有各的话——照稿逐字，别合并成一句「服务异常」。
 *
 * 判序必须是 apiDown → apiChecking → deviceOff → deviceChecking。稿的 device-off 文案会声称
 * 「信息浏览和AI服务仍可进入」；如果探测还没出结果就先说这句话，等于用「还不知道」
 * 冒充「AI 能用」。checking 不能误放行。
 *
 * deviceChecking 这一档是 2026-09-20 补的，稿里没有。在此之前它落进最后那句 default，
 * 于是 `/resume-service` 在后端已就绪、本机打印机状态还没回来的那几百毫秒里，
 * 顶栏胶囊写「正在确认本机设备」、提示条 data-readiness 是 checking、图标转着圈，
 * 而提示条正文却说「进入具体服务后再确认实时能力」——那是**就绪态**的话术。
 * 同一条提示条上的三个信号给出两种结论，读到文字的人会以为设备已经确认过了。
 * 卡片那一层从来没错（unavailableReason 的 device + deviceChecking 一直 fail-closed），
 * 错的只有这句播报，所以这里只补文案，不动任何放行判据。
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
  if (state.deviceChecking) {
    return {
      title: '正在确认本机设备。',
      detail: '检查完成前，涉及出纸或扫描的入口暂不开放；信息浏览和AI服务不受影响。',
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

  // 只有真有设备能力的服务台才探测本机设备。
  //
  // `useTerminalDeviceStatus(false)` 是 hook 自带的停用档：effect 直接 return，
  // 既不发 `/terminals/:id/printer-status`，也不挂 60s 轮询定时器。
  // hook 调用本身仍然无条件执行（React hooks 规则：不能条件调用），
  // 变的只是它要不要干活。
  //
  // 停用时 hook 的返回值停在初始态（terminalId 存在时 loading=true）。
  // 那个 loading **不是**「正在探测」——根本没在探测——所以下面的 availability
  // 必须先乘上 deviceAware，否则岗位 / 招聘会 / 面试 / 政策会永久显示
  // 「正在确认本机设备」，而那句话在这四页上永远不会有下文。
  const deviceAware = hubUsesDevice(spec)
  const device = useTerminalDeviceStatus(deviceAware)

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
    deviceOff: deviceAware && (device.kind === 'offline' || device.kind === 'error'),
    deviceChecking: deviceAware && device.loading,
  }
  const apiBlocked = apiStatus !== 'ready'
  const notice = noticeCopy(availability)

  // 合同审查只在下面它自己的「签约与权益」分区渲染，不混进能力网格。
  const showContractReview = hub === 'resume' && contractReviewEnabled

  const renderCard = (cap: HubCapability, slot: 'grid' | 'contract') => {
    const reason = unavailableReason(cap.kind, cap.route, availability)
    const Icon = HUB_ICON[cap.icon]
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
          {/* 不可用态的原因独占一行（见 service-hub-qx.css 的 is-unavailable 规则）：
              和徽标挤同一行时「正在确认AI能力状态」会折成「…能力状」+「态」，
              一体机上站着读一个孤字特别刺眼。 */}
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
        data-hub-device-probe={deviceAware ? 'on' : 'off'}
      >
        {/* 域标识（稿的 eyebrow）。稿把它放在主标题上方；这里放在标题行下方独立一行，
            用小字 + 字距做成标签，不与 h1 竞争视线，也不混进 h1 的可及名称。 */}
        <p className="qx-hub-eyebrow">{spec.eyebrow}</p>
        {/* 稿里的 hero-note：原件/结果归属的一句话，紧跟在标题说明之后。 */}
        <p className="qx-hub-hero-note">
          <b>{spec.noteTitle}</b>
          <span>{spec.note}</span>
        </p>

        <section className="qx-hub-goals" aria-label="先告诉我你现在最想完成什么">
          <div className="qx-hub-goals-copy">
            <b>先告诉我你现在最想完成什么</b>
            {/* 稿的固定说明，逐字取自 16-service-hubs.html 的 first-copy。
                这里曾拼进 spec.sectionHint，于是同一句「六个入口，覆盖会前与现场准备」
                在目标分段和下方分区标题里各出现一次，读起来像页面卡住重复了。 */}
            <span>选择后直接进入对应服务；不会替你提交或生成结果。</span>
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
          /* 三档分别对应顶栏状态胶囊的 bad / warn / unknown，**严重度必须一致**：
             device-off 时胶囊是琥珀色的 warn（本机设备不可用，信息与AI仍可进），
             提示条此前却用朱砂红的 unavailable，同一页上两处对同一件事给出两种严重度。
             现在 unavailable 只留给 apiDown（整个后端不可达）。 */
          data-readiness={
            availability.apiDown
              ? 'unavailable'
              : availability.deviceOff
                ? 'degraded'
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

        {/* qx-hub-board--primary 是**显式**的主能力板标记：整页的竖向余量交给它吸收。
            这里原本写的是 CSS 选择器 `.qx-hub-board:first-of-type`，而 `:first-of-type`
            按标签名算——`.qx-hub` 里第一个 <section> 是上面的目标分段，不是本板，
            于是那条规则一次都没命中：六卡页（招聘会 / 面试）底部留下约 400px 死白。 */}
        <section className="qx-hub-board qx-hub-board--primary" aria-labelledby="qx-hub-section-title">
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
              const Icon = HUB_ICON[link.icon]
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
