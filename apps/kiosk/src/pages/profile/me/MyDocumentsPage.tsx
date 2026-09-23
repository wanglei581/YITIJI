// ============================================================
// 我的文档 — /me/documents（本人，只读元数据）。视觉真值：稿 38-member-assets（青序流光）。
// 列表只给 downloadUrlPath/previewUrlPath；查看时凭本人 token 现换 TTL 受控签名 URL
// （fetchAccessUrl），过期文档诚实置灰不可打开；保存期限以后端返回的 retentionPolicy 为准。
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { useNavigate } from 'react-router-dom'
import type { FileRetentionPolicy, FileRetentionUpdateRequest, MemberDocumentItem } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { ClockIcon, EyeIcon, FilesIcon, FileTextIcon, PenToolIcon, PrinterIcon, ScanLineIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import {
  deleteMyDocument,
  fetchAccessUrl,
  getMyDocuments,
  MemberAssetsApiError,
  updateMyDocumentRetention,
} from '../../../services/api/memberAssets'
import { useAuth } from '../../../auth/useAuth'
import { FileContentPreview } from '../../../components/FileContentPreview'
import { formatTime } from '../assets/format'
import { DocumentConvertAction } from './components/DocumentConvertAction'
import { DOCUMENT_NOT_REPRINTABLE_COPY, isDocumentReprintable } from './components/documentReprint'
import { RetentionConfirmOverlay } from './components/RetentionConfirmOverlay'
import { QxMeGuide, QxMePage, QxMeSummary, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMeStartRow, QxMeStructRow } from './qx/QxMeStateBits'
import './styles/member-records-qx.css'

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
type LoadState = 'loading' | 'error' | 'ready'
type Hint = { tone: 'ok' | 'bad'; text: string }

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
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [hint, setHint] = useState<Hint | null>(null)
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
      setHint({ tone: 'bad', text: '文档打开失败，可能已到期或被清理' })
    } finally {
      setOpening(null)
    }
  }

  const print = async (doc: MemberDocumentItem) => {
    if (opening || printingId || signingId || busyId || retentionBusy || convertingId) return
    if (!isDocumentReprintable(doc)) {
      setHint({ tone: 'bad', text: DOCUMENT_NOT_REPRINTABLE_COPY })
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
      setHint({ tone: 'bad', text: userMessageOf(error, '打印链接生成失败，可能已到期或被清理') })
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
      setHint({ tone: 'bad', text: userMessageOf(error, '打开签名盖章失败，文件可能已到期或被清理') })
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
      setHint({ tone: 'ok', text: '文档已删除' })
    } catch {
      setHint({ tone: 'bad', text: '删除失败，文档可能已到期或被清理' })
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
      setHint({ tone: 'ok', text: '保存期限已更新' })
    } catch (error) {
      setHint({ tone: 'bad', text: error instanceof MemberAssetsApiError ? error.message : '设置失败，请稍后重试' })
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
  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'
  const availableCount = items.filter((doc) => doc.expiresAt === null || new Date(doc.expiresAt).getTime() >= now).length

  const summary = (
    <QxMeSummary
      tone="slate"
      icon={<FilesIcon size={32} />}
      label="文档资产"
      big={items.length}
      desc="查看和打印时才换取短期访问链接；到期或删除后不可恢复"
      minis={[`可用 ${availableCount}`, `长期 ${items.filter((doc) => doc.expiresAt === null).length}`, `到期 ${items.length - availableCount}`]}
    />
  )
  const structMode = !isLoggedIn ? 'lock' : 'error'
  const struct = (
    <>
      <QxMeStructRow icon={FileTextIcon} title="文件名、格式与大小" desc="登录后上传、扫描或生成并保存的文件" mode={structMode} testid="member-assets-struct-documents-0" />
      <QxMeStructRow icon={ClockIcon} title="保存期限" desc="到期时间与可选的留存策略" mode={structMode} testid="member-assets-struct-documents-1" />
      <QxMeStructRow icon={PrinterIcon} title="可以继续办的事" desc="查看、打印、签名盖章与删除" mode={structMode} testid="member-assets-struct-documents-2" />
    </>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看我的文档" desc="公共一体机不会在未登录时展示文件名、保存期限或访问链接；游客上传不会自动归入你的账号。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载我的文档" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock title="文档这次没有加载出来" desc="当前列表没有更新。请检查网络后重试；已保存的文件不会因为这次失败而消失。" struct={struct} />
  } else if (items.length === 0) {
    body = (
      <>
        {summary}
        <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind="empty">
          <span className="qx-me-banner-ico" aria-hidden="true"><FilesIcon size={34} /></span>
          <span className="qx-me-banner-main">
            <h2 className="qx-me-banner-t">还没有文档</h2>
            <span className="qx-me-banner-p">保存简历 / 打印材料等文档后，这里会显示你的文档记录。<b>空就是空</b>，本页不会造几条记录让页面好看。</span>
          </span>
          <span className="qx-me-banner-mini"><i>共 0</i></span>
        </section>
        <section className="qx-me-list qx-me-grow" aria-label="从这里开始添加文件">
          <QxMeStartRow icon={UploadIcon} title="从手机或 U 盘添加文件" desc="登录后上传的文件会出现在这里，之后可以预览和打印" label="添加文件" route="/print/upload" testid="member-assets-start-upload" onClick={() => navigate('/print/upload')} />
          <QxMeStartRow icon={ScanLineIcon} tone="slate" title="扫描纸质材料" desc="把纸质简历或证明扫成 PDF；未登录扫描件不会进入我的文档" label="去扫描" route="/scan" testid="member-assets-start-scan" onClick={() => navigate('/scan')} />
          <div className="qx-me-legal">添加或扫描之后，可以回到这里继续预览、打印和签名盖章。</div>
        </section>
        <QxMeGuide items={[['怎么产生', '登录后上传或扫描', '游客上传不会自动归入你的账号'], ['能做什么', '预览、打印、签名盖章', '从同一份文件继续办'], ['留存', '按服务端期限管理', '到期后无法恢复，需要请提前打印']]} />
      </>
    )
  } else {
    body = (
      <>
        {summary}
        <section className="qx-me-list qx-me-grow" data-testid="member-assets-list" aria-label="我的文档">
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
            // 置灰原因常显在行内：一体机是触屏，没有 hover，写在 title 里永远读不到。
            const printReasonId = reprintBlocked ? `doc-print-blocked-${doc.id}` : !printable && !expired ? `doc-print-format-${doc.id}` : undefined
            return (
              <article key={doc.id} className="qx-me-asset-item" data-server-slot="document" data-expired={expired || undefined} data-testid="member-assets-document">
                <div className="qx-me-asset-main">
                  <span className="qx-me-row-ico" data-tone={expired ? 'off' : 'slate'} aria-hidden="true"><FileTextIcon size={28} /></span>
                  <div className="qx-me-row-main">
                    <p className="qx-me-row-title qx-me-asset-name">{doc.filename}</p>
                    <p className="qx-me-row-sub">
                      {formatBytes(doc.sizeBytes)} · {formatTime(doc.createdAt)}
                      {doc.expiresAt === null ? ' · 长期保存' : expired ? ' · 已到期' : ` · 有效期至 ${formatTime(doc.expiresAt)}`}
                    </p>
                    <div className="qx-me-row-foot">
                      <span className="qx-me-chip" data-tone={expired ? 'bad' : undefined}>
                        <ClockIcon size={16} aria-hidden="true" />
                        {retentionLabel(doc.retentionPolicy, doc.expiresAt)}
                      </span>
                      {canChangeRetention && (
                        <button type="button" disabled={isAnyPending} aria-expanded={retentionOpen} onClick={() => setRetentionPanelId(retentionOpen ? null : doc.id)} className="qx-me-small">
                          修改保存期限
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="qx-me-acts">
                    <button type="button" disabled={viewDisabled} onClick={() => void open(doc)} className="qx-me-small">
                      <EyeIcon size={19} aria-hidden="true" />
                      {expired ? '已到期' : openingThis ? '打开中' : '查看'}
                    </button>
                    <button
                      type="button"
                      disabled={printDisabled}
                      aria-disabled={reprintBlocked || undefined}
                      aria-describedby={printReasonId}
                      onClick={() => { if (reprintBlocked) return; void print(doc) }}
                      className="qx-me-small"
                      data-variant={printDisabled ? undefined : 'primary'}
                    >
                      <PrinterIcon size={19} aria-hidden="true" />
                      {reprintBlocked ? '重新打印' : printingThis ? '准备中' : '打印'}
                    </button>
                    {doc.mimeType === 'application/pdf' && SIGNABLE_PURPOSES.has(doc.purpose) && (
                      <button type="button" disabled={isAnyPending} onClick={() => void signStamp(doc)} title="在该文档上叠加签名或印章图片" className="qx-me-small">
                        <PenToolIcon size={19} aria-hidden="true" />
                        {signingId === doc.id ? '准备中' : '签名盖章'}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={deleteDisabled}
                      onClick={() => void remove(doc)}
                      title={confirming ? '再次点击确认删除' : '删除'}
                      aria-label={confirming ? `再次点击确认删除文档 ${doc.filename}` : `删除文档 ${doc.filename}`}
                      className="qx-me-small"
                      data-variant={confirming ? 'danger' : undefined}
                    >
                      <Trash2Icon size={19} aria-hidden="true" />
                      {busy ? '删除中' : confirming ? '确认删除' : '删除'}
                    </button>
                  </div>
                </div>
                {retentionOpen && canChangeRetention && (
                  <div className="qx-me-asset-options" role="group" aria-label="选择保存期限">
                    {policies.map((policy) => {
                      const active = policy === doc.retentionPolicy || (policy === 'long_term' && doc.expiresAt === null)
                      const retentionButtonBusy = retentionBusy?.fileId === doc.id && retentionBusy.policy === policy
                      return (
                        <button key={policy} type="button" disabled={isAnyPending || active} aria-pressed={active} onClick={() => selectRetention(doc, policy)} className="qx-me-small">
                          {retentionButtonBusy ? '保存中' : RETENTION_LABELS[policy]}
                        </button>
                      )
                    })}
                  </div>
                )}
                {reprintBlocked && <p id={`doc-print-blocked-${doc.id}`} className="qx-me-reason" role="status">{DOCUMENT_NOT_REPRINTABLE_COPY}</p>}
                {!reprintBlocked && !printable && !expired && (
                  <p id={`doc-print-format-${doc.id}`} className="qx-me-reason">该文件格式暂不支持打印</p>
                )}
                <DocumentConvertAction
                  fileId={doc.id}
                  fileName={doc.filename}
                  mimeType={doc.mimeType}
                  token={getToken()}
                  busy={isAnyPending}
                  reprintable={isDocumentReprintable(doc)}
                  onConverted={() => { void getMyDocuments(getToken(), { pageSize: 50 }).then((r) => setItems(r.items)).catch(() => undefined) }}
                  onError={(text) => setHint({ tone: 'bad', text })}
                  onBusyChange={(next) => setConvertingId(next ? doc.id : null)}
                  onPreview={(convertedId) => void open(documentForConvertedPdf(items, convertedId, doc))}
                  onPrint={(convertedId) => void print(documentForConvertedPdf(items, convertedId, doc))}
                />
              </article>
            )
          })}
          <div className="qx-me-legal">文件仅本人可查看和打印；访问链接短期有效，保存期限以文件卡片为准；原始简历/求职材料默认 90 天，AI 优化成果确认后可长期保存</div>
        </section>
      </>
    )
  }

  const ctabar = recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/documents', uiState === 'empty' ? '添加文件' : '添加新文件', () => navigate('/print/upload'))

  return (
    <QxMePage
      title="我的文档"
      view="documents"
      screen="member-list"
      screenState={`documents-${uiState}`}
      eyebrow="MY FILES & ORDERS"
      ask={<>你的文件，<em>随时接着办</em>。</>}
      doing={DOING[uiState]}
      truth="这里只显示当前登录账号的文档；数量与保存期限一律由服务端返回。"
      toast={hint}
      ctabar={ctabar}
    >
      {body}
      {preview && (
        <div className="qx-me-asset-overlay">
          <section role="dialog" aria-modal="true" aria-labelledby="document-preview-title" className="qx-me-asset-dialog">
            <header className="qx-me-asset-dialog-head">
              <h2 id="document-preview-title">{preview.filename}</h2>
              <button type="button" onClick={() => setPreview(null)} className="qx-me-small">关闭预览</button>
            </header>
            <FileContentPreview className="min-h-0 flex-1 rounded-none border-0" fileUrl={preview.url} fileName={preview.filename} mimeType={preview.mimeType} />
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
    </QxMePage>
  )
}

const DOING: Record<'login' | 'loading' | 'error' | 'empty' | 'ready', ReactNode> = {
  login: <>登录后才会显示你的文件；<b>未登录不展示任何文件名</b>。</>,
  loading: <>正在读取最新记录，<b>返回前一律显示「—」</b>。</>,
  error: <>列表这次没有更新，<b>重试不会重复创建记录</b>。</>,
  empty: <>还没有保存的文件。<b>先添加或扫描一份</b>，之后可以从这里继续办。</>,
  ready: <>查看、打印和签名盖章，<b>从同一份文件继续</b>。</>,
}
