// ============================================================
// 合同审查首页 — 上传合同 + 选择类型 + 知情同意
//
// 步骤 1/3。用户上传合同文件，选择合同类型，阅读并确认知情
// 同意书后点击「开始 AI 审查」进入分析阶段。
// 合规：仅作风险提示，不构成正式法律意见；原文会话后即弃。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  KioskActionBar,
  KioskPageFrame,
  KioskPageHeader,
} from '@ai-job-print/ui'
import type { ContractType } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  FileTextIcon,
  InfoIcon,
  Loader2Icon,
  ShieldAlertIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import {
  createContractReview,
  getConsentScope,
  type ConsentScope,
} from '../../services/api/contractReview'
import './contract-review.css'

const CONTRACT_TYPES: Array<{ key: ContractType; name: string; hint: string }> = [
  { key: 'labor_contract', name: '劳动合同', hint: '正式用工合同' },
  { key: 'internship_agreement', name: '实习协议', hint: '在校生实习用' },
  { key: 'non_compete', name: '竞业限制协议', hint: '含竞业/保密条款' },
  { key: 'offer', name: '录用通知书', hint: 'Offer Letter' },
]

const ACCEPTED = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp'
const MAX_SIZE_MB = 20

export function ContractReviewHomePage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()

  const [file, setFile] = useState<File | null>(null)
  const [contractType, setContractType] = useState<ContractType>('labor_contract')
  const [consentChecked, setConsentChecked] = useState(false)
  const [consentScope, setConsentScope] = useState<ConsentScope | null>(null)
  const [loadingConsent, setLoadingConsent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useBusyLock(submitting)

  useEffect(() => {
    getConsentScope()
      .then(setConsentScope)
      .catch(() => setError('无法加载知情同意信息，请稍后重试'))
      .finally(() => setLoadingConsent(false))
  }, [])

  function handleFileChange(f: File | null) {
    if (!f) return
    if (f.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`文件不能超过 ${MAX_SIZE_MB}MB`)
      return
    }
    setError(null)
    setFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileChange(f)
  }

  async function handleSubmit() {
    if (!file || !consentScope || !consentChecked) return
    setError(null)
    setSubmitting(true)
    try {
      const task = await createContractReview(
        file,
        contractType,
        {
          consentVersion: consentScope.consentVersion,
          consentScopeHash: consentScope.consentScopeHash,
          disclaimerVersion: consentScope.disclaimerVersion,
        },
        { token: getToken() },
      )
      navigate('/contract-review/processing', {
        state: {
          taskId: task.id,
          accessToken: (task as unknown as { accessToken?: string }).accessToken ?? null,
          contractType,
        },
      })
    } catch {
      setError('创建审查任务失败，请检查文件格式后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = !!file && consentChecked && !loadingConsent && !submitting

  return (
    <KioskFullscreenShell>
      <main className="flex min-h-0 flex-1 flex-col">
        <KioskPageFrame
          className="fusion-w3 fusion-w3--resume"
          header={
            <KioskPageHeader
              title="AI 合同审查"
              description="风险提示 · 仅供参考 · 非法律意见"
              onBack={() => navigate(-1)}
              backLabel="返回"
            />
          }
          footer={
            <KioskActionBar>
              <Button
                size="lg"
                className="w-full"
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {submitting ? (
                  <>
                    <Loader2Icon className="animate-spin mr-2" size={22} />
                    上传中…
                  </>
                ) : (
                  <>
                    <ShieldAlertIcon size={22} className="mr-2" />
                    开始 AI 审查
                  </>
                )}
              </Button>
            </KioskActionBar>
          }
        >
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
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            className="sr-only"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
          <div
            role="button"
            tabIndex={0}
            className={[
              'cr-upload-zone',
              drag ? 'cr-upload-zone--drag' : '',
              file ? 'cr-upload-zone--filled' : '',
            ].join(' ')}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
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
                  支持 PDF · Word · 图片（JPG / PNG）<br />
                  单份合同，不超过 {MAX_SIZE_MB}MB
                </p>
              </>
            )}
          </div>
          {file && (
            <button
              type="button"
              className="mt-3 flex items-center gap-2 text-sm"
              style={{ fontSize: 18, color: 'var(--muted)', marginTop: 12 }}
              onClick={(e) => { e.stopPropagation(); setFile(null) }}
            >
              <XIcon size={18} />
              移除文件
            </button>
          )}
        </Card>

        {/* 合同类型 */}
        <Card>
          <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>合同类型</p>
          <div className="cr-type-grid">
            {CONTRACT_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
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
                  <b>本服务仅作风险提示，不构成正式法律意见。</b>重大争议请咨询律师或官方机构。
                </p>
                <p style={{ marginBottom: 10 }}>
                  您上传的合同文件仅在本次会话期间用于 OCR 文字提取和 AI 审查，
                  <b>会话结束后立即删除，不保存至任何外部服务</b>，不向第三方泄露。
                </p>
                {consentScope && (
                  <p style={{ fontSize: 17, color: 'var(--muted)' }}>
                    数据类别：{consentScope.disclosures.dataCategories.join('、')}。
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
                  我已阅读上述说明，同意本次合同文件用于 AI 审查分析
                </span>
              </label>
            </>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
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
        </KioskPageFrame>
      </main>
    </KioskFullscreenShell>
  )
}
