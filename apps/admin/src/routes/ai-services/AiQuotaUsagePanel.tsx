import { useEffect, useState } from 'react'
import { AI_USAGE_DAILY_DEMO } from '../../services/api/aiUsageDaily'
import { getAdminAiQuotaUsage } from '../../services/api/aiQuotaUsage'
import type { AdminAiQuotaUsage } from '@ai-job-print/shared'
import { ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'

const BUCKET_LABEL = {
  ai_resume: '简历类',
  ai_assistant: '小青',
  ai_interview: '模拟面试',
} as const

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; summary: AdminAiQuotaUsage }

function bucketLabel(bucket: string): string {
  return bucket in BUCKET_LABEL ? BUCKET_LABEL[bucket as keyof typeof BUCKET_LABEL] : '未识别用途'
}

export function AiQuotaUsagePanel({ reloadKey = 0 }: { reloadKey?: number }) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })

  useEffect(() => {
    if (AI_USAGE_DAILY_DEMO) return
    let cancelled = false
    setLoad({ kind: 'loading' })
    getAdminAiQuotaUsage().then(
      (summary) => { if (!cancelled) setLoad({ kind: 'ready', summary }) },
      (error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiHttpError && error.status === 403) {
          setLoad({ kind: 'error', message: '只有管理员可以查看按人次数' })
          return
        }
        setLoad({ kind: 'error', message: userMessageOf(error, '请稍后重试') })
      },
    )
    return () => { cancelled = true }
  }, [reloadKey])

  if (AI_USAGE_DAILY_DEMO) {
    return (
      <section aria-labelledby="ai-quota-usage-title" className="mt-4 border-t border-neutral-100 pt-4">
        <h3 id="ai-quota-usage-title" className="text-[13px] font-bold text-neutral-700">按人次数（今天）</h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">演示模式不连接按人次数，请连接真实后端后再看。</p>
      </section>
    )
  }

  return (
    <section aria-labelledby="ai-quota-usage-title" className="mt-4 border-t border-neutral-100 pt-4">
      <h3 id="ai-quota-usage-title" className="text-[13px] font-bold text-neutral-700">按人次数（今天）</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        只统计北京时间今天。三个用途分开计数；机构加的次数另计。这一块不随上面的日期选择变化。
      </p>
      {load.kind === 'loading' && <p className="mt-3 text-sm text-neutral-400" role="status">正在读取今天的按人次数…</p>}
      {load.kind === 'error' && (
        <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">{load.message}</p>
      )}
      {load.kind === 'ready' && <QuotaFigures summary={load.summary} />}
    </section>
  )
}

function QuotaFigures({ summary }: { summary: AdminAiQuotaUsage }) {
  const guestClosed = summary.guest.perTerminalDailyLimit === 0
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-neutral-400">日期 {summary.day}（北京时间）</p>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {summary.buckets.map((bucket) => (
          <li key={bucket.bucket} className="rounded-lg border border-neutral-100 bg-surface p-3">
            <p className="text-[11.5px] font-medium text-neutral-500">{bucketLabel(bucket.bucket)}</p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">已用 {bucket.usedTotal} 次</p>
            <p className="mt-1 text-xs leading-relaxed text-neutral-500">
              用过 {bucket.membersUsed} 人，用完 {bucket.membersExhausted} 人，每人每天 {bucket.dailyLimit} 次
            </p>
          </li>
        ))}
      </ul>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {summary.extra.map((bucket) => (
          <li key={bucket.bucket} className="rounded-lg border border-neutral-100 px-3 py-2 text-xs leading-relaxed text-neutral-600">
            {bucketLabel(bucket.bucket)}机构加的次数剩余 {bucket.remainingTotal}，其中 {bucket.expiringWithin30Days} 次在 30 天内到期
          </li>
        ))}
      </ul>
      <p className="rounded-lg border border-neutral-100 px-3 py-2 text-xs leading-relaxed text-neutral-600">
        {guestClosed
          ? '游客池：关闭（需登录后使用 AI）。在服务器配置里调整。'
          : `游客池：每台每天 ${summary.guest.perTerminalDailyLimit} 次（今天 ${summary.guest.terminalsUsed} 台用过，合计 ${summary.guest.usedTotal} 次）。在服务器配置里调整。`}
      </p>
    </div>
  )
}
