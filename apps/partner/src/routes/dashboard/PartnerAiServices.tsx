import { useEffect, useState } from 'react'
import { formatCount } from '@ai-job-print/shared'
import { fetchPartnerUsage, type UsageFetchResult } from '../../services/api/consoleScreen'

export function PartnerAiServices() {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<UsageFetchResult | null>(null)
  useEffect(() => {
    let active = true
    setResult(null)
    void fetchPartnerUsage('7d').then((value) => { if (active) setResult(value) }).catch(() => { if (active) setResult({ kind: 'offline' }) })
    return () => { active = false }
  }, [attempt])
  const metric = result?.kind === 'ok' ? result.usage.metrics.partnerAiServices : undefined
  const failed = result && result.kind !== 'mock' && (result.kind !== 'ok' || !metric?.available)
  const line = (label: string, count: number | null, unit: string) =>
    count === null ? `${label}：少于 5 ${unit}，暂不显示具体数字` : `${label}：${formatCount(count)} ${unit}`
  return (
    <div className="space-y-1 text-sm text-neutral-700">
      {!result && <p>正在读取 AI 服务情况</p>}
      {result?.kind === 'mock' && <p>演示模式不显示 AI 服务情况</p>}
      {failed && <div role="alert" className="flex items-center gap-3"><span>AI 服务情况这次没读到</span><button type="button" className="min-h-11 min-w-11 rounded-md border px-3" onClick={() => setAttempt((n) => n + 1)}>重试</button></div>}
      {metric?.available && <><p>{line('AI 简历优化', metric.value.resumeOptimize, '次')}</p><p>{line('AI 模拟面试', metric.value.mockInterview, '场')}</p></>}
      <p className="text-xs text-neutral-500">只统计本机构终端上成功完成的 AI 简历优化和模拟面试，日常问答等不计入；自本功能上线起统计。</p>
    </div>
  )
}
