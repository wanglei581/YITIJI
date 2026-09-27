import { useTerminalKiosk } from '../../services/api/screensaver'
// 帮助中心 /help。条目是页内常量，没有帮助内容接口，也没有工单通道。
// 版式按青序流光 2.0 稿 06：分类首页 / 分类问答 / 分类不在清单 / 内容没显示出来。

import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  BriefcaseBusinessIcon, ChevronRightIcon, FolderOpenIcon, InfoIcon, LandmarkIcon, LockIcon,
  MapPinIcon, PhoneIcon, PrinterIcon, QrCodeIcon, SparklesIcon, UserIcon, type LucideIcon,
} from 'lucide-react'
import { QxAiHelp } from '../../components/qingxu/QxAiHelp'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import './help-service-desk.css'

interface QA {
  q: string
  a: string
  category: string
  categoryKey: string
  link?: { label: string; route: string }
}

type HelpView = 'default' | 'topic' | 'no-result' | 'unavailable'
type Tone = 'teal' | 'plum' | 'slate' | 'wheat'

const SELF_HELP_STEPS = [
  { title: '照屏幕上的提示走', body: '出错时先看当前页面的提示与按钮，按提示重试或返回；设备故障请勿自行拆卸或拉扯纸张。' },
  { title: '退回上一步重做', body: '用页面上的「返回」回到上一步重新选择。打印在你核对参数并确认之后才开始输出，确认前返回不会出纸。' },
  { title: '换一种来源', body: '一种上传方式不成时，回到打印扫描页换本机已开通的其他来源；哪些可用以页面显示为准。' },
] as const

const CATEGORIES: { key: string; label: string; summary: string; icon: LucideIcon; tone: Tone }[] = [
  { key: 'account', label: '登录与账号', summary: '要不要登录、为什么变回游客、怎么换账号', icon: UserIcon, tone: 'teal' },
  { key: 'resume', label: 'AI简历服务', summary: '能做什么、会不会保证面试或录用', icon: SparklesIcon, tone: 'plum' },
  { key: 'print', label: '打印与扫描', summary: '怎么打印、扫描件保存在哪', icon: PrinterIcon, tone: 'slate' },
  { key: 'policy', label: '政策服务', summary: '能不能代申请补贴', icon: LandmarkIcon, tone: 'wheat' },
  { key: 'channels', label: '机构官方渠道', summary: '本机构的官方渠道在哪看、内容谁负责', icon: QrCodeIcon, tone: 'slate' },
  { key: 'jobs', label: '岗位与招聘会', summary: '能不能在这里办理岗位申请', icon: BriefcaseBusinessIcon, tone: 'slate' },
  { key: 'records', label: '我的记录', summary: '文档和订单在哪里看', icon: FolderOpenIcon, tone: 'wheat' },
  { key: 'privacy', label: '隐私与留存', summary: '会不会推送给企业、文件存多久', icon: LockIcon, tone: 'teal' },
]

function buildFaq(hostingOpen: boolean): QA[] {
  const channels: QA[] = hostingOpen
    ? [
      {
        categoryKey: 'channels', category: '机构官方渠道',
        q: '本机构官方渠道在哪看？',
        a: '在「本机构官方渠道」里扫二维码，到机构自己的网站或公众号查看。内容由运营这台机器的机构维护，以机构官网或公众号为准。',
        link: { label: '本机构官方渠道', route: '/official-channels' },
      },
      {
        categoryKey: 'channels', category: '机构官方渠道',
        q: '官方渠道的内容谁负责？',
        a: '二维码由运营这台机器的机构自己维护，内容以机构官网或公众号为准。内容不合适时可以紧急撤下，平时不改机构写的内容。',
      },
    ]
    : [
      {
        categoryKey: 'channels', category: '机构官方渠道',
        q: '这台机器上能看岗位或报名吗？',
        a: '不能。本机不存岗位和招聘会信息，也不代收简历。想看本机构发布的内容，请扫「本机构官方渠道」里的二维码，到机构自己的网站或公众号办理。',
        link: { label: '本机构官方渠道', route: '/official-channels' },
      },
      {
        categoryKey: 'channels', category: '机构官方渠道',
        q: '官方渠道的内容谁负责？',
        a: '二维码由运营这台机器的机构自己维护，内容以机构官网或公众号为准。内容不合适时可以紧急撤下，平时不改机构写的内容。',
      },
    ]
  const jobs: QA[] = hostingOpen
    ? [{
      categoryKey: 'jobs', category: '岗位与招聘会',
      q: '可以在这里办理岗位申请吗？',
      a: '本终端不是网络招聘平台，不办理岗位申请。岗位与招聘会信息均来自第三方/官方来源，相关申请与报名请通过页面提供的来源平台入口自行办理。',
      link: { label: '岗位信息', route: '/jobs' },
    }]
    : []
  return [
    {
      categoryKey: 'account', category: '登录与账号',
      q: '一定要登录才能使用吗？',
      a: '不需要。大部分服务可以游客身份直接使用。使用手机验证码登录后，本次服务记录（简历记录、文档、打印订单、收藏等）会关联到你的账号，仅本人可见。',
      link: { label: '去登录', route: '/login' },
    },
    {
      categoryKey: 'account', category: '登录与账号',
      q: '为什么离开或刷新后又变回游客了？',
      a: '本终端是公共设备，登录只留在当前这一次。页面刷新、离开或闲置超时会自动退出登录并清掉这次留下的内容，这是公共终端的正常保护行为。',
    },
    {
      categoryKey: 'account', category: '登录与账号',
      q: '怎么切换成另一个账号？',
      a: '在「我的 → 账号设置」中退出当前账号，再用另一个手机号重新登录即可。本终端不做多角色身份切换。',
      link: { label: '账号设置', route: '/me/settings' },
    },
    {
      categoryKey: 'resume', category: 'AI简历服务',
      q: 'AI 简历服务能做什么？',
      a: 'AI 可以对你提供的简历做诊断、优化建议与生成参考，仅供你本人修改简历时参考。AI 输出可能存在偏差，请在使用前核对关键信息。',
      link: { label: '开始使用', route: '/resume/source' },
    },
    {
      categoryKey: 'resume', category: 'AI简历服务',
      q: 'AI 会保证我面试或录用成功吗？',
      a: '不会。本平台不作出任何面试、录用或通过率承诺，也不参与企业后续招聘流程。',
    },
    {
      categoryKey: 'print', category: '打印与扫描',
      q: '怎么打印文件？',
      a: '在「文档打印」上传文件，核对打印参数与现场公示价目后确认输出。打印任务一经确认开始输出，纸张耗材即发生消耗，请在确认前核对参数。',
      link: { label: '文档打印', route: '/print/upload' },
    },
    {
      categoryKey: 'print', category: '打印与扫描',
      q: '扫描的文件保存在哪里？',
      a: '扫描结果仅用于本次打印，或存进这次的记录。敏感文件设置短期有效期，到期自动删除。',
      link: { label: '扫描文件', route: '/scan' },
    },
    {
      categoryKey: 'policy', category: '政策服务',
      q: '政策服务能帮我申请补贴吗？',
      a: '政策服务只提供政策说明、材料清单、官方入口与打印辅助，不代申请、不承诺资金发放或审核结果，也不保存身份证 / 银行卡 / 社保等材料。具体办理与结果以官方平台为准。',
      link: { label: '政策服务', route: '/renshi?tab=policy' },
    },
    ...channels,
    ...jobs,
    {
      categoryKey: 'records', category: '我的记录',
      q: '在哪里查看我的文档和订单？',
      a: '登录后在「我的」页可查看本人的文档、打印订单、收藏与浏览/跳转记录，所有记录仅本人可见。',
      link: { label: '我的文档', route: '/me/documents' },
    },
    {
      categoryKey: 'privacy', category: '隐私与留存',
      q: '我上传的简历会被泄露或推送给企业吗？',
      a: '不会。简历内容仅用于你本次发起的 AI 分析，不进入任何「简历库」，不推送给任何企业或第三方招聘方。',
    },
    {
      categoryKey: 'privacy', category: '隐私与留存',
      q: '文件会保存多久？',
      a: '证件照、身份证复印件、未登录上传文件等高敏或匿名文件短期保存；登录后原始简历和求职材料默认保存 90 天，可在「我的文档」延长至 180 天；AI 优化成果物可在本人确认后长期保存，也可随时删除。详见隐私政策。',
      link: { label: '隐私政策', route: '/legal/privacy' },
    },
  ]
}

function resolveView(params: URLSearchParams, keys: readonly string[]): HelpView {
  if (params.get('state') === 'unavailable') return 'unavailable'
  if (params.get('state') === 'no-result') return 'no-result'
  const topic = params.get('topic')
  if (params.get('state') === 'topic' && !topic) return 'no-result'
  if (!topic) return 'default'
  return keys.includes(topic) ? 'topic' : 'no-result'
}

function QaRow({ item, answerId, onNavigate }: { item: QA; answerId: string; onNavigate: (route: string) => void }) {
  return (
    <div className="k1-help-row is-open">
      <button type="button" aria-expanded={true} aria-controls={answerId} className="k1-help-toggle">
        <span className="k1-help-question-mark" aria-hidden="true">问</span>
        <span className="k1-help-question"><strong>{item.q}</strong></span>
      </button>
      <div id={answerId} className="k1-help-answer">
        <p>{item.a}</p>
        {item.link ? (
          <button type="button" onClick={() => onNavigate(item.link!.route)} className="k1-help-link">
            {item.link.label}<ChevronRightIcon aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SectionHead({ no, title, hint }: { no: string; title: string; hint?: string }) {
  return (
    <div className="k1-help-sec-head">
      <h2><span>{no}</span>{title}</h2>
      {hint ? <small>{hint}</small> : null}
    </div>
  )
}

function SelfHelp({ no }: { no: string }) {
  return (
    <>
      <SectionHead no={no} title="卡住了，先自己试这三步" hint="多数情况到第二步就通了" />
      <ol className="k1-help-steps">
        {SELF_HELP_STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="k1-help-step-no" aria-hidden="true">{index + 1}</span>
            <strong>{step.title}</strong>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
    </>
  )
}

function HumanDesk({ no }: { no: string }) {
  return (
    <>
      <SectionHead no={no} title="自己解决不了，找人" hint="这两条才真的有人处理" />
      <div className="k1-help-people">
        <div className="k1-help-contact">
          <span className="k1-help-cat-icon" aria-hidden="true"><MapPinIcon /></span>
          <div>
            <h3>找现场工作人员</h3>
            <p>机器故障、退费、开票都由现场处理。服务台位置和值守时间以现场公示为准，屏幕上不写死。</p>
            <p className="k1-help-note">本页不会替你联系工作人员，也不会自动上报；点任何按钮都不等于已经有人受理。</p>
          </div>
        </div>
        <div className="k1-help-contact">
          <span className="k1-help-cat-icon" aria-hidden="true"><PhoneIcon /></span>
          <div>
            <h3>拨机身上的服务电话</h3>
            <p>号码贴在机身上，屏幕上不显示。</p>
            <p>打之前先记下屏幕上的订单号或取件码。登录后也可在「我的」查看本人的打印订单。</p>
          </div>
        </div>
      </div>
    </>
  )
}

export function HelpCenterPage() {
  const kiosk = useTerminalKiosk()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const hostingOpen = useRecruitmentHosting().enabled
  const faq = useMemo(() => buildFaq(hostingOpen), [hostingOpen])
  const cards = CATEGORIES
    .map((card) => ({ ...card, count: faq.filter((item) => item.categoryKey === card.key).length }))
    .filter((card) => card.count > 0)
  const view = cards.length === 0 ? 'unavailable' : resolveView(params, cards.map((card) => card.key))
  const topicKey = params.get('topic') ?? ''
  const topic = cards.find((card) => card.key === topicKey)
  const visibleFaq = faq.filter((item) => item.categoryKey === topicKey)
  const home = () => navigate('/')
  const clearTopic = () => setParams({})
  const handleNavigate = (route: string) => {
    if (route === '/login') {
      navigate('/login', { state: { from: '/help' } })
      return
    }
    navigate(route)
  }

  const title = view === 'topic' && topic
    ? <><span className="k1-help-eyebrow">{`帮助 · ${topic.label}`}</span><span>{topic.label}</span></>
    : view === 'no-result'
      ? '没有这个分类'
      : view === 'unavailable'
        ? '帮助内容没显示出来'
        : <><span className="k1-help-eyebrow">现场帮助</span><span>你想解决<em>什么问题</em>？</span></>
  const subtitle = view === 'topic' && topic
    ? `${topic.summary}。下面 ${visibleFaq.length} 条是这一类里最常被问到的，答案就是本机现在的实际做法。`
    : view === 'no-result'
      ? '地址里的分类不在这台机器的帮助分类里，这里不猜你想看哪一类，也不拿别的内容顶上。'
      : view === 'unavailable'
        ? '帮助内容装在这台机器上，不用再去取一份。这里空白通常是这一页没打开完整，不是你操作错了。'
        : (
          <>
            <span>先在下面点一个分类，<b>不用打字</b>。里面放的是这台机器上最常卡住的几件事，点开就能看到做法和对应入口。</span>
            <span className="k1-help-hero-steps">
              {SELF_HELP_STEPS.map((step, index) => <span key={step.title}><b>{index + 1}</b>{step.title}</span>)}
            </span>
          </>
        )
  const status = view === 'unavailable'
    ? { tone: 'warn' as const, label: '帮助内容没显示出来' }
    : view === 'no-result'
      ? { tone: 'warn' as const, label: '不在帮助分类里' }
      : view === 'topic' && topic
        ? { tone: 'unknown' as const, label: `当前分类 · ${topic.label}` }
        : { tone: 'unknown' as const, label: '帮助内容随应用发布' }

  return (
    <div className="fusion-w5 fusion-w5--system service-desk k1-help-center" data-help-view={view}>
      <QxPageFrame
        title={title}
        subtitle={subtitle}
        status={status}
        back={view === 'topic' || view === 'no-result'
          ? { label: '返回帮助分类', onBack: clearTopic }
          : { label: '返回首页', onBack: home }}
        ctabar={(
          <>
            <div className="k1-help-actions">
              {view === 'unavailable' ? (
                <>
                  <button type="button" onClick={home}>返回首页</button>
                  <button type="button" className="is-primary" data-testid="help-primary" onClick={() => window.location.assign('/help')}>重新打开帮助</button>
                </>
              ) : view === 'no-result' ? (
                <>
                  <button type="button" onClick={home}>返回首页</button>
                  <button type="button" className="is-primary" data-testid="help-primary" onClick={clearTopic}>回到帮助首页</button>
                  <QxAiHelp label="问小青：分类里没有我的问题" draft="这一页的分类里没有我的问题，我该怎么继续？" />
                </>
              ) : view === 'topic' ? (
                <>
                  <button type="button" onClick={clearTopic}>返回分类</button>
                  <button type="button" onClick={home}>返回首页</button>
                  <button type="button" className="is-primary" data-testid="help-primary" onClick={() => navigate('/assistant')}>问小青：这里没看懂</button>
                </>
              ) : (
                <>
                  <button type="button" onClick={home}>返回首页</button>
                  <button type="button" onClick={() => navigate('/error-offline')}>看设备状态</button>
                  <button type="button" className="is-primary" data-testid="help-primary" onClick={() => navigate('/assistant')}>问小青：这里没看懂</button>
                </>
              )}
            </div>
            <div className="k1-help-truth" data-disclaimer="true" data-testid="help-truth">
              <div><b>这页写的是什么</b>只写本机已经上线的做法；帮助内容随应用一起发布，不是实时服务状态。</div>
              <div><b>求助怎么算数</b>本页不能替你联系工作人员，也不会自动上报故障；要人处理请直接找现场工作人员，或拨机身上的服务电话。</div>
            </div>
          </>
        )}
      >
        <section data-kiosk-screen="help" data-state={view} data-testid={`help-state-${view}`} className="k1-help-scroll qx-scroll">
          {view === 'default' || view === 'no-result' ? (
            <>
              <SectionHead
                no="01"
                title={view === 'no-result' ? '可选的分类' : '按你正要办的事找'}
                hint={view === 'no-result' ? `共 ${cards.length} 个` : '只写本机已经能做的事'}
              />
              <div className="k1-help-filters" role="group" aria-label="按分类筛选常见问题">
                {cards.map(({ key, label, summary, icon: Icon, tone, count }) => (
                  <button
                    key={key}
                    type="button"
                    data-testid={`help-topic-${key}`}
                    data-tone={tone}
                    aria-pressed={false}
                    onClick={() => setParams({ topic: key })}
                  >
                    <span className="k1-help-cat-top">
                      <span className="k1-help-cat-icon" aria-hidden="true"><Icon /></span>
                      <strong>{label}</strong>
                      <span className="k1-help-count">{count} 问</span>
                    </span>
                    <small>{summary}</small>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {view === 'topic' ? (
            <>
              <SectionHead no="01" title="这一类的常见问题" hint="答案已展开，不用再点" />
              <div className="k1-help-faq-list" aria-label="常见问题">
                {[{ key: topicKey, items: visibleFaq }].map(section => (
                  section.items.map((item, itemIndex) => (
                    <QaRow key={item.q} item={item} answerId={`help-answer-${section.key}-${itemIndex}`} onNavigate={handleNavigate} />
                  ))
                ))}
              </div>
              <div className="k1-help-miss">
                <h3><InfoIcon aria-hidden="true" />这里没答上你的问题</h3>
                <p>换一个分类再看看，或者用下面的按钮把问题告诉小青。退费、开票和机器故障只能找现场工作人员，本页不会替你转达。</p>
              </div>
            </>
          ) : null}

          {view === 'unavailable' ? (
            <>
              <SectionHead no="01" title="按顺序试这三条" hint="前两条自己就能做" />
              <ol className="k1-help-steps" data-testid="help-fallback">
                <li><span className="k1-help-step-no" aria-hidden="true">1</span><strong>重新打开帮助</strong><p>点下面的重新打开帮助，这一页会再加载一次。</p></li>
                <li><span className="k1-help-step-no" aria-hidden="true">2</span><strong>回首页再进来</strong><p>回首页重新进入要办的服务。正在办的打印不会因此取消。</p></li>
                <li><span className="k1-help-step-no" aria-hidden="true">3</span><strong>找现场工作人员</strong><p>连着两次都打不开，就直接找人。屏幕这边不会替你报修。</p></li>
              </ol>
              <SectionHead no="02" title="这不影响你办事" hint="帮助页只是补充" />
              <div className="k1-help-people">
                <div className="k1-help-contact">
                  <span className="k1-help-cat-icon" aria-hidden="true"><FolderOpenIcon /></span>
                  <div>
                    <h3>正在办的事照常</h3>
                    <p>打印任务和取件码都还在。帮助页打不开不会取消它们，回首页接着办即可。</p>
                  </div>
                </div>
                <div className="k1-help-contact">
                  <span className="k1-help-cat-icon" aria-hidden="true"><InfoIcon /></span>
                  <div>
                    <h3>业务页上的提示更直接</h3>
                    <p>真出错时，正在办的那一页会写清卡在哪一步。帮助页只是补充说明。</p>
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {view === 'default' || view === 'topic' ? <SelfHelp no={view === 'topic' ? '03' : '02'} /> : null}
          {view === 'default' ? <HumanDesk no="03" /> : null}
          {view === 'no-result' ? <HumanDesk no="02" /> : null}
          {view === 'unavailable' ? <HumanDesk no="03" /> : null}
          {view === 'no-result' ? (
            <div className="k1-help-miss" data-testid="help-fallback">
              <h3><InfoIcon aria-hidden="true" />怎么会到这一页</h3>
              <p>分类是从上一页点进来的。旧链接，或者分类后来改过名字，都会落到这里。点上面任意一个分类就能继续，你正在办的事不受影响。</p>
            </div>
          ) : null}

          <p className="k1-help-filing" aria-label="网站备案信息">
            {kiosk ? <span>鲁ICP备2026023517号-2</span> : (<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
              鲁ICP备2026023517号-2
            </a>)}
            {' · '}
            {kiosk ? <span>鲁公网安备37021402007308号</span> : (<a href="https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308" target="_blank" rel="noreferrer">
              鲁公网安备37021402007308号
            </a>)}
            {' · 职易达AI'}
          </p>
        </section>
      </QxPageFrame>
    </div>
  )
}
