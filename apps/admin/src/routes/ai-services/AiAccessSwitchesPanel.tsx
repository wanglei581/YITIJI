// ============================================================
// AI 服务开关面板（D6 一键暂停与全机维护 + C6 使用声明 + C7 登录档位）
//
// 挂在 AI 服务管理页（index.tsx）的加载中、加载失败、正常三个分支里，都是 <Page> 的第一个子元素：
// 面板自己取数，统计接口挂了也找得到紧急暂停；三个分支放在同一位置，统计数据加载完
// 切到正常分支时面板不会被重建，写了一半的事由不会丢。
//
// 说明文字逐条对齐 services/api/src/ai-access/ 的行为，不许夸大：
// - AI 暂停：AI 生成、语音、导出类接口返回 503 AI_PAUSED；读取类不受影响。
// - 全机维护：AI（读取类除外）与标了 @MaintenanceBlocked() 的六个接口返回 503 MAINTENANCE_MODE。
// - 登录档位：off / before_export / before_generate；没登录返回 401 AI_LOGIN_REQUIRED。
// - 使用声明：AI 生成与语音缺声明（且会员没有留存同意）返回 403 AI_DECLARATION_REQUIRED。
// - 生效：服务端写 Redis 保存一年，各进程缓存 30 秒；Redis 读不到时回落服务器 .env。
//
// 显示只认服务端：读取和切换后都按响应里的四项显示，不做乐观更新；
// 「已切换」只在服务端返回、且返回值就是这次要切的值时出现。
// ============================================================

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { StatusBadge } from '@ai-job-print/ui'
import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react'
import {
  AI_ACCESS_DEMO,
  AI_ACCESS_REASON_MAX,
  AI_LOGIN_GATES,
  aiAccessReasonProblem,
  getAiAccessConfig,
  updateAiAccessConfig,
  type AiAccessConfig,
  type AiAccessPatch,
  type AiLoginGate,
} from '../../services/api/aiAccess'
import { ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'

type SwitchKey = keyof AiAccessConfig

type Change =
  | { key: 'paused'; to: boolean }
  | { key: 'maintenance'; to: boolean }
  | { key: 'declarationEnforced'; to: boolean }
  | { key: 'loginGate'; to: AiLoginGate }

type LoadState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; config: AiAccessConfig }

type BadgeTone = 'success' | 'warning' | 'error' | 'info' | 'default'

const GATE_LABEL: Record<AiLoginGate, string> = {
  off: '不要求登录',
  before_export: '导出、打印前登录',
  before_generate: '使用 AI 前登录',
}

/** 服务端标了 @MaintenanceBlocked() 的六个接口，逐个核对过 services/api/src。 */
const MAINTENANCE_BLOCKED = '会员打印下单、材料包下单、格式转换（图片转 PDF）、打印任务创建、扫描任务创建、上传会话创建'

const ROWS: ReadonlyArray<{ key: SwitchKey; title: string; explain: string; kioskNote?: string }> = [
  {
    key: 'paused',
    title: 'AI 暂停',
    explain: '打开后，所有 AI 生成、语音、导出类接口都返回“AI 服务暂停中，打印扫描照常”；读取类（如查看已有结果）不受影响。',
  },
  {
    key: 'maintenance',
    title: '全机维护',
    explain: `打开后，AI 功能（读取类除外）以及${MAINTENANCE_BLOCKED}都返回“设备维护中，请稍后再来”。`,
  },
  {
    key: 'loginGate',
    title: 'AI 登录档位',
    explain: '三档：不要求登录；导出、打印前登录（只在导出、打印 AI 材料前要求）；使用 AI 前登录（AI 生成、语音和导出、打印 AI 材料前都要求）。没登录的请求会被拒绝，并提示先用手机号登录。',
    kioskNote: '一体机要先更新到有“去登录”引导的版本，再调高档位。在那之前调高，一体机上没登录的人用到需要登录的 AI 功能会直接报错。',
  },
  {
    key: 'declarationEnforced',
    title: 'AI 使用声明',
    explain: '打开后，AI 生成和语音请求没有带上“年满 14 周岁”声明（语音还要录音声明）时会被拒绝；会员账号里已留存同意的不受影响。',
    kioskNote: '一体机要先更新到支持声明的版本（在 AI 按钮下显示声明，并在请求里带上声明信息），再打开。在那之前打开，一体机上的 AI 生成和语音会直接报错。',
  },
]

const ROW_TITLE = Object.fromEntries(ROWS.map((row) => [row.key, row.title])) as Record<SwitchKey, string>

const NEUTRAL_BTN =
  'rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40'
const STRICT_BTN =
  'rounded-lg border border-error/30 bg-error-bg px-3 py-1.5 text-sm font-medium text-error-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40'

function stateOf(key: SwitchKey, config: AiAccessConfig): { label: string; tone: BadgeTone } {
  switch (key) {
    case 'paused':
      return config.paused ? { label: '已暂停', tone: 'error' } : { label: 'AI 正常', tone: 'success' }
    case 'maintenance':
      return config.maintenance ? { label: '维护中', tone: 'warning' } : { label: '未维护', tone: 'default' }
    case 'loginGate':
      return { label: GATE_LABEL[config.loginGate], tone: config.loginGate === 'off' ? 'default' : 'info' }
    case 'declarationEnforced':
      return config.declarationEnforced ? { label: '已要求声明', tone: 'info' } : { label: '不要求声明', tone: 'default' }
  }
}

function actionsFor(key: SwitchKey, config: AiAccessConfig): Array<{ change: Change; label: string }> {
  switch (key) {
    case 'paused':
      return [{ change: { key, to: !config.paused }, label: config.paused ? '恢复 AI' : '暂停 AI' }]
    case 'maintenance':
      return [{ change: { key, to: !config.maintenance }, label: config.maintenance ? '结束维护' : '开启全机维护' }]
    case 'declarationEnforced':
      return [{
        change: { key, to: !config.declarationEnforced },
        label: config.declarationEnforced ? '不再要求声明' : '开始要求声明',
      }]
    case 'loginGate':
      return AI_LOGIN_GATES.filter((gate) => gate !== config.loginGate)
        .map((gate) => ({ change: { key, to: gate }, label: `改为“${GATE_LABEL[gate]}”` }))
  }
}

function patchOf(change: Change): AiAccessPatch {
  switch (change.key) {
    case 'paused': return { paused: change.to }
    case 'maintenance': return { maintenance: change.to }
    case 'declarationEnforced': return { declarationEnforced: change.to }
    case 'loginGate': return { loginGate: change.to }
  }
}

/** 更严格：暂停、开启维护、开始要求声明、调高登录档位。这几个方向要额外勾选确认。 */
function isStricter(change: Change, config: AiAccessConfig): boolean {
  if (change.key === 'loginGate') return AI_LOGIN_GATES.indexOf(change.to) > AI_LOGIN_GATES.indexOf(config.loginGate)
  return change.to && !config[change.key]
}

function consequenceOf(change: Change): string {
  switch (change.key) {
    case 'paused':
      return '我已了解：暂停后，所有 AI 生成、语音、导出类功能都会被拒绝，直到恢复 AI；读取类和普通打印扫描不受影响。'
    case 'maintenance':
      return `我已了解：开启维护后，AI 功能（读取类除外）以及${MAINTENANCE_BLOCKED}都会被拒绝，直到结束维护。`
    case 'declarationEnforced':
      return '我已了解：打开后，没带声明的 AI 生成和语音请求会被拒绝；一体机更新到支持声明的版本之前，一体机上的 AI 生成和语音会直接报错。'
    case 'loginGate':
      return change.to === 'before_generate'
        ? '我已了解：调高后，没登录的人使用 AI 生成、语音和导出、打印 AI 材料都会被拒绝；一体机更新到有“去登录”引导的版本之前，一体机上的这些 AI 功能会直接报错。'
        : '我已了解：调高后，没登录的人导出、打印 AI 材料会被拒绝；一体机更新到有“去登录”引导的版本之前，一体机上的这些操作会直接报错。'
  }
}

function failureState(error: unknown): LoadState {
  if (error instanceof ApiHttpError && error.status === 403) return { kind: 'forbidden' }
  return { kind: 'error', message: userMessageOf(error, '请稍后重试') }
}

export function AiAccessSwitchesPanel() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [readSeq, setReadSeq] = useState(0)
  const [change, setChange] = useState<Change | null>(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // 读取四项当前状态；「重新读取」递增 readSeq 再读一次，旧请求晚到时丢弃。
  useEffect(() => {
    let cancelled = false
    getAiAccessConfig().then(
      (config) => { if (!cancelled) setLoad({ kind: 'ready', config }) },
      (error: unknown) => { if (!cancelled) setLoad(failureState(error)) },
    )
    return () => { cancelled = true }
  }, [readSeq])

  const config = load.kind === 'ready' ? load.config : null
  const reasonProblem = aiAccessReasonProblem(reason)
  const needsConfirm = change !== null && config !== null && isStricter(change, config)
  const canSubmit = change !== null && config !== null && !submitting && !reasonProblem && (!needsConfirm || confirmed)
  const blockedHint = reasonProblem ? reasonProblem.message : needsConfirm && !confirmed ? '请先勾选上面的确认' : null

  const resetForm = () => {
    setReason('')
    setConfirmed(false)
    setSubmitError(null)
  }

  const openChange = (next: Change) => {
    if (submitting) return
    setChange(next)
    resetForm()
    setNotice(null)
  }

  const closeChange = () => {
    if (submitting) return
    setChange(null)
    resetForm()
  }

  const reload = () => {
    if (submitting) return
    setChange(null)
    resetForm()
    setNotice(null)
    setLoad({ kind: 'loading' })
    setReadSeq((n) => n + 1)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!change || !canSubmit) return
    const target = change
    setSubmitting(true)
    setSubmitError(null)
    setNotice(null)
    try {
      // 不做乐观更新：界面上的状态只换成服务端这次返回的四项。
      const next = await updateAiAccessConfig(patchOf(target), reason.trim())
      if (!mounted.current) return
      setLoad({ kind: 'ready', config: next })
      setChange(null)
      resetForm()
      setNotice(next[target.key] === target.to
        ? { tone: 'success', text: '已切换，约 30 秒内全部生效。' }
        : {
            tone: 'warning',
            text: `提交已完成，但服务端返回的“${ROW_TITLE[target.key]}”是“${stateOf(target.key, next).label}”，与这次要切换的不一致，请点“重新读取”核对。`,
          })
    } catch (error) {
      if (!mounted.current) return
      if (error instanceof ApiHttpError && error.status === 403) {
        setChange(null)
        resetForm()
        setLoad({ kind: 'forbidden' })
        return
      }
      setSubmitError(userMessageOf(error, '切换没有成功，请稍后重试'))
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  const renderForm = (current: Change, from: AiAccessConfig) => (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label={`切换：${ROW_TITLE[current.key]}`}
      className="mt-3 space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
    >
      <p className="text-sm font-medium text-neutral-800">
        将“{ROW_TITLE[current.key]}”从“{stateOf(current.key, from).label}”改为“{stateOf(current.key, { ...from, ...patchOf(current) }).label}”
      </p>
      <div>
        <label htmlFor="ai-access-reason" className="mb-1 block text-xs font-medium text-neutral-600">
          切换事由<span className="ml-0.5 text-error-fg">*</span>
          <span className="ml-2 font-normal text-neutral-400">必填，1–{AI_ACCESS_REASON_MAX} 字，写进审计</span>
        </label>
        <textarea
          id="ai-access-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={AI_ACCESS_REASON_MAX}
          disabled={submitting}
          placeholder="写清这次为什么切换，例如：模型服务商故障、现场设备检修"
          className="h-20 w-full resize-none rounded-lg border border-neutral-200 bg-surface px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-neutral-100"
        />
        <p className="mt-1 text-right text-[11px] tabular-nums text-neutral-400">
          {Array.from(reason.trim()).length} / {AI_ACCESS_REASON_MAX}
        </p>
      </div>
      {needsConfirm && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2">
          <input
            id="ai-access-confirm"
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={submitting}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300"
          />
          <label htmlFor="ai-access-confirm" className="text-xs leading-relaxed text-error-fg">
            {consequenceOf(current)}
          </label>
        </div>
      )}
      {submitError && (
        <p role="alert" className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg">{submitError}</p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!submitting && blockedHint && <span className="mr-auto text-xs text-neutral-500">{blockedHint}</span>}
        <button type="button" onClick={closeChange} disabled={submitting} className={NEUTRAL_BTN}>
          取消
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className={`rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
            needsConfirm ? 'bg-error hover:opacity-90' : 'bg-primary-600 hover:bg-primary-700'
          }`}
        >
          {submitting ? '提交中…' : '确认切换'}
        </button>
      </div>
    </form>
  )

  return (
    <section aria-labelledby="ai-access-title" className="mb-6 rounded-lg border border-neutral-200 bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="ai-access-title" className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-neutral-700">
            <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
            AI 服务开关
            {AI_ACCESS_DEMO && (
              <span className="rounded bg-warning-bg px-1.5 py-0.5 text-[11px] font-medium text-warning-fg">演示数据</span>
            )}
          </h2>
          {load.kind !== 'forbidden' && (
            <p className="mt-1 text-xs text-neutral-500">
              暂停 AI、全机维护、AI 登录档位和 AI 使用声明。每次切换都要填写事由，服务端会记下切换前后的状态和事由。
              {AI_ACCESS_DEMO && '演示数据只保存在本浏览器，不会切换线上开关。'}
            </p>
          )}
        </div>
        {(load.kind === 'ready' || load.kind === 'error') && (
          <button
            type="button"
            onClick={reload}
            disabled={submitting}
            className={`inline-flex items-center gap-1.5 ${NEUTRAL_BTN}`}
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
            重新读取
          </button>
        )}
      </div>

      {load.kind === 'loading' && (
        <p className="mt-3 text-sm text-neutral-400" role="status">正在读取 AI 服务开关…</p>
      )}
      {load.kind === 'forbidden' && (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg" role="alert">
          只有管理员可以查看和切换。
        </p>
      )}
      {load.kind === 'error' && (
        <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">
          AI 服务开关读取失败：{load.message}
        </p>
      )}
      {load.kind === 'ready' && (
        <>
          {notice && (
            <p
              role={notice.tone === 'success' ? 'status' : 'alert'}
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                notice.tone === 'success' ? 'bg-success-bg text-success-fg' : 'border border-warning/30 bg-warning-bg text-warning-fg'
              }`}
            >
              {notice.text}
            </p>
          )}
          <ul className="mt-3 divide-y divide-neutral-100 rounded-lg border border-neutral-100">
            {ROWS.map((row) => {
              const state = stateOf(row.key, load.config)
              return (
                <li key={row.key} id={`ai-access-row-${row.key}`} className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-neutral-800">{row.title}</h3>
                    <StatusBadge dot status={state.tone} label={state.label} />
                    <div className="ml-auto flex flex-wrap gap-2">
                      {actionsFor(row.key, load.config).map((action) => (
                        <button
                          key={String(action.change.to)}
                          type="button"
                          onClick={() => openChange(action.change)}
                          disabled={submitting}
                          className={isStricter(action.change, load.config) ? STRICT_BTN : NEUTRAL_BTN}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-neutral-500">{row.explain}</p>
                  {row.kioskNote && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-1.5 text-xs leading-relaxed text-warning-fg">
                      <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{row.kioskNote}</span>
                    </p>
                  )}
                  {change?.key === row.key && renderForm(change, load.config)}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {load.kind !== 'forbidden' && (
        <p className="mt-3 text-[11.5px] leading-relaxed text-neutral-500">
          后台切换保存一年，到期回到服务器配置文件里的值（服务器读不到后台切换记录时也按配置文件执行）；长期设置也请写进服务器配置：AI_PAUSED、MAINTENANCE_MODE、AI_LOGIN_GATE、AI_DECLARATION_ENFORCEMENT。
        </p>
      )}
    </section>
  )
}
