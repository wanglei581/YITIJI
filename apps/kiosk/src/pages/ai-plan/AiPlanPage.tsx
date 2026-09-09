// 小青的作业面。只呈现顾问会话刚产出的三种产物，不编目标/材料/计划。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { HomeIcon, PrinterIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useAuth } from '../../auth/useAuth'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { userMessageOf } from '../../services/api/userErrorMessage'
import {
  getAdvisorSession,
  printAdvisorArtifact,
  type AdvisorArtifactPrintResult,
} from '../../services/api/advisor'
import { ArtifactBody, AdvisorHero, EvidenceLegend } from './AdvisorArtifactPanels'
import {
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

function isNotFound(err: unknown): boolean {
  return err instanceof ApiHttpError && (
    err.status === 404
    || err.code === 'ADVISOR_SESSION_NOT_FOUND'
    || err.code === 'ADVISOR_ARTIFACT_NOT_FOUND'
  )
}

export function AiPlanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const { getToken } = useAuth()
  const navState = (location.state ?? {}) as AdvisorArtifactLocationState

  const sessionId = parseId(search.get('sessionId')) ?? parseId(navState.sessionId)
  const artifactId = parseId(search.get('artifactId')) ?? parseId(navState.artifactId)
  const accessToken = typeof navState.accessToken === 'string' ? navState.accessToken : null
  const bootstrapPayload = parsePayload(navState.artifact)
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
  const [printReceipt, setPrintReceipt] = useState<AdvisorArtifactPrintResult | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const printLock = useRef(false)
  const requestSeq = useRef(0)

  const loadSession = useCallback(async () => {
    if (fixtureState || !sessionId) return
    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setViewState('loading')
    setPrintReceipt(null)
    setPrintError(null)
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
    } catch (err) {
      if (seq !== requestSeq.current) return
      if (isNotFound(err)) {
        setPayload(null)
        setViewState('expired')
        return
      }
      if (bootstrapPayload) {
        setPayload(bootstrapPayload)
        setViewState(deriveContentState(bootstrapPayload))
        return
      }
      setPayload(null)
      setViewState('error')
    }
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
  const showLegend = isContentState(derivedState)
  const showPrint = isContentState(derivedState) && Boolean(activeIds || fixtureState)
  const showRecords = derivedState === 'no-artifact'
  const backLabel = derivedState === 'no-artifact' ? '去问小青' : '再问一轮'

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
      setPrintReceipt(printed)
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
            <HomeIcon size={32} aria-hidden />首页
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')} aria-current="page" data-testid="advisor-artifact-nav-advisor">
            <SparklesIcon size={32} aria-hidden />问小青
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')} data-testid="advisor-artifact-nav-profile">
            <UserIcon size={32} aria-hidden />我的
          </button>
        </>
      }
      ctabar={
        <>
          <button
            type="button"
            className="qx-btn"
            data-variant="ghost"
            data-testid="advisor-artifact-cta-back"
            onClick={() => navigate('/assistant')}
          >
            {backLabel}
          </button>
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
              看我的 AI 服务记录
            </button>
          ) : null}
          {derivedState === 'print-unavailable' ? (
            <p className="why">打印能力读不到，按钮先不放出来 —— 不做点了没反应的按钮。</p>
          ) : null}
          {printReceipt ? (
            <p className="why">打印稿已生成，已保存到我的文档。还没有确认出纸。</p>
          ) : null}
          {printError ? <p className="why" role="status">{printError}</p> : null}
        </>
      }
    >
      <div
        className="aa-root qx-grow"
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
        <div className="aa-body qx-grow">
          <ArtifactBody state={derivedState} payload={payload} onRetry={() => { void loadSession() }} />
        </div>
      </div>
    </QxPageFrame>
  )
}
