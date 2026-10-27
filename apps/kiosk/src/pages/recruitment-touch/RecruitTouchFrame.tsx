import type { ReactNode } from 'react'
import type { QxTouchAsk, QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { RtFrame } from './RtFrame'

type LegacyTone = 'ok' | 'warn' | 'bad' | 'unknown'

/**
 * 本包页面从青序页壳换到触屏壳时的承接件。
 * 状态语气沿用原页：只有 ok 亮绿，bad/warn 变提醒，unknown 保持灰点。
 * 底导航按触屏稿留空；原 navbar 参数不再渲染。
 */
export function RecruitTouchFrame({
  title,
  subtitle,
  status,
  children,
  ctabar,
  back,
  ask,
  primary,
  eyebrow,
  testId,
  stateId,
}: {
  title: ReactNode
  subtitle?: ReactNode
  status?: { tone: LegacyTone; label: string }
  children: ReactNode
  ctabar?: ReactNode
  navbar?: ReactNode
  terminalLabel?: ReactNode
  back?: { label: string; onBack: () => void }
  ask?: QxTouchAsk
  primary?: QxTouchPrimary
  eyebrow?: string
  testId?: string
  stateId?: string
}) {
  const touchStatus = !status
    ? undefined
    : status.tone === 'ok'
      ? { text: status.label, tone: 'ok' as const }
      : status.tone === 'warn' || status.tone === 'bad'
        ? { text: status.label, tone: 'warn' as const }
        : { text: status.label }

  return (
    <RtFrame
      eyebrow={eyebrow ?? '私有化版 · 来源信息'}
      title={title}
      sub={subtitle}
      status={touchStatus}
      back={Boolean(back)}
      backLabel={back?.label ?? '返回'}
      onBack={back?.onBack}
      ask={ask}
      primary={primary}
      dockExtra={ctabar ? <div className="rt-ctabar">{ctabar}</div> : undefined}
      testId={testId}
      stateId={stateId}
    >
      {children}
    </RtFrame>
  )
}
