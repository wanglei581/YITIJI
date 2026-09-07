import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { canCreateFormalPrintScanTask } from '@ai-job-print/shared'
import { useAuth } from '../../../auth/useAuth'
import { loginPathForCurrentLocation } from '../../../auth/returnPath'
import { useBusyLock } from '../../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../../services/api/files'
import { getTerminalId, isTerminalKiosk } from '../../../services/api/screensaver'
import { loadConfiguredCapabilities } from '../../../services/api/printScanCapabilities'
import { signCompose, signInspect } from '../../../services/api/printSign'
import { errorCodeOf, userMessageOf } from '../../../services/api/userErrorMessage'
import { savePrintMaterialSession } from '../../print/printMaterialSession'
import type { PhoneUploadedFile } from '../../upload/components/UploadSessionQrPanel'
import {
  AUTHORIZATION_LABEL,
  formatBytes,
  FROM_WHITELIST,
  makeIdempotencyKey,
  MAX_DOC_BYTES,
  MAX_STAMP_BYTES,
  placementFingerprint,
} from './constants'
import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import {
  deriveLiveState,
  fixtureLive,
  isLockedPhase,
  mapComposeError,
  mapDocError,
  mapStampError,
  parseSignStampQuery,
  pickPhaseOf,
  pillOf,
  shapeOf,
  statusCopy,
  type CapStatus,
  type ComposePhase,
  type ComposeResult,
  type DocStage,
  type LiveSnapshot,
  type PickedFile,
  type StampStage,
  type ViewMode,
} from './signStampModel'

export { AUTHORIZATION_LABEL }

interface PresetDocumentState {
  presetDocument?: { fileId: string; fileAccessUrl: string; name: string; sizeBytes: number }
}

export function useSignStampFlow() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken, isLoggedIn, ready } = useAuth()
  const query = useMemo(() => parseSignStampQuery(location.search), [location.search])
  const docInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)
  const keyRef = useRef<string | null>(null)
  const fingerprintRef = useRef<string | null>(null)

  const [document, setDocument] = useState<PickedFile | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [stamp, setStamp] = useState<PickedFile | null>(null)
  const [page, setPage] = useState(1)
  const [position, setPosition] = useState<SignStampPosition>('bottom-right')
  const [size, setSize] = useState<SignStampSize>('medium')
  const [authorized, setAuthorized] = useState(false)
  const [result, setResult] = useState<ComposeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [showQr, setShowQr] = useState<'document' | 'stamp' | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [docStage, setDocStage] = useState<DocStage>('idle')
  const [stampStage, setStampStage] = useState<StampStage>('idle')
  const [docErr, setDocErr] = useState<LiveSnapshot['docErr']>(null)
  const [stampErr, setStampErr] = useState<LiveSnapshot['stampErr']>(null)
  const [docJustRead, setDocJustRead] = useState(false)
  const [stampJustAdded, setStampJustAdded] = useState(false)
  const [derived, setDerived] = useState(false)
  const [authReset, setAuthReset] = useState(false)
  const [phase, setPhase] = useState<ComposePhase>('idle')
  const [placeErr, setPlaceErr] = useState<string | null>(null)
  const [outErr, setOutErr] = useState<'render' | 'expired' | null>(null)
  const [oversize, setOversize] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('page')
  const [viewPage, setViewPage] = useState(1)
  const [zoom, setZoom] = useState(0)
  const [pan, setPan] = useState<'br' | null>(null)
  const [cap, setCap] = useState<CapStatus>('loading')
  const [terminalId, setTerminalId] = useState(() => getTerminalId())

  useBusyLock(busy || qrBusy || showQr !== null)

  useEffect(() => {
    setTerminalId(getTerminalId())
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadConfiguredCapabilities().then((result) => {
      if (cancelled) return
      if (result.status === 'error') {
        setCap('error')
        return
      }
      const override = result.map.signature_stamp
      if (!override) {
        setCap('ready')
        return
      }
      if (override.status === 'maintenance') setCap('maintenance')
      else if (canCreateFormalPrintScanTask(override.status)) setCap('ready')
      else setCap('disabled')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const acceptDocument = async (picked: PickedFile) => {
    const tid = getTerminalId()
    if (!tid) {
      setDocErr('document-source-expired')
      return
    }
    setBusy(true)
    setDocStage('inspecting')
    setDocErr(null)
    try {
      const res = await signInspect(
        { terminalId: tid, document: { fileId: picked.fileId, fileAccessUrl: picked.fileAccessUrl } },
        { token: getToken() },
      )
      setDocument(picked)
      setPages(res.pages)
      setPage(res.pages)
      setViewPage(res.pages)
      setResult(null)
      setPhase('idle')
      setDocJustRead(true)
      setStamp(null)
      setAuthorized(false)
      setAuthReset(false)
      setDerived(false)
    } catch (err) {
      const code = errorCodeOf(err)
      if (code === 'MEMBER_SESSION_EXPIRED' || code === 'MEMBER_TOKEN_INVALID' || code === 'MEMBER_AUTH_REQUIRED') {
        setSessionExpired(true)
      } else {
        setDocErr(mapDocError(code) ?? 'document-corrupt')
      }
    } finally {
      setDocStage('idle')
      setBusy(false)
    }
  }

  useEffect(() => {
    const preset = (location.state as PresetDocumentState | null)?.presetDocument
    if (preset && !document) {
      void acceptDocument({
        fileId: preset.fileId,
        fileAccessUrl: preset.fileAccessUrl,
        name: preset.name,
        size: formatBytes(preset.sizeBytes),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleLocalDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (selected.type !== 'application/pdf') {
      setDocErr('document-format-rejected')
      return
    }
    if (selected.size > MAX_DOC_BYTES) {
      setDocErr('document-too-large')
      return
    }
    setBusy(true)
    setDocStage('uploading')
    setDocErr(null)
    try {
      const res = await kioskUploadFile(selected, 'print_doc', getToken())
      await acceptDocument({
        fileId: res.fileId,
        fileAccessUrl: res.signedUrl,
        name: res.filename,
        size: formatBytes(res.sizeBytes),
      })
    } catch (err) {
      setDocErr(mapDocError(errorCodeOf(err)) ?? 'document-corrupt')
      void userMessageOf(err, '文档上传失败，请重试')
    } finally {
      setDocStage('idle')
      setBusy(false)
    }
  }

  const handleLocalStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setStampErr('stamp-format-rejected')
      return
    }
    if (selected.size > MAX_STAMP_BYTES) {
      setStampErr('stamp-too-large')
      return
    }
    setBusy(true)
    setStampStage('uploading')
    setStampErr(null)
    try {
      const res = await kioskUploadFile(selected, 'signature_image', getToken())
      setStamp({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
      setResult(null)
      setPhase('idle')
      setAuthorized(false)
      setAuthReset(true)
      setStampJustAdded(true)
      setDocJustRead(false)
    } catch (err) {
      setStampErr(mapStampError(errorCodeOf(err)) ?? 'stamp-corrupt')
    } finally {
      setStampStage('idle')
      setBusy(false)
    }
  }

  const handlePhoneUploaded = (target: 'document' | 'stamp') => (file: PhoneUploadedFile) => {
    if (!file.fileUrl) {
      if (target === 'document') setDocErr('document-source-expired')
      else setStampErr('stamp-source-expired')
      return
    }
    const picked: PickedFile = { fileId: file.fileId, fileAccessUrl: file.fileUrl, name: file.name, size: file.size }
    setShowQr(null)
    if (target === 'document') {
      void acceptDocument(picked)
    } else {
      setStamp(picked)
      setResult(null)
      setPhase('idle')
      setAuthorized(false)
      setAuthReset(true)
      setStampJustAdded(true)
    }
  }

  const ensureKey = (docId: string, stampId: string) => {
    const fp = placementFingerprint(docId, stampId, page, position, size)
    if (phase === 'result-unknown' && keyRef.current) return keyRef.current
    if (!keyRef.current || fingerprintRef.current !== fp) {
      keyRef.current = makeIdempotencyKey()
      fingerprintRef.current = fp
    }
    return keyRef.current
  }

  const handleCompose = async (retrySame = false) => {
    if (!document || !stamp || pages === null) return
    const tid = getTerminalId()
    if (!tid) return
    const nextPhase: ComposePhase = retrySame ? 'retrying' : 'composing'
    setBusy(true)
    setPhase(nextPhase)
    setOversize(false)
    try {
      const idempotencyKey = ensureKey(document.fileId, stamp.fileId)
      const res = await signCompose(
        {
          terminalId: tid,
          document: { fileId: document.fileId, fileAccessUrl: document.fileAccessUrl },
          stamp: { fileId: stamp.fileId, fileAccessUrl: stamp.fileAccessUrl },
          placement: { page, position, size },
          authorizationConfirmed: true,
        },
        { token: getToken(), idempotencyKey },
      )
      setResult({ ...res, name: `${document.name.replace(/\.pdf$/i, '')}-签章合成.pdf` })
      setPhase(retrySame ? 'recovered' : 'completed')
      setOutErr(null)
      setViewPage(page)
    } catch (err) {
      const code = errorCodeOf(err)
      const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status: number }).status) : undefined
      if (code === 'MEMBER_SESSION_EXPIRED' || code === 'MEMBER_TOKEN_INVALID' || code === 'MEMBER_AUTH_REQUIRED') {
        setSessionExpired(true)
        setStamp(null)
        setAuthorized(false)
        setPhase('idle')
      } else {
        const mapped = mapComposeError(code, status)
        setPhase(mapped)
        setOversize(code === 'SIGN_OUTPUT_TOO_LARGE')
        if (code === 'SIGN_PLACEMENT_INVALID') {
          setPlaceErr(pages ? `这份文档共 ${pages} 页，页码必须在 1–${pages} 之间。` : '页码超出这份文档的范围')
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const goMaterialCheck = () => {
    if (!result) return
    const file = {
      name: result.name,
      size: formatBytes(result.sizeBytes),
      pages: result.pages,
      fileId: result.fileId,
      fileUrl: result.printFileUrl,
      fileMd5: result.fileMd5,
      mimeType: 'application/pdf',
    }
    savePrintMaterialSession({ file, source: 'document' })
    navigate('/print/material-check', { state: { file, source: 'document' } })
  }

  const addAnother = () => {
    if (!result) return
    setDocument({
      fileId: result.fileId,
      fileAccessUrl: result.printFileUrl,
      name: result.name,
      size: formatBytes(result.sizeBytes),
    })
    setPages(result.pages)
    setPage(result.pages)
    setViewPage(result.pages)
    setStamp(null)
    setAuthorized(false)
    setAuthReset(false)
    setResult(null)
    setPhase('idle')
    setDerived(true)
    setPlaceErr(null)
    setOutErr(null)
    keyRef.current = null
    fingerprintRef.current = null
  }

  const live: LiveSnapshot = {
    authReady: ready,
    loggedIn: isLoggedIn,
    sessionExpired,
    fromUnknown: query.fromUnknown,
    terminalId,
    cap,
    doc: document,
    pages,
    docStage: showQr === 'document' ? 'phone' : docStage,
    docErr,
    docJustRead,
    derived,
    stamp,
    stampStage: showQr === 'stamp' ? 'phone' : stampStage,
    stampErr,
    stampJustAdded,
    page,
    position,
    size,
    placeErr,
    authorized,
    authReset,
    phase,
    result,
    outErr,
    oversize,
    viewMode,
    viewPage,
    zoom,
    pan,
  }

  const synthetic = Boolean(query.requested && query.capture)
  const displayLive: LiveSnapshot = synthetic
    ? { ...live, ...fixtureLive(query.requested as NonNullable<typeof query.requested>), authReady: true }
    : live
  const viewState = synthetic && query.requested ? query.requested : deriveLiveState(live)
  const shape = shapeOf(viewState)
  const pickPhase = pickPhaseOf(viewState)
  const status = statusCopy(viewState, displayLive)
  const pill = pillOf(viewState, displayLive)
  const from = query.fromUnknown ? 'hub' : query.from
  const back = FROM_WHITELIST[from]
  const localDisabled = isTerminalKiosk()
  const locked = isLockedPhase(displayLive.phase)

  const openLocal = (kind: 'document' | 'stamp') => {
    if (localDisabled || synthetic) return
    if (kind === 'document') docInputRef.current?.click()
    else stampInputRef.current?.click()
  }

  const cta = resolveCta({
    state: viewState,
    live: displayLive,
    synthetic,
    authorized: displayLive.authorized,
    backLabel: back.label,
  })

  return {
    viewState,
    shape,
    pickPhase,
    status,
    pill,
    displayLive,
    synthetic,
    document: displayLive.doc,
    stamp: displayLive.stamp,
    pages: displayLive.pages,
    page: displayLive.page,
    position: displayLive.position,
    size: displayLive.size,
    placeErr: displayLive.placeErr,
    authorized: displayLive.authorized,
    phase: displayLive.phase,
    result: displayLive.result,
    outErr: displayLive.outErr,
    viewPage: displayLive.viewPage,
    viewMode: displayLive.viewMode,
    zoom: displayLive.zoom,
    pan: displayLive.pan,
    derived: displayLive.derived,
    showQr,
    qrBusy,
    docInputRef,
    stampInputRef,
    localDisabled,
    localDisabledReason: '一体机不打开系统文件选择框，请用手机扫码上传。',
    locked,
    back,
    cta,
    loginHref: loginPathForCurrentLocation(),
    handleLocalDoc,
    handleLocalStamp,
    handlePhoneUploaded,
    handleCompose,
    goMaterialCheck,
    addAnother,
    setShowQr,
    setQrBusy,
    setDocStage,
    setStampStage,
    setPage,
    setPosition,
    setSize,
    setAuthorized,
    setAuthReset,
    setDocJustRead,
    setStampJustAdded,
    setViewMode,
    setViewPage,
    setZoom,
    setPan,
    setOutErr,
    setPlaceErr,
    openLocal,
    retryCap: () => {
      setCap('loading')
      void loadConfiguredCapabilities().then((result) => {
        if (result.status === 'error') setCap('error')
        else if (!result.map.signature_stamp) setCap('ready')
        else if (result.map.signature_stamp.status === 'maintenance') setCap('maintenance')
        else if (canCreateFormalPrintScanTask(result.map.signature_stamp.status)) setCap('ready')
        else setCap('disabled')
      })
    },
    goBack: () => navigate(back.path),
    goLogin: () => navigate(loginPathForCurrentLocation()),
    goHelp: () => navigate('/help'),
    goDocs: () => navigate('/me/documents'),
    navigate,
  }
}

function resolveCta(args: {
  state: ReturnType<typeof deriveLiveState>
  live: LiveSnapshot
  synthetic: boolean
  authorized: boolean
  backLabel: string
}): { primary: string; primaryDisabled: boolean; reason: string | null; action: 'compose' | 'retry' | 'material' | 'login' | 'help' | 'back' | 'retry-cap' | 'none' } {
  const { state, live, synthetic, backLabel } = args
  if (state === 'login-required' || state === 'auth-unknown' || state === 'login-expired') {
    return { primary: state === 'login-expired' ? '重新登录' : '去登录', primaryDisabled: false, reason: null, action: 'login' }
  }
  if (state === 'capability-error') {
    return { primary: '重试读取', primaryDisabled: false, reason: null, action: 'retry-cap' }
  }
  if (state === 'terminal-missing' || state.startsWith('capability-')) {
    return { primary: '联系工作人员', primaryDisabled: false, reason: null, action: 'help' }
  }
  if (state === 'context-missing' || state === 'return-source-unknown') {
    return { primary: `${backLabel}（唯一出口）`, primaryDisabled: false, reason: null, action: 'back' }
  }
  if (live.phase === 'completed' || live.phase === 'recovered') {
    if (live.outErr === 'expired') {
      return { primary: '去材料检查（先重新取链接）', primaryDisabled: true, reason: '链接已过期，重新取一次才能交给材料检查', action: 'none' }
    }
    return { primary: '去材料检查', primaryDisabled: synthetic, reason: synthetic ? '合成演示，不会真正交接文件' : null, action: 'material' }
  }
  if (live.docErr) {
    return { primary: '换一份 PDF 再继续', primaryDisabled: true, reason: '刚才那份没有进入流程，先换一份符合要求的 PDF', action: 'none' }
  }
  if (live.stampErr) {
    return { primary: '换一张图片再继续', primaryDisabled: true, reason: '刚才那张没有进入流程，先换一张 JPG / PNG', action: 'none' }
  }
  if (live.phase === 'composing' || live.phase === 'retrying') {
    return { primary: '正在生成…', primaryDisabled: true, reason: '这一次合成还没有回来，重复提交可能生成两份', action: 'none' }
  }
  if (live.phase === 'result-unknown') {
    return { primary: '用同一次请求重试', primaryDisabled: synthetic, reason: null, action: 'retry' }
  }
  if (live.phase === 'known-failed' || live.phase === 'rate-limited' || live.phase === 'in-progress') {
    return { primary: '重试生成', primaryDisabled: synthetic, reason: live.phase === 'rate-limited' ? '请稍候用同一次请求标识重试，不会静默再发' : null, action: 'retry' }
  }
  if (live.phase === 'conflict') {
    return { primary: '换一次新请求再生成', primaryDisabled: true, reason: '这个请求标识已绑定另一组参数，必须换一次新的请求，不能覆盖上一次', action: 'none' }
  }
  if (!live.doc) {
    return { primary: '选好 PDF 再继续', primaryDisabled: true, reason: '还没有选文档，没有文档就没法选页码和位置', action: 'none' }
  }
  if (!live.stamp) {
    return { primary: '传好签名 / 印章图再继续', primaryDisabled: true, reason: '还没有这次的签名 / 印章图片，没有图就没有可叠加的内容', action: 'none' }
  }
  if (live.placeErr) {
    return { primary: '先改成有效页码', primaryDisabled: true, reason: '页码超出这份文档的范围，服务端会直接拒绝', action: 'none' }
  }
  if (!live.authorized) {
    return {
      primary: '生成合成 PDF（请先确认授权）',
      primaryDisabled: true,
      reason: '还没有勾选授权确认，勾选后才能生成',
      action: 'none',
    }
  }
  return { primary: '生成合成 PDF', primaryDisabled: synthetic, reason: synthetic ? '合成演示，不会真正生成' : null, action: 'compose' }
}
