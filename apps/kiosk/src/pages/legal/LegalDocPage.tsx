// ============================================================
// 用户服务协议 / 隐私政策 — /legal/:doc（整屏路由，在 KioskRoot 之外）。
//
// 2026-09-25 迁入青序稿 08-legal：文档切换 → 文档头 → 按章节读（左目录 + 右单章）→
// 「哪一版算数 / 看不懂这一章」两张卡；另有 loading / error / not-found 三态照稿。
// 页壳是 PublicTouchFrame；舞台缩放与 JobFitStage 同一判据（竖屏一体机与横屏电脑缩放，只有手机按真实宽度排）。
//
// 正文口径（稿头注释 + G6 + verify:legal-doc-version 第 12 项）：
// - 正文只来自 GET /kiosk/legal/{docType} 的当前有效版本；取到之前只放槽位，不显示任何条款。
// - 请求失败 → error 态并给重试，不静默顶替。下面的本机留存文本只在用户点开时显示，
//   并显式标注「不作为正式版本」——公共终端断网也要能读到条款。
// - 服务端可达但尚无激活版本（data: null）→ 直接展示本机留存文本并标注：登录同意此时记录的
//   正是草拟哨兵版本 draft-pending-legal-review，它对应的就是这份文本。
// - 未知 :doc → not-found，不回落到任何一份文档。
//
// 本机留存文本为 v1 草拟版，与系统当前真实数据实践对齐（短 TTL 文件、不留简历库、
// OCR 不留原文、会员手机号加密存储等）。正式运营前须经运营方法务审定后替换定稿
// （见 docs/compliance/）。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { QxTouchCallout } from '../../components/qingxu/touch/QxTouchCallout'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { ArtBox, Card, Hit, K, Note, PairCard } from '../public-touch/PublicBlocks'
import { IllusChecklist, IllusStack } from '../public-touch/PublicIllus'
import { PublicTouchFrame } from '../public-touch/PublicTouchFrame'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import { useKioskStageFit, usesKioskFluidViewport } from '../../hooks/useKioskStageFit'
import { API_BASE_URL } from '../../services/api'
import {
  FROM_TARGETS, findSectionIndex, formatPublishedAt, readDocLoad, readFromKey, readSectionTitle, splitLegalSections,
  type DocLoad, type Section,
} from './legalDocModel'
import { DocTabs, FontTools, LegalReader, type DocMeta } from './LegalDocViews'
import './legal-service-desk.css'

const FALLBACK_UPDATED_AT = '2026 年 6 月 22 日'

const TERMS_SECTIONS: Section[] = [
  {
    title: '一、服务说明',
    paragraphs: [
      '本终端为「AI求职打印服务终端」，提供 AI 简历服务（诊断、优化、生成）、文档打印扫描、第三方岗位信息与招聘会信息浏览入口、政策信息查询等服务。',
      '本平台不是网络招聘平台：不提供平台内投递、不向企业收取或转交您的简历、不参与任何企业筛选、面试或录用环节。岗位与招聘会信息均来自第三方/官方来源，投递与报名请通过页面提供的来源平台入口自行办理。',
    ],
  },
  {
    title: '二、账号与登录',
    paragraphs: [
      '您可以游客身份使用大部分服务。使用手机验证码登录后，可将服务记录（简历记录、文档、打印订单、收藏、权益）关联到您的账号，仅本人可见。',
      '这台机器是公共设备：页面刷新、离开或闲置超时后将自动退出登录并清除这次使用的信息，请勿在机器上留存个人物品与文件。',
    ],
  },
  {
    title: '三、用户承诺',
    paragraphs: [
      '您承诺上传的简历及其他文件为本人所有或已获合法授权，内容真实、不含违法信息。',
      '不得利用本终端从事任何违法活动，不得上传含他人隐私、涉密或侵权内容的文件。',
    ],
  },
  {
    title: '四、AI 服务的性质',
    paragraphs: [
      'AI 诊断、优化与生成结果仅基于您提供的内容产生，仅供您本人修改简历时参考，不代表任何招聘结果承诺。本平台不作出"保面试""保录用""提高通过率"等任何承诺。',
      'AI 输出可能存在偏差；通过拍照或扫描识别的内容（OCR）可能存在识别误差，请您在使用前核对关键信息。',
    ],
  },
  {
    title: '五、收费与打印',
    paragraphs: [
      '打印服务按现场公示价目执行。打印任务一经确认开始输出，纸张耗材即发生消耗，请在确认前核对打印参数。',
    ],
  },
  {
    title: '六、其他',
    paragraphs: [
      '本协议未尽事宜以现场公示及运营方发布的正式版本为准。如本页内容与正式发布版本不一致，以正式发布版本为准。',
    ],
  },
]

const PRIVACY_SECTIONS: Section[] = [
  {
    title: '一、我们收集的信息',
    paragraphs: [
      '登录信息：手机号（用于验证码登录）。手机号在系统中加密存储，页面展示时脱敏。',
      '服务内容：您主动上传的简历及文件、AI 服务过程中产生的结果、打印任务记录、您的收藏与权益记录。',
      '我们不会采集您的人脸信息，不读取您设备中的其他文件。',
    ],
  },
  {
    title: '二、信息如何使用',
    paragraphs: [
      '简历内容仅用于您本次发起的 AI 分析（诊断/优化/生成），不进入任何"简历库"，不推送给任何企业或第三方招聘方。',
      '图片或扫描件简历会经第三方文字识别（OCR）服务提取文字，仅传输识别所需的图像数据，识别原文不写入日志，图像不在云端留存。',
      'AI 分析由配置的大模型服务完成，仅传输完成分析所必需的文本内容。',
    ],
  },
  {
    title: '三、保存期限与自动清理',
    paragraphs: [
      '证件照、身份证复印件、未登录上传文件等高敏或匿名文件设置短期有效期，到期自动删除。',
      '登录会员上传的原始简历与求职材料默认保存 90 天，可在确认保存条款后延长至 180 天；优化后或派生成果物可在本人确认保存条款后长期保存。',
      '您可以在对应业务页面（我的文档 / AI服务记录等）查看保存期限、调整允许的保存策略，或随时自行删除本人的文档与 AI 记录，删除文件为物理删除。',
      '公共设备上这次使用的信息（含登录状态）在退出、闲置超时或进入待机时即刻清除。',
    ],
  },
  {
    title: '四、您的权利',
    paragraphs: [
      '登录后您可查看、下载、删除本人名下的文档与记录；所有数据仅本人可见，他人（含其他会员）无法访问。',
      '管理员因运维需要访问文件时，系统会记录审计日志。',
    ],
  },
  {
    title: '五、联系我们',
    paragraphs: [
      '如对个人信息保护有任何疑问或需要协助，请通过终端公示的运营方联系方式与我们沟通。',
      '本政策正式版本以运营方发布为准；如本页内容与正式发布版本不一致，以正式发布版本为准。',
    ],
  },
]

type DocKey = DocMeta['key']

const DOCS: Record<DocKey, DocMeta> = {
  terms: {
    key: 'terms', docType: 'terms_of_service', title: '用户服务协议', eyebrow: '你和这台机器', glyph: 'file', tone: 'slate',
    summary: '约定你和这台机器之间的服务关系：能办什么、要不要登录、你答应什么、AI 结果怎么算、打印怎么收费。',
    sections: TERMS_SECTIONS,
  },
  privacy: {
    key: 'privacy', docType: 'privacy_policy', title: '隐私政策', eyebrow: '你的信息', glyph: 'shield', tone: 'teal',
    summary: '说明这台机器怎么处理你的个人信息：收什么、拿去做什么、存多久、你能怎么删、找谁问。',
    sections: PRIVACY_SECTIONS,
  },
}
const DOC_LIST = [DOCS.terms, DOCS.privacy]
/** URL 段 → 文档。user 是稿 08 的叫法，与 terms 同义；受控清单之外一律 not-found。 */
const DOC_ALIASES: Record<string, DocKey> = { terms: 'terms', user: 'terms', privacy: 'privacy' }

type View = 'loading' | 'ready' | 'fallback' | 'error' | 'not-found'

async function fetchLegalDoc(docType: DocMeta['docType'], signal: AbortSignal): Promise<DocLoad> {
  try {
    const response = await fetch(`${API_BASE_URL}/kiosk/legal/${docType}`, { signal })
    if (!response.ok) return { status: 'error' }
    return readDocLoad(await response.json())
  } catch {
    return { status: 'error' }
  }
}

export function LegalDocPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { doc } = useParams<{ doc: string }>()
  const docKey: DocKey | null = doc && Object.prototype.hasOwnProperty.call(DOC_ALIASES, doc) ? DOC_ALIASES[doc] : null
  const meta = docKey ? DOCS[docKey] : null
  const other = docKey === 'privacy' ? DOCS.terms : DOCS.privacy
  const fromKey = readFromKey(location.search)
  const sectionTitle = readSectionTitle(location.search)
  const { viewportW, viewportH } = useKioskStageFit()
  const fluid = usesKioskFluidViewport(viewportW, viewportH)

  const [loads, setLoads] = useState<Record<DocKey, DocLoad>>({ terms: { status: 'loading' }, privacy: { status: 'loading' } })
  // 请求失败后，用户主动点「看本机留存文本」才显示；重试时清掉，让重试结果说话。
  const [localOptIn, setLocalOptIn] = useState<Record<DocKey, boolean>>({ terms: false, privacy: false })
  const [fontPercent, setFontPercent] = useState(100)
  const [chapter, setChapter] = useState<{ key: string; index: number }>({ key: '', index: 0 })
  const controllers = useRef<Partial<Record<DocKey, AbortController>>>({})
  const bodyRef = useRef<HTMLElement>(null)

  const load = useCallback((key: DocKey) => {
    controllers.current[key]?.abort()
    const controller = new AbortController()
    controllers.current[key] = controller
    setLoads((prev) => ({ ...prev, [key]: { status: 'loading' } }))
    void fetchLegalDoc(DOCS[key].docType, controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoads((prev) => ({ ...prev, [key]: result }))
    })
  }, [])

  useEffect(() => {
    // 两份文档分别取：这一份取不到，另一份不一定也取不到。
    const current = controllers.current
    load('terms')
    load('privacy')
    return () => {
      current.terms?.abort()
      current.privacy?.abort()
    }
  }, [load])

  const docLoad = docKey ? loads[docKey] : null
  const view: View = !docKey || !docLoad
    ? 'not-found'
    : docLoad.status === 'ready'
      ? 'ready'
      : docLoad.status === 'draft' || (docLoad.status === 'error' && localOptIn[docKey])
        ? 'fallback'
        : docLoad.status === 'error' ? 'error' : 'loading'

  const servedSections = useMemo(
    () => (docLoad?.status === 'ready' ? splitLegalSections(docLoad.content) : null),
    [docLoad],
  )
  const sections: Section[] = servedSections ?? meta?.sections ?? []
  const chapterKey = `${docKey ?? ''}:${view}`
  // 没点过目录时，按 `?section=` 打开到标题包含它的那一章；找不到停在开头。
  const sectionTarget = findSectionIndex(sections, sectionTitle)
  const activeChapter = chapter.key === chapterKey && chapter.index < sections.length ? chapter.index : sectionTarget
  useEffect(() => {
    // 正文到手、且确实按标题找到了那一章时，把它滚进视野（目录较长时那一项可能在下面）。
    if (!sectionTitle || sectionTarget === 0 || view !== 'ready') return
    bodyRef.current?.scrollIntoView({ block: 'nearest' })
  }, [sectionTarget, sectionTitle, view])

  // 返回：有站内上一页就回上一页（进来的那一页）；来路不明时回受控来源或首页，不接受任意路径。
  // 按钮上写的必须就是点下去的去处：标签与 goBack 用同一个优先级（先历史，再受控来源，最后首页）。
  const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0
  const fromTarget = fromKey ? FROM_TARGETS[fromKey] : null
  const backLabel = historyIndex > 0 ? '返回上一页' : (fromTarget?.label ?? '返回首页')
  const goBack = () => {
    if (historyIndex > 0) {
      navigate(-1)
      return
    }
    navigate(fromTarget?.route ?? '/', { replace: true })
  }
  const switchDoc = (key: DocKey) => {
    navigate({ pathname: `/legal/${key}`, search: fromKey ? `?from=${fromKey}` : '' }, { replace: true })
  }
  const retry = (key: DocKey) => {
    setLocalOptIn((prev) => ({ ...prev, [key]: false }))
    load(key)
  }
  const selectChapter = (index: number) => {
    setChapter({ key: chapterKey, index })
    const body = bodyRef.current
    if (!body) return
    body.scrollTop = 0
    body.scrollIntoView({ block: 'nearest' })
  }

  const fontTools = (
    <FontTools
      percent={fontPercent}
      onSmaller={() => setFontPercent((value) => Math.max(90, value - 10))}
      onLarger={() => setFontPercent((value) => Math.min(120, value + 10))}
    />
  )
  const phoneLine = useVisibleHelpLine()

  let status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  let title = meta?.title ?? '协议与隐私'
  let sub: string | undefined
  let body: ReactNode
  let dock: ReactNode
  const backOnly = <QxTouchDock onBack={goBack} backLabel={backLabel} className="legal-doc-cta" />

  if (!meta || view === 'not-found') {
    status = { tone: 'warn', label: '没有这份文档' }
    title = '没有这份文档'
    sub = '请打开下面两份之一。'
    body = (
      <>
        <div data-testid="legal-fallback">
          <QxTouchCallout kind="howto" icon="alert">这份地址对不上用户服务协议或隐私政策。本页只有这两份，不会随便挑一份给你看。</QxTouchCallout>
        </div>
        <div className="qxp-pair qxp-pair-grow">
          {DOC_LIST.map((item) => {
            const itemLoad = loads[item.key]
            const itemSections = itemLoad.status === 'ready' ? splitLegalSections(itemLoad.content) : item.sections
            return (
              <PairCard
                key={item.key}
                testId={`legal-pick-${item.key}`}
                title={item.title}
                desc={`${item.summary}（共 ${itemSections.length} 章）`}
                art={item.key === 'terms' ? <IllusChecklist w={200} /> : <IllusStack w={200} n={3} />}
                onClick={() => switchDoc(item.key)}
              />
            )
          })}
        </div>
        <Note>这一页不影响你办事。已经创建的打印任务、订单和到机码都不受影响，可以直接返回继续办原来的事。</Note>
      </>
    )
    dock = backOnly
  } else if (view === 'loading') {
    status = { tone: 'unknown', label: '正在读取' }
    title = `正在读取《${meta.title}》`
    sub = '取到之前不显示条款。'
    body = (
      <>
        <DocTabs docs={DOC_LIST} active={meta.key} onSwitch={switchDoc} />
        <Card className="legal-doc-slot">
          <K>正在读取</K>
          <div className="legal-doc-sk" aria-hidden="true">
            <i /><i style={{ width: '72%' }} /><i /><i style={{ width: '48%' }} />
          </div>
        </Card>
        <Note>取到之前，这里不显示条款，也不拿旧文本或示意文字先顶上。</Note>
      </>
    )
    dock = <QxTouchDock onBack={goBack} backLabel={backLabel} className="legal-doc-cta" primary={{ label: '正在读取', kind: 'pri', noArrow: true, disabled: true, onClick: () => undefined, testId: 'legal-primary' }} />
  } else if (view === 'error') {
    status = { tone: 'bad', label: '正文没取回' }
    title = `这次没能把《${meta.title}》的正文取回来`
    sub = '留存文本不是正式版本，要点开才看。'
    body = (
      <>
        <div data-testid="legal-fallback" role="status">
          <QxTouchCallout kind="howto" icon="alert">这次没能把《{meta.title}》的正文取回来。留存文本不是正式版本。</QxTouchCallout>
        </div>
        <div className="qxp-col">
          <Hit title="重新读取" sub="再取一次正文" testId="legal-retry" onClick={() => retry(meta.key)} />
          <Hit title="看本机留存文本（非正式版本）" sub="不是最新正式版本" testId="legal-local-text" onClick={() => setLocalOptIn((prev) => ({ ...prev, [meta.key]: true }))} />
          <Hit title={`改看《${other.title}》`} testId="legal-switch" onClick={() => switchDoc(other.key)} />
        </div>
        <Card className="legal-doc-slot">
          <Note>取回之前，这里不显示条款。读不到条款不改变已经生效的条款，也不影响你已经创建的任务。</Note>
          <ArtBox><IllusChecklist w={200} /></ArtBox>
        </Card>
        {phoneLine ? <QxTouchCallout kind="remind">{phoneLine}</QxTouchCallout> : null}
      </>
    )
    dock = <QxTouchDock onBack={goBack} backLabel={backLabel} className="legal-doc-cta" primary={{ label: '重新读取', kind: 'pri', noArrow: true, onClick: () => retry(meta.key), testId: 'legal-primary' }} />
  } else {
    // 现行版本与本机留存文本共用阅读版式；留存文本必须和正式版一眼可分。
    const fallback = view === 'fallback'
    const optedIn = docLoad?.status === 'error'
    const served = docLoad?.status === 'ready' ? docLoad : null
    const publishedAt = formatPublishedAt(served?.publishedAt ?? null)
    status = fallback ? { tone: 'warn', label: '不是最新正式版本' } : { tone: 'ok', label: '可以阅读' }
    sub = fallback ? '这是这台机器上留着的文本，不是最新正式版本。' : '点左边的章节阅读。'
    body = (
      <>
        <DocTabs docs={DOC_LIST} active={meta.key} onSwitch={switchDoc} />
        {fallback ? (
          <div className="legal-doc-state" data-kind="warn" role="status" data-testid="legal-doc-fallback-warning">
            <QxTouchCallout kind="howto" icon="alert">本机留存文本，不作为正式版本。当前无法读取正式版本，以下是这台机器上留着的说明，可以稍后重新读取。</QxTouchCallout>
          </div>
        ) : null}
        <div className="legal-doc-bar">
          <p className="qxp-note legal-doc-meta">
            {sections.length > 1 ? `共 ${sections.length} 章` : '全文未分章节'}
            {fallback
              ? <> · 本机留存文本 · 更新日期 <b>{FALLBACK_UPDATED_AT}</b></>
              : <> · 更新日期：<b>{publishedAt ?? '发布记录未给出'}</b>{served?.version ? <> · 版本：<b>{served.version}</b></> : null}</>}
          </p>
          {fontTools}
        </div>
        <LegalReader sections={sections} active={activeChapter} onSelect={selectChapter} fontPercent={fontPercent} bodyRef={bodyRef} />
        <p className="qxp-note legal-doc-which" data-disclaimer="true" data-testid="legal-truth">
          {fallback
            ? '这是这台机器上留着的文本，不是最新正式版本，不作为正式版本；正文没取到时不拿它去讲。'
            : '以运营方正式发布的版本为准。本机显示的更新日期来自发布记录，不由本页写死。'}
        </p>
      </>
    )
    const ask = fallback
      ? ({ label: '看不懂这一章', disabled: true, testId: 'legal-ai-explain' } as const)
      : ({ label: '问小青：看不懂这一章', draft: `《${meta.title}》里「${sections[activeChapter]?.title ?? ''}」这一章我没看懂，请只做通俗转述，不要给法律结论。`, voice: true, testId: 'legal-ai-explain' } as const)
    dock = fallback ? (
      <QxTouchDock
        onBack={goBack}
        backLabel={backLabel}
        className="legal-doc-cta"
        ask={ask}
        primary={{ label: optedIn ? '重新读取' : `去读${other.title}`, kind: 'pri', noArrow: true, onClick: () => (optedIn ? retry(meta.key) : switchDoc(other.key)), testId: 'legal-primary' }}
      />
    ) : (
      <QxTouchDock onBack={goBack} backLabel={backLabel} className="legal-doc-cta" ask={ask} />
    )
  }

  return (
    <div
      className="fusion-w5 fusion-w5--system service-desk k1-legal-doc"
      data-kiosk-screen="legal-doc"
      data-kiosk-presentation="fusion-youth"
      data-visual-theme="service-desk"
      data-ux-density="touch"
      data-state={view}
    >
      <KioskStageFit enabled={!fluid}>
        <PublicTouchFrame
          page="legal"
          title={title}
          eyebrow="协议与政策"
          sub={sub}
          status={status}
          back={{ label: backLabel, onBack: goBack }}
          nav={false}
          dock={dock}
        >
          <div className="legal-doc-scroll" data-testid={`legal-state-${view}`}>{body}</div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
