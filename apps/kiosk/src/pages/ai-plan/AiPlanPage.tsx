// 小青的作业面。只呈现顾问会话刚产出的三种产物，不编目标/材料/计划。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { HomeIcon, PrinterIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { getAdvisorSession, printAdvisorArtifact } from '../../services/api/advisor'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import { ArtifactBody, AdvisorHero, EvidenceLegend } from './AdvisorArtifactPanels'
import {
  MORE_BELOW_HINT,
  copyFor,
  deriveContentState,
  fixturePayload,
  isContentState,
  isExpiredIso,
  parseId,
  parsePayload,
  parseSessionView,
  pickArtifact,
  resolveFixtureState,
  type AdvisorArtifactLocationState,
  type AdvisorArtifactPayload,
  type ArtifactViewState,
} from './advisorArtifactModel'
import './styles/advisor-artifact-qx.css'

const READ_LIMIT = 3

function isNotFound(err: unknown): boolean {
  return err instanceof ApiHttpError && (
    err.status === 404
    || err.code === 'ADVISOR_SESSION_NOT_FOUND'
    || err.code === 'ADVISOR_ARTIFACT_NOT_FOUND'
  )
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null)
  } catch {
    return ''
  }
}

export function AiPlanPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const [search] = useSearchParams()
  const { getToken } = useAuth()
  const navState = (location.state ?? {}) as AdvisorArtifactLocationState

  const sessionId = parseId(search.get('sessionId')) ?? parseId(navState.sessionId)
  const artifactId = parseId(search.get('artifactId')) ?? parseId(navState.artifactId)
  const accessToken = typeof navState.accessToken === 'string' ? navState.accessToken : null
  // 导航里的要点对象每次渲染都是新引用。只按序列化后的字符串记一份，避免读取效果跟着空转。
  const artifactKey = stableJson(navState.artifact)
  const bootstrapPayload = useMemo(() => {
    if (!artifactKey) return null
    try {
      return parsePayload(JSON.parse(artifactKey))
    } catch {
      return null
    }
  }, [artifactKey])
  const printBlockedReason = navState.printUnavailableReason?.trim() || null
  const fixtureState = useMemo(() => resolveFixtureState(search), [search])

  const [viewState, setViewState] = useState<ArtifactViewState>(fixtureState ?? (sessionId ? 'loading' : 'no-artifact'))
  const [payload, setPayload] = useState<AdvisorArtifactPayload | null>(
    fixtureState ? fixturePayload(fixtureState) : bootstrapPayload,
  )
  const [activeIds, setActiveIds] = useState<{ sessionId: string; artifactId: string } | null>(
    sessionId && artifactId ? { sessionId, artifactId } : null,
  )
  const [printBusy, setPrintBusy] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  const [readFailed, setReadFailed] = useState(false)
  const printLock = useRef(false)
  const requestSeq = useRef(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const loadSession = useCallback(async () => {
    if (fixtureState || !sessionId) return
    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setViewState('loading')
    setPrintError(null)
    setReadFailed(false)
    let missing = false
    for (let attempt = 1; attempt <= READ_LIMIT; attempt += 1) {
      try {
        const session = parseSessionView(await getAdvisorSession(sessionId, {
          token: getToken(),
          accessToken,
        }))
        if (seq !== requestSeq.current) return
        if (!session || isExpiredIso(session.expiresAt)) {
          setPayload(null)
          setViewState('expired')
          return
        }
        const artifact = pickArtifact(session, artifactId)
        if (!artifact || !artifact.payload || isExpiredIso(artifact.expiresAt)) {
          setPayload(null)
          setViewState('expired')
          return
        }
        setActiveIds({ sessionId: session.sessionId, artifactId: artifact.artifactId })
        setPayload(artifact.payload)
        setViewState(deriveContentState(artifact.payload))
        return
      } catch (err) {
        if (seq !== requestSeq.current) return
        if (isNotFound(err)) {
          missing = true
          break
        }
        if (attempt < READ_LIMIT) {
          await new Promise((resolve) => window.setTimeout(resolve, 400))
          if (seq !== requestSeq.current) return
        }
      }
    }
    if (missing) {
      setPayload(null)
      setViewState('expired')
      return
    }
    setReadFailed(true)
    if (bootstrapPayload) {
      setPayload(bootstrapPayload)
      setViewState(deriveContentState(bootstrapPayload))
      return
    }
    setPayload(null)
    setViewState('error')
  }, [accessToken, artifactId, bootstrapPayload, fixtureState, getToken, sessionId])

  useEffect(() => {
    if (fixtureState) {
      setPayload(fixturePayload(fixtureState))
      setViewState(fixtureState)
      return
    }
    if (!sessionId) {
      setPayload(null)
      setViewState('no-artifact')
      return
    }
    void loadSession()
  }, [fixtureState, loadSession, sessionId])

  const derivedState: ArtifactViewState = fixtureState
    ? fixtureState
    : (isContentState(viewState) && printBlockedReason ? 'print-unavailable' : viewState)

  const copy = copyFor(derivedState)
  const showLegend = isContentState(derivedState) || derivedState === 'print-unavailable'
  const showPrint = isContentState(derivedState) && Boolean(activeIds || fixtureState)
  const showRecords = derivedState === 'no-artifact'
  const showBack = derivedState !== 'expired'
  const showRedo = derivedState === 'expired'
  const backLabel = derivedState === 'no-artifact' || derivedState === 'loading' || derivedState === 'error'
    ? '去问小青'
    : '再问一轮'
  const reread = !fixtureState && readFailed ? (
    <button
      type="button"
      className="aa-reread"
      data-testid="advisor-artifact-reread"
      onClick={() => { void loadSession() }}
    >
      重新读取
    </button>
  ) : null
  const showStale = Boolean(reread)
    && derivedState !== 'error'
    && derivedState !== 'loading'
    && derivedState !== 'expired'
    && derivedState !== 'no-artifact'

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    let frame = 0
    let disposed = false
    const measure = () => {
      frame = 0
      setCanScrollDown(body.scrollTop + body.clientHeight < body.scrollHeight - 8)
    }
    const schedule = () => {
      if (!disposed && !frame) frame = window.requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(body)
    // 只看容器会漏掉内容变长；每次正文换态后重新观察现有区块，不加布局包装。
    for (const child of body.children) observer.observe(child)
    body.addEventListener('scroll', schedule, { passive: true })
    schedule()
    void document.fonts.ready.then(schedule)
    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      body.removeEventListener('scroll', schedule)
      observer.disconnect()
    }
  }, [derivedState, payload, showStale])

  const scrollDown = () => {
    const body = bodyRef.current
    if (!body) return
    body.scrollBy({
      top: body.clientHeight * 0.6,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  const onPrint = async () => {
    if (!showPrint || printLock.current || !activeIds) return
    printLock.current = true
    setPrintBusy(true)
    setPrintError(null)
    try {
      const printed = await printAdvisorArtifact(activeIds.sessionId, activeIds.artifactId, {
        token: getToken(),
        accessToken,
      })
      if (!printed.printFileUrl) {
        setPrintError('打印链接还没准备好，请稍后再试')
        return
      }
      // F09：生成打印稿后直接进打印链（稿 52：先看价格再决定），和其他 AI 产物同一条路。
      // 不再写「已保存到我的文档」：文件归属跟顾问会话走，游客时不属于任何人，本机说不准它存没存。
      startPrint({
        origin: 'advisor_artifact',
        returnPath: window.location.pathname,
        file: {
          name: printed.filename,
          size: printed.sizeBytes >= 1024 * 1024 ? `${(printed.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(printed.sizeBytes / 1024))} KB`,
          pages: printed.pageCount > 0 ? printed.pageCount : null,
          fileId: printed.fileId,
          fileUrl: printed.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      if (isNotFound(err)) {
        setViewState('expired')
        setPayload(null)
      } else {
        setPrintError(userMessageOf(err, '打印稿这次没有生成，请稍后再试'))
      }
    } finally {
      printLock.current = false
      setPrintBusy(false)
    }
  }

  return (
    <QxPageFrame
      /* 稿 52-advisor-artifact 原文：data-route="/assistant" aria-label="返回问小青"。 */
      back={{ label: '返回问小青', onBack: () => navigate('/assistant') }}
      title="小青的作业面"
      status={{ tone: copy.statusTone, label: copy.statusLabel }}
      terminalLabel="就业服务大厅"
      navbar={
        <>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/')} data-testid="advisor-artifact-nav-home">
            <HomeIcon size={28} aria-hidden />首页
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')} aria-current="page" data-testid="advisor-artifact-nav-advisor">
            <SparklesIcon size={28} aria-hidden />AI 顾问
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')} data-testid="advisor-artifact-nav-profile">
            <UserIcon size={28} aria-hidden />我的
          </button>
        </>
      }
      ctabar={
        <>
          {showBack ? (
            <button
              type="button"
              className="qx-btn"
              data-variant="ghost"
              data-testid="advisor-artifact-cta-back"
              onClick={() => navigate('/assistant')}
            >
              {backLabel}
            </button>
          ) : null}
          {showRedo ? (
            <button
              type="button"
              className="qx-btn aa-cta-print"
              data-variant="primary"
              data-testid="advisor-artifact-cta-redo"
              onClick={() => navigate('/assistant')}
            >
              回去重做一次
            </button>
          ) : null}
          {showPrint ? (
            <button
              type="button"
              className="qx-btn aa-cta-print"
              data-variant="primary"
              data-testid="advisor-artifact-cta-print"
              disabled={printBusy || !activeIds}
              aria-busy={printBusy || undefined}
              onClick={() => { void onPrint() }}
            >
              <PrinterIcon size={28} aria-hidden />
              {printBusy ? '正在生成打印稿…' : '打印带走'}
            </button>
          ) : null}
          {showRecords ? (
            <button
              type="button"
              className="qx-btn aa-cta-print"
              data-variant="primary"
              data-testid="advisor-artifact-cta-records"
              onClick={() => navigate('/me/ai-records')}
            >
              打开我的 AI 记录
            </button>
          ) : null}
          {derivedState === 'print-unavailable' ? (
            <p className="aa-cta-note">打印能力读不到，按钮先不放出来 —— 不做点了没反应的按钮。</p>
          ) : null}
          {printError ? <p className="aa-cta-note" role="status">{printError}</p> : null}
        </>
      }
    >
      <div
        className="aa-root"
        data-kiosk-screen="advisor-artifact"
        data-state={derivedState}
        data-testid="advisor-artifact-main"
      >
        <AdvisorHero
          heroBefore={copy.heroBefore}
          heroEm={copy.heroEm}
          heroAfter={copy.heroAfter}
          sub={copy.sub}
        />
        {showLegend ? <EvidenceLegend /> : null}
        <div className="aa-body" ref={bodyRef}>
          <ArtifactBody state={derivedState} payload={payload} stale={showStale} reread={reread} />
        </div>
        {canScrollDown && (
          <div className="aa-more-below">
            <button
              type="button"
              className="aa-more-below-button"
              data-testid="advisor-artifact-more-below"
              onClick={scrollDown}
            >
              {MORE_BELOW_HINT}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </QxPageFrame>
  )
}
