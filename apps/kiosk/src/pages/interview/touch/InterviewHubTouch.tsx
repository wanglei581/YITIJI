import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { QxTouchTask } from '../../../components/qingxu/touch/QxTouchTask'
import type { QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import {
  unavailableReason,
  type CapabilityKind,
  type HubAvailability,
} from '../../service-hubs/serviceHubModel'
import '../styles/interview-touch.css'

const ASK_DRAFT = '我想练面试。请先问我现在最想完成哪一项，不要替我开始练习。'

type Entry = {
  title: string
  desc: string
  chip: string
  icon: QxTouchIconName
  route: string
  kind: CapabilityKind
  span?: boolean
}

const HOME: Entry[] = [
  { title: '马上练一场', desc: '选择岗位类型与难度后进入训练', chip: 'AI · 练习', icon: 'mic', route: '/interview/setup', kind: 'ai', span: true },
  { title: '面试技巧', desc: '查看通用问答与沟通要点', chip: '静态内容', icon: 'book', route: '/interview/tips', kind: 'info' },
  { title: '训练报告', desc: '查看模拟面试报告', chip: '本人记录', icon: 'receipt', route: '/interview/reports', kind: 'info' },
  { title: '职业自我探索', desc: '了解优势、偏好与可尝试方向', chip: 'AI · 仅供参考', icon: 'compass', route: '/resume/self-assessment/intro', kind: 'ai' },
  { title: '职业规划建议', desc: '根据经历与目标形成行动建议', chip: 'AI · 仅供参考', icon: 'map', route: '/resume/career-plan', kind: 'ai' },
]

const MORE: Entry[] = [
  { title: '评估历史', desc: '回看本人历次自我探索结果', chip: '本人记录', icon: 'compass', route: '/resume/self-assessment/history', kind: 'info' },
  { title: '行业薪资参考', desc: '向通用AI顾问询问市场信息', chip: 'AI · 需核实', icon: 'sparkle', route: '/assistant', kind: 'ai' },
  { title: 'AI服务记录', desc: '查看本人AI调用记录', chip: '本人记录', icon: 'sparkle', route: '/me/ai-records', kind: 'account' },
  { title: '简历服务', desc: '先完善求职材料', chip: '信息', icon: 'file', route: '/resume-service', kind: 'info' },
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
  const entries = more ? MORE : HOME
  const goBack = more ? () => setMore(false) : () => navigate('/')

  return (
    <QxTouchScreen
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
          backLabel={more ? '返回练面试' : '返回'}
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
        className="qxt-ivhub"
        data-qx-page="service-hub"
        data-hub="interview"
        data-hub-api-blocked={apiBlocked ? 'true' : 'false'}
        data-hub-device-probe="off"
      >
        <div className="qx-hub-grid qxt-grid2">
          {entries.map((entry, index) => {
            const reason = unavailableReason(entry.kind, entry.route, availability)
            const featured = Boolean(entry.span)
            return (
              <QxTouchTask
                key={entry.route + entry.title}
                icon={entry.icon}
                title={entry.title}
                desc={entry.desc}
                chip={entry.chip}
                chipTone={entry.kind === 'ai' ? 'teal' : 'slate'}
                index={index}
                dark={featured}
                className={featured ? 'qxt-span2' : undefined}
                testId={!more && entry.title === '面试技巧' ? 'hub-interview-grid-面试技巧' : undefined}
                disabledReason={reason ? `capability:${entry.kind}` : undefined}
                onClick={reason ? undefined : () => navigate(entry.route)}
                take={reason || featured ? undefined : '进入'}
                extra={featured || reason ? (
                  <>
                    {reason ? <span className="qx-hub-why">{reason}</span> : null}
                    {featured ? (
                      <ol className="qxt-iv-steps">
                        {PRACTICE_STEPS.map(([title, detail]) => (
                          <li key={title}><b>{title}</b><span>{detail}</span></li>
                        ))}
                      </ol>
                    ) : null}
                    {featured && reason ? (
                      <button type="button" className="qxt-iv-fallback" onClick={() => navigate('/interview/tips')}>
                        可以先看面试技巧
                      </button>
                    ) : null}
                  </>
                ) : undefined}
              />
            )
          })}
        </div>
        {more ? null : (
          <button type="button" className="qxt-iv-more" onClick={() => setMore(true)}>
            其余 4 项
          </button>
        )}
        <div
          className="qx-hub-notice"
          data-readiness={readinessOf(availability)}
          role="status"
          aria-live="polite"
        >
          <span className="qx-hub-notice-copy">
            <b>{notice.title}</b>
            <span>{notice.detail}</span>
          </span>
          {availability.apiDown ? (
            <button type="button" className="qx-hub-retry" onClick={onRetry}>重新检测</button>
          ) : null}
        </div>
        <p className="qxt-iv-note">
          <b>AI训练不是企业面试。</b>
          不进行录用判断，不向企业推荐候选人。不排名，不预测录用。报告仅供本人练习参考，不对外共享。
        </p>
      </div>
    </QxTouchScreen>
  )
}
