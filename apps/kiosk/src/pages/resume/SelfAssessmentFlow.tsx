// ============================================================
// 自我探索 · 倾向参考 —— 测评流程（v1）
//
// 合规（与 CLAUDE.md §11 / 18 / docs/compliance/compliance-boundary.md §4.5 同档）：
// - 工具性质说明：非临床 / 非诊断 / 本人自助参考；不沿用 MBTI / 大五 / DISC / 霍兰德标签
// - 答案原文不入库：仅存 SHA-256(answers JSON)
// - 不向企业 / 合作机构 / Partner / Admin 推送结果
// - 闲置 60 秒自动退出（公共一体机）
// - 同意 / 撤回 / 删除只在结果页主行动区显式操作
// - 闲置恢复：写 sessionStorage 让回到页面时能恢复进度
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import type {
  SelfAssessmentAnswerV1,
  SelfAssessmentDimensionKey,
  SelfAssessmentDimensionResult,
  SelfAssessmentQuestionsV1,
  SelfAssessmentSubmitResponse,
} from '@ai-job-print/shared'
import { SELF_ASSESSMENT_DIMENSIONS, SELF_ASSESSMENT_QUESTIONS_V1 } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileWarningIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  SelfAssessmentApiError,
  printSelfAssessment,
  submitSelfAssessment,
  withdrawSelfAssessment,
} from '../../services/api/selfAssessment'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import './self-assessment-lightflow.css'

/**
 * 顶级路由的全屏壳 + PageFrame 组合，使 <main> 出现在 KioskFullscreenShell 内
 * （不在 KioskLayout 的 <main> 里嵌套），同时携带 kiosk-shell 主题属性。
 */
function SelfAssessmentFullscreenFrame({ children }: { children: ReactNode }) {
  return (
    <KioskFullscreenShell>
      <KioskPageFrame className="self-assessment-shell">{children}</KioskPageFrame>
    </KioskFullscreenShell>
  )
}

const SESSION_STORAGE_KEY = 'self_assessment_session_v1'
const IDLE_TIMEOUT_MS = 60_000

interface SelfAssessmentSession {
  answers: Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>
  consent: { nonSensitive: boolean; sensitive: boolean }
  taskId?: string
  accessToken?: string
  result?: SelfAssessmentSubmitResponse
}

function loadSession(): SelfAssessmentSession {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return { answers: {}, consent: { nonSensitive: false, sensitive: false } }
    return JSON.parse(raw) as SelfAssessmentSession
  } catch {
    return { answers: {}, consent: { nonSensitive: false, sensitive: false } }
  }
}

function saveSession(s: SelfAssessmentSession): void {
  try { sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

function clearSession(): void {
  try { sessionStorage.removeItem(SESSION_STORAGE_KEY) } catch { /* ignore */ }
}

function flattenAnswers(map: Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>): SelfAssessmentAnswerV1[] {
  const out: SelfAssessmentAnswerV1[] = []
  for (const dim of Object.keys(map) as SelfAssessmentDimensionKey[]) {
    const sub = map[dim] ?? {}
    for (const idx of Object.keys(sub)) out.push({ dim, idx: Number(idx), choice: sub[Number(idx)] ?? '' })
  }
  return out
}

function progress(questions: SelfAssessmentQuestionsV1, answers: Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>): { done: number; total: number } {
  const total = questions.dimensions.reduce((acc, d) => acc + d.questions.length, 0)
  let done = 0
  for (const dim of questions.dimensions) {
    for (const q of dim.questions) {
      if (answers[dim.key]?.[q.idx]) done += 1
    }
  }
  return { done, total }
}

// ============================================================
// 1) 同意页
// ============================================================
export function SelfAssessmentIntroPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  const [consent, setConsent] = useState(session.consent)
  const start = useCallback(() => {
    if (!consent.nonSensitive) return
    const next: SelfAssessmentSession = { ...session, consent, answers: {} }
    saveSession(next)
    navigate('/resume/self-assessment/questions')
  }, [consent, navigate, session])
  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-intro" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--intro flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description="非临床 · 本人自助参考" />
      <div className="self-assessment-lightflow__content">
        <ComplianceBanner tone="info" title="工具性质说明">
          <ol>
            <li>本工具基于本人作答提供倾向参考，不是临床 / 心理 / 人格诊断。</li>
            <li>结果对本人可见，不向企业、合作机构、第三方推送。</li>
            <li>作答后可在结果页一键撤回 / 物理删除；不留存本人答案原文。</li>
            <li>本工具不评估「适合 / 不适合」任何岗位或职业，亦不构成能力证明。</li>
          </ol>
        </ComplianceBanner>
        <Card className="self-assessment-lightflow__consent">
          <label>
            <input
              type="checkbox"
              checked={consent.nonSensitive}
              onChange={(e) => setConsent({ ...consent, nonSensitive: e.target.checked })}
            />
            <span>我已了解上述说明，并同意开始作答（必勾选）</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent.sensitive}
              onChange={(e) => setConsent({ ...consent, sensitive: e.target.checked })}
            />
            <span>同意作答涉及偏好 / 风格的题目（可选）</span>
          </label>
        </Card>
        <div className="self-assessment-lightflow__actions">
          <Button onClick={() => navigate(-1)} variant="ghost">返回</Button>
          <Button onClick={start} disabled={!consent.nonSensitive}>
            开始作答 <ArrowRightIcon />
          </Button>
        </div>
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}

// ============================================================
// 2) 答题页
// ============================================================
export function SelfAssessmentQuizPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const session = useMemo(() => loadSession(), [])
  const [answers, setAnswers] = useState<Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>>(session.answers)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ dim: SelfAssessmentDimensionKey; idx: number }>(() => {
    const d = SELF_ASSESSMENT_QUESTIONS_V1.dimensions[0]
    return { dim: d.key, idx: d.questions[0].idx }
  })
  const idleTimer = useRef<number | null>(null)
  useBusyLock(submitting)

  useEffect(() => { saveSession({ ...session, answers }) }, [answers, session])

  // 闲置 60 秒自动退出
  const resetIdle = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      clearSession()
      navigate('/')
    }, IDLE_TIMEOUT_MS)
  }, [navigate])
  useEffect(() => {
    resetIdle()
    const onTick = () => resetIdle()
    window.addEventListener('pointerdown', onTick)
    window.addEventListener('keydown', onTick)
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      window.removeEventListener('pointerdown', onTick)
      window.removeEventListener('keydown', onTick)
    }
  }, [resetIdle])

  const { done, total } = progress(SELF_ASSESSMENT_QUESTIONS_V1, answers)
  const dim = SELF_ASSESSMENT_DIMENSIONS.find((d) => d.key === cursor.dim)!
  const q = SELF_ASSESSMENT_QUESTIONS_V1.dimensions.find((d) => d.key === cursor.dim)!.questions.find((qq) => qq.idx === cursor.idx)!

  const pick = (choiceKey: string) => {
    setAnswers((prev) => ({
      ...prev,
      [cursor.dim]: { ...(prev[cursor.dim] ?? {}), [cursor.idx]: choiceKey },
    }))
    // 自动前进
    const dimDef = SELF_ASSESSMENT_QUESTIONS_V1.dimensions.find((d) => d.key === cursor.dim)!
    const lastIdx = dimDef.questions.length - 1
    if (cursor.idx < lastIdx) {
      setCursor({ dim: cursor.dim, idx: cursor.idx + 1 })
    } else {
      const dimIndex = SELF_ASSESSMENT_QUESTIONS_V1.dimensions.findIndex((d) => d.key === cursor.dim)
      if (dimIndex < SELF_ASSESSMENT_QUESTIONS_V1.dimensions.length - 1) {
        const nextDim = SELF_ASSESSMENT_QUESTIONS_V1.dimensions[dimIndex + 1]
        setCursor({ dim: nextDim.key, idx: nextDim.questions[0].idx })
      }
    }
  }

  const submit = async () => {
    if (done < total) return
    setSubmitting(true)
    setError(null)
    try {
      const flat = flattenAnswers(answers)
      const result = await submitSelfAssessment(
        { answers: flat, consent: { nonSensitive: true, sensitive: session.consent.sensitive } },
        { token: getToken(), accessToken: session.accessToken },
      )
      const next: SelfAssessmentSession = {
        ...session,
        answers,
        taskId: result.taskId,
        accessToken: result.accessToken ?? session.accessToken,
        result,
      }
      saveSession(next)
      navigate('/resume/self-assessment/result')
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-quiz" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--quiz flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description={`进度 ${done}/${total}`} />
      <div className="self-assessment-lightflow__content">
        <div className="self-assessment-lightflow__progress" aria-hidden="true">
          <span style={{ width: `${Math.round((done / total) * 100)}%` }} />
        </div>
        <Card className="self-assessment-lightflow__question">
          <header>
            <span className="self-assessment-lightflow__dim">{dim.label}</span>
            <span className="self-assessment-lightflow__counter">{done + 1}/{total}</span>
          </header>
          <p>{q.prompt}</p>
          <div className="self-assessment-lightflow__choices">
            {q.choices.map((c) => {
              const selected = answers[cursor.dim]?.[cursor.idx] === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  className={selected ? 'is-selected' : ''}
                  onClick={() => pick(c.key)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </Card>
        {error && <ComplianceBanner tone="warning" title="提交失败">{error}</ComplianceBanner>}
        <div className="self-assessment-lightflow__actions">
          <Button
            variant="ghost"
            onClick={() => {
              if (cursor.idx > 0) setCursor({ dim: cursor.dim, idx: cursor.idx - 1 })
              else {
                const dimIndex = SELF_ASSESSMENT_QUESTIONS_V1.dimensions.findIndex((d) => d.key === cursor.dim)
                if (dimIndex > 0) {
                  const prevDim = SELF_ASSESSMENT_QUESTIONS_V1.dimensions[dimIndex - 1]
                  setCursor({ dim: prevDim.key, idx: prevDim.questions.length - 1 })
                }
              }
            }}
          ><ChevronLeftIcon /> 上一题</Button>
          <Button onClick={submit} disabled={done < total || submitting}>
            {submitting ? '提交中…' : '提交作答'} <ArrowRightIcon />
          </Button>
        </div>
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}

// ============================================================
// 3) 结果页
// ============================================================
export function SelfAssessmentResultPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const session = useMemo(() => loadSession(), [])
  const result = session.result
  const taskId = session.taskId ?? result?.taskId
  const [printing, setPrinting] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [printed, setPrinted] = useState<{ fileId: string; signedUrl: string; filename: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useBusyLock(printing || withdrawing)

  if (!result || !taskId) {
    return (
      <SelfAssessmentFullscreenFrame>
        <main data-kiosk-screen="resume-self-assessment-result" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--result flex h-full flex-col">
        <KioskPageHeader title="自我探索 · 倾向参考" description="无最近结果" />
        <div className="self-assessment-lightflow__content">
          <ComplianceBanner tone="info" title="暂无最近结果">
            请先完成作答；结果只在本机保留 24 小时，过期会自动清理。
          </ComplianceBanner>
          <Button onClick={() => navigate('/resume/self-assessment/intro')}>开始作答</Button>
        </div>
        </main>
      </SelfAssessmentFullscreenFrame>
    )
  }

  const handlePrint = async () => {
    setPrinting(true)
    setError(null)
    try {
      const file = await printSelfAssessment(taskId, { token: getToken(), accessToken: session.accessToken })
      setPrinted({
        fileId: file.fileId,
        signedUrl: file.signedUrl,
        filename: file.filename,
      })
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '打印文件生成失败')
    } finally {
      setPrinting(false)
    }
  }

  const handleWithdraw = async () => {
    if (!confirm('本次自我探索将被物理删除，结果不可恢复。是否继续？')) return
    setWithdrawing(true)
    setError(null)
    try {
      await withdrawSelfAssessment(taskId, { token: getToken(), accessToken: session.accessToken })
      clearSession()
      navigate('/')
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '撤回失败')
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-result" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--result flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description="仅供本人参考" />
      <div className="self-assessment-lightflow__content">
        <ComplianceBanner tone="info" title="合规说明">
          本结果基于本人作答的 5 维度倾向，不含临床 / 心理 / 人格诊断；
          不代任何招聘结果、能力证明或心理评估；仅本人可见。
        </ComplianceBanner>
        <SummaryCard result={result} />
        <DimensionsGrid result={result} />
        {error && <ComplianceBanner tone="warning" title="操作失败">{error}</ComplianceBanner>}
        <div className="self-assessment-lightflow__actions">
          <Button variant="ghost" onClick={() => navigate('/resume/self-assessment/history')}>查看历史</Button>
          <Button onClick={handlePrint} disabled={printing}>
            {printing ? '生成 PDF 中…' : '下载 PDF'} <DownloadIcon />
          </Button>
          <Button onClick={handleWithdraw} variant="danger" disabled={withdrawing}>
            {withdrawing ? '撤回中…' : '撤回本次探索'} <Trash2Icon />
          </Button>
        </div>
        {printed && (
          <Card className="self-assessment-lightflow__print-card">
            <FileWarningIcon aria-hidden="true" />
            <p>PDF 已生成：{printed.filename}</p>
            <a href={printed.signedUrl} target="_blank" rel="noopener noreferrer">下载 PDF</a>
          </Card>
        )}
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}

function SummaryCard({ result }: { result: SelfAssessmentSubmitResponse }) {
  return (
    <Card className="self-assessment-lightflow__summary">
      <header>
        <ShieldCheckIcon aria-hidden="true" />
        <h2>整体解读</h2>
      </header>
      {result.summary ? (
        <p>{result.summary}</p>
      ) : (
        <p className="self-assessment-lightflow__muted">本次整体解读未生成（受合规要求被拒或未启用）。</p>
      )}
    </Card>
  )
}

function DimensionsGrid({ result }: { result: SelfAssessmentSubmitResponse }) {
  return (
    <div className="self-assessment-lightflow__grid">
      {result.dimensions.map((d) => (
        <DimensionCard key={d.key} d={d} />
      ))}
    </div>
  )
}

function DimensionCard({ d }: { d: SelfAssessmentDimensionResult }) {
  return (
    <Card className="self-assessment-lightflow__dim-card">
      <header>
        <h3>{d.label}</h3>
        <span className="self-assessment-lightflow__strength">强度 {d.strength}/5</span>
      </header>
      {d.note ? (
        <p>{d.note}</p>
      ) : (
        <p className="self-assessment-lightflow__muted">本次维度解读未生成。</p>
      )}
      <footer>
        <small>本解读仅描述本次作答的倾向，不构成能力评价或职业推荐。</small>
      </footer>
    </Card>
  )
}

// ============================================================
// 4) 历史页（会员本人；匿名无库）
// ============================================================
export function SelfAssessmentHistoryPage() {
  const navigate = useNavigate()
  const [history, setHistory] = useState<SelfAssessmentSubmitResponse[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 匿名 session 没有持久化历史（仅会话内存），告知用户到「我的 → AI 服务记录」查看。
    setLoading(false)
    setHistory([])
  }, [])

  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-history" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--history flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description="历史" />
      <div className="self-assessment-lightflow__content">
        <ComplianceBanner tone="info" title="历史与权限">
          匿名会话不留库，会话退出后历史自动清理；会员本人历史可在「我的 → AI 服务记录 → 自我探索」查看与管理。
        </ComplianceBanner>
        {loading && <p>加载中…</p>}
        {history && history.length === 0 && (
          <p className="self-assessment-lightflow__muted">当前会话暂无历史。</p>
        )}
        <div className="self-assessment-lightflow__actions">
          <Button variant="ghost" onClick={() => navigate(-1)}>返回</Button>
          <Button onClick={() => navigate('/me/ai-records')}>前往 AI 服务记录</Button>
        </div>
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}
