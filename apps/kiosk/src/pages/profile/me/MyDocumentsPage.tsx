import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// ============================================================
// 我的文档 — /me/documents（本人，只读元数据）。视觉真值：稿 38-member-assets（青序流光）。
// 列表只给 downloadUrlPath/previewUrlPath；查看时凭本人 token 现换 TTL 受控签名 URL
// （fetchAccessUrl），过期文档诚实置灰不可打开；保存期限以后端返回的 retentionPolicy 为准。
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { FILE_DEFAULT_TTL_HOURS, type FileRetentionPolicy, type FileRetentionUpdateRequest, type MemberDocumentItem } from '@ai-job-print/shared'
import {
  deleteMyDocument,
  fetchAccessUrl,
  getMyDocuments,
  MemberAssetsApiError,
  updateMyDocumentRetention,
} from '../../../services/api/memberAssets'
import { documentsLoggedInTruth, resultIdleLogoutLabel } from '../../../auth/kioskIdleTiming'
import { useAuth } from '../../../auth/useAuth'
import { whenMiniapp } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { FileContentPreview } from '../../../components/FileContentPreview'
import { formatTime } from '../assets/format'
import { useStartPrintHandoff } from '../../print/usePrintHandoff'
import { DocumentConvertAction } from './components/DocumentConvertAction'
import {
  DOCUMENT_NOT_REPRINTABLE_COPY,
  documentNeedsPrintMaterialCheck,
  documentPrintSource,
  isDocumentReprintable,
} from './components/documentReprint'
import { RetentionConfirmOverlay } from './components/RetentionConfirmOverlay'
import { QxMePage, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from './qx/QxMeStateBits'
import { MeActs, MeBtn, MeP, MeRow, MeRows } from '../touch/MeKit'
import { MeEmptyPack, MeExitCard } from '../touch/MeStatePacks'
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

/** 允许跳转「签名」的文档用途白名单——普通打印文档、简历、求职信等；不含高敏证件类。 */
const SIGNABLE_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])

type SelectableRetentionPolicy = FileRetentionUpdateRequest['retentionPolicy']
type Hint = { tone: 'ok' | 'bad'; text: string }

/**
 * 保存期限的说法。短期保存只对「打印件、普通敏感级、系统短期留存」这一种写小时数（共享常量），
 * 别的短期保存仍只写「短期保存」，不替服务端多说一个没核对过的时长。
 */
function retentionLabel(doc: Pick<MemberDocumentItem, 'retentionPolicy' | 'expiresAt' | 'purpose' | 'sensitiveLevel'>): string {
  const { retentionPolicy: policy, expiresAt } = doc
  if (policy === 'system_short' && doc.purpose === 'print_doc' && doc.sensitiveLevel === 'normal') {
    return `短期保存，约 ${FILE_DEFAULT_TTL_HOURS.normal} 小时`
  }
  if (policy && RETENTION_LABELS[policy]) return RETENTION_LABELS[policy]
  if (expiresAt === null) return '长期保存'
  return '到期自动清理'
}

function extLabel(filename: string, mimeType: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot > 0 && dot < filename.length - 1) return filename.slice(dot + 1).toUpperCase()
  return mimeType.split('/')[1]?.toUpperCase() ?? '文件'
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

function isPrintableMime(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType === 'image/jpeg' || mimeType === 'image/png'
}

export function MyDocumentsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const pickPrint = searchParams.get('pick') === 'print' || (location.state as { pick?: string } | null)?.pick === 'print'
  const startPrint = useStartPrintHandoff()
  const { isLoggedIn, getToken } = useAuth()
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
  const [openDocId, setOpenDocId] = useState<string | null>(null)
  const miniappLine = whenMiniapp(useSupportContact(isLoggedIn), '在手机小程序登录后传的文件也会出现在这里。')

  const token = getToken()
  const fetchPage = useCallback((cursor?: string) => getMyDocuments(token, { pageSize: 50, cursor }), [token])
  const pagination = useMemberCursorPage<MemberDocumentItem>({ enabled: isLoggedIn, identityKey: token, reloadKey, fetchPage })
  const { items, state: state, setItems } = pagination
  const listed = pickPrint
    ? [...items].sort((a, b) => Number(isPrintableMime(b.mimeType)) - Number(isPrintableMime(a.mimeType)))
    : items

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

  /**
   * @param convertedFrom 刚在本页把这份原件转成 PDF 时的原件。转换件在服务端是派生，
   *   但装的是本人原件的内容：按原件过材料检查（9/29 产品负责人拍板）。
   */
  const print = async (doc: MemberDocumentItem, convertedFrom?: MemberDocumentItem) => {
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
      const file = {
        name: doc.filename,
        size: formatBytes(doc.sizeBytes),
        pages: null,
        fileId: doc.id,
        fileUrl: res.printFileUrl,
        mimeType: doc.mimeType,
      }
      // 本人原件：生产隐私闸门要求先做完隐私检查才建单，检查只在打印台材料检查里做；
      // 派生产物（AI 报告、优化稿……）免检查，直达报价确认页。入口由 printHandoffPolicy 按 requiresCheck 定。
      // 写法与打印上传页相同：先整份写打印交接上下文（旧检查结论、旧参数一并作废），跳转只带交接编号。
      const requiresCheck = documentNeedsPrintMaterialCheck(doc, convertedFrom)
      startPrint({
        origin: 'my_documents',
        requiresCheck,
        source: documentPrintSource(convertedFrom ?? doc),
        returnPath: '/me/documents',
        file,
        idDocument: doc.purpose === 'id_scan' || convertedFrom?.purpose === 'id_scan',
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
      setHint({ tone: 'bad', text: userMessageOf(error, '打开签名失败，文件可能已到期或被清理') })
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
      // 游标就是已加载的最后一条的 id；删掉的正是它时，「加载更多」会拿到空页，只好整表重拉。
      // 其余情况游标照样有效，就地移除即可，不闪骨架、也不把已加载的几页收回第一页。
      if (pagination.nextCursor === doc.id) setReloadKey((key) => key + 1)
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
  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 && !pagination.nextCursor ? 'empty' : 'ready'

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看我的文档" printPick={pickPrint} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载我的文档" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (items.length === 0 && !pagination.nextCursor) {
    body = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack sentence={`登录后上传的文档才会出现在这里。游客上传的文件不会自动归入你的账号。${miniappLine ? '在手机小程序登录后传的文件也会出现在这里。' : ''}`}>
          {pickPrint
            ? <MeExitCard art="resume" artWidth={200} tall title="返回选文件" desc="回到刚才的打印" onClick={() => navigate('/print/upload')} />
            : <MeExitCard art="phone" artWidth={150} tall title="去打印" desc="U 盘、手机或扫描都可以" onClick={() => navigate('/print/upload')} />}
          <MeExitCard art="report" artWidth={180} tall title="看看打印订单" desc="已经打过的，进度在订单里" onClick={() => navigate('/me/print-orders')} />
        </MeEmptyPack>
      </div>
    )
  } else {
    body = (
      <>
        {pickPrint ? <p className="me-p">能打印的排在前面。选一份，接着做材料检查。</p> : null}
        <MeRows few={items.length < 7 && openDocId === null} testId="member-assets-list" label="我的文档">
          {(pickPrint ? listed : items).map((doc) => {
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
            const isOpen = openDocId === doc.id
            return (
              <MeRow
                key={doc.id}
                data-testid="member-assets-document"
                data-server-slot="document"
                data-expired={expired ? 'true' : undefined}
                open={isOpen}
                dim={expired}
                onToggle={() => { setOpenDocId(isOpen ? null : doc.id); setConfirmId(null); setRetentionPanelId(null) }}
                title={<span className="qx-me-asset-name">{doc.filename}</span>}
                lines={[`${extLabel(doc.filename, doc.mimeType)} · ${formatBytes(doc.sizeBytes)} · ${formatTime(doc.createdAt)} · ${expired ? '已到期' : retentionLabel(doc)}`]}
                foot={(
                  <>
                    {reprintBlocked ? <p id={`doc-print-blocked-${doc.id}`} className="me-reason" role="status">{DOCUMENT_NOT_REPRINTABLE_COPY}</p> : null}
                    {!reprintBlocked && !printable && !expired ? <p id={`doc-print-format-${doc.id}`} className="me-reason">该文件格式暂不支持打印</p> : null}
                    <DocumentConvertAction
                      fileId={doc.id}
                      fileName={doc.filename}
                      mimeType={doc.mimeType}
                      token={getToken()}
                      busy={isAnyPending}
                      reprintable={isDocumentReprintable(doc)}
                      onConverted={() => setReloadKey((key) => key + 1)}
                      onError={(text) => setHint({ tone: 'bad', text })}
                      onBusyChange={(next) => setConvertingId(next ? doc.id : null)}
                      onPreview={(convertedId) => void open(documentForConvertedPdf(items, convertedId, doc))}
                      onPrint={(convertedId) => void print(documentForConvertedPdf(items, convertedId, doc), doc)}
                    />
                  </>
                )}
                actions={(
                  <MeActs>
                    <MeBtn
                      v={printDisabled ? 'sec' : 'pri'}
                      disabled={printDisabled}
                      aria-disabled={reprintBlocked || undefined}
                      aria-describedby={printReasonId}
                      onClick={() => { if (reprintBlocked) return; void print(doc) }}
                    >
                      {reprintBlocked ? '重新打印' : printingThis ? '准备中' : '打印'}
                    </MeBtn>
                    <MeBtn v="sec" disabled={viewDisabled} onClick={() => void open(doc)}>
                      {expired ? '已到期' : openingThis ? '打开中' : '查看'}
                    </MeBtn>
                    {canChangeRetention ? (
                      <MeBtn v="sec" disabled={isAnyPending} aria-expanded={retentionOpen} onClick={() => setRetentionPanelId(retentionOpen ? null : doc.id)}>
                        修改保存期限
                      </MeBtn>
                    ) : null}
                    {doc.mimeType === 'application/pdf' && SIGNABLE_PURPOSES.has(doc.purpose) ? (
                      <MeBtn v="sec" disabled={isAnyPending} onClick={() => void signStamp(doc)}>
                        {signingId === doc.id ? '准备中' : '签名'}
                      </MeBtn>
                    ) : null}
                    <MeBtn
                      v={confirming ? 'danger' : 'sec'}
                      disabled={deleteDisabled}
                      onClick={() => void remove(doc)}
                      aria-label={confirming ? `再次点击确认删除文档 ${doc.filename}` : `删除文档 ${doc.filename}`}
                    >
                      {busy ? '删除中' : confirming ? '再点一次确认删除' : '删除'}
                    </MeBtn>
                  </MeActs>
                )}
                extra={retentionOpen && canChangeRetention ? (
                  <div className="qx-me-asset-options" role="group" aria-label="选择保存期限">
                    <MeP>选一个保存期限。到期后不能恢复。</MeP>
                    <MeActs>
                      {policies.map((policy) => {
                        const active = policy === doc.retentionPolicy || (policy === 'long_term' && doc.expiresAt === null)
                        const retentionButtonBusy = retentionBusy?.fileId === doc.id && retentionBusy.policy === policy
                        return (
                          <MeBtn key={policy} v="sec" disabled={isAnyPending || active} aria-pressed={active} onClick={() => selectRetention(doc, policy)}>
                            {retentionButtonBusy ? '保存中' : RETENTION_LABELS[policy]}
                          </MeBtn>
                        )
                      })}
                    </MeActs>
                  </div>
                ) : null}
              />
            )
          })}
        </MeRows>
        {items.length < 7 && openDocId === null ? (
          <div className="me-stack">
            <MeExitCard art={pickPrint ? 'resume' : 'usb'} artWidth={110} title={pickPrint ? '返回选文件' : '去打印'} desc={pickPrint ? '回到刚才的打印' : 'U 盘、手机或扫描都可以'} onClick={() => navigate('/print/upload')} />
            <MeExitCard art="report" artWidth={100} title="看看打印订单" desc="已经打过的，进度在订单里" onClick={() => navigate('/me/print-orders')} />
          </div>
        ) : null}
      </>
    )
  }

  const ctabar = pickPrint ? null : recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/documents', uiState === 'empty' ? '去打印' : '去打印', () => navigate('/print/upload'))

  return (
    <QxMePage
      title={pickPrint ? '选一份来打印' : '我的文档'}
      view="documents"
      onBack={pickPrint ? () => navigate('/print/upload') : undefined}
      backLabel={pickPrint ? '返回' : undefined}
      sub={pickPrint ? '点一份文档的「打印」，接着做材料检查' : (items.length > 0 ? '文件名、大小、上传时间和保存期限' : '这里还没有文档')}
      screen="member-list"
      screenState={`documents-${uiState}`}
      eyebrow="我的 · 文档"
      fine={isLoggedIn ? `文件仅本人可查看和打印；访问链接短期有效，保存期限以每份文件上写的为准。PDF、JPG、PNG 可以直接打印，Word 请另存为 PDF。原始简历/求职材料默认 90 天，AI 优化成果确认后可长期保存。${documentsLoggedInTruth(resultIdleLogoutLabel())}` : undefined}
      toast={hint}
      ctabar={ctabar}
      overlay={retentionConfirm && confirmDoc ? (
        <RetentionConfirmOverlay
          policy={retentionConfirm.policy}
          onCancel={() => setRetentionConfirm(null)}
          onConfirm={() => void submitRetention(confirmDoc, retentionConfirm.policy)}
          busy={retentionBusy?.fileId === retentionConfirm.fileId}
        />
      ) : undefined}
    >
      {body}
      {isLoggedIn && state === 'ready' ? <MemberLoadMore {...pagination} /> : null}
      {preview && (
        <div className="qx-me-asset-overlay">
          <section role="dialog" aria-modal="true" aria-labelledby="document-preview-title" className="qx-me-asset-dialog">
            <header className="qx-me-asset-dialog-head">
              <h2 id="document-preview-title">{preview.filename}</h2>
              <MeBtn v="sec" onClick={() => setPreview(null)}>关闭预览</MeBtn>
            </header>
            <FileContentPreview className="min-h-0 flex-1 rounded-none border-0" fileUrl={preview.url} fileName={preview.filename} mimeType={preview.mimeType} />
          </section>
        </div>
      )}
    </QxMePage>
  )
}
