// 帮助中心 /help。条目是页内常量，没有帮助内容接口，也没有工单通道。
// 版式照触屏稿 help：分类首页 / 分类问答 / 分类不在清单 / 内容没显示出来；隐私、设备与备案收在一张底部弹层里。

import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { HelpCircleIcon } from 'lucide-react'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchOverlay } from '../../components/qingxu/touch/QxTouchOverlay'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { useTerminalKiosk } from '../../services/api/screensaver'
import { ArtBox, Card, Hit, K, Note, Well } from '../public-touch/PublicBlocks'
import { IllusChecklist } from '../public-touch/PublicIllus'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import './help-service-desk.css'
import './help-touch.css'

interface QA {
  q: string
  a: string
  category: string
  categoryKey: string
  link?: { label: string; route: string }
}

type HelpView = 'default' | 'topic' | 'no-result' | 'unavailable'

const SELF_HELP_STEPS = [
  { title: '照屏幕上的提示走', body: '出错时先看当前页的提示和按钮，按提示重试或返回。设备故障不要自己拆，也不要拉扯纸张。' },
  { title: '退回上一步重做', body: '用「返回」回到上一步重选。打印要等你核对参数并确认之后才输出，确认前返回不会出纸。' },
  { title: '换一种来源', body: '一种上传方式不成，就回打印扫描换本机已经开通的其他来源。哪些能用，以那一页显示的为准。' },
] as const

const CATEGORIES: { key: string; label: string; summary: string }[] = [
  { key: 'account', label: '登录与账号', summary: '要不要登录、为什么变回游客、怎么换账号' },
  { key: 'resume', label: 'AI简历服务', summary: '能做什么、会不会保证面试或录用' },
  { key: 'print', label: '打印与扫描', summary: '怎么打印、扫描件保存在哪' },
  { key: 'policy', label: '政策服务', summary: '能不能代申请补贴' },
  { key: 'channels', label: '机构官方渠道', summary: '本机构的官方渠道在哪看、内容谁负责' },
  { key: 'jobs', label: '岗位与招聘会', summary: '能不能在这里办理岗位申请' },
  { key: 'records', label: '我的记录', summary: '文档和订单在哪里看' },
  { key: 'privacy', label: '隐私与留存', summary: '会不会推送给企业、文件存多久' },
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

// 一条问答：问题和答案都直接摊开，不是折叠按钮。answerId 是稳定的读屏编号，不含问题文字。
function QaRow({ item, answerId }: { item: QA; answerId: string }) {
  return (
    <div className="qxp-card hp-qa" role="group" aria-labelledby={`${answerId}-q`}>
      <p className="qxp-k" aria-hidden="true">问</p>
      <p className="qxp-note" id={`${answerId}-q`}><b>{item.q}</b></p>
      <p className="qxp-note" id={answerId}>{item.a}</p>
    </div>
  )
}

/** 备案行：一体机上是文字，浏览器里才是外链。 */
function FilingLine({ kiosk }: { kiosk: boolean }) {
  return (
    <p className="qxp-note hp-filing" aria-label="网站备案信息">
      {kiosk ? <span>鲁ICP备2026023517号-2</span> : (<a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">鲁ICP备2026023517号-2</a>)}
      {' · '}
      {kiosk ? <span>鲁公网安备37021402007308号</span> : (<a href="https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308" target="_blank" rel="noreferrer">鲁公网安备37021402007308号</a>)}
      {' · 职易达AI'}
    </p>
  )
}

export function HelpCenterPage() {
  const kiosk = useTerminalKiosk()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const hostingOpen = useRecruitmentHosting().enabled
  const phoneLine = useVisibleHelpLine()
  const faq = useMemo(() => buildFaq(hostingOpen), [hostingOpen])
  const cards = CATEGORIES
    .map((card) => ({ ...card, count: faq.filter((item) => item.categoryKey === card.key).length }))
    .filter((card) => card.count > 0)
  const listed = cards.filter((card) => card.key !== 'privacy')
  const privacy = cards.find((card) => card.key === 'privacy')
  const [moreOpen, setMoreOpen] = useState(false)
  const view = cards.length === 0 ? 'unavailable' : resolveView(params, cards.map((card) => card.key))
  const topicKey = params.get('topic') ?? ''
  const topic = cards.find((card) => card.key === topicKey)
  const section = { key: topicKey, items: faq.filter((item) => item.categoryKey === topicKey) }
  // 本类问答自带的入口，按出现顺序去重，收进「直接去办」一排。
  const topicLinks = section.items
    .flatMap((item) => (item.link ? [item.link] : []))
    .filter((link, index, all) => all.findIndex((other) => other.route === link.route) === index)
  const home = () => navigate('/')
  const clearTopic = () => setParams({})
  const handleNavigate = (route: string) => {
    if (route === '/login') {
      // 登录成功回到进登录前的这一页（带着当前分类）。
      navigate('/login', { state: { from: `${location.pathname}${location.search}` } })
      return
    }
    navigate(route)
  }

  const title = view === 'topic' && topic
    ? topic.label
    : view === 'no-result'
      ? '没有这个分类'
      : view === 'unavailable'
        ? '帮助内容没显示出来'
        : '你想解决什么？'
  const subtitle = view === 'topic' && topic
    ? `${topic.summary}。下面 ${section.items.length} 条是这一类里常被问到的。`
    : view === 'no-result'
      ? '请回到帮助首页，再选一个分类。'
      : view === 'unavailable'
        ? '帮助内容装在这台机器上。这一页没有显示完整。'
        : '先点一个分类，不用打字。'
  const status = view === 'unavailable'
    ? { tone: 'warn' as const, label: '帮助内容没显示出来' }
    : view === 'no-result'
      ? { tone: 'warn' as const, label: '不在帮助分类里' }
      : view === 'topic' && topic
        ? { tone: 'unknown' as const, label: `当前分类 · ${topic.label}` }
        : { tone: 'ok' as const, label: '常见问题' }

  const ask = view === 'unavailable'
    ? { label: '问小青：帮助页打不开', draft: '帮助页打不开，我该怎么继续？', voice: true }
    : view === 'no-result'
      ? { label: '问小青：分类里没有我的问题', draft: '这一页的分类里没有我的问题，我该怎么继续？', voice: true }
      : { label: '问小青：这里没看懂', draft: '帮助页里我没看懂，请帮我说明。', voice: true }
  const dock = view === 'topic' ? (
    <QxTouchDock
      onBack={clearTopic}
      backLabel="返回分类"
      ask={ask}
      primary={{ label: '返回首页', kind: 'sec', noArrow: true, onClick: home }}
    />
  ) : (
    <QxTouchDock onBack={home} backLabel={view === 'default' ? '返回' : '返回首页'} ask={ask} />
  )

  return (
    <div className="fusion-w5 fusion-w5--system service-desk k1-help-center" data-help-view={view}>
      <PublicTouchFrame
        page="help"
        title={title}
        eyebrow="帮助"
        sub={subtitle}
        status={status}
        back={view === 'topic' || view === 'no-result'
          ? { label: '返回帮助分类', onBack: clearTopic }
          : { label: '返回首页', onBack: home }}
        navCurrent="home"
        dock={dock}
        overlay={moreOpen ? (
          <QxTouchOverlay
            kind="sheet"
            title="隐私、设备与备案"
            onClose={() => setMoreOpen(false)}
            dismissOnScrim
            actions={<button type="button" className="qxt-btn qxt-btn-sec" onClick={() => setMoreOpen(false)}>收起</button>}
          >
            {privacy ? (
              <Hit
                title={privacy.label}
                sub={privacy.summary}
                testId={`help-topic-${privacy.key}`}
                onClick={() => { setMoreOpen(false); setParams({ topic: privacy.key }) }}
              />
            ) : null}
            <Hit title="看设备状态" sub="联网和各项读没读到" onClick={() => navigate('/error-offline')} />
            <FilingLine kiosk={kiosk} />
          </QxTouchOverlay>
        ) : undefined}
      >
        <section data-kiosk-screen="help" data-state={view} data-testid={`help-state-${view}`} className="qxp-grow">
          {view === 'default' ? (
            <>
              <div className="qxp-col hp-cats" role="group" aria-label="按分类筛选常见问题">
                {listed.map(({ key, label, summary, count }) => (
                  <Hit
                    key={key}
                    icon={<HelpCircleIcon size={28} />}
                    title={label}
                    sub={`${summary} · ${count} 问`}
                    testId={`help-topic-${key}`}
                    onClick={() => setParams({ topic: key })}
                  />
                ))}
              </div>
              <Hit title="隐私、设备与备案" sub="隐私与留存、看设备状态、备案号" onClick={() => setMoreOpen(true)} />
              <Well className="hp-well">
                <K>卡住了，先自己试这三步</K>
                <ol className="hp-ol">
                  {SELF_HELP_STEPS.map((step) => (
                    <li key={step.title}><b>{step.title}。</b>{step.body}</li>
                  ))}
                </ol>
                {phoneLine ? <Note>{phoneLine}</Note> : null}
                <FilingLine kiosk={kiosk} />
              </Well>
            </>
          ) : null}

          {view === 'topic' ? (
            <>
              <div className="qxp-col" aria-label="常见问题">
                {section.items.map((item, itemIndex) => (
                  <QaRow key={item.q} item={item} answerId={`help-answer-${section.key}-${itemIndex}`} />
                ))}
              </div>
              {topicLinks.length > 0 ? (
                <>
                  <K>直接去办</K>
                  <div className="qxp-row">
                    {topicLinks.map((link) => (
                      <Hit key={link.route} title={link.label} sub="打开" onClick={() => handleNavigate(link.route)} />
                    ))}
                  </div>
                </>
              ) : null}
              <Card className="hp-sink">
                <Note>这里没答上，可以换一个分类，或问小青。</Note>
                <ArtBox><IllusChecklist w={160} /></ArtBox>
              </Card>
            </>
          ) : null}

          {view === 'no-result' ? (
            <>
              <QxTouchCallout kind="howto" icon="alert">没有这个分类。回到帮助首页再选，正在办的事不受影响。</QxTouchCallout>
              <Card className="hp-sink" testId="help-fallback">
                <Note>可以从帮助首页按要办的事继续找。</Note>
                <ArtBox><IllusChecklist w={200} /></ArtBox>
              </Card>
              <Hit title="回到帮助首页" onClick={clearTopic} />
              {phoneLine ? <QxTouchCallout kind="remind">{phoneLine}</QxTouchCallout> : null}
            </>
          ) : null}

          {view === 'unavailable' ? (
            <>
              <QxTouchCallout kind="howto" icon="alert">可以再打开一次。正在办的打印不会因此取消。</QxTouchCallout>
              <div className="qxp-col" data-testid="help-fallback">
                <Hit title="重新打开帮助" sub="再加载一次这一页" />
                <Hit title="回首页再进来" sub="正在办的打印和取件码都还在" />
                {phoneLine ? <Hit title="拨服务电话" sub={phoneLine} /> : null}
              </div>
              <Card className="hp-sink">
                <Note>帮助页打不开，不会取消正在办的打印。</Note>
                <ArtBox><IllusChecklist w={200} /></ArtBox>
              </Card>
              <button type="button" className="qxt-btn qxt-btn-pri qxt-wide hp-reopen" onClick={() => window.location.assign('/help')}>重新打开帮助</button>
            </>
          ) : null}
        </section>
      </PublicTouchFrame>
    </div>
  )
}
