import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AlertCircleIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { getPayStatus } from '../../services/print/paymentApi'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'

interface PrintFile {
  name:     string
  size:     string
  pages:    number
  fileUrl?: string
}

interface PrintJobState {
  file?:                PrintFile
  params?:              PrintJobParams
  success?:             boolean
  reason?:              string
  returnUrl?:           string
  returnLabel?:         string
  taskId?:              string
  orderId?:             string
  paymentSessionToken?: string
  source?:              PrintMaterialSource
}

const DUPLEX_LABEL: Record<string, string> = {
  simplex:           '单面',
  duplex_long_edge:  '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

export function PrintDonePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as PrintJobState

  const { file, params, success = true, reason } = state
  const uploadPath = printUploadPathForSource(state.source)

  // C5-3：paid 后展示取件凭证码。取件码可见性完全由后端 pickupCodeVisibleFor 决定
  // （paid + 未退款 + 任务未进终态），前端只透传后端返回值，不自行编造。
  const [pickupCode, setPickupCode] = useState<string | null>(null)
  const [pickupCodeError, setPickupCodeError] = useState<string | null>(null)
  const [rating, setRating] = useState<'满意' | '一般' | '不满意' | null>(null)

  useEffect(() => {
    if (!success || API_MODE !== 'http' || !state.orderId || !state.paymentSessionToken) return
    let cancelled = false
    void (async () => {
      try {
        const s = await getPayStatus({ orderId: state.orderId as string, paymentSessionToken: state.paymentSessionToken })
        if (!cancelled) {
          setPickupCode(s.pickupCode)
          setPickupCodeError(null)
        }
      } catch {
        if (!cancelled) {
          setPickupCodeError('取件凭证暂时无法读取，请联系工作人员核验订单')
        }
      }
    })()
    return () => { cancelled = true }
  }, [success, state.orderId, state.paymentSessionToken])

  const handleRetry = () => {
    const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason'])
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/print/confirm', { state: retryState })
  }

  const totalFaces = file && params
    ? file.pages * params.copies * (params.duplex === 'simplex' ? 1 : 2)
    : null

  /* ── 失败态 ── */
  if (!success) {
    return (
      <div className="print-proto flex min-h-full flex-col">
        <PrintPrototypeHeader
          title="打印失败"
          subtitle="请检查任务状态后重试"
          step={7}
          backLabel="返回首页"
          onBack={() => navigate('/')}
        />
        <div className="print-done-fail">
          <div className="print-done-fail-icon">
            <AlertCircleIcon aria-hidden="true" />
          </div>
          <div className="print-done-fail-title">打印失败</div>
          <div className="print-done-fail-reason">
            {reason ?? '打印任务未能完成，请重试或联系工作人员'}
          </div>
          <div className="print-done-fail-actions">
            <button type="button" className="print-done-action-btn ghost" onClick={() => navigate('/')}>
              返回首页
            </button>
            <button type="button" className="print-done-action-btn primary" onClick={handleRetry}>
              重试打印
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ── 成功态 ── */
  return (
    <div className="print-proto flex min-h-full flex-col">
      <PrintPrototypeHeader
        title="打印完成"
        subtitle="文件已从出纸口送出，请核对页数后取走"
        step={7}
        backLabel="返回首页"
        onBack={() => navigate('/')}
      />

      <main className="print-done-content">
        <div className="print-done-split">

          {/* 左列：成功勾 + 取件凭证码 */}
          <section className="print-done-left" aria-label="打印完成">
            {/* 190px 成功勾圆 */}
            <div className="print-done-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
            </div>

            <div className="print-done-title">请取走文件</div>

            <div className="print-done-sub">
              {totalFaces != null
                ? `共 ${totalFaces} 面已全部打印，请在出纸口取走并核对页数`
                : '文件已全部打印，请在出纸口取走'}
            </div>

            {/* 取件凭证码 */}
            {pickupCode && (
              <div className="print-pickup">
                <div className="print-pickup-label">取件凭证码</div>
                <div className="print-pickup-code">{pickupCode}</div>
                <div className="print-pickup-note">如需现场核验取件或补打，请向工作人员出示此凭证码</div>
              </div>
            )}
            {pickupCodeError && (
              <div className="print-pickup">
                <div className="print-pickup-error">
                  <AlertCircleIcon style={{ display: 'inline', width: 16, height: 16, marginRight: 6, verticalAlign: 'middle' }} aria-hidden="true" />
                  {pickupCodeError}
                </div>
              </div>
            )}

            {/* 任务元信息 */}
            {(state.taskId || state.orderId) && (
              <div className="print-done-task-meta">
                {state.taskId  && <span className="print-done-task-chip"><b>任务号</b> {state.taskId}</span>}
                {state.orderId && <span className="print-done-task-chip"><b>订单号</b> {state.orderId}</span>}
                <span className="print-done-task-chip ok"><b>完成</b></span>
              </div>
            )}
          </section>

          {/* 右列 */}
          <div className="print-done-right">

            {/* 任务摘要 */}
            {file && params && (
              <div className="print-done-card a-slate">
                <b className="print-done-card-hd">本次任务摘要</b>
                <div className="print-done-i-row">
                  <span className="k">文件名</span>
                  <span className="v">{file.name}</span>
                </div>
                <div className="print-done-i-row">
                  <span className="k">页数 / 份数</span>
                  <span className="v">{file.pages} 页 × {params.copies} 份</span>
                </div>
                <div className="print-done-i-row">
                  <span className="k">打印面</span>
                  <span className="v">{DUPLEX_LABEL[params.duplex] ?? params.duplex}</span>
                </div>
                <div className="print-done-i-row">
                  <span className="k">色彩 / 质量</span>
                  <span className="v">
                    {params.colorMode === 'color' ? '彩色' : '黑白'} · {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
                  </span>
                </div>
              </div>
            )}

            {/* 问题反馈 + 满意度 */}
            <div className="print-done-card">
              <b className="print-done-card-hd">打印遇到问题？</b>
              <span className="print-done-card-sub">缺页、卡纸、质量不佳等问题可在此反馈</span>
              <div className="print-done-fb-group">
                <button type="button" className="print-done-fb-btn" aria-label="异常反馈">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z" />
                    <path d="M9 12h.01M13 12h.01M17 12h.01" />
                  </svg>
                  异常反馈
                </button>
                <button type="button" className="print-done-fb-btn" aria-label="使用帮助">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M9.5 9.3a2.5 2.5 0 014.9.7c0 1.7-2.4 2.1-2.4 3.5M12 16.8v.4" />
                  </svg>
                  使用帮助
                </button>
              </div>
              <div className="print-done-rate-row" role="group" aria-label="满意度评分">
                <span>本次体验</span>
                {(['满意', '一般', '不满意'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={rating === item}
                    data-active={String(rating === item)}
                    onClick={() => setRating(item)}
                    className="print-done-rate-chip"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {/* 接下来 */}
            <div className="print-done-card" style={{ flex: 1 }}>
              <b className="print-done-card-hd">接下来</b>
              <div className="print-done-next-list">
                <button type="button" className="print-done-tile primary" onClick={() => navigate(uploadPath)}>
                  <span className="print-done-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M6 9V3h12v6M6 18h-2a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 15h12v6H6z" />
                    </svg>
                  </span>
                  <span className="print-done-tile-text">
                    <b>继续打印</b>
                    <span>再打一份或换一个文件</span>
                  </span>
                </button>
                <button type="button" className="print-done-tile" onClick={() => navigate('/me/print-orders')}>
                  <span className="print-done-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M7 3h8l4 4v14H7z" />
                      <path d="M15 3v4h4M10 12h6M10 16h6" />
                    </svg>
                  </span>
                  <span className="print-done-tile-text">
                    <b>查看打印订单</b>
                    <span>在「我的」查看记录与凭证码</span>
                  </span>
                </button>
                <button type="button" className="print-done-tile" onClick={() => navigate('/')}>
                  <span className="print-done-tile-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10" />
                    </svg>
                  </span>
                  <span className="print-done-tile-text">
                    <b>返回首页</b>
                    <span>回到功能大厅</span>
                  </span>
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* 底部提示 */}
        <div className="print-done-notice" role="note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.5" />
          </svg>
          如遇卡纸或缺页，请联系现场工作人员，凭任务号与取件凭证码可协助核验补打；打印文件请妥善保管，勿遗留在机器旁。
        </div>
      </main>
    </div>
  )
}
