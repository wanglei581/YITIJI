import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTile } from '../../../components/qingxu/touch/QxTouchTile'
import type { QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import {
  unavailableReason,
  type CapabilityKind,
  type HubAvailability,
} from '../../service-hubs/serviceHubModel'
import { InterviewArt } from '../InterviewArt'
import '../styles/interview-touch.css'

const ASK_DRAFT = '我想练面试。请先问我现在最想完成哪一项，不要替我开始练习。'

type Entry = {
  title: string
  desc: string
  icon: QxTouchIconName
  route: string
  kind: CapabilityKind
}

const TILES: Entry[] = [
  { title: '面试技巧', desc: '查看通用问答与沟通要点', icon: 'book', route: '/interview/tips', kind: 'info' },
  { title: '训练报告', desc: '查看模拟面试报告', icon: 'receipt', route: '/interview/reports', kind: 'info' },
  { title: '职业自我探索', desc: '了解优势、偏好与可尝试方向', icon: 'compass', route: '/resume/self-assessment/intro', kind: 'ai' },
  { title: '职业规划建议', desc: '根据经历与目标形成行动建议', icon: 'map', route: '/resume/career-plan', kind: 'ai' },
]

const MORE: Entry[] = [
  { title: '评估历史', desc: '回看本人历次自我探索结果', icon: 'compass', route: '/resume/self-assessment/history', kind: 'info' },
  { title: '行业薪资参考', desc: '向通用AI顾问询问市场信息', icon: 'sparkle', route: '/assistant', kind: 'ai' },
  { title: 'AI服务记录', desc: '查看本人AI调用记录', icon: 'sparkle', route: '/me/ai-records', kind: 'account' },
  { title: '简历服务', desc: '先完善求职材料', icon: 'file', route: '/resume-service', kind: 'info' },
]

const PRACTICE_STEPS = [
  ['1 创建配置', '记下岗位、面试官和时长'],
  ['2 逐题作答', '默认文字回答，语音进入后检测'],
  ['3 生成练习报告', '练完再生成，到点不自动交卷'],
] as const

function readinessOf(state: HubAvailability): string {
  if (state.apiDown) return 'unavailable'
  if (state.deviceOff) return 'degraded'
  if (state.apiChecking || state.deviceChecking) return 'checking'
  return 'ready'
}

export function InterviewHubTouch({
  availability,
  apiBlocked,
  onRetry,
  status,
  notice,
}: {
  availability: HubAvailability
  apiBlocked: boolean
  onRetry: () => void
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  notice: { title: string; detail: string }
}) {
  const navigate = useNavigate()
  const [more, setMore] = useState(false)
  const hubRef = useRef<HTMLDivElement>(null)
  const seenMore = useRef<boolean | null>(null)
  const goBack = more ? () => setMore(false) : () => navigate('/')
  const mainReason = unavailableReason('ai', '/interview/setup', availability)

  useLayoutEffect(() => {
    const changed = seenMore.current !== null && seenMore.current !== more
    seenMore.current = more
    if (!changed) return
    const heading = hubRef.current?.querySelector('h2, h3')
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
    }
  }, [more])

  return (
    <QxTouchScreen
      page="interview"
      gallery={false}
      motion="none"
      bodyClassName="qxt-body-iv qxt-body-hub"
      band={
        <QxTouchBand
          kind={more ? 'compact' : 'std'}
          eyebrow="AI面试训练"
          title={more ? '其余四项入口' : '把表达练熟，不替你下结论'}
          sub={more
            ? '评估历史、行业薪资参考、AI服务记录、简历服务。'
            : '模拟问答、自我探索、技巧与历史报告，用于练习和复盘，不代表真实面试结果。'}
          seal={more ? null : 'idle'}
          place=" "
          status={{ text: status.label, tone: status.tone }}
          path={more ? undefined : ['创建配置', '逐题作答', '生成练习报告']}
          pathLabel="一场练习"
          onBack={goBack}
        />
      }
      dock={
        <QxTouchDock
          onBack={goBack}
          backLabel="返回"
          ask={{ label: '问小青：先练哪一项？', draft: ASK_DRAFT }}
        />
      }
      nav={
        <QxTouchNav
          current="home"
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <div
        ref={hubRef}
        className={more ? 'qxt-ivhub is-more' : 'qxt-ivhub'}
        data-qx-page="service-hub"
        data-hub="interview"
        data-hub-api-blocked={apiBlocked ? 'true' : 'false'}
        data-hub-device-probe="off"
      >
        <div className="qx-hub-grid">
          {more ? MORE.map((entry, index) => {
            const reason = unavailableReason(entry.kind, entry.route, availability)
            return (
              <QxTouchTile
                key={entry.title}
                icon={entry.icon}
                title={entry.title}
                desc={entry.desc}
                tone={entry.kind === 'ai' ? 'teal' : 'slate'}
                titleAs="h3"
                index={index}
                off={Boolean(reason)}
                reason={reason ?? undefined}
                onClick={() => navigate(entry.route)}
              />
            )
          }) : (
            <>
              {mainReason ? (
                <div className="qxt-iv-main is-off" role="group" aria-disabled="true" aria-label="马上练一场">
                  <span className="qxt-iv-chip">AI · 练习</span>
                  <h3>马上练一场</h3>
                  <p>选择岗位类型与难度后进入训练</p>
                  <span className="qx-hub-why">{mainReason}</span>
                  <PracticeSteps />
                </div>
              ) : (
                <button type="button" className="qxt-iv-main" onClick={() => navigate('/interview/setup')}>
                  <span className="qxt-iv-chip">AI · 练习</span>
                  <b>马上练一场</b>
                  <small>选择岗位类型与难度后进入训练</small>
                  <PracticeSteps />
                </button>
              )}
              {mainReason ? (
                <button type="button" className="qxt-iv-fallback" onClick={() => navigate('/interview/tips')}>
                  可以先看面试技巧
                </button>
              ) : null}
              {TILES.map((entry, index) => {
                const reason = unavailableReason(entry.kind, entry.route, availability)
                return (
                  <QxTouchTile
                    key={entry.title}
                    icon={entry.icon}
                    title={entry.title}
                    desc={entry.desc}
                    tone={entry.kind === 'ai' ? 'teal' : 'slate'}
                    titleAs="h3"
                    index={index}
                    off={Boolean(reason)}
                    reason={reason ?? undefined}
                    testId={entry.title === '面试技巧' ? 'hub-interview-grid-面试技巧' : undefined}
                    onClick={() => navigate(entry.route)}
                  />
                )
              })}
            </>
          )}
        </div>
        {more ? (
          <>
            <button type="button" className="qxt-iv-wide" onClick={() => setMore(false)}>
              <b>返回练面试</b>
              <small>回到服务台，不靠历史记录</small>
            </button>
            <InterviewArt variant="more" title="按练习目标进入">
              评估历史回看本人历次自我探索。行业薪资参考向通用 AI 顾问询问市场信息，徽标是「AI · 需核实」。AI服务记录看本人调用。简历服务先完善求职材料，不联网也能进。
            </InterviewArt>
          </>
        ) : (
          <>
            <button type="button" className="qxt-iv-more" onClick={() => setMore(true)}>
              <b>其余 4 项</b>
              <QxTouchIcon name="chevR" size={28} strokeWidth={2.4} />
            </button>
            <div
              className="qx-hub-notice qxt-iv-note"
              data-readiness={readinessOf(availability)}
              role="status"
              aria-live="polite"
            >
              <span className="qx-hub-notice-copy">
                <b>{notice.title}</b>
                <span>{notice.detail}</span>
              </span>
              <span><b>AI训练不是企业面试。</b>不进行录用判断，不向企业推荐候选人。不排名，不预测录用。报告仅供本人练习参考，不对外共享。</span>
            </div>
            {availability.apiDown ? (
              <button type="button" className="qxt-iv-wide" onClick={onRetry}>
                <b>重新检测</b>
                <small>检测完之前，需要联网的入口仍不开放</small>
              </button>
            ) : null}
          </>
        )}
      </div>
    </QxTouchScreen>
  )
}

function PracticeSteps() {
  return (
    <span className="qxt-iv-steps">
      {PRACTICE_STEPS.map(([title, detail]) => (
        <i key={title}>
          <b>{title}</b>
          <em>{detail}</em>
        </i>
      ))}
    </span>
  )
}
