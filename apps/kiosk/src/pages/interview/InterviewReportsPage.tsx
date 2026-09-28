// ============================================================
// 面试报告 — 历史练习记录入口（2C）。
//
// 登录会员：真实列表（/me/mock-interviews，游标分页）+ 查看 / 删除（两步确认）。
// 游客：诚实空态 + 引导（匿名报告短期有效，不做跨会话列表）。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import type { MemberInterviewItem } from '@ai-job-print/shared'
import { LogInIcon } from 'lucide-react'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { deleteMyInterview, getMyInterviews } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { InterviewShell } from './InterviewShell'
import { InterviewCardHead, InterviewNotice, InterviewRail, InterviewStatus } from './interviewQxParts'
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
      title={isLoggedIn
        ? <>登录后，<em>只查看自己的报告</em>。</>
        : <>你的练习记录，<em>登录后才可长期查看</em>。</>}
      subtitle={copy.subtitle}
      ctabar={
        <div className="interview-qx-cta">
          <QxStepActions onPrev={() => onGoStage ? onGoStage('tips') : navigate('/interview/tips')} prevLabel="先看面试技巧">
            <QxAiHelp label="问小青：练习记录在哪里" draft="我想查看自己的模拟面试练习报告。请说明未登录和登录后有什么差别，不要列出别人的记录。" />
          </QxStepActions>
          <div className="iv-history-actions">
            {isLoggedIn && (
              <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/me/ai-records')}>
                AI服务记录
              </button>
            )}
            <button type="button" className="qx-btn" data-variant="primary" data-testid="interview-primary" onClick={goSetup}>
              {!isLoggedIn || items.length > 0 ? '开始新练习' : '开始模拟面试'}
            </button>
          </div>
        </div>
      }
    >
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-reports" data-qx-interview="" className="interview-flow interview-reports" data-visual-theme="service-desk" data-ux-density="touch">

      <div className="interview-flow__scroll">
        {!isLoggedIn ? (
          <>
            <section className="iv-card iv-empty">
              <div>
                <h2>登录后可保存练习报告</h2>
                <p>登录后，完成的练习报告会留在这里，方便你自己回看。</p>
              </div>
            </section>
            <section className="iv-card">
              <InterviewCardHead title="两种身份的差别" hint="按真实账号确认" />
              <div className="iv-fields">
                <div className="iv-field"><small>未登录</small><b>大约保留 2 小时</b></div>
                <div className="iv-field"><small>登录之后</small><b>本人记录保留 7 天</b></div>
              </div>
            </section>
            <section className="iv-card">
              <InterviewCardHead title="现在可以做" hint="不登录也能继续" />
              <Button size="lg" className="h-14 px-6" onClick={() => navigate('/login', { state: { from: '/interview?stage=reports' } })}>
                <LogInIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                手机号登录
              </Button>
            </section>
          </>
        ) : state === 'loading' ? (
          <>
            <InterviewStatus label="记录读取状态" items={[{ k: '本人列表', v: '读取中' }, { k: '查看报告', v: '未开放' }, { k: '删除记录', v: '未开放' }]} />
            <section className="iv-card iv-empty"><div><h2>正在读取本人练习报告</h2><p>列表返回前，这里不放示例记录。</p></div></section>
          </>
        ) : state === 'error' ? (
          <>
            <section className="iv-card iv-empty is-bad">
              <div>
                <h2>暂时无法加载练习报告</h2>
                <p>请检查网络后重试。没有拿到本人列表时，不显示任何固定历史。</p>
              </div>
            </section>
            <button type="button" className="qx-btn" data-variant="primary" onClick={() => setReloadKey((k) => k + 1)}>重试加载</button>
          </>
        ) : items.length === 0 ? (
          <>
            <section className="iv-card iv-empty">
              <div>
                <h2>还没有练习报告</h2>
                <p>完成一次模拟面试后，这里会显示属于当前账号的练习报告。</p>
              </div>
            </section>
          </>
        ) : (
          <section className="iv-card">
            <InterviewCardHead title="练习报告" hint="已登录 · 本人记录" />
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
            <InterviewNotice>删除需要再次确认。确认后才会删掉这条本人记录；失败时记录仍留在列表里。</InterviewNotice>
          </section>
        )}
        {hint && <p className="iv-alert" role="status">{hint}</p>}
        <InterviewRail />
      </div>
    </div>
    </InterviewShell>
  )
}
