// ============================================================
// AI 签约风险提示首页 — 上传合同 + 选择类型 + 知情同意
//
// 步骤 1/3。用户上传合同文件，选择合同类型，阅读并确认知情
// 同意书后点击「开始 AI 审查」进入分析阶段。
// 合规：仅作条款风险提示，对外文案不写「法律意见」「律师审查」「判断合同有效」
// （compliance-boundary §1.2 D；门禁 verify:kiosk-ai-label-copy）；原文会话后即弃。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { isTerminalKiosk, useTerminalKiosk } from '../../services/api/screensaver'
import { useNavigate } from 'react-router-dom'
import { Card } from '@ai-job-print/ui'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { ContractTouchFrame } from './ContractTouchFrame'
import { COMPLIANCE_COPY, type ContractType } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
  MonitorSmartphoneIcon,
  QrCodeIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { useAuth } from '../../auth/useAuth'
import { isAiOutage } from '../../ai/aiOutage'
import { useAiTask } from '../../ai/useAiTask'
import { getKioskTerminalConfig, getTerminalId } from '../../services/api/terminalConfig'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { P10BigCard } from '../../auth/CapabilityStayCards'
import '../../auth/capability-gate-touch.css'

import {
  createContractReview,
  createContractReviewFromSource,
  describeDataCategories,
  getConsentScope,
  type ConsentScope,
} from '../../services/api/contractReview'
import { UploadSessionQrPanel } from '../upload/components/UploadSessionQrPanel'

type ContractChannel = 'phone' | 'desktop'
type PhoneSource = { fileId: string; name: string; sizeLabel: string; signedUrl?: string }
import {
  clearContractReviewSession,
  startContractReviewSession,
} from './contractReviewSession'
import './contract-review.css'

const CONTRACT_TYPES: Array<{ key: ContractType; name: string; hint: string }> = [
  { key: 'labor_contract', name: '劳动合同', hint: '正式用工合同' },
  { key: 'internship_agreement', name: '实习协议', hint: '在校生实习用' },
  { key: 'non_compete', name: '竞业限制协议', hint: '含竞业/保密条款' },
  { key: 'offer', name: '录用通知书', hint: 'Offer Letter' },
]

const ACCEPTED = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp'
/** 本机 kiosk-upload 走代理上限 15MB；扫码会话硬上限 10MB。 */
const DESKTOP_MAX_SIZE_MB = 15
/** AI 停用时的说法（稿 contract）：说清做不了什么、还能做什么。 */
const AI_DOWN_NOTICE = 'AI 现在停用，签约风险提示暂时做不了。合同原件可以到打印扫描里直接打印。'
/** 读终端配置的上限：读不回来就按「没确认」放行，不让「正在确认」一直挂着；真停用时请求会如实报错。 */
const AI_STATUS_CHECK_TIMEOUT_MS = 4_000

export function ContractReviewHomePage() {
  const navigate = useNavigate()
  const { getToken, user } = useAuth()

  const [file, setFile] = useState<File | null>(null)
  const [phoneSource, setPhoneSource] = useState<PhoneSource | null>(null)
  const kiosk = useTerminalKiosk()
  const [selectedChannel, setChannel] = useState<ContractChannel>('phone')
  const channel = kiosk ? 'phone' : selectedChannel
  const [contractType, setContractType] = useState<ContractType>('labor_contract')
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentScope, setConsentScope] = useState<ConsentScope | null>(null)
  const [loadingConsent, setLoadingConsent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiDown, setAiDown] = useState(false)
  const [checkingAi, setCheckingAi] = useState(Boolean(getTerminalId()))
  const [drag, setDrag] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const aiStatusRef = useRef<HTMLDivElement>(null)

  // data-aitask：已知停用 → failed；提交中 → running；其余（没有任何确认）→ idle，既不假称在算，也不假称可用。
  const aiTask = useAiTask({ availability: aiDown ? 'unavailable' : submitting ? 'available' : 'unknown', pending: submitting })

  useBusyLock(submitting || qrBusy)

  // 提交失败后才判成停用时，用户多半在页面下方：把说明和「去打印扫描」带回视野。
  useEffect(() => {
    if (aiDown) aiStatusRef.current?.scrollIntoView({ block: 'nearest' })
  }, [aiDown])

  useEffect(() => {
    // 上传页不恢复上一份合同；浏览器返回到这里也立即丢弃易失凭证与结果。
    clearContractReviewSession()
    const terminalId = getTerminalId()
    let mounted = true
    let timer: number | undefined
    if (terminalId) {
      // 终端配置里的 ai.paused 是后台「AI 暂停」开关：打开时分析一定会被拦，所以在请求前就停用并写原因。
      // 读不到（失败或超时）只说明没确认：不说停用，也不说可用，放行后由请求自己如实报错。
      timer = window.setTimeout(() => { if (mounted) setCheckingAi(false) }, AI_STATUS_CHECK_TIMEOUT_MS)
      void getKioskTerminalConfig(terminalId).then((config) => {
        if (mounted && config.ai?.paused === true) setAiDown(true)
      }).catch(() => { /* 没读到 = 没确认，不改状态 */ }).finally(() => {
        window.clearTimeout(timer)
        if (mounted) setCheckingAi(false)
      })
    }
    getConsentScope()
      .then(setConsentScope)
      .catch(() => setError('无法加载知情同意信息，请稍后重试'))
      .finally(() => setLoadingConsent(false))
    return () => { mounted = false; window.clearTimeout(timer) }
  }, [])

  function handleFileChange(f: File | null) {
    if (isTerminalKiosk()) return
    if (!f) return
    if (f.size > DESKTOP_MAX_SIZE_MB * 1024 * 1024) {
      setError(`本机验证文件不能超过 ${DESKTOP_MAX_SIZE_MB}MB`)
      return
    }
    setError(null)
    setPhoneSource(null)
    setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileChange(f)
  }

  async function handleSubmit() {
    if (aiDown || checkingAi || (!file && !phoneSource) || !consentScope || !consentChecked) return
    if (phoneSource && !getToken() && !phoneSource.signedUrl) {
      setError('这份合同还缺少确认凭证，请重新扫码上传')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const consent = {
        consentVersion: consentScope.consentVersion,
        consentScopeHash: consentScope.consentScopeHash,
        disclaimerVersion: consentScope.disclaimer.version,
      }
      const access = { token: getToken() }
      const task = phoneSource
        ? await createContractReviewFromSource(
          { fileId: phoneSource.fileId, signedUrl: phoneSource.signedUrl },
          contractType,
          consent,
          access,
        )
        : await createContractReview(file!, contractType, consent, access)
      startContractReviewSession({
        taskId: task.id,
        accessToken: task.accessToken ?? null,
        contractType,
        expiresAt: task.expiresAt,
        ownerMemberId: user?.id ?? null,
      })
      navigate('/contract-review/processing')
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setAiDown(false)
        setError(declined)
        return
      }
      // AI 停用（暂停 / 当日额度已到 / 未配置）不是文件的问题，换文件重试也不会变好。
      setAiDown(isAiOutage(err))
      setError(isAiOutage(err) ? AI_DOWN_NOTICE : '创建审查任务失败，请检查文件格式后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const selectedName = file?.name ?? phoneSource?.name ?? null
  const canSubmit = Boolean(selectedName) && consentChecked && !loadingConsent && !submitting && !aiDown && !checkingAi

  return (
    <ContractTouchFrame>
    <QxTouchScreen
      testId="contract-touch"
      stateId="upload"
      bodyClassName="qxt-body-scroll"
      band={(
        <QxTouchBand
          seal={null}
          eyebrow="签约风险提示"
          title="AI 签约风险提示"
          sub={COMPLIANCE_COPY.KIOSK_CONTRACT_REVIEW_SCOPE}
          onBack={() => navigate('/resume-service')}
          rail={{ labels: ['上传合同', 'AI 分析', '查看结果'], now: 0 }}
          status={{ text: aiDown ? 'AI 现在停用' : '等待上传', tone: aiDown ? 'warn' : 'unknown' }}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={() => navigate('/resume-service')}
          backLabel="返回简历服务"
          ask={aiDown ? { label: '小青暂时不可用，可先打印', disabled: true } : { label: '问小青：上传前要看什么？', draft: '上传前要看什么？请只说明流程，不要下结论。' }}
          primary={{
            label: submitting ? '上传中…' : '开始风险分析',
            disabled: !canSubmit,
            onClick: handleSubmit,
          }}
        />
      )}
    >
        <div ref={aiStatusRef} {...aiTask.containerProps} role="status" className={aiDown ? 'cr-failed' : undefined}>
          {aiDown ? (
            <>
              <p className="cr-failed__warn">{AI_DOWN_NOTICE}</p>
              <P10BigCard
                icon="printer"
                title="去打印扫描"
                desc="不用 AI，也可以先把合同打出来自己看。"
                cta="去打印扫描"
                onClick={() => navigate('/print-scan')}
              />
            </>
          ) : checkingAi ? '正在确认 AI 服务状态。' : submitting ? '正在提交合同，等待服务响应。' : null}
        </div>
        {/* 步骤指示器 */}
        <div className="cr-steps">
          <div className="cr-step cr-step--active">
            <div className="cr-step__dot">1</div>
            <span className="cr-step__label">上传合同</span>
          </div>
          <div className="cr-step-line" />
          <div className="cr-step">
            <div className="cr-step__dot">2</div>
            <span className="cr-step__label">AI 分析</span>
          </div>
          <div className="cr-step-line" />
          <div className="cr-step">
            <div className="cr-step__dot">3</div>
            <span className="cr-step__label">查看结果</span>
          </div>
        </div>

        {/* 上传区 */}
        <Card>
          <p className="text-sm font-semibold text-muted mb-4" style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>
            上传合同文件
          </p>
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={channel === 'phone'}
              className={`cr-type-btn${channel === 'phone' ? ' cr-type-btn--active' : ''}`}
              onClick={() => setChannel('phone')}
            >
              <span className="cr-type-btn__name"><QrCodeIcon className="mr-2 inline h-5 w-5" aria-hidden="true" />手机扫码上传</span>
              <span className="cr-type-btn__hint">一体机主通道 · 单个不超过 10MB</span>
            </button>
            {!isTerminalKiosk() && (
              <button
                type="button"
                aria-pressed={channel === 'desktop'}
                className={`cr-type-btn${channel === 'desktop' ? ' cr-type-btn--active' : ''}`}
                onClick={() => setChannel('desktop')}
              >
                <span className="cr-type-btn__name"><MonitorSmartphoneIcon className="mr-2 inline h-5 w-5" aria-hidden="true" />本机文件（桌面验证）</span>
                <span className="cr-type-btn__hint">E2E / 桌面浏览器 · 不超过 {DESKTOP_MAX_SIZE_MB}MB</span>
              </button>
            )}
          </div>
          {!kiosk && (
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
          )}
          {channel === 'phone' ? (
            selectedName && phoneSource ? (
              <div className="cr-upload-zone cr-upload-zone--filled">
                <div className="cr-upload-icon"><FileTextIcon /></div>
                <p className="cr-upload-filename">{phoneSource.name}</p>
                <p className="cr-upload-hint">{phoneSource.sizeLabel} · 手机扫码已确认</p>
              </div>
            ) : (
              <UploadSessionQrPanel
                purpose="contract_upload"
                title="手机扫码上传合同"
                description="手机只负责上传合同文件；一体机确认后才开始风险分析。单个不超过 10MB。"
                confirmLabel="确认使用这份合同"
                onUploaded={(uploaded) => {
                  setFile(null)
                  setPhoneSource({
                    fileId: uploaded.fileId,
                    name: uploaded.name,
                    sizeLabel: uploaded.size,
                    signedUrl: uploaded.fileUrl,
                  })
                  setError(null)
                }}
                onBusyChange={setQrBusy}
              />
            )
          ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label={file ? `已选择 ${file.name}，点击重新选择合同文件` : '选择合同文件'}
            className={[
              'cr-upload-zone',
              drag ? 'cr-upload-zone--drag' : '',
              file ? 'cr-upload-zone--filled' : '',
            ].join(' ')}
            onClick={() => { if (!isTerminalKiosk()) fileInputRef.current?.click() }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              if (!isTerminalKiosk()) fileInputRef.current?.click()
            }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
          >
            <div className="cr-upload-icon">
              {file ? <FileTextIcon /> : <UploadIcon />}
            </div>
            {file ? (
              <>
                <p className="cr-upload-filename">{file.name}</p>
                <p className="cr-upload-hint">
                  {(file.size / 1024 / 1024).toFixed(1)} MB · 点击重新选择
                </p>
              </>
            ) : (
              <>
                <p className="cr-upload-title">点击上传或拖拽文件</p>
                <p className="cr-upload-hint">
                  支持 PDF · Word · 图片（JPG / PNG / WEBP）<br />
                  本机验证通道不超过 {DESKTOP_MAX_SIZE_MB}MB；手机扫码不超过 10MB
                </p>
              </>
            )}
          </div>
          )}
          {selectedName && (
            <button
              type="button"
              className="cr-file-remove"
              onClick={(e) => { e.stopPropagation(); setFile(null); setPhoneSource(null) }}
            >
              <XIcon size={18} />
              移除文件
            </button>
          )}
        </Card>

        {/* 合同类型 */}
        <Card>
          <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>合同类型</p>
          <div className="cr-type-grid" role="radiogroup" aria-label="合同类型">
            {CONTRACT_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="radio"
                aria-checked={contractType === t.key}
                className={`cr-type-btn${contractType === t.key ? ' cr-type-btn--active' : ''}`}
                onClick={() => setContractType(t.key)}
              >
                <span className="cr-type-btn__name">{t.name}</span>
                <span className="cr-type-btn__hint">{t.hint}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* 知情同意 */}
        <div className="cr-consent-card">
          <div className="cr-consent-card__title">
            <InfoIcon />
            服务说明与知情同意
          </div>
          {loadingConsent ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px 0' }}>
              <Loader2Icon className="animate-spin" size={28} style={{ color: 'var(--teal)' }} />
            </div>
          ) : (
            <>
              <div className="cr-consent-body">
                <p style={{ marginBottom: 10 }}>
                  <b>本服务{COMPLIANCE_COPY.KIOSK_CONTRACT_REVIEW_SCOPE}。</b>重大争议请咨询律师或官方机构。
                </p>
                <p style={{ marginBottom: 10 }}>
                  您上传的合同原件仅在本项目受控存储中短期用于 OCR 与风险分析，
                  <b>发送模型前脱敏，结束时优先删除</b>，不向招聘企业或合作机构回传。
                </p>
                {consentScope && (
                  <p style={{ fontSize: 20, color: 'var(--muted)' }}>
                    {/* 服务端返回的是稳定编码（source_file 等），不是展示文案；
                        直接 join 会把机器码念给用户听。 */}
                    数据类别：{describeDataCategories(consentScope.disclosures.dataCategories).join('、')}。
                    最长保存 {consentScope.disclosures.retention.maximumHours} 小时。
                  </p>
                )}
              </div>
              <label className="cr-consent-check">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                />
                <span className="cr-consent-check__label">
                  我已阅读上述说明，同意本次合同文件用于 AI 签约风险分析
                </span>
              </label>
            </>
          )}
        </div>

        {/* 错误提示 */}
        {error && !aiDown && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              background: 'var(--error-soft)',
              border: '1px solid rgba(193,74,52,.3)',
              borderRadius: 'var(--r-sm)',
              padding: '16px 20px',
              fontSize: 20,
              color: 'var(--error)',
              flexShrink: 0,
            }}
          >
            <AlertCircleIcon size={22} style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}
        <AiDeclarationNote />
    </QxTouchScreen>
    </ContractTouchFrame>
  )
}
