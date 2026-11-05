import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPublishedPolicy, type PublishedPolicyLookup, type PolicyPostView } from '../../services/api/policies'
import { createPolicyChecklist, type PolicyChecklistFile } from '../../services/api/policyChecklist'
import { rememberAssistantPolicyQuestion } from '../../services/assistantDraft'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { useKioskLicense } from '../../layouts/KioskLicenseContext'
import { LICENSE_NO_NEW_TASK_REASON } from '../../copy/unattendedCopy'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { QxTouchTile } from '../../components/qingxu/touch/QxTouchTile'
import { QxTouchIcon, type QxTouchIconName } from '../../components/qingxu/touch/QxTouchIcon'
import { useInterviewAiCapabilities } from '../interview/useInterviewAiCapabilities'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import { PolicyChecklistSample, PolicyReadState, PolicyTouchLayout } from './PolicyTouchLayout'
import { policyFileSize, policyLines, policyPhoneExpiry, policyPrintButton, policySourceLink } from './policyModel'
import { policyPublishedOn } from './policyFacts'

const POLICY_REFRESH_MS = 30_000
const POLICY_CHECK_TIMEOUT_MS = 8_000

/** 超时只是未读到，绝不冒充政策已撤下。 */
async function readPolicy(id: string): Promise<PublishedPolicyLookup> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    getPublishedPolicy(id),
    new Promise<PublishedPolicyLookup>((resolve) => { timer = setTimeout(() => resolve({ status: 'failed' }), POLICY_CHECK_TIMEOUT_MS) }),
  ]).finally(() => clearTimeout(timer))
}

/** 稿 policy-min.js 的 dsec：标题前一个图标；「要准备的材料」用方框复选样式（check）。 */
function HandlingSection({ title, value, icon, check = false }: { title: string; value?: string; icon: QxTouchIconName; check?: boolean }) {
  return <section className={check ? 'policy-min-section policy-min-check' : 'policy-min-section'}>
    <h2><QxTouchIcon name={icon} size={30} />{title}</h2>
    <ul>{policyLines(value).map((line, index) => <li key={index}>{line}</li>)}</ul>
  </section>
}

export function PolicyDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const favorites = useFavorites()
  const device = useTerminalDeviceStatus()
  const ai = useInterviewAiCapabilities()
  const winding = useKioskLicense().mode === 'winding-down'
  const startPrint = useStartPrintHandoff()
  const [policy, setPolicy] = useState<PolicyPostView | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'missing' | 'failed' | 'withdrawn'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [printFailed, setPrintFailed] = useState(false)
  const [phoneFile, setPhoneFile] = useState<PolicyChecklistFile | null>(null)
  const alive = useRef(false)
  const actionLock = useRef(false)
  const revision = useRef(0)
  const invalidate = useCallback(() => { revision.current++ }, [])
  const currentPolicy = useRef<PolicyPostView | null>(null)
  const printerReady = useRef(device.printerReady)
  printerReady.current = device.printerReady
  const returnPath = `/renshi?policy=${encodeURIComponent(id)}`
  const withdraw = useCallback(() => {
    revision.current++
    currentPolicy.current = null
    setPolicy(null)
    setPhoneFile(null)
    setPrintFailed(false)
    setPhase('withdrawn')
  }, [])

  useEffect(() => {
    let active = true
    let checking = false
    let recorded = false
    alive.current = true
    revision.current++
    currentPolicy.current = null
    setPolicy(null)
    setPhoneFile(null)
    setPrintFailed(false)
    setPhase('loading')
    const refresh = async (initial: boolean) => {
      if (checking) return
      checking = true
      const readRevision = revision.current
      try {
        const result = await readPolicy(id)
        if (!active || readRevision !== revision.current) return
        if (result.status === 'found') {
          if (currentPolicy.current?.contentVersion !== result.policy.contentVersion) {
            revision.current++
            setPhoneFile(null)
          }
          currentPolicy.current = result.policy
          setPolicy(result.policy)
          setPhase('ready')
          if (!recorded) { recordBrowse(getToken(), 'policy', id); recorded = true }
        } else if (result.status === 'missing') {
          if (initial) { setPolicy(null); setPhase('missing') } else withdraw()
        } else if (initial) setPhase('failed')
      } finally { checking = false }
    }
    void refresh(true)
    const timer = window.setInterval(() => { void refresh(false) }, POLICY_REFRESH_MS)
    return () => { active = false; alive.current = false; invalidate(); window.clearInterval(timer) }
  }, [id, attempt, getToken, withdraw, invalidate])

  const source = policy ? policySourceLink(policy) : null
  const sourceUrl = source?.kind === 'verified' ? source.url : null
  useEffect(() => {
    if (sourceUrl) recordExternalJump(getToken(), 'policy', id, 'external_open')
  }, [getToken, id, sourceUrl])

  async function printChecklist() {
    if (actionLock.current || device.loading || winding || phase !== 'ready') return
    actionLock.current = true
    setBusy(true)
    setPhoneFile(null)
    setPrintFailed(false)
    const startedAt = revision.current
    const phoneOnly = !device.printerReady
    try {
      const result = await createPolicyChecklist(id)
      if (!alive.current || startedAt !== revision.current) return
      if (result.status === 'withdrawn') { withdraw(); return }
      if (result.status === 'failed') { setPrintFailed(true); return }
      // 等待文件时打印机也可能掉线：交接前看最新状态，不能用点击时的旧值。
      if (phoneOnly || !printerReady.current) { setPhoneFile(result.file); return }
      startPrint({
        origin: 'policy_checklist', returnPath,
        file: { name: result.file.filename, size: policyFileSize(result.file.sizeBytes), pages: result.file.pageCount,
          fileId: result.file.fileId, fileUrl: result.file.printFileUrl, mimeType: 'application/pdf' },
      })
    } finally {
      actionLock.current = false
      if (alive.current) setBusy(false)
    }
  }

  const ready = phase === 'ready' && policy
  const title = ready ? policy.title : phase === 'missing' ? '这条政策已经撤下或不在可查看范围'
    : phase === 'withdrawn' ? '这条政策已经撤下' : phase === 'failed' ? '这次没读到' : '正在读取这条政策'
  const printButton = policyPrintButton({ busy, printerReady: device.printerReady, printerLoading: device.loading, blocked: winding })
  return <PolicyTouchLayout compact ask={false} state={phase} title={title}
    eyebrow={ready ? `${policy.sourceName || '发布机构未提供'}发布 · ${policyPublishedOn(policy) ?? '日期未提供'}` : '查政策'}
    primary={ready ? { ...printButton, onClick: () => { void printChecklist() }, testId: 'policy-checklist-print' } : undefined}
    alert={winding ? <p role="status">{LICENSE_NO_NEW_TASK_REASON}</p> : undefined}>
    {ready ? <>
      <HandlingSection title="谁可以申请" value={policy.whoCanApply} icon="user" />
      <HandlingSection title="要准备的材料" value={policy.requiredMaterials} icon="clipboard" check />
      <section className="policy-min-section policy-min-source">
        <div><h2><QxTouchIcon name="landmark" size={30} />去哪办、看原文</h2><ul>{policyLines(policy.whereToApply).map((line, index) => <li key={index}>{line}</li>)}</ul></div>
        <div className="policy-min-qr">
          {source?.kind === 'verified' ? <><SourceUrlQr value={source.url} size={200} />
            <p>扫码打开原文 · 链接发布时已核对属于发布机构登记的官方网站</p><span>{source.host}</span></>
            : <p>{source && 'message' in source ? source.message : ''}</p>}
        </div>
      </section>
      <div className="policy-min-grid policy-min-actions">
        <QxTouchTile icon="sparkle" title={ai.state('assistant_chat') === 'available' ? '问小青这条' : '小青暂时不可用'}
          desc={ai.state('assistant_chat') === 'available' ? '按这条原文解释，不判断能不能领' : '条件、材料、打印、扫码照常'}
          off={winding || ai.state('assistant_chat') !== 'available'} onClick={() => {
            rememberAssistantPolicyQuestion({ id, title: policy.title }); navigate('/assistant')
          }} />
        <QxTouchTile icon="folder" title={isLoggedIn && favorites.isFavorite('policy', id) ? '已收藏 · 点此取消' : '收藏到「我的」'}
          desc={isLoggedIn ? '下次登录在「我的」里找到' : '先登录，存进本人账号'}
          off={winding || (isLoggedIn && favorites.loading)} onClick={() => {
            if (!isLoggedIn) { navigate(`/login?from=${encodeURIComponent(returnPath)}`); return }
            favorites.toggle({ type: 'policy', id, title: policy.title })
          }} />
      </div>
      {printFailed && <section className="policy-min-section" role="alert">
        <p>这次没生成清单，可以再试一次；扫码看原文照常</p>
        <button type="button" className="policy-min-button" disabled={busy || winding} onClick={() => { void printChecklist() }}>重新生成清单</button>
      </section>}
      {phoneFile && <section className="policy-min-section policy-min-phone" role="status">
        {phoneFile.phoneUrl ? <><SourceUrlQr value={phoneFile.phoneUrl} size={220} /><div>
          <h2>用手机扫码下载这份清单</h2><p>{phoneFile.phoneUrlExpiresAt
            ? `链接 ${policyPhoneExpiry(phoneFile.phoneUrlExpiresAt)} 前有效` : '链接到期时刻未提供，请尽快下载'}</p>
          <p>请在手机上保存，链接到期后可以重新生成。</p></div></>
          : <p>这次没拿到手机下载链接，可以扫原文二维码</p>}
      </section>}
    </> : phase === 'loading' || phase === 'failed' ? <PolicyReadState failed={phase === 'failed'} retry={() => setAttempt((value) => value + 1)} /> : <>
      <section className="policy-min-section" role="status"><h2>{phase === 'withdrawn' ? '这条政策已下架' : '这条现在不能查看'}</h2>
        <p>不再显示旧正文、原文二维码和清单。可以返回政策首页查看当前发布内容。</p>
        <button type="button" className="policy-min-button" onClick={() => navigate('/policy-service')}>返回政策首页</button>
        <button type="button" className="policy-min-button" onClick={() => setAttempt((value) => value + 1)}>重新读取</button>
      </section><PolicyChecklistSample />
    </>}
  </PolicyTouchLayout>
}
