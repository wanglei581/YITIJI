import { useEffect, useState } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'

import { useNavigate, useParams } from 'react-router-dom'
import type { FairMaterialDTO, ExternalJobFairDTO } from '@ai-job-print/shared'
import type { FairMaterialType } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { FAIR_MATERIAL_TYPE_LABELS } from '../../types/fair'
import { AlertTriangleIcon, BriefcaseIcon, CalendarIcon, FileTextIcon, MapIcon, MapPinIcon, NewspaperIcon, PrinterIcon } from 'lucide-react'
import { getFairMaterials, getJobFairById, prepareFairMaterialPrint } from '../../services/api'
import { DEMO_MODE_NO_REAL_FILE_REASON } from '../../lib/capabilityReasons'
import { API_MODE } from '../../services/api/client'
import {
  QxFairCta,
  QxFairNavRow,
  QxFairShell,
  QxFairSkel,
  QxFairSourceCard,
  QxFairState,
} from './qx/qxFairChrome'

function formatSize(kb: number) {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

function MaterialIcon({ type }: { type: FairMaterialType }) {
  switch (type) {
    case 'schedule':      return <CalendarIcon aria-hidden="true" />
    case 'venue_map':     return <MapIcon aria-hidden="true" />
    case 'company_list':  return <NewspaperIcon aria-hidden="true" />
    case 'position_list': return <BriefcaseIcon aria-hidden="true" />
    case 'brochure':      return <FileTextIcon aria-hidden="true" />
    default:              return <MapPinIcon aria-hidden="true" />
  }
}

function isExpiredPrintError(message: string) {
  return /过期|expired|EXPIRED|签名/.test(message)
}

export function FairMaterialsPage() {
  const navigate = useNavigate()
  const { id }   = useParams<{ id: string }>()
  const fairId   = id ?? ''

  const [fair,      setFair]      = useState<ExternalJobFairDTO | null>(null)
  const [materials, setMaterials] = useState<FairMaterialDTO[]>([])
  const [materialsTotal, setMaterialsTotal] = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(false)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([getJobFairById(fairId), getFairMaterials(fairId)])
      .then(([fairRes, matsRes]) => {
        if (cancelled) return
        setFair(fairRes.data)
        setMaterials(matsRes.data)
        setMaterialsTotal(matsRes.pagination?.total ?? matsRes.data.length)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fairId])

  // 打印时由后端按需把 FairMaterial 转为短期 FileObject，只消费内部 HMAC printFileUrl。
  const handlePrint = async (material: FairMaterialDTO) => {
    if (printingId) return
    setPrintingId(material.id)
    setPrintError(null)
    try {
      const printable = await prepareFairMaterialPrint(fairId, material.id)
      if (!printable.printFileUrl) throw new Error('打印链接未就绪')
      navigate('/print/confirm', {
        state: {
          file: {
            name: printable.filename,
            size: formatSize(Math.max(1, Math.round(printable.sizeBytes / 1024))),
            pages: printable.pageCount > 0 ? printable.pageCount : null,
            fileId: printable.fileId,
            fileUrl: printable.printFileUrl,
            mimeType: printable.mimeType,
          },
          params: makePrintParams({
            copies: 1,
            duplex: printable.pageCount > 1 ? 'double' : 'single',
            color: 'bw',
          }),
        },
      })
    } catch (error) {
      setPrintError(userMessageOf(error, '打印文件准备失败，请稍后重试'))
    } finally {
      setPrintingId(null)
    }
  }

  if (loading) {
    return (
      <QxFairShell
        title="活动物料"
        subtitle="链接由服务端临时签发；打印价格以现场公示与服务端报价为准。"
        status={{ tone: 'unknown', label: '正在取活动物料' }}
        screen="materials"
        state="loading"
        ctabar={<QxFairCta variant="primary" testId="materials-primary" onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</QxFairCta>}
      >
        <QxFairSkel rows={3} />
      </QxFairShell>
    )
  }

  const expired = Boolean(printError && isExpiredPrintError(printError))
  const printFailed = Boolean(printError && !expired)
  const viewState = printFailed ? 'print-failed' : expired ? 'expired' : error ? 'error' : materials.length === 0 ? 'empty' : 'list'
  const pill = viewState === 'list'
    ? { tone: 'ok' as const, label: '物料链接由服务端临时签发' }
    : viewState === 'print-failed'
      ? { tone: 'bad' as const, label: '这次打印没有成功' }
      : viewState === 'expired'
        ? { tone: 'warn' as const, label: '物料链接已过期' }
        : viewState === 'empty'
          ? { tone: 'unknown' as const, label: '这场还没有可下载的物料' }
          : { tone: 'bad' as const, label: '物料这次没取到' }

  return (
    <QxFairShell
      title="活动物料"
      subtitle={`${fair ? `${fair.name} · ` : ''}${materialsTotal > materials.length ? `已取回 ${materials.length} / 共 ${materialsTotal} 份资料` : '链接由服务端临时签发；打印价格以现场公示与服务端报价为准。'}`}
      status={pill}
      screen="materials"
      state={viewState}
      ctabar={
        viewState === 'list' ? (
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</QxFairCta>
            <QxFairCta variant="primary" testId="materials-primary" onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>
              参会企业
            </QxFairCta>
          </>
        ) : viewState === 'print-failed' ? (
          <>
            <QxFairCta onClick={() => navigate('/help')}>找工作人员处理</QxFairCta>
            <QxFairCta variant="primary" testId="materials-primary" onClick={() => navigate('/print/progress')}>
              查看打印订单状态
            </QxFairCta>
          </>
        ) : viewState === 'expired' ? (
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}`)}>返回招聘会</QxFairCta>
            <QxFairCta variant="primary" testId="materials-primary" onClick={() => { setPrintError(null) }}>
              重新获取链接
            </QxFairCta>
          </>
        ) : (
          <>
            <QxFairCta onClick={() => navigate(`/job-fairs/${fairId}/companies`)}>看参展名单</QxFairCta>
            <QxFairCta variant="primary" testId="materials-primary" onClick={() => navigate('/print-scan')}>
              打印你自己的材料
            </QxFairCta>
          </>
        )
      }
    >
      {viewState === 'print-failed' ? (
        <>
          <QxFairState screen="materials" tone="error" icon={AlertTriangleIcon} title="这次打印没有成功">
            打印机回流的状态是失败。<b>没出纸就是没出纸</b>，本机不会把它记成已完成。如果已经扣费，请带着订单号找工作人员处理。
            {printError ? <p>{printError}</p> : null}
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={FileTextIcon} title="回到物料列表" description="可以换一份或重新发起打印。" onClick={() => setPrintError(null)} testId="materials-back" />
          </div>
        </>
      ) : viewState === 'expired' ? (
        <QxFairState screen="materials" tone="info" icon={CalendarIcon} title="物料链接已过期">
          为了保护文件，物料使用<b>限时签名链接</b>，超时就会失效。重新获取一次即可，内容不变。
        </QxFairState>
      ) : error ? (
        <QxFairState screen="materials" tone="error" icon={AlertTriangleIcon} title="物料这次没取到">
          请求失败。本机不生成一份「参考版」冒充官方物料。
        </QxFairState>
      ) : materials.length === 0 ? (
        <>
          <QxFairState screen="materials" tone="empty" icon={FileTextIcon} title="这场还没有可下载的物料">
            主办方没有上传名单、手册或指引。本机<b>不生成一份「参考版」冒充官方物料</b>。
          </QxFairState>
          <div className="qx-rows">
            <QxFairNavRow icon={FileTextIcon} title="返回招聘会" description="时间地点和参展名单仍可查看。" onClick={() => navigate(`/job-fairs/${fairId}`)} testId="materials-fair" />
          </div>
        </>
      ) : (
        <>
          <div className="qx-sec-h">
            <span className="t">活动物料</span>
            <span className="hint">共 {materials.length} 份 · 链接由服务端临时签发</span>
          </div>
          <div className="qx-fair-list" data-testid="materials-list">
            {materials.map((mat) => {
              const isPreparingThis = printingId === mat.id
              const canPrint = mat.allowPrint && API_MODE === 'http' && !printingId
              const printLabel = isPreparingThis
                ? '正在准备打印文件…'
                : API_MODE !== 'http'
                  ? '暂不可打印'
                  : `去打印(${mat.pageCount} 页)`

              return (
                <div key={mat.id} className="qx-fair-item">
                  <div className="qx-fair-item-link">
                    <span className="qx-fair-item-ic" data-tone="teal"><MaterialIcon type={mat.type} /></span>
                    <span className="qx-fair-item-tx">
                      <span className="qx-fair-item-t">
                        {mat.name}
                        <span className="qx-fair-tag" style={{ marginLeft: 8 }}>{FAIR_MATERIAL_TYPE_LABELS[mat.type]}</span>
                      </span>
                      {mat.description ? <span className="qx-fair-item-sub">{mat.description}</span> : null}
                      <span className="qx-fair-item-sub">
                        <span>页数 {mat.pageCount}</span>
                        <span>{formatSize(mat.fileSizeKB)}</span>
                      </span>
                    </span>
                    {mat.allowPrint ? (
                      <span>
                        <button
                          type="button"
                          className="qx-fair-mini"
                          data-variant="primary"
                          disabled={printingId !== null}
                          aria-disabled={API_MODE !== 'http' || undefined}
                          aria-describedby={API_MODE !== 'http' ? `fair-material-blocked-${mat.id}` : undefined}
                          onClick={() => { if (canPrint) handlePrint(mat) }}
                        >
                          <PrinterIcon size={18} aria-hidden />
                          {printLabel}
                        </button>
                        {API_MODE !== 'http' ? (
                          <span id={`fair-material-blocked-${mat.id}`} className="qx-fair-blocked">
                            {DEMO_MODE_NO_REAL_FILE_REASON}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="qx-fair-blocked">该资料暂不开放打印</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <section className="qx-card">
            <div className="qx-fair-blk-h">关于打印这些物料</div>
            <div className="qx-fair-rules">
              <p className="qx-fair-rule"><i>1</i><span>物料链接<b>有有效期</b>，过期后需要重新获取，不能用旧链接直接打印。</span></p>
              <p className="qx-fair-rule"><i>2</i><span>打印份数、单双面与黑白彩色在打印页选择，<b>价格以现场公示与服务端报价为准</b>。</span></p>
              <p className="qx-fair-rule"><i>3</i><span>打印是否成功以打印机回流的状态为准；本页不显示逐页进度。</span></p>
            </div>
          </section>
          <QxFairSourceCard sourceName={fair?.sourceName} syncTime={fair?.syncTime} externalId={fair?.externalId} />
        </>
      )}
    </QxFairShell>
  )
}
