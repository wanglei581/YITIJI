import type { ReactNode } from 'react'
import type { QxTouchAsk, QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { RtFrame } from './RtFrame'

type LegacyTone = 'ok' | 'warn' | 'bad' | 'unknown'

/**
 * 本包页面从青序页壳换到触屏壳时的承接件。
 * 状态语气沿用原页：只有 ok 亮绿，bad/warn 变提醒，unknown 保持灰点。
 * 底栏只留一条：返回、问小青、本页主次操作。底导航三项始终在。
 */
export function RecruitTouchFrame({
  title,
  subtitle,
  status,
  children,
  boundary,
  back,
  ask,
  secondary,
  primary,
  eyebrow,
  testId,
  stateId,
}: {
  title: ReactNode
  subtitle?: ReactNode
  status?: { tone: LegacyTone; label: string }
  children: ReactNode
  boundary?: ReactNode
  navbar?: ReactNode
  terminalLabel?: ReactNode
  back?: { label: string; onBack: () => void }
  ask?: QxTouchAsk
  secondary?: ReactNode
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
      eyebrow={eyebrow}
      title={title}
      sub={subtitle}
      status={touchStatus}
      back={Boolean(back)}
      backLabel={back?.label ?? '返回'}
      onBack={back?.onBack}
      ask={ask}
      secondary={secondary}
      primary={primary}
      boundary={boundary}
      testId={testId}
      stateId={stateId}
    >
      {children}
    </RtFrame>
  )
}
