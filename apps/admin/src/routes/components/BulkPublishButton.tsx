// ============================================================
// BulkPublishButton — 信息源批量发布(岗位 / 招聘会 / 政策共用)
//
// 强制两步:筛选 → 预览清单 → 确认发布 → 逐条结果。
// 没有「一键全发」入口:确认按钮上的数字始终来自刚刚展示过的清单。
//
// 诚实性约束(改动前请先读):
//   - 结果页按 publishedCount / failedCount 分别呈现,失败逐条列出 id/标题/原因;
//     不允许折叠成一句「部分失败」,也不允许在有失败时显示纯成功文案。
//   - 未点「确认发布」之前,本组件不写任何数据。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import {
  bulkPublishService,
  type BulkPublishExecuteResult,
  type BulkPublishKind,
  type BulkPublishPreviewResult,
  type OrgOption,
} from '../../services/api/bulkPublish'

// OrgOption / toOrgOptions 放在 services/api/bulkPublish.ts:
// 组件文件只导出组件,避免 react-refresh 失效。

interface Props {
  kind: BulkPublishKind
  /** 来源机构下拉选项,由页面从已加载列表去重得到 */
  orgOptions: OrgOption[]
  /** 发布成功后通知页面重新拉取列表 */
  onDone: () => void
}

const KIND_LABEL: Record<BulkPublishKind, string> = {
  job: '岗位',
  fair: '招聘会',
  policy: '政策',
}

type Step = 'filter' | 'preview' | 'result'

const INPUT_CLS =
  'h-9 rounded-lg border border-neutral-200 bg-surface px-2 text-sm text-neutral-700 focus:border-primary-300 focus:outline-none'

/** 本地日期 → 绝对时刻 ISO。避免浏览器时区与服务器时区口径不一致。 */
function dayStartIso(d: string): string {
  return new Date(`${d}T00:00:00`).toISOString()
}
function dayEndIso(d: string): string {
  return new Date(`${d}T23:59:59.999`).toISOString()
}

function fmtTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso.slice(0, 16).replace('T', ' ') : d.toLocaleString('zh-CN', { hour12: false })
}

export function BulkPublishButton({ kind, orgOptions, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('filter')
  const [orgId, setOrgId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<BulkPublishPreviewResult | null>(null)
  const [result, setResult] = useState<BulkPublishExecuteResult | null>(null)

  const label = KIND_LABEL[kind]

  const reset = useCallback(() => {
    setStep('filter')
    setBusy(false)
    setError(null)
    setPreview(null)
    setResult(null)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    reset()
  }, [reset])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, close])

  const runPreview = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await bulkPublishService.preview({
        kind,
        ...(orgId ? { sourceOrgId: orgId } : {}),
        ...(from ? { syncTimeFrom: dayStartIso(from) } : {}),
        ...(to ? { syncTimeTo: dayEndIso(to) } : {}),
      })
      setPreview(res)
      setResult(null)
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败,请重试')
    } finally {
      setBusy(false)
    }
  }, [kind, orgId, from, to])

  const runExecute = useCallback(async () => {
    if (!preview || preview.items.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const res = await bulkPublishService.execute(
        kind,
        preview.items.map((it) => it.id),
      )
      setResult(res)
      setStep('result')
      // 有成功条目就刷新列表(即便同时有失败),让页面状态与库一致
      if (res.publishedCount > 0) onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : '发布失败,请重试')
    } finally {
      setBusy(false)
    }
  }, [kind, preview, onDone])

  return (
    <>
      <button
        type="button"
        className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100"
        onClick={() => {
          reset()
          setOpen(true)
        }}
      >
        批量发布
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) close()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`批量发布${label}`}
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-surface shadow-xl"
          >
            <header className="border-b border-neutral-200 px-5 py-4">
              <h2 className="text-base font-semibold text-neutral-900">批量发布 · {label}</h2>
              <p className="mt-1 text-xs text-neutral-500">
                只发布<strong>已通过审核</strong>的条目。批量发布不改变审核状态,待审核 / 已拒绝的条目不会被发布。
              </p>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div className="mb-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                  {error}
                </div>
              )}

              {step === 'filter' && (
                <FilterStep
                  orgOptions={orgOptions}
                  orgId={orgId}
                  from={from}
                  to={to}
                  onOrg={setOrgId}
                  onFrom={setFrom}
                  onTo={setTo}
                />
              )}

              {step === 'preview' && preview && <PreviewStep preview={preview} label={label} />}

              {step === 'result' && result && <ResultStep result={result} />}
            </div>

            <footer className="flex items-center justify-between gap-3 border-t border-neutral-200 px-5 py-3">
              <span className="text-xs text-neutral-500">
                {step === 'preview' && preview
                  ? `本轮 ${preview.items.length} 条 · 单轮上限 ${preview.batchLimit} 条`
                  : ''}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                  onClick={close}
                  disabled={busy}
                >
                  {step === 'result' ? '关闭' : '取消'}
                </button>

                {step === 'filter' && (
                  <button
                    type="button"
                    className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    onClick={() => void runPreview()}
                    disabled={busy}
                  >
                    {busy ? '预览中…' : '预览待发布条目'}
                  </button>
                )}

                {step === 'preview' && preview && (
                  <>
                    <button
                      type="button"
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                      onClick={() => setStep('filter')}
                      disabled={busy}
                    >
                      返回改筛选
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                      onClick={() => void runExecute()}
                      disabled={busy || preview.items.length === 0}
                    >
                      {busy ? '发布中…' : `确认发布这 ${preview.items.length} 条`}
                    </button>
                  </>
                )}

                {step === 'result' && (
                  <button
                    type="button"
                    className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                    onClick={() => void runPreview()}
                    disabled={busy}
                  >
                    {busy ? '预览中…' : '预览下一批'}
                  </button>
                )}
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Step 1:筛选 ─────────────────────────────────────────────────────────────

function FilterStep({
  orgOptions,
  orgId,
  from,
  to,
  onOrg,
  onFrom,
  onTo,
}: {
  orgOptions: OrgOption[]
  orgId: string
  from: string
  to: string
  onOrg: (v: string) => void
  onFrom: (v: string) => void
  onTo: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        先缩小范围,再预览。不填筛选条件表示「全部已审核通过且未发布的条目」。
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">来源机构</span>
          <select className={INPUT_CLS} value={orgId} onChange={(e) => onOrg(e.target.value)}>
            <option value="">全部机构</option>
            {orgOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <div />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">同步时间(起)</span>
          <input
            type="date"
            className={INPUT_CLS}
            value={from}
            max={to || undefined}
            onChange={(e) => onFrom(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600">同步时间(止)</span>
          <input
            type="date"
            className={INPUT_CLS}
            value={to}
            min={from || undefined}
            onChange={(e) => onTo(e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}

// ─── Step 2:预览 ─────────────────────────────────────────────────────────────

function PreviewStep({ preview, label }: { preview: BulkPublishPreviewResult; label: string }) {
  const { items, eligibleTotal, truncated, batchLimit, excluded } = preview
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
        <p className="text-neutral-800">
          符合条件、可发布的{label}共 <strong className="text-primary-700">{eligibleTotal}</strong> 条。
        </p>
        {truncated && (
          <p className="mt-1 text-warning-fg">
            单轮最多发布 {batchLimit} 条,本轮先发下面 {items.length} 条;发布完成后点「预览下一批」继续,
            共需约 {Math.ceil(eligibleTotal / batchLimit)} 轮。
          </p>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          命中筛选但不在本次发布范围内:未通过审核 {excluded.notApproved} 条(需先审核)、已发布{' '}
          {excluded.alreadyPublished} 条、已过期 {excluded.expired} 条。
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
          当前筛选下没有可发布的条目。
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                {['标题', '来源机构', '同步时间', '当前状态'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2 text-neutral-800">{it.title}</td>
                  <td className="px-3 py-2 text-neutral-600">{it.sourceName}</td>
                  <td className="px-3 py-2 text-neutral-600">{fmtTime(it.syncTime)}</td>
                  <td className="px-3 py-2 text-neutral-600">{it.publishStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Step 3:逐条结果 ─────────────────────────────────────────────────────────

function ResultStep({ result }: { result: BulkPublishExecuteResult }) {
  const failed = result.results.filter((r) => r.status === 'failed')
  const allOk = result.failedCount === 0

  return (
    <div className="space-y-4">
      <div
        className={
          allOk
            ? 'rounded-lg border border-success/30 bg-success-bg px-4 py-3 text-sm text-success-fg'
            : 'rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-warning-fg'
        }
      >
        {allOk ? (
          <p>
            本轮提交 {result.requested} 条,全部发布成功({result.publishedCount} 条)。
          </p>
        ) : (
          <p>
            本轮提交 {result.requested} 条:成功 <strong>{result.publishedCount}</strong> 条,
            失败 <strong>{result.failedCount}</strong> 条。成功的已生效,失败的未发布,明细如下。
          </p>
        )}
      </div>

      {failed.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-danger/30">
          <table className="w-full text-sm">
            <thead className="bg-danger-bg text-left text-xs text-danger-fg">
              <tr>
                {['失败条目', 'ID', '原因'].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {failed.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 text-neutral-800">{r.title}</td>
                  <td className="px-3 py-2 font-mono text-xs text-neutral-500">{r.id}</td>
                  <td className="px-3 py-2 text-neutral-700">
                    {r.errorMessage ?? '未知原因'}
                    {r.errorCode && <span className="ml-1 font-mono text-xs text-neutral-400">({r.errorCode})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-neutral-500">每条发布都已单独写入审计日志,可在「日志审计」按条目 ID 追溯。</p>
    </div>
  )
}
