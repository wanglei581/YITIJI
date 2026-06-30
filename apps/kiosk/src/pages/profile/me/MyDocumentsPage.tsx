// ============================================================
// 我的文档 — /me/documents（本人，只读元数据）。
// 列表只给 downloadUrlPath/previewUrlPath；查看时凭本人 token 现换 TTL 受控签名 URL
// （fetchAccessUrl），过期文档诚实置灰不可打开；保存期限以后端返回的 retentionPolicy 为准。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@ai-job-print/ui'
import type { FileRetentionPolicy, FileRetentionUpdateRequest, MemberDocumentItem } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FilesIcon, EyeIcon, Trash2Icon, ClockIcon, PrinterIcon } from 'lucide-react'
import {
  deleteMyDocument,
  fetchAccessUrl,
  getMyDocuments,
  MemberAssetsApiError,
  updateMyDocumentRetention,
} from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const RETENTION_LABELS: Record<FileRetentionPolicy, string> = {
  months_3: '保存 3 个月',
  months_6: '保存 6 个月',
  long_term: '长期保存',
  system_short: '短期保存',
}

type SelectableRetentionPolicy = FileRetentionUpdateRequest['retentionPolicy']

function retentionLabel(policy: FileRetentionPolicy | null | undefined, expiresAt: string | null): string {
  if (policy && RETENTION_LABELS[policy]) return RETENTION_LABELS[policy]
  if (expiresAt === null) return '长期保存'
  return '到期自动清理'
}

function isSelectableRetentionPolicy(policy: FileRetentionPolicy): policy is SelectableRetentionPolicy {
  return policy !== 'system_short'
}

function selectablePolicies(doc: MemberDocumentItem): SelectableRetentionPolicy[] {
  return doc.allowedRetentionPolicies?.filter(isSelectableRetentionPolicy) ?? []
}

function needsRetentionConsent(policy: SelectableRetentionPolicy): boolean {
  return policy === 'months_6' || policy === 'long_term'
}

function retentionConfirmText(policy: SelectableRetentionPolicy): string {
  return policy === 'long_term'
    ? '长期保存会持续保留该成果物，便于后续查看、下载和打印；你可以随时改回较短期限或删除。'
    : '保存 6 个月会延长该文件在账号内的保留时间；你可以随时改回 3 个月或删除。'
}

function applyRetentionUpdate(
  doc: MemberDocumentItem,
  result: Awaited<ReturnType<typeof updateMyDocumentRetention>>,
): MemberDocumentItem {
  return {
    ...doc,
    assetCategory: result.file.assetCategory ?? doc.assetCategory,
    retentionPolicy: result.file.retentionPolicy ?? doc.retentionPolicy,
    allowedRetentionPolicies: result.allowedPolicies,
    expiresAt: result.file.expiresAt,
  }
}

function RetentionConfirmOverlay({
  policy,
  onConfirm,
  onCancel,
  busy,
}: {
  policy: SelectableRetentionPolicy
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retention-confirm-title"
        aria-describedby="retention-confirm-desc"
        className="w-[23rem] max-w-full rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="retention-confirm-title" className="text-base font-semibold text-gray-900">
          确认{RETENTION_LABELS[policy]}
        </p>
        <p id="retention-confirm-desc" className="mt-2 text-sm leading-relaxed text-gray-500">
          {retentionConfirmText(policy)}点击“同意并保存”即表示你已知悉文件保存期限说明。
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-12 flex-1 items-center justify-center rounded-lg border border-gray-200 text-sm font-medium text-gray-600"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={[
              'flex h-12 flex-1 items-center justify-center rounded-lg text-sm font-semibold text-white',
              busy ? 'cursor-not-allowed bg-primary-300' : 'bg-primary-600',
            ].join(' ')}
          >
            {busy ? '保存中' : '同意并保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function MyDocumentsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberDocumentItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [retentionPanelId, setRetentionPanelId] = useState<string | null>(null)
  const [retentionBusy, setRetentionBusy] = useState<{ fileId: string; policy: SelectableRetentionPolicy } | null>(null)
  const [retentionConfirm, setRetentionConfirm] = useState<{ fileId: string; policy: SelectableRetentionPolicy } | null>(null)

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setItems([])
      setState('ready')
      return
    }
    setState('loading')
    getMyDocuments(getToken(), { pageSize: 50 })
      .then((r) => {
        setItems(r.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  useEffect(() => {
    if (!confirmId) return
    const t = setTimeout(() => setConfirmId(null), 3500)
    return () => clearTimeout(t)
  }, [confirmId])

  useEffect(() => {
    if (!retentionPanelId) return
    if (retentionBusy?.fileId === retentionPanelId) return
    const t = setTimeout(() => setRetentionPanelId(null), 8000)
    return () => clearTimeout(t)
  }, [retentionBusy, retentionPanelId])

  const open = async (doc: MemberDocumentItem) => {
    if (opening || printingId || busyId || retentionBusy) return
    const token = getToken()
    if (!token) return
    setOpening(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      window.open(res.url, '_blank', 'noopener')
    } catch {
      setHint('文档打开失败，可能已到期或被清理')
    } finally {
      setOpening(null)
    }
  }

  const print = async (doc: MemberDocumentItem) => {
    if (opening || printingId || busyId || retentionBusy) return
    const token = getToken()
    if (!token) return
    setPrintingId(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      navigate('/print/confirm', {
        state: {
          file: {
            name: doc.filename,
            size: formatBytes(doc.sizeBytes),
            pages: null,
            fileUrl: res.url,
            mimeType: doc.mimeType,
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch {
      setHint('打印链接生成失败，可能已到期或被清理')
    } finally {
      setPrintingId(null)
    }
  }

  const remove = async (doc: MemberDocumentItem) => {
    if (opening || printingId || busyId || retentionBusy) return
    if (confirmId !== doc.id) {
      setConfirmId(doc.id)
      return
    }
    const token = getToken()
    if (!token) return
    setConfirmId(null)
    setBusyId(doc.id)
    try {
      await deleteMyDocument(token, doc.id)
      setItems((prev) => prev.filter((item) => item.id !== doc.id))
      setHint('文档已删除')
    } catch {
      setHint('删除失败，文档可能已到期或被清理')
    } finally {
      setBusyId(null)
    }
  }

  const submitRetention = async (doc: MemberDocumentItem, policy: SelectableRetentionPolicy) => {
    if (opening || printingId || busyId || retentionBusy) return
    const token = getToken()
    if (!token) return
    setRetentionConfirm(null)
    setRetentionBusy({ fileId: doc.id, policy })
    try {
      const result = await updateMyDocumentRetention(token, doc.id, policy)
      setItems((prev) => prev.map((item) => (item.id === doc.id ? applyRetentionUpdate(item, result) : item)))
      setRetentionPanelId(null)
      setHint('保存期限已更新')
    } catch (error) {
      setHint(error instanceof MemberAssetsApiError ? error.message : '设置失败，请稍后重试')
    } finally {
      setRetentionBusy(null)
    }
  }

  const selectRetention = (doc: MemberDocumentItem, policy: SelectableRetentionPolicy) => {
    if (opening || busyId || retentionBusy) return
    if (policy === doc.retentionPolicy) {
      setRetentionPanelId(null)
      return
    }
    if (needsRetentionConsent(policy)) {
      setRetentionConfirm({ fileId: doc.id, policy })
      return
    }
    void submitRetention(doc, policy)
  }

  const now = Date.now()
  const isAnyPending = Boolean(opening || printingId || busyId || retentionBusy)
  const confirmDoc = retentionConfirm ? items.find((item) => item.id === retentionConfirm.fileId) : null

  return (
    <MeListShell
      title="我的文档"
      subtitle="本人保存的文档（仅本人可见，到期自动清理）"
      loginFrom="/me/documents"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
      isEmpty={items.length === 0}
      emptyIcon={FilesIcon}
      emptyTitle="还没有文档"
      emptyDescription="保存简历 / 打印材料等文档后，这里会显示你的文档记录"
    >
      {hint && (
        <div role="status" className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {hint}
        </div>
      )}
      {retentionConfirm && confirmDoc && (
        <RetentionConfirmOverlay
          policy={retentionConfirm.policy}
          onCancel={() => setRetentionConfirm(null)}
          onConfirm={() => void submitRetention(confirmDoc, retentionConfirm.policy)}
          busy={retentionBusy?.fileId === retentionConfirm.fileId}
        />
      )}
      {items.map((doc) => {
        const expired = doc.expiresAt !== null && new Date(doc.expiresAt).getTime() < now
        const confirming = confirmId === doc.id
        const busy = busyId === doc.id
        const openingThis = opening === doc.id
        const printingThis = printingId === doc.id
        const printable = doc.mimeType === 'application/pdf' || doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/png'
        const viewDisabled = expired || isAnyPending
        const printDisabled = expired || !printable || isAnyPending
        const deleteDisabled = isAnyPending
        const policies = selectablePolicies(doc)
        const canChangeRetention = !expired && policies.length > 1
        const retentionOpen = retentionPanelId === doc.id
        return (
          <Card key={doc.id} className="flex items-center gap-4 p-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50">
              <FilesIcon className="h-6 w-6 text-blue-600" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-900">{doc.filename}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">
                {formatBytes(doc.sizeBytes)} · {formatTime(doc.createdAt)}
                {doc.expiresAt === null ? ' · 长期保存' : expired ? ' · 已到期' : ` · 有效期至 ${formatTime(doc.expiresAt)}`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-1 font-medium text-gray-500">
                  <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {retentionLabel(doc.retentionPolicy, doc.expiresAt)}
                </span>
                {canChangeRetention && (
                  <button
                    type="button"
                    disabled={isAnyPending}
                    onClick={() => setRetentionPanelId(retentionOpen ? null : doc.id)}
                    className={[
                      'rounded-full px-2 py-1 font-medium transition-colors',
                      isAnyPending ? 'cursor-not-allowed text-gray-300' : 'bg-blue-50 text-blue-600 hover:bg-blue-100',
                    ].join(' ')}
                  >
                    修改保存期限
                  </button>
                )}
              </div>
              {retentionOpen && canChangeRetention && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {policies.map((policy) => {
                    const active = policy === doc.retentionPolicy || (policy === 'long_term' && doc.expiresAt === null)
                    const retentionButtonBusy = retentionBusy?.fileId === doc.id && retentionBusy.policy === policy
                    return (
                      <button
                        key={policy}
                        type="button"
                        disabled={isAnyPending || active}
                        onClick={() => selectRetention(doc, policy)}
                        className={[
                          'h-9 rounded-lg border px-3 text-xs font-semibold transition-colors',
                          active
                            ? 'border-primary-200 bg-primary-50 text-primary-600'
                            : isAnyPending
                              ? 'cursor-not-allowed border-gray-100 text-gray-300'
                              : 'border-gray-200 text-gray-600 hover:bg-primary-50 hover:text-primary-600',
                        ].join(' ')}
                      >
                        {retentionButtonBusy ? '保存中' : RETENTION_LABELS[policy]}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                disabled={viewDisabled}
                onClick={() => void open(doc)}
                className={[
                  'flex h-12 shrink-0 items-center gap-1 rounded-lg border px-4 text-sm font-medium transition-colors',
                  viewDisabled
                    ? 'cursor-not-allowed border-gray-100 text-gray-300'
                    : 'border-gray-200 text-gray-600 hover:bg-blue-50 hover:text-blue-600',
                ].join(' ')}
              >
                <EyeIcon className="h-4 w-4" aria-hidden="true" />
                {expired ? '已到期' : openingThis ? '打开中' : '查看'}
              </button>
              <button
                type="button"
                disabled={printDisabled}
                onClick={() => void print(doc)}
                title={printable ? '打印文档' : '该文件格式暂不支持打印'}
                className={[
                  'flex h-12 shrink-0 items-center gap-1 rounded-lg border px-4 text-sm font-medium transition-colors',
                  printDisabled
                    ? 'cursor-not-allowed border-gray-100 text-gray-300'
                    : 'border-gray-200 text-gray-600 hover:bg-primary-50 hover:text-primary-600',
                ].join(' ')}
              >
                <PrinterIcon className="h-4 w-4" aria-hidden="true" />
                {printingThis ? '准备中' : '打印'}
              </button>
              <button
                type="button"
                disabled={deleteDisabled}
                onClick={() => void remove(doc)}
                title={confirming ? '再次点击确认删除' : '删除'}
                aria-label={confirming ? `再次点击确认删除文档 ${doc.filename}` : `删除文档 ${doc.filename}`}
                className={[
                  'flex h-12 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors',
                  deleteDisabled
                    ? 'cursor-not-allowed border-gray-100 text-gray-300'
                    : confirming
                      ? 'border-red-300 bg-red-50 text-red-600'
                      : 'border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500',
                ].join(' ')}
              >
                <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                {busy ? <span className="ml-1">删除中</span> : confirming && <span className="ml-1">确认删除</span>}
              </button>
            </div>
          </Card>
        )
      })}
      <p className="mt-1 text-center text-xs text-gray-400">文件仅本人可查看和打印；访问链接短期有效，保存期限以文件卡片为准；原始简历/求职材料默认 90 天，AI 优化成果确认后可长期保存</p>
    </MeListShell>
  )
}
