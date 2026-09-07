// ============================================================
// 我的文档 — /me/documents（本人，只读元数据）。
// 列表只给 downloadUrlPath/previewUrlPath；查看时凭本人 token 现换 TTL 受控签名 URL
// （fetchAccessUrl），过期文档诚实置灰不可打开；保存期限以后端返回的 retentionPolicy 为准。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { useNavigate } from 'react-router-dom'
import { Card } from '@ai-job-print/ui'
import type { FileRetentionPolicy, FileRetentionUpdateRequest, MemberDocumentItem } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FilesIcon, Trash2Icon } from 'lucide-react'
import {
  deleteMyDocument,
  fetchAccessUrl,
  getMyDocuments,
  MemberAssetsApiError,
  updateMyDocumentRetention,
} from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { FileContentPreview } from '../../../components/FileContentPreview'
import { KIcon } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import { DocumentConvertAction } from './components/DocumentConvertAction'
import { DOCUMENT_NOT_REPRINTABLE_COPY, isDocumentReprintable } from './components/documentReprint'
import { RetentionConfirmOverlay } from './components/RetentionConfirmOverlay'
import './me-detail-inkpaper.css'

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

/** 允许跳转「签名盖章」的文档用途白名单——普通打印文档、简历、求职信等；不含高敏证件类。 */
const SIGNABLE_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])

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

/** 结果卡预览/打印仍走本页 open/print；列表刷新前用源文件元数据 + 新 fileId 换短期链接。 */
function documentForConvertedPdf(
  items: MemberDocumentItem[],
  fileId: string,
  source: MemberDocumentItem,
): MemberDocumentItem {
  return items.find((item) => item.id === fileId) ?? {
    ...source,
    id: fileId,
    mimeType: 'application/pdf',
    downloadUrlPath: `/files/${fileId}/download-url`,
    previewUrlPath: `/files/${fileId}/preview-url`,
  }
}

export function MyDocumentsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberDocumentItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; filename: string; mimeType: string } | null>(null)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [signingId, setSigningId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [retentionPanelId, setRetentionPanelId] = useState<string | null>(null)
  const [retentionBusy, setRetentionBusy] = useState<{ fileId: string; policy: SelectableRetentionPolicy } | null>(null)
  const [retentionConfirm, setRetentionConfirm] = useState<{ fileId: string; policy: SelectableRetentionPolicy } | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  useInkRipple('.me-inkdetail .me-ripple')

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
    if (opening || printingId || signingId || busyId || retentionBusy || convertingId) return
    const token = getToken()
    if (!token) return
    setOpening(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      setPreview({ url: res.url, filename: doc.filename, mimeType: doc.mimeType })
    } catch {
      setHint('文档打开失败，可能已到期或被清理')
    } finally {
      setOpening(null)
    }
  }

  const print = async (doc: MemberDocumentItem) => {
    if (opening || printingId || signingId || busyId || retentionBusy || convertingId) return
    if (!isDocumentReprintable(doc)) {
      setHint(DOCUMENT_NOT_REPRINTABLE_COPY)
      return
    }
    const token = getToken()
    if (!token) return
    setPrintingId(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      if (!res.printFileUrl) throw new Error('打印链接未就绪')
      navigate('/print/confirm', {
        state: {
          file: {
            name: doc.filename,
            size: formatBytes(doc.sizeBytes),
            pages: null,
            fileUrl: res.printFileUrl,
            mimeType: doc.mimeType,
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (error) {
      setHint(userMessageOf(error, '打印链接生成失败，可能已到期或被清理'))
    } finally {
      setPrintingId(null)
    }
  }

  const signStamp = async (doc: MemberDocumentItem) => {
    if (opening || printingId || signingId || busyId || retentionBusy || convertingId) return
    const token = getToken()
    if (!token) return
    setSigningId(doc.id)
    try {
      const res = await fetchAccessUrl(doc.previewUrlPath, token)
      if (!res.printFileUrl) throw new Error('文件访问凭证生成失败')
      navigate('/print-scan/sign', {
        state: {
          presetDocument: {
            fileId: doc.id,
            fileAccessUrl: res.printFileUrl,
            name: doc.filename,
            sizeBytes: doc.sizeBytes,
          },
        },
      })
    } catch (error) {
      setHint(userMessageOf(error, '打开签名盖章失败，文件可能已到期或被清理'))
    } finally {
      setSigningId(null)
    }
  }

  const remove = async (doc: MemberDocumentItem) => {
    if (opening || printingId || signingId || busyId || retentionBusy || convertingId) return
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
    if (opening || printingId || signingId || busyId || retentionBusy || convertingId) return
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
    if (opening || signingId || busyId || retentionBusy || convertingId) return
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
  const isAnyPending = Boolean(opening || printingId || signingId || busyId || retentionBusy || convertingId)
  const confirmDoc = retentionConfirm ? items.find((item) => item.id === retentionConfirm.fileId) : null

  return (
    <div className="me-inkdetail me-inkdetail-documents h-full">
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
          <div role="status" className="me-toast fixed left-1/2 top-4 z-50 -translate-x-1/2 px-5 py-2.5">
            {hint}
          </div>
        )}
        {preview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5">
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="document-preview-title"
              className="flex h-[min(86vh,900px)] w-[min(92vw,820px)] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            >
              <header className="flex min-h-14 items-center gap-4 border-b border-neutral-200 px-5">
                <h2 id="document-preview-title" className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900">
                  {preview.filename}
                </h2>
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="me-ripple min-h-12 rounded-md px-4 text-sm font-semibold text-primary-700"
                >
                  关闭预览
                </button>
              </header>
              <FileContentPreview
                className="min-h-0 flex-1 rounded-none border-0"
                fileUrl={preview.url}
                fileName={preview.filename}
                mimeType={preview.mimeType}
              />
            </section>
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
        <section className="me-detail-summary" aria-label="文档概览">
          <span className="me-summary-icon me-tone-slate" aria-hidden="true">
            <KIcon name="files" />
          </span>
          <div className="min-w-0 flex-1">
            <p>文档资产</p>
            <strong>{items.length}</strong>
            <span>查看和打印时才换取短期访问链接；到期或删除后不可恢复</span>
          </div>
          <div className="me-summary-mini" aria-label="文档状态数量">
            <span>可用 {items.filter((doc) => doc.expiresAt === null || new Date(doc.expiresAt).getTime() >= now).length}</span>
            <span>长期 {items.filter((doc) => doc.expiresAt === null).length}</span>
            <span>到期 {items.filter((doc) => doc.expiresAt !== null && new Date(doc.expiresAt).getTime() < now).length}</span>
          </div>
        </section>
        {items.map((doc) => {
          const expired = doc.expiresAt !== null && new Date(doc.expiresAt).getTime() < now
          const confirming = confirmId === doc.id
          const busy = busyId === doc.id
          const openingThis = opening === doc.id
          const printingThis = printingId === doc.id
          const printable = doc.mimeType === 'application/pdf' || doc.mimeType === 'image/jpeg' || doc.mimeType === 'image/png'
          const reprintBlocked = !isDocumentReprintable(doc)
          const viewDisabled = expired || isAnyPending
          const printDisabled = expired || !printable || isAnyPending || reprintBlocked
          const deleteDisabled = isAnyPending
          const policies = selectablePolicies(doc)
          const canChangeRetention = !expired && policies.length > 1
          const retentionOpen = retentionPanelId === doc.id
          return (
            <Card key={doc.id} className="me-document-card">
              <span className="me-row-icon me-tone-slate" aria-hidden="true">
                <KIcon name="files" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="me-row-title">{doc.filename}</p>
                <p className="me-row-meta">
                  {formatBytes(doc.sizeBytes)} · {formatTime(doc.createdAt)}
                  {doc.expiresAt === null ? ' · 长期保存' : expired ? ' · 已到期' : ` · 有效期至 ${formatTime(doc.expiresAt)}`}
                </p>
                <div className="me-doc-chips">
                  <span className={['me-chip', expired ? 'is-danger' : ''].join(' ')}>
                    <KIcon name="clock" />
                    {retentionLabel(doc.retentionPolicy, doc.expiresAt)}
                  </span>
                  {canChangeRetention && (
                    <button
                      type="button"
                      disabled={isAnyPending}
                      onClick={() => setRetentionPanelId(retentionOpen ? null : doc.id)}
                      className={['me-ripple me-doc-retention-toggle', isAnyPending ? 'is-disabled' : ''].join(' ')}
                    >
                      修改保存期限
                    </button>
                  )}
                </div>
                {retentionOpen && canChangeRetention && (
                  <div className="me-doc-retention-options">
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
                            'me-ripple me-doc-retention-option',
                            active ? 'is-active' : '',
                            isAnyPending ? 'is-disabled' : '',
                          ].join(' ')}
                        >
                          {retentionButtonBusy ? '保存中' : RETENTION_LABELS[policy]}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="me-doc-actions">
                <button
                  type="button"
                  disabled={viewDisabled}
                  onClick={() => void open(doc)}
                  className={['me-ripple me-doc-action', viewDisabled ? 'is-disabled' : ''].join(' ')}
                >
                  <KIcon name="eye" />
                  {expired ? '已到期' : openingThis ? '打开中' : '查看'}
                </button>
                <button
                  type="button"
                  disabled={printDisabled}
                  aria-disabled={reprintBlocked || undefined}
                  aria-describedby={reprintBlocked ? `doc-print-blocked-${doc.id}` : undefined}
                  onClick={() => { if (reprintBlocked) return; void print(doc) }}
                  title={reprintBlocked ? DOCUMENT_NOT_REPRINTABLE_COPY : printable ? '打印文档' : '该文件格式暂不支持打印'}
                  className={['me-ripple me-doc-action', printDisabled ? 'is-disabled' : ''].join(' ')}
                >
                  <KIcon name="printer" />
                  {reprintBlocked ? '重新打印' : printingThis ? '准备中' : '打印'}
                </button>
                {reprintBlocked && (
                  <p id={`doc-print-blocked-${doc.id}`} className="me-row-meta" role="status">
                    {DOCUMENT_NOT_REPRINTABLE_COPY}
                  </p>
                )}
                <DocumentConvertAction
                  fileId={doc.id}
                  fileName={doc.filename}
                  mimeType={doc.mimeType}
                  token={getToken()}
                  busy={isAnyPending}
                  reprintable={isDocumentReprintable(doc)}
                  onConverted={() => {
                    void getMyDocuments(getToken(), { pageSize: 50 })
                      .then((r) => setItems(r.items))
                      .catch(() => undefined)
                  }}
                  onError={setHint}
                  onBusyChange={(next) => setConvertingId(next ? doc.id : null)}
                  onPreview={(convertedId) => void open(documentForConvertedPdf(items, convertedId, doc))}
                  onPrint={(convertedId) => void print(documentForConvertedPdf(items, convertedId, doc))}
                />
                {doc.mimeType === 'application/pdf' && SIGNABLE_PURPOSES.has(doc.purpose) && (
                  <button
                    type="button"
                    disabled={isAnyPending}
                    onClick={() => void signStamp(doc)}
                    title="在该文档上叠加签名或印章图片"
                    className={['me-ripple me-doc-action', isAnyPending ? 'is-disabled' : ''].join(' ')}
                  >
                    <KIcon name="swap" />
                    {signingId === doc.id ? '准备中' : '签名盖章'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={deleteDisabled}
                  onClick={() => void remove(doc)}
                  title={confirming ? '再次点击确认删除' : '删除'}
                  aria-label={confirming ? `再次点击确认删除文档 ${doc.filename}` : `删除文档 ${doc.filename}`}
                  className={['me-ripple me-delete-button', confirming ? 'is-confirm' : '', deleteDisabled ? 'is-disabled' : ''].join(' ')}
                >
                  <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                  {busy ? <span className="ml-1">删除中</span> : confirming && <span className="ml-1">确认删除</span>}
                </button>
              </div>
            </Card>
          )
        })}
        <p className="me-legal-note">文件仅本人可查看和打印；访问链接短期有效，保存期限以文件卡片为准；原始简历/求职材料默认 90 天，AI 优化成果确认后可长期保存</p>
      </MeListShell>
    </div>
  )
}
