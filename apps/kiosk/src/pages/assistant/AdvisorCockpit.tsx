// ============================================================
// AdvisorCockpit — 稿 05-ai-cockpit 的深色舱面（标题 · 读数 · 能力仪表带）
//
// 从 AssistantPage.tsx 拆出（该文件已过 500 行，CLAUDE.md §8）。
// 这里只负责**把已测到的事实摆上舱面**：标题随 12 态换，读数只复述
// providerLabel / 语音相位这些真实信号；不发请求、不持有会话状态。
// ============================================================

import type { ReactNode } from 'react'
import { AigcMark } from '../../ai'
import { COCKPIT_COPY, type CockpitState } from './advisorScenes'
import { describeProviderLabel } from './advisorProvider'

export type CockpitReadingTone = 'plain' | 'hi' | 'amber' | 'bad'

export interface CockpitReading {
  label: string
  value: string
  tone?: CockpitReadingTone
}

interface CockpitReadingSignals {
  loading: boolean
  lastTurn: 'ai' | 'not-ai' | 'error' | null
  providerLabel: string | undefined
  aiLocked: boolean
  voiceAvailable: boolean
  cockpitState: CockpitState
}

function buildCockpitReadings(args: CockpitReadingSignals): CockpitReading[] {
  const { loading, lastTurn, providerLabel, aiLocked, voiceAvailable, cockpitState } = args
  return [
    {
      label: '回答来源',
      ...(loading
        ? { value: '等待返回' }
        : lastTurn === 'ai'
          ? { value: describeProviderLabel(providerLabel), tone: 'hi' as const }
          : lastTurn === 'error'
            ? { value: '本轮失败', tone: 'bad' as const }
            : aiLocked
              ? { value: `非 llm: · ${describeProviderLabel(providerLabel)}`, tone: 'amber' as const }
              : { value: '未请求' }),
    },
    {
      label: '语音通道',
      ...(!voiceAvailable
        ? { value: '本机未启用' }
        : cockpitState === 'voice-gate' ? { value: '等待你开启' }
          : cockpitState === 'voice-connecting' ? { value: '尝试建立中' }
            : cockpitState === 'voice-live' ? { value: '已接通', tone: 'hi' as const }
              : cockpitState === 'mic-denied' ? { value: '只听模式', tone: 'amber' as const }
                : cockpitState === 'voice-error' ? { value: '建立失败', tone: 'bad' as const }
                  : { value: '默认关闭' }),
    },
    { label: '本机草稿', value: '离场即清', tone: 'hi' },
  ]
}

interface AdvisorCockpitProps {
  state: CockpitState
  /** 当前专项（URL intent）或咨询主题，显示在眉题上；没有就不写。 */
  contextLabel?: string
  readingSignals: CockpitReadingSignals
  /** 能力仪表带（AiToolSection）。 */
  children?: ReactNode
}

export function AdvisorCockpit({ state, contextLabel, readingSignals, children }: AdvisorCockpitProps) {
  const copy = COCKPIT_COPY[state]
  const [lead, em, tail] = copy.title
  const readings = buildCockpitReadings(readingSignals)

  return (
    <header className="assistant-prototype-head assistant-cockpit" data-cockpit-state={state}>
      <div className="assistant-cockpit-row">
        <span className="assistant-cockpit-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="2.6" />
            <path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21" />
            <path d="M6.4 6.4a8 8 0 0 0 0 11.2M17.6 17.6a8 8 0 0 0 0-11.2" />
          </svg>
        </span>

        <div className="assistant-cockpit-copy">
          <p className="assistant-cockpit-eyebrow">
            AI COCKPIT · AI 驾驶舱{contextLabel ? <span> · {contextLabel}</span> : null}
          </p>
          {/* 标题与说明随真实状态切换；polite 播报，不抢读屏正在读的内容。 */}
          <div className="assistant-cockpit-headline" aria-live="polite" aria-atomic="true">
            <h2 key={state}>
              {lead}<em>{em}</em>{tail}
            </h2>
            <p className="assistant-cockpit-lede">{copy.lede}</p>
          </div>
          <div className="assistant-cockpit-disclosure">
            {/* AIGC 可见标识：每页恰好一次（interface-handoff.md §3），常驻不藏弹窗。 */}
            <AigcMark />
            <p className="assistant-advisor-disclosure">
              对话里的小青是虚拟形象，<b>不是真人在跟你说话</b> · 回答可能出错 · 本机草稿离场即清
            </p>
          </div>
        </div>

        <dl className="assistant-cockpit-telemetry" aria-label="会话状态读数">
          {readings.map((reading) => (
            <div key={reading.label}>
              <dt>{reading.label}</dt>
              <dd data-tone={reading.tone ?? 'plain'}>{reading.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {children}
    </header>
  )
}
