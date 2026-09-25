// ============================================================
// 用户服务协议 / 隐私政策 — /legal/:doc（整屏路由，在 KioskRoot 之外）。
//
// 2026-09-25 迁入青序稿 08-legal：文档切换 → 文档头 → 按章节读（左目录 + 右单章）→
// 「哪一版算数 / 看不懂这一章」两张卡；另有 loading / error / not-found 三态照稿。
// 页壳是 QxPageFrame；舞台缩放与 JobFitStage 同一判据（竖屏一体机缩放，窄屏 / 横屏按真实宽度排）。
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
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useKioskStageFit } from '../../hooks/useKioskStageFit'
import { API_BASE_URL } from '../../services/api'
import {
  FROM_TARGETS, formatPublishedAt, readDocLoad, readFromKey, splitLegalSections,
  type DocLoad, type Section,
} from './legalDocModel'
import {
  DocHead, DocTabs, FontTools, Glyph, LegalCard, LegalReader, LegalSec, LegalTruth, PickCard,
  ReaderSkeleton, StateBlock, type DocMeta,
} from './LegalDocViews'
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
      '本终端为公共设备：页面刷新、离开或闲置超时后将自动退出登录并清除会话信息，请勿在终端上留存个人物品与文件。',
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
      '公共设备会话信息（含登录态）在退出、闲置超时或进入待机时即刻清除。',
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
      '如对个人信息保护有任何疑问或需要协助，请联系现场工作人员或通过终端公示的运营方联系方式与我们沟通。',
      '本政策正式版本以运营方发布为准；如本页内容与正式发布版本不一致，以正式发布版本为准。',
    ],
  },
]

type DocKey = DocMeta['key']

const DOCS: Record<DocKey, DocMeta> = {
  terms: {
    key: 'terms', docType: 'terms_of_service', title: '用户服务协议', eyebrow: 'TERMS OF SERVICE', glyph: 'file', tone: 'slate',
    summary: '约定你和这台机器之间的服务关系：能办什么、要不要登录、你答应什么、AI 结果怎么算、打印怎么收费。',
    sections: TERMS_SECTIONS,
  },
  privacy: {
    key: 'privacy', docType: 'privacy_policy', title: '隐私政策', eyebrow: 'PRIVACY POLICY', glyph: 'shield', tone: 'teal',
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
  const { viewportW, viewportH } = useKioskStageFit()
  const compact = viewportW <= 760 || (viewportW <= 960 && viewportW > viewportH)
  const fluid = compact || (viewportW > 960 && viewportW > viewportH)

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
  const activeChapter = chapter.key === chapterKey && chapter.index < sections.length ? chapter.index : 0

  // 返回：有站内上一页就回上一页（进来的那一页）；来路不明时回受控来源或首页，不接受任意路径。
  const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0
  const fromTarget = fromKey ? FROM_TARGETS[fromKey] : null
  const backLabel = fromTarget?.label ?? (historyIndex > 0 ? '返回上一页' : '返回首页')
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
  const reader = (
    <LegalSec no="01" title="按章节读" hint={sections.length > 1 ? '点左边换一章' : '全文未分章节'} aside={fontTools}>
      <LegalReader sections={sections} active={activeChapter} onSelect={selectChapter} fontPercent={fontPercent} bodyRef={bodyRef} />
    </LegalSec>
  )

  let status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  let body: ReactNode
  let primary: ReactNode

  if (!meta || view === 'not-found') {
    status = { tone: 'warn', label: '没有这份文档' }
    body = (
      <>
        <LegalSec>
          <StateBlock kind="warn" glyph="warn" title="没有这份文档" testId="legal-fallback">
            <p className="legal-doc-state-p">地址里指的这份文档<b>不在本机的受控清单里</b>。本页只有下面两份，<b>不会随便挑一份给你看</b> —— 拿错文档比看不到更麻烦。</p>
            <p className="legal-doc-state-p">你之前在读的那一份<b>没有被改动</b>；点下面任意一份即可继续。</p>
          </StateBlock>
        </LegalSec>
        <LegalSec no="01" title="本机只有这两份" hint="点一份开始读">
          <div className="legal-doc-bigpick">
            {DOC_LIST.map((item) => {
              const itemLoad = loads[item.key]
              const itemSections = itemLoad.status === 'ready' ? splitLegalSections(itemLoad.content) : item.sections
              return <PickCard key={item.key} doc={item} sections={itemSections} onPick={() => switchDoc(item.key)} />
            })}
          </div>
        </LegalSec>
        <LegalSec>
          <div className="legal-doc-grid3">
            <LegalCard tone="wheat" glyph="info" title="为什么不默认给一份">
              <p>协议和隐私政策<b>不是同一份</b>。地址不对时默认打开其中一份，你可能一直在读另一份还以为读对了。</p>
            </LegalCard>
            <LegalCard tone="slate" glyph="info" title="读完回哪里">
              <p>左上角和下面的返回按钮，会回到<b>你进来的那一页</b>；来路不明时统一回首页，不会把你甩到别处。</p>
            </LegalCard>
            <LegalCard tone="teal" glyph="desk" title="要找别的文件">
              <p>屏幕上只提供这两份。其他材料请找<b>现场工作人员</b>，或按运营方公示的方式联系。</p>
            </LegalCard>
          </div>
        </LegalSec>
        <LegalSec>
          <StateBlock kind="warn" glyph="info" title="这一页不影响你办事">
            <p className="legal-doc-state-p">协议页只是阅读入口。<b>已经创建的打印任务、订单和到机码都不受影响</b>，你可以直接返回继续办原来的事。</p>
          </StateBlock>
        </LegalSec>
      </>
    )
    primary = (
      <button type="button" className="legal-doc-btn is-primary" data-testid="legal-primary" onClick={() => switchDoc('terms')}>
        读用户服务协议
      </button>
    )
  } else if (view === 'loading') {
    status = { tone: 'unknown', label: '正在取正文' }
    body = (
      <>
        <LegalSec><DocTabs docs={DOC_LIST} active={meta.key} onSwitch={switchDoc} /></LegalSec>
        <LegalSec>
          <DocHead doc={meta} meta={<span>正在取正文，<b>取到之前不显示任何条款</b></span>} />
        </LegalSec>
        <LegalSec no="01" title="正在取正文" hint="槽位，不是内容"><ReaderSkeleton /></LegalSec>
        <LegalSec>
          <StateBlock kind="warn" glyph="clock" title="为什么不先显示点什么" live>
            <p className="legal-doc-state-p">法律文本<b>不能拿旧版本或示意文字先顶上</b>：你会以为自己读到了现行条款。所以取到之前这里只放槽位。</p>
            <p className="legal-doc-state-p">取不到会明确告诉你取不到，并给一个重试入口。</p>
          </StateBlock>
        </LegalSec>
      </>
    )
    primary = <button type="button" className="legal-doc-btn" data-testid="legal-primary" disabled>正在取正文…</button>
  } else if (view === 'error') {
    status = { tone: 'bad', label: '正文没取到' }
    body = (
      <>
        <LegalSec><DocTabs docs={DOC_LIST} active={meta.key} onSwitch={switchDoc} /></LegalSec>
        <LegalSec>
          <StateBlock kind="error" glyph="warn" title="正文没取到" testId="legal-fallback" live>
            <p className="legal-doc-state-p">这次没能把《{meta.title}》的正文取回来。<b>这里不会拿旧文本或示意文字顶上</b> —— 本机留存文本只在你点开时显示，并标明它不是正式版本。</p>
            <p className="legal-doc-state-p">这不影响你继续用这台机器；只是<b>暂时读不到这份文档</b>。</p>
          </StateBlock>
        </LegalSec>
        <LegalSec no="01" title="可以这样做" hint="三条都不用等">
          <div className="legal-doc-grid2">
            <LegalCard tone="wheat" glyph="refresh" title="再取一次">
              <p>多数是一次性的网络波动，<b>重试一下</b>通常就能读到。</p>
              <button type="button" className="legal-doc-inbtn" data-testid="legal-retry" onClick={() => retry(meta.key)}>
                重新取正文<Glyph name="arrow" size={22} />
              </button>
            </LegalCard>
            <LegalCard tone="teal" glyph="desk" title="现在就要看">
              <p>找<b>现场工作人员</b>索取现行版本，或按运营方公示的方式联系。</p>
              <p className="fine">屏幕这边不会替你转达，也不会自动记录这次读取失败。</p>
              <button type="button" className="legal-doc-inbtn is-ghost" data-testid="legal-local-text"
                      onClick={() => setLocalOptIn((prev) => ({ ...prev, [meta.key]: true }))}>
                看本机留存文本（非正式版本）
              </button>
            </LegalCard>
          </div>
          <div className="legal-doc-grid2">
            <LegalCard tone="slate" glyph="file" title="换一份试试">
              <p>两份文档<b>分别取</b>。这一份取不到，另一份不一定也取不到。</p>
              <button type="button" className="legal-doc-inbtn" data-testid="legal-switch" onClick={() => switchDoc(other.key)}>
                去取{other.title}<Glyph name="arrow" size={22} />
              </button>
            </LegalCard>
            <LegalCard tone="wheat" glyph="info" title="要不要紧">
              <p>读不到条款<b>不改变已经生效的条款</b>，也不影响你已经创建的任务；它只是这次没显示出来。</p>
            </LegalCard>
          </div>
        </LegalSec>
        <LegalSec>
          <StateBlock kind="warn" glyph="clock" title="什么时候能读到">
            <p className="legal-doc-state-p">屏幕上<b>不预告恢复时间</b>，也不会替你上报这次失败。要现在就看到现行版本，请找现场工作人员索取。</p>
          </StateBlock>
        </LegalSec>
      </>
    )
    primary = (
      <button type="button" className="legal-doc-btn is-primary" data-testid="legal-primary" onClick={() => retry(meta.key)}>
        <Glyph name="refresh" size={26} />重新取正文
      </button>
    )
  } else if (view === 'fallback') {
    // 本机留存文本：只在「服务端尚无激活版本」或「取不到且用户点开」时出现，必须和正式版一眼可分。
    const optedIn = docLoad?.status === 'error'
    status = { tone: 'warn', label: '本机留存文本' }
    body = (
      <>
        <LegalSec><DocTabs docs={DOC_LIST} active={meta.key} onSwitch={switchDoc} /></LegalSec>
        <LegalSec>
          <div className="legal-doc-state is-compact" data-kind="warn" role="status" data-testid="legal-doc-fallback-warning">
            <h2 className="legal-doc-state-h"><Glyph name="warn" size={28} />本机留存文本，不作为正式版本</h2>
            <p className="legal-doc-state-p">
              当前无法读取正式版本，以下为本机留存的说明文本，<strong>不作为正式版本</strong>。请稍后重试，或向现场工作人员索取正式文本。
            </p>
          </div>
        </LegalSec>
        <LegalSec>
          <DocHead doc={meta} meta={<><span>共 {sections.length} 章</span><span>本机留存文本 · 更新日期 <b>{FALLBACK_UPDATED_AT}</b></span></>} />
        </LegalSec>
        {reader}
        <LegalSec>
          <div className="legal-doc-grid2">
            <LegalCard tone="wheat" glyph="info" title="哪一版算数">
              <p>本文本为本机留存的试运营文本，正式运营前以运营方法务审定发布的版本为准；如有疑问可咨询现场工作人员。</p>
            </LegalCard>
            <LegalCard tone="plum" glyph="spark" title="看不懂这一章">
              <p className="fine">AI 顾问只转述运营方发布的正文。<b>正文没取到时这个入口先关着</b>，不拿留存文本去讲。</p>
              <button type="button" className="legal-doc-inbtn" data-testid="legal-ai-explain" disabled>去问 AI 顾问</button>
            </LegalCard>
          </div>
        </LegalSec>
      </>
    )
    primary = optedIn ? (
      <button type="button" className="legal-doc-btn is-primary" data-testid="legal-primary" onClick={() => retry(meta.key)}>
        <Glyph name="refresh" size={26} />重新取正文
      </button>
    ) : (
      <button type="button" className="legal-doc-btn is-primary" data-testid="legal-primary" onClick={() => switchDoc(other.key)}>
        去读{other.title}
      </button>
    )
  } else {
    const served = docLoad?.status === 'ready' ? docLoad : null
    const publishedAt = formatPublishedAt(served?.publishedAt ?? null)
    status = { tone: 'ok', label: '现行版本' }
    body = (
      <>
        <LegalSec><DocTabs docs={DOC_LIST} active={meta.key} onSwitch={switchDoc} /></LegalSec>
        <LegalSec>
          <DocHead
            doc={meta}
            meta={(
              <>
                <span>{sections.length > 1 ? `共 ${sections.length} 章` : '全文未分章节'}</span>
                <span>更新日期：<b>{publishedAt ?? '发布记录未给出'}</b></span>
                {served?.version ? <span>版本：<b>{served.version}</b></span> : null}
              </>
            )}
          />
        </LegalSec>
        {reader}
        <LegalSec>
          <div className="legal-doc-grid2">
            <LegalCard tone="wheat" glyph="info" title="哪一版算数">
              <p>以<b>运营方正式发布</b>的版本为准。本机显示的更新日期来自发布记录，不由本页写死。</p>
              <p className="fine">以上为运营方当前发布的有效版本；如有疑问可咨询现场工作人员。</p>
            </LegalCard>
            <LegalCard tone="plum" glyph="spark" title="看不懂这一章">
              <p className="fine">AI 顾问只做<b>通俗转述</b>：不改条款效力，不构成法律结论，也不判定你符不符合某一条。本页不会把正文自动发过去，到那边说出想问的章节即可。</p>
              <button type="button" className="legal-doc-inbtn" data-testid="legal-ai-explain" onClick={() => navigate('/assistant')}>
                去问 AI 顾问<Glyph name="arrow" size={22} />
              </button>
            </LegalCard>
          </div>
        </LegalSec>
      </>
    )
    primary = (
      <button type="button" className="legal-doc-btn is-primary" data-testid="legal-primary" onClick={() => switchDoc(other.key)}>
        去读{other.title}
      </button>
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
        <QxPageFrame
          title="协议与隐私"
          status={status}
          back={{ label: backLabel, onBack: goBack }}
          ctabar={(
            <>
              <div className="legal-doc-cta">
                <button type="button" className="legal-doc-btn" onClick={goBack}>{backLabel}</button>
                {primary}
              </div>
              <LegalTruth />
            </>
          )}
        >
          <div className="legal-doc-scroll" data-testid={`legal-state-${view}`}>{body}</div>
        </QxPageFrame>
      </KioskStageFit>
    </div>
  )
}
