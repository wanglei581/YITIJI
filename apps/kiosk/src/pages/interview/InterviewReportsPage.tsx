// ============================================================
// 面试报告 — 历史练习记录入口（2C）。
//
// 登录会员：真实列表（/me/mock-interviews，游标分页）+ 查看 / 删除（两步确认）。
// 游客：诚实空态 + 引导（匿名报告短期有效，不做跨会话列表）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberInterviewItem } from '@ai-job-print/shared'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { useSupportContact } from '../../hooks/useSupportContact'
import { deleteMyInterview, getMyInterviews } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { InterviewArt } from './InterviewArt'
import { InterviewShell } from './InterviewShell'
import { InterviewRail, InterviewStatus } from './interviewQxParts'
import { interviewUserLine } from './interviewMicCopy'
import { INTERVIEW_STAGE_COPY, type InterviewStage } from './interviewWorkbenchModel'
import { patchInterviewWorkbenchSession } from './interviewWorkbenchSession'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'

function formatTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function InterviewReportsPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberInterviewItem[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const contact = useSupportContact()
  const shownHint = interviewUserLine(hint, contact)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getMyInterviews(getToken())
      .then((r) => {
        setItems(r.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => { load() }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  const handleDelete = async (sessionId: string) => {
    if (confirmId !== sessionId) {
      setConfirmId(sessionId)
      return
    }
    setConfirmId(null)
    const token = getToken()
    if (!token) return
    try {
      await deleteMyInterview(token, sessionId)
      setItems((prev) => prev.filter((x) => x.sessionId !== sessionId))
      setHint('练习记录已删除')
    } catch {
      setHint('删除失败，请稍后重试')
    }
  }

  const copy = INTERVIEW_STAGE_COPY.reports
  const primaryLabel = isLoggedIn && state === 'ready' && items.length === 0 ? '开始模拟面试' : '开始新练习'
  const goTips = () => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))
  const goSetup = () => {
    patchInterviewWorkbenchSession({ stage: 'setup' })
    if (onGoStage) onGoStage('setup')
    else navigate('/interview/setup')
  }
  const openReport = (sessionId: string) => {
    patchInterviewWorkbenchSession({ stage: 'report', report: { sessionId } })
    if (onGoStage) onGoStage('report')
    else navigate('/interview/report', { state: { sessionId } })
  }

  return (
    <InterviewShell
      eyebrow="练面试 · 练习记录"
      title={isLoggedIn ? '登录后，只查看自己的报告。' : '你的练习记录，登录后才可长期查看。'}
      subtitle={isLoggedIn && state === 'error' ? '没有拿到本人列表时，不显示任何固定历史。' : copy.subtitle}
      status={isLoggedIn
        ? state === 'loading'
          ? { tone: 'unknown', label: '正在读取' }
          : state === 'error'
            ? { tone: 'bad', label: '列表没有读到' }
            : { tone: 'ok', label: '本人记录' }
        : { tone: 'warn', label: '未登录' }}
      ctabar={
        <QxTouchDock
          onBack={() => navigate('/interview-service')}
          ask={{ label: '问小青：练习记录在哪里', draft: '我想查看自己的模拟面试练习报告。请说明未登录和登录后有什么差别，不要列出别人的记录。' }}
          primary={{ label: primaryLabel, onClick: goSetup, noArrow: true, testId: 'interview-primary' }}
        />
      }
    >
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-reports" data-qx-interview="" className="interview-flow interview-reports interview-state-page" data-visual-theme="service-desk" data-ux-density="touch">

      <div className="interview-flow__scroll">
        {!isLoggedIn ? (
          <>
            <div className="qxt-iv-note">
              <b>登录后可保存练习报告</b>
              <span>登录后，完成的练习报告会留在这里，方便你自己回看。</span>
            </div>
            <div className="qxt-iv-note">
              <span>未登录：大约保留 2 小时</span>
              <span>登录之后：本人记录保留 7 天</span>
              <span>现在：可以先登录</span>
            </div>
            <button type="button" className="qxt-iv-wide" onClick={() => navigate('/login', { state: { from: '/interview?stage=reports' } })}>
              <b>手机号登录</b>
              <small>登录后回到练习记录</small>
            </button>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>不登录也能看准备方法</small>
            </button>
            <InterviewArt title="未登录不列出历史">大约保留 2 小时，是这次使用期间的说明，不是已经有两场。登录之后，本人记录保留 7 天。</InterviewArt>
          </>
        ) : state === 'loading' ? (
          <>
            <InterviewStatus label="记录读取状态" items={[{ k: '本人列表', v: '读取中' }, { k: '查看报告', v: '未开放' }, { k: '删除记录', v: '未开放' }]} />
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>不依赖这份列表</small>
            </button>
            <InterviewArt title="正在读取本人练习报告">列表返回前，这里不放示例记录。没有拿到列表之前，不能查看，也不能删除。</InterviewArt>
          </>
        ) : state === 'error' ? (
          <>
            <button type="button" className="qxt-iv-wide" onClick={() => setReloadKey((k) => k + 1)}>
              <b>重试加载</b>
              <small>再读一次本人列表</small>
            </button>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>不依赖这份列表</small>
            </button>
            <InterviewArt title="暂时无法加载练习报告">请检查网络后重试。没有拿到本人列表时，不显示任何固定历史。重试只回到读取中。</InterviewArt>
          </>
        ) : items.length === 0 ? (
          <>
            <button type="button" className="qxt-iv-wide" onClick={() => navigate('/me/ai-records')}>
              <b>AI服务记录</b>
              <small>查看本人AI调用记录</small>
            </button>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>公开的准备方法</small>
            </button>
            <InterviewArt title="还没有练习报告">完成一次模拟面试后，这里会显示属于当前账号的练习报告。空列表不补示例行。</InterviewArt>
          </>
        ) : (
          <>
            <section className="iv-card">
              <h2>练习报告</h2>
              <p className="iv-copy">只有已经生成报告的记录可以查看。没有报告的记录不能当成可打印。</p>
              <div className="iv-history">
                {items.map((it) => (
                  <div key={it.sessionId} className="iv-history-row">
                    <div>
                      <small>{formatTime(it.createdAt)}</small>
                      <b>{it.position} · {it.interviewerLabel}</b>
                      <p>{it.industry} · {it.durationMin} 分钟练习</p>
                    </div>
                    <div className="iv-history-actions">
                      {it.hasReport ? (
                        <button type="button" className="is-go" onClick={() => openReport(it.sessionId)}>查看</button>
                      ) : (
                        <button type="button" aria-disabled="true">报告未生成</button>
                      )}
                      <button
                        type="button"
                        className={confirmId === it.sessionId ? 'is-remove is-confirm' : 'is-remove'}
                        aria-label={confirmId === it.sessionId ? '再次点击确认删除这条练习记录' : '删除这条练习记录'}
                        onClick={() => void handleDelete(it.sessionId)}
                      >
                        {confirmId === it.sessionId ? '再次确认删除' : '删除'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <button type="button" className="qxt-iv-wide" onClick={() => navigate('/me/ai-records')}>
              <b>AI服务记录</b>
              <small>查看本人AI调用记录</small>
            </button>
            <button type="button" className="qxt-iv-wide" onClick={goTips}>
              <b>先看面试技巧</b>
              <small>公开的准备方法</small>
            </button>
            <div className="qxt-iv-note is-fill">
              <span>已登录 · 本人记录。只有已经生成报告的记录可以查看。没有报告的记录不能当成可打印。</span>
              <span>删除需要再次确认。确认后才会删掉这条本人记录；失败时记录仍留在列表里。登录之后，本人记录保留 7 天。</span>
            </div>
            <InterviewArt title="这些记录只属于当前账号">只有已经生成报告的记录可以查看。删除需要再次确认，确认后才会删掉这条本人记录。</InterviewArt>
          </>
        )}
        {shownHint ? <p className="iv-alert" role="status">{shownHint}</p> : null}
        <InterviewRail />
      </div>
    </div>
    </InterviewShell>
  )
}
