// ============================================================
// AI 用量与额度面板（对接 GET /admin/ai-usage/daily，#1088）
//
// 挂在「AI 服务管理」页。运营看钱的面板，纪律：
//   - 只展示服务端给的数，不自行推算任何未来或缺失的数字；
//   - 没数据如实显示（当天 0 调用就写 0 调用）；
//   - 触顶后果照 services/api/src/ai/usage/ai-budget.service.ts 的真实行为写：
//     只按北京时间今天判断。已花 ≥ 上限 → 新的生成 / 语音被拒，提示用服务端原话；
//     只读、导出、删除、打印前材料检查不拦；打印、扫描照常。历史日期不据此拦截。
//     给运营看的句子里不写状态码、英文错误码或字段名。
//
// mock 模式（admin E2E）不连真实用量，展示诚实空态，不造演示数字。
// ============================================================

import { useEffect, useState } from 'react'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import {
  AI_USAGE_DAILY_DEMO,
  beijingTodayKey,
  getAiUsageDaily,
  isAiUsageDayKey,
  type AiUsageDailySummary,
} from '../../services/api/aiUsageDaily'
import { ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { aiUsageKeyName, aiUsageKeyTitle, formatCny } from './aiUsageDisplay'
import { AiUsageBreakdownTable } from './AiUsageBreakdownTable'
import type { AiUsageDimension } from './aiUsageDisplay'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; text: string }
  | { kind: 'ready'; summary: AiUsageDailySummary }

type TabState = AiUsageDimension

const CONTROL_BTN =
  'inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40'

/**
 * 与 ai-budget.service.ts 的 EXHAUSTED_MESSAGE 逐字一致。
 * 闸门只在「北京时间今天」已花 ≥ 上限时拒绝新的生成 / 语音；三档提示各不同。
 */
const EXHAUSTED_USER_MESSAGE = {
  global: '今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
  terminal: '这台机器今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
  member: '你今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
} as const

const UNAFFECTED = '查看已有结果、导出、删除与打印前材料检查不受影响；打印、扫描照常。'

function liveRejectSentence(scope: keyof typeof EXHAUSTED_USER_MESSAGE, who: string): string {
  return `${who}新的 AI 生成与语音请求会被拒绝，并提示「${EXHAUSTED_USER_MESSAGE[scope]}」；${UNAFFECTED}北京时间过了今天自动恢复，不需要人工处理。`
}

function historicalReachedSentence(day: string): string {
  return `这是历史日期 ${day} 的账，对照的是当前配置的日上限。额度闸门只按北京时间今天的花费拦截，查看这一天不会据此拒绝现在的新请求。`
}

function MetricCell({ label, value, note, alert = false }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${alert ? 'border-error/30 bg-error-bg' : 'border-neutral-100 bg-surface'}`}>
      <p className="text-[11.5px] font-medium text-neutral-500">{label}</p>
      <p className={`mt-0.5 text-[1.15rem] font-bold tabular-nums leading-tight ${alert ? 'text-error-fg' : 'text-neutral-900'}`}>{value}</p>
      {note && <p className={`mt-1 text-[11px] leading-relaxed ${alert ? 'text-error-fg' : 'text-neutral-400'}`}>{note}</p>}
    </div>
  )
}

export function AiUsagePanel() {
  const todayKey = beijingTodayKey()
  const [day, setDay] = useState(todayKey)
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [reloadSeq, setReloadSeq] = useState(0)
  const [tab, setTab] = useState<TabState>('feature')

  // 取数：mock 模式不发请求（诚实空态）；日期不合法不发请求；换日 / 刷新都重取。
  useEffect(() => {
    if (AI_USAGE_DAILY_DEMO) return
    if (!isAiUsageDayKey(day)) {
      setLoad({ kind: 'error', text: '日期格式应为 YYYY-MM-DD' })
      return
    }
    let cancelled = false
    setLoad({ kind: 'loading' })
    getAiUsageDaily(day).then(
      (summary) => { if (!cancelled) setLoad({ kind: 'ready', summary }) },
      (error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiHttpError && error.status === 403) {
          setLoad({ kind: 'error', text: '只有管理员可以查看 AI 用量与额度' })
          return
        }
        setLoad({ kind: 'error', text: userMessageOf(error, '用量没有读到，请稍后重试') })
      },
    )
    return () => { cancelled = true }
  }, [day, reloadSeq])

  const onDayChange = (next: string) => {
    // 只能选今天及以前：超出的日期直接不采纳（浏览器 date 控件本身有 max，这里再守一道）。
    if (next > todayKey) return
    setDay(next)
  }

  const summary = load.kind === 'ready' ? load.summary : null
  const viewingToday = summary !== null && summary.day === todayKey

  return (
    <section lang="zh-CN" aria-labelledby="ai-usage-title" className="mb-6 min-w-0 max-w-full rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm max-sm:-mx-7 max-sm:max-w-none max-sm:px-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
          <h2 id="ai-usage-title" className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-neutral-700">
            <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
            AI 用量与额度
            {AI_USAGE_DAILY_DEMO && (
              <span className="rounded bg-warning-bg px-1.5 py-0.5 text-[11px] font-medium text-warning-fg">演示模式</span>
            )}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">
            按北京时间自然日统计当日 AI 金额与额度触顶情况（对接逐次计量账，金额口径 = 实测金额 + 未计量调用 × 保守单价）。
          </p>
        </div>
        {!AI_USAGE_DAILY_DEMO && (
          <div className="flex w-full min-w-0 basis-full flex-col gap-2 sm:w-auto sm:basis-auto sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-0 w-full sm:w-auto">
              <label htmlFor="ai-usage-day" className="mb-1 block text-xs font-medium text-neutral-600">
                日期（只能选今天及以前，年-月-日）
              </label>
              <input
                id="ai-usage-day"
                type="date"
                value={day}
                max={todayKey}
                onChange={(event) => onDayChange(event.target.value)}
                disabled={load.kind === 'loading'}
                className="box-border block min-h-12 w-full min-w-0 max-w-full appearance-none rounded-lg border border-neutral-200 bg-surface px-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100 sm:w-auto sm:px-3"
              />
            </div>
            <button
              type="button"
              onClick={() => setReloadSeq((n) => n + 1)}
              disabled={load.kind === 'loading'}
              className={`${CONTROL_BTN} w-full justify-center sm:w-auto`}
            >
              <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
              刷新
            </button>
          </div>
        )}
      </div>

      {AI_USAGE_DAILY_DEMO && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm leading-relaxed text-warning-fg" role="status">
          演示模式不连接真实用量数据：这里不显示任何金额或次数，请连接真实后端后查看当日 AI 用量与额度。
        </p>
      )}

      {!AI_USAGE_DAILY_DEMO && load.kind === 'loading' && (
        <p className="mt-3 text-sm text-neutral-400" role="status">正在读取 {day} 的 AI 用量…</p>
      )}

      {!AI_USAGE_DAILY_DEMO && load.kind === 'error' && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">
            AI 用量读取失败：{load.text}
          </p>
          <button type="button" onClick={() => setReloadSeq((n) => n + 1)} className={CONTROL_BTN}>
            重试
          </button>
        </div>
      )}

      {summary && (
        <>
          {summary.totals.calls === 0 && (
            <p className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500" role="status">
              {summary.day} 当天 0 次 AI 调用：计量账里没有这一天的记录，以下金额均为 0（如实显示，不是没查到）。
            </p>
          )}

          {summary.reached.global ? (
            <div className="mt-3 rounded-lg border border-error/40 bg-error-bg px-3 py-3" role="alert">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-error-fg">
                <AlertTriangleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                全站当日 AI 额度已用完：已计费 {formatCny(summary.totals.chargedCostCny)} 已达全局上限 {formatCny(summary.limits.globalCny)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-error-fg">
                {viewingToday
                  ? liveRejectSentence('global', '服务端当前行为：')
                  : historicalReachedSentence(summary.day)}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-neutral-400">
              全站当日额度未用完（已计费 {formatCny(summary.totals.chargedCostCny)} / 上限 {formatCny(summary.limits.globalCny)}）。
              {viewingToday
                ? '若达到全局上限，服务端会拒绝新的生成与语音请求；查看已有结果、导出、删除与打印前材料检查不受影响，打印、扫描照常。单终端与单会员是否触顶另见下方。'
                : '额度闸门只按北京时间今天计算，不按这个历史日期拦截新请求。'}
            </p>
          )}

          {(summary.reached.terminalIds.length > 0 || summary.reached.memberCount > 0) && (
            <div className="mt-3 space-y-2">
              {summary.reached.terminalIds.length > 0 && (
                <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-fg" role="alert">
                  已到单终端上限（{formatCny(summary.limits.terminalCny)}/台/日）的终端：{summary.reached.terminals.map(({ terminalId, terminalCode }, index) => <span key={terminalId} title={aiUsageKeyTitle('terminal', terminalId, terminalCode)}>{index > 0 ? '、' : ''}{aiUsageKeyName('terminal', terminalId, terminalCode)}</span>)}。
                  {viewingToday
                    ? liveRejectSentence('terminal', '这些终端上，')
                    : historicalReachedSentence(summary.day)}
                  其它终端不受这几台的上限影响。
                </p>
              )}
              {summary.reached.memberCount > 0 && (
                <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-fg" role="alert">
                  已到单会员上限（{formatCny(summary.limits.memberCny)}/人/日）的会员：{summary.reached.memberCount} 人（一体机与小程序同一会员合并计算；这里只给人数，不展示会员标识）。
                  {viewingToday
                    ? liveRejectSentence('member', '这些会员，')
                    : historicalReachedSentence(summary.day)}
                </p>
              )}
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCell
              label={viewingToday ? '今日已计费金额 / 全局日上限' : `${summary.day} 已计费金额 / 全局日上限`}
              value={`${formatCny(summary.totals.chargedCostCny)} / ${formatCny(summary.limits.globalCny)}`}
              note={`实测 ${formatCny(summary.totals.measuredCostCny)} + 未计量 ${summary.totals.unmeasuredCalls} 次 × ${formatCny(summary.limits.unmeasuredCallCostCny)}/次`}
              alert={summary.reached.global}
            />
            <MetricCell
              label="调用次数"
              value={`${summary.totals.calls} 次`}
              note={`${summary.day}（北京时间自然日）`}
            />
            <MetricCell
              label="其中未计量次数"
              value={`${summary.totals.unmeasuredCalls} 次`}
              note={`供应商没返回用量的调用按保守单价 ${formatCny(summary.limits.unmeasuredCallCostCny)}/次计入额度，绝不当 0`}
            />
            <MetricCell
              label="涉及会员人数"
              value={`${summary.totals.memberCount} 人`}
              note="只统计人数，不展示会员标识"
            />
          </div>

          <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
            当日生效上限（来自服务端）：全局 {formatCny(summary.limits.globalCny)}/日 · 单终端 {formatCny(summary.limits.terminalCny)}/台/日 · 单会员 {formatCny(summary.limits.memberCny)}/人/日。
          </p>

          <AiUsageBreakdownTable summary={summary} tab={tab} onTabChange={setTab} />
        </>
      )}
    </section>
  )
}
